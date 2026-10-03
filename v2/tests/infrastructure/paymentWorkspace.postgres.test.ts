import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Pool, PoolClient } from "pg";
import { PostgresPaymentWorkspace, PostgresPaymentWorkspaceReadRunner } from "../../infrastructure/billing/postgresPaymentWorkspace.js";
import { readPendingProviderPaymentCents } from "../../infrastructure/billing/pendingProviderPaymentCents.js";
import { readReportingWindow } from "../../infrastructure/organization/postgresReportingClock.js";

assert.equal(process.env.V2_VALIDATION_MODE, "deterministic", "Use the cleanEnvironment/run deterministic runner.");
assert.deepEqual(Object.keys(process.env).filter((key) => /^(PG|DB)|DATABASE|POSTGRES|NEON|RAILWAY|CONNECTION_STRING/i.test(key)), []);
const db = new PGlite();
const statements: string[] = [];
const client = {
  async query(text: string, values?: readonly unknown[]) {
    statements.push(text);
    const result = await db.query(text, values ? [...values] : []);
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  }, release() {},
} as unknown as PoolClient;
const pool = { connect: async () => client } as unknown as Pool;
const port = new PostgresPaymentWorkspace(client);
const asOf = new Date("2026-03-08T18:00:00.000Z");
const code = (expected: string) => (error: unknown) => { assert.equal((error as { code: string }).code, expected); return true; };
let cases = 0;
async function check(name: string, action: () => Promise<void>) { await action(); cases++; console.log(`PASS ${name}`); }

try {
  // Only surrounding owner projections are minimal fixtures. All Payment,
  // allocation, Refund and immutable-history constraints use actual released DDL.
  await db.exec(`CREATE TABLE organizations(id varchar PRIMARY KEY,settings jsonb);
    CREATE TABLE users(id varchar PRIMARY KEY);
    CREATE TABLE customers(id varchar PRIMARY KEY,organization_id varchar NOT NULL REFERENCES organizations(id),display_name text,company_name text);
    CREATE TABLE v2_sales_documents(id varchar PRIMARY KEY,organization_id varchar NOT NULL REFERENCES organizations(id),display_number text,UNIQUE(id,organization_id));
    CREATE TABLE v2_billing_invoices(id varchar PRIMARY KEY,organization_id varchar NOT NULL REFERENCES organizations(id),sales_order_document_id varchar NOT NULL,customer_id varchar,currency varchar(3) NOT NULL,total_cents bigint NOT NULL,invoice_state text NOT NULL,invoice_display_number text,
      UNIQUE(id,organization_id),FOREIGN KEY(sales_order_document_id,organization_id) REFERENCES v2_sales_documents(id,organization_id));`);
  for (const [id, settings] of [["org-a", { timezone: "America/New_York" }], ["org-b", { timezone: "America/Los_Angeles" }], ["org-utc", {}], ["org-invalid", { timezone: "Invalid/Zone" }], ["org-empty", { timezone: "" }]] as const) await db.query("INSERT INTO organizations VALUES($1,$2::jsonb)", [id, JSON.stringify(settings)]);
  await db.query("INSERT INTO users VALUES('staff-a')");
  for (const filename of ["0180_v2_foundation_persistence.sql", "0207_v2_payments_refunds_foundation.sql", "0270_v2_payment_allocation_aggregate.sql", "0271_v2_refund_allocation_aggregate.sql"]) await db.exec(await readFile(new URL(`../../../server/db/migrations_v2/${filename}`, import.meta.url), "utf8"));
  await db.exec(`INSERT INTO customers VALUES('customer-a','org-a','Local Customer','Local Company'),('customer-b','org-b','FOREIGN CUSTOMER','FOREIGN COMPANY');
    INSERT INTO v2_sales_documents VALUES('order-1','org-a','ORD-1'),('order-2','org-a','ORD-2'),('order-3','org-a','ORD-3'),('order-eur','org-a','ORD-EUR'),('order-missing','org-a','ORD-MISSING'),('order-void','org-a','ORD-VOID'),('order-foreign','org-b','FOREIGN ORDER');
    INSERT INTO v2_billing_invoices VALUES
      ('invoice-1','org-a','order-1','customer-a','USD',20000,'draft',NULL),
      ('invoice-2','org-a','order-1','customer-a','USD',4000,'issued','INV-2'),
      ('invoice-3','org-a','order-3','customer-a','USD',10000,'draft',NULL),
      ('invoice-eur','org-a','order-eur','customer-a','EUR',5000,'draft',NULL),
      ('invoice-missing','org-a','order-missing',NULL,'USD',2500,'issued','INV-MISSING'),
      ('invoice-void','org-a','order-void','customer-a','USD',999,'void','INV-VOID'),
      ('invoice-foreign','org-b','order-foreign','customer-b','USD',999999,'draft',NULL);`);
  async function request(id: string, org: string) { await db.query("INSERT INTO v2_operation_requests(id,organization_id,operation,business_request_id,payload_fingerprint,initiated_principal_kind,initiated_principal_subject) VALUES($1,$2,'fixture',$1,'fixture','staff','staff-a')", [id, org]); }
  async function payment(id: string, org: string, currency: string, cents: number, allocations: readonly (readonly [string, number])[], occurred = "2026-03-08T12:00:00.000Z", recorded = "2026-03-08T12:30:00.000Z", kind = "staff", method = "cash") {
    await request(`op-${id}`, org);
    await db.query("INSERT INTO v2_billing_payments(id,organization_id,invoice_id,source,method,amount_cents,currency,occurred_at,recorded_at,principal_kind,principal_subject,staff_actor_user_id,operation_request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [id, org, allocations[0][0], kind === "service" ? "provider" : "manual", method, cents, currency, occurred, recorded, kind, kind === "service" ? "stripe-reconciliation" : id === "p-missing" ? "deleted-staff-id" : "staff-a", kind === "staff" && id !== "p-missing" ? "staff-a" : null, `op-${id}`]);
    for (const [invoice, value] of allocations) await db.query("INSERT INTO v2_billing_payment_allocations(id,organization_id,payment_id,invoice_id,amount_cents) VALUES($1,$2,$3,$4,$5)", [`${id}-${invoice}`, org, id, invoice, value]);
  }
  async function refund(id: string, original: string, allocations: readonly (readonly [string, number])[], recorded = "2026-03-08T14:00:00.000Z") {
    await request(`op-${id}`, "org-a");
    await db.query("INSERT INTO v2_billing_refunds(id,organization_id,invoice_id,source,amount_cents,currency,occurred_at,recorded_at,principal_kind,principal_subject,operation_request_id) VALUES($1,'org-a',$2,'manual',$3,'USD',$4,$4,'staff','staff-a',$5)", [id, allocations[0][0], allocations.reduce((sum, [, value]) => sum + value, 0), recorded, `op-${id}`]);
    for (const [invoice, value] of allocations) {
      const allocationId = `${id}-${invoice}`;
      await db.query("INSERT INTO v2_billing_refund_allocations(id,organization_id,refund_id,payment_id,amount_cents) VALUES($1,'org-a',$2,$3,$4)", [allocationId, id, original, value]);
      await db.query("INSERT INTO v2_billing_refund_allocation_evidence(refund_allocation_id,organization_id,refund_id,payment_id,payment_allocation_id,invoice_id,amount_cents) VALUES($1,'org-a',$2,$3,$4,$5,$6)", [allocationId, id, original, `${original}-${invoice}`, invoice, value]);
    }
  }
  await payment("p-a", "org-a", "USD", 10000, [["invoice-1", 6000], ["invoice-2", 4000]]);
  await payment("p-b", "org-a", "USD", 10000, [["invoice-1", 10000]]);
  await payment("p-eur", "org-a", "EUR", 5000, [["invoice-eur", 5000]]);
  await payment("p-service", "org-a", "USD", 3000, [["invoice-3", 3000]], undefined, undefined, "service", "card");
  await payment("p-missing", "org-a", "USD", 2500, [["invoice-missing", 2500]]);
  await payment("p-at-start", "org-a", "USD", 700, [["invoice-3", 700]], "2026-03-08T05:00:00.000Z");
  await payment("p-at-end", "org-a", "USD", 800, [["invoice-3", 800]], "2026-03-09T04:00:00.000Z");
  await payment("p-prior", "org-a", "USD", 100, [["invoice-3", 100]], "2026-03-08T04:59:59.999Z");
  await payment("p-future-record", "org-a", "USD", 900, [["invoice-3", 900]], undefined, "2026-03-09T12:30:00.000Z");
  await payment("p-foreign", "org-b", "USD", 999999, [["invoice-foreign", 999999]]);
  await refund("r-a", "p-a", [["invoice-1", 1500], ["invoice-2", 500]]);
  await refund("r-b", "p-b", [["invoice-1", 10000]]);
  await refund("r-later", "p-a", [["invoice-2", 500]], "2026-03-09T14:00:00.000Z");

  await check("PostgreSQL DST spring day is 23h and fall day is 25h", async () => {
    for (const [when, start, end, hours] of [["2026-03-08T18:00:00Z", "2026-03-08T05:00:00.000Z", "2026-03-09T04:00:00.000Z", 23], ["2026-11-01T18:00:00Z", "2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z", 25]] as const) {
      const window = await readReportingWindow(client, "org-a", { period: "today", asOf: new Date(when) });
      assert.equal(window.startInclusive, start); assert.equal(window.endExclusive, end);
      assert.equal((Date.parse(window.endExclusive) - Date.parse(window.startInclusive)) / 3_600_000, hours);
    }
  });
  await check("local midnight flips Today and Month with correct rollover", async () => {
    const before = await readReportingWindow(client, "org-a", { period: "month", asOf: new Date("2026-03-01T04:59:59.999Z") });
    assert.equal(before.todayDate, "2026-02-28"); assert.equal(before.tomorrowDate, "2026-03-01");
    assert.equal(before.startInclusive, "2026-02-01T05:00:00.000Z"); assert.equal(before.endExclusive, "2026-03-01T05:00:00.000Z");
    const midnight = await readReportingWindow(client, "org-a", { period: "today", asOf: new Date("2026-03-01T05:00:00.000Z") });
    assert.equal(midnight.todayDate, "2026-03-01"); assert.equal(midnight.startInclusive, "2026-03-01T05:00:00.000Z");
    const month = await readReportingWindow(client, "org-a", { period: "month", asOf: new Date(midnight.asOf) });
    assert.equal(month.endExclusive, "2026-04-01T04:00:00.000Z");
  });
  await check("tenant zones are isolated and missing timezone is explicit UTC fallback", async () => {
    const a = await readReportingWindow(client, "org-a", { period: "today", asOf });
    const b = await readReportingWindow(client, "org-b", { period: "today", asOf });
    const fallback = await readReportingWindow(client, "org-utc", { period: "today", asOf });
    assert.equal(a.timeZone, "America/New_York"); assert.equal(b.timeZone, "America/Los_Angeles");
    assert.equal(b.startInclusive, "2026-03-08T08:00:00.000Z"); assert.equal(b.endExclusive, "2026-03-09T07:00:00.000Z");
    assert.equal(fallback.timeZoneSource, "default_utc"); assert.equal(fallback.timeZone, "UTC"); assert.equal(fallback.startInclusive, "2026-03-08T00:00:00.000Z");
    assert.equal(a.timeZoneSource, "organization");
  });
  await check("invalid configured zones fail visibly rather than becoming UTC", async () => {
    for (const org of ["org-invalid", "org-empty"]) await assert.rejects(readReportingWindow(client, org, { period: "today", asOf }), code("CONFLICT"));
    await assert.rejects(readReportingWindow(client, "not-a-tenant", { period: "today", asOf }), code("NOT_FOUND"));
  });
  await check("custom date roundtrip rejects invalid, reversed and oversized spans and internal invalid clocks", async () => {
    for (const [fromDate, toDate] of [["2026-02-30", "2026-03-01"], ["2026-3-01", "2026-03-02"], ["2026-01-02", "2026-01-01"], ["2024-01-01", "2025-01-01"], ["2026-01-01T00:00:00Z", "2026-01-02"]]) await assert.rejects(readReportingWindow(client, "org-a", { period: "custom", fromDate, toDate, asOf }), code("VALIDATION_ERROR"));
    await assert.rejects(readReportingWindow(client, "org-a", { period: "today", asOf: new Date("invalid") }), code("VALIDATION_ERROR"));
    const custom = await readReportingWindow(client, "org-a", { period: "custom", fromDate: "2026-03-08", toDate: "2026-03-08", asOf });
    assert.equal(custom.startInclusive, "2026-03-08T05:00:00.000Z"); assert.equal(custom.endExclusive, "2026-03-09T04:00:00.000Z");
    const leap = await readReportingWindow(client, "org-utc", { period: "custom", fromDate: "2024-01-01", toDate: "2024-12-31", asOf });
    assert.equal(leap.endExclusive, "2025-01-01T00:00:00.000Z");
  });
  const window = await port.readWindow("org-a", { period: "today" }, asOf);
  await check("equal-valued different payments and multi-invoice fanout are not double-counted; currencies stay separate", async () => {
    const page = await port.pagePayments("org-a", { period: "today" }, window);
    assert.deepEqual(page.summary, { paymentCount: 6, byCurrency: [
      { currency: "EUR", paymentCount: 1, amountCents: 5000, appliedCents: 5000, refundedCents: 0, netCents: 5000 },
      { currency: "USD", paymentCount: 5, amountCents: 26200, appliedCents: 26200, refundedCents: 12000, netCents: 14200 },
    ] });
    assert.equal(page.items.filter((item) => item.paymentId === "p-a").length, 1); assert.equal(page.items.filter((item) => item.paymentId === "p-b").length, 1);
    const a = page.items.find((item) => item.paymentId === "p-a")!;
    assert.equal(a.allocations.length, 2); assert.deepEqual(a.allocations.map((entry) => entry.amount.cents), [6000, 4000]);
    assert.deepEqual(a.allocations.map((entry) => entry.orderId), ["order-1", "order-1"], "two Invoice allocations for one Order remain distinct details, not duplicate Payments");
    assert.deepEqual(a.allocations.map((entry) => entry.refundedAmount.cents), [1500, 500]);
    assert.equal(a.refundState, "partially_refunded"); assert.equal(a.netAmount.cents, 8000);
    assert.equal(page.items.find((item) => item.paymentId === "p-b")!.refundState, "fully_refunded");
    assert.equal(page.items.find((item) => item.paymentId === "p-eur")!.refundState, "not_refunded");
    assert.equal(page.scope, "v2_payment_facts"); assert.deepEqual(page.window, window);
  });
  await check("half-open occurred window and known recorded time exclude exact end, prior and later-recorded facts", async () => {
    const page = await port.pagePayments("org-a", { period: "today" }, window);
    assert.ok(page.items.some((item) => item.paymentId === "p-at-start"));
    for (const id of ["p-at-end", "p-prior", "p-future-record", "p-foreign"]) assert.ok(!page.items.some((item) => item.paymentId === id));
  });
  await check("stable tied-time pagination pages Payment facts before allocation presentation", async () => {
    const ids: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const result = await port.pagePayments("org-a", { period: "today", page, pageSize: 2 }, window);
      assert.equal(result.totalMatching, 6); assert.equal(result.hasNextPage, page < 3);
      ids.push(...result.items.map((item) => item.paymentId));
    }
    assert.deepEqual(ids, ["p-a", "p-b", "p-eur", "p-missing", "p-service", "p-at-start"]); assert.equal(new Set(ids).size, 6);
    const empty = await port.pagePayments("org-a", { period: "today", page: 4, pageSize: 2 }, window);
    assert.deepEqual(empty.items, []); assert.equal(empty.totalMatching, 6);
  });
  await check("Customer/method filters apply identically to list and Dashboard summary", async () => {
    const query = { period: "today" as const, customerId: "customer-a", method: "cash" as const, pageSize: 1 };
    const page = await port.pagePayments("org-a", query, window), summary = await port.summarizePayments("org-a", query, window);
    assert.deepEqual(page.summary, summary.summary); assert.deepEqual(page.window, summary.window); assert.equal(page.summary.paymentCount, 4);
    assert.equal(page.summary.byCurrency.find((entry) => entry.currency === "USD")!.amountCents, 20700);
    const foreign = await port.pagePayments("org-a", { period: "today", customerId: "customer-b" }, window);
    assert.equal(foreign.totalMatching, 0); assert.deepEqual(foreign.summary.byCurrency, []);
  });
  await check("recorded Staff identity survives missing user; Service actor is never labeled Staff", async () => {
    const page = await port.pagePayments("org-a", { period: "today" }, window);
    assert.deepEqual(page.items.find((item) => item.paymentId === "p-service")!.actor, { kind: "service", subjectId: "stripe-reconciliation" });
    assert.deepEqual(page.items.find((item) => item.paymentId === "p-missing")!.actor, { kind: "staff", subjectId: "deleted-staff-id" });
    assert.equal(page.items.find((item) => item.paymentId === "p-missing")!.allocations[0].customerName, undefined);
    assert.equal(page.items.find((item) => item.paymentId === "p-a")!.actor.staffActorUserId, "staff-a");
    assert.ok(!JSON.stringify(page).includes("FOREIGN"));
  });
  await check("Custom cohort refunds include subsequent refunds known asOf, not only refunds occurring inside period", async () => {
    const query = { period: "custom" as const, fromDate: "2026-03-08", toDate: "2026-03-08" };
    const later = await port.readWindow("org-a", query, new Date("2026-03-10T18:00:00.000Z"));
    const page = await port.pagePayments("org-a", query, later);
    assert.equal(page.items.find((item) => item.paymentId === "p-a")!.refundedAmount.cents, 2500);
    assert.equal(page.summary.byCurrency.find((entry) => entry.currency === "USD")!.refundedCents, 12500);
    assert.equal(page.summary.paymentCount, 7); // Newly recorded backdated Payment joins the cohort.
  });
  await check("picker balances match canonical allocation/refund formula, including draft and additional Invoices", async () => {
    const picker = await port.pageCollectibleInvoices("org-a", { customerId: "customer-a" });
    assert.equal(picker.items.find((item) => item.invoiceId === "invoice-1")!.collectibleBalance.cents, 15500);
    assert.equal(picker.items.find((item) => item.invoiceId === "invoice-2")!.collectibleBalance.cents, 1000);
    assert.ok(!picker.items.some((item) => ["invoice-void", "invoice-eur", "invoice-foreign", "invoice-missing"].includes(item.invoiceId)));
    assert.deepEqual((await port.pageCollectibleInvoices("org-a", { customerId: "customer-b" })).items, []);
    const paged = await port.pageCollectibleInvoices("org-a", { customerId: "customer-a", pageSize: 1 });
    assert.equal(paged.hasNextPage, true); assert.equal(paged.items.length, 1);
  });
  await check("scoped Customer presentation read neither leaks foreign tenant nor interprets legacy payment tables", async () => {
    assert.deepEqual(await port.listCustomers("org-a", "Local"), [{ customerId: "customer-a", customerName: "Local Customer" }]);
    assert.deepEqual(await port.listCustomers("org-a", "%"), []);
    assert.deepEqual(await port.listCustomers("org-a", "FOREIGN"), []);
  });
  await check("pending provider reservation sums scalar invoice_id and aggregate allocation_intent exactly once", async () => {
    const providerOperation = async (id: string, invoiceId: string, cents: number, state: "pending" | "uncertain" | "succeeded" | "failed", allocations: readonly Readonly<{ invoiceId: string; amountCents: number }>[] = []) => {
      const requestId = `op-provider-${id}`;
      await request(requestId, "org-a");
      await db.query("INSERT INTO v2_billing_provider_financial_operations(id,organization_id,invoice_id,operation_kind,provider,provider_idempotency_key,amount_cents,currency,reconciliation_state,operation_request_id,allocation_intent) VALUES($1,'org-a',$2,'payment','stripe',$3,$4,'USD',$5,$6,$7::jsonb)", [id, invoiceId, `key-${id}`, cents, state, requestId, JSON.stringify(allocations)]);
    };
    await providerOperation("scalar-pending", "invoice-1", 500, "pending");
    await providerOperation("aggregate-uncertain", "invoice-1", 4000, "uncertain", [{ invoiceId: "invoice-1", amountCents: 2500 }, { invoiceId: "invoice-2", amountCents: 1500 }]);
    await providerOperation("scalar-failed", "invoice-1", 900, "failed");
    await providerOperation("scalar-succeeded", "invoice-1", 800, "succeeded");
    assert.equal(await readPendingProviderPaymentCents(client, "org-a", "invoice-1"), 3000);
    assert.equal(await readPendingProviderPaymentCents(client, "org-a", "invoice-2"), 1500);
    assert.equal(await readPendingProviderPaymentCents(client, "org-a", "invoice-3"), 0);
  });
  await check("window+page+summary share a real REPEATABLE READ READ ONLY transaction", async () => {
    const from = statements.length;
    await new PostgresPaymentWorkspaceReadRunner(pool).read(async (read) => {
      const window = await read.readWindow("org-a", { period: "today" }, asOf);
      const page = await read.pagePayments("org-a", { period: "today" }, window), summary = await read.summarizePayments("org-a", { period: "today" }, window);
      assert.deepEqual(page.summary, summary.summary);
    });
    assert.equal(statements[from], "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    assert.equal(statements.at(-1), "COMMIT");
    assert.ok(statements.slice(from).every((sql) => !/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(sql)));
    await assert.rejects(db.query("UPDATE v2_billing_payments SET amount_cents=1 WHERE id='p-a'"), /immutable/);
    await assert.rejects(db.query("DELETE FROM v2_billing_payment_allocations WHERE payment_id='p-a'"), /immutable/);
  });
  console.log(`paymentWorkspace.postgres.test: ${cases} real PGlite scenarios PASS (no URL, provider or live database).`);
} finally { await db.close(); }
