import { randomUUID } from 'node:crypto';
import { setting } from './config.ts';
import { ApiError } from './errors.ts';
import type { Store } from './store.ts';

export const DEFAULT_PROVIDER_HOLD_MS = 300_000;
export const MAX_PROVIDER_HOLD_MS = 31 * 86_400_000;
const JEV_PROBE_LEASE_MS = 60_000;
type Provider = 'luna' | 'jev';

function duration(value: string | null): number | undefined {
  if (!value) return undefined;
  const raw = value.trim();
  if (/^\d+$/.test(raw)) {
    const seconds = Number(raw);
    return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= Number.MAX_SAFE_INTEGER / 1000 ? seconds * 1000 : undefined;
  }
  return undefined;
}
function epochMs(value: string | null): number | undefined {
  const seconds = duration(value);
  return seconds !== undefined && Number.isSafeInteger(seconds) ? seconds : undefined;
}

/** Whitelisted transport metadata only; upstream bodies and credentials are never read here. */
export function upstreamDetails(headers: Headers, status: number, now = Date.now()) {
  const details: Record<string, unknown> = {
    upstream_status: status,
    upstream_category: status === 402 ? 'payment_required' : status === 429 ? 'provider_capacity' : 'http_error',
  };
  const retryHeader = headers.get('retry-after')?.trim();
  let retryAfter = duration(retryHeader ?? null);
  if (retryAfter === undefined && retryHeader) {
    const at = Date.parse(retryHeader);
    if (Number.isFinite(at)) retryAfter = Math.max(0, at - now);
  }
  const primaryResetAfter = duration(headers.get('x-codex-primary-reset-after'));
  const resetAt = epochMs(headers.get('x-codex-primary-reset-at'));
  if (retryAfter !== undefined) details.retry_after_ms = retryAfter;
  if (primaryResetAfter !== undefined) details.primary_reset_after_ms = primaryResetAfter;
  if (resetAt !== undefined) details.reset_at_ms = resetAt;
  const candidates = [
    retryAfter !== undefined ? now + retryAfter : undefined,
    primaryResetAfter !== undefined ? now + primaryResetAfter : undefined,
    resetAt,
  ].filter((value): value is number => value !== undefined && Number.isSafeInteger(value));
  if (candidates.length) details.hold_until_ms = Math.max(...candidates);
  return details;
}

export function isLunaCapacity(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === 'native_quota' && [402, 429].includes(Number(error.details.upstream_status));
}
export function isJevPayment(error: unknown): error is ApiError {
  return error instanceof ApiError && error.details.upstream_status === 402 && error.details.upstream_category === 'payment_required';
}

export function recordProviderHold(store: Store, provider: Provider, error: ApiError, at = Date.now()) {
  const safe = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
  const retryAfter = safe(error.details.retry_after_ms), primaryResetAfter = safe(error.details.primary_reset_after_ms);
  const supplied = safe(error.details.hold_until_ms);
  const guidance = supplied !== undefined ? [supplied] : [
    retryAfter !== undefined ? at + retryAfter : undefined,
    primaryResetAfter !== undefined ? at + primaryResetAfter : undefined,
    safe(error.details.reset_at_ms),
  ].filter((value): value is number => value !== undefined && Number.isSafeInteger(value));
  const latest = guidance.length ? Math.max(...guidance) : undefined;
  let proposed = latest !== undefined && latest > at ? latest : at + DEFAULT_PROVIDER_HOLD_MS;
  proposed = Math.min(proposed, at + MAX_PROVIDER_HOLD_MS);
  const status = error.details.upstream_status === 402 ? 402 : 429;
  const category = status === 402 ? 'payment_required' : 'provider_capacity';
  const reason = provider === 'jev' && status === 402 ? 'jev_payment_required' : error.code;
  const timestamp = new Date(at).toISOString();
  return store.transaction(() => {
    const existing = store.one('SELECT hold_until FROM memory_provider_holds WHERE provider=?', provider);
    const holdUntil = Math.max(existing?.hold_until ?? 0, proposed);
    store.run(`INSERT INTO memory_provider_holds(provider,reason,upstream_status,upstream_category,hold_until,created_at,updated_at,probe_token,probe_until)
      VALUES (?,?,?,?,?,?,?,NULL,NULL)
      ON CONFLICT(provider) DO UPDATE SET reason=excluded.reason,upstream_status=excluded.upstream_status,
      upstream_category=excluded.upstream_category,hold_until=?,updated_at=excluded.updated_at,probe_token=NULL,probe_until=NULL`,
      provider, reason, status, category, holdUntil, timestamp, timestamp, holdUntil);
    return holdUntil;
  });
}

export function lunaClaimState(store: Store, at: number) {
  const hold = store.one("SELECT * FROM memory_provider_holds WHERE provider='luna'");
  if (!hold) return { blocked: false, probe: false };
  if ((hold.probe_token && hold.probe_until > at) || hold.hold_until > at) return { blocked: true, probe: false };
  return { blocked: false, probe: true };
}
export function startLunaProbe(store: Store, token: string, at: number, leaseMs: number) {
  store.run("UPDATE memory_provider_holds SET probe_token=?,probe_until=?,updated_at=? WHERE provider='luna'", token, at + Math.max(1000, leaseMs), new Date(at).toISOString());
}
export function releaseProviderProbe(store: Store, provider: Provider, token: string | undefined) {
  if (!token) return;
  store.run('UPDATE memory_provider_holds SET probe_token=NULL,probe_until=NULL,updated_at=? WHERE provider=? AND probe_token=?', new Date().toISOString(), provider, token);
}
/** Only the designated post-hold request can clear a hold; older in-flight successes cannot. */
export function providerRequestSucceeded(store: Store, provider: Provider, probeToken: string | undefined) {
  if (!probeToken) return;
  store.run('DELETE FROM memory_provider_holds WHERE provider=? AND probe_token=?', provider, probeToken);
}

export function beginJevRequest(store: Store, at = Date.now()) {
  return store.transaction(() => {
    const hold = store.one("SELECT * FROM memory_provider_holds WHERE provider='jev'");
    if (!hold) return { allowed: true as const, probeToken: undefined };
    if ((hold.probe_token && hold.probe_until > at) || hold.hold_until > at) return { allowed: false as const, probeToken: undefined };
    const probeToken = randomUUID();
    store.run("UPDATE memory_provider_holds SET probe_token=?,probe_until=?,updated_at=? WHERE provider='jev'", probeToken, at + JEV_PROBE_LEASE_MS, new Date(at).toISOString());
    return { allowed: true as const, probeToken };
  });
}

export function providerDiagnostics(store: Store, at = Date.now()) {
  const native = setting('NATIVE_WORKER') === 'true';
  const one = (provider: Provider, configured: boolean) => {
    if (!configured) return { configured, state: 'not_configured', reason: null, upstream_status: null, upstream_category: null, next_probe_at: null, probe_due: false };
    const hold = store.one('SELECT * FROM memory_provider_holds WHERE provider=?', provider);
    if (!hold) return { configured, state: 'available', reason: null, upstream_status: null, upstream_category: null, next_probe_at: null, probe_due: false };
    const probing = !!hold.probe_token && hold.probe_until > at;
    const nextProbe = probing ? hold.probe_until : hold.hold_until;
    return {
      configured, state: probing ? 'probing' : 'held', reason: hold.reason,
      upstream_status: hold.upstream_status, upstream_category: hold.upstream_category,
      next_probe_at: new Date(nextProbe).toISOString(), probe_due: !probing && hold.hold_until <= at,
    };
  };
  return {
    luna: one('luna', native),
    jev: one('jev', native && !!setting('JEV_API_KEY')),
  };
}
