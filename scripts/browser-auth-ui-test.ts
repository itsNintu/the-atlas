import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app.ts";
import { BrowserAuth, type CreatorIdentity } from "../src/browser-auth.ts";
import { Store } from "../src/store.ts";
import { brainFixture, seedBrain } from "./brain-fixture.ts";

// Synthetic on-disk HTTP browser test. Only the broker fetch is injected; the
// test server translates its loopback audience to Atlas's FIXED production URL.
// No production identity, provider, credential, external request or claim.
const repo = join(import.meta.dir, ".."), out = join(repo, ".private/browser-auth");
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(out, "ui-"));
const f = brainFixture(new Store(join(dir, "fixture.sqlite"))); seedBrain(f);
const app = new App(f.store); app.memory = f.memory;
const publicOrigin = "https://atlas.creator.gg";
const owner: CreatorIdentity = { issuer: "https://platform.creator.gg", company_id: "synthetic-company", workspace_id: "synthetic-workspace", location_id: "synthetic-location", user_id: "synthetic-owner", workspace_name: "Synthetic Workspace" };
let next = owner, counter = 0;
const grants = new Map<string, CreatorIdentity>();
app.browserAuth = new BrowserAuth(f.store, async (url, init) => {
  assert(url.startsWith("https://colorless-mongoose-693.convex.site/atlas/"));
  if (url.endsWith("/logout")) return Response.json({ ok: true });
  let who;
  if (url.endsWith("/exchange")) {
    const token = "cat_" + String(++counter).padStart(43, "0"); grants.set(token, next);
    return Response.json({ identity: next, grant_token: token, expires_at: Date.now() + 3600_000 });
  }
  who = grants.get(new Headers(init.headers).get("authorization")!.slice(7));
  return Response.json({ identity: who, expires_at: Date.now() + 3600_000 });
});
const { workspace_name, ...identity } = owner;
app.browserAuth.bind({ identity, atlas_workspace_id: f.actor.workspace_id, principal_ids: [f.actor.id, f.builder.id], expected_unbound: true });
let localOrigin = "";
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(r) {
  const u = new URL(r.url), headers = new Headers(r.headers);
  if (headers.get("origin") === localOrigin) headers.set("origin", publicOrigin);
  return app.fetch(new Request(publicOrigin + u.pathname + u.search, { method: r.method, headers,
    ...(!["GET", "HEAD"].includes(r.method) ? { body: await r.arrayBuffer() } : {}) }));
} });
localOrigin = `http://localhost:${server.port}`;
const browser = await chromium.launch({ headless: true });
const checks: string[] = [], errors: string[] = [], requests: { agent: string; authorization: string | undefined }[] = [];
try {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const page = await context.newPage(); page.on("pageerror", e => errors.push(e.message));
  page.on("request", r => { if (new URL(r.url()).pathname === "/v1/memory/graph") requests.push({ agent: r.postDataJSON().agent_id, authorization: r.headers().authorization }); });
  async function signIn(who: CreatorIdentity) {
    next = who;
    const start = await app.fetch(new Request(publicOrigin + "/auth/login"));
    const txnCookie = start.headers.getSetCookie()[0].split(";")[0], state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const callback = await app.fetch(new Request(publicOrigin + "/auth/callback", { method: "POST", headers: { Origin: "https://agents.creator.gg", Cookie: txnCookie, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ state, ticket: "caticket_" + "S".repeat(43) }) }));
    assert.equal(callback.status, 303);
    const value = callback.headers.getSetCookie().find(c => c.startsWith("__Host-atlas_session="))!.split(";")[0].split("=")[1];
    // Chromium treats loopback as trustworthy; production flags remain intact.
    await context.addCookies([{ name: "__Host-atlas_session", value, domain: "localhost", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
  }
  await page.goto(localOrigin + "/brain");
  await expect(page.locator("#creator-login")).toHaveText("Sign in with Creator Labs");
  await expect(page.locator("#creator-login")).toHaveAttribute("href", "/auth/login");
  await expect(page.locator("#machine-connection")).not.toHaveAttribute("open", "");
  await signIn(owner); await page.reload();
  await expect(page.locator("#account-name")).toContainText("Synthetic Workspace / synthetic-owner");
  await expect(page.locator("#agents option")).toHaveCount(2);
  await expect(page.locator("#relations")).toContainText("Hidden Builder"); // first agent sorted: builder
  await page.locator("#query").fill("Hidden"); await page.locator("#refresh").click();
  await page.locator("#agents").selectOption("default");
  await expect(page.locator("#relations .relation")).toHaveCount(8);
  await expect(page.locator("#query")).toHaveValue("");
  await expect(page.locator("#relations")).not.toContainText("Hidden Builder");
  assert(requests.every(r => !r.authorization)); assert(requests.some(r => r.agent === "default"));
  assert.equal(await page.evaluate(() => document.cookie), "");
  assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
  checks.push("Creator primary entry, HttpOnly session auto-restore, actual account and authorized agents; graph fetch uses cookies without bearer; switch clears prior agent scope/query/data");
  await page.screenshot({ path: join(out, "human-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(out, "human-mobile.png"), fullPage: true });
  await page.reload(); await expect(page.locator("#workspace")).toBeVisible();
  await page.locator("#disconnect").click(); await expect(page.locator("#connect")).toBeVisible();
  await page.reload(); await expect(page.locator("#connect")).toBeVisible(); await expect(page.locator("#workspace")).toBeHidden();
  assert.equal((await context.cookies()).filter(c => c.name === "__Host-atlas_session").length, 0);
  checks.push("Refresh restores the session; sign-out clears graph and server cookie, and refresh stays signed out; desktop/mobile have no overflow");
  await signIn({ ...owner, user_id: "synthetic-new-user", workspace_name: "Synthetic New Account" });
  const priorReads = requests.length; await page.reload();
  await expect(page.locator("#onboarding")).toBeVisible();
  await expect(page.locator("#onboarding")).toContainText("Your Atlas is ready.");
  await expect(page.locator("#onboarding")).toContainText("No agents are connected to this account yet.");
  await expect(page.locator("#workspace")).toBeHidden();
  assert.equal(requests.length, priorReads); assert.equal(await page.locator("#scene .node").count(), 0);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(out, "human-onboarding.png"), fullPage: true });
  checks.push("New distinct account gets empty onboarding with Platform link and no owner/default graph request");
  assert.deepEqual(errors, []);
  const result = { result: "pass", synthetic_only: true, real_creator_identity_proof: false, checks, page_errors: errors };
  await Bun.write(join(out, "ui.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); await server.stop(true); f.store.close(); rmSync(dir, { recursive: true, force: true }); }
