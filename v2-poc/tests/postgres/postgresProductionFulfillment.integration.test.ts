import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { randomUUID } from "node:crypto";
import pg from "pg";

import { PostgresProductionFulfillmentApplication } from "../../src/postgres/postgresProductionFulfillment";
import { V2PocError } from "../../src/shared/errors";

const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 8 });
const suffix = randomUUID().replaceAll("-", "");
const orgA = `v2poc-pf-org-a-${suffix}`;
const orgB = `v2poc-pf-org-b-${suffix}`;
const ownerA = `v2poc-pf-owner-a-${suffix}`;
const ownerB = `v2poc-pf-owner-b-${suffix}`;
const app = () => new PostgresProductionFulfillmentApplication(pool);
let sequence = 0;

type Fixture = { orderId: string; lineId: string; memberId: string; invoiceId: string };
const fixture = async (organizationId = orgA, ownerId = ownerA, quantity = 1_000): Promise<Fixture> => {
  const n = ++sequence;
  const orderId = `v2poc-pf-order-${suffix}-${n}`;
  const lineId = `v2poc-pf-line-${suffix}-${n}`;
  const jobId = `v2poc-pf-job-${suffix}-${n}`;
  const runId = `v2poc-pf-run-${suffix}-${n}`;
  const memberId = `v2poc-pf-member-${suffix}-${n}`;
  const invoiceId = `v2poc-pf-invoice-${suffix}-${n}`;
  const customerId = `v2poc-pf-customer-${organizationId}-${n}`;
  const productId = `v2poc-pf-product-${organizationId}-${n}`;
  await pool.query(`insert into customers (id,organization_id,company_name,is_active) values ($1,$2,$3,true)`, [customerId, organizationId, `V2 POC PF ${n}`]);
  await pool.query(`insert into products (id,organization_id,name,description,is_active,is_taxable,measurement_mode,pricing_mode,pricing_profile_key) values ($1,$2,$3,'test',true,false,'quantity_only','quantity','qty_only')`, [productId, organizationId, `V2 POC PF Product ${n}`]);
  await pool.query(`insert into orders (id,organization_id,order_number,display_number,number_core,customer_id,status,state,priority,fulfillment_status,subtotal,tax,tax_rate,tax_amount,taxable_subtotal,total,discount,created_by_user_id) values ($1,$2,$3,$4,$5,$6,'new','open','normal','pending','100.00','0.00','0.0000','0.00','100.00','100.00','0.00',$7)`, [orderId, organizationId, `9${n}`, `V2PF-${n}`, 90_000 + n, customerId, ownerId]);
  await pool.query(`insert into order_line_items (id,order_id,product_id,product_type,description,quantity,unit_price,total_price,status,option_selections_json,selected_options,priced_at,tax_amount,is_taxable_snapshot,sort_order) values ($1,$2,$3,'wide_roll','V2 POC fulfillment fixture',$4,'0.10','100.00','new','{}'::jsonb,'[]'::jsonb,now(),'0.00',false,0)`, [lineId, orderId, productId, quantity]);
  await pool.query(`insert into invoices (id,organization_id,invoice_number,display_number,number_core,order_id,customer_id,status,terms,subtotal,tax,total,subtotal_cents,tax_cents,shipping_cents,total_cents,amount_paid,balance_due,created_by_user_id) values ($1,$2,$3,$4,$5,$6,$7,'draft','due_on_receipt','100.00','0.00','100.00',10000,0,0,10000,0,'100.00',$8)`, [invoiceId, organizationId, `8${n}`, `V2PF-INV-${n}`, 80_000 + n, orderId, customerId, ownerId]);
  await pool.query(`insert into production_jobs (id,organization_id,order_id,line_item_id,station_key,step_key,status) values ($1,$2,$3,$4,'flatbed','production','queued')`, [jobId, organizationId, orderId, lineId]);
  await pool.query(`insert into production_runs (id,organization_id,order_id,run_number,status,station_key,created_by_user_id) values ($1,$2,$3,$4,'ready_for_production','flatbed',$5)`, [runId, organizationId, orderId, n, ownerId]);
  await pool.query(`insert into production_run_members (id,organization_id,production_run_id,production_job_id,order_line_item_id,allocated_quantity) values ($1,$2,$3,$4,$5,$6)`, [memberId, organizationId, runId, jobId, lineId, quantity]);
  return { orderId, lineId, memberId, invoiceId };
};

const addLine = async (row: Fixture, quantity: number): Promise<Pick<Fixture, "lineId" | "memberId">> => {
  const n = ++sequence;
  const lineId = `v2poc-pf-line-${suffix}-${n}`;
  const jobId = `v2poc-pf-job-${suffix}-${n}`;
  const runId = `v2poc-pf-run-${suffix}-${n}`;
  const memberId = `v2poc-pf-member-${suffix}-${n}`;
  const source = await pool.query(`select product_id from order_line_items where id=$1`, [row.lineId]);
  await pool.query(`insert into order_line_items (id,order_id,product_id,product_type,description,quantity,unit_price,total_price,status,option_selections_json,selected_options,priced_at,tax_amount,is_taxable_snapshot,sort_order) values ($1,$2,$3,'wide_roll','V2 POC second fulfillment fixture',$4,'0.10','10.00','new','{}'::jsonb,'[]'::jsonb,now(),'0.00',false,1)`, [lineId, row.orderId, source.rows[0].product_id, quantity]);
  await pool.query(`insert into production_jobs (id,organization_id,order_id,line_item_id,station_key,step_key,status) values ($1,$2,$3,$4,'flatbed','production','queued')`, [jobId, orgA, row.orderId, lineId]);
  await pool.query(`insert into production_runs (id,organization_id,order_id,run_number,status,station_key,created_by_user_id) values ($1,$2,$3,$4,'ready_for_production','flatbed',$5)`, [runId, orgA, row.orderId, n, ownerA]);
  await pool.query(`insert into production_run_members (id,organization_id,production_run_id,production_job_id,order_line_item_id,allocated_quantity) values ($1,$2,$3,$4,$5,$6)`, [memberId, orgA, runId, jobId, lineId, quantity]);
  return { lineId, memberId };
};

beforeAll(async () => {
  await app().installExperimentalSchema();
  await pool.query(`insert into organizations (id,name,slug,default_tax_rate,tax_enabled) values ($1,'V2 POC Production A',$2,'0.0000',false),($3,'V2 POC Production B',$4,'0.0000',false)`, [orgA, `v2poc-pf-a-${suffix}`.slice(0, 96), orgB, `v2poc-pf-b-${suffix}`.slice(0, 96)]);
  await pool.query(`insert into users (id,email,role) values ($1,$2,'employee'),($3,$4,'employee')`, [ownerA, `v2-pf-owner-a-${suffix}@example.test`, ownerB, `v2-pf-owner-b-${suffix}@example.test`]);
  await pool.query(`insert into user_organizations (user_id,organization_id,role,is_default) values ($1,$2,'owner',true),($3,$4,'owner',true)`, [ownerA, orgA, ownerB, orgB]);
});

afterAll(async () => {
  try {
    await pool.query(`delete from v2_poc_fulfillment_requests where organization_id in ($1,$2)`, [orgA, orgB]);
    await pool.query(`delete from v2_poc_billing_reconciliations where organization_id in ($1,$2)`, [orgA, orgB]);
    await pool.query(`delete from fulfillment_events where organization_id in ($1,$2)`, [orgA, orgB]);
    await pool.query(`delete from pickup_handoffs where organization_id in ($1,$2)`, [orgA, orgB]);
    await pool.query(`delete from pickup_tickets where organization_id in ($1,$2)`, [orgA, orgB]);
    await pool.query(`delete from shipment_items where organization_id in ($1,$2)`, [orgA, orgB]);
    await pool.query(`delete from shipments where organization_id in ($1,$2)`, [orgA, orgB]);
    await pool.query(`delete from production_events where organization_id in ($1,$2)`, [orgA, orgB]);
    await pool.query(`delete from production_run_members where organization_id in ($1,$2)`, [orgA, orgB]);
    await pool.query(`delete from production_runs where organization_id in ($1,$2)`, [orgA, orgB]);
    await pool.query(`delete from production_jobs where organization_id in ($1,$2)`, [orgA, orgB]);
    await pool.query(`delete from invoice_line_items where invoice_id in (select id from invoices where organization_id in ($1,$2))`, [orgA, orgB]);
    await pool.query(`delete from invoices where organization_id in ($1,$2)`, [orgA, orgB]);
    await pool.query(`delete from order_line_items where order_id in (select id from orders where organization_id in ($1,$2))`, [orgA, orgB]);
    await pool.query(`delete from orders where organization_id in ($1,$2)`, [orgA, orgB]);
    await pool.query(`delete from products where organization_id in ($1,$2)`, [orgA, orgB]);
    await pool.query(`delete from customers where organization_id in ($1,$2)`, [orgA, orgB]);
    await pool.query(`delete from user_organizations where organization_id in ($1,$2)`, [orgA, orgB]);
    await pool.query(`delete from organizations where id in ($1,$2)`, [orgA, orgB]);
    await pool.query(`delete from users where id in ($1,$2)`, [ownerA, ownerB]);
  } finally { await pool.end(); }
});

describe("V2 production → partial fulfillment → billing reconciliation", () => {
  test("uses successful production as the authoritative source and supports partial pickup then shipment", async () => {
    const row = await fixture();
    await expect(app().recordProductionOutcome(ownerA, { organizationId: orgA, orderId: row.orderId, lineItemId: row.lineId, productionRunMemberId: row.memberId, successfulQuantity: 400, requestId: `production-fail-${suffix}` }, "before_commit")).rejects.toMatchObject({ code: "INJECTED_FAILURE" } satisfies Partial<V2PocError>);
    expect(await app().getAvailability(ownerA, orgA, row.orderId, row.lineId)).toMatchObject({ produced: 0, available: 0 });
    await app().recordProductionOutcome(ownerA, { organizationId: orgA, orderId: row.orderId, lineItemId: row.lineId, productionRunMemberId: row.memberId, successfulQuantity: 400, requestId: `production-400-${suffix}` });
    const first = await app().recordPickupHandoff(ownerA, { organizationId: orgA, orderId: row.orderId, lineItemId: row.lineId, quantity: 150, requestId: `pickup-150-${suffix}`, notes: "partial collection" });
    expect(first.availability).toEqual({ ordered: 1000, produced: 400, shipped: 0, pickedUp: 150, available: 250, remainingProduction: 600 });
    const history = await pool.query(`select h.id,hi.quantity from pickup_handoffs h join pickup_handoff_items hi on hi.pickup_handoff_id=h.id where h.organization_id=$1 and h.order_id=$2`, [orgA, row.orderId]);
    expect(history.rows).toHaveLength(1);
    expect(Number(history.rows[0].quantity)).toBe(150);
    await app().recordProductionOutcome(ownerA, { organizationId: orgA, orderId: row.orderId, lineItemId: row.lineId, productionRunMemberId: row.memberId, successfulQuantity: 700, requestId: `production-700-${suffix}` });
    const shipped = await app().finalizeShipment(ownerA, { organizationId: orgA, orderId: row.orderId, lineItemId: row.lineId, quantity: 200, requestId: `ship-200-${suffix}`, shipmentReference: `V2PF-${suffix}-200` });
    expect(shipped.availability).toEqual({ ordered: 1000, produced: 700, shipped: 200, pickedUp: 150, available: 350, remainingProduction: 300 });
    await expect(app().recordPickupHandoff(ownerA, { organizationId: orgA, orderId: row.orderId, lineItemId: row.lineId, quantity: 351, requestId: `overfill-${suffix}` })).rejects.toMatchObject({ code: "VALIDATION" } satisfies Partial<V2PocError>);
  });

  test("serializes pickup and shipment against one shared physical pool", async () => {
    const row = await fixture();
    await app().recordProductionOutcome(ownerA, { organizationId: orgA, orderId: row.orderId, lineItemId: row.lineId, productionRunMemberId: row.memberId, successfulQuantity: 100, requestId: `race-production-${suffix}` });
    const outcomes = await Promise.allSettled([
      app().recordPickupHandoff(ownerA, { organizationId: orgA, orderId: row.orderId, lineItemId: row.lineId, quantity: 75, requestId: `race-pickup-${suffix}` }),
      app().finalizeShipment(ownerA, { organizationId: orgA, orderId: row.orderId, lineItemId: row.lineId, quantity: 75, requestId: `race-shipment-${suffix}`, shipmentReference: `V2PF-RACE-${suffix}` }),
    ]);
    expect(outcomes.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((entry) => entry.status === "rejected")).toHaveLength(1);
    const availability = await app().getAvailability(ownerA, orgA, row.orderId, row.lineId);
    expect(availability).toMatchObject({ produced: 100, available: 25 });
    expect(availability.shipped + availability.pickedUp).toBe(75);
  });

  test("rolls back request, handoff, and event together and idempotently replays from a fresh instance", async () => {
    const row = await fixture();
    await app().recordProductionOutcome(ownerA, { organizationId: orgA, orderId: row.orderId, lineItemId: row.lineId, productionRunMemberId: row.memberId, successfulQuantity: 20, requestId: `rollback-production-${suffix}` });
    const command = { organizationId: orgA, orderId: row.orderId, lineItemId: row.lineId, quantity: 20, requestId: `rollback-pickup-${suffix}` };
    await expect(app().recordPickupHandoff(ownerA, command, "after_physical_write")).rejects.toMatchObject({ code: "INJECTED_FAILURE" } satisfies Partial<V2PocError>);
    expect((await pool.query(`select count(*)::int as count from pickup_handoffs where organization_id=$1 and order_id=$2`, [orgA, row.orderId])).rows[0].count).toBe(0);
    const first = await app().recordPickupHandoff(ownerA, command);
    const replay = await new PostgresProductionFulfillmentApplication(pool).recordPickupHandoff(ownerA, command);
    expect(replay).toMatchObject({ idempotentReplay: true, handoffId: first.handoffId });
    await expect(app().recordPickupHandoff(ownerA, { ...command, quantity: 19 })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" } satisfies Partial<V2PocError>);
  });

  test("persists terminal billing reconciliation, preserves physical truth after a failure, and retries", async () => {
    const row = await fixture();
    await app().recordProductionOutcome(ownerA, { organizationId: orgA, orderId: row.orderId, lineItemId: row.lineId, productionRunMemberId: row.memberId, successfulQuantity: 1000, requestId: `terminal-production-${suffix}` });
    const fulfilled = await app().recordPickupHandoff(ownerA, { organizationId: orgA, orderId: row.orderId, lineItemId: row.lineId, quantity: 1000, requestId: `terminal-pickup-${suffix}` });
    expect(fulfilled.reconciliationId).toBeTruthy();
    await expect(app().reconcileTerminalBilling(ownerA, orgA, row.orderId, "during_billing_reconciliation")).rejects.toMatchObject({ code: "INJECTED_FAILURE" } satisfies Partial<V2PocError>);
    expect(await app().getAvailability(ownerA, orgA, row.orderId, row.lineId)).toMatchObject({ available: 0, pickedUp: 1000 });
    expect(await app().pendingBilling(ownerA, orgA, row.orderId)).toMatchObject([{ status: "PENDING", attempts: 0 }]);
    const retried = await new PostgresProductionFulfillmentApplication(pool).reconcileTerminalBilling(ownerA, orgA, row.orderId);
    expect(retried).toEqual({ reconciled: 1, draftInvoiceId: row.invoiceId });
    expect(await app().pendingBilling(ownerA, orgA, row.orderId)).toMatchObject([{ status: "COMPLETED", attempts: 1 }]);
    expect((await pool.query(`select count(*)::int as count from invoices where organization_id=$1 and order_id=$2 and status='draft'`, [orgA, row.orderId])).rows[0].count).toBe(1);
  });

  test("does not reconcile an order until every physical line is terminal", async () => {
    const first = await fixture();
    const second = await addLine(first, 10);
    await app().recordProductionOutcome(ownerA, { organizationId: orgA, orderId: first.orderId, lineItemId: first.lineId, productionRunMemberId: first.memberId, successfulQuantity: 1000, requestId: `multi-a-production-${suffix}` });
    await app().recordProductionOutcome(ownerA, { organizationId: orgA, orderId: first.orderId, lineItemId: second.lineId, productionRunMemberId: second.memberId, successfulQuantity: 10, requestId: `multi-b-production-${suffix}` });
    const firstFulfillment = await app().recordPickupHandoff(ownerA, { organizationId: orgA, orderId: first.orderId, lineItemId: first.lineId, quantity: 1000, requestId: `multi-a-pickup-${suffix}` });
    expect(firstFulfillment.reconciliationId).toBeNull();
    const secondFulfillment = await app().finalizeShipment(ownerA, { organizationId: orgA, orderId: first.orderId, lineItemId: second.lineId, quantity: 10, requestId: `multi-b-shipment-${suffix}`, shipmentReference: `V2PF-MULTI-${suffix}` });
    expect(secondFulfillment.reconciliationId).toBeTruthy();
  });

  test("scopes every repository read and mutation to its tenant", async () => {
    const foreign = await fixture(orgB, ownerB, 10);
    await expect(app().getAvailability(ownerA, orgA, foreign.orderId, foreign.lineId)).rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<V2PocError>);
    await expect(app().recordProductionOutcome(ownerA, { organizationId: orgA, orderId: foreign.orderId, lineItemId: foreign.lineId, productionRunMemberId: foreign.memberId, successfulQuantity: 1, requestId: `foreign-${suffix}` })).rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<V2PocError>);
  });
});
