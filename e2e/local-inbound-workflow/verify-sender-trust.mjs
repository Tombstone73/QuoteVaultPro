import { chromium, expect } from '@playwright/test';
import { startFixture } from './server.mjs';
import { mkdir } from 'node:fs/promises';
// Shared UI and ownership hook are real; HTTP, Gmail, storage and session
// persistence are synthetic. No operational mailbox or customer is changed.
const server = await startFixture(4202);
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  await mkdir('node_modules/.cache/inbound-workflow', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(45000); const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto('http://127.0.0.1:4202/inbound-orders?sender-trust', { waitUntil: 'domcontentloaded', timeout: 90000 });
  const controls = page.getByTestId('clean-sender-trust-controls'); const quantity = page.getByTestId('clean-inline-quantity-input');
  const workstation = page.getByTestId('clean-order-workstation');
  await expect(controls).toContainText('Untrusted'); await quantity.fill('28'); await quantity.blur();
  for (const theme of ['Light', 'Dark']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    await page.screenshot({ path: `node_modules/.cache/inbound-workflow/trust-pending-${theme.toLowerCase()}.png` });
  }
  await controls.getByRole('button', { name: 'Trust Sender', exact: true }).focus();
  await controls.getByRole('button', { name: 'Trust Sender', exact: true }).press('Enter');
  await expect(controls).toContainText('Trusted Sender'); await expect(quantity).toHaveValue('28');
  expect(await page.evaluate(() => window.__fixtureTrustState().files[0].fileRecordId)).toBeNull();
  await expect(page.getByRole('button', { name: 'Confirm source review without AI', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.__fixtureTrustRefresh()); await expect(quantity).toHaveValue('28');
  await controls.getByRole('button', { name: 'Trust Sender + Download Attachments', exact: true }).click();
  await expect(controls).toContainText('Downloaded 1'); await expect(quantity).toHaveValue('28');
  expect(await page.evaluate(() => window.__fixtureTrustState().files[0].status)).toBe('available');
  await page.getByRole('checkbox', { name: 'Select art.pdf', exact: true }).check();
  await page.getByRole('button', { name: 'Classify as Artwork', exact: true }).click();
  await page.getByTestId('clean-inline-artwork-select').selectOption({ label: 'art.pdf' });
  await page.getByTestId('clean-front-artwork-select').selectOption({ label: 'art.pdf' });
  await page.getByTestId('clean-use-same-artwork-both-sides').check();
  await page.getByRole('spinbutton', { name: 'Production quantity for art.pdf', exact: true }).fill('28');
  await page.getByRole('radio', { name: 'Artwork ready', exact: true }).check();
  await expect(page.getByTestId('clean-readiness-status-bar')).toContainText('Pricing reviewed: Complete');
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
  await expect(workstation).toContainText('Synthetic first draft save failure'); await expect(quantity).toHaveValue('28');
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__fixtureState().savedReviewDraft?.reviewedLineItemsJson[0].quantity)).toBe(28);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(controls).toContainText('Trusted Sender'); await expect(quantity).toHaveValue('28');
  await expect(page.getByTestId('clean-inline-artwork-select')).toContainText('art.pdf');
  // Bytes/classification changed, so source review stays deliberate. It does
  // not require AI success; the unchanged trust-only action needed no review.
  await page.getByRole('button', { name: 'Confirm source review without AI', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm source review without AI', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('clean-readiness-status-bar')).toContainText('No visible issues');
  await expect(page.getByRole('button', { name: 'Create Order', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.__fixtureTrustState().parseCalls)).toBe(0);
  await page.getByRole('button', { name: 'Create Order', exact: true }).click();
  await expect(page.getByTestId('inbound-order-created')).toContainText('QA-1');
  const payload = await page.evaluate(() => window.__fixtureState().inboundConversionPayload);
  expect(payload.reviewedLineItemsJson[0].artworkLinks[0].fileRecordId).toBe('synthetic-trusted-canonical-art');
  expect(payload.reviewedLineItemsJson[0].quantity).toBe(28); expect(errors).toEqual([]);
  console.log('PASS: keyboard trust action, trusted state refresh, explicit allowed attachment retrieval, artwork classification/assignment, dirty edits through background refresh, failed save, Save/reload, deliberate evidence review and Prepress submission, without any AI parse. Light/dark normal zoom. HTTP/Gmail/storage persistence mocked.');
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0]; if (page) await page.screenshot({ path: 'node_modules/.cache/inbound-workflow/trust-failure.png' });
  throw error;
} finally { await browser.close(); await server.close(); }
