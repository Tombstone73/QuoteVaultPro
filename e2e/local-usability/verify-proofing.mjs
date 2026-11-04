import { chromium, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
const out = 'node_modules/.cache/usability-browser'; await mkdir(out, { recursive: true });
const snapshot = JSON.parse(await readFile('node_modules/.cache/proof-browser-data.json', 'utf8'));
const { server } = await import('../local-proof-files/server.mjs');
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(20000); const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(`http://127.0.0.1:4198/production/proofing?lineItemId=${snapshot.detail.lineItemId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await expect(page.getByRole('heading', { name: 'Proofing', exact: true })).toBeVisible();
  for (const width of [1440, 900]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['Light', 'Dark']) {
      await page.getByRole('button', { name: `${theme} theme`, exact: true }).click();
      const heading = page.getByRole('heading', { name: 'Proofing', exact: true });
      await expect(heading).toBeVisible();
      const background = await heading.evaluate(node => getComputedStyle(node.closest('header')).backgroundColor);
      if (theme === 'Light') expect(background).toBe('rgb(255, 255, 255)');
      await page.screenshot({ path: `${out}/proofing-${theme.toLowerCase()}-${width}.png` });
    }
  }
  expect(errors).toEqual([]);
  console.log('PROOFING: actual workspace light/dark at desktop/narrow normal zoom; mocked authenticated file HTTP fixture.');
} finally { await browser.close(); await server.close(); }
