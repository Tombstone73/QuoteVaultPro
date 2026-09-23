/** Local browser smoke for real V1 UI with in-memory HTTP fixtures only.
 * Run after npm run build: node scripts/qa/contact-order-local-ui.mjs
 * No application server, database, credentials, or external requests are used.
 */
import assert from 'node:assert/strict';
import { preview } from 'vite';
import { chromium } from 'playwright';

const server = await preview({ preview: { host: '127.0.0.1', port: 4187, strictPort: true } });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('pageerror', error => console.error('Browser error:', error.message));
const origin = 'http://127.0.0.1:4187';
const customer = { id: 'company-1', companyName: 'ISF Signs', status: 'active' };
const contact = { id: 'contact-1', customerId: customer.id, firstName: 'Logan', lastName: 'Payne', email: 'logan@example.test', linkedCustomers: [] };
let order = {
  id: 'order-1', orderNumber: '20068', displayNumber: 'ORD-20068', state: 'open', status: 'new',
  customerId: customer.id, customer, contactId: contact.id, contact, lineItems: [],
  subtotal: '0.00', total: '0.00', tax: '0.00', discount: '0.00', priority: 'normal',
  fulfillmentStatus: 'pending', shippingCents: 0, createdAt: '2026-09-01T12:00:00Z', updatedAt: '2026-09-01T12:00:00Z',
};
const patches = [];
const requests = new Set();
let historical = false;
await page.route('**/*', async route => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.pathname.startsWith('/api/')) {
    requests.add(url.pathname);
    let body = { success: true, data: [] };
    let status = 200;
    if (url.pathname === '/api/auth/session') body = { authenticated: true, user: { id: 'staff-1', role: 'admin', isAdmin: true, accountType: 'STAFF', email: 'staff@example.test' } };
    else if (url.pathname === '/api/me/orgs') body = { success: true, data: { orgs: [{ id: 'org-1', name: 'Test only', slug: 'test', role: 'admin' }], lastActiveOrgId: 'org-1' } };
    else if (url.pathname === '/api/organization/preferences') body = { success: true, data: { orders: {}, inventory: { reservations: { mode: 'off' } } } };
    else if (url.pathname === '/api/system/environment') body = { success: true, data: { appRuntime: 'local', apiRuntime: 'local', databaseRuntime: 'unknown', databaseLabel: 'No database: mocked HTTP', canMutateSharedDevData: false, migrationRunsOnStartup: false, warningMessage: null, buildFingerprint: { gitSha: null, buildId: 'local-ui', environment: 'local', operatorArchitectureVersion: 'v1' } } };
    else if (url.pathname === '/api/operational-summary') body = { success: true, data: { inboundOrders: 0, overview: 0, design: 0, proofing: 0, prepress: 0, flatbed: 0, roll: 0, fulfillment: 0, invoices: { readyToFinalizeNeverSent: 0, pendingSend: 0, unpaid: 0 } } };
    else if (url.pathname === '/api/orders/order-1') {
      if (request.method() === 'PATCH') {
        const patch = request.postDataJSON();
        patches.push(patch);
        if (historical) { status = 400; body = { code: 'ORDER_INVOICE_CUSTOMER_REVIEW_REQUIRED', message: 'This Invoice has payment history. Billing ownership cannot be changed through the Order editor; review the Invoice first.' }; }
        else { order = { ...order, ...patch, customer: patch.customerId === null ? null : order.customer }; body = order; }
      } else body = order;
    }
    else if (url.pathname === '/api/customers/company-1') body = { ...customer, contacts: [contact] };
    else if (url.pathname === '/api/customers') body = { customers: [customer], data: { customers: [customer], pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 } } };
    else if (url.pathname === '/api/products') body = [];
    else if (url.pathname === '/api/contacts/contact-1') body = { contact, customer };
    else if (url.pathname === '/api/contacts') body = { contacts: [contact], total: 1 };
    else if (url.pathname.includes('payment-resolution')) body = { success: true, data: { resolutionStatus: 'NO_INVOICE', invoiceCandidates: [], selectedInvoice: null } };
    else if (url.pathname.includes('workflow')) body = { success: true, data: { statuses: [], transitions: [] } };
    else if (url.pathname === '/api/invoices' || url.pathname.includes('/shipments')) body = [];
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    return;
  }
  if (url.origin !== origin) { await route.abort(); return; }
  await route.continue();
});
try {
  await page.goto(`${origin}/orders/order-1/edit`);
  await page.getByRole('button', { name: 'Clear customer', exact: true }).waitFor();
  assert.ok((await page.locator('body').innerText()).includes('Logan Payne'));
  await page.getByRole('button', { name: 'Clear customer', exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes('Order updated successfully'));
  assert.deepEqual(patches[0], { customerId: null });
  assert.equal(order.contactId, contact.id);
  await page.reload();
  await page.getByRole('combobox').filter({ hasText: 'Logan Payne' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Clear customer', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Clear contact', exact: true }).click();
  await page.getByText('Select a customer or contact for this order.', { exact: true }).waitFor();
  assert.equal(patches.length, 1, 'Neither-owner clear must not submit');

  // Contact-only editable state uses canonical global Contact search.
  order = { ...order, contactId: null, contact: null };
  await page.reload();
  await page.getByRole('combobox').filter({ hasText: 'Search contacts...' }).click();
  await page.getByRole('option').filter({ hasText: 'Logan Payne' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('Order updated successfully'));
  assert.deepEqual(patches.at(-1), { contactId: contact.id });
  assert.equal(order.customerId, null);

  order = { ...order, customerId: customer.id, customer, contactId: null, contact: null };
  await page.reload();
  await page.getByRole('button', { name: 'Clear customer', exact: true }).click();
  await page.getByText('Select a customer or contact for this order.', { exact: true }).waitFor();
  assert.equal(order.customerId, customer.id, 'Customer-only Order is retained');

  historical = true;
  order = { ...order, contactId: contact.id, contact };
  await page.reload();
  await page.getByRole('button', { name: 'Clear customer', exact: true }).click();
  await page.getByText(/This Invoice has payment history/).waitFor();
  assert.equal(order.customerId, customer.id);
  await page.goto(`${origin}/orders/new`);
  // New Order autofocus opens the Customer picker after initial layout.
  await page.getByRole('option').filter({ hasText: 'ISF Signs' }).first().waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('combobox').filter({ hasText: 'Search contacts...' }).click();
  await page.getByRole('option').filter({ hasText: 'Logan Payne' }).click();
  await page.getByRole('combobox').filter({ hasText: 'Logan Payne' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Clear customer', exact: true }).count(), 0, 'Contact selection must not auto-select its company on New Order');
  await page.getByRole('combobox').filter({ hasText: 'Search customers...' }).click();
  await page.getByRole('option').filter({ hasText: 'ISF Signs' }).first().click();
  await page.getByRole('button', { name: 'Clear customer', exact: true }).click();
  await page.getByRole('combobox').filter({ hasText: 'Logan Payne' }).waitFor();
  console.log('PASS: real Order Detail clear/autosave, retained Contact, reload, global Contact selection, neither-owner guard, Customer-only preservation, historical error UX; New Order contact-only selection and visible Customer clear. HTTP persistence is mocked; Invoice retarget/database persistence are NOT verified by this smoke.');
} catch (error) {
  console.error('UI:', (await page.locator('body').innerText()).slice(0, 7000));
  console.error('API paths:', [...requests]);
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
