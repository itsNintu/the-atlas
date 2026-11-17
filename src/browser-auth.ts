import { randomBytes } from "node:crypto";
import { ApiError, fail, object } from "./errors.ts";
import { canonical, hash, id, now, type Actor, type Store } from "./store.ts";

const ATLAS = "https://atlas.creator.gg";
const AGENTS = "https://agents.creator.gg";
const BACKEND = "https://colorless-mongoose-693.convex.site";
const SESSION = "__Host-atlas_session", LOGIN = "__Host-atlas_login";
const TEN_MINUTES = 600_000, THIRTY_DAYS = 30 * 86400_000;
const hex = () => randomBytes(32).toString("hex");
const identityFields = ["issuer", "company_id", "workspace_id", "location_id", "user_id"];
export type CreatorIdentity = { issuer: string; company_id: string; workspace_id: string; location_id: string; user_id: string; workspace_name?: string };
export type BrowserSession = { token_hash: string; identity_key: string; identity_json: string; expires_at: number; workspace_id: string; principal_id: string };
// Constructor injection is a test seam only. No URL/configuration comes from callers.
export type BrokerFetch = (input: string, init: RequestInit) => Promise<Response>;

function identity(value: unknown, named = false): CreatorIdentity {
  const b = object(value);
  if (b.issuer !== "https://platform.creator.gg" || identityFields.some(k => typeof b[k] !== "string" || !b[k].length || b[k].length > 256 || b[k].trim() !== b[k]) ||
      Object.keys(b).some(k => ![...identityFields, ...(named ? ["workspace_name"] : [])].includes(k)) ||
      (named && (typeof b.workspace_name !== "string" || !b.workspace_name.length || b.workspace_name.length > 256)))
    fail(400, "invalid_identity", "Exact Creator workspace identity required");
  return b as CreatorIdentity;
}
export function browserIdentityKey(value: CreatorIdentity) {
  return canonical(Object.fromEntries(identityFields.map(k => [k, value[k as keyof CreatorIdentity]])));
}
function cookie(request: Request, name: string) {
  const values = (request.headers.get("cookie") ?? "").split(";").map(s => s.trim()).filter(s => s.startsWith(name + "=")).map(s => s.slice(name.length + 1));
  return values.length === 1 && /^[a-f0-9]{64}$/.test(values[0]) ? values[0] : null;
}
function cookieValue(name: string, value: string, seconds: number) {
  return `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.max(0, Math.floor(seconds))}`;
}
function response(value: unknown, status = 200, cookies: string[] = [], location?: string) {
  const headers = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  if (location) { headers.set("Location", location); return new Response(null, { status, headers }); }
  return Response.json(value, { status, headers });
}
function site(request: Request, callback = false) {
  const origin = request.headers.get("origin");
  if ((request.method !== "GET" || origin) && origin !== (callback ? AGENTS : ATLAS))
    fail(403, "invalid_origin", "Trusted browser origin required");
  const metadata = request.headers.get("sec-fetch-site");
  if (metadata && !(callback ? ["same-site", "same-origin"] : ["same-origin"]).includes(metadata))
    fail(403, "invalid_origin", "Browser request site rejected");
}
export async function boundedBody(request: Request | Response, limit: number) {
  if (Number(request.headers.get("content-length")) > limit) fail(413, "payload_too_large", "Request body too large");
  const reader = request.body?.getReader(), chunks: Uint8Array[] = []; let size = 0;
  if (reader) while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); fail(413, "payload_too_large", "Request body too large"); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export class BrowserAuth {
  constructor(public store: Store, private backend: BrokerFetch = (url, init) => fetch(url, init)) {}
  hasCookie(request: Request) { return cookie(request, SESSION) !== null; }
  private async broker(path: string, init: RequestInit): Promise<any> {
    const retryable = path === "/atlas/identity";
    try {
      const r = await this.backend(BACKEND + path, { ...init, redirect: "manual", signal: AbortSignal.timeout(10_000) });
      if (r.status === 401 || r.status === 403) fail(r.status, "creator_access_denied", "Creator session or membership is no longer authorized");
      if (!r.ok) fail(503, "creator_unavailable", "Creator authentication is unavailable", retryable);
      const b = JSON.parse(await boundedBody(r, 8192));
      if (path === "/atlas/identity" && typeof b.identity?.issuer === "string" && b.identity.issuer !== "https://platform.creator.gg")
        fail(403, "creator_identity_changed", "Creator workspace identity changed; sign in again");
      const i = identity(b.identity, true);
      if (!Number.isSafeInteger(b.expires_at) || b.expires_at <= Date.now()) fail(401, "creator_session_expired", "Creator session expired");
      return { ...b, identity: i };
    } catch (e) {
      if (e instanceof ApiError && [401, 403, 503].includes(e.status)) throw e;
      // Never log upstream errors/bodies, which may contain tickets or grants.
      fail(503, "creator_unavailable", "Creator authentication is unavailable; start a new sign-in after an uncertain exchange", retryable);
    }
  }
  private account(i: CreatorIdentity) {
    const key = browserIdentityKey(i), old = this.store.one("SELECT * FROM browser_accounts WHERE identity_key=?", key);
    if (old) return old;
    const workspace_id = id("ws"), principal_id = id("prn");
    this.store.run("INSERT INTO workspaces VALUES(?,?,?)", workspace_id, i.workspace_name, now());
    this.store.run("INSERT INTO principals VALUES(?,?,?,?,0,?)", principal_id, workspace_id, "Creator account", "human", now());
    this.store.run("INSERT INTO browser_accounts VALUES(?,?,?,0)", key, workspace_id, principal_id);
    this.store.run("INSERT INTO browser_agent_access VALUES(?,?)", key, principal_id);
    return { identity_key: key, workspace_id, principal_id };
  }
  revoke(sessionHash: string) {
    this.store.transaction(() => {
      this.store.run("UPDATE credentials SET revoked_at=? WHERE id IN (SELECT credential_id FROM browser_credentials WHERE session_hash=?) AND revoked_at IS NULL", now(), sessionHash);
      this.store.run("UPDATE browser_sessions SET revoked_at=?,grant_token=NULL WHERE token_hash=?", now(), sessionHash);
    });
  }
  current(s: BrowserSession) {
    const row = this.store.one(`SELECT s.*,a.workspace_id,a.principal_id FROM browser_sessions s JOIN browser_accounts a USING(identity_key)
      WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.grant_token IS NOT NULL AND s.expires_at>?`, s.token_hash, Date.now());
    if (!row || row.identity_key !== s.identity_key || row.workspace_id !== s.workspace_id || row.principal_id !== s.principal_id)
      fail(401, "browser_session_expired", "Browser session is no longer active");
    return row;
  }
  async session(request: Request): Promise<BrowserSession | null> {
    const raw = cookie(request, SESSION); if (!raw) return null;
    const s = this.store.one(`SELECT s.*,a.workspace_id,a.principal_id FROM browser_sessions s JOIN browser_accounts a USING(identity_key)
      WHERE s.token_hash=? AND s.revoked_at IS NULL`, hash(raw));
    if (!s) return null;
    if (s.expires_at <= Date.now() || !s.grant_token) { this.revoke(s.token_hash); return null; }
    let b;
    try {
      b = await this.broker("/atlas/identity", { headers: { Authorization: `Bearer ${s.grant_token}` } });
      if (browserIdentityKey(b.identity) !== s.identity_key) fail(403, "creator_identity_changed", "Creator workspace identity changed; sign in again");
    } catch (e) {
      if (e instanceof ApiError && [401, 403].includes(e.status)) this.revoke(s.token_hash);
      throw e;
    }
    this.current(s); // Mapping/logout/expiry may have changed during the broker await.
    s.expires_at = Math.min(s.expires_at, b.expires_at);
    s.identity_json = JSON.stringify(b.identity);
    this.store.run("UPDATE browser_sessions SET expires_at=?,identity_json=? WHERE token_hash=?", s.expires_at, s.identity_json, s.token_hash);
    return s;
  }
  agents(s: BrowserSession) {
    this.current(s);
    return this.store.all(`SELECT p.id AS principal_id,b.agent_id,p.name FROM browser_agent_access x
      JOIN principals p ON p.id=x.principal_id JOIN memory_bindings b ON b.principal_id=p.id AND b.workspace_id=p.workspace_id
      JOIN memory_grants g ON g.principal_id=p.id AND g.scope='agent:'||b.agent_id AND g.action='read'
      WHERE x.identity_key=? AND p.workspace_id=? ORDER BY b.agent_id,p.id`, s.identity_key, s.workspace_id);
  }
  actor(s: BrowserSession, agent?: unknown): Actor {
    this.current(s);
    let principal = s.principal_id;
    if (agent !== undefined) {
      if (typeof agent !== "string") fail(403, "browser_agent_denied", "Select an authorized agent");
      const allowed = this.agents(s).find(a => a.agent_id === agent);
      if (!allowed) fail(403, "browser_agent_denied", "Agent is not authorized for this account");
      principal = allowed.principal_id;
    }
    let c = this.store.one("SELECT credential_id FROM browser_credentials WHERE session_hash=? AND principal_id=?", s.token_hash, principal);
    if (!c) {
      c = { credential_id: id("browser_key") };
      // Discard the random preimage immediately. This is never a machine/API token.
      this.store.run("INSERT INTO credentials VALUES(?,?,?,?,NULL)", c.credential_id, principal, hash(hex()), now());
      this.store.run("INSERT INTO browser_credentials VALUES(?,?,?)", s.token_hash, principal, c.credential_id);
    }
    const a = this.store.one("SELECT * FROM principals WHERE id=? AND workspace_id=?", principal, s.workspace_id);
    if (!a) fail(403, "browser_agent_denied", "Principal is no longer authorized");
    const actor: Actor = { ...a, is_admin: 0, credential_id: c.credential_id, browser_session_hash: s.token_hash,
      browser_identity_key: s.identity_key, browser_agent_id: typeof agent === "string" ? agent : undefined };
    this.store.active(actor);
    return actor;
  }
  allow(request: Request) {
    if (new URL(request.url).origin !== ATLAS) fail(403, "invalid_origin", "Atlas browser origin required");
    const path = new URL(request.url).pathname;
    if (!(request.method === "GET" && path === "/v1/me") && !(request.method === "POST" && path === "/v1/memory/graph"))
      fail(403, "browser_read_only", "Browser sessions permit graph inspection only");
    site(request);
  }
  async route(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    // Anonymous developer/loopback views have no browser authority to validate.
    // Active sessions and every SSO effect still require the fixed audience.
    if (request.method === "GET" && path === "/auth/session" && !this.hasCookie(request))
      return response({ authenticated: false }, 200, [cookieValue(SESSION, "", 0)]);
    // Browser auth has a fixed audience. It cannot be broadened by Host/return URLs.
    if (new URL(request.url).origin !== ATLAS) fail(403, "invalid_origin", "Atlas browser origin required");
    if (request.method === "GET" && path === "/auth/login") {
      const origin = request.headers.get("origin"), fetchSite = request.headers.get("sec-fetch-site");
      if ((origin && origin !== ATLAS) || (fetchSite && !["none", "same-origin"].includes(fetchSite))) fail(403, "invalid_origin", "Start sign-in from Atlas");
      const raw = hex(), state = hex(), verifier = hex();
      this.store.transaction(() => {
        const prior = cookie(request, LOGIN); if (prior) this.store.run("DELETE FROM browser_login_transactions WHERE cookie_hash=?", hash(prior));
        this.store.run("DELETE FROM browser_login_transactions WHERE expires_at<=?", Date.now());
        this.store.run("INSERT INTO browser_login_transactions VALUES(?,?,?,?,NULL)", hash(raw), state, verifier, Date.now() + TEN_MINUTES);
      });
      return response(null, 303, [cookieValue(LOGIN, raw, 600)], `${AGENTS}/atlas/sign-in?state=${state}&challenge=${hash(verifier)}`);
    }
    if (request.method === "POST" && path === "/auth/callback") {
      site(request, true);
      if (!/^application\/x-www-form-urlencoded(?:;|$)/i.test(request.headers.get("content-type") ?? "")) fail(415, "unsupported_media_type", "Form callback required");
      const form = new URLSearchParams(await boundedBody(request, 2048));
      const state = form.get("state"), ticket = form.get("ticket"), raw = cookie(request, LOGIN);
      if ([...form.keys()].some(k => !["state", "ticket"].includes(k)) || form.getAll("state").length !== 1 || form.getAll("ticket").length !== 1 ||
          !state || !/^[a-f0-9]{64}$/.test(state) || !ticket || !/^caticket_[A-Za-z0-9_-]{43}$/.test(ticket))
        fail(400, "invalid_callback", "Valid sign-in transaction required");
      if (!raw) fail(400, "invalid_login_cookie", "Sign-in browser transaction is missing or invalid");
      const txn = this.store.transaction(() => {
        const t = this.store.one("SELECT * FROM browser_login_transactions WHERE cookie_hash=? AND state=? AND consumed_at IS NULL AND expires_at>?", hash(raw!), state, Date.now());
        if (!t) fail(401, "invalid_login_transaction", "Sign-in expired or already consumed; start again");
        this.store.run("UPDATE browser_login_transactions SET consumed_at=?,verifier='' WHERE cookie_hash=?", Date.now(), t.cookie_hash);
        return t;
      });
      // Claim BEFORE the external effect. An uncertain exchange is never replayed.
      const b = await this.broker("/atlas/exchange", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket, verifier: txn.verifier, state }) });
      if (typeof b.grant_token !== "string" || !/^cat_[A-Za-z0-9_-]{43}$/.test(b.grant_token)) fail(503, "creator_unavailable", "Creator returned an invalid grant");
      const sessionToken = hex(), expires = Math.min(b.expires_at, Date.now() + THIRTY_DAYS);
      this.store.transaction(() => {
        if (!this.store.one("SELECT 1 FROM browser_login_transactions WHERE cookie_hash=? AND consumed_at IS NOT NULL AND expires_at>?", txn.cookie_hash, Date.now()))
          fail(401, "invalid_login_transaction", "Sign-in was cancelled or expired");
        this.store.run("DELETE FROM browser_login_transactions WHERE cookie_hash=?", txn.cookie_hash);
        const old = cookie(request, SESSION); if (old) this.revoke(hash(old));
        const a = this.account(b.identity);
        this.store.run("INSERT INTO browser_sessions VALUES(?,?,?,?,?,NULL)", hash(sessionToken), a.identity_key, JSON.stringify(b.identity), b.grant_token, expires);
      });
      return response(null, 303, [cookieValue(SESSION, sessionToken, (expires - Date.now()) / 1000), cookieValue(LOGIN, "", 0)], "/brain");
    }
    if (request.method === "GET" && path === "/auth/session") {
      const origin = request.headers.get("origin");
      if (origin && origin !== ATLAS) fail(403, "invalid_origin", "Atlas request required");
      const metadata = request.headers.get("sec-fetch-site");
      if (metadata && !["none", "same-origin"].includes(metadata)) fail(403, "invalid_origin", "Atlas request required");
      const s = await this.session(request);
      if (!s) return response({ authenticated: false }, 200, [cookieValue(SESSION, "", 0)]);
      const agents = this.agents(s).map(({ agent_id, name }) => ({ agent_id, name }));
      return response({ authenticated: true, account: JSON.parse(s.identity_json), agents, expires_at: s.expires_at });
    }
    if (request.method === "POST" && path === "/auth/logout") {
      site(request);
      const raw = cookie(request, SESSION), txn = cookie(request, LOGIN);
      const grant = raw && this.store.one("SELECT grant_token FROM browser_sessions WHERE token_hash=? AND revoked_at IS NULL", hash(raw))?.grant_token;
      if (raw) this.revoke(hash(raw));
      if (txn) this.store.run("DELETE FROM browser_login_transactions WHERE cookie_hash=?", hash(txn));
      let revocation = "not_needed";
      if (grant) {
        try {
          const r = await this.backend(BACKEND + "/atlas/logout", { method: "POST", headers: { Authorization: `Bearer ${grant}` }, redirect: "manual", signal: AbortSignal.timeout(5000) });
          revocation = r.ok ? "confirmed" : "unconfirmed"; await r.body?.cancel();
        } catch { revocation = "unconfirmed"; }
      }
      return response({ ok: true, creator_revocation: revocation }, 200, [cookieValue(SESSION, "", 0), cookieValue(LOGIN, "", 0)]);
    }
    fail(404, "not_found", "Route not found");
  }

  // Called ONLY behind the existing operations token gate, never a browser route.
  bind(value: unknown) {
    const b = object(value);
    if (Object.keys(b).sort().join(",") !== "atlas_workspace_id,expected_unbound,identity,principal_ids" || b.expected_unbound !== true || typeof b.atlas_workspace_id !== "string" ||
        !Array.isArray(b.principal_ids) || !b.principal_ids.length || b.principal_ids.length > 100 || b.principal_ids.some((p: unknown) => typeof p !== "string") || new Set(b.principal_ids).size !== b.principal_ids.length)
      fail(400, "invalid_request", "Exact identity, workspace, principal IDs and expected_unbound:true required");
    const key = browserIdentityKey(identity(b.identity));
    return this.store.transaction(() => {
      const selectedAgents = new Set<string>();
      for (const p of b.principal_ids) if (!this.store.one(`SELECT 1 FROM principals p JOIN memory_bindings m ON m.principal_id=p.id AND m.workspace_id=p.workspace_id
        WHERE p.id=? AND p.workspace_id=?`, p, b.atlas_workspace_id)) fail(409, "browser_binding_conflict", "Every principal must have a binding in the exact workspace");
      for (const p of b.principal_ids) {
        const agent = this.store.one("SELECT agent_id FROM memory_bindings WHERE principal_id=?", p).agent_id;
        if (selectedAgents.has(agent)) fail(409, "browser_binding_conflict", "Each selected agent must have one unambiguous principal");
        selectedAgents.add(agent);
      }
      const old = this.store.one("SELECT * FROM browser_accounts WHERE identity_key=?", key);
      const existing = this.store.all("SELECT principal_id FROM browser_agent_access WHERE identity_key=? ORDER BY principal_id", key).map(x => x.principal_id);
      const target = [...b.principal_ids].sort();
      if (old?.explicit_binding) {
        if (old.workspace_id !== b.atlas_workspace_id || canonical(existing) !== canonical(target)) fail(409, "browser_binding_conflict", "Identity already explicitly bound");
        return { bound: true, idempotent: true };
      }
      if (old) {
        // Only an untouched automatic empty account may be replaced by explicit proof.
        if (existing.length !== 1 || existing[0] !== old.principal_id || this.store.one("SELECT 1 FROM memory_bindings WHERE principal_id=?", old.principal_id) ||
            this.store.one("SELECT 1 FROM memory_grants WHERE principal_id=?", old.principal_id) || this.store.one("SELECT 1 FROM grants WHERE principal_id=?", old.principal_id))
          fail(409, "browser_binding_conflict", "Existing account is not unbound");
        for (const s of this.store.all("SELECT token_hash FROM browser_sessions WHERE identity_key=? AND revoked_at IS NULL", key)) this.revoke(s.token_hash);
        this.store.run("DELETE FROM browser_agent_access WHERE identity_key=?", key);
        const principal = id("prn");
        this.store.run("INSERT INTO principals VALUES(?,?,?,?,0,?)", principal, b.atlas_workspace_id, "Creator account", "human", now());
        this.store.run("UPDATE browser_accounts SET workspace_id=?,principal_id=?,explicit_binding=1 WHERE identity_key=?", b.atlas_workspace_id, principal, key);
      } else {
        const principal = id("prn");
        this.store.run("INSERT INTO principals VALUES(?,?,?,?,0,?)", principal, b.atlas_workspace_id, "Creator account", "human", now());
        this.store.run("INSERT INTO browser_accounts VALUES(?,?,?,1)", key, b.atlas_workspace_id, principal);
      }
      for (const p of target) this.store.run("INSERT INTO browser_agent_access VALUES(?,?)", key, p);
      return { bound: true, idempotent: false };
    });
  }
  inventory() {
    return {
      workspaces: this.store.all("SELECT id,name FROM workspaces ORDER BY id"),
      principals: this.store.all("SELECT id,workspace_id,name,kind,is_admin FROM principals ORDER BY id"),
      memory_bindings: this.store.all("SELECT principal_id,workspace_id,agent_id FROM memory_bindings ORDER BY principal_id"),
      memory_grants: this.store.all("SELECT principal_id,scope,action FROM memory_grants ORDER BY principal_id,scope,action"),
      grants: this.store.all("SELECT principal_id,space_id,action FROM grants ORDER BY principal_id,space_id,action"),
      browser_accounts: this.store.all("SELECT * FROM browser_accounts ORDER BY identity_key"),
      browser_agent_access: this.store.all("SELECT * FROM browser_agent_access ORDER BY identity_key,principal_id"),
    };
  }
}
