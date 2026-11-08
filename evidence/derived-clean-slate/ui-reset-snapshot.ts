import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

const out = "/home/alex/work/projects/the-atlas/evidence/derived-clean-slate";
const activation = JSON.parse(readFileSync(`${out}/activation.json`, "utf8"));
const resetAt = activation.reset.reset_at;
const credential = JSON.parse(readFileSync("/mnt/c/Users/alexb/AppData/Local/hermes/atlas/credential.json", "utf8"));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto("http://127.0.0.1:8787/brain", { waitUntil: "networkidle" });
  await page.locator("#token").fill(credential.token);
  await page.locator("#agent").fill("default");
  await page.locator("#login button").click();
  await page.locator("#workspace").waitFor({ state: "visible" });
  await page.locator("details summary").click();
  await page.locator("#valid").fill(resetAt);
  await page.locator("#recorded").fill(resetAt);
  await page.locator("#history").check();
  await page.locator("#refresh").click();
  await page.waitForFunction(() => document.querySelector("#counts")?.textContent?.includes("nodes /"));
  const counts = (await page.locator("#counts").textContent())?.trim();
  if (counts !== "0 nodes / 0 relationships") throw new Error(`Unexpected reset graph UI counts: ${counts}`);
  if (await page.locator(".node").count()) throw new Error("Reset graph UI contains a node");
  if (!(await page.locator("#empty").isVisible())) throw new Error("Reset graph empty state is not visible");
  const status = (await page.locator("#status").textContent())?.trim();
  await page.screenshot({ path: `${out}/graph-reset-snapshot.png`, fullPage: true });
  const result = { result: "pass", reset_at: resetAt, counts, status, node_elements: 0, empty_state_visible: true, screenshot: `${out}/graph-reset-snapshot.png` };
  writeFileSync(`${out}/ui-reset-snapshot.json`, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
