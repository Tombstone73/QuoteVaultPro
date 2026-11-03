import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';

// Reuse the existing synthetic proof fixture; no operational API or DB connection.
const snapshot = JSON.parse(await readFile('node_modules/.cache/proof-browser-data.json', 'utf8'));
const frontend = 'http://127.0.0.1:4198', api = 'http://127.0.0.1:4199';
process.env.PROOF_FIXTURE_API_ORIGIN = api;
let denied = false;
const accessed = [];
const backend = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', frontend); res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.end(); return; }
  if (req.url.endsWith('/file/content')) {
    accessed.push({ url: req.url, cookie: Boolean(req.headers.cookie?.includes('synthetic-proof-session=allowed')) });
    if (denied || !req.headers.cookie?.includes('synthetic-proof-session=allowed')) {
      res.statusCode = 403; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({error:'Forbidden'})); return;
    }
  }
  const upstream = await fetch(`${frontend}${req.url}`);
  res.statusCode = upstream.status; res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
  res.end(Buffer.from(await upstream.arrayBuffer()));
});
await new Promise(resolve => backend.listen(4199, '127.0.0.1', resolve));
const { server } = await import('./server.mjs');
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const context = await browser.newContext({ viewport:{width:1440,height:1000},deviceScaleFactor:1 });
await context.addCookies([{name:'synthetic-proof-session', value:'allowed',url:frontend,httpOnly:true,sameSite:'Lax'}]);
const page = await context.newPage(); const errors=[]; page.on('pageerror',error=>errors.push(error.message));
let sent;
await page.route('**/api/proofing/versions/*/send', async route => {
  sent = {url:route.request().url(),body:route.request().postDataJSON()};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true,data:{}})});
});
try {
  await page.goto(`${frontend}/production/proofing?lineItemId=${snapshot.detail.lineItemId}`, {waitUntil:'domcontentloaded',timeout:90000});
  await expect(page.locator('iframe').first()).toHaveAttribute('src',/^blob:/,{timeout:60000});
  await expect(page.getByRole('button',{name:'Send this draft',exact:true})).toBeEnabled({timeout:30000});
  await page.getByRole('button',{name:'Send this draft',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Send Proof for Review'});
  const version=snapshot.detail.currentActionableProofVersion;
  await expect(dialog).toContainText(`Version ${version.versionNumber}`);
  await expect(dialog.locator('[data-proof-version-id]')).toHaveAttribute('data-proof-version-id',version.id);
  await expect(dialog.getByAltText('Proof thumbnail')).toHaveAttribute('src',/^data:image\/png;base64,/);
  expect(await dialog.getByAltText('Proof thumbnail').evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  await expect(dialog.getByLabel('Send to email(s)')).toHaveValue('proof@example.test');
  const popupPromise=page.waitForEvent('popup'); await dialog.getByRole('button',{name:'Open / Download'}).click();
  const popup=await popupPromise; await expect.poll(()=>popup.url()).toMatch(/^blob:/);
  const blobUrl=popup.url();
  const openedBytes=await page.evaluate(async url=>Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())),blobUrl);
  expect(Buffer.from(openedBytes)).toEqual(Buffer.from(snapshot.pdf,'base64'));
  const downloadPromise=page.waitForEvent('download');
  await page.evaluate(url=>{const a=document.createElement('a');a.href=url;a.download='synthetic-proof.pdf';a.click();},blobUrl);
  const download=await downloadPromise; expect(await download.failure()).toBeNull(); await popup.close();
  expect(accessed.length).toBeGreaterThanOrEqual(2); expect(accessed.every(request=>request.cookie)).toBe(true);
  denied=true;
  await dialog.getByRole('button',{name:'Open / Download'}).click();
  await expect(dialog.getByRole('alert')).toContainText('permission'); denied=false;
  for(const theme of ['Light','Dark']) {
    // Theme buttons live behind the modal; close/reopen through the normal confirmation flow.
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.getByRole('button',{name:`${theme} theme`,exact:true}).click();
    await page.getByRole('button',{name:'Send this draft',exact:true}).click();
    await dialog.getByRole('button',{name:'Open / Download'}).focus();
    await expect(dialog.getByRole('button',{name:'Open / Download'})).toBeFocused();
    await mkdir('node_modules/.cache/proof-send-browser',{recursive:true});
    await page.screenshot({path:`node_modules/.cache/proof-send-browser/${theme.toLowerCase()}.png`,fullPage:true,animations:'disabled'});
  }
  await dialog.getByRole('button',{name:'Send proof',exact:true}).click();
  await expect.poll(()=>sent?.url).toContain(`/api/proofing/versions/${version.id}/send`);
  expect(sent.body.sentToEmail).toBe('proof@example.test');
  await page.getByRole('button',{name:'Send this draft',exact:true}).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Simulate missing file',exact:true}).click();
  await expect(page.getByText('Proof file unavailable',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Send this draft',exact:true})).toBeDisabled();
  if(errors.length)throw new Error(errors.join('\n'));
  console.log('PASS: main PDF viewer, authenticated dialog thumbnail, cross-origin credentialed PDF read/download bytes, denied access, recipient preservation, exact send version, missing file, keyboard focus, light/dark. HTTP persistence/send mocked; no live records changed.');
} finally { await browser.close(); await server.close(); await new Promise(resolve=>backend.close(resolve)); }
