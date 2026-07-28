import { describe, expect, test } from "@jest/globals";
import { createProductInactiveDraftBulkUpdateCanonicalService } from "../services/assistant/execution/productInactiveDraftBulkUpdateExecutionCommand";

describe("inactive draft bulk-update execution", () => {
  test("uses persisted rows, continues after an independent failure, and records durable outcomes", async () => {
    const rows: any[] = [
      { id: "r1", sourceOrder: 1, sessionId: "s1", productId: "p1", productName: "One", beforeFingerprint: "a".repeat(64), patch: { basePricing: { minimumChargeCents: 100 } }, idempotencyKey: "row-1", executionState: "pending" },
      { id: "r2", sourceOrder: 2, sessionId: "s2", productId: "p2", productName: "Two", beforeFingerprint: "b".repeat(64), patch: { basePricing: { minimumChargeCents: 100 } }, idempotencyKey: "row-2", executionState: "pending" },
    ];
    const history: any = {
      getDetail: async () => ({ proposal: { fingerprint: "c".repeat(64) }, rows }),
      markRowRunning: async ({ rowId }: any) => { rows.find((row) => row.id === rowId).executionState = "running"; },
      markRowSuccess: async ({ rowId }: any) => { rows.find((row) => row.id === rowId).executionState = "updated"; },
      markRowFailure: async ({ rowId, state, code }: any) => { Object.assign(rows.find((row) => row.id === rowId), { executionState: state, lastErrorCode: code }); },
      bindConfirmation: async () => {}, complete: async () => {},
    };
    const single: any = {
      revalidateProposal: async ({ sessionId }: any) => sessionId === "s1" ? { valid: true } : { valid: false, code: "INACTIVE_DRAFT_STALE", summary: "Changed" },
      updateInactiveDraft: async () => ({ product: { id: "p1", name: "One", active: false }, productIntakeSession: { id: "s1" }, pbv2DraftTreeVersionId: "tree", readiness: "not_ready" }),
    };
    const service = createProductInactiveDraftBulkUpdateCanonicalService(single, history);
    const result = await service.updateInactiveDraftBatch({ organizationId: "org", actorUserId: "user", assistantPlanId: "plan", idempotencyKey: "key", correlationId: "corr", bulkUpdateId: "bulk", bulkFingerprint: "c".repeat(64) });
    expect(result).toEqual({ updated: 1, noChange: 0, failures: 0, stale: 1, pending: 0 });
    expect(rows.map((row) => row.executionState)).toEqual(["updated", "stale"]);
  });

  test("rejects a replacement bulk fingerprint before a child can mutate", async () => {
    let invoked = false;
    const history: any = { getDetail: async () => ({ proposal: { fingerprint: "a".repeat(64) }, rows: [] }) };
    const service = createProductInactiveDraftBulkUpdateCanonicalService({ revalidateProposal: async () => ({ valid: true }), updateInactiveDraft: async () => { invoked = true; throw new Error("should not run"); } } as any, history);
    await expect(service.updateInactiveDraftBatch({ organizationId: "org", actorUserId: "user", assistantPlanId: "plan", idempotencyKey: "key", correlationId: "corr", bulkUpdateId: "bulk", bulkFingerprint: "b".repeat(64) })).rejects.toMatchObject({ code: "BULK_PROPOSAL_CHANGED" });
    expect(invoked).toBe(false);
  });
});
