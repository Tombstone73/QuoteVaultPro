import { afterAll, beforeAll, expect, jest, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '@shared/schema';
import { safeTestDatabaseUrl } from './helpers/safeTestDatabase';
import { createPbv2BannerProductTreeJson } from '@shared/pbv2/starterTree';
import { COROPLAST_FLUTE_KEY, COROPLAST_PRINT_MODE_KEY, withBlankCoroplastPricing } from '@shared/blankCoroplast';

// Database evidence is opt-in. The guard rejects shared/production targets;
// ordinary unit-test runs without TEST_DATABASE_URL skip this suite.
const testUrl = safeTestDatabaseUrl({ TEST_DATABASE_URL: process.env.TEST_DATABASE_URL });
const databaseTest = testUrl ? test : test.skip;
const url = testUrl ?? 'postgresql://localhost:1/storefront_unconfigured_test';
const target = new URL(url);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
  throw new Error('Storefront transaction tests require loopback PostgreSQL.');
}
const pool = new Pool({ connectionString: url });
const db = drizzle({ client: pool, schema });
jest.unstable_mockModule('../db', () => ({
  db, pool,
  hasPageCountStatusColumn: () => true,
  hasQuoteAttachmentPagesTable: () => true,
  probeDatabaseSchema: async () => {},
}));

let checkout: typeof import('../services/portalStorefrontCheckout.service');
let storefront: typeof import('../services/portalStorefront.service');
const organizationId = randomUUID();
const customerId = randomUUID();
const userId = randomUUID();
const accessId = randomUUID();
const productId = randomUUID();
const treeId = randomUUID();
let customer: Record<string, unknown>;
let submittedOrderId: string;
let submittedKey: string;
let submittedToken: string;
const createdUserIds = [userId];

function validSelections() {
  const selections: Record<string, string | number | boolean> = {};
  const tree = createPbv2BannerProductTreeJson();
  for (let pass = 0; pass < 4; pass++) {
    const projected = storefront.projectStorefrontOptions(tree as never, selections);
    let added = false;
    for (const option of projected.options) {
      if (!option.required || option.key in selections) continue;
      const choice = option.choices[0];
      if (choice) { selections[option.key] = choice.value; added = true; }
    }
    if (!added) break;
  }
  return selections;
}

function request(body: Record<string, unknown> = {}, actor: {
  accessId?: string; userId?: string; role?: string; staffPreview?: boolean;
} = {}) {
  const actorAccessId = actor.accessId ?? accessId;
  const actorUserId = actor.userId ?? userId;
  return { organizationId, portalCustomerId: customerId, portalCustomer: customer,
    portalAccess: { id: actorAccessId, userId: actorUserId, organizationId, customerId, contactId: null,
      status: 'ACTIVE', accessRole: actor.role ?? 'BUYER' },
    ...(actor.staffPreview ? { staffPortalPreview: { actorUserId } } : {}),
    user: { id: actorUserId }, body, query: {} } as unknown as Request;
}

async function additionalAccess(role: 'BUYER' | 'COMPANY_ADMIN' | 'VIEWER' = 'BUYER') {
  const nextUserId = randomUUID();
  const nextAccessId = randomUUID();
  createdUserIds.push(nextUserId);
  await pool.query('insert into users (id) values ($1)', [nextUserId]);
  await pool.query(`insert into customer_portal_access
    (id, organization_id, customer_id, user_id, email, status, access_role)
    values ($1, $2, $3, $4, $5, 'ACTIVE', $6)`,
  [nextAccessId, organizationId, customerId, nextUserId, `${nextUserId}@example.invalid`, role]);
  return (body: Record<string, unknown> = {}) => request(body, {
    accessId: nextAccessId, userId: nextUserId, role,
  });
}

async function prepareOneLineCart(makeRequest: (body?: Record<string, unknown>) => Request) {
  await checkout.addPortalStorefrontCartLine(makeRequest({
    productId, treeVersionId: treeId, quantity: 1, widthIn: 24, heightIn: 18,
    selections: validSelections(),
  }));
  return checkout.reviewPortalStorefrontCart(makeRequest());
}

async function orderCounts() {
  const result = await pool.query(`select
    (select count(*)::int from orders where organization_id = $1) as orders,
    (select count(*)::int from invoices where organization_id = $1) as invoices,
    (select count(*)::int from portal_follow_up_items where organization_id = $1
      and event_type = 'ORDER_SUBMITTED') as intake`, [organizationId]);
  return result.rows[0] as { orders: number; invoices: number; intake: number };
}

beforeAll(async () => {
  checkout = await import('../services/portalStorefrontCheckout.service');
  storefront = await import('../services/portalStorefront.service');
  const identity = await pool.query(`select current_database() as name, host(inet_server_addr()) as host,
    to_regclass('public.portal_storefront_carts')::text as carts,
    to_regclass('public.portal_storefront_cart_files')::text as files`);
  expect(identity.rows[0]).toMatchObject({
    name: target.pathname.slice(1), host: '127.0.0.1',
    carts: 'portal_storefront_carts', files: 'portal_storefront_cart_files',
  });
  // Fresh schema projection lacks this migration-only canonical numbering key.
  await pool.query(`create unique index if not exists global_variables_org_name_unique_idx
    on public.global_variables (organization_id, name)`);
  await pool.query(`insert into organizations (id, name, slug, default_tax_rate, tax_enabled)
    values ($1, 'Storefront PostgreSQL QA', $2, '0.0700', true)`,
  [organizationId, `storefront-test-${organizationId}`]);
  await pool.query(`insert into users (id) values ($1)`, [userId]);
  await pool.query(`insert into customers (id, organization_id, company_name, email)
    values ($1, $2, 'Synthetic buyer', 'buyer@example.invalid')`, [customerId, organizationId]);
  customer = (await db.select().from(schema.customers).where(eq(schema.customers.id, customerId)))[0]!;
  await pool.query(`insert into customer_portal_access
    (id, organization_id, customer_id, user_id, email, status, access_role)
    values ($1, $2, $3, $4, 'buyer@example.invalid', 'ACTIVE', 'BUYER')`,
  [accessId, organizationId, customerId, userId]);
  await pool.query(`insert into company_settings (organization_id, company_name, physical_address)
    values ($1, 'Synthetic shop', $2::jsonb)`, [organizationId, JSON.stringify({
      line1: '100 Test Lane', city: 'Indianapolis', state: 'IN', postalCode: '46201', country: 'US',
    })]);
  await pool.query(`insert into products
    (id, organization_id, name, description, is_active, storefront_visible, portal_orderable, is_taxable)
    values ($1, $2, 'Synthetic banner', 'Disposable product', true, true, true, true)`,
  [productId, organizationId]);
  const tree = createPbv2BannerProductTreeJson();
  await pool.query(`insert into pbv2_tree_versions
    (id, organization_id, product_id, status, schema_version, tree_json)
    values ($1, $2, $3, 'ACTIVE', 2, $4::jsonb)`,
  [treeId, organizationId, productId, JSON.stringify(tree)]);
  await pool.query(`update products set pbv2_active_tree_version_id = $1 where id = $2`, [treeId, productId]);
});

afterAll(async () => {
  try {
    await pool.query('delete from organizations where id = $1', [organizationId]);
    await pool.query('delete from users where id = any($1::varchar[])', [createdUserIds]);
  }
  finally { await pool.end(); }
});

databaseTest('storefront service rejects portal mutations without active scoped access before writes', async () => {
  const otherOrganizationId = randomUUID();
  const req = { organizationId: otherOrganizationId, portalCustomerId: randomUUID(), portalCustomer: {
    id: randomUUID(), organizationId: otherOrganizationId,
  }, user: { id: randomUUID() }, body: {} };
  await expect(checkout.submitPortalStorefrontCart(req as never)).rejects.toMatchObject({ statusCode: 403 });
});

databaseTest('canonical two-line checkout persists exactly one Order, linked Invoice, and staff intake', async () => {
  const detail = await storefront.getPortalStorefrontProduct(request(), productId);
  expect(detail?.orderable).toBe(true);
  const selections = validSelections();
  const cart = await checkout.addPortalStorefrontCartLine(request({
    productId, treeVersionId: treeId, quantity: 1, widthIn: 24, heightIn: 18, selections,
  }));
  expect(cart.lines).toHaveLength(1);
  await checkout.addPortalStorefrontCartLine(request({
    productId, treeVersionId: treeId, quantity: 2, widthIn: 36, heightIn: 24, selections,
  }));
  const readback = await checkout.getPortalStorefrontCart(request());
  expect(readback.lines).toHaveLength(2);
  expect(readback.lines.map(line => line.quantity)).toEqual([1, 2]);
  for (const [index, line] of readback.lines.entries()) {
    const fileRecordId = randomUUID();
    await pool.query(`insert into file_records
      (id, organization_id, original_filename, mime_type, size_bytes)
      values ($1, $2, $3, 'image/png', 128)`,
    [fileRecordId, organizationId, `checkout-${index + 1}.png`]);
    await pool.query(`insert into portal_storefront_cart_files
      (organization_id, cart_id, line_id, file_record_id, original_filename, mime_type, size_bytes)
      values ($1, $2, $3, $4, $5, 'image/png', 128)`,
    [organizationId, readback.id, line.id, fileRecordId, `checkout-${index + 1}.png`]);
  }
  await pool.query(`update portal_storefront_carts set version = version + 1 where id = $1`, [readback.id]);
  const review = await checkout.reviewPortalStorefrontCart(request());
  expect(review).toMatchObject({ fulfillmentMethod: 'pickup', currency: 'USD' });
  expect(review.subtotalCents).toBeGreaterThan(0);
  expect(review.taxCents).toBeGreaterThan(0);
  submittedToken = review.reviewToken;
  submittedKey = randomUUID();
  const placed = await checkout.submitPortalStorefrontCart(request({
    reviewToken: submittedToken, submissionKey: submittedKey,
  }));
  expect(placed.status).toBe('placed');
  submittedOrderId = placed.orderId;
  const result = await pool.query(`select o.id, o.subtotal as order_subtotal, o.tax_amount, o.total, o.shipping_method,
      i.id as invoice_id, i.subtotal_cents, i.tax_cents, i.total_cents,
      i.amount_paid, i.balance_due, i.customer_released_at, i.last_sent_at,
      c.status as cart_status, c.order_id as cart_order_id,
      (select count(*)::int from order_line_items where order_id = o.id) as line_count
    from orders o join invoices i on i.order_id = o.id
    join portal_storefront_carts c on c.order_id = o.id
    where o.id = $1 and o.organization_id = $2`, [submittedOrderId, organizationId]);
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({
    shipping_method: 'pickup',
    total_cents: review.totalCents, customer_released_at: null, last_sent_at: null,
    cart_status: 'submitted', cart_order_id: submittedOrderId, line_count: 2,
  });
  expect(Math.round(Number(result.rows[0].total) * 100)).toBe(review.totalCents);
  expect(Math.round(Number(result.rows[0].order_subtotal) * 100)).toBe(review.subtotalCents);
  expect(Math.round(Number(result.rows[0].tax_amount) * 100)).toBe(review.taxCents);
  expect(result.rows[0].subtotal_cents).toBe(review.subtotalCents);
  expect(result.rows[0].tax_cents).toBe(review.taxCents);
  expect(Number(result.rows[0].amount_paid)).toBe(0);
  expect(Math.round(Number(result.rows[0].balance_due) * 100)).toBe(review.totalCents);
  const savedLines = await pool.query(`select quantity, width, height, pbv2_tree_version_id,
      total_price, option_selections_json from order_line_items where order_id = $1 order by sort_order`,
  [submittedOrderId]);
  expect(savedLines.rows.map(row => row.quantity)).toEqual([1, 2]);
  expect(savedLines.rows.map(row => Number(row.width))).toEqual([24, 36]);
  expect(savedLines.rows.map(row => Number(row.height))).toEqual([18, 24]);
  expect(savedLines.rows.every(row => row.pbv2_tree_version_id === treeId)).toBe(true);
  expect(savedLines.rows.every(row => Number(row.total_price) > 0)).toBe(true);
  expect(savedLines.rows.every(row => row.option_selections_json != null)).toBe(true);
  const payments = await pool.query(`select count(*)::int as n from payments where invoice_id = $1`,
  [result.rows[0].invoice_id]);
  expect(payments.rows[0].n).toBe(0);
  const attachments = await pool.query(`select a.file_record_id, a.order_line_item_id,
      a.customer_upload_review_status, a.original_filename, f.line_id as cart_line_id,
      f.order_attachment_id
    from portal_storefront_cart_files f join order_attachments a on a.id = f.order_attachment_id
    where f.cart_id = $1 order by a.original_filename`, [readback.id]);
  expect(attachments.rows).toHaveLength(2);
  expect(attachments.rows.map(row => row.customer_upload_review_status)).toEqual(['pending_review', 'pending_review']);
  expect(new Set(attachments.rows.map(row => row.order_line_item_id)).size).toBe(2);
  const intake = await pool.query(`select count(*)::int as n from portal_follow_up_items
    where organization_id = $1 and related_order_id = $2 and event_type = 'ORDER_SUBMITTED'`,
  [organizationId, submittedOrderId]);
  expect(intake.rows[0].n).toBe(1);
  const production = await pool.query(`select count(*)::int as n from production_jobs
    where order_id = $1`, [submittedOrderId]);
  expect(production.rows[0].n).toBe(0);
  const counts = await orderCounts();
  for (const retry of await Promise.all([
    checkout.submitPortalStorefrontCart(request({ reviewToken: submittedToken, submissionKey: submittedKey })),
    checkout.submitPortalStorefrontCart(request({ reviewToken: submittedToken, submissionKey: submittedKey })),
  ])) {
    expect(retry).toMatchObject({ status: 'placed', orderId: submittedOrderId,
      totalCents: review.totalCents });
  }
  expect(await orderCounts()).toEqual(counts);
});

databaseTest('blank Coroplast checkout persists its priced mode, flute, totals, and deferred Flatbed instructions without artwork', async () => {
  const buyer = await additionalAccess();
  const blankProductId = randomUUID();
  const blankTreeId = randomUUID();
  const { makeCoroplastGoldenTree } = await import('../services/pricing/tests/fixtures/pbv2GoldenPricing.fixtures');
  const baseTree = makeCoroplastGoldenTree();
  (baseTree.nodes.rate as { input: Record<string, unknown> }).input.valueType = 'ENUM';
  const blankTree = withBlankCoroplastPricing(baseTree as never, {
    unit: 'per_square_foot', rateCents: 200, minimumChargeCents: 2500,
    quantityTiers: [{ minQuantity: 1, rateCents: 200 }, { minQuantity: 10, rateCents: 150 }],
  });
  await pool.query(`insert into products
    (id, organization_id, name, description, is_active, storefront_visible, portal_orderable, is_taxable)
    values ($1, $2, '4mm Coroplast checkout QA', 'Disposable blank Product', true, true, true, true)`,
  [blankProductId, organizationId]);
  await pool.query(`insert into pbv2_tree_versions
    (id, organization_id, product_id, status, schema_version, tree_json)
    values ($1, $2, $3, 'ACTIVE', 2, $4::jsonb)`,
  [blankTreeId, organizationId, blankProductId, JSON.stringify(blankTree)]);
  await pool.query('update products set pbv2_active_tree_version_id = $1 where id = $2', [blankTreeId, blankProductId]);

  const modeKey = storefront.projectStorefrontOptions(blankTree).options.find((option) => option.label === 'Print Mode')?.key;
  const fluteKey = storefront.projectStorefrontOptions(blankTree, { [COROPLAST_PRINT_MODE_KEY]: 'unprinted' })
    .options.find((option) => option.label === 'Flute Direction')?.key;
  expect(modeKey).toBeDefined();
  expect(fluteKey).toBeDefined();
  const selections = { [modeKey!]: 'unprinted', [fluteKey!]: 'vertical' };
  await checkout.addPortalStorefrontCartLine(buyer({
    productId: blankProductId, treeVersionId: blankTreeId, quantity: 10, widthIn: 24, heightIn: 18, selections,
  }));
  const review = await checkout.reviewPortalStorefrontCart(buyer());
  expect(review.subtotalCents).toBe(4500);
  const placed = await checkout.submitPortalStorefrontCart(buyer({
    reviewToken: review.reviewToken, submissionKey: randomUUID(),
  }));
  expect(placed.status).toBe('placed');
  if (placed.status !== 'placed') throw new Error('Blank checkout was not placed');
  const persisted = await pool.query(`select l.option_selections_json, l.pbv2_snapshot_json, l.requires_prepress,
      l.requires_proof_approval, l.production_notes, l.total_price, i.total_cents,
      (select count(*)::int from production_jobs where order_id = $1) as jobs,
      (select count(*)::int from portal_follow_up_items where related_order_id = $1 and event_type = 'ORDER_SUBMITTED') as intake
    from order_line_items l join invoices i on i.order_id = l.order_id
    where l.order_id = $1`, [placed.orderId]);
  expect(persisted.rows).toHaveLength(1);
  const line = persisted.rows[0];
  expect(line.option_selections_json).toMatchObject({ [COROPLAST_PRINT_MODE_KEY]: 'unprinted', [COROPLAST_FLUTE_KEY]: 'vertical' });
  expect(line.pbv2_snapshot_json.selections[COROPLAST_PRINT_MODE_KEY].value).toBe('unprinted');
  expect(line).toMatchObject({ requires_prepress: false, requires_proof_approval: false, jobs: 0, intake: 1 });
  expect(line.production_notes).toMatch(/Unprinted Coroplast.*do not print/i);
  expect(Math.round(Number(line.total_price) * 100)).toBe(4500);
  expect(line.total_cents).toBe(review.totalCents);
});

databaseTest('simultaneous same-key submissions commit one Order and Invoice', async () => {
  const buyer = await additionalAccess();
  const review = await prepareOneLineCart(buyer);
  const key = randomUUID();
  const before = await orderCounts();
  const attempts = await Promise.all([
    checkout.submitPortalStorefrontCart(buyer({ reviewToken: review.reviewToken, submissionKey: key })),
    checkout.submitPortalStorefrontCart(buyer({ reviewToken: review.reviewToken, submissionKey: key })),
  ]);
  expect(attempts[0]).toMatchObject({ status: 'placed' });
  expect(attempts[1]).toMatchObject({ status: 'placed', orderId: attempts[0].orderId });
  expect(await orderCounts()).toEqual({ orders: before.orders + 1,
    invoices: before.invoices + 1, intake: before.intake + 1 });
});

databaseTest('different keys racing the same reviewed cart do not create a second Order', async () => {
  const buyer = await additionalAccess();
  const review = await prepareOneLineCart(buyer);
  const before = await orderCounts();
  const attempts = await Promise.allSettled([
    checkout.submitPortalStorefrontCart(buyer({ reviewToken: review.reviewToken, submissionKey: randomUUID() })),
    checkout.submitPortalStorefrontCart(buyer({ reviewToken: review.reviewToken, submissionKey: randomUUID() })),
  ]);
  expect(attempts.filter(row => row.status === 'fulfilled')).toHaveLength(1);
  expect(attempts.filter(row => row.status === 'rejected')).toHaveLength(1);
  expect(await orderCounts()).toEqual({ orders: before.orders + 1,
    invoices: before.invoices + 1, intake: before.intake + 1 });
});

databaseTest('failure after canonical Order creation rolls back the real transaction and leaves the cart recoverable', async () => {
  const buyer = await additionalAccess();
  const review = await prepareOneLineCart(buyer);
  const before = await orderCounts();
  const canonical = await import('../services/orders/canonicalOrderOperations');
  const original = canonical.canonicalOrderOperations.createInTransaction.bind(canonical.canonicalOrderOperations);
  const spy = jest.spyOn(canonical.canonicalOrderOperations, 'createInTransaction')
    .mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new Error('Synthetic post-Order transaction failure');
    });
  try {
    await expect(checkout.submitPortalStorefrontCart(buyer({
      reviewToken: review.reviewToken, submissionKey: randomUUID(),
    }))).rejects.toThrow('Synthetic post-Order transaction failure');
  } finally { spy.mockRestore(); }
  expect(await orderCounts()).toEqual(before);
  const cart = await checkout.getPortalStorefrontCart(buyer());
  expect(cart.lines).toHaveLength(1);
  const state = await pool.query(`select status, submission_key, order_id from portal_storefront_carts where id = $1`, [cart.id]);
  expect(state.rows[0]).toMatchObject({ status: 'open', submission_key: null, order_id: null });
});

databaseTest('review token is invalidated by a cart edit without submitting a different configuration', async () => {
  const buyer = await additionalAccess();
  const review = await prepareOneLineCart(buyer);
  const before = await orderCounts();
  const cart = await checkout.getPortalStorefrontCart(buyer());
  await checkout.updatePortalStorefrontCartLine(buyer({
    productId, treeVersionId: treeId, quantity: 2, widthIn: 24, heightIn: 18,
    selections: validSelections(),
  }), cart.lines[0].id);
  await expect(checkout.submitPortalStorefrontCart(buyer({
    reviewToken: review.reviewToken, submissionKey: randomUUID(),
  }))).rejects.toMatchObject({ statusCode: 409 });
  expect(await orderCounts()).toEqual(before);
  expect((await checkout.getPortalStorefrontCart(buyer())).lines[0].quantity).toBe(2);
});

databaseTest('tax changes demand a new explicit review; lost-response retry returns the committed Order', async () => {
  const buyer = await additionalAccess();
  const review = await prepareOneLineCart(buyer);
  const before = await orderCounts();
  await pool.query(`update organizations set default_tax_rate = '0.0900' where id = $1`, [organizationId]);
  try {
    const key = randomUUID();
    const changed = await checkout.submitPortalStorefrontCart(buyer({
      reviewToken: review.reviewToken, submissionKey: key,
    }));
    expect(changed.status).toBe('changed');
    if (changed.status !== 'changed') throw new Error('Changed review was not returned');
    expect(changed.review.taxCents).toBeGreaterThan(review.taxCents);
    expect(await orderCounts()).toEqual(before);
    const accepted = await checkout.submitPortalStorefrontCart(buyer({
      reviewToken: changed.review.reviewToken, submissionKey: key,
    }));
    expect(accepted.status).toBe('placed');
    const retry = await checkout.submitPortalStorefrontCart(buyer({
      reviewToken: changed.review.reviewToken, submissionKey: key,
    }));
    expect(retry).toMatchObject({ status: 'placed', orderId: accepted.orderId });
    expect(await orderCounts()).toEqual({ orders: before.orders + 1,
      invoices: before.invoices + 1, intake: before.intake + 1 });
  } finally {
    await pool.query(`update organizations set default_tax_rate = '0.0700' where id = $1`, [organizationId]);
  }
});

databaseTest('Product approval removal blocks a reviewed cart without partial checkout writes', async () => {
  const buyer = await additionalAccess();
  const review = await prepareOneLineCart(buyer);
  const before = await orderCounts();
  await pool.query('update products set portal_orderable = false where id = $1', [productId]);
  try {
    await expect(checkout.submitPortalStorefrontCart(buyer({
      reviewToken: review.reviewToken, submissionKey: randomUUID(),
    }))).rejects.toMatchObject({ statusCode: 409 });
    expect(await orderCounts()).toEqual(before);
    expect((await checkout.getPortalStorefrontCart(buyer())).lines).toHaveLength(1);
  } finally {
    await pool.query('update products set portal_orderable = true where id = $1', [productId]);
  }
});

databaseTest('per-access ownership, viewer role, preview, and price/cart tampering are rejected', async () => {
  const buyer = await additionalAccess();
  const viewer = await additionalAccess('VIEWER');
  const admin = await additionalAccess('COMPANY_ADMIN');
  const before = await orderCounts();
  const buyerCart = await checkout.addPortalStorefrontCartLine(buyer({
    productId, treeVersionId: treeId, quantity: 1, widthIn: 24, heightIn: 18,
    selections: validSelections(),
  }));
  expect((await checkout.getPortalStorefrontCart(viewer())).lines).toHaveLength(0);
  await expect(checkout.addPortalStorefrontCartLine(viewer({
    productId, treeVersionId: treeId, quantity: 1, widthIn: 24, heightIn: 18,
    selections: validSelections(),
  }))).rejects.toMatchObject({ statusCode: 403 });
  await expect(checkout.removePortalStorefrontCartLine(viewer(), buyerCart.lines[0].id))
    .rejects.toMatchObject({ statusCode: 403 });
  const fileRecordId = randomUUID();
  await pool.query(`insert into file_records (id, organization_id, original_filename, mime_type, size_bytes)
    values ($1, $2, 'private.png', 'image/png', 128)`, [fileRecordId, organizationId]);
  const staged = await pool.query(`insert into portal_storefront_cart_files
    (organization_id, cart_id, line_id, file_record_id, original_filename, mime_type, size_bytes)
    values ($1, $2, $3, $4, 'private.png', 'image/png', 128) returning id`,
  [organizationId, buyerCart.id, buyerCart.lines[0].id, fileRecordId]);
  await expect(checkout.removePortalStorefrontCartFile(admin(), staged.rows[0].id))
    .rejects.toMatchObject({ statusCode: 404 });
  const wrongCustomer = { ...buyer(), portalCustomerId: randomUUID() };
  await expect(checkout.getPortalStorefrontCart(wrongCustomer))
    .rejects.toMatchObject({ statusCode: 403 });
  const wrongTenant = { ...buyer(), organizationId: randomUUID() };
  await expect(checkout.getPortalStorefrontCart(wrongTenant))
    .rejects.toMatchObject({ statusCode: 403 });
  await expect(checkout.addPortalStorefrontCartLine(request({
    productId, treeVersionId: treeId, quantity: 1, widthIn: 24, heightIn: 18,
    selections: validSelections(),
  }, { staffPreview: true }))).rejects.toMatchObject({ statusCode: 403 });
  for (const extra of [{ priceCents: 1 }, { customerId: randomUUID() }, { cartId: buyerCart.id }]) {
    await expect(checkout.addPortalStorefrontCartLine(buyer({
      productId, treeVersionId: treeId, quantity: 1, widthIn: 24, heightIn: 18,
      selections: validSelections(), ...extra,
    }))).rejects.toMatchObject({ statusCode: 400 });
  }
  await expect(checkout.addPortalStorefrontCartLine(buyer({
    productId, treeVersionId: treeId, quantity: 1, widthIn: 24, heightIn: 18,
    selections: { option_999: 'forged' },
  }))).rejects.toMatchObject({ statusCode: 400 });
  const adminCart = await checkout.addPortalStorefrontCartLine(admin({
    productId, treeVersionId: treeId, quantity: 1, widthIn: 24, heightIn: 18,
    selections: validSelections(),
  }));
  expect(adminCart.lines).toHaveLength(1);
  expect((await checkout.getPortalStorefrontCart(buyer())).lines).toHaveLength(1);
  expect(await orderCounts()).toEqual(before);
});
