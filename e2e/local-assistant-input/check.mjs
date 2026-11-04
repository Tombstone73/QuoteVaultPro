import { chromium } from '@playwright/test';
import { startFixture } from '../local-inbound-workflow/server.mjs';
import fs from 'node:fs/promises';
const server = await startFixture(4197, '/e2e/local-assistant-input/fixture.tsx');
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1365, height: 900 }, deviceScaleFactor: 1 });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const message = `  Synthetic order with 100 artwork files.\n${Array.from({length: 100}, (_, i) => `Line ${i + 1}: \"rider_${i + 1}_final.pdf\", quantity 28, 15.5 × 24 inches, contour cut, matte laminate, blind ship only after approval. Preserve canonical pricing and staff edits; review artwork before production.`).join('\n')}\n  `;
let payload, sends = 0;
await page.route('**/fixture-assistant-input', route => {
  sends++; payload = route.request().postDataJSON();
  return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic storage failure"}' });
});
try {
  await page.goto('http://127.0.0.1:4197/orders', { waitUntil: 'networkidle' });
  const input = page.getByPlaceholder('Enter synthetic Order'), send = page.getByRole('button', { name: 'Send message', exact: true });
  await input.fill(message);
  if (await input.inputValue() !== message) throw new Error('Input truncated');
  if (await input.getAttribute('maxlength') !== null) throw new Error('Native clipping remains');
  await send.click();
  await page.getByRole('status').filter({ hasText: 'full draft and attachment retained' }).waitFor();
  if (payload.message !== message || payload.attachmentIds[0] !== 'synthetic-attachment') throw new Error('Payload content/reference changed');
  if (await input.inputValue() !== message) throw new Error('Failure lost draft');
  await input.fill('x'.repeat(32001));
  await page.getByRole('alert').filter({ hasText: 'No input was truncated' }).waitFor();
  if (await input.inputValue() !== 'x'.repeat(32001) || await send.isEnabled()) throw new Error('Oversize retention/guard failed');
  await input.press('Enter');
  if (sends !== 1) throw new Error('Oversize was submitted');
  await fs.mkdir('node_modules/.cache/assistant-input-browser', { recursive: true });
  await page.screenshot({ path: 'node_modules/.cache/assistant-input-browser/light.png', fullPage: true });
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await page.screenshot({ path: 'node_modules/.cache/assistant-input-browser/dark.png', fullPage: true });
  await input.fill('Corrected request');
  if (!(await send.isEnabled()) || await page.getByRole('alert').count()) throw new Error('Correction did not recover');
  if (errors.length) throw new Error(errors.join('; '));
  console.log(JSON.stringify({ result: 'PASS', characters: message.length, serializedBodyBytes: Buffer.byteLength(JSON.stringify(payload), 'utf8'), checks: 'actual composer, intact multiline input and attachment refs, failed-submit retention, oversize prevention/recovery, light/dark, normal zoom', persistence: 'mocked HTTP; real PostgreSQL verified separately' }));
} finally { await browser.close(); await server.close(); }
