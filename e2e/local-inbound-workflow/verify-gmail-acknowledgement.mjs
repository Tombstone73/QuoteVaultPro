import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { startFixture } from './server.mjs';
// Real Settings and Inbound components; all HTTP, Gmail and browser persistence are synthetic.
const server = await startFixture(4197);
const browser = await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try {
  const output='node_modules/.cache/inbound-workflow';await mkdir(output,{recursive:true});
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  page.setDefaultTimeout(45000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4197/inbound-orders?gmail-status=1',{waitUntil:'domcontentloaded',timeout:90000});
  const panel=page.getByRole('region',{name:'Gmail updates',exact:true});
  const toggle=panel.getByRole('button',{name:/^Gmail updates/});
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  await expect(toggle).toContainText('Paused');await expect(toggle).toContainText('1 pending');
  const details=panel.locator('div[id]').first();
  expect((await panel.boundingBox()).height).toBeLessThan(65);
  await toggle.focus();await page.keyboard.press('Enter');await expect(toggle).toHaveAttribute('aria-expanded','true');
  await expect(details).toContainText('Order QA-1 created');await expect(details.getByRole('link',{name:'View Order'})).toHaveAttribute('href','/orders/qa-order-0');
  await page.keyboard.press('Space');await expect(toggle).toHaveAttribute('aria-expanded','false');
  await page.evaluate(()=>window.__fixtureGmail(35));
  await expect(toggle).toContainText('35 pending');await expect(toggle).toHaveAttribute('aria-expanded','false');
  await toggle.click();
  await expect(details.locator('[role="status"]')).toHaveCount(35);
  const dimensions=await details.evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight}));
  expect(dimensions.height).toBeLessThanOrEqual(192);expect(dimensions.scroll).toBeGreaterThan(dimensions.height);
  await expect(page.getByTestId('clean-queue-panel')).toBeVisible();
  const queue=page.getByTestId('clean-queue-panel');
  const expandedQueue=await queue.boundingBox();
  await toggle.click();
  const collapsedQueue=await queue.boundingBox();
  expect(collapsedQueue.width).toBeCloseTo(expandedQueue.width,0);
  expect(collapsedQueue.y).toBeLessThan(expandedQueue.y);
  await page.reload({waitUntil:'domcontentloaded'});await expect(toggle).toHaveAttribute('aria-expanded','false');
  await toggle.click();await page.reload({waitUntil:'domcontentloaded'});await expect(toggle).toHaveAttribute('aria-expanded','true');
  await toggle.click();
  await page.evaluate(()=>window.__fixtureGmail(35));
  for(const theme of ['Light','Dark']){
    await page.getByRole('button',{name:theme,exact:true}).click();
    await page.evaluate(()=>window.getSelection()?.removeAllRanges());
    await expect(toggle).toHaveAttribute('aria-expanded','false');
    await page.screenshot({path:`${output}/gmail-collapsed-${theme.toLowerCase()}.png`});
    await toggle.click();await page.screenshot({path:`${output}/gmail-expanded-${theme.toLowerCase()}.png`});await toggle.click();
  }
  await page.evaluate(()=>window.__fixtureGmail(35));
  // Failures remain announced in the collapsed summary and retry stays available inside.
  await page.goto('http://127.0.0.1:4197/inbound-orders?gmail-status=35');
  await expect(toggle).toContainText('2 need attention');await toggle.click();
  await expect(details.getByRole('button',{name:'Retry Gmail update'})).toHaveCount(2);
  await page.goto('http://127.0.0.1:4197/settings/email?gmail-status=3');
  const control=page.getByRole('region',{name:'Gmail acknowledgement for qa@example.invalid'});
  await expect(control).toContainText('global worker safety lock');
  await expect(control).toContainText('Pending: 3');await expect(control).toContainText('Failed / needs attention: 2');
  const optin=control.getByRole('switch');await expect(optin).toBeChecked();
  await optin.click();await expect(optin).not.toBeChecked();
  expect(await page.evaluate(()=>window.__fixtureGmailPreference())).toBe(false);
  await page.reload();await expect(optin).not.toBeChecked();
  await optin.click();await expect(optin).toBeChecked();await expect(control).toContainText('Paused');
  await page.evaluate(()=>window.__fixtureGmail(3,'worker_pause'));await expect(control).toContainText('worker is disabled');
  await page.evaluate(()=>window.__fixtureGmail(3,'tenant_not_enrolled'));await expect(control).toContainText('not enrolled');
  await page.evaluate(()=>window.__fixtureGmail(3,'',false));await expect(control).toContainText('Permission Required');
  await page.evaluate(()=>window.__fixtureGmail(3,'',true));await expect(control.locator('[role="status"]')).toContainText('Enabled');
  for(const theme of ['Light','Dark']){
    await page.getByRole('button',{name:theme,exact:true}).click();await control.scrollIntoViewIfNeeded();
    await expect(control.locator('[role="status"] > div').first()).toHaveCSS('transition-duration','0s');
    await page.evaluate(()=>window.getSelection()?.removeAllRanges());
    await page.screenshot({path:`${output}/gmail-settings-${theme.toLowerCase()}.png`});
  }
  expect(errors).toEqual([]);
  console.log('PASS: Gmail disclosure, long list, counts, background refresh, persisted preferences, keyboard, returned workspace height, light/dark; Settings canonical preference save/readback and independent gates. Synthetic HTTP/Gmail/storage only.');
} finally {await browser.close();await server.close();}
