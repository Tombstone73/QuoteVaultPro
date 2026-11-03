import { chromium, expect } from '@playwright/test';
import { startFixture } from './server.mjs';
import { mkdir } from 'node:fs/promises';
// Real shared editor and inbound adapter. All HTTP/provider/storage persistence
// here is synthetic. Real persistence is tested by the isolated PostgreSQL suite.
const server = await startFixture(4201);
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  await mkdir('node_modules/.cache/inbound-workflow', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(45000); const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto('http://127.0.0.1:4201/inbound-orders?manual-fallback', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await expect(page.getByRole('button', { name: 'Start manual draft', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Parse', exact: true }).click();
  await expect(page.getByText(/AI response could not be validated/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry Parse', exact: true })).toBeEnabled();
  for (const theme of ['Light', 'Dark']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.screenshot({ path: `node_modules/.cache/inbound-workflow/manual-fallback-${theme.toLowerCase()}.png` });
  }
  await page.getByRole('button', { name: 'Start manual draft', exact: true }).click();
  const workstation = page.getByTestId('clean-order-workstation');
  await expect(workstation).toBeVisible();
  await workstation.getByRole('combobox').filter({ hasText: 'Search customers...' }).click();
  await page.getByText('Synthetic buyer', { exact: true }).last().click();
  await page.getByRole('button', { name: 'Add line item', exact: true }).click();
  const product = page.getByRole('combobox', { name: 'Select product', exact: true });
  await page.keyboard.press('Escape'); await product.scrollIntoViewIfNeeded(); await product.press('Enter');
  const productSearch = page.getByPlaceholder(/Search by name, SKU, or category/);
  await productSearch.fill('Yard Signs'); await expect(page.getByRole('option', { name: /Coroplast Custom/ })).toHaveCount(0); await productSearch.press('ArrowDown'); await productSearch.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Change product' })).toContainText('Yard Signs 24x18');
  console.log('Manual entry: selected customer and product using shared controls.');
  const quantity = page.getByTestId('clean-inline-quantity-input'); await quantity.fill('28'); await quantity.blur();
  await expect(workstation).toContainText('24');
  await workstation.getByRole('combobox').filter({ hasText: 'Select' }).last().click();
  await page.getByRole('option', { name: 'Double sided', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__fixtureState().lastInboundPricingInput?.optionSelectionsJson?.selected?.sides?.value)).toBe('double');
  const decision = page.getByTestId('inbound-artwork-prepress-decision');
  await decision.getByRole('textbox', { name: 'Reason / Prepress instructions' }).fill('Synthetic manual PO entry; artwork will follow.');
  await decision.getByRole('button', { name: 'Send to Prepress without Artwork', exact: true }).click();
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
  await expect(workstation).toContainText('Synthetic first draft save failure'); await expect(quantity).toHaveValue('28');
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__fixtureState().savedReviewDraft?.reviewedLineItemsJson[0].quantity)).toBe(28);
  await page.reload({ waitUntil: 'domcontentloaded' }); await expect(quantity).toHaveValue('28');
  // Dirty staff work survives a failed provider retry and background refresh.
  await quantity.fill('29'); await quantity.blur();
  await page.getByRole('button', { name: /^(Retry Parse|Parse|Reparse)$/ }).click();
  await expect(page.getByText(/AI response could not be validated/).first()).toBeVisible(); await expect(quantity).toHaveValue('29');
  await page.evaluate(() => window.__fixtureManualSourceChange());
  await expect(page.getByRole('button', { name: 'Confirm source review without AI', exact: true })).toBeVisible();
  await expect(quantity).toHaveValue('29');
  await page.getByRole('button', { name: 'Confirm source review without AI', exact: true }).click();
  // The fixture rejects the first save after reload too. Reconciliation must
  // stop there and retain edits, then succeed on deliberate retry.
  await expect(workstation).toContainText('Synthetic first draft save failure'); await expect(quantity).toHaveValue('29');
  await page.getByRole('button', { name: 'Confirm source review without AI', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm source review without AI', exact: true })).toHaveCount(0);
  await expect(quantity).toHaveValue('29');
  await page.evaluate(() => window.__fixturePO('success'));
  await page.getByRole('button', { name: 'Retry Parse', exact: true }).click();
  await expect(quantity).toHaveValue('29');
  await expect(page.getByRole('button', { name: 'Refresh from Latest Parse', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh from Latest Parse', exact: true }).click(); await expect(quantity).toHaveValue('29');
  expect(await page.evaluate(() => window.__fixtureCreatedOrders ?? 0)).toBe(0);
  for (const theme of ['Light', 'Dark']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    await quantity.scrollIntoViewIfNeeded(); await page.screenshot({ path: `node_modules/.cache/inbound-workflow/manual-editor-${theme.toLowerCase()}.png` });
  }
  await expect(page.getByRole('button', { name: 'Create Order', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Create Order', exact: true }).click();
  await expect(page.getByTestId('inbound-order-created')).toContainText('QA-1');
  expect(await page.evaluate(() => window.__fixtureCreatedOrders)).toBe(1); expect(errors).toEqual([]);
  console.log('PASS: failed parse → manual shared editor → customer/product/PBV2/quantity → failed Save retention → Save/reload → provider retry/background changes retain edits → explicit source review without AI → successful Retry Parse and explicit reconciliation → held Prepress creation. Normal zoom, light/dark. Browser persistence mocked; PostgreSQL tested separately.');
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0]; if (page) await page.screenshot({ path: 'node_modules/.cache/inbound-workflow/manual-fallback-failure.png' });
  throw error;
} finally { await browser.close(); await server.close(); }
