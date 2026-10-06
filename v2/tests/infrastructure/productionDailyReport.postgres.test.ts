import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Pool, PoolClient } from "pg";
import { PostgresProductionDailyReport, productionDailyReportCandidateLimit, type ProductionDailyReportReadDependencies } from "../../infrastructure/production/postgresProductionDailyReport.js";
import { PostgresProductionTransaction } from "../../infrastructure/production/postgresProductionTransaction.js";
import { PostgresProductionRunTransaction, PostgresProductionRunTransactionRunner } from "../../infrastructure/production/postgresProductionRunTransaction.js";
import { PostgresProductionCompletionProjection } from "../../infrastructure/production/postgresProductionCompletionProjection.js";
import { ProductionApplicationService } from "../../src/modules/production/productionApplication.js";
import { normalizeProductionDailyReportRequest, summarizeProductionDailyReport, type ProductionDailyReportScope } from "../../src/modules/production/productionDailyReport.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

// Embedded, disposable PostgreSQL only. Selected Production DDL and its actual
// usable-output function run unchanged; foreign owners expose minimal declared
// schemas. Writer triggers/reconciliation and live concurrency are not rehearsed.
const db = new PGlite();
const migration = (name: string) => readFile(new URL(`../../../server/db/migrations_v2/${name}`, import.meta.url), "utf8");
const table = (source: string, name: string) => {
  const found = source.match(new RegExp(`CREATE TABLE ${name} \\([\\s\\S]*?\\n\\);`));
  assert.ok(found, `source DDL exists for ${name}`); return found[0];
};
const org = brandedId<"OrganizationId">("org-a");
const calendar = { asOf: "2026-10-01T05:25:00.000Z", timeZone: "America/New_York", todayDate: "2026-10-01", tomorrowDate: "2026-10-02" };
const queries: string[] = [];
const suppliedScopes: (readonly ProductionDailyReportScope[])[] = [];
let releases = 0, connections = 0;
const client = {
  async query(sql: string, values?: unknown[]) {
    queries.push(sql);
    const result = await db.query(sql, values);
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  },
  release() { releases++; },
} as unknown as PoolClient;
const pool = { connect: async () => { connections++; return client; } } as Pick<Pool, "connect">;
const dependencies: ProductionDailyReportReadDependencies = {
  async readReportingCalendar(connection, organizationId) {
    assert.equal(connection, client); assert.ok(organizationId === "org-a" || organizationId === "org-b");
    const isolation = await connection.query("SHOW transaction_isolation"), readOnly = await connection.query("SHOW transaction_read_only");
    assert.equal(isolation.rows[0].transaction_isolation, "repeatable read"); assert.equal(readOnly.rows[0].transaction_read_only, "on");
    return calendar;
  },
  async readOperationalAttention(connection, organizationId, scopes) {
    assert.equal(connection, client, "owner projection must share the report snapshot");
    suppliedScopes.push(scopes);
    const result = await connection.query(`SELECT s."productionWorkId",s."orderId",s."orderLineId",s."requirementKey",s."replacementObligationId",COALESCE(work.state,p.state) state
      FROM jsonb_to_recordset($2::jsonb) AS s("productionWorkId" text,"orderId" text,"orderLineId" text,"requirementKey" text,"replacementObligationId" text)
      LEFT JOIN report_owner_attention_fixture p ON p.organization_id=$1 AND p.order_id=s."orderId" AND p.scope=COALESCE(s."replacementObligationId",'original')
      LEFT JOIN report_owner_work_attention_fixture work ON work.organization_id=$1 AND work.production_work_id=s."productionWorkId"`, [organizationId, JSON.stringify(scopes)]);
    return result.rows.map(row => ({ productionWorkId: row.productionWorkId, orderId: row.orderId, orderLineId: row.orderLineId, requirementKey: row.requirementKey, ...(row.replacementObligationId ? { replacementObligationId: row.replacementObligationId } : {}), state: row.state }));
  },
};
const adapter = new PostgresProductionDailyReport(pool, dependencies);
const read = (request = {}) => adapter.readDailyReport(org, normalizeProductionDailyReportRequest(request));

try {
  await db.exec(`
    CREATE TABLE organizations(id varchar PRIMARY KEY);
    CREATE TABLE users(id varchar PRIMARY KEY);
    CREATE TABLE customers(id varchar PRIMARY KEY,organization_id varchar,display_name text,company_name text);
    CREATE TABLE v2_sales_documents(id varchar PRIMARY KEY,organization_id varchar,document_kind text,display_number text,customer_id varchar,requested_due_date date,purchase_order_number text,notes text,UNIQUE(id,organization_id));
    CREATE TABLE v2_sales_order_details(document_id varchar,organization_id varchar,commercial_state text,archived_at timestamptz,requested_fulfillment_method text,UNIQUE(document_id,organization_id));
    CREATE TABLE v2_sales_document_lines(id varchar PRIMARY KEY,organization_id varchar,document_id varchar,product_id varchar,description text,quantity integer,UNIQUE(id,organization_id,document_id));
    CREATE TABLE v2_sales_line_production_requirements(organization_id varchar,order_line_id varchar,requirement_key varchar,PRIMARY KEY(organization_id,order_line_id,requirement_key));
    CREATE TABLE v2_artwork_assignments(id varchar PRIMARY KEY,organization_id varchar,artwork_file_id varchar,UNIQUE(id,organization_id),UNIQUE(id,organization_id,artwork_file_id));
    CREATE TABLE v2_prepress_units(id varchar PRIMARY KEY,organization_id varchar,artwork_assignment_id varchar,completed_at timestamptz,UNIQUE(id,organization_id));
    CREATE TABLE v2_route_instances(id varchar PRIMARY KEY,organization_id varchar,order_document_id varchar,order_line_id varchar,current_step_id varchar,route_state text,UNIQUE(organization_id,order_line_id));
    CREATE TABLE v2_route_instance_steps(id varchar PRIMARY KEY,organization_id varchar,route_instance_id varchar,step_kind text,production_destination_station_key text);
    CREATE TABLE v2_sales_line_workflow_exceptions(organization_id varchar,order_line_id varchar,production_destination text,PRIMARY KEY(organization_id,order_line_id));
    CREATE TABLE v2_fulfillment_handoffs(id varchar PRIMARY KEY,organization_id varchar,order_document_id varchar,UNIQUE(id,organization_id));
    CREATE TABLE v2_fulfillment_handoff_lines(id varchar PRIMARY KEY,organization_id varchar,handoff_id varchar,order_document_id varchar,order_line_id varchar,quantity integer);
    CREATE TABLE v2_fulfillment_shipments(id varchar PRIMARY KEY,organization_id varchar,UNIQUE(id,organization_id));
    CREATE TABLE v2_billing_invoices(id varchar PRIMARY KEY,organization_id varchar,sales_order_document_id varchar,total_cents integer,invoice_state text);
    CREATE TABLE report_owner_attention_fixture(organization_id varchar,order_id varchar,scope text,state text,PRIMARY KEY(organization_id,order_id,scope));
    CREATE TABLE report_owner_work_attention_fixture(organization_id varchar,production_work_id varchar,state text,PRIMARY KEY(organization_id,production_work_id));
    INSERT INTO organizations VALUES('org-a'),('org-b');
    INSERT INTO customers VALUES('customer-a','org-a','A customer','A company'),('customer-b','org-b','FOREIGN TENANT CUSTOMER','Foreign company');
  `);
  const foundation = await migration("0204_v2_production_domain_foundation.sql");
  await db.exec(foundation.slice(foundation.indexOf("CREATE TABLE v2_production_works"), foundation.indexOf("-- Exact evidence")));
  const cycles = await migration("0280_v2_production_rework_successor_cycles.sql");
  await db.exec(table(cycles, "v2_production_rework_cycles"));
  await db.exec(cycles.slice(cycles.indexOf("ALTER TABLE v2_production_works ADD COLUMN rework_cycle_id"), cycles.indexOf("-- A rework unit")));
  await db.exec(await migration("0281_v2_rework_cycle_destination_snapshot.sql"));
  const events = await migration("0276_v2_production_exception_evidence.sql");
  await db.exec(table(events, "v2_production_work_events"));
  await db.exec(await migration("0277_v2_production_rework_request_evidence.sql"));
  const runs = await migration("0279_v2_canonical_production_runs.sql");
  await db.exec(runs.slice(runs.indexOf("CREATE TABLE v2_production_runs"), runs.indexOf("CREATE TABLE v2_production_run_events")));
  const rejected = await migration("0282_v2_production_output_rejections.sql");
  await db.exec(table(rejected, "v2_production_output_dispositions"));
  await db.exec(rejected.slice(rejected.indexOf("CREATE OR REPLACE FUNCTION v2_usable_production_good_quantity"), rejected.indexOf("CREATE OR REPLACE FUNCTION v2_production_output_disposition_validate")));
  await db.exec(rejected.slice(rejected.indexOf("ALTER TABLE v2_production_work_events"), rejected.indexOf("INSERT INTO v2_permission_capabilities")));
  const replacements = await migration("0283_v2_replacement_obligations_shipping_economics.sql");
  await db.exec(replacements.slice(replacements.indexOf("CREATE TABLE v2_order_replacement_obligations"), replacements.indexOf("-- Shipping cost")));
  const replacementExecution = await migration("0284_v2_replacement_obligation_execution.sql");
  await db.exec(replacementExecution.slice(replacementExecution.indexOf("DROP INDEX v2_production_works_replacement_obligation_uidx"), replacementExecution.indexOf("CREATE TABLE v2_order_replacement_obligation_events")));

  const order = async (id: string, due: string | null, options: { org?: string; state?: string; archived?: boolean; method?: string | null; customer?: string; attention?: string } = {}) => {
    const tenant = options.org ?? "org-a";
    await db.query("INSERT INTO v2_sales_documents(id,organization_id,document_kind,display_number,customer_id,requested_due_date,purchase_order_number,notes) VALUES($1,$2,'order',$3,$4,$5,'PO-42','TEMP notes are not a Job Label')", [id, tenant, `ORD-${id}`, options.customer ?? (tenant === "org-a" ? "customer-a" : "customer-b"), due]);
    await db.query("INSERT INTO v2_sales_order_details VALUES($1,$2,$3,$4,$5)", [id, tenant, options.state ?? "open", options.archived ? new Date() : null, options.method ?? null]);
    await db.query("INSERT INTO report_owner_attention_fixture VALUES($1,$2,'original',$3)", [tenant, id, options.attention ?? "requires_attention"]);
  };
  const line = async (id: string, orderId: string, destination: string | null, tenant = "org-a") => {
    await db.query("INSERT INTO v2_sales_document_lines VALUES($1,$2,$3,'product-a','Frozen line description',10)", [id, tenant, orderId]);
    await db.query("INSERT INTO v2_sales_line_production_requirements VALUES($1,$2,'unit')", [tenant, id]);
    if (destination) {
      await db.query("INSERT INTO v2_route_instances VALUES($1,$2,$3,$4,$5,'active')", [`route-${id}`, tenant, orderId, id, `step-${id}`]);
      await db.query("INSERT INTO v2_route_instance_steps VALUES($1,$2,$3,'production',$4)", [`step-${id}`, tenant, `route-${id}`, destination]);
    }
  };
  const work = async (id: string, orderId: string, lineId: string, options: { org?: string; quantity?: number; replacement?: string; origin?: string; cycle?: string; predecessor?: string } = {}) => {
    const tenant = options.org ?? "org-a";
    await db.query("INSERT INTO v2_artwork_assignments(id,organization_id,artwork_file_id) VALUES($1,$2,$3)", [`art-${id}`, tenant, `file-${id}`]);
    await db.query(`INSERT INTO v2_production_works(id,organization_id,order_document_id,order_line_id,requirement_key,artwork_assignment_id,artwork_file_id,ordered_quantity,created_principal_kind,created_principal_subject,replacement_obligation_id,replacement_origin_production_work_id,rework_cycle_id,predecessor_production_work_id)
      VALUES($1,$2,$3,$4,'unit',$5,$6,$7,'staff','staff-a',$8,$9,$10,$11)`, [id, tenant, orderId, lineId, `art-${id}`, `file-${id}`, options.quantity ?? 10, options.replacement ?? null, options.origin ?? null, options.cycle ?? null, options.predecessor ?? null]);
  };
  const attempt = (id: string, workId: string, good: number, completed: boolean, station = "roll", tenant = "org-a", sequence = 1) => db.query(`INSERT INTO v2_production_attempts(id,organization_id,production_work_id,sequence,attempt_kind,station_key,good_quantity,started_principal_kind,started_principal_subject,completed_at,completed_principal_kind,completed_principal_subject)
    VALUES($1,$2,$3,$4,'initial',$5,$6,'staff','staff-a',$7,$8,$9)`, [id, tenant, workId, sequence, station, good, completed ? new Date("2026-09-01T12:00:00Z") : null, completed ? "staff" : null, completed ? "staff-a" : null]);
  const event = (id: string, workId: string, kind: string) => db.query("INSERT INTO v2_production_work_events(id,organization_id,production_work_id,sequence,event_kind,category,reason,recorded_good_quantity,recorded_waste_quantity,created_principal_kind,created_principal_subject) VALUES($1,'org-a',$2,1,$3,'quality','Needs review',0,0,'staff','staff-a')", [id, workId, kind]);
  const replacement = async (id: string, orderId: string, lineId: string, status = "open") => {
    await db.query("INSERT INTO v2_order_replacement_obligations(id,organization_id,order_document_id,order_line_id,replacement_quantity,reason,responsibility,billing_treatment,status,created_principal_kind,created_principal_subject) VALUES($1,'org-a',$2,$3,10,'damage','titan','no_charge',$4,'staff','staff-a')", [id, orderId, lineId, status]);
    await db.query("INSERT INTO report_owner_attention_fixture VALUES('org-a',$1,$2,$3)", [orderId, id, status === "cancelled" ? "operationally_complete" : "requires_attention"]);
  };
  const cycle = (id: string, predecessor: string, orderId: string, lineId: string, destination: string) => db.query(`INSERT INTO v2_production_rework_cycles(id,organization_id,predecessor_production_work_id,order_document_id,order_line_id,requirement_key,prior_artwork_assignment_id,remaining_required_quantity,reason,created_principal_kind,created_principal_subject,destination_station_key)
    VALUES($1,'org-a',$2,$3,$4,'unit',$5,7,'rework','staff','staff-a',$6)`, [id, predecessor, orderId, lineId, `art-${predecessor}`, destination]);
  const fulfilledOriginal = async (orderId: string, lineId: string) => {
    await db.query("INSERT INTO v2_fulfillment_handoffs(id,organization_id,order_document_id) VALUES($1,'org-a',$2)", [`handoff-${orderId}`, orderId]);
    await db.query("INSERT INTO v2_fulfillment_handoff_lines VALUES($1,'org-a',$2,$3,$4,10)", [`handoff-line-${orderId}`, `handoff-${orderId}`, orderId, lineId]);
  };

  await order("mixed", "2026-09-30", { method: "shipping" });
  await line("mixed-roll", "mixed", "roll"); await work("mixed-roll", "mixed", "mixed-roll");
  await line("mixed-flat", "mixed", "flatbed"); await work("mixed-flat", "mixed", "mixed-flat");
  await order("today", "2026-10-01", { method: "pickup" }); await line("today", "today", "roll"); await work("active-zero", "today", "today"); await attempt("active-zero", "active-zero", 10, false);
  await db.query("UPDATE v2_route_instance_steps SET production_destination_station_key='flatbed' WHERE id='step-today'");
  await order("tomorrow", "2026-10-02", { method: "local_delivery" }); await line("tomorrow", "tomorrow", "flatbed"); await work("held-zero", "tomorrow", "tomorrow"); await attempt("held-zero", "held-zero", 10, false, "flatbed"); await event("held-zero", "held-zero", "hold");
  await db.query("INSERT INTO v2_production_work_events(id,organization_id,production_work_id,sequence,event_kind,note,created_principal_kind,created_principal_subject) VALUES('held-note','org-a','held-zero',2,'note','A note must not mask the hold','staff','staff-a')");
  await order("future", "2026-10-03"); await line("future", "future", "roll"); await work("future", "future", "future");
  await order("undated", null, { customer: "customer-b" }); await line("undated", "undated", null); await work("undated", "undated", "undated");
  for (const excluded of ["completed", "cancelled", "archived", "quantity-complete"]) {
    await order(excluded, "2026-09-01", { state: excluded === "completed" || excluded === "cancelled" ? excluded : "open", archived: excluded === "archived", attention: excluded === "completed" ? "operationally_complete" : "requires_attention" });
    await line(excluded, excluded, "roll"); await work(excluded, excluded, excluded);
  }
  await attempt("quantity-complete", "quantity-complete", 10, true);
  await order("foreign", "2000-01-01", { org: "org-b" }); await line("foreign", "foreign", "roll", "org-b"); await work("foreign", "foreign", "foreign", { org: "org-b" });

  await order("rework", "2026-10-04"); await line("rework", "rework", "flatbed"); await work("rework-predecessor", "rework", "rework"); await event("rework-request", "rework-predecessor", "rework_requested");
  await cycle("original-cycle", "rework-predecessor", "rework", "rework", "roll");
  await work("rework-successor", "rework", "rework", { cycle: "original-cycle", predecessor: "rework-predecessor", quantity: 7 });

  await order("unpaid", "2026-09-02", { attention: "operationally_complete", method: "pickup" }); await line("unpaid", "unpaid", "roll"); await work("unpaid-predecessor", "unpaid", "unpaid"); await attempt("unpaid-part", "unpaid-predecessor", 3, true); await event("unpaid-rework", "unpaid-predecessor", "rework_requested");
  await cycle("unpaid-cycle", "unpaid-predecessor", "unpaid", "unpaid", "roll"); await work("unpaid-successor", "unpaid", "unpaid", { cycle: "unpaid-cycle", predecessor: "unpaid-predecessor", quantity: 7 }); await attempt("unpaid-rest", "unpaid-successor", 7, true);
  await db.query("INSERT INTO v2_billing_invoices VALUES('unpaid-invoice','org-a','unpaid',1000,'issued')");
  await fulfilledOriginal("unpaid", "unpaid");
  assert.equal((await new PostgresProductionCompletionProjection(client).readCompletion(org, brandedId<"OrderLineId">("unpaid"))).state, "complete");
  assert.equal((await db.query("SELECT SUM(quantity)::integer fulfilled_quantity FROM v2_fulfillment_handoff_lines WHERE organization_id='org-a' AND order_document_id='unpaid'")).rows[0]!.fulfilled_quantity, 10);

  await order("replacement", "2026-10-05", { attention: "operationally_complete" }); await line("replacement", "replacement", null); await work("replacement-original", "replacement", "replacement"); await attempt("replacement-original", "replacement-original", 10, true, "flatbed");
  await fulfilledOriginal("replacement", "replacement");
  await replacement("replacement-open", "replacement", "replacement"); await work("replacement-active", "replacement", "replacement", { replacement: "replacement-open", origin: "replacement-original" });
  await replacement("replacement-cancelled", "replacement", "replacement", "cancelled"); await work("replacement-cancelled", "replacement", "replacement", { replacement: "replacement-cancelled", origin: "replacement-original" });

  await order("contamination", "2026-10-06"); await line("contamination", "contamination", "roll"); await work("contamination-original", "contamination", "contamination");
  await replacement("contamination-replacement", "contamination", "contamination"); await work("contamination-replacement", "contamination", "contamination", { replacement: "contamination-replacement", origin: "contamination-original" }); await attempt("contamination-replacement", "contamination-replacement", 10, true);
  const completion = await new PostgresProductionCompletionProjection(client).readCompletion(org, brandedId<"OrderLineId">("contamination"));
  // This characterizes the BASE defect without baking it into report eligibility;
  // after P0 repairs the owner, the same report must still retain the original.
  assert.ok(completion.state === "complete" || completion.state === "in_progress");
  if (completion.state === "complete") console.log("BASE disagreement reproduced: replacement output makes original Production completion complete while original work still requires attention. P0 owner repair required.");
  else assert.equal(completion.completedUnitCount, 0, "repaired original completion excludes replacement output");

  await order("rejected", "2026-10-07"); await line("rejected", "rejected", "roll"); await work("rejected", "rejected", "rejected"); await attempt("rejected", "rejected", 10, true);
  await db.query("INSERT INTO v2_production_output_dispositions(id,organization_id,production_work_id,production_attempt_id,rejected_quantity,reason,created_principal_kind,created_principal_subject) VALUES('rejected','org-a','rejected','rejected',2,'Damaged','staff','staff-a')");
  for (let index = 0; index < 3; index++) {
    await db.query("INSERT INTO v2_production_runs(id,organization_id,station_key,created_principal_kind,created_principal_subject,state,cancelled_at) VALUES($1,'org-a','roll','staff','staff-a',$2,$3)", [`run-${index}`, index === 2 ? "cancelled" : "draft", index === 2 ? new Date() : null]);
    await db.query("INSERT INTO v2_production_run_allocations(id,organization_id,production_run_id,production_work_id,allocated_quantity,artwork_assignment_id,artwork_file_id,artwork_identity_fingerprint,position,released_at) VALUES($1,'org-a',$2,'mixed-roll',10,'art-mixed-roll','file-mixed-roll',$3,0,now())", [`allocation-${index}`, `run-${index}`, `sha256:${"a".repeat(64)}`]);
  }

  const before = await db.query("SELECT jsonb_agg(to_jsonb(w) ORDER BY id) snapshot FROM v2_production_works w");
  queries.length = 0;
  const full = await read({ mode: "print" });
  assert.deepEqual(full.summary, summarizeProductionDailyReport(full.rows, calendar));
  assert.equal(full.summary.totalActive, 11); assert.equal(full.summary.distinctOrders, 9); assert.equal(full.summary.activeAttempts, 2);
  assert.deepEqual([full.summary.overdue, full.summary.dueToday, full.summary.dueTomorrow, full.summary.noDue], [2, 1, 1, 1]);
  assert.deepEqual([full.summary.roll, full.summary.flatbed, full.summary.unknownDestination], [6, 4, 1]);
  assert.deepEqual(full.coverage, { truncated: false, countsComplete: true, candidateLimit: productionDailyReportCandidateLimit, blockedWorkCount: 0 });
  assert.deepEqual(full.blockedWork, []);
  const ids = full.rows.map(row => row.productionWorkId);
  assert.equal(new Set(ids).size, ids.length); assert.equal(ids.filter(id => id === "mixed-roll").length, 1, "Combined Run allocations do not duplicate work");
  for (const excluded of ["completed", "cancelled", "archived", "quantity-complete", "foreign", "unpaid-predecessor", "unpaid-successor", "replacement-original", "replacement-cancelled", "contamination-replacement"]) assert.ok(!ids.includes(excluded), excluded);
  const row = (id: string) => full.rows.find(item => item.productionWorkId === id)!;
  assert.equal(row("mixed-roll").destination, "roll"); assert.equal(row("mixed-flat").destination, "flatbed"); assert.equal(row("mixed-roll").orderId, row("mixed-flat").orderId);
  assert.equal(row("active-zero").state, "active"); assert.equal(row("active-zero").remainingGoodQuantity, 0);
  assert.equal(row("active-zero").destination, "roll", "active execution's immutable Production station outranks a changed route plan");
  assert.equal(row("held-zero").state, "held"); assert.equal(row("held-zero").remainingGoodQuantity, 0);
  assert.equal(row("rework-predecessor").state, "rework_requested"); assert.equal(row("rework-successor").destination, "roll", "cycle snapshot outranks the mutable flatbed route");
  assert.equal(row("replacement-active").destination, "flatbed", "replacement falls back to its own original attempt station");
  assert.equal(row("undated").destination, "unknown"); assert.equal(row("undated").dueCategory, "undated"); assert.equal(ids.at(-1), "undated");
  assert.equal(row("undated").customerName, null, "cross-tenant customer reference never exposes foreign text");
  assert.equal(row("rejected").remainingGoodQuantity, 2, "canonical usable output subtracts rejected goods");
  assert.equal(row("mixed-roll").jobLabel, null, "base has no Job Label column; notes/TEMP never supply it"); assert.equal(row("mixed-roll").purchaseOrderNumber, "PO-42");
  assert.deepEqual([row("mixed-roll").requestedFulfillment, row("active-zero").requestedFulfillment, row("held-zero").requestedFulfillment, row("undated").requestedFulfillment], ["shipping", "pickup", "local_delivery", "not_recorded"]);
  assert.ok(queries.every(sql => /^(BEGIN|COMMIT|SHOW|\s*SELECT)/i.test(sql) && !/\bFOR\s+(UPDATE|SHARE)\b/i.test(sql)), "snapshot, canonical reads and injected projections execute no DML or locks");
  assert.equal(queries.filter(sql => sql.includes("active.good_quantity active_good_quantity")).length, 1, "the full print uses one bounded canonical fact read, not per-work histories");
  assert.ok(!queries.some(sql => /SELECT \* FROM v2_production_(attempts|work_events|output_dispositions)/i.test(sql)), "report responses never load complete histories");
  assert.equal(queries[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); assert.equal(queries.at(-1), "COMMIT");
  assert.deepEqual((await db.query("SELECT jsonb_agg(to_jsonb(w) ORDER BY id) snapshot FROM v2_production_works w")).rows, before.rows);
  const owner = new PostgresProductionTransaction(client);
  for (const item of full.rows) {
    const canonical = (await owner.readWork(org, brandedId<"ProductionWorkId">(item.productionWorkId)))!;
    assert.equal(item.state, canonical.state); assert.equal(item.remainingGoodQuantity, canonical.remainingGoodQuantity);
    assert.equal(item.orderedQuantity, canonical.work.orderedQuantity); assert.equal(item.activeAttemptId, canonical.activeAttempt?.productionAttemptId ?? null);
  }
  const completeFacts = await owner.readDailyReportWorkFacts(org, [brandedId<"ProductionWorkId">("quantity-complete")]);
  assert.equal(completeFacts[0]!.unitQuantitySatisfied, true); assert.equal(completeFacts[0]!.state, "complete");
  assert.deepEqual(await owner.readDailyReportWorkFacts(org, [brandedId<"ProductionWorkId">("foreign")]), []);
  const beforeInvalid = queries.length;
  await assert.rejects(() => owner.readDailyReportWorkFacts(org, [brandedId<"ProductionWorkId">("mixed-roll"), brandedId<"ProductionWorkId">("mixed-roll")]), /1000 unique/);
  await assert.rejects(() => owner.readDailyReportWorkFacts(org, Array.from({ length: 1_001 }, (_, index) => brandedId<"ProductionWorkId">(`overflow-${index}`))), /1000 unique/);
  assert.equal(queries.length, beforeInvalid, "invalid/oversized fact reads never query the database");
  const pages: string[] = [];
  for (let page = 1; page <= Math.ceil(ids.length / 2); page++) {
    const result = await read({ page, pageSize: 2 }); assert.deepEqual(result.summary, full.summary); pages.push(...result.rows.map(item => item.productionWorkId));
  }
  assert.deepEqual(pages, ids, "all pages match the print population and deterministic due-date ordering");
  const emptyPage = await read({ page: 1_000_000 }); assert.equal(emptyPage.rows.length, 0); assert.deepEqual(emptyPage.summary, full.summary);
  const foreign = await adapter.readDailyReport(brandedId<"OrganizationId">("org-b"), normalizeProductionDailyReportRequest({ mode: "print" }));
  assert.deepEqual(foreign.rows.map(item => item.productionWorkId), ["foreign"]); assert.equal(foreign.rows[0]!.customerName, "FOREIGN TENANT CUSTOMER");

  const canonicalQueue = await new PostgresProductionTransaction(client).listStationQueue(org, "flatbed", { page: 1, pageSize: 100 });
  assert.ok(canonicalQueue.items.some(item => item.work.productionWorkId === "rework-successor"), "BASE queue assigns the successor to the mutable flatbed route");
  assert.equal(canonicalQueue.items.find(item => item.work.productionWorkId === "active-zero")!.activeAttempt!.stationKey, "roll", "BASE flatbed queue contains a work actively executing at roll");
  console.log("BASE active-station disagreement reproduced: queue uses flatbed plan while immutable active attempt/report remain roll.");
  const start = { id: brandedId<"ProductionAttemptId">("frozen-station-attempt"), organizationId: org, productionWorkId: brandedId<"ProductionWorkId">("rework-successor"), kind: "initial" as const, principalKind: "staff" as const, principalSubject: "staff-a" };
  await assert.rejects(() => owner.startAttempt({ ...start, stationKey: "flatbed" }), /different destination/, "the canonical attempt-start guard rejects the queue's mutable-route destination");
  assert.equal((await owner.startAttempt({ ...start, stationKey: "roll" })).stationKey, "roll", "actual owner SQL accepts the frozen cycle destination");
  const beforeStationConflict = await read({ mode: "print" });
  await db.query("UPDATE v2_production_rework_cycles SET destination_station_key='flatbed' WHERE id='original-cycle'");
  const stationConflict = await read({ mode: "print" });
  assert.deepEqual(stationConflict.rows.map(item => item.productionWorkId), beforeStationConflict.rows.filter(item => item.productionWorkId !== "rework-successor").map(item => item.productionWorkId));
  assert.deepEqual(stationConflict.blockedWork.map(item => [item.productionWorkId, item.reasonCode]), [["rework-successor", "conflicting_frozen_station"]]);
  assert.equal(stationConflict.coverage.countsComplete, false); assert.match(stationConflict.blockedWork[0]!.reason, /stations? disagree|station disagree/);
  assert.deepEqual(stationConflict.summary, summarizeProductionDailyReport(stationConflict.rows, calendar));
  await db.query("UPDATE v2_production_rework_cycles SET destination_station_key='roll' WHERE id='original-cycle'");
  console.log("BASE station disagreement reproduced: queue flatbed versus canonical attempt-start frozen cycle/report roll.");
  await db.exec("ALTER TABLE v2_sales_documents ADD COLUMN job_label text;");
  await db.query("UPDATE v2_sales_documents SET job_label='Canonical job label' WHERE id='mixed'");
  assert.equal((await read({ mode: "print" })).rows.find(item => item.productionWorkId === "mixed-roll")!.jobLabel, "Canonical job label");

  await order("completed-independent", "2026-10-08", { state: "completed", attention: "operationally_complete" });
  await line("completed-independent", "completed-independent", null); await work("completed-independent-original", "completed-independent", "completed-independent"); await attempt("completed-independent-original", "completed-independent-original", 10, true);
  await fulfilledOriginal("completed-independent", "completed-independent");
  await replacement("completed-independent-replacement", "completed-independent", "completed-independent");
  await work("completed-independent-replacement", "completed-independent", "completed-independent", { replacement: "completed-independent-replacement", origin: "completed-independent-original" });
  const independentAttempt = await owner.startAttempt({ id: brandedId<"ProductionAttemptId">("completed-independent-attempt"), organizationId: org, productionWorkId: brandedId<"ProductionWorkId">("completed-independent-replacement"), stationKey: "roll", kind: "initial", principalKind: "staff", principalSubject: "staff-a" });
  assert.equal(independentAttempt.stationKey, "roll", "canonical attempt start permits independent replacement work under a completed original Order");
  const independentReport = await read({ mode: "print" });
  assert.ok(independentReport.rows.some(item => item.productionWorkId === "completed-independent-replacement"));
  assert.ok(!independentReport.rows.some(item => item.productionWorkId === "completed-independent-original"));
  const independentQueue = await owner.listStationQueue(org, "roll", { page: 1, pageSize: 100 });
  assert.ok(!independentQueue.items.some(item => item.work.productionWorkId === "completed-independent-replacement"));
  assert.ok(independentQueue.items.some(item => item.work.productionWorkId === "unpaid-predecessor"), "BASE queue still counts the predecessor of the physically complete, fulfilled but unpaid original");
  console.log("BASE eligibility disagreement reproduced: completed original Order hides its active replacement from queue, but canonical attempt start and injected replacement scope allow report attention.");
  console.log("BASE population disagreement reproduced: queue includes fulfilled/physically complete unpaid original predecessor; report excludes it using the injected owner operational result.");

  await order("partially-complete", "2026-10-09"); await line("partial-done", "partially-complete", "roll"); await work("partial-done-predecessor", "partially-complete", "partial-done"); await attempt("partial-done-part", "partial-done-predecessor", 3, true);
  await event("partial-done-rework", "partial-done-predecessor", "rework_requested"); await cycle("partial-done-cycle", "partial-done-predecessor", "partially-complete", "partial-done", "roll");
  await work("partial-done-successor", "partially-complete", "partial-done", { cycle: "partial-done-cycle", predecessor: "partial-done-predecessor", quantity: 7 }); await attempt("partial-done-rest", "partial-done-successor", 7, true); await fulfilledOriginal("partially-complete", "partial-done");
  await line("partial-live", "partially-complete", "flatbed"); await work("partial-live", "partially-complete", "partial-live");
  assert.equal((await new PostgresProductionCompletionProjection(client).readCompletion(org, brandedId<"OrderLineId">("partial-done"))).state, "complete");
  assert.equal((await new PostgresProductionCompletionProjection(client).readCompletion(org, brandedId<"OrderLineId">("partial-live"))).state, "in_progress");
  await db.query("INSERT INTO report_owner_work_attention_fixture VALUES('org-a','partial-done-predecessor','operationally_complete')");
  assert.deepEqual((await read({ mode: "print" })).rows.filter(item => item.orderId === "partially-complete").map(item => item.productionWorkId), ["partial-live"], "exact work/line/unit decisions exclude a completed line's predecessor without hiding the active line of the same Order");

  const blockedRead = new PostgresProductionDailyReport(pool, { ...dependencies, readOperationalAttention: async () => [] });
  await assert.rejects(() => blockedRead.readDailyReport(org, normalizeProductionDailyReportRequest()), /eligibility is unavailable/);
  const ambiguousRead = new PostgresProductionDailyReport(pool, { ...dependencies, readOperationalAttention: async (connection, organizationId, scopes) => (await dependencies.readOperationalAttention(connection, organizationId, scopes)).map(decision => decision.productionWorkId === "mixed-roll" ? { ...decision, state: "blocked", reason: "Owner eligibility policy is unresolved for this work." } : decision) });
  const beforeAmbiguity = await read({ mode: "print" });
  const ownerAmbiguity = await ambiguousRead.readDailyReport(org, normalizeProductionDailyReportRequest({ mode: "print" }));
  assert.deepEqual(ownerAmbiguity.rows.map(item => item.productionWorkId), beforeAmbiguity.rows.filter(item => item.productionWorkId !== "mixed-roll").map(item => item.productionWorkId));
  assert.ok(ownerAmbiguity.rows.some(item => item.productionWorkId === "mixed-flat"), "one blocked work must not suppress valid work of the same Order");
  assert.deepEqual(ownerAmbiguity.blockedWork.map(item => [item.productionWorkId, item.reasonCode]), [["mixed-roll", "owner_policy_ambiguity"]]);
  assert.equal(ownerAmbiguity.coverage.blockedWorkCount, 1); assert.equal(ownerAmbiguity.coverage.countsComplete, false);
  assert.deepEqual(ownerAmbiguity.summary, summarizeProductionDailyReport(ownerAmbiguity.rows, calendar));
  const invalidReason = new PostgresProductionDailyReport(pool, { ...dependencies, readOperationalAttention: async (_client, _org, scopes) => scopes.map(scope => ({ ...scope, state: "blocked", reason: " " })) });
  await assert.rejects(() => invalidReason.readDailyReport(org, normalizeProductionDailyReportRequest()), /no explicit reason/);
  const unexpectedScope = new PostgresProductionDailyReport(pool, { ...dependencies, readOperationalAttention: async (_client, _org, scopes) => scopes.map(scope => ({ ...scope, requirementKey: "wrong-unit", state: "requires_attention" })) });
  await assert.rejects(() => unexpectedScope.readDailyReport(org, normalizeProductionDailyReportRequest()), /inconsistent scopes/);
  const duplicateDecision = new PostgresProductionDailyReport(pool, { ...dependencies, readOperationalAttention: async (connection, organizationId, scopes) => { const decisions = await dependencies.readOperationalAttention(connection, organizationId, scopes); return [...decisions, decisions[0]!]; } });
  await assert.rejects(() => duplicateDecision.readDailyReport(org, normalizeProductionDailyReportRequest()), /inconsistent scopes/);
  const missingDependency = new PostgresProductionDailyReport(pool, { ...dependencies, readOperationalAttention: undefined } as unknown as ProductionDailyReportReadDependencies);
  const beforeMissingDependency = connections;
  await assert.rejects(() => missingDependency.readDailyReport(org, normalizeProductionDailyReportRequest()), /owner reads are unavailable/);
  assert.equal(connections, beforeMissingDependency, "missing mandatory owner dependency fails before obtaining a database client");
  const writingRead = new PostgresProductionDailyReport(pool, { ...dependencies, readOperationalAttention: async connection => { await connection.query("UPDATE v2_sales_documents SET purchase_order_number='forbidden'"); return []; } });
  await assert.rejects(() => writingRead.readDailyReport(org, normalizeProductionDailyReportRequest()), error => (error as { code?: string }).code === "25006");
  assert.equal((await db.query("SELECT purchase_order_number FROM v2_sales_documents WHERE id='mixed'")).rows[0]!.purchase_order_number, "PO-42");

  const independentPopulation = await read({ mode: "print" });
  const independentIds = independentPopulation.rows.map(item => item.productionWorkId);
  for (const id of ["rework-successor", "replacement-active", "mixed-roll", "partial-live"]) assert.ok(independentIds.includes(id));
  const assertLineagePartial = async (blockedIds: string[]) => {
    const printed = await read({ mode: "print" });
    assert.deepEqual(printed.rows.map(item => item.productionWorkId), independentIds, "known lineage ambiguity retains every independently authoritative work");
    assert.deepEqual(printed.summary, summarizeProductionDailyReport(printed.rows, calendar));
    assert.deepEqual(printed.summary, independentPopulation.summary);
    assert.equal(printed.coverage.countsComplete, false); assert.equal(printed.coverage.truncated, false); assert.equal(printed.coverage.blockedWorkCount, blockedIds.length);
    assert.deepEqual(printed.blockedWork.map(item => item.productionWorkId), blockedIds);
    for (const item of printed.blockedWork) { assert.equal(item.reasonCode, "unresolved_replacement_rework_lineage"); assert.match(item.reason, /BDR4/); assert.equal("replacementObligationId" in item, false, "blocked DTO must not imply original scope through a null marker"); }
    for (const id of blockedIds) assert.ok(!suppliedScopes.at(-1)!.some(scope => scope.productionWorkId === id), "lost lineage is never passed to the owner as original");
    const visible: string[] = [];
    for (let page = 1; page <= Math.ceil(printed.rows.length / 3); page++) {
      const listed = await read({ page, pageSize: 3 }); assert.deepEqual(listed.summary, printed.summary); assert.deepEqual(listed.blockedWork, printed.blockedWork); assert.deepEqual(listed.coverage, printed.coverage);
      visible.push(...listed.rows.map(item => item.productionWorkId));
    }
    assert.deepEqual(visible, independentIds, "all list pages and print share the same resolved population and blocked-work disclosure");
  };
  await cycle("ambiguous-cycle", "replacement-active", "replacement", "replacement", "roll");
  await work("lost-replacement-lineage", "replacement", "replacement", { cycle: "ambiguous-cycle", predecessor: "replacement-active", quantity: 7 });
  await assertLineagePartial(["lost-replacement-lineage"]);
  await cycle("ambiguous-descendant-cycle", "lost-replacement-lineage", "replacement", "replacement", "roll");
  await work("lost-replacement-descendant", "replacement", "replacement", { cycle: "ambiguous-descendant-cycle", predecessor: "lost-replacement-lineage", quantity: 7 });
  await assertLineagePartial(["lost-replacement-descendant", "lost-replacement-lineage"]);
  await attempt("lost-lineage-complete", "lost-replacement-lineage", 7, true);
  await assertLineagePartial(["lost-replacement-descendant"]);
  await attempt("lost-descendant-complete", "lost-replacement-descendant", 7, true);
  await cycle("completed-ambiguous-cycle", "completed-independent-replacement", "completed-independent", "completed-independent", "roll");
  await work("completed-lost-lineage", "completed-independent", "completed-independent", { cycle: "completed-ambiguous-cycle", predecessor: "completed-independent-replacement", quantity: 7 });
  await assertLineagePartial(["completed-lost-lineage"]);
  await attempt("completed-lost-lineage-complete", "completed-lost-lineage", 7, true);

  await order("cap", "1999-01-01"); await line("cap", "cap", "roll");
  await db.exec(`INSERT INTO v2_artwork_assignments SELECT 'cap-art-'||n,'org-a','cap-file-'||n FROM generate_series(1,1001) n;
    INSERT INTO v2_production_works(id,organization_id,order_document_id,order_line_id,requirement_key,artwork_assignment_id,artwork_file_id,ordered_quantity,created_principal_kind,created_principal_subject)
    SELECT 'cap-work-'||n,'org-a','cap','cap','unit','cap-art-'||n,'cap-file-'||n,10,'staff','staff-a' FROM generate_series(1,1001) n;`);
  const capped = await read({ pageSize: 2 });
  assert.equal(capped.rows.length, 2); assert.equal(capped.summary.totalActive, 1_000); assert.equal(capped.coverage.truncated, true); assert.equal(capped.coverage.countsComplete, false);

  // Execute Production Run SQL in memory; this does not prove native lock contention.
  const runMigration = await migration("0279_v2_canonical_production_runs.sql");
  await db.exec(`ALTER TABLE v2_artwork_assignments ADD COLUMN identity_fingerprint text NOT NULL DEFAULT 'sha256:${"a".repeat(64)}';
    CREATE TABLE v2_artwork_files(id varchar,organization_id varchar,object_version text,PRIMARY KEY(id,organization_id));
    CREATE TABLE v2_order_line_material_requirements(organization_id varchar,order_line_id varchar,material_id varchar,quantity_unit varchar);`);
  await db.exec(runMigration.slice(runMigration.indexOf("CREATE TABLE v2_production_run_events"), runMigration.indexOf("\n\nINSERT INTO v2_permission_capabilities")));
  const runPool = { connect: async () => { connections++; return client; } } as Pick<Pool, "connect">;
  const runRunner = new PostgresProductionRunTransactionRunner(runPool as Pool);
  const runWork = async (id: string, destination: string | null = "roll", quantity = 10) => {
    await order(`order-${id}`, "2026-10-12"); await line(`line-${id}`, `order-${id}`, destination); await work(id, `order-${id}`, `line-${id}`, { quantity });
    await db.query("INSERT INTO v2_artwork_files VALUES($1,'org-a','version-a')", [`file-${id}`]);
  };
  const createRun = async (runId: string, workId: string, attemptId: string | null, state: "draft" | "active", station: "flatbed" | "roll" = "roll") => {
    await db.query("INSERT INTO v2_production_runs(id,organization_id,station_key,state,created_principal_kind,created_principal_subject,started_at) VALUES($1,'org-a',$2,$3,'staff','staff-a',CASE WHEN $3::varchar='active' THEN now() ELSE NULL END)", [runId, station, state]);
    await db.query(`INSERT INTO v2_production_run_allocations(id,organization_id,production_run_id,production_work_id,allocated_quantity,artwork_assignment_id,artwork_file_id,artwork_identity_fingerprint,artwork_object_version,position,production_attempt_id)
      VALUES($1,'org-a',$2,$3,5,$4,$5,$6,$7,0,$8)`, [`${runId}-allocation`, runId, workId, `art-${workId}`, `file-${workId}`, `sha256:${"a".repeat(64)}`, "version-a", attemptId]);
    return `${runId}-allocation`;
  };
  const runValues = (runId: string, allocationId: string, goodQuantityDelta = 1) => ({ organizationId: org, productionRunId: brandedId<"ProductionRunId">(runId), productionRunAllocationId: allocationId, goodQuantityDelta, wasteQuantityDelta: 0, principalKind: "staff" as const, principalSubject: "staff-a" });

  await runWork("run-reservation");
  const candidateId = brandedId<"ProductionWorkId">("run-reservation");
  const candidate = (await runRunner.transaction(tx => tx.lockCandidates(org, [candidateId])))[0]!;
  assert.equal(candidate.stationKey, "roll");
  assert.match(queries.slice().reverse().find(sql => sql.includes("FROM v2_production_works w") && sql.includes("FOR UPDATE OF w")) ?? "", /FOR UPDATE OF w$/);
  await assert.rejects(() => runRunner.transaction(tx => tx.create({ id: brandedId<"ProductionRunId">("reservation-run"), organizationId: org, stationKey: "roll", materialFingerprint: candidate.materialFingerprint, layoutMetadata: {}, members: [candidate], quantities: new Map([[candidateId, 6]]), principalKind: "staff", principalSubject: "staff-a" })), /exclusive membership.*native two-client/i);
  assert.deepEqual((await db.query("SELECT id FROM v2_production_runs WHERE id='reservation-run'")).rows, [], "Run creation remains fail-closed without native exclusivity proof");
  await db.query("INSERT INTO v2_production_runs(id,organization_id,station_key,state,created_principal_kind,created_principal_subject) VALUES('existing-reservation','org-a','roll','draft','staff','staff-a')");
  await db.query(`INSERT INTO v2_production_run_allocations(id,organization_id,production_run_id,production_work_id,allocated_quantity,artwork_assignment_id,artwork_file_id,artwork_identity_fingerprint,artwork_object_version,position)
    VALUES('existing-reservation-allocation','org-a','existing-reservation',$1,6,$2,$3,$4,$5,0)`, [candidateId, candidate.artworkAssignmentId, candidate.artworkFileId, candidate.artworkIdentityFingerprint, candidate.artworkObjectVersion]);
  await runRunner.transaction(async tx => {
    const candidates = await tx.lockCandidates(org, [candidateId]);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]!.reservedByOtherRuns, 6, "the adapter reads existing reservations after the Production work-row lock");
  });
  const ordinaryOwner = new PostgresProductionTransaction(client);
  assert.ok(await ordinaryOwner.lockWork(org, candidateId), "ordinary Production commands lock the same owner work row");
  assert.match(queries.at(-1)!, /FROM v2_production_works WHERE organization_id=\$1 AND id=\$2 FOR UPDATE$/);

  await runWork("run-unknown-destination", null);
  assert.deepEqual(await runRunner.transaction(tx => tx.lockCandidates(org, [brandedId<"ProductionWorkId">("run-unknown-destination")])), [], "an unknown destination is not silently assigned to Flatbed");
  await runWork("run-active-attempt"); await attempt("run-active-attempt-row", "run-active-attempt", 0, false, "roll");
  assert.deepEqual(await runRunner.transaction(tx => tx.lockCandidates(org, [brandedId<"ProductionWorkId">("run-active-attempt")])), [], "an active ordinary attempt cannot be reserved by a Run");

  const linkedWork = "run-linked-work", linkedAttempt = "run-linked-attempt";
  await runWork(linkedWork); await attempt(linkedAttempt, linkedWork, 0, false, "roll");
  const linkedAllocation = await createRun("linked-run", linkedWork, linkedAttempt, "active");
  const beforeLinkedOutput = Number((await db.query("SELECT good_quantity FROM v2_production_attempts WHERE id=$1", [linkedAttempt])).rows[0]!.good_quantity);
  const linkedContext = { organizationId: org, operationId: "ordinary-linked-output", businessRequest: { id: "ordinary-linked-output", payloadFingerprint: "ordinary-linked-output" }, principal: { kind: "staff" as const, organizationId: org, userId: "staff-a", authority: { membershipId: "membership-a", capabilities: ["production.work"] } } };
  const ordinaryService = new ProductionApplicationService({ transaction: async operation => operation({
    reserve: async (input: { businessRequestId: string }) => ({ kind: "new" as const, request: { id: input.businessRequestId, resultJson: null } }),
    lockAttempt: ordinaryOwner.lockAttempt.bind(ordinaryOwner), findWork: ordinaryOwner.findWork.bind(ordinaryOwner), readWork: ordinaryOwner.readWork.bind(ordinaryOwner), recordOutput: ordinaryOwner.recordOutput.bind(ordinaryOwner),
    attribute: async () => undefined, audit: async () => undefined, succeed: async () => undefined,
  } as never) });
  const blockedOrdinaryOutput = await ordinaryService.recordOutput(linkedContext, { businessRequestId: "ordinary-linked-output", productionAttemptId: brandedId<"ProductionAttemptId">(linkedAttempt), goodQuantityDelta: 1 });
  assert.equal(blockedOrdinaryOutput.ok, false, "ordinary Production cannot mutate an attempt owned by a Run");
  assert.equal(Number((await db.query("SELECT good_quantity FROM v2_production_attempts WHERE id=$1", [linkedAttempt])).rows[0]!.good_quantity), beforeLinkedOutput);
  await assert.rejects(() => ordinaryOwner.startAttempt({ id: brandedId<"ProductionAttemptId">("ordinary-reserved-start"), organizationId: org, productionWorkId: brandedId<"ProductionWorkId">("run-reservation"), stationKey: "roll", kind: "initial", principalKind: "staff", principalSubject: "staff-a" }), /Run/);
  assert.deepEqual((await db.query("SELECT id FROM v2_production_attempts WHERE id='ordinary-reserved-start'")).rows, []);
  const runOwner = new PostgresProductionRunTransaction(client);
  await assert.rejects(() => runOwner.output(runValues("linked-run", "not-a-member")), /not executable/);
  assert.equal(Number((await db.query("SELECT good_quantity FROM v2_production_run_allocations WHERE id=$1", [linkedAllocation])).rows[0]!.good_quantity), 0);

  const outputWork = "run-output-work", outputAttempt = "run-output-attempt";
  await runWork(outputWork); await attempt(outputAttempt, outputWork, 0, false, "roll");
  const outputAllocation = await createRun("valid-output-run", outputWork, outputAttempt, "active");
  const recordedRun = await runRunner.transaction(tx => tx.output(runValues("valid-output-run", outputAllocation)));
  assert.equal(recordedRun.allocations[0]!.goodQuantity, 1);
  assert.equal(Number((await db.query("SELECT good_quantity FROM v2_production_attempts WHERE id=$1", [outputAttempt])).rows[0]!.good_quantity), 1);
  assert.equal(recordedRun.events.at(-1)?.kind, "good_output");

  const heldWork = "run-held-work", heldAttempt = "run-held-attempt";
  await runWork(heldWork); await attempt(heldAttempt, heldWork, 0, false, "roll"); await event("run-work-hold", heldWork, "hold");
  const heldAllocation = await createRun("held-run", heldWork, heldAttempt, "active");
  const heldBefore = Number((await db.query("SELECT good_quantity FROM v2_production_attempts WHERE id=$1", [heldAttempt])).rows[0]!.good_quantity);
  await assert.rejects(() => runOwner.output(runValues("held-run", heldAllocation)), /held/i);
  assert.equal(Number((await db.query("SELECT good_quantity FROM v2_production_attempts WHERE id=$1", [heldAttempt])).rows[0]!.good_quantity), heldBefore);

  const movedWork = "run-moved-work", movedAttempt = "run-moved-attempt";
  await runWork(movedWork); await attempt(movedAttempt, movedWork, 0, false, "roll");
  const movedAllocation = await createRun("moved-run", movedWork, movedAttempt, "active");
  await db.query("UPDATE v2_route_instance_steps SET production_destination_station_key='flatbed' WHERE id=$1", [`step-line-${movedWork}`]);
  await assert.rejects(() => runOwner.output(runValues("moved-run", movedAllocation)), /destination/i, "Run execution preserves its frozen Production station when the current destination changes");

  const wrongAttemptWork = "run-wrong-attempt-work", wrongAttempt = "run-wrong-attempt";
  await runWork(wrongAttemptWork); await runWork("run-attempt-owner"); await attempt(wrongAttempt, "run-attempt-owner", 0, false, "roll");
  const wrongAttemptAllocation = await createRun("wrong-attempt-run", wrongAttemptWork, wrongAttempt, "active");
  await assert.rejects(() => runOwner.output(runValues("wrong-attempt-run", wrongAttemptAllocation)), /attempt.*work|work.*attempt/i);
  assert.equal(Number((await db.query("SELECT good_quantity FROM v2_production_attempts WHERE id=$1", [wrongAttempt])).rows[0]!.good_quantity), 0, "a run allocation cannot execute another work item's attempt");
  assert.equal(connections, releases, "every committed and rolled-back read releases its scoped client");
  console.log("productionDailyReport.postgres: report semantics, executable Run lock SQL, fail-closed creation, existing output/hold/destination/exact-attempt regressions PASS");
} finally { await db.close(); }
