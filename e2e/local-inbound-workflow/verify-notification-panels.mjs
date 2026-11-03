import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { startFixture } from './server.mjs';
// Actual application components; all HTTP/provider/storage responses are synthetic.
const server = await startFixture(4196);
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  const output = 'node_modules/.cache/inbound-workflow'; await mkdir(output, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(45000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const open = () => page.goto('http://127.0.0.1:4196/inbound-orders?status-panels&gmail-status=35', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await open();
  const panels = ['Email import progress', 'AI draft needs attention', 'Gmail updates', 'Email Pull Paused'];
  const button = title => page.getByRole('button', { name: new RegExp(`^${title}`) }).filter({has:page.locator('[role="status"]')});
  const details = async title => page.locator(`[id="${await button(title).getAttribute('aria-controls')}"]`);
  for (const title of panels) await expect(button(title)).toHaveAttribute('aria-expanded', 'false');
  await expect(button('Email import progress')).toContainText('5 need attention');
  await expect(button('Gmail updates')).toContainText('2 need attention');
  const queue = page.getByTestId('clean-queue-panel');
  const collapsed = await queue.boundingBox();
  for (const title of panels) await button(title).click();
  for (const title of ['Email import progress', 'Gmail updates']) {
    const size = await (await details(title)).evaluate(el => ({height: el.clientHeight, scroll: el.scrollHeight}));
    expect(size.height).toBeLessThanOrEqual(192); expect(size.scroll).toBeGreaterThan(size.height);
  }
  for (const title of panels) await button(title).click();
  expect((await queue.boundingBox()).y).toBeCloseTo(collapsed.y, 0);
  expect((await queue.boundingBox()).width).toBeCloseTo(collapsed.width, 0);
  await page.evaluate(() => window.__fixtureGmail(45));
  await expect(button('Gmail updates')).toContainText('45 pending');
  for (const title of panels) await expect(button(title)).toHaveAttribute('aria-expanded', 'false');
  for (const title of panels) await button(title).click();
  await page.reload({waitUntil:'domcontentloaded'});
  for (const title of panels) await expect(button(title)).toHaveAttribute('aria-expanded', 'true');
  for (const title of panels) await button(title).click();
  await page.evaluate(() => window.__fixtureLinkedEvidence());
  const linked = button('Linked evidence');
  await expect(linked).toHaveAttribute('aria-expanded', 'false');
  await expect(linked).toContainText('linked Order requires review');
  await linked.focus(); await page.keyboard.press('Enter');
  await expect(linked).toHaveAttribute('aria-expanded', 'true');
  await expect((await details('Linked evidence')).getByRole('link', {name:'Open linked Order'})).toHaveAttribute('href','/orders/qa-order-1');
  await page.keyboard.press('Space'); await expect(linked).toHaveAttribute('aria-expanded', 'false');
  await page.evaluate(() => window.__fixtureLinkedEvidence());
  await expect(linked).toHaveAttribute('aria-expanded', 'false');
  await page.goto('http://127.0.0.1:4196/inbound-orders?linked-evidence&status-panels&gmail-status=35', {waitUntil:'domcontentloaded'});
  await expect(linked).toHaveAttribute('aria-expanded', 'false');
  await linked.click(); await page.reload({waitUntil:'domcontentloaded'});
  await expect(linked).toHaveAttribute('aria-expanded', 'true');
  await linked.click();
  for (const theme of ['Light', 'Dark']) {
    await page.getByRole('button', {name:theme,exact:true}).click();
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.screenshot({path:`${output}/notifications-collapsed-${theme.toLowerCase()}.png`});
    for (const title of ['Email import progress', 'Gmail updates', 'Linked evidence', 'Email Pull Paused']) await button(title).click();
    await page.screenshot({path:`${output}/notifications-expanded-${theme.toLowerCase()}.png`});
    for (const title of ['Email import progress', 'Gmail updates', 'Linked evidence', 'Email Pull Paused']) await button(title).click();
  }
  expect(errors).toEqual([]);
  console.log('PASS: all five disclosures, independent preferences/reload, background updates, keyboard Enter/Space, warning summaries, capped long lists, returned workspace height and preserved column width; light/dark at normal zoom. Synthetic HTTP/storage only.');
} finally { await browser.close(); await server.close(); }
