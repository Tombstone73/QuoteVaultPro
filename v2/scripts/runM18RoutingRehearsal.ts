import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import { PostgresProductsCompatibilityReader } from "../infrastructure/compatibility/postgresProductsRead.js";
import { requireV2BrowserCloneDatabaseUrl } from "../infrastructure/persistence/cloneSafety.js";
import { assertV2M0PhysicalPostconditions, checkV2M0PhysicalPostconditions } from "../infrastructure/persistence/physicalPostconditions.js";
import { PostgresRoutingRepository } from "../infrastructure/routing/postgresRoutingRepository.js";
import { assertV2RoutingPhysicalPostconditions, checkV2RoutingPhysicalPostconditions } from "../infrastructure/routing/routingPhysicalPostconditions.js";
import { brandedId, type OrganizationId, type RouteTemplateId } from "../src/modules/shared/commercialValues.js";

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server/db/migrations_v2");
const assert = (value: unknown, message: string): asserts value => { if (!value) throw new Error(message); };
const code = (error: unknown): string | undefined => error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : undefined;
const kinds = ["proofing", "prepress", "production", "fulfillment"] as const;
type StepKind = (typeof kinds)[number];
type Fixture = Readonly<{ organizationA: string; organizationB: string; templateA: string; templateB: string; printedType: string; serviceType: string }>;

const normalize = (name: string) => name.toLowerCase();
async function template(client: PoolClient, organizationId: string, name: string, steps: readonly StepKind[], revision = 1): Promise<string> {
  const id = `m18-template-${randomUUID()}`;
  await client.query("INSERT INTO v2_route_templates(id,organization_id,name,normalized_name,revision,definition_fingerprint) VALUES($1,$2,$3,$4,$5,$6)", [id, organizationId, name, normalize(name), revision, `sha256:m18-${revision}-${steps.join("-")}`]);
  for (const [position, kind] of steps.entries())
    await client.query("INSERT INTO v2_route_template_steps(id,organization_id,route_template_id,position,step_kind) VALUES($1,$2,$3,$4,$5)", [`m18-template-step-${randomUUID()}`, organizationId, id, position, kind]);
  return id;
}
async function replaceTemplateSteps(client: PoolClient, organizationId: string, templateId: string, steps: readonly StepKind[]): Promise<void> {
  await client.query("SELECT id FROM v2_route_templates WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId, templateId]);
  await client.query("DELETE FROM v2_route_template_steps WHERE organization_id=$1 AND route_template_id=$2", [organizationId, templateId]);
  for (const [position, kind] of steps.entries())
    await client.query("INSERT INTO v2_route_template_steps(id,organization_id,route_template_id,position,step_kind) VALUES($1,$2,$3,$4,$5)", [`m18-template-step-${randomUUID()}`, organizationId, templateId, position, kind]);
  await client.query("UPDATE v2_route_templates SET revision=revision+1,definition_fingerprint=$3,updated_at=now() WHERE organization_id=$1 AND id=$2", [organizationId, templateId, `sha256:m18-2-${steps.join("-")}`]);
}
async function fixture(client: PoolClient): Promise<Fixture> {
  const suffix = randomUUID();
  const f = { organizationA: `m18-org-a-${suffix}`, organizationB: `m18-org-b-${suffix}`, templateA: "", templateB: "", printedType: `m18-type-printed-${suffix}`, serviceType: `m18-type-service-${suffix}` };
  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO organizations(id,name,slug) VALUES($1,'M18 A',$2),($3,'M18 B',$4)", [f.organizationA, `m18-a-${suffix}`, f.organizationB, `m18-b-${suffix}`]);
    f.templateA = await template(client, f.organizationA, "Printed", kinds);
    f.templateB = await template(client, f.organizationB, "Fulfillment", ["fulfillment"]);
    await client.query("INSERT INTO product_types(id,organization_id,name,routing_mode,default_route_template_id) VALUES($1,$2,'Printed','route_required',$3),($4,$2,'Service','no_route',NULL)", [f.printedType, f.organizationA, f.templateA, f.serviceType]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  return f;
}
async function cleanup(url: string, f: Fixture): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1, application_name: "m18-routing-cleanup" });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Definitions deliberately use RESTRICT while they are referenced. The
      // disposable fixture therefore removes children explicitly, in the same
      // direction a future organization-retirement workflow would use.
      await client.query("DELETE FROM v2_route_instance_steps WHERE organization_id=ANY($1::text[])", [[f.organizationA, f.organizationB]]);
      await client.query("DELETE FROM v2_route_instances WHERE organization_id=ANY($1::text[])", [[f.organizationA, f.organizationB]]);
      await client.query("DELETE FROM product_types WHERE id=ANY($1::text[])", [[f.printedType, f.serviceType]]);
      await client.query("DELETE FROM v2_route_template_steps WHERE organization_id=ANY($1::text[])", [[f.organizationA, f.organizationB]]);
      await client.query("DELETE FROM v2_route_templates WHERE organization_id=ANY($1::text[])", [[f.organizationA, f.organizationB]]);
      await client.query("DELETE FROM organizations WHERE id=ANY($1::text[])", [[f.organizationA, f.organizationB]]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
const work = (organizationId: string, suffix: string) => ({ kind: "sales_order_line" as const, organizationId: brandedId<"OrganizationId">(organizationId), orderId: brandedId<"OrderId">(`m18-order-${suffix}`), orderLineId: brandedId<"OrderLineId">(`m18-order-line-${suffix}`) });

async function expectConstraint(client: PoolClient, action: () => Promise<unknown>, label: string): Promise<void> {
  await client.query("SAVEPOINT m18_constraint");
  try { await action(); await client.query("SET CONSTRAINTS ALL IMMEDIATE"); await client.query("RELEASE SAVEPOINT m18_constraint"); } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT m18_constraint");
    assert(["23503", "23505", "23514"].includes(code(error) ?? ""), `${label}: expected integrity error, got ${code(error) ?? String(error)}`);
    return;
  }
  throw new Error(`${label}: expected PostgreSQL integrity rejection.`);
}

async function runPolicyAndFreeze(client: PoolClient, f: Fixture): Promise<void> {
  const org = brandedId<"OrganizationId">(f.organizationA), repository = new PostgresRoutingRepository(client);
  const products = new PostgresProductsCompatibilityReader(client);
  const printed = await products.resolveProductType(org, brandedId<"ProductTypeId">(f.printedType));
  const service = await products.resolveProductType(org, brandedId<"ProductTypeId">(f.serviceType));
  assert(printed?.routePolicy.kind === "route_required" && printed.routePolicy.defaultRouteTemplateId === f.templateA, "Products did not expose its explicit default Route Template reference.");
  assert(service?.routePolicy.kind === "no_route", "Service/Fee no-route policy was not explicit.");
  const noRouteWork = work(f.organizationA, "no-route");
  const beforeNoRoute = await client.query("SELECT 1 FROM v2_route_instances WHERE organization_id=$1 AND order_line_id=$2", [f.organizationA, noRouteWork.orderLineId]);
  assert(beforeNoRoute.rowCount === 0, "No-route work unexpectedly needs a dummy Route Instance.");

  await client.query("BEGIN");
  const routeA = await repository.instantiateRoute({ organizationId: org, work: work(f.organizationA, "a"), routeTemplateId: brandedId<"RouteTemplateId">(f.templateA) });
  await client.query("COMMIT");
  assert(routeA.created && routeA.routeInstance.state === "pending" && routeA.routeInstance.currentStepId === routeA.routeInstance.steps[0]?.routeInstanceStepId, "Route A did not receive a durable pending current position.");
  assert(routeA.routeInstance.steps.map((step) => step.kind).join(",") === kinds.join(","), "Printed template did not freeze ordered steps.");

  await client.query("BEGIN"); await replaceTemplateSteps(client, f.organizationA, f.templateA, ["prepress", "production", "fulfillment"]); await client.query("COMMIT");
  await client.query("BEGIN");
  const routeB = await repository.instantiateRoute({ organizationId: org, work: work(f.organizationA, "b"), routeTemplateId: brandedId<"RouteTemplateId">(f.templateA) });
  await client.query("COMMIT");
  const rereadA = await repository.readRouteInstance(org, routeA.routeInstance.routeInstanceId);
  assert(rereadA?.steps.map((step) => step.kind).join(",") === kinds.join(","), "Template mutation reinterpreted frozen Route A.");
  assert(routeB.routeInstance.steps.map((step) => step.kind).join(",") === "prepress,production,fulfillment", "Route B did not use the new template definition.");
  assert(new Set(routeA.routeInstance.steps.map((step) => step.routeInstanceStepId)).size === 4, "Frozen instance steps lack durable distinct IDs.");

  const revisionConflictWork = work(f.organizationA, "revision-conflict");
  await client.query("BEGIN");
  const firstRevision = await repository.instantiateRoute({ organizationId: org, work: revisionConflictWork, routeTemplateId: brandedId<"RouteTemplateId">(f.templateA) });
  await client.query("COMMIT");
  await client.query("BEGIN");
  await replaceTemplateSteps(client, f.organizationA, f.templateA, ["proofing", "prepress", "production", "fulfillment"]);
  await client.query("COMMIT");
  await client.query("BEGIN");
  let revisionConflict = false;
  try {
    await repository.instantiateRoute({ organizationId: org, work: revisionConflictWork, routeTemplateId: brandedId<"RouteTemplateId">(f.templateA) });
  } catch (error) {
    revisionConflict = error instanceof Error && "code" in error && (error as { code: string }).code === "CONFLICT";
  }
  await client.query("ROLLBACK");
  assert(firstRevision.created && revisionConflict, "A retried work item silently accepted a different template revision.");

  const oneStep = await template(client, f.organizationA, `Static ${randomUUID()}`, ["fulfillment"]);
  await client.query("BEGIN"); const staticRoute = await repository.instantiateRoute({ organizationId: org, work: work(f.organizationA, "static"), routeTemplateId: brandedId<"RouteTemplateId">(oneStep) }); await client.query("COMMIT");
  assert(staticRoute.routeInstance.steps.length === 1 && staticRoute.routeInstance.steps[0]?.kind === "fulfillment", "One-step static/resale route is invalid.");
  console.log("[m1.8] Product Type policy, no-route, frozen route, and single-step route matrix passed.");
}

async function runIntegrityAndRollback(client: PoolClient, f: Fixture): Promise<void> {
  const repository = new PostgresRoutingRepository(client), org = brandedId<"OrganizationId">(f.organizationA);
  await client.query("BEGIN");
  try {
    await expectConstraint(client, () => client.query("INSERT INTO v2_route_template_steps(id,organization_id,route_template_id,position,step_kind) VALUES($1,$2,$3,0,'production')", [`m18-duplicate-position-${randomUUID()}`, f.organizationA, f.templateA]), "Duplicate template position");
    await expectConstraint(client, () => client.query("INSERT INTO v2_route_instances(id,organization_id,work_kind,order_document_id,order_line_id,source_template_id,source_template_revision,source_template_fingerprint,route_state,current_step_id) VALUES($1,$2,'sales_order_line','bad-order',$3,$4,1,'fingerprint','pending',$5)", [`m18-bad-pointer-${randomUUID()}`, f.organizationA, `m18-bad-line-${randomUUID()}`, f.templateA, `m18-foreign-step-${randomUUID()}`]), "Current step outside instance");
    await client.query("ROLLBACK");
  } catch (error) { await client.query("ROLLBACK"); throw error; }

  const rollbackWork = work(f.organizationA, "rollback");
  const stepsBefore = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM v2_route_instance_steps WHERE organization_id=$1", [f.organizationA]);
  await client.query("BEGIN");
  try {
    const failing = new PostgresRoutingRepository(client, { afterFrozenStep: async (position) => { if (position === 1) throw new Error("m18-injected-after-step"); } });
    await failing.instantiateRoute({ organizationId: org, work: rollbackWork, routeTemplateId: brandedId<"RouteTemplateId">(f.templateA) });
    throw new Error("Injected rollback did not fire.");
  } catch (error) {
    await client.query("ROLLBACK");
    assert(error instanceof Error && error.message === "m18-injected-after-step", "Unexpected route rollback failure.");
  }
  const afterRollback = await client.query("SELECT 1 FROM v2_route_instances WHERE organization_id=$1 AND order_line_id=$2", [f.organizationA, rollbackWork.orderLineId]);
  assert(afterRollback.rowCount === 0, "Rollback leaked partial Route Instance.");
  const stepsAfter = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM v2_route_instance_steps WHERE organization_id=$1", [f.organizationA]);
  assert(stepsAfter.rows[0]?.count === stepsBefore.rows[0]?.count, "Rollback leaked frozen Route Instance steps.");
  await client.query("BEGIN"); const retry = await repository.instantiateRoute({ organizationId: org, work: rollbackWork, routeTemplateId: brandedId<"RouteTemplateId">(f.templateA) }); await client.query("COMMIT");
  assert(retry.created, "Rollback retry did not create a clean Route Instance.");

  assert(await repository.resolveRouteTemplate(brandedId<"OrganizationId">(f.organizationB), brandedId<"RouteTemplateId">(f.templateA)) === null, "Foreign Route Template leaked across organizations.");
  let wrongTenant = false;
  try { await repository.instantiateRoute({ organizationId: org, work: work(f.organizationB, "foreign-work"), routeTemplateId: brandedId<"RouteTemplateId">(f.templateA) }); } catch (error) { wrongTenant = error instanceof Error && "code" in error && (error as { code: string }).code === "WRONG_TENANT"; }
  assert(wrongTenant, "Foreign work identity was accepted by Routing.");
  const foreignTemplateWork = work(f.organizationB, "foreign-template");
  let foreignTemplate = false;
  try {
    await repository.instantiateRoute({ organizationId: brandedId<"OrganizationId">(f.organizationB), work: foreignTemplateWork, routeTemplateId: brandedId<"RouteTemplateId">(f.templateA) });
  } catch (error) { foreignTemplate = error instanceof Error && "code" in error && (error as { code: string }).code === "NOT_FOUND"; }
  assert(foreignTemplate, "Organization B could instantiate Organization A's Route Template.");
  const foreignRoute = await client.query("SELECT 1 FROM v2_route_instances WHERE organization_id=$1 AND order_line_id=$2", [f.organizationB, foreignTemplateWork.orderLineId]);
  assert(foreignRoute.rowCount === 0, "Foreign Route Template attempt wrote an Organization B Route Instance.");
  console.log("[m1.8] tenant, pointer, constraint, and rollback matrix passed.");
}

async function runConcurrency(pool: Pool, f: Fixture): Promise<void> {
  const shared = work(f.organizationA, "concurrent");
  let signalFirstInserted!: () => void;
  let releaseFirst!: () => void;
  let signalSecondReady!: () => void;
  let signalSecondBackend!: (pid: number) => void;
  const firstInserted = new Promise<void>((resolve) => { signalFirstInserted = resolve; });
  const firstMayCommit = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const secondReady = new Promise<void>((resolve) => { signalSecondReady = resolve; });
  const secondBackend = new Promise<number>((resolve) => { signalSecondBackend = resolve; });
  const instantiate = async (hooks?: ConstructorParameters<typeof PostgresRoutingRepository>[1], reportBackend?: (pid: number) => void) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (reportBackend) reportBackend((await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid);
      const result = await new PostgresRoutingRepository(client, hooks).instantiateRoute({ organizationId: brandedId<"OrganizationId">(f.organizationA), work: shared, routeTemplateId: brandedId<"RouteTemplateId">(f.templateA) });
      await client.query("COMMIT");
      return result;
    }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  };
  const left = instantiate({ afterInstance: async () => { signalFirstInserted(); await firstMayCommit; } });
  await firstInserted;
  const right = instantiate({ beforeInstanceInsert: () => signalSecondReady() }, signalSecondBackend);
  await secondReady;
  const blockedPid = await secondBackend;
  const observer = await pool.connect();
  try {
    const deadline = Date.now() + 5_000;
    let observedBlockedInsert = false;
    while (Date.now() < deadline && !observedBlockedInsert) {
      const state = await observer.query<{ state: string; wait_event_type: string | null; query: string }>(
        "SELECT state,wait_event_type,query FROM pg_stat_activity WHERE pid=$1",
        [blockedPid],
      );
      const row = state.rows[0];
      observedBlockedInsert = row?.state === "active" && row.wait_event_type === "Lock" && /INSERT INTO v2_route_instances/.test(row.query);
    }
    assert(observedBlockedInsert, "Second PostgreSQL transaction never reached the held unique Route Instance insert.");
  } finally {
    observer.release();
  }
  releaseFirst();
  const [leftResult, rightResult] = await Promise.all([left, right]);
  assert(leftResult.routeInstance.routeInstanceId === rightResult.routeInstance.routeInstanceId && leftResult.created !== rightResult.created, "Concurrent route instantiation did not converge on one Route Instance.");
  const count = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM v2_route_instances WHERE organization_id=$1 AND order_line_id=$2", [f.organizationA, shared.orderLineId]);
  assert(count.rows[0]?.count === "1", "Physical route-work uniqueness allowed duplicate Route Instances.");
  console.log("[m1.8] real PostgreSQL concurrent exactly-one Route Instance matrix passed.");
}

async function main(): Promise<void> {
  const url = requireV2BrowserCloneDatabaseUrl();
  // One primary fixture/observer client plus two concurrent route creators and
  // Drizzle's migration client require four connections in this test harness.
  const pool = new Pool({
    connectionString: url,
    max: 4,
    application_name: "m18-routing-rehearsal",
  });
  let client: PoolClient | undefined; let f: Fixture | undefined;
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder, migrationsTable: "__drizzle_migrations_v2", migrationsSchema: "public" });
    console.log("[m1.8] migrations applied.");
    client = await pool.connect();
    await client.query("SET application_name='m18-routing-rehearsal:physical'");
    assertV2M0PhysicalPostconditions(await checkV2M0PhysicalPostconditions(client));
    assertV2RoutingPhysicalPostconditions(await checkV2RoutingPhysicalPostconditions(client));
    f = await fixture(client);
    console.log("[m1.8] fixture created.");
    await client.query("SET application_name='m18-routing-rehearsal:freeze'");
    await runPolicyAndFreeze(client, f);
    await client.query("SET application_name='m18-routing-rehearsal:integrity'");
    await runIntegrityAndRollback(client, f);
    console.log("[m1.8] starting concurrent instantiation matrix.");
    await client.query("SET application_name='m18-routing-rehearsal:concurrency'");
    await runConcurrency(pool, f);
    assertV2RoutingPhysicalPostconditions(await checkV2RoutingPhysicalPostconditions(client));
    console.log("[m1.8] Routing identity PostgreSQL rehearsal passed.");
  } finally {
    client?.release();
    client = undefined;
    await pool.end();
    if (f) await cleanup(url, f);
  }
}
main().catch((error: unknown) => { console.error(`[m1.8] validation failed: ${error instanceof Error ? error.message : "unknown failure"}`); process.exitCode = 1; });
