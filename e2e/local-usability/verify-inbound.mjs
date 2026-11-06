import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { startFixture } from '../local-inbound-workflow/server.mjs';
const out = 'node_modules/.cache/usability-browser'; await mkdir(out, { recursive: true });
const server = await startFixture();
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(20000); const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:4187/inbound-orders', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('button', { name: 'Inspect ZIP in app' }).click();
  await page.getByRole('button', { name: 'Import selected files together' }).click();
  await expect(page.getByTestId('inbound-archive-resolution')).toContainText('Imported 2 file(s)');
  await page.getByText('I reviewed the entire archive and selected all extracted files needed for this order', { exact: false }).click();
  await page.getByRole('button', { name: 'Confirm reviewed archive evidence' }).click();
  await page.getByRole('button', { name: 'Parse', exact: true }).click();
  const quantity = page.getByTestId('clean-inline-quantity-input'); await expect(quantity).toHaveValue('20');
  await quantity.fill('28');
  const workstation = page.getByTestId('clean-order-workstation');
  const readiness = page.getByTestId('clean-readiness-status-bar');
  await expect(readiness).toBeVisible();
  expect(await readiness.evaluate(element => getComputedStyle(element).position)).toBe('sticky');
  const stickyY = (await readiness.boundingBox()).y;
  const workstationScroll = workstation.locator(':scope > .overflow-y-auto');
  const scrollTop = await workstationScroll.evaluate(element => {
    element.scrollTop = Math.min(400, element.scrollHeight - element.clientHeight);
    return element.scrollTop;
  });
  expect(scrollTop).toBeGreaterThan(0);
  expect(Math.abs((await readiness.boundingBox()).y - stickyY)).toBeLessThan(2);
  const unresolved = Number(await readiness.getAttribute('data-unresolved-count'));
  if (unresolved > 0) {
    await readiness.getByRole('button', { name: 'Next Issue' }).click();
    await expect(readiness).not.toHaveAttribute('data-navigation-target', '');
    await page.waitForTimeout(100);
    expect(await workstation.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await expect(quantity).toHaveValue('28');
  }
  const queuePanel = page.getByTestId('clean-queue-panel');
  const queueWidth = (await queuePanel.boundingBox()).width;
  const resize = page.getByRole('button', { name: 'Resize queue panel' });
  const handle = await resize.boundingBox();
  await page.mouse.move(handle.x + 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 40, handle.y + handle.height / 2, { steps: 5 });
  await page.mouse.up();
  expect((await queuePanel.boundingBox()).width).toBeGreaterThan(queueWidth);
  await expect(quantity).toHaveValue('28');
  await page.evaluate(() => {
    const queue = document.querySelector('[data-testid=clean-inbound-queue]');
    window.__queueNode = queue; window.__queueRow = queue.querySelector('button.block');
    window.__editorNode = document.querySelector('[data-testid=clean-order-workstation]');
    window.__quantityNode = document.querySelector('[data-testid=clean-inline-quantity-input]');
    const scroller = queue.querySelector('.overflow-y-auto');
    // A long synthetic queue exercises scroll retention without creating records.
    const spacer = document.createElement('div'); spacer.style.height = '1400px'; scroller.append(spacer); scroller.scrollTop = 140;
    window.__queueScroller = scroller;
    const original = window.fetch;
    window.fetch = async (input, init) => {
      if (String(input).startsWith('/api/inbound-orders?')) {
        window.__listStarted = true;
        await new Promise(resolve => { window.__releaseList = resolve; });
      }
      return original(input, init);
    };
    void window.__fixtureTrustRefresh();
  });
  await page.waitForFunction(() => window.__listStarted === true);
  await page.waitForTimeout(1200);
  const intact = () => page.evaluate(() => window.__queueNode.isConnected && window.__queueRow.isConnected && window.__editorNode.isConnected && window.__quantityNode.isConnected && window.__quantityNode.value === '28' && window.__queueScroller.scrollTop === 140);
  expect(await intact()).toBe(true);
  await page.evaluate(() => window.__releaseList());
  await page.waitForTimeout(500); expect(await intact()).toBe(true);
  for (const theme of ['Light', 'Dark']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    await expect(quantity).toHaveValue('28');
    await page.screenshot({ path: `${out}/inbound-${theme.toLowerCase()}.png` });
  }
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(page.getByTestId('clean-order-workstation')).toBeVisible();
  await expect(quantity).toHaveValue('28');
  await page.screenshot({ path: `${out}/inbound-narrow.png` });
  expect(errors).toEqual([]);
  console.log('INBOUND: sticky readiness, Next Issue focus, queue resizing, delayed background list refresh, light/dark and narrow checks passed. HTTP persistence is mocked.');
} finally { await browser.close(); await server.close(); }
