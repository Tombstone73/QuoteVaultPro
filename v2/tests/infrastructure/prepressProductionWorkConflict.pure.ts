import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Pool, PoolClient } from "pg";
import { PostgresPrepressTransactionRunner } from "../../infrastructure/prepress/postgresPrepressTransaction.js";
import { PostgresProductionTransaction } from "../../infrastructure/production/postgresProductionTransaction.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

type Work = { id: string; organization_id: string; artwork_assignment_id: string; rework_cycle_id: string | null; replacement_obligation_id: string | null };
const organizationId = brandedId<"OrganizationId">("org-a");
const prepressUnitId = brandedId<"PrepressUnitId">("unit-a");
const assignmentId = "assignment-a";
const timestamp = new Date("2026-09-29T00:00:00.000Z");
const unit = {
  id: prepressUnitId, organization_id: organizationId, order_document_id: "order-a", order_line_id: "line-a",
  artwork_assignment_id: assignmentId, artwork_file_id: "file-a", rework_cycle_id: null,
  side: "front", source_page_index: null, layer_key: null, layer_order: null,
  created_at: timestamp, created_principal_kind: "staff", created_principal_subject: "staff-a", created_staff_actor_user_id: null,
  started_at: timestamp, started_principal_kind: "staff", started_principal_subject: "staff-a", started_staff_actor_user_id: null,
  completed_at: timestamp, completed_principal_kind: "staff", completed_principal_subject: "staff-a", completed_staff_actor_user_id: null,
};

const fixture = (initialWorks: Work[] = [], failInsert = false) => {
  let works = [...initialWorks];
  let routeStep = "prepress";
  let snapshot: { works: Work[]; routeStep: string } | undefined;
  let rollbacks = 0;
  const queries: string[] = [];
  const client = {
    release: () => undefined,
    query: async (sql: string, values: readonly unknown[] = []) => {
      queries.push(sql);
      if (sql === "BEGIN") { snapshot = { works: [...works], routeStep }; return { rows: [] }; }
      if (sql === "COMMIT") { snapshot = undefined; return { rows: [] }; }
      if (sql === "ROLLBACK") { assert.ok(snapshot); works = snapshot.works; routeStep = snapshot.routeStep; snapshot = undefined; rollbacks++; return { rows: [] }; }
      if (sql.startsWith("SELECT * FROM v2_prepress_units")) return { rows: values[0] === organizationId ? [unit] : [] };
      if (sql.includes("FROM v2_route_instances ri LEFT JOIN")) return { rows: [{ id: "route-a", current_step_id: `${routeStep}-step`, revision: routeStep === "prepress" ? "1" : "2", step_kind: routeStep }] };
      if (sql.startsWith("SELECT id,position,step_kind,production_destination_station_key")) return { rows: [
        { id: "prepress-step", position: 1, step_kind: "prepress", production_destination_station_key: null },
        { id: "production-step", position: 2, step_kind: "production", production_destination_station_key: "flatbed" },
      ] };
      if (sql.includes("EXISTS(SELECT 1 FROM v2_proof_works")) return { rows: [{ required: true, approved: true }] };
      if (sql.includes("FROM v2_sales_line_production_requirements requirement")) return { rows: [{ assignment_id: assignmentId }] };
      if (sql.startsWith("UPDATE v2_route_instances")) { routeStep = "production"; return { rows: [] }; }
      if (sql.startsWith("INSERT INTO v2_production_works")) {
        assert.match(sql, /ON CONFLICT\(organization_id,artwork_assignment_id\) WHERE rework_cycle_id IS NULL AND replacement_obligation_id IS NULL DO NOTHING/);
        if (failInsert) throw new Error("simulated Production insert failure");
        if (!works.some(work => work.organization_id === organizationId && work.artwork_assignment_id === assignmentId && work.rework_cycle_id === null && work.replacement_obligation_id === null)) {
          works.push({ id: "original-a", organization_id: organizationId, artwork_assignment_id: assignmentId, rework_cycle_id: null, replacement_obligation_id: null });
        }
        return { rows: [] };
      }
      if (sql.startsWith("SELECT id FROM v2_production_works")) {
        assert.match(sql, /rework_cycle_id IS NULL AND replacement_obligation_id IS NULL/);
        return { rows: works.filter(work => work.organization_id === values[0] && work.artwork_assignment_id === assignmentId && work.rework_cycle_id === null && work.replacement_obligation_id === null).map(work => ({ id: work.id })) };
      }
      throw new Error(`Unexpected Prepress query: ${sql.slice(0, 70)}`);
    },
  } as unknown as PoolClient;
  const runner = new PostgresPrepressTransactionRunner({ connect: async () => client } as unknown as Pool);
  const handoff = () => runner.transaction(tx => tx.handoffToProduction({ organizationId, prepressUnitId, principalKind: "staff", principalSubject: "staff-a" }));
  return { handoff, queries, get works() { return works; }, get routeStep() { return routeStep; }, get rollbacks() { return rollbacks; } };
};

const rework: Work = { id: "rework-a", organization_id: organizationId, artwork_assignment_id: assignmentId, rework_cycle_id: "cycle-a", replacement_obligation_id: null };
const replacement: Work = { id: "replacement-a", organization_id: organizationId, artwork_assignment_id: assignmentId, rework_cycle_id: null, replacement_obligation_id: "obligation-a" };
const foreign: Work = { id: "foreign-a", organization_id: "org-b", artwork_assignment_id: assignmentId, rework_cycle_id: null, replacement_obligation_id: null };
const normal = fixture([rework, replacement, foreign]);
const first = await normal.handoff();
const replay = await normal.handoff();
assert.deepEqual(first.productionWorkIds, ["original-a"]);
assert.deepEqual(replay.productionWorkIds, first.productionWorkIds);
assert.equal(normal.works.filter(work => work.organization_id === organizationId && work.rework_cycle_id === null && work.replacement_obligation_id === null).length, 1);
assert.equal(normal.works.length, 4, "rework, replacement, and foreign-tenant work remain distinct");
assert.equal(normal.routeStep, "production");

const failed = fixture([], true);
await assert.rejects(failed.handoff(), /simulated Production insert failure/);
assert.equal(failed.rollbacks, 1);
assert.equal(failed.routeStep, "prepress", "failed insert cannot commit the Route advancement");
assert.equal(failed.works.length, 0, "failed handoff cannot leave Production Work");
assert.equal(unit.completed_at, timestamp, "completed Prepress evidence remains intact");

const migration = readFileSync(new URL("../../../server/db/migrations_v2/0283_v2_replacement_obligations_shipping_economics.sql", import.meta.url), "utf8");
assert.match(migration, /CREATE UNIQUE INDEX v2_production_works_normal_assignment_uidx ON v2_production_works\(organization_id,artwork_assignment_id\) WHERE rework_cycle_id IS NULL AND replacement_obligation_id IS NULL/);
assert.match(migration, /CREATE UNIQUE INDEX v2_production_works_replacement_obligation_uidx/);
const reworkMigration = readFileSync(new URL("../../../server/db/migrations_v2/0280_v2_production_rework_successor_cycles.sql", import.meta.url), "utf8");
assert.match(reworkMigration, /CREATE UNIQUE INDEX v2_production_works_rework_cycle_uidx/);

const productionQueries: string[] = [];
const production = new PostgresProductionTransaction({ query: async (sql: string) => { productionQueries.push(sql); return { rows: [] }; } } as unknown as PoolClient);
await assert.rejects(production.createOrGetWork({ id: brandedId<"ProductionWorkId">("missing"), organizationId, artworkAssignmentId: brandedId<"ArtworkAssignmentId">(assignmentId), principalKind: "staff", principalSubject: "staff-a" }), /could not reload/);
assert.ok(productionQueries.some(sql => sql.includes("artwork_assignment_id=$2 AND rework_cycle_id IS NULL AND replacement_obligation_id IS NULL")), "direct Production retry does not load replacement work");
console.log("Prepress Production Work conflict, retry, lineage, tenant, and rollback contracts passed.");
