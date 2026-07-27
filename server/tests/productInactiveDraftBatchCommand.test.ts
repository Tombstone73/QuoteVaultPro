import { describe, expect, test } from "@jest/globals";
import { createProductInactiveDraftBatchCanonicalService } from "../services/assistant/execution/productInactiveDraftBatchExecutionCommand";
import { productInactiveDraftBatchCommandInputSchema } from "../services/assistant/execution/productInactiveDraftBatchCommand";

const child = (rowNumber: number) => ({ rowNumber, productName: `Product ${rowNumber}`, intakeSessionId: `session_${rowNumber}`, proposalFingerprint: `${rowNumber}`.repeat(64).slice(0, 64) });

describe("inactive product draft batch command", () => {
  test("rejects duplicate row identities before a plan can be created", () => {
    expect(() => productInactiveDraftBatchCommandInputSchema.parse({ batchFingerprint: "a".repeat(64), children: [child(1), child(1)] })).toThrow("unique");
  });

  test("uses unique child plan and idempotency keys while delegating every row to the canonical single-draft service", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const single: any = {
      async createInactiveDraft(input: Record<string, unknown>) { calls.push(input); return { product: { id: `product_${calls.length}`, name: String(input.intakeSessionId), active: false, sourceLink: "/products/1" }, intakeSession: { id: "session", status: "draft_created", sourceLink: "/admin/product-intake/sessions/1/review" }, pbv2DraftTreeVersionId: `tree_${calls.length}` }; },
      async revalidateProposal() { return { valid: true }; },
      async buildProposal() { throw new Error("not used"); },
    };
    const readiness = { async reviewDraft() { return { status: "needs_review" }; } } as any;
    const service = createProductInactiveDraftBatchCanonicalService(single, readiness);
    const result = await service.createInactiveDraftBatch({ organizationId: "org", actorUserId: "user", assistantPlanId: "plan", idempotencyKey: "key", correlationId: "correlation", batchFingerprint: "a".repeat(64), children: [child(1), child(2)] });
    expect(result.children).toHaveLength(2);
    expect(calls.map((call) => call.assistantPlanId)).toEqual(["plan:row:1", "plan:row:2"]);
    expect(calls.map((call) => call.idempotencyKey)).toEqual(["key:row:1", "key:row:2"]);
    expect(result.children.map((child) => child.readinessStatus)).toEqual(["needs_review", "needs_review"]);
  });
});
