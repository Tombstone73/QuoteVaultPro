import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { auditLogs, orderLineItems, productionJobs } from "@shared/schema";
import { scriptedWorkflowTx } from "./helpers/scriptedWorkflowTx";

const transition = jest.fn<any>();
const retire = jest.fn<any>();
const sync = jest.fn<any>();
const eligibility = jest.fn<any>();
const transaction = jest.fn<any>();
jest.unstable_mockModule("../db", () => ({ db: { transaction } }));
jest.unstable_mockModule("../services/lineItemWorkflowService", () => ({ transitionLineItemWorkflowState: transition }));
jest.unstable_mockModule("../services/proofingService", () => ({ retireProofAuthorityForUpstream: retire, autoSyncCanonicalProofForLineItem: sync }));
jest.unstable_mockModule("../services/fulfillment/repository", () => ({ FulfillmentDashboardRepo: class { listLineEligibility = eligibility; } }));
const { returnUpstreamInTransaction, returnUpstream, returnUpstreamRequestSchema } = await import("../services/returnUpstreamService");
const input = { organizationId: "tenant", actorUserId: "actor", lineItemId: "line", destination: "design" as const,
  reason: "Correct artwork", expectedWorkflowState: "in_prepress" as const, expectedOwnerJobId: "prepress", expectedUpdatedAt: "2026-09-30T12:00:00.000Z" };
const line = { id: "line", orderId: "order", workflowState: "in_prepress", status: "new", updatedAt: new Date(input.expectedUpdatedAt), requiresProofApproval: true };
const order = { id: "order", state: "open", status: "in_progress", proofApprovalPolicyOverride: "inherit_default" };
const job = { id: "prepress", stationKey: "prepress", stepKey: "prepress", status: "queued" };
function setup(overrides: { role?: string; missing?: boolean; line?: any; order?: any; jobs?: any[]; runs?: any[] } = {}) {
  return scriptedWorkflowTx([
    [{ role: overrides.role ?? "admin" }], overrides.missing ? [] : [{ id: "line" }],
    [{ line: { ...line, ...overrides.line }, order: { ...order, ...overrides.order } }],
    overrides.jobs ?? [job, { id: "old-design", status: "done", stationKey: "design", totalSeconds: 90 }], overrides.runs ?? [],
  ]);
}
beforeEach(() => {
  jest.clearAllMocks();
  retire.mockResolvedValue({ priorApprovedProofVersionId: "approved", priorProofs: [{ id: "approved", status: "approved" }], supersededProofVersionIds: [], resumedProofVersionId: null });
  sync.mockResolvedValue({ status: "draft_created", proofVersionId: "successor" });
  eligibility.mockResolvedValue([{ projection: { fulfilledQuantity: 0, administrativelyReconciledQuantity: 0 } }]);
  transition.mockImplementation(async (_tx: any, args: any) => ({ toState: args.toState, activeOwnerJobId: args.toState === "needs_design" ? "design" : "prepress", activeOwnerStationKey: args.toState === "needs_design" ? "design" : "prepress", activeOwnerStepKey: args.toState === "needs_design" ? "design" : "prepress" }));
});
describe("canonical Return Upstream", () => {
  test.each(["design", "proofing"] as const)("Prepress -> %s succeeds with tenant locks, audit and preserved work", async (destination) => {
    const f = setup(); const result = await returnUpstreamInTransaction(f.tx, { ...input, destination });
    expect(result.destination).toBe(destination);
    expect(f.reads[1].locked).toBe(true); expect(f.reads[2].locked).toBe(true); expect(f.reads[3].locked).toBe(true);
    for (const read of f.reads) expect(f.predicate(read.where).params).toContain("tenant");
    const audit = f.writes.find(w => w.table === auditLogs)!.value;
    expect(audit).toMatchObject({ organizationId: "tenant", userId: "actor", oldValues: { ownerJobId: "prepress", priorWork: expect.arrayContaining([expect.objectContaining({ id: "old-design", totalSeconds: 90 })]) }, newValues: { sourceStage: "prepress", destination, reason: "Correct artwork", expectedState: expect.objectContaining({ expectedUpdatedAt: input.expectedUpdatedAt }) } });
    expect(f.writes.filter(w => w.table === productionJobs)).toHaveLength(0);
    expect(sync).toHaveBeenCalledTimes(destination === "proofing" ? 1 : 0);
  });
  test.each(["", "   ", "x".repeat(2001)])("requires a bounded nonblank reason", async reason => {
    const f = setup(); await expect(returnUpstreamInTransaction(f.tx, { ...input, reason })).rejects.toThrow(); expect(f.reads).toHaveLength(0);
  });
  test("rejects arbitrary destinations and missing concurrency fields", () => {
    const { organizationId, actorUserId, lineItemId, ...body } = input;
    expect(returnUpstreamRequestSchema.safeParse({ ...body, destination: "production" }).success).toBe(false);
    expect(returnUpstreamRequestSchema.safeParse({ ...body, expectedOwnerJobId: undefined }).success).toBe(false);
  });
  test.each(["member", "manager", "superadmin", "customer"])("denies %s", async role => {
    const f = setup({ role }); await expect(returnUpstreamInTransaction(f.tx, input)).rejects.toMatchObject({ statusCode: 403 }); expect(retire).not.toHaveBeenCalled();
  });
  test("allows Owner", async () => { await expect(returnUpstreamInTransaction(setup({ role: "owner" }).tx, input)).resolves.toBeDefined(); });
  test("cross-tenant line is unavailable before mutation", async () => {
    const f = setup({ missing: true }); await expect(returnUpstreamInTransaction(f.tx, input)).rejects.toMatchObject({ statusCode: 404 }); expect(f.writes).toHaveLength(0);
  });
  test.each([{ workflowState: "ready_for_prepress" }, { updatedAt: new Date("2026-09-29") }])("rejects stale line %j", async changed => {
    await expect(returnUpstreamInTransaction(setup({ line: changed }).tx, input)).rejects.toMatchObject({ code: "UPSTREAM_STALE_STATE" }); expect(retire).not.toHaveBeenCalled();
  });
  test("rejects changed owner identity", async () => {
    await expect(returnUpstreamInTransaction(setup({ jobs: [{ ...job, id: "new-owner" }] }).tx, input)).rejects.toMatchObject({ code: "UPSTREAM_STALE_STATE" });
  });
  test.each(["in_design", "in_production", "completed", "awaiting_proof_approval"])("rejects origin %s", async workflowState => {
    await expect(returnUpstreamInTransaction(setup({ line: { workflowState } }).tx, input)).rejects.toMatchObject({ code: "UPSTREAM_INVALID_ORIGIN" });
  });
  test.each([{ jobs: [] }, { jobs: [{ ...job, stationKey: "roll", stepKey: "print" }] }, { jobs: [job, { id: "roll", status: "in_progress", stationKey: "roll" }] }])("rejects incompatible ownership %j", async ({ jobs }) => {
    await expect(returnUpstreamInTransaction(setup({ jobs }).tx, input)).rejects.toMatchObject({ code: "UPSTREAM_PRODUCTION_CONFLICT" });
  });
  test("rejects active run without cancellation", async () => {
    const f = setup({ runs: [{ id: "run" }] }); await expect(returnUpstreamInTransaction(f.tx, input)).rejects.toMatchObject({ code: "UPSTREAM_ACTIVE_RUN" }); expect(f.writes).toHaveLength(0);
  });
  test.each(["fulfilledQuantity", "administrativelyReconciledQuantity"])("rejects positive %s", async field => {
    eligibility.mockResolvedValue([{ projection: { fulfilledQuantity: 0, administrativelyReconciledQuantity: 0, [field]: 1 } }]);
    await expect(returnUpstreamInTransaction(setup().tx, input)).rejects.toMatchObject({ code: "UPSTREAM_FULFILLMENT_BOUNDARY" }); expect(retire).not.toHaveBeenCalled();
  });
  test("missing fulfillment projection fails closed", async () => {
    eligibility.mockResolvedValue([]); await expect(returnUpstreamInTransaction(setup().tx, input)).rejects.toMatchObject({ code: "UPSTREAM_FULFILLMENT_BOUNDARY" });
  });
  test("explicit proof bypass must be resolved first", async () => {
    await expect(returnUpstreamInTransaction(setup({ order: { proofApprovalPolicyOverride: "bypass" } }).tx, input)).rejects.toMatchObject({ code: "UPSTREAM_PROOF_BYPASS" });
  });
  test("force-required Order policy carries through Design completion", async () => {
    const f = setup({ order: { proofApprovalPolicyOverride: "force_required" }, line: { requiresProofApproval: false } });
    await returnUpstreamInTransaction(f.tx, input);
    expect(f.writes).toContainEqual(expect.objectContaining({ table: orderLineItems, value: { requiresProofApproval: true } }));
  });
  test("resumes existing sent proof without duplicate creation", async () => {
    retire.mockResolvedValue({ resumedProofVersionId: "sent" }); await returnUpstreamInTransaction(setup().tx, { ...input, destination: "proofing" }); expect(sync).not.toHaveBeenCalled();
  });
  test("missing artwork still activates canonical first Proofing work", async () => {
    sync.mockResolvedValue({ status: "no_source" }); const result = await returnUpstreamInTransaction(setup().tx, { ...input, destination: "proofing" });
    expect(result.transition.toState).toBe("awaiting_proof_approval"); expect(result.proofSync).toEqual({ status: "no_source" });
  });
  test("transaction abort propagates and rolls back writes on ownership failure", async () => {
    const f = setup(); transaction.mockImplementation(f.transaction);
    transition.mockImplementation(async (tx: any) => { await tx.update(orderLineItems).set({ workflowState: "needs_design" }); throw new Error("ownership failure"); });
    await expect(returnUpstream(input)).rejects.toThrow("ownership failure"); expect(f.writes).toHaveLength(0); expect(transaction).toHaveBeenCalledTimes(1);
  });
});
