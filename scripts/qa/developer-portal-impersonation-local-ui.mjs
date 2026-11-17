/** Synthetic browser smoke for the real built UI. No customer records, credentials, or external requests. */
import assert from 'node:assert/strict';
import { preview } from 'vite';
import { chromium } from 'playwright';

const server = await preview({ preview: { host: '127.0.0.1', port: 4189, strictPort: true } });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
let portal;
const origin = 'http://127.0.0.1:4189';
const requests = [];
let active = false;
let checkoutAttempts = 0;
const customer = { id: 'customer-a', companyName: 'Synthetic Customer', customerType: 'business', status: 'active', email: 'company@example.test', phone: '555-0100', createdAt: '2026-01-01', updatedAt: '2026-01-01', contacts: [{ id: 'contact-a', firstName: 'Bill', lastName: 'Buyer', email: 'bill@example.test', isPrimary: true, isBilling: true }], notes: [], quotes: [], creditTransactions: [] };
const invoice = { id: 'synthetic-20972', invoiceNumber: 20972, displayNumber: '20972', status: 'billed', paymentStatusLabel: 'Unpaid', amountDue: 125.70, amountPaid: 0, total: 125.70, subtotal: 125.70, tax: 0, currency: 'USD', issueDate: null, dueDate: null, paymentEligibility: { payable: true, blockedReason: null, reasonCode: null } };
const session = { userId: 'portal-user-a', customerId: customer.id, customerName: customer.companyName, permissions: { canPayInvoices: true, canViewInvoices: true, canViewOrders: true, canViewProofs: true }, staffPreview: null, developerImpersonation: { active: true, accessId: 'access-a', contactName: 'Bill Buyer', email: 'bill@example.test', role: 'BILLING', startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), returnTo: '/customers/customer-a', readOnly: true } };
await context.route('**/*', async route => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.pathname.startsWith('/api/')) {
    requests.push(`${request.method()} ${url.pathname}`);
    let body = { success: true, data: [] };
    let status = 200;
    if (url.pathname === '/api/auth/session') body = { authenticated: true, user: { id: 'developer-a', role: 'employee', accountType: 'INTERNAL_USER', isPlatformDeveloper: true, email: 'developer@example.test' } };
    else if (url.pathname === '/api/me/orgs') body = { success: true, data: { orgs: [{ id: 'org-a', name: 'Synthetic tenant', slug: 'synthetic', role: 'member' }], lastActiveOrgId: 'org-a' } };
    else if (url.pathname === '/api/organization/preferences') body = { success: true, data: { orders: {}, inventory: { reservations: { mode: 'off' } } } };
    else if (url.pathname === '/api/system/environment') body = { success: true, data: { appRuntime: 'local', apiRuntime: 'local', databaseRuntime: 'unknown', databaseLabel: 'Synthetic HTTP fixture', canMutateSharedDevData: false, migrationRunsOnStartup: false, warningMessage: null, buildFingerprint: { gitSha: null, buildId: 'local-ui', environment: 'local', operatorArchitectureVersion: 'v1' } } };
    else if (url.pathname === '/api/operational-summary') body = { success: true, data: { inboundOrders: 0, overview: 0, design: 0, proofing: 0, prepress: 0, flatbed: 0, roll: 0, fulfillment: 0, invoices: { readyToFinalizeNeverSent: 0, pendingSend: 0, unpaid: 0 } } };
    else if (url.pathname === '/api/orders') body = [];
    else if (url.pathname === '/api/invoices') body = { items: [], pagination: { page: 1, pageSize: 50, totalCount: 0, totalPages: 0 } };
    else if (url.pathname === '/api/customers/customer-a') body = customer;
    else if (url.pathname === '/api/customers/customer-a/portal-impersonation/access') body = { success: true, data: [{ id: 'access-a', customerId: customer.id, contactId: 'contact-a', userId: 'portal-user-a', email: 'bill@example.test', status: 'ACTIVE', accessRole: 'BILLING' }] };
    else if (url.pathname === '/api/customers/customer-a/account-credit') body = { availableCents: 0 };
    else if (url.pathname === '/api/portal/impersonation/start' && request.method() === 'POST') { active = true; body = { success: true, data: { redirectTo: '/portal?impersonation=1', expiresAt: session.developerImpersonation.expiresAt } }; }
    else if (url.pathname === '/api/portal/impersonation/end' && request.method() === 'POST') { active = false; body = { success: true, data: { returnTo: '/customers/customer-a' } }; }
    else if (url.pathname === '/api/portal/impersonation/session') { active = false; status = 403; body = { success: false, code: 'IMPERSONATION_EXPIRED' }; }
    else if (url.pathname === '/api/portal/me') { if (!active) { status = 403; body = { success: false, code: 'IMPERSONATION_REQUIRED' }; } else body = { success: true, data: session }; }
    else if (url.pathname === '/api/portal/dashboard') body = { success: true, data: { summary: { openInvoiceCount: 1, outstandingBalance: 125.70, activeOrderCount: 0, quotesNeedingAction: 0, proofsAwaitingApproval: 0 }, invoices: [invoice], quotes: [], activeOrders: [], proofs: [], recentFiles: [], recentActivity: [] } };
    else if (url.pathname === '/api/portal/invoices') body = { success: true, data: [invoice] };
    else if (url.pathname === '/api/portal/invoices/synthetic-20972') body = { success: true, data: invoice };
    else if (url.pathname === '/api/portal/invoices/synthetic-20972/payments') body = { success: true, data: [] };
    else if (url.pathname === '/api/portal/invoices/synthetic-20972/files') body = { success: true, data: [] };
    else if (url.pathname === '/api/portal/invoices/synthetic-20972/impersonation-diagnostics') body = { success: true, data: { invoiceNumber: '20972', customerName: customer.companyName, contactName: 'Bill Buyer', portalAccessId: 'access-a', portalRole: 'BILLING', invoiceStatus: 'billed', customerReleased: true, accountingApproved: true, outstandingBalance: 125.70, currency: 'USD', customerInvoiceVisible: true, customerCanPayInvoices: true, selectedProvider: 'stripe', providerReadiness: 'ready', providerReason: null, customerCheckoutEligible: true, blockingReason: null, lastCheckoutFailure: null, developerMayInitiatePayment: false } };
    else if (request.method() !== 'GET') { checkoutAttempts++; status = 403; body = { success: false, code: 'IMPERSONATION_READ_ONLY' }; }
    else if (url.pathname.includes('destinations')) body = { data: { localPath: null } };
    else if (url.pathname.includes('account-credit')) body = { availableCents: 0 };
    else if (url.pathname.includes('activity')) body = [];
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    return;
  }
  if (url.origin !== origin) { await route.abort(); return; }
  await route.continue();
});
try {
  await page.goto(`${origin}/customers/customer-a`);
  await page.getByRole('button', { name: 'Login as Customer' }).waitFor({ timeout: 15_000 });
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Login as Customer' }).click();
  portal = await popupPromise;
  await portal.getByText('Viewing as Bill Buyer at Synthetic Customer').waitFor({ timeout: 15_000 });
  await portal.goto(`${origin}/portal/invoices/synthetic-20972`);
  await portal.getByText('Customer checkout eligibility').waitFor({ timeout: 15_000 });
  assert.match(await portal.locator('body').innerText(), /Customer checkout eligibility\s+Eligible/);
  assert.match(await portal.locator('body').innerText(), /Developer may initiate payment\s+No/);
  assert.equal(await portal.getByRole('button', { name: /Pay \$/ }).count(), 0);
  await portal.getByRole('button', { name: 'Change portal theme' }).first().click();
  await portal.getByRole('menuitem', { name: /Light/ }).click();
  assert.equal(await portal.locator('html').evaluate(node => node.classList.contains('dark')), false);
  await portal.getByRole('button', { name: 'Change portal theme' }).first().click();
  await portal.getByRole('menuitem', { name: /Dark/ }).click();
  await portal.keyboard.press('Escape');
  assert.equal(await portal.locator('html').evaluate(node => node.classList.contains('dark')), true);
  assert.equal(await portal.getByText('Viewing as Bill Buyer at Synthetic Customer').isVisible(), true);
  await portal.reload();
  await portal.getByText('Viewing as Bill Buyer at Synthetic Customer').waitFor();
  await portal.setViewportSize({ width: 390, height: 800 });
  const exit = portal.getByRole('button', { name: 'Exit Impersonation' });
  assert.equal(await exit.isVisible(), true);
  await exit.click();
  await portal.waitForURL('**/customers/customer-a');
  assert.equal(active, false);
  assert.equal(checkoutAttempts, 0);
  assert.equal(await page.getByRole('button', { name: 'Login as Customer' }).count(), 1);
  session.developerImpersonation.expiresAt = new Date(Date.now() + 10_000).toISOString();
  const expiryPopupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Login as Customer' }).click();
  const expiredPortal = await expiryPopupPromise;
  await expiredPortal.getByText('Viewing as Bill Buyer at Synthetic Customer').waitFor();
  await expiredPortal.clock.install();
  await expiredPortal.clock.fastForward(35_000);
  await expiredPortal.waitForURL('**/customers/customer-a');
  assert.equal(active, false);
  console.log('PASS: synthetic Developer Customer Detail -> exact portal login -> invoice diagnostics -> read-only payment UI -> light/dark -> narrow exit/expiry -> staff customer page; no checkout request.');
} catch (error) {
  console.error('UI:', (await page.locator('body').innerText()).slice(0, 3500));
  if (portal) console.error('Portal UI:', portal.url(), (await portal.locator('body').innerText()).slice(0, 2500));
  console.error('API paths:', requests);
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
