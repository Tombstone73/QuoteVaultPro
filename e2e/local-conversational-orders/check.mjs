import { chromium } from '@playwright/test';
import { startFixture } from '../local-inbound-workflow/server.mjs';
import fs from 'node:fs/promises';
const server = await startFixture(4196, '/e2e/local-conversational-orders/fixture.tsx');
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1365, height: 900 }, deviceScaleFactor: 1 });
const errors = []; page.on('pageerror', error => errors.push(error.message));
let selection;
await page.route('**/api/assistant/conversations/**/order-option-selections/**', route => {
  selection = route.request().postDataJSON(); return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});
try {
  await page.goto('http://127.0.0.1:4196/orders', { waitUntil: 'networkidle' });
  await page.getByRole('radio', { name: 'Double-Sided', exact: true }).click();
  await page.getByRole('button', { name: 'Continued', exact: true }).waitFor();
  if (selection?.lineIndex !== 1 || selection?.selections?.[0]?.valueId !== 'double') throw new Error('Wrong line/choice submitted');
  await page.getByRole('button', { name: 'Show reviewed proposal' }).click();
  await page.getByText('Quantity: 28', { exact: false }).first().waitFor();
  const text = await page.locator('body').innerText();
  for (const expected of ['$165.00', '24 × 18 in', 'linked draft Invoice', 'Customer pickup', 'reference only']) if (!text.includes(expected)) throw new Error(`Missing preview field: ${expected}`);
  await fs.mkdir('node_modules/.cache/conversational-orders-browser', { recursive: true });
  await page.screenshot({ path: 'node_modules/.cache/conversational-orders-browser/light.png', fullPage: true });
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await page.screenshot({ path: 'node_modules/.cache/conversational-orders-browser/dark.png', fullPage: true });
  await page.getByRole('button', { name: 'GO: Create Order', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Fixture confirmation' }).waitFor();
  if (errors.length) throw new Error(errors.join('; '));
  console.log('PASS: actual option and GO components; line identity, exact total, physical size, header/reference details, light/dark, normal zoom. Browser persistence mocked.');
} finally { await browser.close(); await server.close(); }
