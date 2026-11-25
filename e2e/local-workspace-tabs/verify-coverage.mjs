import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { startFixture } from '../local-inbound-workflow/server.mjs';

const origin = 'http://127.0.0.1:4197';
const output = 'node_modules/.cache/workspace-coverage-browser';
const timestamp = '2026-11-25T12:00:00.000Z';
const reviews = {
  'fixture-a': 'Synthetic Banner Review',
  'fixture-b': 'Synthetic Sign Review',
};
const reviewPath = id => '/admin/product-intake/sessions/' + id + '/review';
const orderTitle = id => 'QA-ORDER-' + id.at(-1).toUpperCase();

function reviewData(id) {
  return {
    intake: {
      sessionId: id, sourceText: 'Synthetic Product Intake navigation fixture.',
      productName: reviews[id], materialAssociationRequired: false, warnings: [], unansweredDecisions: [],
    },
    product: { id: 'product-' + id, name: reviews[id], isActive: false },
    pbv2Tree: {
      id: 'tree-' + id, status: 'DRAFT', groupCount: 0, optionCount: 0, optionGroups: [],
      basePricing: { perSqftCents: null, perPieceCents: null, minimumChargeCents: null },
    },
    publishReadiness: { validationStatus: 'ready', findings: [] },
  };
}

function intakeSession(id) {
  const suggested = value => ({ value, confidence: 90, evidence: [] });
  const behavior = value => ({ behavior: value, confidence: 90, evidence: [] });
  const brief = {
    workflowState: 'REVIEW_READY', source: 'rule_based_fallback',
    productIdentity: { likelyProductName: suggested(reviews[id]), category: suggested('Signs'), productType: suggested('modal_configurable') },
    materialAnalysis: { detectedMaterialReferences: [], likelyMaterialMatches: [], confidence: 90, evidence: [] },
    sizeBehavior: behavior('custom_size'), quantityBehavior: behavior('per_piece'), pricingAnalysis: behavior('square_foot'),
    requiredOptions: [], optionalOptions: [], templateMatches: [], missingDecisions: [], redundantFields: [], draftWarnings: [], sourceEvidence: [],
    overallConfidence: 90,
  };
  return {
    id, sourceType: 'text_description', brief, status: 'draft_created',
    createdProductId: 'product-' + id, createdPbv2TreeVersionId: 'tree-' + id, createdAt: timestamp, updatedAt: timestamp,
  };
}

const envelope = data => ({ success: true, data });

function responseFor(pathname, accountType) {
  if (pathname === '/api/auth/session') {
    if (accountType === 'ANONYMOUS') return { authenticated: false };
    return {
      authenticated: true,
      user: {
        id: accountType === 'PORTAL_CUSTOMER' ? 'fixture-portal' : 'fixture-staff',
        email: 'workspace-fixture@example.invalid', accountType,
        firstName: 'Synthetic', lastName: 'Tester', lastActiveOrgId: 'fixture-org',
        role: accountType === 'PORTAL_CUSTOMER' ? 'customer' : 'admin', isAdmin: accountType === 'STAFF',
      },
    };
  }
  if (pathname === '/api/me/orgs') {
    return envelope({ orgs: [{ id: 'fixture-org', name: 'Synthetic workspace company', slug: 'fixture-org', role: 'owner' }], lastActiveOrgId: 'fixture-org' });
  }
  if (pathname === '/api/orders') return { items: [], total: 0, page: 1, pageSize: 50 };
  if (pathname === '/api/quotes') return { items: [], data: [], total: 0, page: 1, pageSize: 50 };
  if (pathname === '/api/invoices') {
    return { data: [], pagination: { page: 1, pageSize: 50, totalCount: 0, totalPages: 0 }, summary: { total: 0, outstanding: 0, overdue: 0, paid: 0 } };
  }
  if (/^\/api\/orders\/fixture-[ab]$/.test(pathname)) {
    const id = pathname.split('/').at(-1);
    return {
      id, orderNumber: orderTitle(id), customerId: 'fixture-customer', contactId: null,
      customer: { id: 'fixture-customer', companyName: 'Synthetic buyer' }, customerName: 'Synthetic buyer',
      status: 'new', state: 'draft', canonicalState: 'new', label: 'Synthetic order',
      subtotal: '165.00', tax: '0', total: '165.00', balanceDue: '165.00', amountPaid: '0', discount: '0',
      createdAt: timestamp, updatedAt: timestamp, lineItems: [], payments: [], invoices: [], attachments: [],
      shippingMethod: 'pickup',
    };
  }
  if (pathname === '/api/vendors/fixture-vendor') {
    return envelope({ id: 'fixture-vendor', name: 'Synthetic Supplier', paymentTerms: 'Net 30', isActive: true });
  }
  const review = /^\/api\/admin\/product-intake-wizard\/sessions\/(fixture-[ab])\/draft-review$/.exec(pathname);
  if (review) return envelope(reviewData(review[1]));
  if (pathname === '/api/admin/product-intake-wizard/sessions') {
    return envelope({ sessions: Object.keys(reviews).map(intakeSession) });
  }
  const sessionMatch = /^\/api\/admin\/product-intake-wizard\/sessions\/(fixture-[ab])$/.exec(pathname);
  if (sessionMatch) {
    const session = intakeSession(sessionMatch[1]);
    return envelope({
      session, brief: session.brief, questions: [], answers: [],
      readiness: { unansweredRequiredCount: 0, answeredCount: 0, canCreateDraft: false, reviewState: 'ready_for_draft', reviewScore: 90, penalties: [] },
    });
  }
  if (pathname === '/api/admin/product-intake-wizard/ai-readiness') {
    return envelope({ reason: 'ai_disabled', featureReviewEnabled: false, managedEnv: {} });
  }
  if (pathname === '/api/portal/me') {
    return envelope({
      userId: 'fixture-portal', customerId: 'fixture-customer', customerName: 'Synthetic portal customer',
      portalEmail: 'workspace-portal@example.invalid', accountPricing: { supported: false, unsupportedFields: [] },
      permissions: { canViewOrders: true, canViewInvoices: true, canViewQuotes: true },
    });
  }
  if (pathname === '/api/portal/dashboard') {
    return envelope({
      summary: { openInvoiceCount: 0, outstandingBalance: 0, activeOrderCount: 0, quotesNeedingAction: 0, proofsAwaitingApproval: 0 },
      invoices: [], quotes: [], activeOrders: [], proofs: [], recentFiles: [], recentActivity: [],
    });
  }
  return pathname.startsWith('/api/portal/') ? envelope([]) : [];
}

await mkdir(output, { recursive: true });
const server = await startFixture(4197, '/e2e/local-workspace-tabs/app-fixture.tsx');
let browser;
let currentPage;
try {
  const fixtureHtml = await (await fetch(origin + '/')).text();
  browser = await chromium.launch({
    headless: true, executablePath: process.env.WORKSPACE_FIXTURE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });

  const unexpectedRequests = [];
  const errors = [];
  async function openFixture(accountType = 'STAFF') {
    const context = await browser.newContext({ viewport: { width: 1536, height: 1000 } });
    // Only explicit reloads in the fixture should reset browser memory.
    await context.routeWebSocket('**/*', () => {});
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      if (request.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: fixtureHtml });
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (request.method() === 'POST' && url.pathname === '/api/pbv2/pricing-preview') {
        return route.fulfill({ json: envelope(null) });
      }
      if (request.method() !== 'GET') {
        unexpectedRequests.push(request.method() + ' ' + url.pathname);
        return route.fulfill({ status: 405 });
      }
      return route.fulfill({ json: responseFor(url.pathname, accountType) });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    currentPage = page;
    return page;
  }

  const active = page => page.locator('[role="tabpanel"][data-workspace-active="true"]');
  const tabBar = page => page.locator('[data-testid="workspace-tab-bar"]');
  const selected = page => tabBar(page).locator('[role="tab"][aria-selected="true"]');
  const tabs = page => tabBar(page).getByRole('tab');
  const appNavigate = (page, pathname) => page.evaluate(to => window.__navigateAppFixture(to), pathname);
  const openUrl = (page, pathname) => page.goto(origin + pathname, { waitUntil: 'domcontentloaded', timeout: 90000 });
  const closeActive = page => selected(page).locator('..').getByRole('button', { name: /^Close / }).click();

  async function assertWorkspace(page, pathname, heading, tabLabel) {
    await expect.poll(() => new URL(page.url()).pathname).toBe(pathname);
    await expect(active(page)).toHaveCount(1);
    await expect(selected(page)).toHaveCount(1);
    await expect(selected(page)).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const panel = document.querySelector('[role="tabpanel"][data-workspace-active="true"]');
      const tab = document.querySelector('[data-testid="workspace-tab-bar"] [role="tab"][aria-selected="true"]');
      return Boolean(panel && tab?.getAttribute('aria-controls') === panel.id);
    })).toBe(true);
    if (heading) await expect(active(page).getByRole('heading', { name: heading }).first()).toBeVisible();
    if (tabLabel) await expect(selected(page)).toHaveAccessibleName(tabLabel);
    await expect(page.getByText('Route Render Error', { exact: true })).toHaveCount(0);
    return active(page).getAttribute('data-workspace-id');
  }

  const staff = await openFixture();
  // A cold Vite server can invalidate its own prebundled dependencies as it
  // discovers lazy imports. Retry that startup condition before checking tabs.
  let staleModule = false;
  const noteStaleModule = response => {
    if (response.status() === 504 && new URL(response.url()).pathname.includes('/node_modules/.vite/')) staleModule = true;
  };
  staff.on('response', noteStaleModule);
  await openUrl(staff, reviewPath('fixture-a'));
  const navigationReady = () => staff.evaluate(() => typeof window.__navigateAppFixture === 'function');
  await expect.poll(async () => staleModule || await navigationReady(), { timeout: 35000 }).toBe(true);
  if (staleModule && !await navigationReady()) await staff.reload({ waitUntil: 'domcontentloaded' });
  staff.off('response', noteStaleModule);
  await expect.poll(navigationReady, { timeout: 35000 }).toBe(true);
  const firstReview = await assertWorkspace(staff, reviewPath('fixture-a'), reviews['fixture-a'], /Product Intake/i);
  await expect(tabs(staff)).toHaveCount(1);

  await appNavigate(staff, reviewPath('fixture-b'));
  const secondReview = await assertWorkspace(staff, reviewPath('fixture-b'), reviews['fixture-b'], /Product Intake/i);
  expect(secondReview).not.toBe(firstReview);
  await expect(tabs(staff)).toHaveCount(2);
  await appNavigate(staff, reviewPath('fixture-a'));
  expect(await assertWorkspace(staff, reviewPath('fixture-a'), reviews['fixture-a'])).toBe(firstReview);
  await expect(tabs(staff)).toHaveCount(2);
  await staff.goBack();
  expect(await assertWorkspace(staff, reviewPath('fixture-b'), reviews['fixture-b'])).toBe(secondReview);
  await staff.goForward();
  expect(await assertWorkspace(staff, reviewPath('fixture-a'), reviews['fixture-a'])).toBe(firstReview);
  await staff.reload({ waitUntil: 'domcontentloaded' });
  expect(await assertWorkspace(staff, reviewPath('fixture-a'), reviews['fixture-a'])).toBe(firstReview);
  await active(staff).getByRole('link', { name: 'Catalog Migration Lab', exact: true }).click();
  await assertWorkspace(staff, '/admin/catalog-migration-lab', undefined, /Catalog Migration Lab|Product Intake/i);
  await active(staff).getByRole('row', { name: /Synthetic Banner Review/ }).getByRole('button', { name: 'Open', exact: true }).click();
  await active(staff).getByRole('link', { name: 'Review Draft Product' }).click();
  expect(await assertWorkspace(staff, reviewPath('fixture-a'), reviews['fixture-a'])).toBe(firstReview);
  await staff.locator('[role="tab"][aria-controls="panel-' + secondReview + '"]').click();
  expect(await assertWorkspace(staff, reviewPath('fixture-b'), reviews['fixture-b'])).toBe(secondReview);
  await closeActive(staff);
  await expect(staff.locator('[role="tab"][aria-controls="panel-' + secondReview + '"]')).toHaveCount(0);
  await expect(active(staff)).toHaveCount(1);
  await expect(selected(staff)).toHaveCount(1);

  // Representative normal routes go through the production route table and layouts.
  const routes = [
    ['/orders', 'Orders'], ['/quotes', 'Quotes'], ['/customers', 'Customers'],
    ['/products', 'Product Catalog'], ['/production/flatbed', 'Flatbed Production'],
    ['/fulfillment', undefined, /Fulfillment/i], ['/invoices', 'Invoices'], ['/payments', 'Payments'],
    ['/purchase-orders', 'Purchase Orders'], ['/materials', 'Materials'],
    ['/admin', 'Admin Panel'], ['/settings/company', 'Settings'], ['/reports', 'Reports'],
  ];
  for (const [pathname, heading, tabLabel] of routes) {
    await appNavigate(staff, pathname);
    await assertWorkspace(staff, pathname, heading, tabLabel);
  }

  await appNavigate(staff, '/orders/fixture-a');
  const firstOrder = await assertWorkspace(staff, '/orders/fixture-a', undefined, new RegExp(orderTitle('fixture-a')));
  await appNavigate(staff, '/orders/fixture-b');
  const otherOrder = await assertWorkspace(staff, '/orders/fixture-b', undefined, new RegExp(orderTitle('fixture-b')));
  expect(otherOrder).not.toBe(firstOrder);
  const countBeforeReopen = await tabs(staff).count();
  await appNavigate(staff, '/orders/fixture-a');
  expect(await assertWorkspace(staff, '/orders/fixture-a', undefined, new RegExp(orderTitle('fixture-a')))).toBe(firstOrder);
  await expect(tabs(staff)).toHaveCount(countBeforeReopen);
  await staff.locator('[role="tab"][aria-controls="panel-' + otherOrder + '"]').click();
  expect(await assertWorkspace(staff, '/orders/fixture-b', undefined, new RegExp(orderTitle('fixture-b')))).toBe(otherOrder);

  for (const [theme, htmlClass] of [['light', null], ['dark', 'dark'], ['command', 'theme-command'], ['high-contrast', 'theme-high-contrast']]) {
    await staff.evaluate(value => localStorage.setItem('themeId', value), theme);
    await staff.reload({ waitUntil: 'domcontentloaded' });
    await assertWorkspace(staff, '/orders/fixture-b', undefined, new RegExp(orderTitle('fixture-b')));
    await expect.poll(() => selected(staff).evaluate(button => {
      const tab = button.parentElement.getBoundingClientRect();
      const strip = button.closest('[role="tablist"]').getBoundingClientRect();
      return tab.left >= strip.left - 1 && tab.right <= strip.right + 1;
    })).toBe(true);
    const html = staff.locator('html');
    if (htmlClass) await expect(html).toHaveClass(new RegExp('(^|\\s)' + htmlClass + '(\\s|$)'));
    else await expect(html).not.toHaveClass(/dark|theme-command|theme-high-contrast/);
    const orderATab = staff.locator('[role="tab"][aria-controls="panel-' + firstOrder + '"]');
    await expect(orderATab).toHaveAttribute('aria-selected', 'false');
    const presentation = locator => locator.evaluate(button => {
      const style = getComputedStyle(button);
      const wrapper = getComputedStyle(button.parentElement);
      return [style.color, style.fontWeight, wrapper.backgroundColor, wrapper.borderBottomColor, wrapper.borderBottomWidth];
    });
    expect(await presentation(selected(staff))).not.toEqual(await presentation(orderATab));
    await staff.screenshot({ path: output + '/' + theme + '.png' });
  }

  // This older route reads the location and opens its PO link through Wouter.
  await appNavigate(staff, '/vendors/fixture-vendor');
  const vendor = await assertWorkspace(staff, '/vendors/fixture-vendor', 'Vendor: Synthetic Supplier');
  await appNavigate(staff, '/reports');
  await assertWorkspace(staff, '/reports', 'Reports');
  await staff.locator('[role="tab"][aria-controls="panel-' + vendor + '"]').click();
  expect(await assertWorkspace(staff, '/vendors/fixture-vendor', 'Vendor: Synthetic Supplier')).toBe(vendor);
  await active(staff).getByRole('link', { name: 'New PO' }).click();
  await assertWorkspace(staff, '/purchase-orders/new', 'New Purchase Order');
  expect(new URL(staff.url()).searchParams.get('vendorId')).toBe('fixture-vendor');
  await staff.goBack();
  expect(await assertWorkspace(staff, '/vendors/fixture-vendor', 'Vendor: Synthetic Supplier')).toBe(vendor);

  await appNavigate(staff, '/products/new');
  const newProduct = await assertWorkspace(staff, '/products/new', undefined, /New Product|Products.*New/i);
  await active(staff).getByPlaceholder('Product name').fill('Unsaved Synthetic Product');
  await appNavigate(staff, '/reports');
  await assertWorkspace(staff, '/reports', 'Reports');
  await staff.locator('[role="tab"][aria-controls="panel-' + newProduct + '"]').click();
  await assertWorkspace(staff, '/products/new', undefined, /New Product|Products.*New/i);
  await expect(active(staff).getByPlaceholder('Product name')).toHaveValue('Unsaved Synthetic Product');
  const productConfirmation = staff.waitForEvent('dialog');
  const productClose = closeActive(staff);
  const discardDialog = await productConfirmation;
  expect(discardDialog.message()).toMatch(/unsaved/i);
  await discardDialog.dismiss();
  await productClose;
  await expect(active(staff).getByPlaceholder('Product name')).toHaveValue('Unsaved Synthetic Product');
  await active(staff).getByRole('button', { name: 'Cancel', exact: true }).click();
  await assertWorkspace(staff, '/products', 'Product Catalog');
  await expect(staff.locator('[role="tab"][aria-controls="panel-' + newProduct + '"]')).toHaveCount(0);

  // Going directly to a different address with saved metadata must follow that URL.
  await openUrl(staff, '/reports');
  await assertWorkspace(staff, '/reports', 'Reports');

  const final = await openFixture();
  await openUrl(final, '/reports');
  await assertWorkspace(final, '/reports', 'Reports');
  await expect(tabs(final)).toHaveCount(1);
  await closeActive(final);
  await assertWorkspace(final, '/orders', 'Orders');
  await expect(tabs(final)).toHaveCount(1);
  await closeActive(final);
  await assertWorkspace(final, '/orders', 'Orders');
  await expect(tabs(final)).toHaveCount(1);

  const portal = await openFixture('PORTAL_CUSTOMER');
  await openUrl(portal, '/portal/orders');
  const portalOrders = await assertWorkspace(portal, '/portal/orders', 'Orders', /Orders/i);
  await appNavigate(portal, '/portal/invoices');
  await assertWorkspace(portal, '/portal/invoices', 'Invoices');
  await portal.locator('[role="tab"][aria-controls="panel-' + portalOrders + '"]').click();
  expect(await assertWorkspace(portal, '/portal/orders', 'Orders')).toBe(portalOrders);
  await portal.reload({ waitUntil: 'domcontentloaded' });
  expect(await assertWorkspace(portal, '/portal/orders', 'Orders')).toBe(portalOrders);

  const portalFinal = await openFixture('PORTAL_CUSTOMER');
  await openUrl(portalFinal, '/portal/orders');
  await assertWorkspace(portalFinal, '/portal/orders', 'Orders');
  await closeActive(portalFinal);
  await assertWorkspace(portalFinal, '/portal', 'Dashboard');
  await expect(tabs(portalFinal)).toHaveCount(1);

  const publicPage = await openFixture('ANONYMOUS');
  await openUrl(publicPage, '/login');
  await expect(publicPage.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
  await expect(tabBar(publicPage)).toHaveCount(0);

  expect(unexpectedRequests).toEqual([]);
  expect(errors).toEqual([]);
  console.log('PASS: production staff and portal routes use real visible workspaces in local Chrome. Verified two Product Intake reviews and Orders, Wouter navigation, dirty Product retention, state restoration, history, close and landing, and four active-tab themes with synthetic read-only HTTP.');
} catch (error) {
  if (currentPage) {
    await currentPage.screenshot({ path: output + '/failure.png' }).catch(() => {});
    console.error('Fixture URL:', currentPage.url());
  }
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
