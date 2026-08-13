import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { evaluateOptionTreeV2 } from "../../../server/services/optionTreeV2Evaluator";

import { PostgresCreateOrderApplication, type PgFailurePoint } from "../../src/postgres/postgresOrderCreate";
import { V2PocError } from "../../src/shared/errors";

const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 8 });
const suffix = randomUUID().replaceAll("-", "");
const orgA = `v2poc-org-a-${suffix}`;
const orgB = `v2poc-org-b-${suffix}`;
const ownerA = `v2poc-owner-a-${suffix}`;
const ownerB = `v2poc-owner-b-${suffix}`;
const memberA = `v2poc-member-a-${suffix}`;
const taxableCustomerA = `v2poc-customer-taxable-${suffix}`;
const exemptCustomerA = `v2poc-customer-exempt-${suffix}`;
const customerB = `v2poc-customer-b-${suffix}`;
const productA = `v2poc-product-a-${suffix}`;
const productB = `v2poc-product-b-${suffix}`;
const treeA = `v2poc-tree-a-${suffix}`;
const treeB = `v2poc-tree-b-${suffix}`;
const app = () => new PostgresCreateOrderApplication(pool);

const tree = {
  schemaVersion: 2,
  rootNodeIds: ["finish"],
  nodes: {
    finish: { id: "finish", kind: "question", label: "Finish", input: { type: "select", selectionKey: "finish" }, choices: [
      { value: "standard", label: "Standard" },
      { value: "laminated", label: "Laminated", pricingImpact: [{ mode: "addCents", cents: 200 }] },
    ] },
  },
  meta: { requiresDimensions: false, pricingProfileKey: "qty_only", pricingV2: { base: { perPieceCents: 1000 } } },
};

const command = (requestId: string, overrides: Record<string, unknown> = {}) => ({
  organizationId: orgA,
  customerId: taxableCustomerA,
  requestId,
  lines: [{ productId: productA, quantity: 2, selections: { finish: { value: "laminated" } } }],
  ...overrides,
});

async function counts() {
  const result = await pool.query(`select (select count(*)::int from orders where id like 'v2poc-order-%') as orders, (select count(*)::int from order_line_items where id like 'v2poc-line-%') as lines, (select count(*)::int from invoices where id like 'v2poc-invoice-%') as invoices, (select count(*)::int from invoice_line_items where id like 'v2poc-invoice-line-%') as invoice_lines, (select count(*)::int from v2_poc_order_create_requests where organization_id=$1) as requests`, [orgA]);
  return result.rows[0] as { orders: number; lines: number; invoices: number; invoice_lines: number; requests: number };
}

beforeAll(async () => {
  await app().installExperimentalSchema();
  await pool.query(`insert into organizations (id,name,slug,default_tax_rate,tax_enabled) values ($1,'V2 POC Org A',$2,'0.0700',true),($3,'V2 POC Org B',$4,'0.0500',true)`, [orgA, `v2poc-a-${suffix}`.slice(0, 96), orgB, `v2poc-b-${suffix}`.slice(0, 96)]);
  await pool.query(`insert into users (id,email,role) values ($1,$2,'employee'),($3,$4,'employee'),($5,$6,'employee')`, [ownerA, `v2-owner-a-${suffix}@example.test`, ownerB, `v2-owner-b-${suffix}@example.test`, memberA, `v2-member-a-${suffix}@example.test`]);
  await pool.query(`insert into user_organizations (user_id,organization_id,role,is_default) values ($1,$2,'owner',true),($3,$4,'owner',true),($5,$2,'member',false)`, [ownerA,orgA,ownerB,orgB,memberA]);
  await pool.query(`insert into customers (id,organization_id,company_name,is_active,is_tax_exempt,payment_terms) values ($1,$2,'V2 POC Taxable',true,false,'due_on_receipt'),($3,$2,'V2 POC Exempt',true,true,'due_on_receipt'),($4,$5,'V2 POC Foreign',true,false,'due_on_receipt')`, [taxableCustomerA,orgA,exemptCustomerA,customerB,orgB]);
  await pool.query(`insert into products (id,organization_id,name,description,is_active,is_taxable,measurement_mode,pricing_mode,pricing_profile_key) values ($1,$2,'V2 POC Product A','test',true,true,'quantity_only','quantity','qty_only'),($3,$4,'V2 POC Product B','test',true,true,'quantity_only','quantity','qty_only')`, [productA,orgA,productB,orgB]);
  await pool.query(`insert into pbv2_tree_versions (id,organization_id,product_id,status,schema_version,tree_json) values ($1,$2,$3,'ACTIVE',2,$4::jsonb),($5,$6,$7,'ACTIVE',2,$4::jsonb)`, [treeA,orgA,productA,JSON.stringify(tree),treeB,orgB,productB]);
  await pool.query(`update products set pbv2_active_tree_version_id=case id when $1 then $2 when $3 then $4 end where id in ($1,$3)`, [productA,treeA,productB,treeB]);
});

afterAll(async () => {
  try {
    await pool.query(`delete from invoice_line_items where invoice_id in (select id from invoices where organization_id in ($1,$2))`, [orgA,orgB]);
    await pool.query(`delete from invoices where organization_id in ($1,$2)`, [orgA,orgB]);
    await pool.query(`delete from order_line_items where order_id in (select id from orders where organization_id in ($1,$2))`, [orgA,orgB]);
    await pool.query(`delete from v2_poc_order_create_requests where organization_id in ($1,$2)`, [orgA,orgB]);
    await pool.query(`delete from orders where organization_id in ($1,$2)`, [orgA,orgB]);
    await pool.query(`delete from organizations where id in ($1,$2)`, [orgA,orgB]);
    await pool.query(`delete from users where id in ($1,$2,$3)`, [ownerA,ownerB,memberA]);
  } finally { await pool.end(); }
});

describe("V2 PostgreSQL compatibility vertical slice", () => {
  test("uses current tables for PBV2 pricing, tax, order, invoice, and independent readback", async () => {
    const created = await app().execute(ownerA, command(`success-${suffix}`));
    expect(created).toMatchObject({ idempotentReplay: false, order: { subtotalCents: 2200, taxCents: 154, totalCents: 2354 }, invoice: { subtotalCents: 2200, taxCents: 154, totalCents: 2354 } });
    expect(created.order.lines[0].pricingSnapshot).toMatchObject({ pricingSystem: "pbv2", treeVersionId: treeA, baseCents: 2000, optionCents: 200 });
    const reloaded = await app().readOrder(ownerA, orgA, created.order.id);
    expect(reloaded.order).toEqual(created.order);
    expect(reloaded.invoice).toMatchObject({ id: created.invoice.id, orderId: created.invoice.orderId, subtotalCents: created.invoice.subtotalCents, taxCents: created.invoice.taxCents, totalCents: created.invoice.totalCents });
    expect(reloaded.invoice.lines.map(({ id: _id, ...line }) => line)).toEqual(created.invoice.lines.map(({ id: _id, ...line }) => line));
  });

  test("applies tax exemption and preserves invoice/order totals", async () => {
    const created = await app().execute(ownerA, command(`exempt-${suffix}`, { customerId: exemptCustomerA }));
    expect(created.order).toMatchObject({ subtotalCents: 2200, taxCents: 0, totalCents: 2200 });
    expect(created.invoice).toMatchObject({ taxCents: 0, totalCents: 2200 });
  });

  test("calculates tax for a multiple-line taxable order and preserves invoice equality", async () => {
    const created = await app().execute(ownerA, command(`multi-${suffix}`, { lines: [
      { productId: productA, quantity: 1, selections: { finish: { value: "standard" } } },
      { productId: productA, quantity: 2, selections: { finish: { value: "laminated" } } },
    ] }));
    expect(created.order).toMatchObject({ subtotalCents: 3200, taxCents: 224, totalCents: 3424 });
    expect(created.invoice).toMatchObject({ subtotalCents: 3200, taxCents: 224, totalCents: 3424 });
    expect(created.invoice.lines).toHaveLength(2);
  });

  test.each(["after_request_claim", "after_order_insert", "after_line_insert", "after_invoice_insert", "after_invoice_line_insert", "before_commit"] as PgFailurePoint[])("rolls back every commercial row after %s and permits safe retry", async (point) => {
    const requestId = `failure-${point}-${suffix}`;
    const before = await counts();
    await expect(app().execute(ownerA, command(requestId), point)).rejects.toMatchObject({ code: "INJECTED_FAILURE" } satisfies Partial<V2PocError>);
    expect(await counts()).toEqual(before);
    const retry = await app().execute(ownerA, command(requestId));
    expect(retry.idempotentReplay).toBe(false);
  });

  test("durably replays after a fresh application instance and rejects changed input", async () => {
    const requestId = `restart-${suffix}`;
    const first = await app().execute(ownerA, command(requestId));
    const replay = await new PostgresCreateOrderApplication(pool).execute(ownerA, command(requestId));
    expect(replay).toMatchObject({ idempotentReplay: true, order: { id: first.order.id }, invoice: { id: first.invoice.id } });
    await expect(app().execute(ownerA, command(requestId, { lines: [{ productId: productA, quantity: 3, selections: { finish: { value: "laminated" } } }] }))).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" } satisfies Partial<V2PocError>);
  });

  test("prevents concurrent duplicate orders through the unique durable request key", async () => {
    const requestId = `concurrent-${suffix}`;
    const outcomes = await Promise.all([app().execute(ownerA, command(requestId)), app().execute(ownerA, command(requestId))]);
    expect(new Set(outcomes.map((result) => result.order.id)).size).toBe(1);
    expect(outcomes.filter((result) => !result.idempotentReplay)).toHaveLength(1);
    const result = await pool.query(`select count(*)::int as orders,count(distinct i.id)::int as invoices,count(l.id)::int as lines from v2_poc_order_create_requests r join orders o on o.id=r.order_id left join invoices i on i.id=r.invoice_id left join order_line_items l on l.order_id=o.id where r.organization_id=$1 and r.request_id=$2`, [orgA,requestId]);
    expect(result.rows[0]).toEqual({ orders: 1, invoices: 1, lines: 1 });
  });

  test("allocates distinct document numbers for concurrent different requests", async () => {
    const [first, second] = await Promise.all([app().execute(ownerA, command(`number-a-${suffix}`)), app().execute(ownerA, command(`number-b-${suffix}`))]);
    const rows = await pool.query(`select display_number from orders where id=any($1::varchar[])`, [[first.order.id,second.order.id]]);
    expect(new Set(rows.rows.map((row) => row.display_number)).size).toBe(2);
  });

  test("enforces repository tenant isolation and authorization before mutation", async () => {
    await expect(app().execute(memberA, command(`member-${suffix}`))).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<V2PocError>);
    await expect(app().execute(ownerA, command(`foreign-customer-${suffix}`, { customerId: customerB }))).rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<V2PocError>);
    await expect(app().execute(ownerA, command(`foreign-product-${suffix}`, { lines: [{ productId: productB, quantity: 1 }] }))).rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<V2PocError>);
    const foreign = await app().execute(ownerB, { organizationId: orgB, customerId: customerB, requestId: `foreign-order-${suffix}`, lines: [{ productId: productB, quantity: 1, selections: { finish: { value: "standard" } } }] });
    await expect(app().readOrder(ownerA, orgA, foreign.order.id)).rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<V2PocError>);
  });

  test("loads a V1-created order and draft invoice through current schema-shaped scoped records when available", async () => {
    const candidate = await pool.query(`select o.id,o.organization_id,uo.user_id from orders o join invoices i on i.order_id=o.id and i.status='draft' join user_organizations uo on uo.organization_id=o.organization_id and uo.role in ('owner','admin','manager') where o.id not like 'v2poc-order-%' order by o.created_at desc limit 1`);
    if (!candidate.rowCount) return;
    const row = candidate.rows[0] as { id: string; organization_id: string; user_id: string };
    const loaded = await app().readOrder(row.user_id, row.organization_id, row.id);
    expect(loaded.order.id).toBe(row.id);
    expect(loaded.invoice.orderId).toBe(row.id);
    const source = await pool.query(`select o.subtotal,o.tax_amount,o.total,(select count(*)::int from order_line_items where order_id=o.id) as line_count,(select count(*)::int from invoice_line_items where invoice_id=loaded.id) as invoice_line_count from orders o join invoices loaded on loaded.order_id=o.id and loaded.status='draft' where o.id=$1 and o.organization_id=$2`, [row.id,row.organization_id]);
    expect(loaded.order).toMatchObject({ subtotalCents: Math.round(Number(source.rows[0].subtotal) * 100), taxCents: Math.round(Number(source.rows[0].tax_amount) * 100), totalCents: Math.round(Number(source.rows[0].total) * 100) });
    expect(loaded.order.lines).toHaveLength(source.rows[0].line_count);
    expect(loaded.invoice.lines).toHaveLength(source.rows[0].invoice_line_count);
  });

  test("uses an existing active PBV2 product with parity against the V1 pure evaluator", async () => {
    const candidate = await pool.query(`select p.id,p.organization_id,p.measurement_mode,t.tree_json,uo.user_id from products p join pbv2_tree_versions t on t.id=p.pbv2_active_tree_version_id and t.organization_id=p.organization_id and t.product_id=p.id and t.status='ACTIVE' join user_organizations uo on uo.organization_id=p.organization_id and uo.role in ('owner','admin','manager') where p.id not like 'v2poc-%' and p.is_active=true and p.measurement_mode='dimensions_required' and (t.tree_json->'meta'->'pricingV2'->'base'->>'perSqftCents') is not null order by p.id limit 1`);
    if (!candidate.rowCount) return;
    const row = candidate.rows[0] as { id: string; organization_id: string; measurement_mode: string; tree_json: any; user_id: string };
    const priceInput = { productId: row.id, quantity: 1, widthIn: 12, heightIn: 12, selections: {} };
    const base = row.tree_json.meta.pricingV2.base;
    const baseCents = Number.isFinite(Number(base.perPieceCents)) ? Number(base.perPieceCents) : Math.round(Number(base.perSqftCents));
    const v1 = evaluateOptionTreeV2({ tree: row.tree_json, selections: { schemaVersion: 2, selected: {} }, width: 12, height: 12, quantity: 1, basePrice: baseCents / 100 });
    const v2 = await app().previewProduct(row.user_id, row.organization_id, priceInput);
    expect(v2.lineSubtotalCents).toBe(baseCents + Math.round(v1.optionsPrice * 100));
    expect(v2.pricingSnapshot).toMatchObject({ pricingSystem: "pbv2", baseCents, optionCents: Math.round(v1.optionsPrice * 100) });
  });
});
