import { chromium, expect } from '@playwright/test';
import { startFixture } from './server.mjs';
import { mkdir } from 'node:fs/promises';

// Actual shared editor and inbound adapter; HTTP persistence is synthetic.
// Durable readback, reconciliation and conversion are tested in PostgreSQL.
const server = await startFixture(4193);
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  await mkdir('node_modules/.cache/inbound-workflow', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(30000);
  page.on('dialog', dialog => dialog.accept());
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4193/inbound-orders?current-readiness', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Inspect ZIP in app' }).click();
  await page.getByRole('button', { name: 'Import selected files together' }).click();
  await expect(page.getByTestId('inbound-archive-resolution')).toContainText('Imported 2 file(s)');
  await page.getByText('I reviewed the entire archive and selected all extracted files needed for this order', { exact: false }).click();
  await page.getByRole('button', { name: 'Confirm reviewed archive evidence' }).click();
  await page.getByRole('button', { name: 'Parse', exact: true }).click();
  await expect(page.getByTestId('clean-inline-quantity-input')).toHaveValue('20');
  await page.evaluate(() => window.__fixtureEditorRepair(true));
  const workstation = page.getByTestId('clean-order-workstation');
  const readiness = page.getByTestId('clean-readiness-status-bar');
  await expect(readiness).toContainText('Product resolved: Needs review');
  await page.keyboard.press('Escape');
  const picker = page.getByRole('combobox', { name: 'Select product' });
  await picker.scrollIntoViewIfNeeded(); await picker.press('Enter');
  await expect(page.getByRole('option', { name: /Coroplast Custom/ })).toBeVisible();
  const search = page.getByPlaceholder('Search by name, SKU, or category…');
  await search.press('ArrowDown'); await search.press('Enter');
  await expect(readiness).not.toContainText('AI reported missing product');
  const width = workstation.getByLabel('Width', { exact: true });
  const height = workstation.getByLabel('Height', { exact: true });
  const quantity = page.getByTestId('clean-inline-quantity-input');
  await width.fill('2'); await width.blur(); await height.fill('2'); await height.blur();
  await quantity.fill('3'); await quantity.blur();
  await page.getByTestId('clean-inline-artwork-select').selectOption({ label: 'front.pdf' });
  await expect(readiness).not.toContainText('AI reported missing dimensions');
  await expect(readiness).not.toContainText('AI reported missing quantity');
  await expect(readiness).not.toContainText('AI reported missing artwork');
  await expect(readiness).toHaveAttribute('data-unresolved-count', '2');
  await readiness.getByRole('button', { name: 'Next Issue' }).click();
  await expect(readiness).toHaveAttribute('data-navigation-target', 'dueDate');
  await page.locator('#inbound-due-date').fill('2026-11-09');
  await expect(readiness).toHaveAttribute('data-unresolved-count', '1');
  await readiness.getByRole('button', { name: 'Next Issue' }).click();
  await expect(readiness).toHaveAttribute('data-navigation-target', 'fulfillment');
  await workstation.getByLabel('Carrier', { exact: true }).fill('UPS Ground');
  await expect(readiness).toHaveAttribute('data-unresolved-count', '0');
  await expect(readiness.getByRole('button', { name: 'Next Issue' })).toBeDisabled();
  await expect(workstation).toContainText('Historical parse observation');
  for (const theme of ['Light', 'Dark']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    await readiness.scrollIntoViewIfNeeded(); await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.screenshot({ path: `node_modules/.cache/inbound-workflow/current-readiness-${theme.toLowerCase()}.png` });
  }
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
  await expect(workstation.getByRole('alert')).toContainText('Synthetic first draft save failure');
  await expect(quantity).toHaveValue('3'); await expect(readiness).toHaveAttribute('data-unresolved-count', '0');
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
  await expect.poll(async () => (await page.evaluate(() => window.__fixtureState())).savedReviewDraft.reviewedOrderJson.shipMethod).toBe('UPS Ground');
  await page.getByRole('button', { name: 'Reparse', exact: true }).click();
  await expect(quantity).toHaveValue('3'); await expect(readiness).not.toContainText('AI reported missing');
  await expect(readiness).toContainText('Review changed source evidence');
  await expect(readiness).toHaveAttribute('data-unresolved-count', '1');
  await quantity.fill('4'); await page.evaluate(() => window.__fixtureBackgroundRefresh());
  await page.waitForTimeout(4000);
  await expect(quantity).toHaveValue('4'); await expect(width).toHaveValue('2');
  await expect(readiness).not.toContainText('AI reported missing');
  await expect(workstation).toContainText('Saved draft changed');
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
  await expect(workstation).toContainText('Draft was not saved or refreshed: Saved draft changed');
  await expect(quantity).toHaveValue('4');
  await page.getByRole('button', { name: 'Load current saved draft', exact: true }).click();
  await expect(quantity).toHaveValue('3'); await expect(workstation.getByLabel('Carrier', { exact: true })).toHaveValue('UPS Ground');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('CURRENT READINESS: product, finished dimensions, quantity 3, classified artwork, due date, carrier, accurate count/Next Issue, history, failed save, saved readback, reparse and dirty background updates passed. Light/dark, 1440x900, scale 1. Browser persistence mocked; separate PostgreSQL tests prove durable behavior.');
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  if (page) await page.screenshot({ path: 'node_modules/.cache/inbound-workflow/current-readiness-failure.png' });
  throw error;
} finally { await browser.close(); await server.close(); }
