import { jest } from "@jest/globals";
import type { Pool, PoolClient } from "pg";
import { PostgresSuccessorWorkCreation } from "../../infrastructure/production/postgresSuccessorWorkCreation.js";
import { PostgresPrepressTransaction, PostgresPrepressTransactionRunner } from "../../infrastructure/prepress/postgresPrepressTransaction.js";
import { PrepressApplicationService, type PrepressTransaction, type PrepressTransactionRunner } from "../../src/modules/prepress/prepressApplication.js";
import { AuthorityPolicy } from "../../src/authorization/authorityPolicy.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";
import type { ReplacementProductionSource } from "../../src/modules/production/successorWorkCreation.js";

const actor = { organizationId: brandedId<"OrganizationId">("org-a"), principalKind: "staff" as const, principalSubject: "staff-a", staffActorUserId: "staff-a" };
const ordinary = { ...actor, orderLineId: brandedId<"OrderLineId">("line-a"), artworkAssignmentIds: [brandedId<"ArtworkAssignmentId">("art-a")] };
const rework = { ...actor, prepressUnitId: brandedId<"PrepressUnitId">("unit-a"), artworkAssignmentId: brandedId<"ArtworkAssignmentId">("art-a"), reworkCycleId: brandedId<"ProductionReworkCycleId">("cycle-a") };
const source: ReplacementProductionSource = { id: "original-a", order_document_id: "order-a", order_line_id: "line-a", requirement_key: "layer-front", artwork_assignment_id: "art-a", artwork_file_id: "file-a", prepress_unit_id: "original-unit", side: "front", source_page_index: 2, layer_key: "white", layer_order: 3 };
const replacement = { ...actor, orderId: brandedId<"OrderId">("order-a"), orderLineId: ordinary.orderLineId, replacementObligationId: brandedId<"ReplacementObligationId">("obligation-a"), replacementQuantity: 4, sources: [source] };
type Query = { sql: string; values: readonly unknown[] };
const fixture = (respond: (sql: string, values: readonly unknown[]) => readonly unknown[]) => {
  const calls: Query[] = [];
  const client = { query: async (sql: string, values: readonly unknown[] = []) => { calls.push({ sql, values }); return { rows: respond(sql, values) }; } } as unknown as PoolClient;
  return { client, calls, owner: new PostgresSuccessorWorkCreation(client) };
};
const cycle = { id: "cycle-a", predecessor_production_work_id: "predecessor-a", remaining_required_quantity: 7, destination_station_key: "roll", state: "prepress_pending" };

afterEach(() => jest.restoreAllMocks());

test("ordinary creation preserves frozen SQL, partial duplicate target, scoped idempotent read and actor", async () => {
  const f = fixture(sql => sql.startsWith("SELECT id FROM v2_production_works") ? [{ id: "normal-a" }] : []);
  expect(await f.owner.createOrReadCompletedPrepressWork(ordinary)).toEqual(["normal-a"]);
  expect(await f.owner.createOrReadCompletedPrepressWork(ordinary)).toEqual(["normal-a"]);
  const insert = f.calls[0]!;
  expect(insert.values).toEqual(["org-a", "art-a", "staff", "staff-a", "staff-a"]);
  expect(insert.sql).toContain("completed.completed_at IS NOT NULL");
  expect(insert.sql).toContain("req.requirement_key");
  expect(insert.sql).toContain("l.quantity");
  expect(insert.sql).toContain("a.layer_order IS NOT DISTINCT FROM req.layer_order");
  expect(insert.sql).toContain("ON CONFLICT(organization_id,artwork_assignment_id) WHERE rework_cycle_id IS NULL AND replacement_obligation_id IS NULL DO NOTHING");
  expect(f.calls[1]!.values).toEqual(["org-a", "line-a", ["art-a"]]);
  expect(f.calls[1]!.sql).toContain("ORDER BY id FOR SHARE");
  expect(f.calls.some(q => /^(BEGIN|COMMIT|ROLLBACK)$/.test(q.sql))).toBe(false);
});

test("ordinary missing scoped authority cannot return foreign or successor work", async () => {
  const f = fixture(() => []);
  await expect(f.owner.createOrReadCompletedPrepressWork(ordinary)).rejects.toThrow("every completed Prepress assignment");
  expect(f.calls[1]!.sql).toContain("organization_id=$1 AND order_line_id=$2");
  expect(f.calls[1]!.sql).toContain("rework_cycle_id IS NULL AND replacement_obligation_id IS NULL");
});

test("rework creation owns cycle lock/update, frozen partial quantity, destination and predecessor lineage", async () => {
  const f = fixture(sql => sql.includes("FROM v2_production_rework_cycles") ? [cycle] : sql.includes(" current FROM v2_current_artwork_assignments") ? [{ current: true }] : sql.startsWith("INSERT INTO") ? [{ id: "successor-a" }] : []);
  expect(await f.owner.createPrepressReworkWork(rework)).toEqual({ productionWorkId: "successor-a", destination: "roll" });
  expect(f.calls[0]!.values).toEqual(["org-a", "cycle-a"]);
  expect(f.calls[0]!.sql).toContain("FOR UPDATE");
  expect(f.calls[1]!.values).toEqual(["org-a", "art-a"]);
  expect(f.calls[2]!.values).toEqual(["org-a", "art-a", "unit-a", 7, "cycle-a", "staff", "staff-a", "staff-a", "predecessor-a"]);
  expect(f.calls[2]!.sql).toContain("predecessor.requirement_key");
  expect(f.calls[2]!.sql).toContain("WHERE predecessor.organization_id=$1 AND predecessor.id=$9 RETURNING id");
  expect(f.calls[2]!.sql).not.toContain("ON CONFLICT");
  expect(f.calls[2]!.sql).not.toContain("replacement_obligation_id");
  expect(f.calls[3]!.sql).toContain("UPDATE v2_production_rework_cycles SET successor_production_work_id=$3,state='production_created'");
  expect(f.calls[3]!.values).toEqual(["org-a", "cycle-a", "successor-a"]);
});

test.each(["missing", "already_created", "no_destination", "stale_artwork"])("rework %s fails before any creation mutation", async reason => {
  const f = fixture(sql => sql.includes("FROM v2_production_rework_cycles") ? reason === "missing" ? [] : [{ ...cycle, state: reason === "already_created" ? "production_created" : cycle.state, destination_station_key: reason === "no_destination" ? null : cycle.destination_station_key }] : [{ current: false }]);
  await expect(f.owner.createPrepressReworkWork(rework)).rejects.toThrow();
  expect(f.calls.some(q => /^(INSERT|UPDATE|DELETE)/.test(q.sql))).toBe(false);
  expect(f.calls.every(q => q.values[0] === "org-a")).toBe(true);
});

test("replacement creation preserves multiple frozen units, requested quantity and original origin without touching history", async () => {
  const f = fixture(() => []);
  const second = { ...source, id: "rework-source", requirement_key: "back", side: "back" as const, prepress_unit_id: null };
  const ids = await f.owner.createReplacementWork({ ...replacement, sources: [source, second] });
  expect(new Set(ids).size).toBe(2);
  expect(f.calls).toHaveLength(2);
  expect(f.calls[0]!.values).toEqual([ids[0], "org-a", "order-a", "line-a", "layer-front", "art-a", "file-a", "original-unit", "front", 2, "white", 3, 4, "obligation-a", "original-a", "staff", "staff-a", "staff-a"]);
  expect(f.calls[1]!.values[14]).toBe("rework-source");
  expect(f.calls.every(q => q.sql.startsWith("INSERT INTO v2_production_works"))).toBe(true);
  expect(f.calls[0]!.sql).not.toContain("ON CONFLICT");
});

test("replacement source scope mismatch rejects all sources before mutation", async () => {
  const f = fixture(() => []);
  await expect(f.owner.createReplacementWork({ ...replacement, sources: [source, { ...source, order_line_id: "foreign-line" }] })).rejects.toThrow("scoped Order line");
  expect(f.calls).toHaveLength(0);
});

const handoffFixture = (isRework = false, failInsert = false) => {
  const timestamp = new Date("2026-09-30T00:00:00Z");
  const unit = { id: "unit-a", organization_id: "org-a", order_document_id: "order-a", order_line_id: "line-a", artwork_assignment_id: "art-a", artwork_file_id: "file-a", rework_cycle_id: isRework ? "cycle-a" : null, side: null, source_page_index: null, layer_key: null, layer_order: null, created_at: timestamp, created_principal_kind: "staff", created_principal_subject: "staff-a", started_at: timestamp, started_principal_kind: "staff", started_principal_subject: "staff-a", completed_at: timestamp, completed_principal_kind: "staff", completed_principal_subject: "staff-a" };
  const f = fixture((sql, values) => {
    if (sql.startsWith("SELECT * FROM v2_prepress_units")) return values[0] === "org-a" ? [unit] : [];
    if (sql.includes("FROM v2_route_instances ri LEFT JOIN")) return [{ id: "route-a", current_step_id: "prepress-step", step_kind: "prepress" }];
    if (sql.startsWith("SELECT id,position")) return [{ id: "prepress-step", position: 1, step_kind: "prepress" }, { id: "production-step", position: 2, step_kind: "production", production_destination_station_key: "flatbed" }];
    if (sql.includes("EXISTS(SELECT 1 FROM v2_proof_works")) return [{ required: true, approved: true }];
    if (sql.includes("FROM v2_sales_line_production_requirements requirement")) return [{ assignment_id: "art-a", assignment_count: 1 }];
    if (sql.includes("FROM v2_production_rework_cycles")) return [cycle];
    if (sql.includes(" current FROM v2_current_artwork_assignments")) return [{ current: true }];
    if (sql.startsWith("INSERT INTO v2_production_works")) { if (failInsert) throw new Error("insert failed"); return isRework ? [{ id: "successor-a" }] : []; }
    if (sql.startsWith("SELECT id FROM v2_production_works")) return [{ id: "normal-a" }];
    return [];
  });
  return { ...f, tx: new PostgresPrepressTransaction(f.client) };
};

test.each([false, true])("Prepress caller requests the actual bounded owner case (rework=%s) on its same client", async isRework => {
  const f = handoffFixture(isRework);
  const method = isRework ? "createPrepressReworkWork" : "createOrReadCompletedPrepressWork";
  const spy = jest.spyOn(PostgresSuccessorWorkCreation.prototype, method);
  const result = await f.tx.handoffToProduction({ ...actor, prepressUnitId: rework.prepressUnitId });
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy.mock.calls[0]![0]).toEqual(isRework ? rework : { ...actor, prepressUnitId: "unit-a", orderLineId: "line-a", artworkAssignmentIds: ["art-a"] });
  expect(result.productionWorkIds).toEqual([isRework ? "successor-a" : "normal-a"]);
  expect(result.destination).toBe(isRework ? "roll" : "flatbed");
  expect(f.calls.some(q => /^(BEGIN|COMMIT|ROLLBACK)$/.test(q.sql))).toBe(false);
});

test("Prepress wrong tenant performs no mutation; failed owner insert rolls back the caller transaction", async () => {
  const f = handoffFixture();
  await expect(f.tx.handoffToProduction({ ...rework, organizationId: brandedId<"OrganizationId">("org-b") })).rejects.toThrow("not found");
  expect(f.calls).toHaveLength(1);
  const failed = handoffFixture(false, true);
  const release = jest.fn();
  failed.client.release = release;
  const connect = jest.fn(async () => failed.client);
  const runner = new PostgresPrepressTransactionRunner({ connect } as unknown as Pool);
  await expect(runner.transaction(tx => tx.handoffToProduction(rework))).rejects.toThrow("insert failed");
  expect(connect).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledTimes(1);
  expect(failed.calls.filter(q => /^(BEGIN|COMMIT|ROLLBACK)$/.test(q.sql)).map(q => q.sql)).toEqual(["BEGIN", "ROLLBACK"]);
});

test("current Prepress authority gates remain at caller with the same four decisions and no owner-added gate", async () => {
  const f = handoffFixture();
  const authority = new AuthorityPolicy();
  const decide = jest.spyOn(authority, "decide");
  const tx = { reserve: async () => ({ kind: "new", request: { id: "request-a", resultJson: null } }), handoffToProduction: f.tx.handoffToProduction.bind(f.tx), attribute: async () => undefined, audit: async () => undefined, succeed: async () => undefined } as unknown as PrepressTransaction;
  const transaction = jest.fn(async <T>(work: (tx: PrepressTransaction) => Promise<T>) => work(tx));
  const service = new PrepressApplicationService({ transaction } as PrepressTransactionRunner, authority);
  const context = { organizationId: "org-a", operationId: "test", businessRequest: { id: "handoff-a", payloadFingerprint: "test" }, principal: { kind: "staff" as const, organizationId: "org-a", userId: "staff-a", authority: { membershipId: "membership-a", capabilities: ["prepress.complete", "route.advance", "production.work"] as const } } };
  expect((await service.sendToProduction(context, { businessRequestId: "handoff-a", prepressUnitId: rework.prepressUnitId })).ok).toBe(true);
  expect(decide.mock.calls.map(call => call[1].capability)).toEqual(["prepress.complete", "route.advance", "production.work", "prepress.complete"]);
  transaction.mockClear(); decide.mockClear();
  const before = f.calls.length;
  const denied = await service.sendToProduction({ ...context, principal: { ...context.principal, authority: { membershipId: "membership-a", capabilities: [] } } }, { businessRequestId: "handoff-a", prepressUnitId: rework.prepressUnitId });
  expect(denied.ok).toBe(false);
  expect(transaction).not.toHaveBeenCalled();
  expect(f.calls).toHaveLength(before);
});
