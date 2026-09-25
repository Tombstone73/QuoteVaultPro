import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

try { const browser = await webkit.launch({ headless: true }); await browser.close(); console.log('WebKit executable available'); }
catch (error) { console.log('WebKit unavailable:', error.message.split('\n')[0]); }
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const batches = [];
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  page.on('request', request => { if (request.url().endsWith('/diagnostics')) batches.push(JSON.parse(request.postData())); });
  await page.goto('http://127.0.0.1:4191/fixture');
  const pay = page.getByRole('button', { name: 'Pay', exact: true });
  await pay.waitFor();
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === 'Pay')?.disabled);
  const field = page.frameLocator('iframe');
  await field.getByLabel('Fixture input').pressSequentially('benign fixture text');
  await field.getByLabel('Fixture input').press('Tab');
  await field.getByLabel('Fixture input').click();
  await field.getByRole('button', { name: 'Simulate complete' }).click();
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 390, height: 400 }, { width: 844, height: 390 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.waitForFunction(height => document.querySelector('[role=dialog]')?.style.getPropertyValue('--payment-viewport-height') === `${height}px`, viewport.height);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.locator('[role=dialog]').evaluate(async dialog => { await Promise.all(dialog.getAnimations().map(animation => animation.finished.catch(() => {}))); });
    const geometry = await page.evaluate(() => {
      const dialog = document.querySelector('[role=dialog]'), body = document.querySelector('[data-testid=stripe-payment-scroll-body]');
      const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Pay');
      const rect = button.getBoundingClientRect(), bounds = dialog.getBoundingClientRect();
      body.scrollTop = body.scrollHeight;
      return { ...window.fixtureAudit, dialogTop: bounds.top, dialogBottom: bounds.bottom, bodyHeight: body.clientHeight,
        scrollable: body.scrollHeight > body.clientHeight, scrollTop: body.scrollTop,
        horizontalOverflow: dialog.scrollWidth > dialog.clientWidth || body.scrollWidth > body.clientWidth,
        payReachable: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === button,
        pageLocked: document.body.hasAttribute('data-scroll-locked') };
    });
    console.log(JSON.stringify({ viewport, ...geometry }));
    assert.equal(geometry.mounts, 1); assert.equal(geometry.unmounts, 0); assert.equal(geometry.horizontalOverflow, false);
    assert.equal(geometry.payReachable, true); assert.equal(geometry.pageLocked, true);
    assert.ok(geometry.dialogTop >= 0 && geometry.dialogBottom <= viewport.height);
    if (viewport.height === 400) { assert.equal(geometry.scrollable, true); assert.ok(geometry.scrollTop > 0); }
    if (viewport.height === 400) await page.screenshot({ path: path.join(os.tmpdir(), 'stripe-payment-fixed-mobile.png') });
  }
  await pay.click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('alert').innerText(), 'Your card expiration date is incomplete.');
  assert.equal(await page.evaluate(() => window.fixtureAudit.confirms), 0);
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  await page.waitForResponse(response => response.url().endsWith('/diagnostics') && response.status() === 204);
  const events = batches.flatMap(batch => batch.events);
  for (const event of ['dialog_open', 'element_mount', 'element_ready', 'element_change', 'viewport_change', 'submit_result', 'dialog_close']) assert.ok(events.some(e => e.event === event), event);
  assert.ok(events.some(e => e.event === 'element_change' && e.complete === false && e.empty === false));
  assert.ok(events.some(e => e.event === 'element_change' && e.complete === true));
  const wire = JSON.stringify(batches);
  for (const forbidden of ['NEVER_LOG_RAW_EVENT', 'secret_fixture_never_log', 'benign fixture text', 'clientSecret', 'payment_method']) assert.ok(!wire.includes(forbidden), forbidden);
  assert.equal(new Set(batches.map(batch => batch.sessionId)).size, 1);
  console.log('Lifecycle/validation diagnostics and network payload safety: passed');
  await page.setViewportSize({ width: 390, height: 400 });
  await page.goto('http://127.0.0.1:4191/fixture?grouped=1');
  await page.getByTestId('stripe-payment-scroll-body').waitFor();
  await pay.click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.evaluate(() => window.fixtureAudit.mounts), 1);
  console.log('Grouped checkout short viewport: Pay reachable; validation still blocks confirmation');
} finally { await browser.close(); }
