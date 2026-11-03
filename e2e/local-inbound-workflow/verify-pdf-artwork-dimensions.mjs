import { chromium, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { mkdir } from 'node:fs/promises';
import { startFixture } from './server.mjs';
import { analyzePdfBytes } from '../../server/services/artwork/analyzePdfSize.ts';

const assets = new Map();
for (const [name, sizes] of [['decimal.pdf', [[162,144]]], ['mixed.pdf', [[1728,2592],[2592,1728]]], ['equal.pdf', [[162,144],[162,144]]]]) {
  const pdf = await PDFDocument.create(); for (const size of sizes) pdf.addPage(size); assets.set(name, Buffer.from(await pdf.save()));
}
assets.set('bad.pdf', Buffer.from('not a PDF'));
const server = await startFixture(4191);
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.exposeFunction('__inspectSyntheticPdf', async name => analyzePdfBytes(assets.get(name), `synthetic:${name}`));
  await page.goto('http://127.0.0.1:4191/orders/new', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await expect(page.getByTestId('order-entry-workspace')).toBeVisible({timeout:60000});
  await page.evaluate(() => {
    const previous = window.fetch.bind(window); const staged = new Map(); let latest;
    window.__pdfPricingInputs = []; window.__pdfSavedOrder = null;
    window.fetch = async (input, init) => {
      const pathname = new URL(typeof input === 'string' ? input : input.url, location.origin).pathname;
      const payload = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      const response = data => new Response(JSON.stringify({success:true,data}), {status:200,headers:{'Content-Type':'application/json'}});
      if (pathname === '/api/uploads/init') { latest = crypto.randomUUID(); staged.set(latest, payload.filename); return response({uploadId:latest,chunkSizeBytes:8388608,totalChunks:1}); }
      if (/\/api\/uploads\/.+\/chunks\//.test(pathname)) return response({received:true});
      if (/\/api\/uploads\/.+\/finalize/.test(pathname)) return response({fileId:latest});
      if (pathname === '/api/artwork/pdf-size') return response({analysis:await window.__inspectSyntheticPdf(staged.get(payload.uploadId))});
      if (pathname === '/api/quotes/calculate') window.__pdfPricingInputs.push(payload);
      if (pathname === '/api/orders' && window.__fixtureState().directOrderAttempts > 0) window.__pdfSavedOrder = payload;
      if (pathname === '/api/orders/qa-direct-order') return response(window.__pdfSavedOrder);
      return previous(input, init);
    };
  });
  await page.getByRole('combobox').filter({ hasText: 'Search customers...' }).first().click();
  await page.getByText('Synthetic buyer', { exact:true }).last().click({force:true});
  await page.getByRole('combobox', {name:'Add Product'}).click(); await page.getByText('Coroplast Custom',{exact:true}).last().click();
  await page.getByLabel('Width',{exact:true}).fill('7'); await page.getByLabel('Height',{exact:true}).fill('8');
  await page.getByRole('textbox',{name:'Quantity',exact:true}).fill('28');
  const upload = async name => { await page.locator('input[type=file]').first().setInputFiles({name,mimeType:'application/pdf',buffer:assets.get(name)}); };
  await upload('decimal.pdf');
  const card = name => page.locator('[data-testid="staged-artwork-allocation"] > div').filter({hasText:name});
  await expect(card('decimal.pdf')).toContainText('2.25 × 2 inches');
  await expect(page.getByLabel('Width',{exact:true})).toHaveValue('7');
  await card('decimal.pdf').getByRole('button',{name:'Apply to Line Size'}).click();
  await expect(page.getByLabel('Width',{exact:true})).toHaveValue('2.25'); await expect(page.getByLabel('Height',{exact:true})).toHaveValue('2');
  await expect.poll(() => page.evaluate(() => window.__pdfPricingInputs.some(p => p.width === 2.25 && p.height === 2 && p.quantity === 28))).toBe(true);
  await page.getByRole('combobox',{name:'Change product'}).click(); await page.getByText('Yard Signs 24x18',{exact:true}).last().click();
  await expect(card('decimal.pdf').getByRole('button',{name:'Apply to Line Size'})).toBeDisabled();
  await expect(card('decimal.pdf')).toContainText('configured physical size');
  await page.getByRole('combobox',{name:'Change product'}).click(); await page.getByText('Coroplast Custom',{exact:true}).last().click();
  await upload('mixed.pdf'); await expect(card('mixed.pdf').getByRole('combobox',{name:'PDF page dimensions for mixed.pdf'})).toBeVisible();
  await card('mixed.pdf').getByRole('combobox',{name:'PDF page dimensions for mixed.pdf'}).selectOption('2'); await card('mixed.pdf').getByRole('button',{name:'Apply to Line Size'}).click();
  await expect(page.getByLabel('Width',{exact:true})).toHaveValue('36'); await expect(page.getByLabel('Height',{exact:true})).toHaveValue('24');
  await upload('equal.pdf'); await expect(card('equal.pdf')).toContainText('all 2 pages');
  await upload('bad.pdf'); await expect(card('bad.pdf')).toContainText('Dimensions unavailable.');
  // Additional uploads are references for this fixture so existing production allocation remains valid.
  for (const name of ['mixed.pdf','equal.pdf','bad.pdf']) await card(name).getByRole('combobox',{name:`Artwork role for staged ${name}`}).selectOption('reference');
  const pricing = page.getByTestId('order-line-pricing-row');
  await pricing.getByRole('button',{name:'$120.00',exact:true}).click();
  await pricing.getByRole('textbox').last().fill('165.00'); await pricing.getByRole('textbox').last().blur();
  await card('decimal.pdf').getByRole('button',{name:'Apply to Line Size'}).click();
  await expect(pricing).toContainText('$165.00');
  await expect(page.getByRole('textbox',{name:'Quantity',exact:true})).toHaveValue('28');
  await expect(page.getByLabel('Width',{exact:true})).toHaveValue('2.25');
  await expect(page.getByLabel('Height',{exact:true})).toHaveValue('2');
  await page.getByRole('button',{name:'Save Item',exact:true}).click();
  await mkdir('node_modules/.cache/pdf-artwork-browser',{recursive:true});
  await page.getByRole('button',{name:'Light',exact:true}).click();
  await page.screenshot({path:'node_modules/.cache/pdf-artwork-browser/light.png',fullPage:true});
  await page.getByRole('button',{name:'Dark',exact:true}).click();
  await card('decimal.pdf').getByRole('button',{name:'Apply to Line Size'}).focus();
  await expect(card('decimal.pdf').getByRole('button',{name:'Apply to Line Size'})).toBeFocused();
  await page.screenshot({path:'node_modules/.cache/pdf-artwork-browser/dark.png',fullPage:true});
  await page.getByRole('button',{name:'Create Order',exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.__fixtureState().directOrderAttempts)).toBe(1);
  await expect(page.getByLabel('Width',{exact:true})).toHaveValue('2.25'); await expect(pricing).toContainText('$165.00');
  await page.getByRole('button',{name:'Create Order',exact:true}).click();
  const saved = await page.evaluate(async () => (await (await fetch('/api/orders/qa-direct-order')).json()).data);
  const line = saved.lineItems[0];
  expect(line.width).toBe(2.25); expect(line.height).toBe(2); expect(line.quantity).toBe(28); expect(line.totalPrice).toBe(165); expect(line.overridePriceCents).toBe(16500);
  expect(line.pendingOrderAttachmentUploadIds).toHaveLength(4);
  expect(new Set(line.pendingOrderAttachmentUploadIds).size).toBe(4);
  expect(line.pendingOrderArtworkAllocations.filter(file => file.role === 'artwork')).toHaveLength(1);
  console.log('PASS: New Order real PDF detector; staged upload/API and order persistence mocked. Single/mixed/equal pages, failure, explicit apply, PBV2 request dimensions, quantity, $165 override, failed save retention, synthetic saved readback, artwork identity, light/dark, keyboard focus.');
  expect(errors).toEqual([]);
} catch(error) { console.error(error); console.log('PRICING INPUTS',await page.evaluate(()=>window.__pdfPricingInputs)); await page.screenshot({path:'node_modules/.cache/pdf-artwork-browser/failure.png',fullPage:true}); throw error; } finally { await browser.close(); await server.close(); }
