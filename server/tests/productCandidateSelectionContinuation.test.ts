import { describe, expect, test } from "@jest/globals";
import { ProductCandidateSelectionContinuationError, ProductCandidateSelectionContinuationService, type ProductCandidateSelectionContinuation, type ProductCandidateSelectionContinuationStore } from "../services/assistant/productCandidateSelectionContinuation";

const candidate = { candidateId: "p_1:t_1", productId: "p_1", productName: "Banner", isActive: false, pricingMode: "area", productUpdatedAt: "2026-01-01T00:00:00.000Z", pbv2TreeVersionId: "t_1", pbv2TreeStatus: "DRAFT" as const, pbv2TreeUpdatedAt: "2026-01-01T00:00:00.000Z", selectable: true, blockingReason: null };
function store(): ProductCandidateSelectionContinuationStore & { value: ProductCandidateSelectionContinuation | null } {
  return { value: null, async get() { return this.value; }, async save(input) { this.value = { ...input, id: input.id ?? "continuation_1" } as ProductCandidateSelectionContinuation; return this.value; } };
}
describe("product candidate selection continuation", () => {
  test("retains normalized changes and only resolves an included, revalidated candidate", async () => {
    const memory = store(); const service = new ProductCandidateSelectionContinuationService(memory);
    await service.begin({ organizationId: "org_1", actorUserId: "user_1", conversationId: "conversation_1", operation: "replace_inactive_matrix", originalMessage: "replace banner", requestedChanges: { matrix: { cells: [1] } }, candidates: [candidate, { ...candidate, candidateId: "p_2:t_2", productId: "p_2", pbv2TreeVersionId: "t_2" }] });
    const selected = await service.select({ organizationId: "org_1", actorUserId: "user_1", conversationId: "conversation_1", candidateId: "p_1:t_1", revalidate: async (item) => item.productId === "p_1" });
    expect(selected.requestedChanges).toEqual({ matrix: { cells: [1] } }); expect(selected.selectedCandidateId).toBe("p_1:t_1");
  });
  test("rejects cross-candidate selection, stale candidates, expiry, and repeated selection without a result", async () => {
    const memory = store(); let now = new Date("2026-01-01T00:00:00.000Z"); const service = new ProductCandidateSelectionContinuationService(memory, () => now);
    await service.begin({ organizationId: "org_1", actorUserId: "user_1", conversationId: "conversation_1", operation: "clone_inactive_product_draft", originalMessage: "clone", requestedChanges: { newName: "Economy" }, candidates: [candidate, { ...candidate, candidateId: "p_2:t_1", productId: "p_2" }], expiresInMs: 10 });
    await expect(service.select({ organizationId: "org_1", actorUserId: "user_1", conversationId: "conversation_1", candidateId: "foreign", revalidate: async () => true })).rejects.toMatchObject({ code: "CANDIDATE_NOT_IN_CONTINUATION" });
    await expect(service.select({ organizationId: "org_1", actorUserId: "user_1", conversationId: "conversation_1", candidateId: "p_1:t_1", revalidate: async () => false })).rejects.toMatchObject({ code: "CANDIDATE_STALE" });
    now = new Date("2026-01-01T00:00:01.000Z");
    await expect(service.select({ organizationId: "org_1", actorUserId: "user_1", conversationId: "conversation_1", candidateId: "p_1:t_1", revalidate: async () => true })).rejects.toBeInstanceOf(ProductCandidateSelectionContinuationError);
  });
});
