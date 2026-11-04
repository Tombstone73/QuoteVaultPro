import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { startFixture } from '../local-inbound-workflow/server.mjs';
const out = 'node_modules/.cache/print-bridge-browser'; await mkdir(out, { recursive: true });
const server = await startFixture(4198, '/e2e/local-print-bridge/fixture.tsx');
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1280, height: 850 }, deviceScaleFactor: 1 }); page.setDefaultTimeout(15000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:4198/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await expect(page.getByRole('status')).toContainText('Connected', { timeout: 60000 });
  for (const [state, label] of [['reconnecting', 'Reconnecting'], ['disconnected', 'Disconnected'], ['authentication_required', 'Authentication Required']]) {
    await page.getByRole('combobox').selectOption(state); await expect(page.getByRole('status')).toContainText(label);
  }
  for (const theme of ['Light', 'Dark']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    const button = page.getByRole('button', { name: 'Restart Bridge Service…', exact: true }); await button.focus(); await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog'); await expect(dialog).toContainText('browser cannot control a Windows service');
    await expect(dialog).toContainText('manage-agent-task.ps1 -Action restart'); await expect(dialog).toContainText('task/controller is missing');
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));
    await page.screenshot({ path: `${out}/${theme.toLowerCase()}.png` }); await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  }
  await page.setViewportSize({ width: 850, height: 850 }); await page.getByRole('button', { name: 'Restart Bridge Service…', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished))); await page.screenshot({ path: `${out}/narrow.png` });
  expect(errors).toEqual([]); console.log('PASS: actual recovery/status components, four states, keyboard opening/closing, local controller fallback, normal zoom, light/dark and narrow. Synthetic status only; no Windows service or printer calls.');
} finally { await browser.close(); await server.close(); }
