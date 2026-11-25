// Run after seeding the private M5 DB and starting the local M5 application:
// node scripts/qa/m5-browser-journey.mjs ORDER_ID LINE_2_ID RUNNING_JOB_ID
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import pg from 'pg';
import { execFileSync } from 'node:child_process';

const origin = 'http://127.0.0.1:5165';
const ids = process.argv.slice(2);
assert.ok(ids.length === 3 && ids.every(id => /^[a-zA-Z0-9_-]{1,100}$/.test(id)), 'Supply three synthetic fixture IDs');
const [orderId, lineId, jobId] = ids;
// This acceptance test must not accept operator-supplied connection URLs or credentials.
const db = new pg.Client({ host: '127.0.0.1', port: 55605, database: 'printershero_m5_browser_test', user: 'postgres', ssl: false,
  password: 'disposable-fixture-only', options: '-c default_transaction_read_only=on' });
async function evidence() {
  const { rows: [facts] } = await db.query(`SELECT
    (SELECT status FROM production_jobs WHERE id=$1 AND order_id=$2 AND line_item_id=$3) AS job,
    (SELECT count(*)::int FROM production_events WHERE production_job_id=$1 AND payload->>'eventType'='production_job_completed') AS completions,
    (SELECT count(*)::int FROM production_jobs WHERE order_id=$2 AND line_item_id=$3) AS jobs,
    (SELECT count(*)::int FROM shipments) AS shipments,
    (SELECT count(*)::int FROM fulfillment_ready_quantities) AS ready_rows`, [jobId, orderId, lineId]);
  return facts;
}
const marker = await fetch(`${origin}/__m5/isolation`, { redirect: 'error' });
assert.equal(marker.status, 200);
const isolation = await marker.json();
assert.equal(isolation.database, 'printershero_m5_browser_test');
assert.equal(isolation.provider, 'scripted');
assert.ok(process.env.M5_RUN_ID && isolation.runId === process.env.M5_RUN_ID, 'Require public run ID from guarded launcher');
assert.equal(isolation.sourceSha, execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
const fixture = (...args) => JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', 'scripts/qa/m5-browser-fixture.ts', ...args], { encoding: 'utf8', env: { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TSX_DISABLE_CACHE: '1' } }));
const initial = fixture('check-before');

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [
  '--disable-background-networking', '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
] });
try {
  await db.connect();
  const before = await evidence();
  assert.deepEqual(before, { job: 'in_progress', completions: 0, jobs: 1, shipments: 0, ready_rows: 0 });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, serviceWorkers: 'block' });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await context.routeWebSocket('**/*', ws => ws.url().startsWith('ws://127.0.0.1:5165/') ? ws.connectToServer() : ws.close());
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => console.warn('Local page error:', error.message.slice(0, 180)));
  page.on('response', res => { if (res.status() >= 400 && res.url().startsWith(origin + '/api/')) console.warn('Local HTTP', res.status(), new URL(res.url()).pathname); });
  const step = s => console.log(`M5 browser: ${s}`);
  await page.goto(origin + '/login', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('your@email.com').fill('m5-browser@example.invalid');
  await page.getByPlaceholder('Password', { exact: true }).fill('intentionally-wrong-fixture-password');
  const badLogin = page.waitForResponse(r => r.url().endsWith('/api/auth/login'));
  await page.locator('form button[type="submit"]').click();
  assert.equal((await badLogin).status(), 401, 'Fixture password identity must reject incorrect password');
  await page.getByPlaceholder('Password', { exact: true }).fill('M5-Local-Only!2026');
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL('**/dashboard'); step('signed in through normal login');
  await page.goto(`${origin}/orders/${orderId}`, { waitUntil: 'domcontentloaded' });
  const row = page.locator(`[data-order-line-id="${lineId}"]`);
  await row.waitFor();
  const badge = row.locator('.h-5.font-medium');
  await badge.filter({ hasText: /^(?:[\w ]+ in progress|In Production)$/i }).first().waitFor();
  assert.equal(await page.locator(`[data-parent-order-id="${orderId}"]:visible`).nth(1).getAttribute('data-order-line-id'), lineId);
  step('opened synthetic order and verified displayed line 2');
  const opened = fixture('check-before'); // Native Order Detail reads can reconcile billing metadata.
  assert.equal(opened.commercialHash, initial.commercialHash);
  await page.getByRole('button', { name: 'Open PrintersHero assistant' }).click();
  const workspace = page.getByRole('region', { name: 'PrintersHero assistant workspace' });
  async function turn(text) {
    await workspace.getByLabel('Message the assistant').fill(text);
    const response = page.waitForResponse(r => r.url().endsWith('/turns') && r.request().method() === 'POST');
    await workspace.getByRole('button', { name: 'Send message' }).click();
    const res = await response; assert.equal(res.status() < 300, true, `Turn HTTP ${res.status()}`);
    assert.equal(res.request().postDataJSON().context.entityId, orderId);
    return JSON.stringify(await res.json());
  }
  const readiness = await turn('Why are these lights red?');
  assert.match(readiness, /orders\.current_readiness|Current order readiness/i);
  await workspace.getByText(/current order readiness|action needed|in progress/i).first().waitFor();
  step('read native readiness in the assistant');
  const review = await turn('Mark line 2 production complete.');
  assert.ok(review.includes(jobId) && review.includes(lineId) && review.includes('production.complete_job'), 'Review must identify the fixture line and job');
  const go = workspace.getByRole('button', { name: 'GO: Production Complete Job', exact: true }).last();
  await go.waitFor();
  assert.ok((await workspace.innerText()).includes(jobId), 'Visible review identifies the real job');
  step('verified job review before GO');
  assert.deepEqual(await evidence(), before, 'A review must not mutate the job');
  assert.equal(fixture('check-before').effectsHash, opened.effectsHash, 'A review must not consume or schedule anything');
  console.log('Reviewed GO control:', await go.innerText(), 'enabled:', await go.isEnabled());
  const [res] = await Promise.all([page.waitForResponse(r => /\/plans\/[^/]+\/confirmations$/.test(r.url()) && r.request().method() === 'POST'), go.click()]);
  const first = await res.json();
  assert.equal(first.data?.result?.status, 'succeeded', `GO HTTP ${res.status()}: ${first.data?.result?.status ?? 'no result'}`);
  assert.ok(first.data.result.summary.includes(`Completed production job ${jobId}`));
  await workspace.getByText(first.data.result.summary, { exact: true }).first().waitFor();
  step('GO rendered native completion receipt');
  const after = await evidence();
  assert.deepEqual(after, { job: 'done', completions: 1, jobs: 2, shipments: 0, ready_rows: 0 });
  const committed = fixture('check-after', initial.commercialHash);
  // Deliberately repeat the same browser request, not a newly issued plan or token.
  const replay = await page.evaluate(async ({ url, body }) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, credentials: 'same-origin' });
    return (await r.json()).data?.result;
  }, { url: res.url(), body: res.request().postData() });
  assert.deepEqual(replay, first.data.result);
  assert.deepEqual(await evidence(), after, 'Replayed receipt must not duplicate native effects');
  fixture('check-replay', committed.effectsHash);
  step('identical GO returned its original result');
  await page.getByRole('button', { name: 'Minimize assistant' }).click();
  await badge.filter({ hasText: /^(?:Production complete, awaiting fulfillment|Completed)$/i }).first().waitFor();
  step('native order row refreshed after completion');
} finally { await browser.close(); await db.end(); }
