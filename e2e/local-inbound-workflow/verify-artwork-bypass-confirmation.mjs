import { chromium, expect } from '@playwright/test';
import { startFixture } from './server.mjs';
import { mkdir } from 'node:fs/promises';
// Real workstation components; HTTP and session persistence are synthetic.
const server = await startFixture(4196);
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  await mkdir('node_modules/.cache/inbound-workflow', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(60000);
  await page.goto('http://127.0.0.1:4196/inbound-orders?artwork-bypass', { waitUntil: 'domcontentloaded', timeout: 90000 });
  const workstation = page.getByTestId('clean-order-workstation');
  const create = page.getByRole('button', { name: 'Create Order', exact: true });
  await expect(create).toBeDisabled();
  await expect(page.getByTestId('clean-inline-artwork-select')).toContainText('No classified artwork files available');
  const decision = page.getByTestId('inbound-artwork-prepress-decision');
  await decision.getByRole('textbox', { name: 'Reason / Prepress instructions' }).fill('Customer artwork to follow; prepare in Prepress.');
  for (const theme of ['Light', 'Dark']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    await decision.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `node_modules/.cache/inbound-workflow/artwork-bypass-action-${theme.toLowerCase()}.png` });
  }
  await decision.getByRole('button', { name: 'Send to Prepress without Artwork', exact: true }).click();
  await expect(decision).toContainText('Artwork Required in Prepress');
  await expect(create).toBeEnabled();
  expect(await page.evaluate(() => window.__fixtureCreatedOrders ?? 0)).toBe(0);
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
  await expect(workstation).toContainText('Synthetic first draft save failure');
  await expect(decision.getByRole('textbox')).toHaveValue('Customer artwork to follow; prepare in Prepress.');
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__fixtureState().savedReviewDraft?.reviewedArtworkJson.status)).toBe('to_follow');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(decision.getByRole('textbox')).toHaveValue('Customer artwork to follow; prepare in Prepress.');
  await expect(page.getByTestId('clean-readiness-status-bar')).toContainText('Prepress selected: Complete');
  await create.click();
  const confirmation = page.getByTestId('inbound-order-created');
  await expect(confirmation).toContainText('Order Created');
  await expect(confirmation).toContainText('QA-1');
  await expect(confirmation.getByRole('link', { name: 'View Order QA-1' })).toHaveAttribute('href', /\/orders\/qa-order-1/);
  await expect(confirmation.getByRole('link', { name: 'Open in Prepress' })).toHaveAttribute('href', '/production/prepress?lineItemId=qa-line-1');
  await expect(create).toHaveCount(0);
  await expect(page.getByTestId('clean-queue-panel')).not.toContainText('Synthetic buyer');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(confirmation).toContainText('QA-1');
  await expect(create).toHaveCount(0);
  await expect(page.getByTestId('clean-queue-panel')).toContainText('Order QA-1');
  await page.getByRole('button', { name: /^Gmail updates/ }).click();
  await page.getByRole('button', { name: 'Retry Gmail update', exact: true }).click();
  expect(await page.evaluate(() => window.__fixtureState().gmailRetryAttempts)).toBe(1);
  expect(await page.evaluate(() => window.__fixtureState().creationAttempts)).toBe(0); // fresh page, Gmail retry invokes no creation command
  await expect(confirmation).toContainText('QA-1');
  for (const theme of ['Light', 'Dark']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    await confirmation.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `node_modules/.cache/inbound-workflow/artwork-bypass-created-${theme.toLowerCase()}.png` });
  }
  // Ordinary New Order uses its existing shared Setup/Prepress control, with no file fabricated.
  const ordinary = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  ordinary.setDefaultTimeout(60000);
  await ordinary.goto('http://127.0.0.1:4196/orders/new', { waitUntil: 'domcontentloaded' });
  await ordinary.locator('[role="combobox"]').filter({ hasText: 'Search customers...' }).first().click();
  await ordinary.getByText('Synthetic buyer', { exact: true }).last().click({ force: true });
  await ordinary.getByRole('combobox', { name: 'Add Product' }).click();
  await ordinary.getByText('Yard Signs 24x18', { exact: true }).last().click();
  await ordinary.getByRole('textbox', { name: 'Quantity', exact: true }).fill('28');
  await ordinary.getByLabel('Prepress', { exact: true }).check();
  await ordinary.getByRole('button', { name: 'Save Item', exact: true }).click();
  await ordinary.getByRole('button', { name: 'Create Order', exact: true }).click();
  await expect.poll(() => ordinary.evaluate(() => window.__fixtureState().directOrderAttempts)).toBe(1);
  await ordinary.getByRole('button', { name: 'Create Order', exact: true }).click();
  await expect.poll(() => ordinary.evaluate(() => window.__fixtureState().directOrderAttempts)).toBe(2);
  const direct = await ordinary.evaluate(() => window.__fixtureState().directOrderPayload);
  expect(direct.lineItems[0].requiresPrepress).toBe(true);
  console.log('ARTWORK BYPASS + CONFIRMATION: visible explicit action, reason, failed save retention, saved draft reload, live readiness, no Order from Save Draft, permanent Order number, View Order/Prepress links, active queue removal, completed history/reload, and Gmail-only retry passed. Browser persistence mocked; PostgreSQL evidence reported separately.');
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  if (page) await page.screenshot({ path: 'node_modules/.cache/inbound-workflow/artwork-bypass-failure.png' });
  throw error;
} finally { await browser.close(); await server.close(); }
