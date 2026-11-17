// Real browser regression for form-POST Origin (all requests intercepted).
// The broker must not use no-referrer on its cross-origin callback form: that
// serializes Origin as null in Chromium. strict-origin retains the exact
// broker origin and discloses no path/query, ticket or provider credential.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const results: { policy: string; origin: string | null; referer: string | null }[] = [];
  for (const policy of ['no-referrer', 'strict-origin']) {
    await page.route('https://agents.creator.gg/api/atlas/fixture', route => route.fulfill({
      status: 200, contentType: 'text/html', headers: { 'Referrer-Policy': policy },
      body: '<form method="post" action="https://atlas.creator.gg/auth/fixture"><input name="synthetic" value="fixture"><button>Continue</button></form>',
    }));
    await page.route('https://atlas.creator.gg/auth/fixture', async route => {
      const h = route.request().headers();
      results.push({ policy, origin: h.origin ?? null, referer: h.referer ?? null });
      await route.fulfill({ status: 200, body: 'Synthetic callback received' });
    });
    await page.goto('https://agents.creator.gg/api/atlas/fixture');
    await Promise.all([page.waitForURL('https://atlas.creator.gg/auth/fixture'), page.locator('button').click()]);
    await page.unrouteAll();
  }
  assert.deepEqual(results, [
    { policy: 'no-referrer', origin: 'null', referer: null },
    { policy: 'strict-origin', origin: 'https://agents.creator.gg', referer: 'https://agents.creator.gg/' },
  ]);
  console.log(JSON.stringify({ checks: 'Cross-origin POST preserves exact broker Origin with no path/query credentials', results }));
} finally { await browser.close(); }
