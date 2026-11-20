import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/node-postgres";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as schema from "../../shared/schema";

// Disposable M5 fixture ONLY. No server/db import, dotenv, credential discovery,
// providers, workers, schema-registry changes or business-operation substitute.
// Run: node --import tsx scripts/qa/m5-browser-fixture.ts <command>
// Commands: bootstrap, seed, ids, inspect, check-before, check-after [commercial-hash],
//           fingerprint, check-replay <previous-effects-hash>, drop.
// Schema projection + explicit migration-only supplements, NOT a complete
// production migration-chain rehearsal. Mutating commands refuse other DBs.
export const fixtureUrl = "postgresql://postgres@127.0.0.1:55605/printershero_m5_browser_test";
export const fixtureDirectory = "C:/Users/dale9/AppData/Local/Temp/kilo/m5-browser-20261120-1735";
const id = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const fixtureIds = {
  organizationId: id(1), userId: id(2), customerId: id(3), orderId: id(4),
  line1Id: id(5), line2Id: id(6), jobId: id(7), materialId: id(8), reservationId: id(9),
  quoteId: id(10), invoiceId: id(11), printProductId: id(12), serviceProductId: id(13),
  flatbedStationId: id(14), fulfillmentStationId: id(15), initialPillId: id(16), fulfillmentPillId: id(17),
};
// Synthetic public fixture credential, never a copied/configured account secret.
export const fixtureLogin = { email: "m5-browser@example.invalid", password: "M5-Local-Only!2026" };
const f = fixtureIds;
const materialHistory = [{ materialId: f.materialId, materialName: "M5 historical five sheets", quantityUsed: 5, unitOfMeasure: "sheet" }];
const optionsHistory = { schemaVersion: 2, selected: { sides: { value: "single" }, coating: { value: "none" } } };
const pbv2History = { synthetic: true, pricing: { totalCents: 12500 }, units: { width: "in", height: "in" }, materialId: f.materialId };

function pool(database = "printershero_m5_browser_test") {
  assert.ok(["postgres", "printershero_m5_browser_test"].includes(database));
  return new pg.Pool({ host: '127.0.0.1', port: 55605, user: 'postgres', database, password: 'disposable-fixture-only', ssl: false, max: 3, connectionTimeoutMillis: 5000 });
}
async function verifyIdentity(client: pg.Pool | pg.PoolClient, database: string) {
  const { rows: [identity] } = await client.query(`SELECT current_database() AS database, host(inet_server_addr()) AS address,
    inet_server_port() AS port, current_setting('data_directory') AS directory`);
  assert.equal(identity.database, database);
  assert.equal(identity.address, "127.0.0.1");
  assert.equal(identity.port, 55605);
  assert.equal(identity.directory.replace(/\\/g, "/"), fixtureDirectory);
}
export async function bootstrap() {
  const admin = pool("postgres");
  try {
    await verifyIdentity(admin, "postgres");
    assert.equal((await admin.query("SELECT count(*)::int AS count FROM pg_database WHERE datname='printershero_m5_browser_test'")).rows[0].count, 0,
      "Refusing to reuse, reset or overwrite an existing database");
    await admin.query("CREATE DATABASE printershero_m5_browser_test");
  } finally { await admin.end(); }
  const connection = pool();
  try {
    await verifyIdentity(connection, "printershero_m5_browser_test");
    const ddl = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema));
    const client = await connection.connect();
    try {
      await client.query("BEGIN");
      for (const statement of [...ddl.filter(s => !s.startsWith("ALTER TABLE")), ...ddl.filter(s => s.startsWith("ALTER TABLE"))]) await client.query(statement);
      // Same documented migration-only behavior as setupLocalPostgres.ts.
      await client.query("CREATE UNIQUE INDEX IF NOT EXISTS global_variables_org_name_unique_idx ON public.global_variables (organization_id, name)");
      await client.query("ALTER TABLE public.stations ALTER COLUMN id SET DEFAULT gen_random_uuid()::text");
      await client.query("ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS station_id varchar");
      await client.query("CREATE UNIQUE INDEX IF NOT EXISTS production_jobs_org_line_item_station_unique ON public.production_jobs (organization_id, line_item_id, station_id) WHERE station_id IS NOT NULL");
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    return { database: "printershero_m5_browser_test", statements: ddl.length, supplements: 4, migrationChainRehearsed: false };
  } finally { await connection.end(); }
}

export async function seed() {
  const connection = pool();
  try {
    await verifyIdentity(connection, "printershero_m5_browser_test");
    const database = drizzle({ client: connection, schema });
    const passwordHash = await bcrypt.hash(fixtureLogin.password, 12);
    assert.equal(await bcrypt.compare(fixtureLogin.password, passwordHash), true);
    const startedAt = new Date(Date.now() - 120_000);
    await database.transaction(async tx => {
      await tx.insert(schema.organizations).values({ id: f.organizationId, name: "M5 Synthetic Browser Organization", slug: "m5-synthetic-browser",
        settings: { preferences: { proofing: { policy: "manual_requested_only" } } } });
      await tx.insert(schema.users).values({ id: f.userId, email: fixtureLogin.email, firstName: "M5", lastName: "Synthetic Operator",
        accountType: "INTERNAL_USER", role: "owner", isAdmin: true, mustSetPassword: false, lastActiveOrgId: f.organizationId });
      await tx.insert(schema.authIdentities).values({ userId: f.userId, provider: "password", passwordHash, passwordSetAt: new Date() });
      await tx.insert(schema.userOrganizations).values({ organizationId: f.organizationId, userId: f.userId, role: "owner" });
      await tx.insert(schema.organizationAiSettings).values({ orgId: f.organizationId, mode: "printershero_managed", isEnabled: true,
        assistantEnabled: true, productionAssistanceEnabled: true });
      await tx.insert(schema.customers).values({ id: f.customerId, organizationId: f.organizationId, companyName: "M5 Synthetic Signs Buyer",
        email: "m5-customer@example.invalid", creditLimit: "100000", creditLimitConfiguredAt: new Date() });
      await tx.insert(schema.products).values([
        { id: f.printProductId, organizationId: f.organizationId, name: "M5 Flatbed Signs", description: "Synthetic five signs", requiresProductionJob: true, requiresProofApproval: false },
        { id: f.serviceProductId, organizationId: f.organizationId, name: "M5 Setup Service", description: "Synthetic nonproduction fee", requiresProductionJob: false, requiresProofApproval: false },
      ]);
      await tx.insert(schema.materials).values({ id: f.materialId, organizationId: f.organizationId, name: "M5 Synthetic Sign Sheets", sku: "M5-SHEET-ONLY",
        type: "sheet", materialForm: "sheet", inventoryUnit: "sheet", consumptionUnit: "sheet", unitOfMeasure: "sheet",
        width: "24.00", height: "18.00", costPerUnit: "2.0000", stockQuantity: "100.000000" });
      await tx.insert(schema.stations).values([
        { id: f.flatbedStationId, organizationId: f.organizationId, key: "flatbed", name: "M5 Flatbed", active: true },
        { id: f.fulfillmentStationId, organizationId: f.organizationId, key: "fulfillment", name: "M5 Fulfillment", active: true },
      ]);
      await tx.insert(schema.productionStationSteps).values([
        { organizationId: f.organizationId, stationKey: "flatbed", key: "queued", label: "Queued", active: true,
          triggers: [{ type: "on_complete_route", config: { stationKey: "fulfillment", stepKey: "fulfillment" } }] },
        { organizationId: f.organizationId, stationKey: "fulfillment", key: "fulfillment", label: "Fulfillment", active: true, triggers: [] },
      ]);
      await tx.insert(schema.orderStatusPills).values([
        { id: f.initialPillId, organizationId: f.organizationId, key: "m5_in_production", name: "M5 In Production", stateScope: "open", category: "production", lifecycleMapping: "production", isActive: true },
        { id: f.fulfillmentPillId, organizationId: f.organizationId, key: "m5_fulfillment", name: "M5 Fulfillment", stateScope: "production_complete", category: "fulfillment",
          lifecycleMapping: "fulfillment", isActive: true, notificationTriggerEligible: true,
          // Scheduling only. Max delay + invalid-domain synthetic recipient;
          // nobody may start a delivery worker or dispatch this local outbox.
          notificationRules: { staff_email: { enabled: true, delaySeconds: 604800, template: "staff_status", recipients: "order_creator" },
            customer_email: { enabled: false, delaySeconds: 60, template: "order_update" }, customer_portal: { enabled: false, delaySeconds: 60, template: "order_update" } } },
      ]);
      await tx.insert(schema.workflowStatusPillMappings).values({ organizationId: f.organizationId, triggerKey: "sent_to_fulfillment",
        targetStatusKey: "m5_fulfillment", isActive: true, source: "system" });
      await tx.insert(schema.quotes).values({ id: f.quoteId, organizationId: f.organizationId, userId: f.userId, customerId: f.customerId,
        quoteNumber: 970005, totalPrice: "150.00" });
      await tx.insert(schema.orders).values({ id: f.orderId, organizationId: f.organizationId, customerId: f.customerId, createdByUserId: f.userId,
        quoteId: f.quoteId, orderNumber: "970005", displayNumber: "M5-970005", state: "open", status: "in_production", statusPillId: f.initialPillId,
        statusPillValue: "M5 In Production", shippingMethod: "pickup", subtotal: "150.00", total: "150.00" });
      await tx.insert(schema.invoices).values({ id: f.invoiceId, organizationId: f.organizationId, orderId: f.orderId, customerId: f.customerId,
        createdByUserId: f.userId, invoiceNumber: 970005, sourceOrderNumber: 970005, subtotal: "150.00", total: "150.00", totalCents: 15000 });
      await tx.insert(schema.orderLineItems).values([
        { id: f.line1Id, orderId: f.orderId, productId: f.serviceProductId, description: "M5 Line 1 — Setup service (already complete)", quantity: 1,
          unitPrice: "25.00", totalPrice: "25.00", sortOrder: 0, productType: "service_fee", status: "complete", workflowState: "completed",
          requiresPrepress: false, requiresDesign: false, requiresProofApproval: false },
        { id: f.line2Id, orderId: f.orderId, productId: f.printProductId, description: "M5 Line 2 — Five synthetic printed signs", quantity: 5,
          width: "24.00", height: "18.00", unitPrice: "25.00", totalPrice: "125.00", sortOrder: 1, productType: "flatbed",
          status: "in_production", workflowState: "in_production", requiresPrepress: false, requiresDesign: false, requiresProofApproval: false,
          materialUsageJson: materialHistory, optionSelectionsJson: optionsHistory, pbv2SnapshotJson: pbv2History },
      ]);
      await tx.insert(schema.productionJobs).values({ id: f.jobId, organizationId: f.organizationId, orderId: f.orderId, lineItemId: f.line2Id,
        stationKey: "flatbed", stepKey: "queued", status: "in_progress", startedAt });
      await tx.insert(schema.productionEvents).values({ organizationId: f.organizationId, productionJobId: f.jobId, orderId: f.orderId,
        orderLineItemId: f.line2Id, actorUserId: f.userId, type: "timer_started", payload: { syntheticFixture: "M5" }, createdAt: startedAt });
      await tx.insert(schema.inventoryReservations).values({ id: f.reservationId, organizationId: f.organizationId, orderId: f.orderId,
        orderLineItemId: f.line2Id, sourceType: "PBV2_MATERIAL", sourceKey: f.materialId, uom: "sheet", qty: "5.000000", status: "RESERVED", createdByUserId: f.userId });
      // Production owner migration-only station binding, matching native route
      // ownership uniqueness. The typed schema intentionally omits station_id.
      await tx.execute((await import("drizzle-orm")).sql`UPDATE production_jobs SET station_id=${f.flatbedStationId} WHERE id=${f.jobId}`);
    });
    return { ...fixtureIds, login: fixtureLogin, url: fixtureUrl, orderPath: `/orders/${f.orderId}`, notifications: "local scheduling only; dispatch prohibited" };
  } finally { await connection.end(); }
}

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function inspect() {
  const connection = pool();
  const client = await connection.connect();
  try {
    await verifyIdentity(client, "printershero_m5_browser_test");
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const rows = async (statement: string, values: unknown[] = []) => (await client.query(statement, values)).rows;
    const order = (await rows("SELECT * FROM orders WHERE id=$1", [f.orderId]))[0];
    const lines = await rows("SELECT * FROM order_line_items WHERE order_id=$1 ORDER BY sort_order,id", [f.orderId]);
    const jobs = await rows("SELECT * FROM production_jobs WHERE order_id=$1 ORDER BY id", [f.orderId]);
    const timeline = await rows("SELECT * FROM production_events WHERE order_id=$1 ORDER BY created_at,id", [f.orderId]);
    const reservations = await rows("SELECT * FROM inventory_reservations WHERE order_id=$1 ORDER BY id", [f.orderId]);
    const usage = await rows("SELECT * FROM order_material_usage WHERE order_id=$1 ORDER BY id", [f.orderId]);
    const adjustments = await rows("SELECT * FROM inventory_adjustments WHERE order_id=$1 ORDER BY id", [f.orderId]);
    const material = (await rows("SELECT * FROM materials WHERE id=$1", [f.materialId]))[0];
    const statusEvents = await rows("SELECT * FROM order_status_events WHERE order_id=$1 ORDER BY changed_at,id", [f.orderId]);
    const outbox = await rows("SELECT * FROM invoice_email_delivery_jobs WHERE status_order_id=$1 ORDER BY id", [f.orderId]);
    const audits = await rows("SELECT * FROM audit_logs WHERE entity_id=$1 AND entity_type='production_job' ORDER BY id", [f.jobId]);
    const counts = (await rows(`SELECT (SELECT count(*)::int FROM shipments) AS shipments,
      (SELECT count(*)::int FROM fulfillment_events) AS fulfillment_events,
      (SELECT count(*)::int FROM fulfillment_ready_quantities) AS physical_ready_rows,
      (SELECT count(*)::int FROM outbound_notifications) AS outbound_notifications,
      (SELECT count(*)::int FROM production_jobs j LEFT JOIN orders o ON o.id=j.order_id LEFT JOIN order_line_items l ON l.id=j.line_item_id
        WHERE o.id IS NULL OR l.id IS NULL OR l.order_id<>j.order_id OR o.organization_id<>j.organization_id) AS orphan_jobs`))[0];
    const quote = (await rows("SELECT * FROM quotes WHERE id=$1", [f.quoteId]))[0];
    const invoice = (await rows("SELECT * FROM invoices WHERE id=$1", [f.invoiceId]))[0];
    const commercial = { orderId: order?.id, quoteId: order?.quote_id, customerId: order?.customer_id, total: order?.total, subtotal: order?.subtotal,
      lines: lines.map(line => ({ id: line.id, productId: line.product_id, quantity: line.quantity, width: line.width, height: line.height,
        unitPrice: line.unit_price, totalPrice: line.total_price, materialUsageJson: line.material_usage_json,
        optionSelectionsJson: line.option_selections_json, pbv2SnapshotJson: line.pbv2_snapshot_json })), quote, invoice };
    const effects = { order, lines, jobs, timeline, reservations, usage, adjustments, material, statusEvents, outbox, audits, counts, commercial };
    await client.query("COMMIT");
    return { ...effects, effectsHash: hash(effects), commercialHash: hash(commercial), counters: { jobs: jobs.length, timeline: timeline.length,
      completionEvents: timeline.filter(event => event.payload?.eventType === "production_job_completed").length,
      timerStops: timeline.filter(event => event.type === "timer_stopped").length,
      materialEvents: timeline.filter(event => event.payload?.eventType === "materials_consumed").length,
      reservations: reservations.length, usage: usage.length, adjustments: adjustments.length, statusEvents: statusEvents.length, outbox: outbox.length, audits: audits.length, ...counts } };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); await connection.end(); }
}

function checkCommon(state: Awaited<ReturnType<typeof inspect>>) {
  assert.equal(state.order.id, f.orderId);
  assert.equal(state.order.quote_id, f.quoteId);
  assert.equal(state.order.customer_id, f.customerId);
  assert.equal(Number(state.order.total), 150);
  assert.equal(Number(state.order.subtotal), 150);
  assert.deepEqual(state.lines.map(line => line.id), [f.line1Id, f.line2Id]);
  const line = state.lines[1];
  assert.equal(line.quantity, 5); assert.equal(Number(line.unit_price), 25); assert.equal(Number(line.total_price), 125);
  assert.equal(Number(line.width), 24); assert.equal(Number(line.height), 18);
  assert.deepEqual(line.material_usage_json, materialHistory);
  assert.deepEqual(line.option_selections_json, optionsHistory);
  assert.deepEqual(line.pbv2_snapshot_json, pbv2History);
  assert.equal(state.commercial.quote.id, f.quoteId); assert.equal(Number(state.commercial.quote.total_price), 150);
  assert.equal(state.commercial.invoice.id, f.invoiceId); assert.equal(state.commercial.invoice.order_id, f.orderId);
  assert.equal(state.commercial.invoice.total_cents, 15000);
  assert.equal(state.lines[0].workflow_state, "completed");
  assert.deepEqual(state.counts, { shipments: 0, fulfillment_events: 0, physical_ready_rows: 0, outbound_notifications: 0, orphan_jobs: 0 });
  for (const job of state.outbox) {
    assert.equal(job.status, "queued"); assert.equal(job.sent_at, null); assert.equal(job.claimed_by_worker_id, null);
    assert.equal(job.delivery_type, "order_status"); assert.equal(job.recipient_email, fixtureLogin.email);
    assert.equal(job.metadata.kind, "staff_email");
  }
}
export async function checkBefore() {
  const state = await inspect(); checkCommon(state);
  assert.equal(state.order.state, "open"); assert.equal(state.order.status, "in_production");
  assert.equal(state.lines[1].workflow_state, "in_production");
  assert.equal(state.jobs.length, 1); assert.equal(state.jobs[0].id, f.jobId); assert.equal(state.jobs[0].status, "in_progress");
  assert.equal(state.reservations.length, 1); assert.equal(state.reservations[0].status, "RESERVED");
  assert.equal(Number(state.material.stock_quantity), 100);
  for (const key of ["completionEvents", "timerStops", "materialEvents", "usage", "adjustments", "statusEvents", "outbox", "audits"] as const) assert.equal(state.counters[key], 0, key);
  return { status: "before_GO_verified", counters: state.counters, commercialHash: state.commercialHash, effectsHash: state.effectsHash };
}
export async function checkAfter() {
  const state = await inspect(); checkCommon(state);
  assert.equal(state.order.state, "production_complete"); assert.equal(state.order.status, "ready_for_shipment");
  assert.equal(state.order.status_pill_id, f.fulfillmentPillId);
  assert.equal(state.lines[1].workflow_state, "completed"); assert.equal(state.lines[1].status, "complete");
  assert.equal(state.jobs.length, 2);
  assert.equal(state.jobs.find(job => job.id === f.jobId)?.status, "done");
  assert.equal(state.jobs.find(job => job.id === f.jobId)?.completed_by_user_id, f.userId);
  assert.equal(state.jobs.filter(job => job.station_key === "fulfillment" && job.status === "queued").length, 1);
  assert.equal(state.reservations.length, 1); assert.equal(state.reservations[0].status, "RELEASED");
  assert.equal(Number(state.material.stock_quantity), 95);
  assert.equal(state.usage.length, 1); assert.equal(Number(state.usage[0].quantity_used), 5); assert.equal(state.usage[0].unit_of_measure, "sheet");
  assert.equal(state.adjustments.length, 1); assert.equal(Number(state.adjustments[0].quantity_change), -5);
  for (const key of ["completionEvents", "timerStops", "materialEvents", "statusEvents", "outbox", "audits"] as const) assert.equal(state.counters[key], 1, key);
  assert.equal(state.outbox[0].status_pill_id, f.fulfillmentPillId);
  assert.equal(state.outbox[0].status_event_id, state.statusEvents[0].id);
  assert.equal(state.statusEvents[0].notification_evaluated, true);
  return { status: "after_GO_verified", counters: state.counters, commercialHash: state.commercialHash, effectsHash: state.effectsHash };
}

async function drop() {
  const admin = pool("postgres");
  try {
    await verifyIdentity(admin, "postgres");
    const sessions = (await admin.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname='printershero_m5_browser_test'")).rows[0].count;
    assert.equal(sessions, 0, "Stop app/browser fixture connections before dropping this database");
    await admin.query("DROP DATABASE printershero_m5_browser_test");
    return { dropped: "printershero_m5_browser_test", clusterStillRunning: true };
  } finally { await admin.end(); }
}
async function main() {
  const command = process.argv[2] ?? "ids";
  switch (command) {
    case "bootstrap": return bootstrap();
    case "seed": return seed();
    case "ids": return { ids: fixtureIds, login: fixtureLogin, url: fixtureUrl, orderPath: `/orders/${f.orderId}` };
    case "inspect": return inspect();
    case "check-before": return checkBefore();
    case "check-after": {
      const result = await checkAfter();
      if (process.argv[3]) {
        assert.match(process.argv[3], /^[a-f0-9]{64}$/, "Expected original commercialHash");
        assert.equal(result.commercialHash, process.argv[3], "GO changed historical commercial or Quote/Invoice lineage");
      }
      return result;
    }
    case "fingerprint": { const state = await inspect(); return { effectsHash: state.effectsHash, commercialHash: state.commercialHash, counters: state.counters }; }
    case "check-replay": {
      assert.match(process.argv[3] ?? "", /^[a-f0-9]{64}$/, "Supply the effectsHash captured before the replay");
      const state = await inspect(); assert.equal(state.effectsHash, process.argv[3], "Replay changed persisted business effects");
      return { status: "replay_no_business_writes_verified", effectsHash: state.effectsHash, counters: state.counters };
    }
    case "drop": return drop();
    default: throw new Error(`Unknown fixture command: ${command}`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
}
