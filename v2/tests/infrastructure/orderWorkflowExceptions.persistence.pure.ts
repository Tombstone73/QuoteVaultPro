import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { PoolClient } from "pg";
import { PostgresOwnerTransitions } from "../../infrastructure/routing/postgresOwnerTransitions.js";
const [migration, destinationSnapshot, repository, lifecycle, production, routing] = await Promise.all([
  readFile(new URL("../../../server/db/migrations_v2/0264_v2_order_line_workflow_exceptions.sql", import.meta.url), "utf8"),
  readFile(new URL("../../../server/db/migrations_v2/0266_v2_frozen_route_destination_snapshot.sql", import.meta.url), "utf8"),
  readFile(new URL("../../infrastructure/sales/postgresOrderWorkflowTransaction.ts", import.meta.url), "utf8"),
  readFile(new URL("../../infrastructure/sales/postgresOrderAutomaticLifecycle.ts", import.meta.url), "utf8"),
  readFile(new URL("../../infrastructure/production/postgresProductionTransaction.ts", import.meta.url), "utf8"),
  readFile(new URL("../../infrastructure/routing/postgresOwnerTransitions.ts", import.meta.url), "utf8"),
]);
assert.match(migration, /v2_sales_line_workflow_exceptions/);
assert.match(migration, /workflow\.override/);
assert.match(migration, /production_requirement.*not_required/s);
assert.match(repository, /FOR UPDATE/, "line and route state are locked before exception mutation");
assert.match(repository, /id=\$3 FOR UPDATE OF l,o/, "the workflow lock must exclude the nullable Product Version outer-join side");
assert.match(repository, /JSON\.stringify\(\[input\.changes\]\)/, "workflow audit evidence must use the audit schema's immutable changes array");
assert.match(repository, /hasProductionWork/, "no-production rejects started Production history");
assert.match(repository, /assertProductionArtworkComplete/, "direct Production requires actual current Artwork evidence");
assert.match(repository, /assertCurrentProofApproved/, "proof-required direct Production requires current approval evidence");
assert.match(destinationSnapshot, /production_destination_station_key/, "the explicit production station is snapshotted onto the immutable Route Instance");
assert.match(repository, /inspectSalesWorkflowRoute/, "Sales requests route eligibility from its owner");
assert.match(repository, /applySalesWorkflowException/, "Sales requests transitions through the Routing operation");
assert.match(routing, /production_destination_station_key/, "the Routing owner resolves the frozen station snapshot, never a mutable template step");
assert.doesNotMatch(repository, /source_template_step_id/, "direct workflow must not rely on the historical column dropped by M0194");
assert.doesNotMatch(routing, /source_template_step_id/, "the Routing owner must not resurrect the dropped historical column");
assert.match(repository, /eligibleActions/, "the backend, not React, projects currently eligible line actions");
for (const kind of ["direct_production", "production_not_required"] as const) {
  const calls: { sql: string; values: readonly unknown[] }[] = [];
  const client = { query: async (sql: string, values: readonly unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.startsWith("SELECT id,current_step_id")) return { rows: [{ id: "route-a", current_step_id: "prepress-a", revision: "4" }] };
    if (sql.startsWith("SELECT id,position,step_kind")) return { rows: [
      { id: "prepress-a", position: 1, step_kind: "prepress", production_destination_station_key: null },
      { id: "production-a", position: 2, step_kind: "production", production_destination_station_key: "roll" },
      { id: "fulfillment-a", position: 3, step_kind: "fulfillment", production_destination_station_key: null },
    ] };
    if (sql.includes(") configured")) return { rows: [{ configured: values[3] === "roll" }] };
    return { rows: [], rowCount: 1 };
  } } as unknown as PoolClient;
  const scope = { organizationId: "org-a", orderId: "order-a", orderLineId: "line-a" };
  const request = kind === "direct_production" ? { ...scope, kind, destination: "roll" as const } : { ...scope, kind };
  await new PostgresOwnerTransitions(client).applySalesWorkflowException(request, async () => { calls.push({ sql: "record Sales exception", values: [] }); });
  assert.deepEqual(calls[0]!.values, ["org-a", "line-a", "order-a"], "the owner resolves the current scoped frozen Route");
  const transition = calls.findIndex(call => call.sql.startsWith("UPDATE v2_route_instances"));
  assert.ok(transition > calls.findIndex(call => call.sql === "record Sales exception"), "Sales exception evidence is recorded before the owner advances");
  assert.deepEqual(calls[transition]!.values, ["org-a", "route-a", kind === "direct_production" ? "production-a" : "fulfillment-a", "4", "order-a", "line-a", "prepress-a"], "direct Production targets the frozen Production step; not-required skips to canonical Fulfillment with the current revision");
  if (kind === "direct_production") assert.deepEqual(calls.find(call => call.sql.includes(") configured"))?.values, ["org-a", "route-a", "production-a", "roll"], "direct Production verifies the requested station against the frozen Route destination");
}
assert.match(lifecycle, /v2_sales_line_workflow_exceptions/, "automatic closure reads the explicit no-production fact");
assert.match(production, /production_destination/, "a direct destination constrains the first Production attempt and queue visibility");
console.log("Order workflow exception persistence contracts passed.");
