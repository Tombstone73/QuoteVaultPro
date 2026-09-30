import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { scriptedWorkflowTx } from "./helpers/scriptedWorkflowTx";
const active = jest.fn<any>(); const all = jest.fn<any>(); const move = jest.fn<any>(); const append = jest.fn<any>();
jest.unstable_mockModule("../services/productionOwnership", () => ({ findActiveJobForLineItem: active, findAllActiveJobsForLineItem: all, transitionToStation: move, completeActiveJob: jest.fn() }));
jest.unstable_mockModule("../services/productionRoutingService", () => ({ routeLineItemToProduction: jest.fn() }));
jest.unstable_mockModule("../services/productionRoutingResolver", () => ({ resolvePostPrepressProductionRoute: jest.fn() }));
jest.unstable_mockModule("../services/orderWorkflowSyncService", () => ({ syncParentOrderForOperationalChildren: jest.fn<any>().mockResolvedValue({}) }));
jest.unstable_mockModule("../services/orderCreditHoldService", () => ({ isPhysicalProductionDestination: () => true, assertProductionCredit: jest.fn<any>().mockResolvedValue(undefined), getOrderCreditHold: jest.fn<any>().mockResolvedValue({ creditHold: { held: false } }) }));
jest.unstable_mockModule("../productionHelpers", () => ({ appendEvent: append }));
const { completeLineItemDesign, transitionLineItemWorkflowState } = await import("../services/lineItemWorkflowService");
const line = { id: "line", orderId: "order", organizationId: "tenant", workflowState: "in_design", designStatus: "in_design", status: "new", requiresDesign: true, requiresPrepress: true, requiresProofApproval: true, approvedProofVersionId: null };
beforeEach(() => {
  jest.clearAllMocks(); active.mockResolvedValue({ id: "design", stationKey: "design", stepKey: "design" });
  all.mockResolvedValue([{ id: "prepress", stationKey: "prepress", stepKey: "prepress" }]);
  move.mockResolvedValue({ createdJobId: "prepress", newStationKey: "prepress", newStepKey: "prepress" });
});
test.each([true, false])("Design completion respects Requires Proofing=%s and preserves event history", async requiresProofApproval => {
  const f = scriptedWorkflowTx([[{ id: "line" }], [{ ...line, requiresProofApproval }], [{ id: "line" }], [{ ...line, requiresProofApproval, designStatus: "design_complete" }]]);
  const result = await completeLineItemDesign(f.tx, { organizationId: "tenant", lineItemId: "line", actorUserId: "actor" });
  expect(result.toState).toBe(requiresProofApproval ? "awaiting_proof_approval" : "ready_for_prepress");
  expect(append).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ eventType: "workflow_transition", actorUserId: "actor" }) }));
  expect(f.writes.some(w => w.kind === "delete")).toBe(false);
});
test("reopened Design cannot be completed before starting", async () => {
  const f = scriptedWorkflowTx([[{ id: "line" }], [{ ...line, workflowState: "needs_design", designStatus: "needs_design" }]]);
  await expect(completeLineItemDesign(f.tx, { organizationId: "tenant", lineItemId: "line" })).rejects.toThrow("must be started"); expect(f.writes).toHaveLength(0);
});
test("Design reopening blocks direct production even if historical approval exists", async () => {
  const f = scriptedWorkflowTx([[{ id: "line" }], [{ ...line, approvedProofVersionId: "old" }]]);
  await expect(transitionLineItemWorkflowState(f.tx, { organizationId: "tenant", lineItemId: "line", toState: "ready_for_production" })).rejects.toThrow("Design must be completed"); expect(f.writes).toHaveLength(0);
});
test("after Design completion a missing current approval blocks production", async () => {
  const f = scriptedWorkflowTx([[{ id: "line" }], [{ ...line, workflowState: "awaiting_proof_approval", designStatus: "design_complete" }], [{ ...line, policyOverride: "inherit_default" }]]);
  await expect(transitionLineItemWorkflowState(f.tx, { organizationId: "tenant", lineItemId: "line", toState: "ready_for_production" })).rejects.toMatchObject({ code: "PROOF_APPROVAL_REQUIRED" }); expect(move).not.toHaveBeenCalled();
});
test("existing Design completion route synchronizes required proof in its transaction", () => {
  const source = readFileSync("server/routes/design.routes.ts", "utf8");
  const completion = source.slice(source.indexOf('"/api/design/line-item/:lineItemId/complete"'));
  expect(completion).toContain("await completeLineItemDesign(tx");
  expect(completion).toContain('completed.toState === "awaiting_proof_approval"');
  expect(completion).toContain("await autoSyncCanonicalProofForLineItem(tx");
  expect(completion).toContain('reason: "design_completed"');
});
