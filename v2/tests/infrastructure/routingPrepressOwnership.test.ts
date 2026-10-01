import { jest } from "@jest/globals";
import type { Pool, PoolClient } from "pg";
import { PostgresOwnerTransitions } from "../../infrastructure/routing/postgresOwnerTransitions.js";
import { PostgresReworkPreparation } from "../../infrastructure/prepress/postgresReworkPreparation.js";
import { PostgresPrepressTransaction, PostgresPrepressTransactionRunner } from "../../infrastructure/prepress/postgresPrepressTransaction.js";
import { PostgresProductionTransaction, PostgresProductionTransactionRunner } from "../../infrastructure/production/postgresProductionTransaction.js";
import { PostgresOrderWorkflowTransaction, PostgresOrderWorkflowTransactionRunner } from "../../infrastructure/sales/postgresOrderWorkflowTransaction.js";
import { OrderWorkflowApplicationService } from "../../src/modules/sales/workflowApplication.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

const scope = { organizationId: "org-a", orderId: "order-a", orderLineId: "line-a" };
const actor = { organizationId: brandedId<"OrganizationId">("org-a"), principalKind: "staff" as const, principalSubject: "staff-a", staffActorUserId: "staff-a" };
const salesInput = { ...actor, orderId: brandedId<"OrderId">("order-a"), orderLineId: brandedId<"OrderLineId">("line-a"), destination: "roll" as const, reason: "Authorized exception" };
const handoffInput = { ...actor, prepressUnitId: brandedId<"PrepressUnitId">("unit-a") };
const timestamp = new Date("2026-09-30T00:00:00Z");
const preparedUnit = { id: "unit-a", organization_id: "org-a", order_document_id: "order-a", order_line_id: "line-a", artwork_assignment_id: "art-a", artwork_file_id: "file-a", rework_cycle_id: null, side: null, source_page_index: null, layer_key: null, layer_order: null, created_at: timestamp, created_principal_kind: "staff", created_principal_subject: "staff-a", started_at: timestamp, started_principal_kind: "staff", started_principal_subject: "staff-a", completed_at: timestamp, completed_principal_kind: "staff", completed_principal_subject: "staff-a" };
const predecessor = { id: "work-a", organization_id: "org-a", order_document_id: "order-a", order_line_id: "line-a", requirement_key: "front-layer", artwork_assignment_id: "art-a", artwork_file_id: "file-a", side: "front", source_page_index: 2, layer_key: "white", layer_order: 3, ordered_quantity: 10, replacement_obligation_id: null };
const preparationInput = { ...actor, ...scope, reworkCycleId: "cycle-a", predecessorProductionWorkId: "work-a", artworkAssignmentId: "art-a", artworkFileId: "file-a", side: "front" as const, sourcePageIndex: 2, layerKey: "white", layerOrder: 3 };
type Call = { sql: string; values: readonly unknown[] };
type Options = { current?: string; destination?: "flatbed" | "roll" | null; blocker?: string; rework?: boolean; fail?: string; stale?: boolean; readiness?: "missing_unit" | "incomplete_unit" | "proof" | "artwork" };
function fixture(options: Options = {}) {
  const calls: Call[] = [];
  let durable: string[] = [];
  let snapshot: string[] = [];
  const steps = [
    { id: "prepress", position: 1, step_kind: "prepress", production_destination_station_key: null },
    ...(options.blocker ? [{ id: "blocker", position: 2, step_kind: options.blocker, production_destination_station_key: null }] : []),
    { id: "production", position: 3, step_kind: "production", production_destination_station_key: options.destination === undefined ? "roll" : options.destination },
    { id: "fulfillment", position: 4, step_kind: "fulfillment", production_destination_station_key: null },
  ];
  const client = { query: async (sql: string, values: readonly unknown[] = []) => {
    calls.push({ sql, values });
    if (sql === "BEGIN") snapshot = [...durable];
    if (sql === "ROLLBACK") durable = [...snapshot];
    if (options.fail && sql.startsWith(options.fail)) throw new Error("injected downstream failure");
    if (/^(INSERT|UPDATE)/.test(sql)) durable.push(sql);
    if (sql.startsWith("UPDATE v2_route_instances")) return { rows: [], rowCount: options.stale ? 0 : 1 };
    if (sql.startsWith("SELECT * FROM v2_prepress_units")) return { rows: options.readiness === "missing_unit" ? [] : [{ ...preparedUnit, completed_at: options.readiness === "incomplete_unit" ? null : timestamp, rework_cycle_id: options.rework ? "cycle-a" : null }] };
    if (sql.includes("FROM v2_route_instances ri LEFT JOIN") || sql.startsWith("SELECT id,current_step_id")) return { rows: values[0] === "org-a" && values.includes("order-a") && values.includes("line-a") ? [{ id: "route-a", current_step_id: options.current ?? "prepress", revision: "4", step_kind: options.current ?? "prepress" }] : [] };
    if (sql.startsWith("SELECT id,position,step_kind")) return { rows: steps };
    if (sql.includes(") configured")) return { rows: [{ configured: values[3] === steps.find(step => step.id === "production")?.production_destination_station_key }] };
    if (sql.includes("workflow_intent")) return { rows: [{ id: "line-a", requires_production: true, requires_proof: true, workflow_intent: "standard_production" }] };
    if (sql.startsWith("SELECT 1 FROM v2_production_works")) return { rows: [], rowCount: 0 };
    if (sql.includes(" count(*) = count(a.id) complete")) return { rows: [{ complete: true }] };
    if (sql.includes(") approved") || sql.includes(" required,")) return { rows: [{ required: true, approved: options.readiness !== "proof" }] };
    if (sql.includes("FROM v2_sales_line_production_requirements requirement")) return { rows: [{ assignment_id: options.readiness === "artwork" ? null : "art-a" }] };
    if (sql.startsWith("SELECT id FROM v2_production_works")) return { rows: [{ id: "ordinary-a" }] };
    if (sql.startsWith("SELECT * FROM v2_production_works")) return { rows: [predecessor] };
    if (sql.includes(" station_key FROM v2_production_works work")) return { rows: [{ station_key: "roll" }] };
    if (sql.startsWith("INSERT INTO v2_production_rework_cycles")) return { rows: [{ id: "cycle-a" }] };
    if (sql.startsWith("INSERT INTO v2_prepress_units")) {
      const matches = values[0] === "org-a" && values[1] === "order-a" && values[2] === "line-a" && values[3] === "art-a" && values[4] === "file-a" && values[5] === "front" && values[6] === 2 && values[7] === "white" && values[8] === 3 && values[9] === "cycle-a" && values[13] === "work-a";
      if (!matches) durable.pop();
      return { rows: matches ? [{ id: "rework-unit" }] : [] };
    }
    if (sql.startsWith("SELECT id,predecessor_production_work_id")) return { rows: [{ id: "cycle-a", predecessor_production_work_id: "work-a", remaining_required_quantity: 7, destination_station_key: "roll", state: "prepress_pending" }] };
    if (sql.includes(" current FROM v2_current_artwork_assignments")) return { rows: [{ current: true }] };
    if (sql.startsWith("INSERT INTO v2_production_works")) return { rows: [{ id: "successor-a" }] };
    return { rows: [], rowCount: 1 };
  }, release: jest.fn() } as unknown as PoolClient;
  const pool = { connect: async () => client } as unknown as Pool;
  return { calls, client, pool, durable: () => durable, owner: new PostgresOwnerTransitions(client) };
}

afterEach(() => jest.restoreAllMocks());

test.each(["flatbed", "roll"] as const)("Routing accepts ordinary handoff to frozen %s and guards scope/revision", async destination => {
  const f = fixture({ destination });
  const result = await f.owner.handoffPreparedPrepress(scope, async station => ({ kind: "ordinary", createWork: async () => station }));
  expect(result).toEqual({ destination, value: destination });
  expect(f.calls[0]!.values).toEqual(["org-a", "order-a", "line-a"]);
  const update = f.calls.find(call => call.sql.startsWith("UPDATE"))!;
  expect(update.values).toEqual(["org-a", "route-a", "production", "4", "order-a", "line-a", "prepress"]);
  expect(update.sql).toContain("revision=$4");
  expect(f.calls.some(call => /^(BEGIN|COMMIT|ROLLBACK)$/.test(call.sql))).toBe(false);
});

test.each(["production", "prepress"])("Routing rework at current %s does not rewind or advance", async current => {
  const f = fixture({ current });
  expect(await f.owner.handoffPreparedPrepress(scope, async () => ({ kind: "rework", value: "successor" }))).toEqual({ destination: "roll", value: "successor" });
  expect(f.calls.some(call => call.sql.startsWith("UPDATE"))).toBe(false);
});

test("ordinary already at Production creates work without advancing again", async () => {
  const f = fixture({ current: "production" });
  await f.owner.handoffPreparedPrepress(scope, async () => ({ kind: "ordinary", createWork: async () => "existing" }));
  expect(f.calls.some(call => call.sql.startsWith("UPDATE"))).toBe(false);
});

test.each([{ current: "proofing" }, { blocker: "proofing" }, { destination: null }] as Options[])("Routing rejects invalid handoff %j before owner readiness callback", async options => {
  const f = fixture(options), prepare = jest.fn<() => Promise<{ kind: "rework"; value: string }>>();
  await expect(f.owner.handoffPreparedPrepress(scope, prepare)).rejects.toThrow();
  expect(prepare).not.toHaveBeenCalled();
  expect(f.durable()).toHaveLength(0);
});

test.each(["organizationId", "orderId", "orderLineId"] as const)("Routing denies mismatched %s without downstream writes", async key => {
  const f = fixture(), prepare = jest.fn<() => Promise<{ kind: "rework"; value: string }>>();
  await expect(f.owner.handoffPreparedPrepress({ ...scope, [key]: "foreign" }, prepare)).rejects.toThrow("active frozen Route");
  await expect(f.owner.applySalesWorkflowException({ ...scope, [key]: "foreign", kind: "production_not_required" }, async () => {})).rejects.toThrow("current frozen Route");
  expect(prepare).not.toHaveBeenCalled();
  expect(f.durable()).toHaveLength(0);
});

test("Routing readiness failure causes no route advance or downstream creation", async () => {
  const f = fixture();
  await expect(f.owner.handoffPreparedPrepress(scope, async () => { throw Error("incomplete owner evidence"); })).rejects.toThrow("incomplete owner evidence");
  expect(f.durable()).toHaveLength(0);
});

test("revision denial prevents downstream Production creation", async () => {
  const f = fixture({ stale: true }), createWork = jest.fn<() => Promise<string>>();
  await expect(f.owner.handoffPreparedPrepress(scope, async () => ({ kind: "ordinary", createWork }))).rejects.toMatchObject({ code: "CONFLICT" });
  expect(createWork).not.toHaveBeenCalled();
});

test.each(["prepress", "production"])("Sales not-required at %s advances to Fulfillment without production/prepress rows", async current => {
  const f = fixture({ current });
  await new PostgresOrderWorkflowTransaction(f.client).productionNotRequired(salesInput);
  expect(f.calls.find(call => call.sql.startsWith("UPDATE v2_route_instances"))!.values[2]).toBe("fulfillment");
  expect(f.calls.some(call => /^INSERT INTO v2_(prepress_units|production_works)/.test(call.sql))).toBe(false);
  expect(f.calls.find(call => call.sql.startsWith("INSERT INTO v2_sales_line_workflow_exceptions"))!.values.slice(3, 6)).toEqual(["not_required", null, "Authorized exception"]);
  expect(f.calls.findIndex(call => call.sql.startsWith("INSERT INTO v2_sales_line_workflow_exceptions"))).toBeLessThan(f.calls.findIndex(call => call.sql.startsWith("UPDATE v2_route_instances")));
});

test.each(["flatbed", "roll"] as const)("Sales direct handoff preserves configured destination %s and owner facts", async destination => {
  const f = fixture({ destination });
  await new PostgresOrderWorkflowTransaction(f.client).directProduction({ ...salesInput, destination });
  const exception = f.calls.find(call => call.sql.startsWith("INSERT INTO v2_sales_line_workflow_exceptions"))!;
  expect(exception.values.slice(3, 6)).toEqual([null, destination, "Authorized exception"]);
  expect(f.calls.find(call => call.sql.startsWith("UPDATE v2_route_instances"))!.values[2]).toBe("production");
  expect(f.calls.some(call => call.sql.includes("v2_proof_works"))).toBe(true);
  expect(f.calls.some(call => call.sql.includes("NOT EXISTS(SELECT 1 FROM v2_artwork_assignments successor"))).toBe(true);
  const exceptionIndex = f.calls.indexOf(exception);
  expect(f.calls.findIndex(call => call.sql.includes(" count(*) = count(a.id) complete"))).toBeLessThan(exceptionIndex);
  expect(f.calls.findIndex(call => call.sql.includes(") approved"))).toBeLessThan(exceptionIndex);
  expect(exceptionIndex).toBeLessThan(f.calls.findIndex(call => call.sql.startsWith("UPDATE v2_route_instances")));
});

test("Sales mismatched destination and blocked next step cannot record exception", async () => {
  for (const options of [{ destination: "flatbed" }, { blocker: "proofing" }] as Options[]) {
    const f = fixture(options);
    await expect(new PostgresOrderWorkflowTransaction(f.client).directProduction(salesInput)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.durable()).toHaveLength(0);
  }
});

test("Sales eligible-actions projection consumes Routing's actual result", async () => {
  const f = fixture();
  const result = await new PostgresOrderWorkflowTransaction(f.client).eligibleActions(actor.organizationId, salesInput.orderId, true);
  expect(result.map(value => value.action)).toEqual(["production_not_required", "direct_production"]);
  expect(result[1]!.allowedDestinations).toEqual(["roll"]);
});

test.each(["flatbed", "roll"] as const)("Routing inspection projects frozen %s destination and Fulfillment eligibility without DML", async destination => {
  const f = fixture({ destination });
  expect(await f.owner.inspectSalesWorkflowRoute(scope)).toEqual({ fulfillmentEligible: true, directProductionDestination: destination });
  expect(f.calls[0]!.values).toEqual(["org-a", "line-a", "order-a"]);
  expect(f.calls[0]!.sql).toContain("organization_id=$1 AND order_line_id=$2 AND order_document_id=$3");
  expect(f.calls[0]!.sql).toContain("route_state IN ('pending','active')");
  expect(f.calls.every(call => call.sql.startsWith("SELECT"))).toBe(true);
  expect(f.durable()).toHaveLength(0);
});

test.each(["organizationId", "orderId", "orderLineId"] as const)("Routing inspection denies foreign %s without exposing destination or writing", async key => {
  const f = fixture();
  expect(await f.owner.inspectSalesWorkflowRoute({ ...scope, [key]: "foreign" })).toEqual({ fulfillmentEligible: false });
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]!.values).toEqual([key === "organizationId" ? "foreign" : "org-a", key === "orderLineId" ? "foreign" : "line-a", key === "orderId" ? "foreign" : "order-a"]);
  expect(f.calls.every(call => call.sql.startsWith("SELECT"))).toBe(true);
  expect(f.durable()).toHaveLength(0);
});

test.each([false, true])("Prepress actual caller preserves ordinary/rework=%s owner interaction", async rework => {
  const f = fixture({ rework });
  const owner = jest.spyOn(PostgresOwnerTransitions.prototype, "handoffPreparedPrepress");
  const result = await new PostgresPrepressTransaction(f.client).handoffToProduction(handoffInput);
  expect(owner).toHaveBeenCalledWith(scope, expect.any(Function));
  expect(result.productionWorkIds).toEqual([rework ? "successor-a" : "ordinary-a"]);
  expect(result.destination).toBe("roll");
  expect(f.calls.filter(call => call.sql.startsWith("UPDATE v2_route_instances"))).toHaveLength(rework ? 0 : 1);
});

test.each(["prepress", "production"])("Prepress rework at %s returns frozen cycle station despite a different current Route station", async current => {
  const f = fixture({ rework: true, destination: "flatbed", current });
  const result = await new PostgresPrepressTransaction(f.client).handoffToProduction(handoffInput);
  expect(result.destination).toBe("roll");
  expect(result.productionWorkIds).toEqual(["successor-a"]);
  expect(f.calls.some(call => call.sql.startsWith("UPDATE v2_route_instances"))).toBe(false);
  expect(f.calls.find(call => call.sql.startsWith("INSERT INTO v2_production_works"))!.values[3]).toBe(7);
});

test("Prepress ordinary handoff advances Routing before accepted Production factory creation", async () => {
  const f = fixture();
  await new PostgresPrepressTransaction(f.client).handoffToProduction(handoffInput);
  const advanceIndex = f.calls.findIndex(call => call.sql.startsWith("UPDATE v2_route_instances"));
  const creationIndex = f.calls.findIndex(call => call.sql.startsWith("INSERT INTO v2_production_works"));
  expect(advanceIndex).toBeGreaterThan(-1);
  expect(creationIndex).toBeGreaterThan(advanceIndex);
  expect(f.calls.findIndex(call => call.sql.includes("FROM v2_sales_line_production_requirements requirement"))).toBeLessThan(advanceIndex);
});

test.each(["missing_unit", "incomplete_unit", "proof", "artwork"] as const)("Prepress retains authoritative %s readiness denial without route/work mutation", async readiness => {
  const f = fixture({ readiness });
  await expect(new PostgresPrepressTransaction(f.client).handoffToProduction(handoffInput)).rejects.toThrow();
  expect(f.durable()).toHaveLength(0);
});

test("Prepress downstream Production failure rolls back Routing advance on the same client", async () => {
  const f = fixture({ fail: "INSERT INTO v2_production_works" });
  await expect(new PostgresPrepressTransactionRunner(f.pool).transaction(tx => tx.handoffToProduction(handoffInput))).rejects.toThrow("injected downstream failure");
  expect(f.calls.some(call => call.sql.startsWith("UPDATE v2_route_instances"))).toBe(true);
  expect(f.calls.filter(call => /^(BEGIN|COMMIT|ROLLBACK)$/.test(call.sql)).map(call => call.sql)).toEqual(["BEGIN", "ROLLBACK"]);
  expect(f.durable()).toHaveLength(0);
});

test("Sales exception failure cannot advance Routing and outer transaction rolls back", async () => {
  const f = fixture({ fail: "INSERT INTO v2_sales_line_workflow_exceptions" });
  await expect(new PostgresOrderWorkflowTransactionRunner(f.pool).transaction(tx => tx.directProduction(salesInput))).rejects.toThrow("injected downstream failure");
  expect(f.calls.some(call => call.sql.startsWith("UPDATE v2_route_instances"))).toBe(false);
  expect(f.durable()).toHaveLength(0);
});

test("Prepress rework owner consumes frozen identity/actor and writes no Production cycle", async () => {
  const f = fixture();
  expect(await new PostgresReworkPreparation(f.client).createReworkPreparation(preparationInput)).toEqual({ prepressUnitId: "rework-unit" });
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]!.values).toEqual(["org-a", "order-a", "line-a", "art-a", "file-a", "front", 2, "white", 3, "cycle-a", "staff", "staff-a", "staff-a", "work-a"]);
  expect(f.calls[0]!.sql).toContain("cycle.state='prepress_pending' AND cycle.successor_prepress_unit_id IS NULL");
  expect(f.calls[0]!.sql).toContain("predecessor.layer_order IS NOT DISTINCT FROM $9");
  expect(f.calls[0]!.sql).not.toContain("v2_current_artwork_assignments");
});

test.each(["organizationId", "orderId", "orderLineId", "reworkCycleId", "predecessorProductionWorkId", "artworkAssignmentId", "artworkFileId", "side", "sourcePageIndex", "layerKey", "layerOrder"] as const)("Prepress rework mismatched %s cannot create a row", async key => {
  const f = fixture();
  await expect(new PostgresReworkPreparation(f.client).createReworkPreparation({ ...preparationInput, [key]: "foreign" })).rejects.toThrow("does not match");
  expect(f.calls[0]!.sql).toContain("cycle.organization_id=$1");
  expect(f.calls).toHaveLength(1);
  expect(f.durable()).toHaveLength(0);
});

const reworkRequest = { ...actor, productionWorkId: brandedId<"ProductionWorkId">("work-a"), reason: "prepare again", recordedGoodQuantity: 3, recordedWasteQuantity: 2 };
test("Production actual rework caller opens Prepress with frozen fields then updates only its cycle", async () => {
  const f = fixture(), owner = jest.spyOn(PostgresReworkPreparation.prototype, "createReworkPreparation");
  const result = await new PostgresProductionTransaction(f.client).createReworkSuccessor(reworkRequest);
  expect(owner).toHaveBeenCalledWith(preparationInput);
  expect(result).toEqual({ productionReworkCycleId: "cycle-a", predecessorProductionWorkId: "work-a", successorPrepressUnitId: "rework-unit", remainingRequiredQuantity: 7 });
  const cycle = f.calls.find(call => call.sql.startsWith("INSERT INTO v2_production_rework_cycles"))!;
  expect(cycle.values.slice(6, 10)).toEqual([7, 3, 2, "roll"]);
  const unitIndex = f.calls.findIndex(call => call.sql.startsWith("INSERT INTO v2_prepress_units"));
  expect(f.calls[unitIndex + 1]!.sql).toContain("UPDATE v2_production_rework_cycles SET successor_prepress_unit_id");
  expect(f.calls.some(call => call.sql.includes("UPDATE v2_route_instances"))).toBe(false);
});

test("Production downstream Prepress failure rolls back cycle without modifying original history", async () => {
  const f = fixture({ fail: "INSERT INTO v2_prepress_units" });
  await expect(new PostgresProductionTransactionRunner(f.pool).transaction(tx => tx.createReworkSuccessor(reworkRequest))).rejects.toThrow("injected downstream failure");
  expect(f.durable()).toHaveLength(0);
  expect(f.calls.some(call => call.sql.startsWith("UPDATE v2_production_rework_cycles"))).toBe(false);
  expect(f.calls.filter(call => /^(BEGIN|COMMIT|ROLLBACK)$/.test(call.sql)).map(call => call.sql)).toEqual(["BEGIN", "ROLLBACK"]);
});

test("workflow.override alone retains authority and application replay controls owner calls", async () => {
  const f = fixture(), tx = new PostgresOrderWorkflowTransaction(f.client);
  jest.spyOn(tx, "policy").mockResolvedValue("flexible");
  jest.spyOn(tx, "reserve").mockResolvedValueOnce({ kind: "new", request: { id: "request-a", resultJson: null } });
  jest.spyOn(tx, "attribute").mockResolvedValue(undefined);
  jest.spyOn(tx, "audit").mockResolvedValue(undefined);
  jest.spyOn(tx, "succeed").mockResolvedValue(undefined);
  const owner = jest.spyOn(PostgresOwnerTransitions.prototype, "applySalesWorkflowException");
  const service = new OrderWorkflowApplicationService({ transaction: async action => action(tx) });
  const context = { organizationId: "org-a", operationId: "test", businessRequest: { id: "request-a", payloadFingerprint: "derived" }, principal: { kind: "staff" as const, organizationId: "org-a", userId: "staff-a", authority: { membershipId: "membership-a", capabilities: ["workflow.override" as const] } } };
  const command = { businessRequestId: "request-a", orderId: salesInput.orderId, orderLineId: salesInput.orderLineId, destination: "roll" as const };
  const first = await service.directProduction(context, command);
  expect(first.ok).toBe(true);
  if (!first.ok) throw Error("first transition failed");
  jest.spyOn(tx, "reserve").mockResolvedValue({ kind: "replay", request: { id: "request-a", resultJson: first.value } });
  expect(await service.directProduction(context, command)).toEqual(first);
  expect(owner).toHaveBeenCalledTimes(1);
});
