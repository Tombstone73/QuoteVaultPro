import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import type { PoolClient } from "pg";
import { PostgresPrepressTransaction } from "../../infrastructure/prepress/postgresPrepressTransaction.js";
import { PrepressApplicationService, type PrepressTransaction, type PrepressTransactionRunner } from "../../src/modules/prepress/prepressApplication.js";
import type { PrepressQueuePageRequest } from "../../src/modules/prepress/contracts.js";
import { createPrepressRouter, type PrepressHttpDependencies } from "../../src/interfaces/http/prepressRoutes.js";
import type { StaffPrincipal } from "../../src/authorization/principals.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

// Capture actual repository SQL: both count and page must apply the identical
// tenant/search/requirement predicate before LIMIT; coverage loads only this page.
for (const requirementState of [undefined, "all", "configured", "unconfigured"] as const) {
  const queries: Array<{ sql: string; values: readonly unknown[] }> = [];
  const state = requirementState === "configured" ? "configured" : "unconfigured";
  const pageRows = Array.from({ length: 25 }, (_, index) => ({
    order_id: `order-${index}`, order_number: `ORD-${index}`, customer_id: null,
    customer_display_name: "QA Customer", line_id: `line-${index + 25}`,
    line_description: "Historical sign", quantity: 1, requested_due_date: null,
    step_kind: "prepress", production_requirement_state: state,
  }));
  const tx = new PostgresPrepressTransaction({ query: async (sql: string, values: readonly unknown[]) => {
    queries.push({ sql, values });
    if (sql.startsWith("SELECT count(*)")) return { rows: [{ count: "51" }] };
    if (sql.startsWith("SELECT d.id order_id")) return { rows: pageRows };
    return { rows: [] };
  } } as unknown as PoolClient);
  const result = await tx.listQueue(brandedId<"OrganizationId">("org-a"), { page: 2, pageSize: 25, search: "QA", ...(requirementState ? { requirementState } : {}) });
  assert.deepEqual(result.pagination, { page: 2, pageSize: 25, totalCount: 51, totalPages: 3 });
  assert.equal(result.items.length, 25, "the page must not be filtered after SQL pagination");
  const [count, rows] = queries;
  assert.ok(count && rows);
  const countWhere = count.sql.slice(count.sql.indexOf("WHERE d.organization_id"));
  const rowsWhere = rows.sql.slice(rows.sql.indexOf("WHERE d.organization_id"), rows.sql.indexOf("ORDER BY d.requested_due_date")).trim();
  assert.equal(rowsWhere, countWhere.trim(), "count and item queries must use identical predicates");
  for (const query of [count, rows]) {
    assert.match(query.sql, /d.organization_id=\$1/);
    assert.match(query.sql, /o.commercial_state='open' AND o.archived_at IS NULL/);
    assert.match(query.sql, /ri.route_state IN \('pending','active'\)/);
    assert.match(query.sql, /ps.step_kind='prepress'/);
    assert.match(query.sql, /\(\$3::text='all' OR l.production_requirement_state=\$3::text\)/);
    assert.deepEqual(query.values.slice(0, 3), ["org-a", "QA", requirementState ?? "all"]);
  }
  assert.match(rows.sql, /LIMIT \$4 OFFSET \$5$/);
  assert.deepEqual(rows.values.slice(3), [25, 25]);
  for (const query of queries.slice(2)) assert.deepEqual(query.values, ["org-a", pageRows.map(row => row.line_id)]);
  assert.ok(queries.every(query => query.sql.startsWith("SELECT")), "recovery is read-only");
  if (state === "unconfigured") for (const item of result.items) assert.deepEqual(item.coverage, { state: "unconfigured", requirements: [], productionArtworkComplete: false, allRequiredPrepressUnitsComplete: false });
}

const calls: Array<{ organizationId: string; query: PrepressQueuePageRequest }> = [];
const runner: PrepressTransactionRunner = { transaction: async action => action({ listQueue: async (organizationId, query) => {
  calls.push({ organizationId, query });
  return { items: [], pagination: { page: query.page!, pageSize: query.pageSize as 25 | 50 | 100, totalCount: 0, totalPages: 0 } };
} } as PrepressTransaction) };
const service = new PrepressApplicationService(runner);
let principal: StaffPrincipal = { kind: "staff", organizationId: "org-a", userId: "staff-a", authority: { membershipId: "membership-a", capabilities: ["prepress.view"] } };
const server = express().use("/v2/organizations/:organizationId/prepress", createPrepressRouter({
  principals: { principal: async () => principal },
  service: service as unknown as PrepressHttpDependencies["service"],
}));
for (const state of ["configured", "unconfigured", "all"]) {
  await request(server).get(`/v2/organizations/org-a/prepress/queue?requirementState=${state}&page=2&pageSize=50&q=%20QA%20`).expect(200);
  assert.deepEqual(calls.at(-1), { organizationId: "org-a", query: { page: 2, pageSize: 50, search: "QA", requirementState: state } });
}
await request(server).get("/v2/organizations/org-a/prepress/queue").expect(200);
assert.equal(calls.at(-1)?.query.requirementState, "all", "existing API consumers retain all routed work");
const authorizedCalls = calls.length;
for (const invalid of ["unknown", "", "configured&requirementState=unconfigured", "configured%27%20OR%201=1--"]) {
  const response = await request(server).get(`/v2/organizations/org-a/prepress/queue?requirementState=${invalid}`).expect(400);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");
}
for (const state of ["configured", "unconfigured", "all"]) {
  await request(server).get(`/v2/organizations/org-b/prepress/queue?requirementState=${state}`).expect(404);
}
principal = { ...principal, authority: { ...principal.authority, capabilities: [] } };
for (const state of ["configured", "unconfigured", "all"]) {
  await request(server).get(`/v2/organizations/org-a/prepress/queue?requirementState=${state}`).expect(403);
}
assert.equal(calls.length, authorizedCalls, "invalid filters, foreign tenants and missing permissions cannot reach persistence");
principal = { ...principal, authority: { ...principal.authority, capabilities: ["prepress.view"] } };
const invalidDirect = await service.listQueue({ organizationId: "org-a", operationId: "test", principal }, { requirementState: "unknown" as "all" });
assert.equal(invalidDirect.ok, false);
assert.equal(calls.length, authorizedCalls);
console.log("Prepress queue hygiene SQL, pagination, default compatibility, HTTP validation, tenant and RBAC regressions passed.");
