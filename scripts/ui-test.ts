import { chromium, expect } from "@playwright/test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Store } from "../src/store.ts";
import { server, repo, report, request, waitJob } from "./runtime.ts";
import assert from "node:assert/strict";
const dir = mkdtempSync(join(repo, ".private-ui-")),
  db = join(dir, "ui.sqlite"),
  store = new Store(db);
const boot = store.bootstrap("Synthetic browser workspace");
store.close();
const live = await server(db),
  browser = await chromium.launch({ headless: true });
const errors: string[] = [],
  checks: string[] = [];
try {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(live.url);
  await expect(page).toHaveTitle("The Atlas · Evidence inspector");
  await expect(page.locator("h1")).toContainText("The Atlas");
  await expect(
    page.getByRole("heading", { name: "Connect your workspace" }),
  ).toBeVisible();
  await page.locator("#token").fill(boot.token);
  await page.locator("#login button").click();
  await expect(page.locator("#workspace")).toBeVisible();
  await expect(page.locator("#token")).toHaveValue("");
  checks.push(
    "Fresh browser authenticates using generated synthetic credential; input clears and no browser storage is used",
  );
  await page.locator("#project-form input").fill("Browser project");
  await page.locator("#project-form button").click();
  await expect(page.locator("#projects option")).toHaveCount(1);
  await page.locator("#space-form input").fill("Browser shared");
  await page.locator("#space-form button").click();
  await expect(page.locator("#ingest-space option")).toHaveCount(1);
  await page.locator("#ingest-form button").click();
  await expect(page.locator("#sources .row")).toHaveCount(1);
  const queued = JSON.parse(await page.locator("#result").innerText());
  assert(queued.job_id);
  await waitJob(live.url, boot.token, queued.job_id);
  await page.locator("#context-form input[name=query]").fill("Mira");
  await page.locator("#context-form button").click();
  await expect(page.locator("#context-output")).toContainText("Lisbon");
  checks.push(
    "UI creates project and space, ingests a real source, inspects durable jobs, retrieves source-linked context",
  );
  await page.locator("#sources button").click();
  await expect(page.locator("#source-output")).toContainText(
    "Mira lives in Lisbon.",
  );
  const correction = JSON.parse(
    await page.locator("#correction-json").inputValue(),
  );
  correction.payload = "Mira lives in Porto.";
  correction.assertions[0].object = "Porto";
  await page.locator("#correction-json").fill(JSON.stringify(correction));
  await page
    .locator(
      "#correction-form button[type=submit], #correction-form button:not([type])",
    )
    .first()
    .click();
  await expect
    .poll(async () => {
      const r = await request(live.url, boot.token, "GET", "/v1/jobs");
      return r.body.data.filter((j: any) => j.status === "succeeded").length;
    })
    .toBe(2);
  await page.locator("#context-form button").click();
  await expect(page.locator("#context-output")).toContainText("Porto");
  page.once("dialog", (d) => d.accept());
  await page.locator("#forget").click();
  await expect(page.locator("#sources")).toContainText("forgotten");
  await page.locator("#context-form button").click();
  await expect(page.locator("#context-output")).toContainText('"facts": []');
  checks.push(
    "Browser correction and forgetting update actual API data and remove unsupported context",
  );
  const stored = await page.evaluate(() => ({
    local: localStorage.length,
    session: sessionStorage.length,
    cookies: document.cookie,
  }));
  assert.deepEqual(stored, { local: 0, session: 0, cookies: "" });
  mkdirSync(join(repo, "reports"), { recursive: true });
  await page.screenshot({
    path: join(repo, "reports/ui-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(repo, "reports/ui-mobile.png"),
    fullPage: true,
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.reload();
  await expect(page.locator("#connect")).toBeVisible();
  await expect(page.locator("#workspace")).toBeHidden();
  assert.deepEqual(errors, []);
  checks.push(
    "Desktop/mobile rendering has no page errors or horizontal overflow; reload disconnects",
  );
  const result = {
    run_at: new Date().toISOString(),
    result: "pass",
    checks,
    page_errors: errors,
    browser: browser.version(),
    synthetic_data_only: true,
  };
  await report("ui.json", result);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  live.proc.kill("SIGTERM");
  await live.proc.exited;
  rmSync(dir, { recursive: true, force: true });
}
