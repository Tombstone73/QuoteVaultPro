import { chromium, expect } from '@playwright/test';
import { startFixture } from './server.mjs';
import { mkdir } from 'node:fs/promises';
// Actual workstation/editor; HTTP storage is mocked. Real persistence is tested separately.
const server = await startFixture(4195);
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  await mkdir('node_modules/.cache/inbound-workflow', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(60000); page.on('dialog', dialog => dialog.accept());
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4195/inbound-orders?creation-recovery', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.getByRole('button', { name: 'Inspect ZIP in app' }).click();
  await page.getByRole('button', { name: 'Import selected files together' }).click();
  await expect(page.getByTestId('inbound-archive-resolution')).toContainText('Imported 2 file(s)');
  await page.getByText('I reviewed the entire archive and selected all extracted files needed for this order', { exact: false }).click();
  await page.getByRole('button', { name: 'Confirm reviewed archive evidence' }).click();
  await page.getByRole('button', { name: 'Parse', exact: true }).click();
  const workstation = page.getByTestId('clean-order-workstation');
  const quantity = page.getByTestId('clean-inline-quantity-input');
  await expect(quantity).toHaveValue('20'); await quantity.fill('28'); await quantity.blur();
  await page.getByTestId('order-line-pricing-row').getByRole('button', { name: '$165.00', exact: true }).click();
  await page.getByTestId('order-line-pricing-row').getByRole('textbox').last().fill('165.00');
  await page.getByTestId('order-line-pricing-row').getByRole('textbox').last().blur();
  await page.getByLabel('Send to Prepress', { exact: true }).check();
  const create = page.getByRole('button', { name: 'Create Order', exact: true });
  await expect(create).toBeDisabled();
  await expect(workstation).toContainText('Save Draft preserves incomplete work');
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
  await expect(workstation).toContainText('Synthetic first draft save failure');
  await expect(quantity).toHaveValue('28');
  await page.getByRole('button', { name: 'Refresh from Latest Parse', exact: true }).click();
  await expect(create).toBeEnabled();
  await expect(quantity).toHaveValue('28');
  await page.evaluate(() => window.__fixtureCreationRace());
  await create.click();
  const failure = page.getByTestId('inbound-order-creation-error');
  await expect(failure).toContainText('Order creation blocked');
  await expect(failure).toContainText('Review draft saved.');
  await expect(failure).toContainText('Parse current evidence');
  await expect(create).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.__fixtureCreatedOrders ?? 0)).toBe(0);
  for (const theme of ['Light', 'Dark']) {
    await page.getByRole('button', { name: theme, exact: true }).click(); await failure.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.screenshot({ path: `node_modules/.cache/inbound-workflow/creation-recovery-${theme.toLowerCase()}.png` });
  }
  // A stale parse cannot reconcile the newer evidence.
  await page.getByRole('button', { name: 'Refresh from Latest Parse', exact: true }).click();
  await expect(workstation).toContainText('Latest parse does not cover current evidence');
  await expect(quantity).toHaveValue('28');
  await page.getByRole('button', { name: 'Reparse', exact: true }).click();
  await quantity.fill('29'); await quantity.blur();
  const before = await page.evaluate(() => window.__fixtureState().reconciliationAttempts);
  await page.evaluate(() => window.__fixtureFailNextDraftSave());
  await page.getByRole('button', { name: 'Refresh from Latest Parse', exact: true }).click();
  await expect(workstation).toContainText('Synthetic first draft save failure');
  await expect(quantity).toHaveValue('29');
  expect(await page.evaluate(() => window.__fixtureState().reconciliationAttempts)).toBe(before);
  await page.getByRole('button', { name: 'Refresh from Latest Parse', exact: true }).click();
  await expect(create).toBeEnabled(); await expect(quantity).toHaveValue('29');
  await expect(failure).toHaveCount(0);
  await create.click();
  await expect.poll(() => page.evaluate(() => window.__fixtureCreatedOrders ?? 0)).toBe(1);
  const state = await page.evaluate(() => window.__fixtureState());
  expect(state.inboundConversionPayload.reviewedLineItemsJson[0].quantity).toBe(29);
  expect(state.inboundConversionPayload.reviewedLineItemsJson[0].pricingReviewJson.priceOverrideValueCents).toBe(16500);
  expect(state.files).toBe(3);
  const retry = await page.evaluate(async payload => (await fetch('/api/inbound-orders/00000000-0000-4000-8000-000000000001/create-order', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })).json(), state.inboundConversionPayload);
  expect(retry.data).toMatchObject({ orderId: 'qa-order-1', alreadyConverted: true });
  expect(await page.evaluate(() => window.__fixtureCreatedOrders)).toBe(1);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('ORDER CREATION RECOVERY: evidence guard, failed Save Draft, save-before-reconcile, current revision acknowledgement, persistent 409 corrective error, stale parse rejection, dirty correction retention, exact total/source links, successful Order response and idempotent retry passed. Light/dark screenshots at 1440x900 scale 1. Browser persistence mocked; PostgreSQL tested separately.');
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  if (page) await page.screenshot({ path: 'node_modules/.cache/inbound-workflow/creation-recovery-failure.png' });
  throw error;
} finally { await browser.close(); await server.close(); }
