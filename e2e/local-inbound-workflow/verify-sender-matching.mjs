import { chromium, expect } from '@playwright/test';
import { startFixture } from './server.mjs';
import { mkdir } from 'node:fs/promises';
const server = await startFixture();
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  await mkdir('node_modules/.cache/inbound-workflow', { recursive: true });
  for (const scenario of ['exact', 'ambiguous', 'unknown']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(60000); page.on('dialog', dialog => dialog.accept());
    await page.goto(`http://127.0.0.1:4187/inbound-orders?sender-match=${scenario}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByRole('button', { name: 'Inspect ZIP in app' }).click();
    await page.getByRole('button', { name: 'Import selected files together' }).click();
    await expect(page.getByTestId('inbound-archive-resolution')).toContainText('Imported 2 file(s)');
    await page.getByText('I reviewed the entire archive and selected all extracted files needed for this order', { exact: false }).click();
    await page.getByRole('button', { name: 'Confirm reviewed archive evidence' }).click();
    await page.getByRole('button', { name: 'Parse', exact: true }).click();
    const workstation = page.getByTestId('clean-order-workstation');
    const customerStatus = page.locator('[data-clean-checklist-item="Customer matched"]');
    if (scenario === 'unknown') {
      await expect(customerStatus).toHaveAttribute('data-complete', 'false');
      await expect(page.getByTestId('inbound-sender-match-candidates')).toHaveCount(0);
      await page.close(); continue;
    }
    if (scenario === 'ambiguous') {
      await expect(customerStatus).toHaveAttribute('data-complete', 'false');
      const candidates = page.getByTestId('inbound-sender-match-candidates');
      await expect(candidates).toContainText('Multiple active relationships');
      await candidates.scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'node_modules/.cache/inbound-workflow/sender-match-candidates.png' });
      await candidates.getByRole('button', { name: 'Alternative buyer — Alternative Contact' }).click();
    }
    await expect(customerStatus).toHaveAttribute('data-complete', 'true');
    await expect(workstation.getByRole('button', { name: 'Change customer', exact: true })).toBeVisible();
    await expect(workstation.getByRole('button', { name: 'Change contact', exact: true })).toBeVisible();
    await workstation.getByRole('button', { name: 'Change customer', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `node_modules/.cache/inbound-workflow/sender-match-${scenario}.png` });
    const quantity = page.getByTestId('clean-inline-quantity-input'); await quantity.fill('28'); await quantity.blur();
    await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
    await expect(workstation).toContainText('Synthetic first draft save failure');
    await expect(customerStatus).toHaveAttribute('data-complete', 'true');
    await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
    const expectedContact = scenario === 'ambiguous' ? '00000000-0000-4000-8000-000000000010' : '00000000-0000-4000-8000-000000000008';
    await expect.poll(async () => (await page.evaluate(() => window.__fixtureState())).savedReviewDraft?.reviewedCustomerJson.selectedContactId).toBe(expectedContact);
    await quantity.fill('31'); await quantity.blur();
    await page.evaluate(() => window.__fixtureBackgroundRefresh());
    await page.waitForTimeout(4000);
    await expect(quantity).toHaveValue('31');
    await expect(customerStatus).toHaveAttribute('data-complete', 'true');
    await expect(workstation.getByRole('button', { name: 'Change contact', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
    await expect(workstation).toContainText('Draft was not saved or refreshed: Saved draft changed');
    await expect(quantity).toHaveValue('31');
    if (errors.length) throw new Error(errors.join('\n'));
    await page.close();
  }
  console.log('SENDER MATCHING: exact ID hydration, ambiguous candidate confirmation, unknown sender, readiness, failed save, exact ID persistence and dirty background/stale-save protections passed at normal zoom. Browser persistence is mocked; PostgreSQL coverage is separate.');
} finally { await browser.close(); await server.close(); }
