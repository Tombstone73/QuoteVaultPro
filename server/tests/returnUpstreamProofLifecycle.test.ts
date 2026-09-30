import { describe, expect, test } from "@jest/globals";
import { lineItemProofVersions, lineItemProofApprovals, orderLineItems, orderAuditLog } from "@shared/schema";
import { retireProofAuthorityForUpstream, recordProofResponse, markProofVersionSent, hasCurrentProofForFile, createLineItemProofVersion, recordManualProofApprovalOverride } from "../services/proofingService";
import { resolveLineItemProofReleaseGate, assertPhysicalProductionProofGate } from "../services/proofGateService";
import { scriptedWorkflowTx } from "./helpers/scriptedWorkflowTx";

const input = { organizationId: "tenant", orderId: "order", lineItemId: "line", actorUserId: "actor", reason: "Obsolete artwork", destination: "design" as const };
const line = { lineItemId: "line", orderId: "order", requiresProofApproval: true, requiresPrepress: true, workflowState: "in_prepress", approvedProofVersionId: null };
const proof = { id: "old", lineItemId: "line", orderId: "order", versionNumber: 4, proofFileId: "same-artwork", sentAt: new Date("2026-09-01"), status: "draft" };

describe("upstream proof authority", () => {
  test("no prior proof: clears only current pointer and creates no fake proof/history", async () => {
    const f = scriptedWorkflowTx([[line], [], [], []]);
    const result = await retireProofAuthorityForUpstream(f.tx, input);
    expect(result.priorProofs).toEqual([]); expect(f.writes).toHaveLength(1); expect(f.writes[0].table).toBe(orderLineItems);
  });
  test.each(["draft", "awaiting_response"])("%s becomes superseded while sent history remains untouched", async status => {
    const old = { ...proof, status }; const snapshot = structuredClone(old);
    const f = scriptedWorkflowTx([[line], [{ version: old }], [], [old]]);
    const result = await retireProofAuthorityForUpstream(f.tx, input);
    expect(old).toEqual(snapshot); expect(result.supersededProofVersionIds).toEqual(["old"]);
    const update = f.writes.find(w => w.table === lineItemProofVersions)!;
    expect(Object.keys(update.value).sort()).toEqual(["status", "updatedAt"]); expect(update.value.status).toBe("superseded");
    expect(f.predicate(update.where).params).toEqual(expect.arrayContaining(["tenant", "line", "draft", "awaiting_response"]));
    expect(f.writes.find(w => w.table === orderAuditLog)?.value).toMatchObject({ actionType: "proof_superseded", userId: "actor", fromStatus: status, note: "Obsolete artwork" });
  });
  test("historical approved version and approval actor/timestamp are never modified", async () => {
    const old = { ...proof, status: "approved" };
    const f = scriptedWorkflowTx([[{ ...line, approvedProofVersionId: "old" }], [{ version: old }], [], []]);
    const result = await retireProofAuthorityForUpstream(f.tx, input);
    expect(result.priorApprovedProofVersionId).toBe("old"); expect(result.priorProofs[0].status).toBe("approved");
    expect(f.writes.some(w => w.table === lineItemProofVersions || w.table === lineItemProofApprovals)).toBe(false);
    expect(f.writes[0].value.approvedProofVersionId).toBeNull();
  });
  test.each(["draft", "awaiting_response"])("Proofing resumes %s without superseding or inserting", async status => {
    const f = scriptedWorkflowTx([[line], [{ version: { ...proof, status } }], []]);
    const result = await retireProofAuthorityForUpstream(f.tx, { ...input, destination: "proofing" });
    expect(result.resumedProofVersionId).toBe("old"); expect(f.writes).toHaveLength(1); expect(f.writes[0].table).toBe(orderLineItems);
  });
  test("shared actionable proof fails without partial mutation", async () => {
    const f = scriptedWorkflowTx([[line], [{ version: proof }], [{ proofVersionId: "old", lineItemId: "line" }, { proofVersionId: "old", lineItemId: "other" }]]);
    await expect(retireProofAuthorityForUpstream(f.tx, input)).rejects.toMatchObject({ code: "UPSTREAM_SHARED_PROOF" }); expect(f.writes).toHaveLength(0);
  });
  test("non-primary combined-proof member cannot escape the shared-proof guard", async () => {
    const f = scriptedWorkflowTx([[line], [{ version: { ...proof, lineItemId: "other" } }], [{ proofVersionId: "old", lineItemId: "line" }]]);
    await expect(retireProofAuthorityForUpstream(f.tx, input)).rejects.toMatchObject({ code: "UPSTREAM_SHARED_PROOF" });
  });
  test.each(["record", "send"])("obsolete customer proof cannot %s after acquiring the workflow lock", async action => {
    const f = scriptedWorkflowTx([
      [{ lineItemId: "line" }], [], [{ id: "line" }], // lock version's workflow before rereading status
      [{ ...proof, status: "superseded" }],
      ...(action === "send" ? [[], [line]] : []),
    ]);
    const result = action === "record"
      ? recordProofResponse(f.tx, { organizationId: "tenant", proofVersionId: "old", responderSource: "customer", decision: "approved" })
      : markProofVersionSent(f.tx, { organizationId: "tenant", proofVersionId: "old", actorUserId: "actor" });
    await expect(result).rejects.toMatchObject({ statusCode: 409 }); expect(f.writes).toHaveLength(0);
    expect(f.reads[2].locked).toBe(true); expect(f.reads[3].table).toBe(lineItemProofVersions);
  });
  test.each(["approved", "superseded"])("same artwork on historical %s proof does not qualify as current", status => {
    const history: any = [{ ...proof, status }];
    expect(hasCurrentProofForFile({ proofVersionHistory: history, currentActionableProofVersionId: null, approvedProofVersionId: null }, "same-artwork")).toBe(false);
    // Ordinary synchronization still reuses current authority when nothing invalidated it.
    expect(hasCurrentProofForFile({ proofVersionHistory: history, currentActionableProofVersionId: null, approvedProofVersionId: "old" }, "same-artwork")).toBe(true);
  });
  test.each([1, 5])("canonical version creation emits numbered draft %i, even with the same artwork", async versionNumber => {
    const f = scriptedWorkflowTx([
      [{ id: "line" }], [line], [{ id: "same-artwork", orderId: "order", orderLineItemId: "line", role: "proof" }], [], [], [{ nextVersionNumber: versionNumber }],
    ]);
    const created = await createLineItemProofVersion(f.tx, { organizationId: "tenant", lineItemId: "line", proofFileId: "same-artwork", createdByUserId: "actor" });
    expect(created).toMatchObject({ status: "draft", versionNumber, proofFileId: "same-artwork" });
    expect(f.writes.filter(w => w.table === lineItemProofVersions && w.kind === "insert")).toHaveLength(1);
    expect(f.writes.some(w => w.table === lineItemProofApprovals)).toBe(false);
  });
  test("retiring current pointer blocks production until successor approval", async () => {
    for (const approvedProofVersionId of ["old", null, "successor"]) {
      const f = scriptedWorkflowTx([[{ ...line, approvedProofVersionId, policyOverride: "inherit_default" }]]);
      const gate = await resolveLineItemProofReleaseGate(f.tx, { organizationId: "tenant", lineItemId: "line" });
      expect(gate.allowed).toBe(approvedProofVersionId !== null);
    }
  });
  test("non-proof-required work needs no manufactured approval", async () => {
    const f = scriptedWorkflowTx([[{ ...line, requiresProofApproval: false, policyOverride: "inherit_default" }]]);
    expect((await resolveLineItemProofReleaseGate(f.tx, input)).allowed).toBe(true); expect(f.writes).toHaveLength(0);
  });
  test("manual override cannot revive a proof retired by upstream return", async () => {
    const f = scriptedWorkflowTx([[{ id: "line" }], [line], [{ ...proof, status: "superseded" }], [{ ...line, policyOverride: "inherit_default" }], [{ ...proof, status: "superseded" }], [{ id: "return-audit" }]]);
    await expect(recordManualProofApprovalOverride(f.tx, { organizationId: "tenant", lineItemId: "line", actorUserId: "actor", proofVersionId: "old", overrideReason: "Override" })).rejects.toThrow("retired by Return Upstream");
    expect(f.writes).toHaveLength(0);
  });
  test.each(["roll", "flatbed"])("direct %s routing also blocks retired approval", async stationKey => {
    const f = scriptedWorkflowTx([[{ id: "line" }], [{ workflowState: "awaiting_proof_approval", designStatus: "design_complete" }], [{ ...line, policyOverride: "inherit_default" }]]);
    await expect(assertPhysicalProductionProofGate(f.tx, { ...input, stationKey, stepKey: "print" })).rejects.toMatchObject({ code: "PROOF_APPROVAL_REQUIRED" });
  });
  test("direct production routing cannot escape reopened Design", async () => {
    const f = scriptedWorkflowTx([[{ id: "line" }], [{ workflowState: "needs_design", designStatus: "needs_design" }]]);
    await expect(assertPhysicalProductionProofGate(f.tx, { ...input, stationKey: "roll", stepKey: "print" })).rejects.toMatchObject({ code: "DESIGN_COMPLETION_REQUIRED" });
  });
  test.each(["design", "prepress", "fulfillment"])("%s ownership keeps existing routing semantics", async stationKey => {
    const f = scriptedWorkflowTx([]);
    await expect(assertPhysicalProductionProofGate(f.tx, { ...input, stationKey, stepKey: stationKey })).resolves.toBeUndefined(); expect(f.reads).toHaveLength(0);
  });
  test("current successor approval allows normal physical routing", async () => {
    const f = scriptedWorkflowTx([[{ id: "line" }], [{ workflowState: "ready_for_prepress", designStatus: "design_complete" }], [{ ...line, approvedProofVersionId: "successor", policyOverride: "inherit_default" }]]);
    await expect(assertPhysicalProductionProofGate(f.tx, { ...input, stationKey: "flatbed", stepKey: "print" })).resolves.toBeUndefined();
  });
  test("explicit Design completion takes precedence during the forward transition", async () => {
    const f = scriptedWorkflowTx([[{ id: "line" }], [{ workflowState: "in_design", designStatus: "design_complete" }], [{ ...line, requiresProofApproval: false, policyOverride: "inherit_default" }]]);
    await expect(assertPhysicalProductionProofGate(f.tx, { ...input, stationKey: "roll", stepKey: "print" })).resolves.toBeUndefined();
  });
});
