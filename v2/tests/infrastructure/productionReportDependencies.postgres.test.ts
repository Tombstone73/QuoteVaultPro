import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Pool, PoolClient } from "pg";
import { PostgresProductionReportFulfillmentRead } from "../../infrastructure/fulfillment/productionReportFulfillmentRead.js";
import { createProductionReportDependencies, readProductionReportOperationalAttention } from "../../infrastructure/production/productionReportDependencies.js";
import { PostgresProductionCompletionProjection } from "../../infrastructure/production/postgresProductionCompletionProjection.js";
import { PostgresProductionDailyReport } from "../../infrastructure/production/postgresProductionDailyReport.js";
import { summarizeProductionDailyReport } from "../../src/modules/production/productionDailyReport.js";
import type { ProductionDailyReportScope } from "../../src/modules/production/productionDailyReport.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

// Actual owner projections and canonical status triggers, embedded PostgreSQL
// only. No operational fixture implementation is injected into production.
const db = new PGlite();
const source = (path: string) => readFile(new URL(`../../../${path}`, import.meta.url), "utf8");
const migration = (name: string) => source(`server/db/migrations_v2/${name}`);
const table = (ddl: string, name: string) => { const match = ddl.match(new RegExp(`CREATE TABLE ${name} \\([\\s\\S]*?\\n\\);`)); assert.ok(match, name); return match[0]; };
const queries: string[] = [];
let releases = 0;
const client = { query: async (sql: string, values?: unknown[]) => { queries.push(sql); const result = await db.query(sql, values); return { ...result, rowCount: result.affectedRows ?? result.rows.length }; }, release: () => { releases++; } } as unknown as PoolClient;
const org = brandedId<"OrganizationId">("org-a");
const facade = new PostgresProductionReportFulfillmentRead(client);
const read = (scopes: readonly ProductionDailyReportScope[]) => readProductionReportOperationalAttention(client, org, scopes);
const scope = (id: string, orderId = id, lineId = id, replacementId?: string): ProductionDailyReportScope => ({ productionWorkId: id, orderId, orderLineId: lineId, requirementKey: "unit", ...(replacementId ? { replacementObligationId: replacementId } : {}) });
try {
  await db.exec(`
    CREATE TABLE organizations(id varchar PRIMARY KEY);
    CREATE TABLE users(id varchar PRIMARY KEY);
    CREATE TABLE customers(id varchar PRIMARY KEY,organization_id varchar,display_name text,company_name text,UNIQUE(id,organization_id));
    CREATE TABLE customer_contacts(id varchar PRIMARY KEY,organization_id varchar,UNIQUE(id,organization_id));
    CREATE TABLE v2_sales_documents(id varchar PRIMARY KEY,organization_id varchar,document_kind text,display_number text,customer_id varchar,requested_due_date date,purchase_order_number text,UNIQUE(id,organization_id));
    CREATE TABLE v2_sales_order_details(document_id varchar,organization_id varchar,commercial_state text,archived_at timestamptz,requested_fulfillment_method text,UNIQUE(document_id,organization_id));
    CREATE TABLE v2_sales_document_lines(id varchar PRIMARY KEY,organization_id varchar,document_id varchar,quantity integer,description text,UNIQUE(id,organization_id,document_id));
    CREATE TABLE v2_sales_line_production_requirements(organization_id varchar,order_line_id varchar,requirement_key varchar,PRIMARY KEY(organization_id,order_line_id,requirement_key));
    CREATE TABLE v2_artwork_assignments(id varchar PRIMARY KEY,organization_id varchar,artwork_file_id varchar,UNIQUE(id,organization_id),UNIQUE(id,organization_id,artwork_file_id));
    CREATE TABLE v2_prepress_units(id varchar PRIMARY KEY,organization_id varchar,UNIQUE(id,organization_id));
    CREATE TABLE v2_sales_line_workflow_exceptions(organization_id varchar,order_line_id varchar,production_destination text,PRIMARY KEY(organization_id,order_line_id));
    CREATE TABLE v2_route_instances(id varchar PRIMARY KEY,organization_id varchar,order_document_id varchar,order_line_id varchar,current_step_id varchar);
    CREATE TABLE v2_route_instance_steps(id varchar PRIMARY KEY,organization_id varchar,route_instance_id varchar,step_kind text,production_destination_station_key text);
    CREATE TABLE v2_fulfillment_shipments(id varchar PRIMARY KEY,organization_id varchar,UNIQUE(id,organization_id));
    CREATE TABLE v2_billing_invoices(id varchar PRIMARY KEY,organization_id varchar,order_document_id varchar,total_cents integer,invoice_state text);
    INSERT INTO organizations VALUES('org-a'),('org-b');
  `);
  const productionDdl = await migration("0204_v2_production_domain_foundation.sql");
  await db.exec(productionDdl.slice(productionDdl.indexOf("CREATE TABLE v2_production_works"), productionDdl.indexOf("-- Exact evidence")));
  const cyclesDdl = await migration("0280_v2_production_rework_successor_cycles.sql");
  await db.exec(table(cyclesDdl, "v2_production_rework_cycles"));
  await db.exec(cyclesDdl.slice(cyclesDdl.indexOf("ALTER TABLE v2_production_works ADD COLUMN rework_cycle_id"), cyclesDdl.indexOf("-- A rework unit")));
  await db.exec(await migration("0281_v2_rework_cycle_destination_snapshot.sql"));
  await db.exec(table(await migration("0276_v2_production_exception_evidence.sql"), "v2_production_work_events"));
  const outputDdl = await migration("0282_v2_production_output_rejections.sql");
  await db.exec(table(outputDdl, "v2_production_output_dispositions"));
  await db.exec(outputDdl.slice(outputDdl.indexOf("CREATE OR REPLACE FUNCTION v2_usable_production_good_quantity"), outputDdl.indexOf("CREATE OR REPLACE FUNCTION v2_production_output_disposition_validate")));
  const fulfillmentDdl = await migration("0205_v2_fulfillment_domain_foundation.sql");
  await db.exec(fulfillmentDdl.slice(fulfillmentDdl.indexOf("CREATE TABLE v2_fulfillment_handoffs"), fulfillmentDdl.indexOf("INSERT INTO v2_permission_capabilities")));
  await db.exec("CREATE UNIQUE INDEX handoff_id_org_for_replacement_source ON v2_fulfillment_handoffs(id,organization_id)");
  const replacementDdl = await migration("0283_v2_replacement_obligations_shipping_economics.sql");
  await db.exec(replacementDdl.slice(replacementDdl.indexOf("CREATE TABLE v2_order_replacement_obligations"), replacementDdl.indexOf("-- Shipping cost")));
  const executionDdl = await migration("0284_v2_replacement_obligation_execution.sql");
  await db.exec(executionDdl.slice(executionDdl.indexOf("DROP INDEX v2_production_works_replacement_obligation_uidx"), executionDdl.indexOf("-- A prepared physical container")));

  const line = async (id: string, orderId = id, tenant = "org-a", withRequirement = true) => {
    await db.query("INSERT INTO v2_sales_documents(id,organization_id,document_kind) VALUES($1,$2,'order') ON CONFLICT DO NOTHING", [orderId, tenant]);
    await db.query("INSERT INTO v2_sales_order_details(document_id,organization_id,commercial_state) VALUES($1,$2,'open') ON CONFLICT DO NOTHING", [orderId, tenant]);
    await db.query("INSERT INTO v2_sales_document_lines(id,organization_id,document_id,quantity) VALUES($1,$2,$3,10)", [id, tenant, orderId]);
    if (withRequirement) await db.query("INSERT INTO v2_sales_line_production_requirements VALUES($1,$2,'unit')", [tenant, id]);
  };
  const work = async (id: string, orderId = id, lineId = id, options: { tenant?: string; replacement?: string; origin?: string; predecessor?: string; cycle?: string; quantity?: number; requirementKey?: string } = {}) => {
    const tenant = options.tenant ?? "org-a";
    await db.query("INSERT INTO v2_artwork_assignments VALUES($1,$2,$3)", [`art-${id}`, tenant, `file-${id}`]);
    await db.query(`INSERT INTO v2_production_works(id,organization_id,order_document_id,order_line_id,requirement_key,artwork_assignment_id,artwork_file_id,ordered_quantity,created_principal_kind,created_principal_subject,replacement_obligation_id,replacement_origin_production_work_id,predecessor_production_work_id,rework_cycle_id)
      VALUES($1,$2,$3,$4,$12,$5,$6,$7,'staff','staff-a',$8,$9,$10,$11)`, [id, tenant, orderId, lineId, `art-${id}`, `file-${id}`, options.quantity ?? 10, options.replacement ?? null, options.origin ?? null, options.predecessor ?? null, options.cycle ?? null, options.requirementKey ?? "unit"]);
  };
  const output = (id: string, workId: string, good: number, tenant = "org-a") => db.query(`INSERT INTO v2_production_attempts(id,organization_id,production_work_id,sequence,attempt_kind,station_key,good_quantity,started_principal_kind,started_principal_subject,completed_at,completed_principal_kind,completed_principal_subject)
    VALUES($1,$2,$3,1,'initial','roll',$4,'staff','staff-a',now(),'staff','staff-a')`, [id, tenant, workId, good]);
  const handoff = async (id: string, orderId: string, lineId: string, quantity: number, replacementId?: string, tenant = "org-a") => {
    await db.query("INSERT INTO v2_fulfillment_handoffs(id,organization_id,order_document_id,handoff_method,completed_principal_kind,completed_principal_subject,replacement_obligation_id) VALUES($1,$2,$3,'pickup','staff','staff-a',$4)", [id, tenant, orderId, replacementId ?? null]);
    await db.query("INSERT INTO v2_fulfillment_handoff_lines(id,organization_id,handoff_id,order_document_id,order_line_id,quantity) VALUES($1,$2,$3,$4,$5,$6)", [`line-${id}`, tenant, id, orderId, lineId, quantity]);
  };
  const replacement = (id: string, orderId: string, lineId: string, status = "open", tenant = "org-a") => db.query("INSERT INTO v2_order_replacement_obligations(id,organization_id,order_document_id,order_line_id,replacement_quantity,reason,responsibility,billing_treatment,status,created_principal_kind,created_principal_subject) VALUES($1,$5,$2,$3,10,'damage','titan','billable',$4,'staff','staff-a')", [id, orderId, lineId, status, tenant]);
  const cycle = (id: string, predecessor: string, orderId: string, lineId: string, tenant = "org-a") => db.query("INSERT INTO v2_production_rework_cycles(id,organization_id,predecessor_production_work_id,order_document_id,order_line_id,requirement_key,prior_artwork_assignment_id,remaining_required_quantity,reason,created_principal_kind,created_principal_subject) VALUES($1,$6,$2,$3,$4,'unit',$5,7,'rework','staff','staff-a')", [id, predecessor, orderId, lineId, `art-${predecessor}`, tenant]);

  await line("unpaid"); await work("unpaid"); await output("unpaid", "unpaid", 10); await handoff("unpaid", "unpaid", "unpaid", 10);
  await db.query("INSERT INTO v2_billing_invoices VALUES('unpaid-invoice','org-a','unpaid',1000,'issued')");
  await line("live"); await work("live");
  await line("partial"); await work("partial"); await output("partial", "partial", 10); await handoff("partial", "partial", "partial", 5);
  await line("rework"); await work("rework-root", "rework", "rework"); await output("rework-root", "rework-root", 3); await cycle("rework-cycle", "rework-root", "rework", "rework"); await work("rework-child", "rework", "rework", { predecessor: "rework-root", cycle: "rework-cycle", quantity: 7 }); await output("rework-child", "rework-child", 7); await handoff("rework", "rework", "rework", 10);
  await line("duplicate"); await work("duplicate-a", "duplicate", "duplicate"); await work("duplicate-b", "duplicate", "duplicate");
  await line("foreign", "foreign-order", "org-b"); await work("foreign", "foreign-order", "foreign", { tenant: "org-b" }); await output("foreign", "foreign", 10, "org-b"); await handoff("foreign", "foreign-order", "foreign", 10, undefined, "org-b");

  // Trigger-generated replacement facts, independent of the original parent.
  await line("replacements"); await work("replacement-origin", "replacements", "replacements"); await output("replacement-origin", "replacement-origin", 10); await handoff("original", "replacements", "replacements", 10);
  await replacement("rep-open", "replacements", "replacements"); await work("rep-open-work", "replacements", "replacements", { replacement: "rep-open", origin: "replacement-origin" });
  await replacement("rep-produced", "replacements", "replacements"); await work("rep-produced-work", "replacements", "replacements", { replacement: "rep-produced", origin: "replacement-origin" }); await output("rep-produced", "rep-produced-work", 10);
  await replacement("rep-fulfilled", "replacements", "replacements"); await work("rep-fulfilled-work", "replacements", "replacements", { replacement: "rep-fulfilled", origin: "replacement-origin" }); await output("rep-fulfilled", "rep-fulfilled-work", 10); await handoff("rep-fulfilled", "replacements", "replacements", 10, "rep-fulfilled");
  await replacement("rep-cancelled", "replacements", "replacements", "cancelled"); await work("rep-cancelled-work", "replacements", "replacements", { replacement: "rep-cancelled", origin: "replacement-origin" });
  await replacement("rep-duplicate", "replacements", "replacements"); await work("rep-duplicate-a", "replacements", "replacements", { replacement: "rep-duplicate", origin: "replacement-origin" }); await work("rep-duplicate-b", "replacements", "replacements", { replacement: "rep-duplicate", origin: "replacement-origin" });
  await cycle("lost-cycle", "rep-open-work", "replacements", "replacements"); await work("lost-marker", "replacements", "replacements", { predecessor: "rep-open-work", cycle: "lost-cycle", quantity: 7 });
  await db.query("UPDATE v2_sales_order_details SET commercial_state='completed' WHERE document_id='replacements'");

  // Isolated P2 controls: actual original rework 3+7/requested10/handoff10,
  // followed by a terminal Order and independent replacement obligations.
  const controlTenant = "org-controls", controlOrg = brandedId<"OrganizationId">(controlTenant);
  await db.query("INSERT INTO organizations VALUES($1)", [controlTenant]);
  await line("control-rework", "control-order", controlTenant);
  await work("control-root", "control-order", "control-rework", { tenant: controlTenant }); await output("control-root", "control-root", 3, controlTenant);
  await cycle("control-cycle", "control-root", "control-order", "control-rework", controlTenant);
  await work("control-child", "control-order", "control-rework", { tenant: controlTenant, predecessor: "control-root", cycle: "control-cycle", quantity: 7 }); await output("control-child", "control-child", 7, controlTenant);
  await handoff("control-original", "control-order", "control-rework", 10, undefined, controlTenant);
  await replacement("control-active", "control-order", "control-rework", "open", controlTenant);
  await work("control-active-work", "control-order", "control-rework", { tenant: controlTenant, replacement: "control-active", origin: "control-child" });
  await replacement("control-cancelled", "control-order", "control-rework", "cancelled", controlTenant);
  for (const id of ["control-cancelled-a", "control-cancelled-b"]) await work(id, "control-order", "control-rework", { tenant: controlTenant, replacement: "control-cancelled", origin: "control-child" });
  await replacement("control-fulfilled", "control-order", "control-rework", "open", controlTenant);
  await work("control-fulfilled-source", "control-order", "control-rework", { tenant: controlTenant, replacement: "control-fulfilled", origin: "control-child" }); await output("control-fulfilled-source", "control-fulfilled-source", 10, controlTenant);
  await handoff("control-fulfilled", "control-order", "control-rework", 10, "control-fulfilled", controlTenant);
  // Legacy duplicate authorities inserted after the canonical fulfilled fact;
  // the read must not overturn that fact by recomputing production quantities.
  for (const id of ["control-fulfilled-a", "control-fulfilled-b"]) await work(id, "control-order", "control-rework", { tenant: controlTenant, replacement: "control-fulfilled", origin: "control-child" });

  queries.length = 0;
  await db.exec("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const calendar = { asOf: "2026-10-01T08:30:00.000Z", timeZone: "UTC", todayDate: "2026-10-01", tomorrowDate: "2026-10-02" };
  const dependencies = createProductionReportDependencies(async (connection, organizationId) => { assert.equal(connection, client); assert.equal(organizationId, org); return calendar; });
  assert.equal(await dependencies.readReportingCalendar(client, org), calendar);
  assert.equal(dependencies.readOperationalAttention, readProductionReportOperationalAttention);
  assert.throws(() => createProductionReportDependencies(undefined as never), /calendar dependency/);
  const originalScopes = [scope("unpaid"), scope("live"), scope("partial"), scope("rework-root", "rework", "rework"), scope("rework-child", "rework", "rework")];
  const original = await dependencies.readOperationalAttention(client, org, originalScopes);
  assert.deepEqual(original.map(item => item.state), ["operationally_complete", "requires_attention", "requires_attention", "operationally_complete", "operationally_complete"]);
  assert.deepEqual(original.map(({ state: _state, ...identity }) => identity), originalScopes);
  const exactOriginal = await facade.readOriginalCompletion(org, { orderId: "unpaid", orderLineId: "unpaid" }); assert.equal(exactOriginal.state, "complete");
  assert.equal((await facade.readOriginalCompletion(org, { orderId: "wrong-order", orderLineId: "unpaid" })).state, "blocked");
  assert.equal((await facade.readOriginalCompletion(org, { orderId: "foreign-order", orderLineId: "foreign" })).state, "blocked");
  const replacementScopes = ["open", "produced", "fulfilled", "cancelled"].map(status => scope(`rep-${status}-work`, "replacements", "replacements", `rep-${status}`));
  assert.deepEqual((await read(replacementScopes)).map(item => item.state), ["requires_attention", "requires_attention", "operationally_complete", "operationally_complete"]);
  assert.deepEqual(await facade.readReplacementState(org, { orderId: "replacements", orderLineId: "replacements", replacementObligationId: "rep-produced" }), { state: "unresolved", canonicalStatus: "production_complete" });
  assert.deepEqual(await facade.readReplacementState(org, { orderId: "replacements", orderLineId: "replacements", replacementObligationId: "rep-fulfilled" }), { state: "fulfilled", canonicalStatus: "fulfilled" });
  for (const invalid of [{ orderId: "wrong", orderLineId: "replacements", replacementObligationId: "rep-open" }, { orderId: "replacements", orderLineId: "wrong", replacementObligationId: "rep-open" }, { orderId: "replacements", orderLineId: "replacements", replacementObligationId: "absent" }]) assert.equal((await facade.readReplacementState(org, invalid)).state, "blocked");
  assert.equal((await facade.readReplacementState(brandedId<"OrganizationId">("org-b"), { orderId: "replacements", orderLineId: "replacements", replacementObligationId: "rep-open" })).state, "blocked");
  const mixed = await read([scope("duplicate-a", "duplicate", "duplicate"), scope("lost-marker", "replacements", "replacements"), scope("rep-duplicate-a", "replacements", "replacements", "rep-duplicate"), scope("live"), scope("unpaid")]);
  assert.deepEqual(mixed.map(item => item.state), ["blocked", "blocked", "blocked", "requires_attention", "operationally_complete"]);
  for (const item of mixed.slice(0, 3)) if (item.state === "blocked") assert.match(item.reason, /BDR4/);
  const invalidWork = await read([scope("absent"), { ...scope("live"), orderId: "wrong" }, { ...scope("rep-open-work", "replacements", "replacements"), replacementObligationId: undefined }]);
  assert.ok(invalidWork.every(item => item.state === "blocked"));
  const closedOriginal = await read([scope("replacement-origin", "replacements", "replacements")]); assert.equal(closedOriginal[0]!.state, "operationally_complete", "resolved original work consumes the authoritative completed-parent exclusion, not the open-only Fulfillment projection");
  const beforeInvalid = queries.length;
  await assert.rejects(() => read([scope("live"), scope("live")]), /distinct work identities/);
  await assert.rejects(() => read(Array.from({ length: 1001 }, (_, index) => scope(`extra-${index}`))), /1000/);
  assert.equal(queries.length, beforeInvalid);
  assert.ok(queries.every(sql => /^\s*(SELECT|WITH)\b/i.test(sql) && !/\bFOR\s+(UPDATE|SHARE)\b/i.test(sql)), "composition/facade open no pool/transaction and perform only unlocked SELECTs");
  assert.ok(!queries.some(sql => /\bv2_billing_|\bpayments\b|\binvoices\b/i.test(sql)), "operational attention never reads financial settlement");
  await db.exec("COMMIT");

  const pool = { connect: async () => client } as Pick<Pool, "connect">;
  const report = new PostgresProductionDailyReport(pool, dependencies);
  const printed = await report.readDailyReport(org, { page: 1, pageSize: 25, mode: "print" });
  assert.deepEqual(printed.summary, summarizeProductionDailyReport(printed.rows, calendar));
  assert.deepEqual(printed.rows.map(item => item.productionWorkId), ["live", "rep-open-work"], "actual dependency composition retains authoritative work and excludes physically complete originals/cancelled obligations");
  for (const id of ["duplicate-a", "duplicate-b", "rep-duplicate-a", "rep-duplicate-b", "lost-marker"]) assert.ok(printed.blockedWork.some(item => item.productionWorkId === id));
  assert.equal(printed.coverage.countsComplete, false); assert.equal(printed.coverage.blockedWorkCount, 5);
  const pageIds: string[] = [];
  for (let page = 1; page <= printed.rows.length; page++) {
    const listed = await report.readDailyReport(org, { page, pageSize: 1, mode: "page" });
    assert.deepEqual(listed.summary, printed.summary); assert.deepEqual(listed.blockedWork, printed.blockedWork); pageIds.push(...listed.rows.map(item => item.productionWorkId));
  }
  assert.deepEqual(pageIds, printed.rows.map(item => item.productionWorkId)); assert.equal(releases, 3);

  const controlFacade = new PostgresProductionReportFulfillmentRead(client);
  const controlReport = new PostgresProductionDailyReport(pool, createProductionReportDependencies(async (connection, organizationId) => { assert.equal(connection, client); assert.equal(organizationId, controlOrg); return calendar; }));
  const openControl = await controlReport.readDailyReport(controlOrg, { page: 1, pageSize: 25, mode: "print" });
  assert.deepEqual(openControl.rows.map(item => item.productionWorkId), ["control-active-work"]);
  assert.deepEqual(openControl.blockedWork, [], "canonical fulfilled/cancelled status must precede duplicate quantity-authority ambiguity");
  assert.equal(openControl.coverage.countsComplete, true); assert.equal(openControl.coverage.blockedWorkCount, 0);
  assert.equal((await controlFacade.readReplacementState(controlOrg, { orderId: "control-order", orderLineId: "control-rework", replacementObligationId: "control-fulfilled" })).state, "fulfilled");
  await db.query("UPDATE v2_sales_order_details SET commercial_state='completed' WHERE organization_id=$1 AND document_id='control-order'", [controlOrg]);
  const completedControl = await controlReport.readDailyReport(controlOrg, { page: 1, pageSize: 25, mode: "print" });
  assert.deepEqual(completedControl.rows, openControl.rows, "completed original parent must not hide its independent active replacement");
  assert.deepEqual(completedControl.blockedWork, [], "completed original rework root must not become falsely blocked through the open-only Fulfillment projection");
  assert.deepEqual(completedControl.summary, openControl.summary); assert.deepEqual(completedControl.summary, summarizeProductionDailyReport(completedControl.rows, calendar));
  assert.equal(completedControl.coverage.countsComplete, true); assert.equal(completedControl.coverage.blockedWorkCount, 0);
  const completedPage = await controlReport.readDailyReport(controlOrg, { page: 1, pageSize: 1, mode: "page" });
  assert.deepEqual(completedPage.rows, completedControl.rows); assert.deepEqual(completedPage.summary, completedControl.summary); assert.deepEqual(completedPage.coverage, completedControl.coverage);
  const terminalScopes = [scope("control-root", "control-order", "control-rework"), ...["control-cancelled-a", "control-cancelled-b"].map(id => scope(id, "control-order", "control-rework", "control-cancelled")), ...["control-fulfilled-a", "control-fulfilled-b"].map(id => scope(id, "control-order", "control-rework", "control-fulfilled"))];
  assert.ok((await readProductionReportOperationalAttention(client, controlOrg, terminalScopes)).every(item => item.state === "operationally_complete"));
  assert.equal((await controlFacade.readOriginalCompletion(controlOrg, { orderId: "control-order", orderLineId: "control-rework" })).state, "blocked", "the terminal report exclusion must not fabricate Fulfillment quantities or change the existing owner projection");
  await cycle("control-lost-cycle", "control-active-work", "control-order", "control-rework", controlTenant);
  await work("control-lost-marker", "control-order", "control-rework", { tenant: controlTenant, predecessor: "control-active-work", cycle: "control-lost-cycle", quantity: 7 });
  const lostControl = await controlReport.readDailyReport(controlOrg, { page: 1, pageSize: 25, mode: "print" });
  assert.deepEqual(lostControl.rows, completedControl.rows); assert.deepEqual(lostControl.summary, completedControl.summary);
  assert.deepEqual(lostControl.blockedWork.map(item => [item.productionWorkId, item.reasonCode]), [["control-lost-marker", "unresolved_replacement_rework_lineage"]]);
  assert.equal(lostControl.coverage.countsComplete, false); assert.equal(lostControl.coverage.blockedWorkCount, 1);
  const lostPage = await controlReport.readDailyReport(controlOrg, { page: 1, pageSize: 1, mode: "page" });
  assert.deepEqual(lostPage.rows, lostControl.rows); assert.deepEqual(lostPage.summary, lostControl.summary); assert.deepEqual(lostPage.blockedWork, lostControl.blockedWork); assert.deepEqual(lostPage.coverage, lostControl.coverage);
  const directLost = await readProductionReportOperationalAttention(client, controlOrg, [scope("control-lost-marker", "control-order", "control-rework")]);
  assert.equal(directLost[0]!.state, "blocked", "completed parent must not classify lost replacement lineage as original");

  await line("multi-unit"); await db.query("INSERT INTO v2_sales_line_production_requirements VALUES('org-a','multi-unit','back')");
  await work("multi-root", "multi-unit", "multi-unit"); await output("multi-root", "multi-root", 3); await cycle("multi-cycle", "multi-root", "multi-unit", "multi-unit");
  await work("multi-child", "multi-unit", "multi-unit", { predecessor: "multi-root", cycle: "multi-cycle", quantity: 7 }); await output("multi-child", "multi-child", 7);
  await work("multi-back", "multi-unit", "multi-unit", { requirementKey: "back" });
  await db.exec("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const partialUnits = await read([scope("multi-root", "multi-unit", "multi-unit"), { ...scope("multi-back", "multi-unit", "multi-unit"), requirementKey: "back" }, scope("live")]);
  assert.deepEqual(partialUnits.map(item => item.state), ["blocked", "requires_attention", "requires_attention"]);
  if (partialUnits[0]!.state === "blocked") assert.match(partialUnits[0]!.reason, /requirement-specific owner completion evidence/);
  await db.exec("COMMIT");

  // Actual owner adapters must exclude replacement-only evidence from original
  // completion. This is an integration requirement, not a BASE characterization.
  await line("p0-production"); await work("p0-production-original", "p0-production", "p0-production"); await handoff("p0-prod-original-handoff", "p0-production", "p0-production", 10);
  await replacement("p0-production-rep", "p0-production", "p0-production"); await work("p0-production-rep-work", "p0-production", "p0-production", { replacement: "p0-production-rep", origin: "p0-production-original" }); await output("p0-production-rep", "p0-production-rep-work", 10);
  await line("p0-fulfillment"); await work("p0-fulfillment-original", "p0-fulfillment", "p0-fulfillment"); await output("p0-fulfillment-original", "p0-fulfillment-original", 10);
  await replacement("p0-fulfillment-rep", "p0-fulfillment", "p0-fulfillment"); await work("p0-fulfillment-rep-work", "p0-fulfillment", "p0-fulfillment", { replacement: "p0-fulfillment-rep", origin: "p0-fulfillment-original" }); await output("p0-fulfillment-rep", "p0-fulfillment-rep-work", 10); await handoff("p0-replacement-only", "p0-fulfillment", "p0-fulfillment", 10, "p0-fulfillment-rep");
  await db.exec("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const originalProduction = await new PostgresProductionCompletionProjection(client).readCompletion(org, brandedId<"OrderLineId">("p0-production"));
  const originalFulfillment = await facade.readOriginalCompletion(org, { orderId: "p0-fulfillment", orderLineId: "p0-fulfillment" });
  assert.equal(originalProduction.state, "in_progress");
  assert.equal(originalFulfillment.state, "incomplete");
  const integration = await read([scope("p0-production-original", "p0-production", "p0-production"), scope("p0-fulfillment-original", "p0-fulfillment", "p0-fulfillment")]);
  assert.deepEqual(integration.map(item => item.state), ["requires_attention", "requires_attention"]);
  await db.exec("COMMIT");
  const productionIsolated = originalProduction.state === "in_progress";
  const fulfillmentIsolated = originalFulfillment.state === "incomplete";
  console.log(JSON.stringify({ productionOriginalOnly: productionIsolated, fulfillmentOriginalOnly: fulfillmentIsolated, integrationReady: productionIsolated && fulfillmentIsolated }));
  console.log("productionReportDependencies: actual original owner projections, trigger-owned replacement states, exact identity/tenant isolation, scoped blockers, same-client readonly composition and P0 original-only acceptance PASS");
} finally { await db.close(); }
