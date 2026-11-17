import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { App } from '../src/app.ts';
import { BrowserAuth } from '../src/browser-auth.ts';
import { brainFixture, seedBrain } from './brain-fixture.ts';
const f=brainFixture();seedBrain(f);
const app=new App(f.store);app.memory=f.memory;
let exchanges=0;
const identity={issuer:'https://platform.creator.gg',company_id:'synthetic-company',workspace_id:'synthetic-workspace',location_id:'synthetic-location',user_id:'synthetic-owner',workspace_name:'Synthetic Workspace'};
app.browserAuth=new BrowserAuth(f.store,async url=>{
 if(url.endsWith('/exchange'))exchanges++;
 return Response.json({identity,grant_token:'cat_'+'x'.repeat(43),expires_at:Date.now()+3600_000});
});
const {workspace_name,...tuple}=identity;
app.browserAuth.bind({identity:tuple,atlas_workspace_id:f.actor.workspace_id,principal_ids:[f.actor.id],expected_unbound:true});
const browser=await chromium.launch({headless:true});
const out=new URL('../.private/callback-ui/',import.meta.url);mkdirSync(out,{recursive:true});
const errors:string[]=[];const checks:string[]=[];
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('status of 400'))errors.push(m.text());});
 await page.route('**/*',async route=>{
  const r=route.request(),u=new URL(r.url());
  if(u.origin==='https://agents.creator.gg'){
   const state=u.searchParams.get('state')??'a'.repeat(64);
   return route.fulfill({contentType:'text/html',headers:{'Referrer-Policy':'strict-origin'},body:`<form method="post" action="https://atlas.creator.gg/auth/callback"><input name="state" value="${state}"><input name="ticket" value="caticket_${'x'.repeat(43)}"><button>Continue</button></form>`});
  }
  const response=await app.fetch(new Request(r.url(),{method:r.method(),headers:await r.allHeaders(),...(r.postData()?{body:r.postData()}: {})}));
  const headers:Record<string,string>={};response.headers.forEach((value,key)=>{headers[key]=value;});const cookies=response.headers.getSetCookie();
  if(cookies.length)headers['set-cookie']=cookies.join('\n');
  // Playwright redirects keep the original route handler only for the first
  // URL. Make each synthetic redirect a new navigation so it cannot escape to
  // the real broker; this test never uses production credentials or providers.
  if(response.status===303){
   const destination=new URL(response.headers.get('location')!,r.url()).href;
   delete headers.location;delete headers['content-security-policy'];headers['content-type']='text/html';
   return route.fulfill({status:200,headers,body:`<script>location.replace(${JSON.stringify(destination)})</script>`});
  }
  await route.fulfill({status:response.status,headers,body:await response.text()});
 });
 // Missing browser transaction: exact validation failure class, no exchange.
 await page.goto('https://agents.creator.gg/fixture');await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.getByRole('heading')).toHaveText('Let’s get you back to Atlas');
 await expect(page.locator('small')).toContainText('invalid_login_cookie');assert.equal(exchanges,0);
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:new URL(`recovery-${width}.png`,out).pathname,fullPage:true});
 }
 await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Return to Atlas',exact:true})).toBeFocused();
 await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Start a new sign-in',exact:true})).toBeFocused();
 checks.push('missing transaction safely denied before exchange; recoverable HTML; desktop/390/320 layout and keyboard');
 await page.getByRole('link',{name:'Start a new sign-in',exact:true}).click();
 await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.locator('#account-name')).toContainText('synthetic-owner');
 await expect(page.locator('#agents option')).toHaveCount(1);assert.equal(exchanges,1);
 checks.push('recovery starts a new cookie-bound transaction and manual callback reaches existing authorized synthetic brain once');
 const result={result:'pass',synthetic_only:true,checks,exchanges,page_errors:errors};assert.deepEqual(errors,[]);
 await Bun.write(new URL('result.json',out),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();f.store.close();}
