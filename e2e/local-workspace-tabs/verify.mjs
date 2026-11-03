import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { startFixture } from '../local-inbound-workflow/server.mjs';

const output = 'node_modules/.cache/workspace-tabs-browser';
await mkdir(output, { recursive: true });
const server = process.env.WORKSPACE_TABS_SERVER ? {close:async()=>{}} : await startFixture(4195, '/e2e/local-workspace-tabs/fixture.tsx');
const browser = await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page = await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
page.setDefaultTimeout(15000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
const active = () => page.locator('[data-workspace-active="true"][role="tabpanel"]');
const tab = name => page.getByRole('tab', {name,exact:false});
const newWorkspace = async name => { const before=await page.getByRole('tab').count(); const previous=await active().getAttribute('data-workspace-id'); await page.getByRole('button',{name:'New workspace',exact:true}).click(); await page.getByRole('menuitem',{name,exact:true}).click(); await expect(page.getByRole('tab')).toHaveCount(before+1); await expect(active()).not.toHaveAttribute('data-workspace-id',previous); await page.keyboard.press('Escape'); };
const navigate = async path => page.evaluate(path => window.__workspaceNavigate(path), path);
try {
  await page.goto('http://127.0.0.1:4195/orders/new',{waitUntil:'domcontentloaded',timeout:90000});
  await expect(active().getByTestId('order-entry-workspace')).toBeVisible({timeout:60000}); await page.keyboard.press('Escape');
  console.log('Browser: New Order mounted');
  const aId = await active().getAttribute('data-workspace-id');
  const a = page.locator(`[data-workspace-id="${aId}"]`);
  await a.getByLabel('PO #',{exact:true}).fill('ORDER-A-UNSAVED');
  if (await a.getByRole('combobox').filter({hasText:'Search customers...'}).getAttribute('aria-expanded') !== 'true') await a.getByRole('combobox').filter({hasText:'Search customers...'}).click();
  await a.getByText('Synthetic buyer',{exact:true}).last().click();
  await a.getByRole('combobox',{name:'Add Product'}).click(); await a.getByText('Yard Signs 24x18',{exact:true}).last().click();
  await a.getByRole('textbox',{name:'Quantity',exact:true}).fill('28'); await a.getByRole('textbox',{name:'Quantity',exact:true}).blur();
  console.log('Browser: customer/product/quantity selected');
  const sides = a.getByRole('combobox').filter({hasText:'Single Sided 4/0'}); await sides.click(); await a.getByText('Double Sided 4/4',{exact:true}).last().click();
  const pricing = a.getByTestId('order-line-pricing-row');
  await pricing.getByRole('button',{name:'$164.92',exact:true}).click(); await pricing.getByRole('textbox').last().fill('165.00'); await pricing.getByRole('textbox').last().blur();
  console.log('Browser: PBV2/pricing entered');
  // Stage a synthetic attachment through the real upload controls. No remote object is written.
  await page.evaluate(() => {
    const previous = window.fetch.bind(window); let latest;
    window.fetch = async (input,init) => {
      const path = new URL(typeof input==='string'?input:input.url,location.origin).pathname;
      const response = data => new Response(JSON.stringify({success:true,data}),{status:200,headers:{'Content-Type':'application/json'}});
      if(path==='/api/uploads/init') { latest=crypto.randomUUID(); return response({uploadId:latest,chunkSizeBytes:8388608,totalChunks:1}); }
      if(/\/api\/uploads\/.+\/chunks\//.test(path))return response({received:true});
      if(/\/api\/uploads\/.+\/finalize/.test(path))return response({fileId:latest});
      return previous(input,init);
    };
  });
  await a.locator('input[type=file]').first().setInputFiles({name:'tab-artwork.png',mimeType:'image/png',buffer:Buffer.from('synthetic attachment fixture')});
  await expect(a.getByTestId('staged-artwork-allocation')).toContainText('tab-artwork.png');
  await a.evaluate(node=>{node.scrollTop=500;node.dispatchEvent(new Event('scroll'));}); const scroll=await a.evaluate(node=>node.scrollTop);
  console.log('Browser: artwork staged');
  await newWorkspace('New Order'); const bId=await active().getAttribute('data-workspace-id'); const b=page.locator(`[data-workspace-id="${bId}"]`);
  expect(bId).not.toBe(aId); await expect(b.getByLabel('PO #',{exact:true})).toHaveValue('');
  await b.getByLabel('PO #',{exact:true}).fill('ORDER-B-UNSAVED');
  if (await b.getByRole('combobox').filter({hasText:'Search customers...'}).getAttribute('aria-expanded') !== 'true') await b.getByRole('combobox').filter({hasText:'Search customers...'}).click();
  await b.getByText('Synthetic buyer',{exact:true}).last().click();
  await b.getByRole('combobox',{name:'Add Product'}).click(); await b.getByText('Coroplast Custom',{exact:true}).last().click();
  await b.getByLabel('Width',{exact:true}).fill('7'); await b.getByLabel('Height',{exact:true}).fill('8');
  await b.getByRole('textbox',{name:'Quantity',exact:true}).fill('3'); await b.getByRole('textbox',{name:'Quantity',exact:true}).blur();
  await tab('New Order 1').click(); await expect(a.getByLabel('PO #',{exact:true})).toHaveValue('ORDER-A-UNSAVED');
  await expect(a.getByRole('textbox',{name:'Quantity',exact:true})).toHaveValue('28'); await expect(pricing).toContainText('$165.00');
  await expect(a.getByRole('combobox').filter({hasText:'Double Sided 4/4'})).toBeVisible();
  await expect(a.getByTestId('staged-artwork-allocation')).toContainText('tab-artwork.png'); expect(await a.evaluate(node=>node.scrollTop)).toBe(scroll);
  console.log('Browser: two orders retain state');
  await newWorkspace('New Quote'); const quoteId=await active().getAttribute('data-workspace-id'); const quote=page.locator(`[data-workspace-id="${quoteId}"]`);
  const quoteJob=quote.getByPlaceholder('Job name or reference',{exact:true}); await quoteJob.fill('Independent quote');
  await tab('New Order 1').click(); await tab('New Quote 1').click(); await expect(quoteJob).toHaveValue('Independent quote');
  // Back/Forward return to retained instances, including two identical /orders/new URLs.
  await page.goBack(); await expect(a).toBeVisible(); await page.goForward(); await expect(quote).toBeVisible();
  console.log('Browser: quote/history passed');
  await page.getByRole('button',{name:'Existing Order A',exact:true}).click(); await expect(tab('Order QA-ORDER-A')).toBeVisible();
  const existingId=await active().getAttribute('data-workspace-id');
  await page.getByRole('button',{name:'Existing Order B',exact:true}).click(); await expect(tab('Order QA-ORDER-B')).toBeVisible();
  await page.getByRole('button',{name:'Existing Order A',exact:true}).click(); await expect(active()).toHaveAttribute('data-workspace-id',existingId);
  await page.getByRole('button',{name:'Customer',exact:true}).click(); await expect(tab('Synthetic buyer')).toBeVisible();
  await active().getByRole('button',{name:'Edit Company',exact:true}).click(); await page.getByLabel('Company Name *',{exact:true}).fill('Retained company edit');
  await navigate('/orders/existing-a'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await navigate('/customers/00000000-0000-4000-8000-000000000004'); await expect(page.getByLabel('Company Name *',{exact:true})).toHaveValue('Retained company edit');
  await page.keyboard.press('Escape');
  await tab('New Order 1').click();
  page.once('dialog',dialog=>dialog.dismiss()); await page.getByRole('button',{name:'Close New Order 1',exact:true}).click(); await expect(a).toBeVisible();
  await expect(a.getByLabel('PO #',{exact:true})).toHaveValue('ORDER-A-UNSAVED');
  page.once('dialog',dialog=>dialog.accept()); await page.getByRole('button',{name:'Close New Order 2',exact:true}).click(); await expect(b).toHaveCount(0);
  // A failed canonical submission retains the original tab and every edited value.
  await a.getByRole('button',{name:'Create Order',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__fixtureState().directOrderAttempts)).toBe(1);
  await expect(a.getByRole('textbox',{name:'Quantity',exact:true})).toHaveValue('28'); await expect(pricing).toContainText('$165.00');
  for(const theme of ['Light','Dark']) {
    await page.getByRole('button',{name:theme,exact:true}).click(); await tab('New Order 1').focus(); await expect(tab('New Order 1')).toBeFocused();
    await page.screenshot({path:`${output}/${theme.toLowerCase()}.png`,fullPage:false});
  }
  // Confirm canonical creation adopts this same tab and updates its saved label.
  const countBeforeSave=await page.getByRole('tab').count();
  await a.getByRole('button',{name:'Create Order',exact:true}).click();
  await expect(tab('Order QA-DIRECT-1')).toBeVisible();
  await expect(active()).toHaveAttribute('data-workspace-id',aId);
  await expect(page.getByRole('tab')).toHaveCount(countBeforeSave);
  const readback=await page.evaluate(async()=>await(await fetch('/api/orders/qa-direct-order')).json());
  expect(readback.lineItems[0].quantity).toBe(28);expect(readback.lineItems[0].totalPrice).toBe(165);
  expect(readback.lineItems[0].pendingOrderAttachmentUploadIds).toHaveLength(1);
  await page.setViewportSize({width:1050,height:800});
  // Grow the bar beyond its viewport and verify one-row internal scrolling.
  for(let i=0;i<4;i++) await newWorkspace('New Order');
  const bar=page.getByRole('tablist',{name:'Open workspaces'});
  expect(await bar.evaluate(node=>node.scrollWidth>node.clientWidth)).toBe(true);
  expect(await page.getByTestId('workspace-tab-bar').evaluate(node=>node.getBoundingClientRect().height)).toBe(36);
  await page.screenshot({path:`${output}/narrow.png`,fullPage:false});
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>/workspace.*draft|unsaved/i.test(key)))).toEqual([]);
  // Browser refresh is explicitly destructive only after its native unsaved warning is accepted.
  page.once('dialog',dialog=>dialog.accept()); await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.getByRole('tab')).toHaveCount(1); await expect(active().getByLabel('PO #',{exact:true})).toHaveValue('');
  expect(errors).toEqual([]);
  console.log('PASS: actual tab manager + real New Order, Quote, Order Detail and Customer editors; independent PBV2/dimensions/quantity/$165/artwork, modal retention, record reuse, dirty close, failed-save retention, successful save/tab adoption and synthetic readback, history, refresh warning, light/dark and narrow horizontal tabs. HTTP/storage/persistence mocked; no live records changed.');
} catch(error) { await page.screenshot({path:output+'/failure.png',fullPage:false}); console.error('PAGE ERRORS',errors); throw error; }
finally {await browser.close();await server.close();}
