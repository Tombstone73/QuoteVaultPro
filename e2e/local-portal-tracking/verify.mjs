import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
const root=process.cwd();
const server=await createServer({configFile:false,envFile:false,root,plugins:[react(),{name:'tracking-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.startsWith('/portal/orders')){res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<html><head><title>Synthetic Portal Tracking QA</title></head><body><div id="root"></div><script type="module" src="/e2e/local-portal-tracking/fixture.tsx"></script></body></html>'));return;} next();
});}}],resolve:{alias:{'@':path.join(root,'client/src'),'@shared':path.join(root,'shared'),'@assets':path.join(root,'attached_assets')}},server:{host:'127.0.0.1',port:4192,strictPort:true}});
await server.listen();
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
  await mkdir('node_modules/.cache/portal-tracking',{recursive:true});
  for(const theme of ['light','dark']) for(const width of [1440,390]){
    const page=await browser.newPage({viewport:{width,height:900},deviceScaleFactor:1});
    page.setDefaultTimeout(60_000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:4192/portal/orders?theme=${theme}`,{waitUntil:'domcontentloaded',timeout:60_000});
    await expect(page.getByRole('heading',{name:'Orders',exact:true})).toBeVisible();
    await expect(page.getByText('1Z1234567890123456',{exact:true})).toBeVisible();
    await expect(page.getByText('Carrier: Delivery Exception',{exact:true})).toBeVisible();
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw new Error('Orders list horizontal overflow');
    await page.screenshot({path:`node_modules/.cache/portal-tracking/list-${theme}-${width}.png`,fullPage:true});
    await page.getByRole('link',{name:'View order',exact:true}).click();
    const header=page.getByTestId('portal-order-header-tracking');
    await expect(header.getByText('1Z1234567890123456',{exact:true})).toBeVisible();
    const box=await header.boundingBox();if(!box||box.y+box.height>900) throw new Error('Tracking below initial viewport');
    await expect(page.getByText('Last carrier update:',{exact:false}).first()).toBeVisible();
    const copy=header.getByRole('button',{name:'Copy tracking number 1Z1234567890123456',exact:true});await copy.focus();
    if(!await copy.evaluate(el=>el===document.activeElement)) throw new Error('Copy not keyboard focusable');
    const links=await page.locator('[aria-label="Shipment tracking"] a').all();for(const link of links){if(!(await link.getAttribute('href')).startsWith('https://www.')) throw new Error('Untrusted link');}
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw new Error('Detail horizontal overflow');
    await page.screenshot({path:`node_modules/.cache/portal-tracking/detail-${theme}-${width}.png`,fullPage:true});
    if(errors.length) throw new Error(errors.join('\n'));await page.close();
  }
  console.log('Portal tracking browser checks passed: desktop/mobile, light/dark, list/header/summary, safe links, keyboard focus. API data mocked; no persistence or live carrier calls.');
}finally{await browser.close();await server.close();}
