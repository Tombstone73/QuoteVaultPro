import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { startFixture } from '../local-inbound-workflow/server.mjs';

const server = await startFixture(4194);
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const workspace = id => page.locator(`[data-workspace-id="${id}"]`);
const switchTo = async id => { await page.evaluate(id => window.__workspaceSwitch(id), id); await expect(workspace(id)).toBeVisible(); };
try {
  await page.goto('http://127.0.0.1:4194/orders/new?workspace-isolation=1', { waitUntil: 'domcontentloaded', timeout:90000 });
  const a = workspace('order-a'), b = workspace('order-b'), quote = workspace('quote'), customer = workspace('customer');
  await expect(a.getByTestId('order-entry-workspace')).toBeVisible({timeout:60000});
  // Close the normal initial customer focus popover, then enter independent business fields.
  await page.keyboard.press('Escape');
  await a.getByLabel('PO #', {exact:true}).fill('ORDER-A-UNSAVED');
  await a.getByLabel('Job Label', {exact:true}).fill('First independent order');
  await a.getByRole('combobox').filter({hasText:'Search customers...'}).click();
  await a.getByText('Synthetic buyer', {exact:true}).last().click();
  await a.getByRole('combobox', {name:'Add Product'}).click(); await a.getByText('Yard Signs 24x18', {exact:true}).last().click();
  await expect(a.getByRole('heading', {name:'Quantity & Pricing'})).toBeVisible();
  await a.getByRole('textbox', {name:'Quantity',exact:true}).fill('28'); await a.getByRole('textbox', {name:'Quantity',exact:true}).blur();
  const pricing = a.getByTestId('order-line-pricing-row');
  await pricing.getByRole('button', {name:'$164.92',exact:true}).click();
  await pricing.getByRole('textbox').last().fill('165.00'); await pricing.getByRole('textbox').last().blur();
  await expect(pricing).toContainText('$165.00');
  await a.getByRole('combobox', {name:'Change product'}).click(); await a.getByText('Coroplast Custom', {exact:true}).last().click();
  await a.getByLabel('Width', {exact:true}).fill('24'); await a.getByLabel('Height', {exact:true}).fill('18');
  await a.getByLabel('Height', {exact:true}).blur();
  // Scroll positions are owned by the mounted boundary, never a shared draft buffer.
  await a.evaluate(node => { node.scrollTop=350; node.dispatchEvent(new Event('scroll')); });
  const aScroll=await a.evaluate(node=>node.scrollTop);
  await switchTo('order-b'); await page.keyboard.press('Escape');
  await expect(b.getByLabel('PO #', {exact:true})).toHaveValue('');
  await b.getByLabel('PO #', {exact:true}).fill('ORDER-B-UNSAVED');
  await b.getByLabel('Job Label', {exact:true}).fill('Second independent order');
  await b.getByRole('combobox', {name:'Add Product'}).click(); await b.getByText('Yard Signs 24x18', {exact:true}).last().click();
  await b.getByRole('textbox', {name:'Quantity',exact:true}).fill('7'); await b.getByRole('textbox', {name:'Quantity',exact:true}).blur();
  await expect.poll(()=>page.evaluate(()=>window.__workspaceGuards().guards.filter(guard=>['order-a','order-b'].includes(guard.workspaceId) && guard.shouldBlockResult).length)).toBe(2);
  await switchTo('order-a');
  expect(await a.evaluate(node=>node.scrollTop)).toBe(aScroll);
  await expect(a.getByLabel('PO #', {exact:true})).toHaveValue('ORDER-A-UNSAVED');
  await expect(a.getByRole('textbox', {name:'Quantity',exact:true})).toHaveValue('28');
  await expect(a.getByLabel('Width', {exact:true})).toHaveValue('24'); await expect(a.getByLabel('Height', {exact:true})).toHaveValue('18');
  await expect(pricing).toContainText('$165.00');
  await a.getByLabel('PO #', {exact:true}).focus(); await expect(a.getByLabel('PO #', {exact:true})).toBeFocused();
  const fieldIds = await page.locator('[data-workspace-id] input[id]').evaluateAll(nodes=>nodes.map(node=>node.id));
  expect(new Set(fieldIds).size).toBe(fieldIds.length);
  // Modal content must leave the live DOM when inactive and retain its input on reactivation.
  await page.getByRole('button', {name:'Open fixture dialog',exact:true}).click();
  await page.getByLabel('Isolated dialog notes').fill('Retain this open modal');
  await switchTo('order-b'); await expect(page.getByLabel('Isolated dialog notes')).toHaveCount(0);
  expect(await page.evaluate(()=>document.body.style.pointerEvents)).not.toBe('none');
  await b.getByLabel('PO #', {exact:true}).focus(); await expect(b.getByLabel('PO #', {exact:true})).toBeFocused();
  await switchTo('order-a'); await expect(page.getByLabel('Isolated dialog notes')).toHaveValue('Retain this open modal');
  await page.keyboard.press('Escape');
  await switchTo('quote'); await page.keyboard.press('Escape');
  await expect(quote.getByText('New Quote', {exact:true})).toBeVisible();
  // Quote create flow has its existing explicit edit action.
  const edit=quote.getByRole('button',{name:/edit quote/i}); if(await edit.count()) await edit.first().click();
  const quoteJob=quote.getByPlaceholder('Job name or reference', {exact:true});
  await quoteJob.fill('Independent quote'); await switchTo('order-a'); await switchTo('quote'); await expect(quoteJob).toHaveValue('Independent quote');
  await switchTo('customer'); await customer.getByRole('button',{name:'Edit synthetic company'}).click();
  await customer.getByLabel('Company Name *', {exact:true}).fill('Synthetic workspace company');
  await expect.poll(()=>page.evaluate(()=>window.__workspaceGuards().guards.some(guard=>guard.workspaceId==='customer' && guard.shouldBlockResult))).toBe(true);
  await switchTo('order-b'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(b.getByRole('textbox', {name:'Quantity',exact:true})).toHaveValue('7');
  await switchTo('customer'); await expect(customer.getByLabel('Company Name *', {exact:true})).toHaveValue('Synthetic workspace company');
  await page.keyboard.press('Escape'); await switchTo('order-a');
  // Browser navigation changes the outer location without retargeting the controlled editor.
  await page.getByRole('button',{name:'Browser route',exact:true}).click(); await page.goBack();
  await expect(a.getByLabel('PO #', {exact:true})).toHaveValue('ORDER-A-UNSAVED'); await page.goForward();
  await expect(a.getByRole('textbox',{name:'Quantity',exact:true})).toHaveValue('28');
  await mkdir('node_modules/.cache/workspace-browser',{recursive:true});
  for(const theme of ['Light','Dark']) {
    await page.getByRole('button',{name:theme,exact:true}).click();
    await a.getByLabel('PO #',{exact:true}).focus(); await expect(a.getByLabel('PO #',{exact:true})).toBeFocused();
    await page.screenshot({path:`node_modules/.cache/workspace-browser/${theme.toLowerCase()}.png`,fullPage:true});
  }
  await page.setViewportSize({width:1050,height:800}); await expect(a.getByLabel('PO #',{exact:true})).toBeVisible();
  await page.screenshot({path:'node_modules/.cache/workspace-browser/narrow.png',fullPage:true});
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>/workspace.*draft|unsaved/i.test(key)))).toEqual([]);
  if(errors.length) throw new Error(errors.join('\n'));
  console.log('PASS: real shared New Order instances, Quote and Customer form; independent fields/pricing, scoped focus, modal retention, dirty state, scroll, browser navigation, light/dark, narrow desktop. API/persistence synthetic; no business records changed.');
} finally { await browser.close(); await server.close(); }
