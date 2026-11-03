import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { startFixture } from './server.mjs';

const output = 'node_modules/.cache/customer-detail-browser';
await fs.mkdir(output, { recursive: true });
const server = await startFixture();
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4193/customers/customer-ui-fixture', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await expect(page.getByRole('heading', { name: 'Sample Print Partners', exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('table', { name: 'Contacts and portal access' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Customers' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Quote', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Order', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview Customer Portal' })).toBeVisible();
  await expect(page.getByText('Call before delivery. Keep company instructions.', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${output}/light-desktop.png`, fullPage: true });
  await page.getByRole('button', { name: 'Switch theme' }).click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${output}/dark-desktop.png`, fullPage: true });
  await page.getByRole('button', { name: 'Edit Pricing & Products', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('[data-company-section="pricing"]')).toBeInViewport();
  await page.getByRole('navigation', { name: 'Company edit sections' }).getByRole('button', { name: 'Company', exact: true }).click();
  await page.locator('#phone').fill('(555) 010-1999');
  await page.getByRole('button', { name: 'Update Company', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Company Information', exact: true })).toContainText('(555) 010-1999');
  const saveOperation = await page.evaluate(() => window.fixtureOperations.find(operation => operation.method === 'PATCH' && operation.path === '/api/customers/customer-ui-fixture'));
  expect(saveOperation?.body?.phone).toBe('(555) 010-1999');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Company Information', exact: true })).toContainText('(555) 010-1999');
  const robin = page.getByRole('row').filter({ hasText: 'Robin Review' });
  await robin.getByRole('button', { name: 'Reset Password', exact: true }).click();
  await robin.getByRole('button', { name: 'Suspend', exact: true }).click();
  await expect(robin.getByRole('button', { name: 'Activate', exact: true })).toBeVisible();
  await robin.getByRole('button', { name: 'Activate', exact: true }).click();
  await expect(robin.getByRole('button', { name: 'Suspend', exact: true })).toBeVisible();
  const casey = page.getByRole('row').filter({ hasText: 'Casey Buyer' });
  await casey.getByRole('button', { name: 'Create Access', exact: true }).click();
  await expect(casey.getByText('Pending Invite', { exact: true })).toBeVisible();
  const sam = page.getByRole('row').filter({ hasText: 'Sam Invite' });
  await sam.getByRole('button', { name: 'Resend', exact: true }).click();
  await sam.getByRole('button', { name: 'Disable', exact: true }).click();
  await expect(sam.getByText('Disabled', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Company', exact: true }).focus();
  await expect(page.getByRole('button', { name: 'Edit Company', exact: true })).toBeFocused();
  await page.screenshot({ path: `${output}/dark-focus.png`, fullPage: true });
  for (const theme of ['dark', 'light']) {
    await page.setViewportSize({ width: 760, height: 900 });
    if (theme === 'light') await page.getByRole('button', { name: 'Switch theme' }).click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${output}/${theme}-narrow.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
  const operations = await page.evaluate(() => window.fixtureOperations);
  await fs.writeFile(`${output}/results.json`, JSON.stringify({ status: 'passed', persistence: 'mocked localStorage and API; no database or deployed environment', errors, saveOperation, operations }, null, 2));
  console.log('Customer Detail browser checks passed: light/dark desktop/narrow, keyboard focus, canonical save + mocked reload, portal controls.');
} finally {
  await browser.close();
  await server.close();
}
