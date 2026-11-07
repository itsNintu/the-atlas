import {chromium,expect} from '@playwright/test';
import {copyFileSync,writeFileSync} from 'node:fs';
import {Store,now} from '../../src/store.ts';
import {App} from '../../src/app.ts';
const dir='/home/alex/.local/share/the-atlas/source-probes/t_c3cd6ab0';
copyFileSync(dir+'/integration.sqlite',dir+'/browser.sqlite');const s=new Store(dir+'/browser.sqlite');
const e=s.one('SELECT principal_id FROM memory_events WHERE id=?','event_98ef9b91-196b-40fa-b6c2-1bf4844a6f22'),key=s.issueKey(e.principal_id);
const app=new App(s),server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:r=>app.fetch(r)}),browser=await chromium.launch({headless:true}),errors:string[]=[];
try{
 const page=await browser.newPage({viewport:{width:1500,height:1100}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.port}/brain`);await page.locator('#agent').fill('reaver');await page.locator('#token').fill(key.token);await page.locator('#login button').click();await expect(page.locator('#workspace')).toBeVisible();
 await page.locator('#query').fill('LDN7');await page.locator('#refresh').click();
 const reporting=page.locator('#relations [data-edge="memory_2a0ddab2-4d0d-4dfd-b064-adad79b97b94"]');await reporting.click();await expect(page.locator('#detail')).toContainText('active');await expect(page.locator('#detail')).toContainText('INVALIDATED PROCESSING DECISION');await expect(page.locator('#detail')).toContainText('not a domain state change');await expect(page.locator('#detail')).toContainText('user / alex');
 await page.screenshot({path:'evidence/claim-safe-repair/restored-reporting.png',fullPage:true});
 await page.locator('summary').click();await page.locator('#history').check();await page.locator('#relations [data-edge="memory_94163b5d-e2de-4cfe-950c-e2d56fac632b"]').click();await expect(page.locator('#detail')).toContainText('historical');await expect(page.locator('#detail')).toContainText('2026-11-07T00:00:00.000Z');await expect(page.locator('#detail')).toContainText('Unknown start');
 await page.screenshot({path:'evidence/claim-safe-repair/preserved-history.png',fullPage:true});
 if(errors.length)throw Error(errors.join('\n'));
 const result={at:now(),result:'pass',browser:browser.version(),method:'Actual Chromium with loopback HTTP App and isolated repaired exact-state copy; temporary key only in browser-copy DB, never production',checks:['direct typed reporting active with original-user sources','old closure rendered INVALIDATED PROCESSING DECISION, not later domain change','typed Nola remains positively historical at exact cutoff with unknown start'],errors,production_effects:false};
 writeFileSync('evidence/claim-safe-repair/BROWSER.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await browser.close();await server.stop(true);s.close()}
