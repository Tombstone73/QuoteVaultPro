import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { startFixture } from '../local-inbound-workflow/server.mjs';
const out = 'node_modules/.cache/usability-browser'; await mkdir(out, { recursive: true });
const server = await startFixture(4201, '/e2e/local-usability/fixture.tsx');
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1000 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(15000); const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:4201/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Deadline type').selectOption('time');
  const date = await page.locator('#due').boundingBox();
  const mode = await page.getByLabel('Deadline type').boundingBox();
  const time = await page.getByLabel('Deadline local time').boundingBox();
  expect(mode.y).toBeGreaterThanOrEqual(date.y + date.height);
  expect(time.y).toBeGreaterThanOrEqual(mode.y + mode.height); // wraps safely in the deliberately narrow field
  await page.getByLabel('Deadline local time').fill('16:45');
  await page.getByRole('button', { name: 'Add Printer Profile', exact: true }).click();
  for (const theme of ['Light', 'Dark']) {
    // Dialog portals intentionally trap focus; set the same theme preference through its existing root class.
    await page.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'Dark'); }, theme);
    await page.setViewportSize({ width: 900, height: 620 });
    const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.evaluate(node => node.clientHeight)).toBeLessThanOrEqual(620 * .9 + 2);
    const geometry = await dialog.evaluate(node => ({ height: node.clientHeight, scroll: node.scrollHeight, overflow: getComputedStyle(node).overflowY }));
    expect(geometry.height).toBeLessThanOrEqual(620 * .9 + 2); expect(geometry.scroll).toBeGreaterThan(geometry.height); expect(geometry.overflow).toBe('auto');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
    await page.screenshot({ path: `${out}/printer-dialog-${theme.toLowerCase()}.png` });
  }
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  for (const width of [1920, 900]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('http://127.0.0.1:4201/orders?view=customers', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Customers', exact: true })).toBeVisible();
    const container = page.getByRole('heading', { name: 'Customers', exact: true }).locator('xpath=ancestor::div[contains(@class,"mx-auto")][1]');
    expect((await container.boundingBox()).width).toBe(width);
    await page.screenshot({ path: `${out}/customers-${width}.png` });
  }
  await page.goto('http://127.0.0.1:4201/orders?view=printers', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Archive printer Synthetic label printer' })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Archive printer Synthetic label printer' }).click();
  await expect(page.getByRole('button', { name: 'Archive printer Synthetic label printer' })).toHaveCount(0);
  expect(await page.evaluate(() => window.__usabilityRequests().filter(row => row.method === 'DELETE'))).toEqual([]);
  for (const theme of ['Light', 'Dark']) {
    await page.goto('http://127.0.0.1:4201/orders?view=prepress', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: theme, exact: true }).click();
    await expect(page.getByText('Prepress Workspace', { exact: true })).toBeVisible();
    await page.screenshot({ path: `${out}/prepress-${theme.toLowerCase()}.png` });
  }
  expect(await page.evaluate(() => window.visualViewport.scale)).toBe(1);
  expect(errors).toEqual([]);
  console.log('USABILITY: narrow deadline controls; scrollable light/dark printer dialog; wide/narrow Customers; canonical archive UI; Prepress themes passed. HTTP persistence is mocked.');
} catch (error) { console.error('Browser errors:', errors, 'Page:', (await page.locator('body').innerText()).slice(0, 1500)); throw error; }
finally { await browser.close(); await server.close(); }
