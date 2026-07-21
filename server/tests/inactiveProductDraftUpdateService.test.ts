import { InactiveProductDraftUpdateService } from "../services/assistant/inactiveProductDraftUpdateService";
import { jest } from "@jest/globals";

function review(overrides: Record<string, unknown> = {}) {
  return {
    intake: { sessionId: "session-1", status: "draft_created" },
    product: { id: "product-1", name: "Banner Draft", isActive: false, pbv2ActiveTreeVersionId: null },
    pbv2Tree: { id: "tree-1", status: "DRAFT", updatedAt: "2026-07-21T00:00:00.000Z", basePricing: { perSqftCents: 85, perPieceCents: null, minimumChargeCents: 1_000 } },
    publishReadiness: { validationStatus: "warnings", findings: [{ code: "PRICE_WARNING", severity: "WARNING", message: "Review base pricing.", path: "tree.meta.pricingV2" }] },
    ...overrides,
  } as any;
}

describe("InactiveProductDraftUpdateService", () => {
  it("rejects active products and non-DRAFT PBV2 trees before proposing a patch", async () => {
    const active = new InactiveProductDraftUpdateService({ getDraftReview: async () => review({ product: { id: "product-1", name: "Banner", isActive: true, pbv2ActiveTreeVersionId: null } }) } as any);
    await expect(active.loadSnapshot({ organizationId: "org-a", sessionId: "session-1" })).rejects.toMatchObject({ code: "INACTIVE_DRAFT_REQUIRED" });
    const archived = new InactiveProductDraftUpdateService({ getDraftReview: async () => review({ pbv2Tree: { ...review().pbv2Tree, status: "ARCHIVED" } }) } as any);
    await expect(archived.loadSnapshot({ organizationId: "org-a", sessionId: "session-1" })).rejects.toMatchObject({ code: "INACTIVE_DRAFT_REQUIRED" });
  });

  it("uses the canonical pricing editor with a PBV2 updated-at guard and returns fresh readiness", async () => {
    let current = review();
    const updateDraftPricing = jest.fn(async (input) => {
      expect(input).toMatchObject({ organizationId: "org-a", sessionId: "session-1", base: { minimumChargeCents: 1500 }, expectedDraftUpdatedAt: "2026-07-21T00:00:00.000Z" });
      current = review({ pbv2Tree: { ...current.pbv2Tree, updatedAt: "2026-07-21T00:01:00.000Z", basePricing: { ...current.pbv2Tree.basePricing, minimumChargeCents: 1500 } } });
      return current;
    });
    const service = new InactiveProductDraftUpdateService({ getDraftReview: async () => current, updateDraftPricing } as any);
    const proposed = await service.buildProposal({ organizationId: "org-a", sessionId: "session-1", patch: { basePricing: { minimumChargeCents: 1500 } } });
    const updated = await service.updateInactiveProductDraft({ organizationId: "org-a", sessionId: "session-1", patch: { basePricing: { minimumChargeCents: 1500 } }, expectedFingerprint: proposed.fingerprint, userId: "user-1" });
    expect(updateDraftPricing).toHaveBeenCalledTimes(1);
    expect(updated).toMatchObject({ productIsActive: false, pbv2Status: "DRAFT", pricingBase: { minimumChargeCents: 1500 } });
  });

  it("invalidates a proposal when the draft fingerprint changes", async () => {
    let current = review();
    const service = new InactiveProductDraftUpdateService({ getDraftReview: async () => current } as any);
    const proposal = await service.buildProposal({ organizationId: "org-a", sessionId: "session-1", patch: { basePricing: { perSqftCents: 90 } } });
    current = review({ pbv2Tree: { ...current.pbv2Tree, updatedAt: "2026-07-21T00:02:00.000Z" } });
    await expect(service.revalidateProposal({ organizationId: "org-a", sessionId: "session-1", patch: { basePricing: { perSqftCents: 90 } }, expectedFingerprint: proposal.fingerprint })).resolves.toMatchObject({ valid: false, code: "INACTIVE_DRAFT_STALE" });
  });
});
