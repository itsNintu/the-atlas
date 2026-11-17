import { afterEach, expect, test } from "bun:test";
import { App } from "../src/app.ts";
import { BrowserAuth, browserIdentityKey, type CreatorIdentity } from "../src/browser-auth.ts";
import { hash, Store } from "../src/store.ts";
import { brainFixture, seedBrain } from "../scripts/brain-fixture.ts";
import type { SQLiteDatabase } from "../src/sqlite.ts";
import { resetDerivedBrain } from "../src/derived-reset.ts";

const origin = "https://atlas.creator.gg", agents = "https://agents.creator.gg", backend = "https://colorless-mongoose-693.convex.site";
const ticket = "caticket_" + "T".repeat(43);
export const identityA: CreatorIdentity = { issuer: "https://platform.creator.gg", company_id: "fiction-company", workspace_id: "fiction-workspace", location_id: "fiction-location", user_id: "fiction-user-a", workspace_name: "Fictional A" };
const identityB = { ...identityA, user_id: "fiction-user-b", workspace_name: "Fictional B" };
const stores: Store[] = [];
afterEach(() => { for (const s of stores.splice(0)) s.close(); });
function fixture() {
  const f = brainFixture(); stores.push(f.store); seedBrain(f);
  const app = new App(f.store); app.memory = f.memory;
  const state = { next: identityA, status: 200, failExchange: false, failLogout: false, invalid: false, expiry: Date.now() + 86400_000,
    calls: [] as { url: string; init: RequestInit }[], grants: new Map<string, CreatorIdentity>(), pause: null as null | (() => Promise<void>) };
  const auth = new BrowserAuth(f.store, async (url, init) => {
    state.calls.push({ url, init });
    expect(url.startsWith(backend + "/atlas/")).toBe(true); expect(init.redirect).toBe("manual");
    if (url.endsWith("/exchange")) {
      if (state.failExchange) throw Error("synthetic uncertain exchange");
      const grant = "cat_" + String(state.grants.size + 1).padStart(43, "0"); state.grants.set(grant, { ...state.next });
      return Response.json({ grant_token: grant, expires_at: state.expiry, identity: state.next });
    }
    if (url.endsWith("/logout")) { if (state.failLogout) throw Error("synthetic uncertain logout"); return Response.json({ ok: true }); }
    if (state.pause) await state.pause();
    if (state.status !== 200) return new Response(null, { status: state.status });
    if (state.invalid) return Response.json({ identity: { email: "not-authority@example.invalid" } });
    const grant = new Headers(init.headers).get("authorization")!.slice(7);
    return Response.json({ expires_at: state.expiry, identity: state.grants.get(grant) });
  });
  app.browserAuth = auth;
  const req = (path: string, cookie = "", body?: any, method = body === undefined ? "GET" : "POST", headers: Record<string, string> = {}) =>
    app.fetch(new Request(origin + path, { method, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const begin = async (headers: Record<string, string> = {}) => {
    const r = await req("/auth/login", "", undefined, "GET", headers);
    expect(r.status).toBe(303);
    const cookie = r.headers.getSetCookie()[0].split(";")[0];
    return { r, cookie, state: new URL(r.headers.get("location")!).searchParams.get("state")! };
  };
  const callback = (txn: { cookie: string; state: string }, headers: Record<string, string> = {}, extraCookie = "") =>
    app.fetch(new Request(origin + "/auth/callback", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: agents, Cookie: txn.cookie + (extraCookie ? "; " + extraCookie : ""), ...headers }, body: new URLSearchParams({ ticket, state: txn.state }) }));
  const login = async (who = identityA, extraCookie = "") => {
    state.next = who;
    const t = await begin(), r = await callback(t, {}, extraCookie); expect(r.status).toBe(303);
    return r.headers.getSetCookie().find(c => c.startsWith("__Host-atlas_session="))!.split(";")[0];
  };
  const bind = (who = identityA, principal_ids = [f.actor.id], workspace = f.actor.workspace_id) => {
    const { workspace_name, ...identity } = who;
    return auth.bind({ identity, atlas_workspace_id: workspace, principal_ids, expected_unbound: true });
  };
  return { ...f, app, auth, state, req, begin, callback, login, bind };
}

test("callback recovery is safe HTML, with no exchange or cookie mutation on invalid input", async () => {
  const f = fixture(), t = await f.begin();
  for (const cookie of ["", "__Host-atlas_login=bad", t.cookie + "; " + t.cookie]) {
    const r = await f.callback({ ...t, cookie });
    expect(r.status).toBe(400);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.headers.get("x-atlas-signin-error")).toBe("invalid_login_cookie");
    expect(r.headers.getSetCookie()).toEqual([]);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    const html = await r.text();
    expect(html).toContain('href="/brain"'); expect(html).toContain('href="/auth/login"');
    expect(html).toContain("Don’t refresh or resubmit");
    for (const secret of [t.state, ticket, t.cookie.split("=")[1]]) expect(html).not.toContain(secret);
  }
  expect(f.state.calls).toHaveLength(0);
  f.store.run("UPDATE browser_login_transactions SET expires_at=0");
  const expired = await f.callback(t); expect(expired.status).toBe(401);
  expect(expired.headers.get("x-atlas-signin-error")).toBe("invalid_login_transaction");
  expect(f.state.calls).toHaveLength(0);
  const get = await f.req("/auth/callback"); expect(get.headers.get("content-type")).toContain("text/html");
  expect(await get.text()).toContain("Return to Atlas");
});

test("successful competing and post-success callbacks never exchange twice or clear a valid session", async () => {
  const f = fixture(), t = await f.begin();
  const [a, b] = await Promise.all([f.callback(t), f.callback(t)]);
  expect([a.status, b.status].sort()).toEqual([303, 401]);
  const success = a.status === 303 ? a : b, denied = a.status === 401 ? a : b;
  const session = success.headers.getSetCookie().find(c => c.startsWith("__Host-atlas_session="))!.split(";")[0];
  expect(denied.headers.getSetCookie()).toEqual([]);
  const after = await f.callback({ ...t, cookie: session });
  expect(after.status).toBe(400); expect(after.headers.getSetCookie()).toEqual([]);
  expect(f.state.calls.filter(c => c.url.endsWith("/exchange"))).toHaveLength(1);
  expect(f.store.all("SELECT * FROM browser_sessions")).toHaveLength(1);
  expect((await (await f.req("/auth/session", session)).json() as any).authenticated).toBe(true);
});

test("fixed broker PKCE, secure cookies and server-only single-use transaction", async () => {
  const f = fixture(), t = await f.begin();
  const u = new URL(t.r.headers.get("location")!);
  expect(u.origin + u.pathname).toBe(agents + "/atlas/sign-in");
  expect([...u.searchParams.keys()].sort()).toEqual(["challenge", "state"]);
  expect(t.state).toMatch(/^[a-f0-9]{64}$/);
  const raw = t.cookie.split("=")[1], stored = f.store.one("SELECT * FROM browser_login_transactions");
  expect(stored.cookie_hash).toBe(hash(raw)); expect(stored.verifier).toMatch(/^[a-f0-9]{64}$/);
  expect(u.searchParams.get("challenge")).toBe(hash(stored.verifier));
  expect(stored.expires_at - Date.now()).toBeWithin(599_000, 600_001);
  expect(t.r.headers.get("set-cookie")).toContain("HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600");
  const r = await f.callback(t); expect(r.status).toBe(303); expect(r.headers.get("location")).toBe("/brain");
  const exchange = f.state.calls.find(c => c.url.endsWith("/exchange"))!;
  expect(JSON.parse(exchange.init.body as string)).toEqual({ ticket, state: t.state, verifier: stored.verifier });
  expect(r.headers.get("cache-control")).toBe("no-store"); expect(r.headers.get("referrer-policy")).toBe("no-referrer");
  const sessionCookie = r.headers.getSetCookie().find(c => c.startsWith("__Host-atlas_session="))!;
  const token = sessionCookie.split(";")[0].split("=")[1];
  expect(f.store.one("SELECT token_hash FROM browser_sessions").token_hash).toBe(hash(token));
  expect(JSON.stringify(f.store.all("SELECT * FROM browser_sessions"))).not.toContain(token);
  expect((await f.callback(t)).status).toBe(401);
  expect(f.state.calls.filter(c => c.url.endsWith("/exchange"))).toHaveLength(1);
});

test("callback rejects Origin, fetch metadata, cookie/state, duplicates, form tampering and oversize before exchange", async () => {
  const f = fixture(), t = await f.begin();
  for (const headers of [{ Origin: origin }, { Origin: "null" }, { Origin: agents + ".evil.invalid" }, { "Sec-Fetch-Site": "cross-site" }] as Record<string,string>[]) expect((await f.callback(t, headers)).status).toBe(403);
  expect((await f.callback({ ...t, state: "a".repeat(64) })).status).toBe(401);
  expect((await f.callback({ ...t, cookie: "" })).status).toBe(400);
  for (const body of ["ticket=" + ticket + "&state=" + t.state + "&state=" + t.state, "ticket=" + ticket + "&state=" + t.state + "&return_url=https://evil.invalid", "x=" + "a".repeat(2100)]) {
    const r = await f.app.fetch(new Request(origin + "/auth/callback", { method: "POST", headers: { Origin: agents, Cookie: t.cookie, "Content-Type": "application/x-www-form-urlencoded" }, body }));
    expect([400, 413]).toContain(r.status);
  }
  expect(f.state.calls).toHaveLength(0);
  expect((await f.req("/auth/login", "", undefined, "GET", { "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
  f.store.run("UPDATE browser_login_transactions SET expires_at=0");
  expect((await f.callback(t)).status).toBe(401);
});

test("uncertain and concurrent exchange are claimed once without automatic replay", async () => {
  const f = fixture(), t = await f.begin(); f.state.failExchange = true;
  const [a, b] = await Promise.all([f.callback(t), f.callback(t)]);
  expect([a.status, b.status].sort()).toEqual([401, 503]);
  expect((await f.callback(t)).status).toBe(401);
  expect(f.state.calls).toHaveLength(1); expect(f.store.all("SELECT * FROM browser_sessions")).toHaveLength(0);
  expect(f.store.one("SELECT verifier FROM browser_login_transactions").verifier).toBe("");
});

test("new accounts are distinct nonadmin tenants, empty agents and no default grants", async () => {
  const f = fixture(), ca = await f.login(), cb = await f.login(identityB);
  const a: any = await (await f.req("/auth/session", ca)).json(), b: any = await (await f.req("/auth/session", cb)).json();
  expect(a).toMatchObject({ authenticated: true, account: identityA, agents: [] }); expect(b.agents).toEqual([]);
  const accounts = f.store.all("SELECT * FROM browser_accounts");
  expect(accounts[0].workspace_id).not.toBe(accounts[1].workspace_id); expect(accounts.every(a => a.workspace_id !== f.actor.workspace_id)).toBe(true);
  for (const a of accounts) {
    expect(f.store.one("SELECT is_admin,kind FROM principals WHERE id=?", a.principal_id)).toEqual({ is_admin: 0, kind: "human" });
    expect(f.store.all("SELECT * FROM memory_grants WHERE principal_id=?", a.principal_id)).toEqual([]);
    expect(f.store.all("SELECT * FROM grants WHERE principal_id=?", a.principal_id)).toEqual([]);
    expect(f.store.all("SELECT * FROM memory_bindings WHERE principal_id=?", a.principal_id)).toEqual([]);
  }
  for (const c of [ca, cb]) {
    const r = await f.req("/v1/memory/graph", c, { agent_id: "default" }); expect(r.status).toBe(403); expect(JSON.stringify(await r.json())).not.toContain("Mira");
  }
  const me: any = await (await f.req("/v1/me", ca)).json();
  expect(me.principal.is_admin).toBe(0); expect(me.principal).not.toHaveProperty("credential_id"); expect(me.principal).not.toHaveProperty("browser_session_hash");
  expect(JSON.stringify(a)).not.toContain("cat_"); expect(JSON.stringify(a)).not.toContain("grant_token");
});

test("explicit tuple binding opens seeded EXISTING graph, never remaps machine keys/grants; conflicts are atomic", async () => {
  const f = fixture(), machines = f.store.all("SELECT * FROM credentials ORDER BY id"), grants = f.store.all("SELECT * FROM memory_grants ORDER BY principal_id,scope,action");
  const initial = await f.login();
  expect(f.bind()).toEqual({ bound: true, idempotent: false }); expect(f.bind()).toEqual({ bound: true, idempotent: true });
  expect((await (await f.req("/auth/session", initial)).json() as any).authenticated).toBe(false);
  const c = await f.login();
  expect((await (await f.req("/auth/session", c)).json() as any).agents).toEqual([{ agent_id: "default", name: f.actor.name }]);
  const g: any = await (await f.req("/v1/memory/graph", c, { agent_id: "default" })).json();
  expect(g.data.edges).toHaveLength(8); expect(g.data.nodes.some((n: any) => n.label === "Mira")).toBe(true);
  expect(g.data.nodes.some((n: any) => n.label === "Hidden Builder")).toBe(false);
  for (const m of machines) expect(f.store.one("SELECT * FROM credentials WHERE id=?", m.id)).toEqual(m);
  expect(f.store.all("SELECT * FROM memory_grants ORDER BY principal_id,scope,action")).toEqual(grants);
  expect(() => f.bind(identityA, [f.builder.id])).toThrow("already explicitly bound");
  expect(() => f.bind(identityB, [f.actor.id], "foreign-workspace")).toThrow("exact workspace");
  const { workspace_name, ...i } = identityB;
  for (const input of [{ ...i, email: "ignored@example.invalid" }, { ...i, issuer: "https://evil.invalid" }]) expect(() => f.auth.bind({ identity: input, atlas_workspace_id: f.actor.workspace_id, principal_ids: [f.actor.id], expected_unbound: true })).toThrow();
  expect(() => f.auth.bind({ identity: i, atlas_workspace_id: f.actor.workspace_id, principal_ids: [f.actor.id], expected_unbound: false })).toThrow();
  expect(JSON.stringify(f.auth.inventory())).not.toContain("token_hash"); expect(JSON.stringify(f.auth.inventory())).not.toContain("grant_token");
});

test("two bound accounts isolate agent/private scopes and reject identifiers, writes and bearer fallback", async () => {
  const f = fixture(); f.bind(); f.bind(identityB, [f.builder.id]);
  const ca = await f.login(), cb = await f.login(identityB);
  const b: any = await (await f.req("/v1/memory/graph", cb, { agent_id: "builder" })).json();
  expect(b.data.nodes.some((n: any) => n.label === "Hidden Builder")).toBe(true); expect(b.data.edges.some((e: any) => e.scope === "agent:default")).toBe(false);
  for (const [c, wrong] of [[ca, "builder"], [cb, "default"]]) expect((await f.req("/v1/memory/graph", c, { agent_id: wrong })).status).toBe(403);
  expect((await f.req("/v1/memory/graph", ca, { agent_id: "default", scopes: ["user:alex", "agent:builder"] })).status).toBe(403);
  for (const field of ["workspace_id", "user_id"]) expect((await f.req("/v1/memory/graph", ca, { agent_id: "default", [field]: "forged" })).status).toBe(400);
  for (const path of ["/v1/events", "/v1/recall", "/v1/memory/agents", "/v1/memory/bind", "/v1/grants", "/v1/principals", "/v1/credentials/anything/revoke"]) expect((await f.req(path, ca, {})).status).toBe(403);
  expect((await f.req("/v1/status", ca)).status).toBe(403);
  for (const supplied of ["Bearer invalid", "", "Basic nonsense"]) expect((await f.req("/v1/memory/graph", ca, { agent_id: "default" }, "POST", { Authorization: supplied })).status).toBe(401);
  const machine = await f.req("/v1/memory/graph", ca, { agent_id: "builder" }, "POST", { Authorization: `Bearer ${f.builderKey.token}`, Origin: "https://unrelated.invalid" }); expect(machine.status).toBe(200);
  expect((await f.req("/v1/memory/graph", ca, { agent_id: "default" }, "POST", { Origin: "https://evil.invalid" })).status).toBe(403);
});

test("each request revalidates live exact identity; failures preserve 401/403/503 and fail closed", async () => {
  const f = fixture(); f.bind();
  for (const status of [503, 401, 403]) {
    f.state.status = 200; const c = await f.login(); f.state.status = status;
    const r = await f.req("/v1/memory/graph", c, { agent_id: "default" }); expect(r.status).toBe(status);
    expect(JSON.stringify(await r.json())).not.toContain("Mira");
    const s = f.store.one("SELECT * FROM browser_sessions WHERE token_hash=?", hash(c.split("=")[1]));
    expect(!!s.revoked_at).toBe(status !== 503); if (status !== 503) expect(s.grant_token).toBeNull();
  }
  f.state.status = 200; const c = await f.login();
  const start = f.state.calls.length;
  await f.req("/auth/session", c); await f.req("/v1/me", c); await f.req("/v1/memory/graph", c, { agent_id: "default" });
  expect(f.state.calls.slice(start).filter(c => c.url.endsWith("/identity"))).toHaveLength(3);
  for (const field of ["issuer", "company_id", "workspace_id", "location_id", "user_id"]) {
    const c = await f.login(); const grant = f.store.one("SELECT grant_token FROM browser_sessions WHERE token_hash=?", hash(c.split("=")[1])).grant_token;
    f.state.grants.set(grant, { ...identityA, [field]: "changed" });
    expect((await f.req("/auth/session", c)).status).toBe(403);
  }
  f.state.invalid = true; expect((await f.req("/auth/session", c)).status).toBe(503);
});

test("expiry is bounded, revalidation cannot extend it, and rotation/logout revoke hidden credentials", async () => {
  const f = fixture(); f.bind(); f.state.expiry = Date.now() + 60 * 86400_000;
  const c = await f.login(), h = hash(c.split("=")[1]);
  const s = f.store.one("SELECT * FROM browser_sessions WHERE token_hash=?", h);
  expect(s.expires_at - Date.now()).toBeWithin(30 * 86400_000 - 2000, 30 * 86400_000 + 1);
  await f.req("/v1/memory/graph", c, { agent_id: "default" });
  expect(f.store.one("SELECT expires_at FROM browser_sessions WHERE token_hash=?", h).expires_at).toBe(s.expires_at);
  const hidden = f.store.one("SELECT credential_id FROM browser_credentials WHERE session_hash=?", h);
  expect(hidden.credential_id).not.toBe(f.boot.credential_id);
  const c2 = await f.login(identityA, c);
  expect(f.store.one("SELECT revoked_at,grant_token FROM browser_sessions WHERE token_hash=?", h)).toMatchObject({ grant_token: null });
  expect(f.store.one("SELECT revoked_at FROM credentials WHERE id=?", hidden.credential_id).revoked_at).not.toBeNull();
  await f.req("/v1/memory/graph", c2, { agent_id: "default" });
  expect((await f.req("/auth/logout", c2, {}, "POST", { Origin: agents })).status).toBe(403);
  f.state.failLogout = true;
  const out = await f.req("/auth/logout", c2, {}); expect(out.status).toBe(200); expect(await out.json()).toEqual({ ok: true, creator_revocation: "unconfirmed" });
  expect(out.headers.getSetCookie().every(c => c.includes("Max-Age=0") && c.includes("Secure"))).toBe(true);
  expect((await (await f.req("/auth/session", c2)).json() as any).authenticated).toBe(false);
  await f.req("/auth/logout", c2, {}); expect(f.state.calls.filter(c => c.url.endsWith("/logout"))).toHaveLength(1);
  expect(f.store.one("SELECT revoked_at FROM credentials WHERE id=?", f.boot.credential_id).revoked_at).toBeNull();
  const c3 = await f.login(); f.store.run("UPDATE browser_sessions SET expires_at=0 WHERE token_hash=?", hash(c3.split("=")[1]));
  expect((await (await f.req("/auth/session", c3)).json() as any).authenticated).toBe(false);
  expect((await f.req("/v1/memory/graph", c3, { agent_id: "default" })).status).toBe(401);
});

test("mapping, grant, session revocation during awaits fence results and existing actors", async () => {
  const f = fixture(); f.bind();
  for (const kind of ["session", "mapping", "grant"]) {
    f.store.run("INSERT OR IGNORE INTO browser_agent_access VALUES(?,?)", browserIdentityKey(identityA), f.actor.id);
    f.store.run("INSERT OR IGNORE INTO memory_grants VALUES(?,?,?)", f.actor.id, "agent:default", "read");
    const c = await f.login();
    const session = await f.auth.session(new Request(origin, { headers: { Cookie: c } }));
    const actor = f.auth.actor(session!, "default");
    let release!: () => void, entered!: () => void;
    const ready = new Promise<void>(r => entered = r), gate = new Promise<void>(r => release = r);
    f.state.pause = async () => { entered(); await gate; };
    const pending = f.req("/v1/memory/graph", c, { agent_id: "default" }); await ready;
    if (kind === "session") f.auth.revoke(session!.token_hash);
    if (kind === "mapping") f.store.run("DELETE FROM browser_agent_access WHERE identity_key=?", session!.identity_key);
    if (kind === "grant") f.store.run("DELETE FROM memory_grants WHERE principal_id=? AND scope='agent:default' AND action='read'", f.actor.id);
    expect(() => f.store.active(actor)).toThrow();
    release(); const r = await pending; expect([401, 403]).toContain(r.status); expect(JSON.stringify(await r.json())).not.toContain("Mira");
    f.state.pause = null;
  }
});

test("streamed browser body uses fresh authority; agent lists reflect current read grants and account rows survive derived reset", async () => {
  const f = fixture(); f.bind(); const c = await f.login();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(s) { stream = s; s.enqueue(new TextEncoder().encode('{"agent_id":')); } });
  const pending = f.app.fetch(new Request(origin + "/v1/memory/graph", { method: "POST", headers: { Origin: origin, Cookie: c, "Content-Type": "application/json" }, body }));
  f.auth.revoke(hash(c.split("=")[1])); stream.enqueue(new TextEncoder().encode('"default"}')); stream.close();
  expect((await pending).status).toBe(401);
  expect(f.store.all("SELECT * FROM browser_credentials")).toHaveLength(0);
  const c2 = await f.login(); await f.req("/v1/memory/graph", c2, { agent_id: "default" });
  f.store.run("DELETE FROM memory_grants WHERE principal_id=? AND scope='agent:default' AND action='read'", f.actor.id);
  expect((await (await f.req("/auth/session", c2)).json() as any).agents).toEqual([]);
  const tables = ["browser_accounts", "browser_agent_access", "browser_sessions", "browser_credentials"];
  const before = tables.map(t => f.store.all(`SELECT * FROM ${t} ORDER BY rowid`));
  resetDerivedBrain(f.store, "RESET_DERIVED_BRAIN");
  expect(tables.map(t => f.store.all(`SELECT * FROM ${t} ORDER BY rowid`))).toEqual(before);
  expect((await f.app.fetch(new Request("https://untrusted.invalid/v1/me", { headers: { Cookie: c2, Origin: origin } }))).status).toBe(403);
});

test("logout cancels callback while exchange awaits; initialized hosted fast path installs additive schema without backfill", async () => {
  const f = fixture(); const t = await f.begin();
  let release!: () => void;
  const gate = new Promise<void>(r => release = r);
  f.app.browserAuth = new BrowserAuth(f.store, async () => { await gate; return Response.json({ grant_token: "cat_" + "Z".repeat(43), identity: identityA, expires_at: Date.now() + 60_000 }); });
  const pending = f.callback(t);
  await Promise.resolve(); await Promise.resolve();
  const cancelled = await f.req("/auth/logout", t.cookie, {}); expect(cancelled.status).toBe(200);
  release(); expect((await pending).status).toBe(401);
  const base = new Store(":memory:"); stores.push(base);
  base.db.exec("CREATE TABLE atlas_runtime_meta(singleton INTEGER PRIMARY KEY,schema_version INTEGER,serving_index_version INTEGER); INSERT INTO atlas_runtime_meta VALUES(1,2,1)");
  for (const name of ["browser_credentials", "browser_sessions", "browser_login_transactions", "browser_agent_access", "browser_accounts"]) base.db.exec(`DROP TABLE ${name}`);
  const statements: string[] = [];
  const adapter: SQLiteDatabase = { exec(sql) { statements.push(sql); return base.db.exec(sql); }, query: sql => base.db.query(sql), transaction: fn => base.db.transaction(fn), close() {} };
  const hosted = new Store("synthetic-hosted", adapter);
  expect(hosted.all("SELECT * FROM browser_sessions")).toEqual([]);
  expect(statements.some(s => s.includes("CREATE TABLE IF NOT EXISTS browser_sessions"))).toBe(true);
  expect(statements.some(s => s.includes("INSERT OR IGNORE INTO memory_roots") || s.includes("CREATE TABLE IF NOT EXISTS memory_events"))).toBe(false);
});
