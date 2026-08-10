import { describe, expect, test } from "@jest/globals";
import { InactivePbv2QuantityTierEditService, exactInactiveDraftTierEditorLink, type InactivePbv2QuantityTierEditStore, type InactivePbv2QuantityTierProposal, type InactivePbv2QuantityTierSourceSnapshot } from "../services/assistant/inactivePbv2QuantityTierEditService";
import { createInactivePbv2QuantityTierEditExecutionCommand } from "../services/assistant/execution/inactivePbv2QuantityTierEditExecutionCommand";

const proposalId = "11111111-1111-4111-8111-111111111111";
const scope = { organizationId: "org_1", userId: "user_1", permissions: ["assistant.products.replace_inactive_quantity_tiers"], environment: "test" } as const;
const source = (): InactivePbv2QuantityTierSourceSnapshot => ({ organizationId: "org_1", product: { id: "product_1", name: "Vinyl", isActive: false, pbv2ActiveTreeVersionId: null }, pbv2Tree: { id: "tree_1", productId: "product_1", status: "DRAFT", schemaVersion: 2, updatedAt: "2026-07-31T12:00:00.000Z", treeJson: { meta: { pricingV2: { qtyTiers: [{ id: "tier_1", minQty: 1, perSqftCents: 450 }] } } } } });
const replacement = { tierType: "qtyTiers" as const, tiers: [{ id: "tier_1", minQty: 1, perSqftCents: 400 }, { id: "tier_10", minQty: 10, perSqftCents: 350 }] };

class Store implements InactivePbv2QuantityTierEditStore {
  current = source(); proposal: InactivePbv2QuantityTierProposal | null = null;
  async loadSource() { return structuredClone(this.current); }
  async createProposal(input: Omit<InactivePbv2QuantityTierProposal, "id">) { this.proposal = { ...structuredClone(input), id: proposalId }; return structuredClone(this.proposal); }
  async getProposal() { return structuredClone(this.proposal); }
  async executeTierReplacementIdempotently(input: Parameters<InactivePbv2QuantityTierEditStore["executeTierReplacementIdempotently"]>[0]) {
    const reused = this.proposal?.status === "succeeded";
    if (this.proposal) this.proposal.status = "succeeded";
    return { productId: "product_1", pbv2TreeVersionId: "tree_1", inactive: true as const, pbv2Status: "DRAFT" as const, editorLink: exactInactiveDraftTierEditorLink("product_1", "tree_1"), reused };
  }
}

describe("inactive PBV2 quantity-tier execution command", () => {
  test("uses a fingerprint-bound plan and returns the exact inactive DRAFT link", async () => {
    const store = new Store(); const proposal = await new InactivePbv2QuantityTierEditService(store).prepareProposal({ organizationId: "org_1", actorUserId: "user_1", productId: "product_1", pbv2TreeVersionId: "tree_1", replacement });
    const command = createInactivePbv2QuantityTierEditExecutionCommand(store);
    const built = await command.buildPreview({ scope, context: {} as any, arguments: { proposalId, proposalFingerprint: proposal.fingerprint } });
    expect((built.preview as any).inactivePbv2TierEdit).toMatchObject({ proposalId, proposalFingerprint: proposal.fingerprint, preview: { after: { tierType: "qtyTiers" } } });
    const result = await command.execute({ scope, plan: { id: "plan_1", idempotencyKey: "idempotency_1", correlationId: "corr_1", sanitizedArguments: built.arguments } as any });
    expect(result.details).toEqual({ inactivePbv2TierEdit: { productId: "product_1", pbv2TreeVersionId: "tree_1", editorLink: "/products/product_1/edit?draftTreeVersionId=tree_1", reused: false } });
  });

  test("fails revalidation after the exact DRAFT snapshot changes", async () => {
    const store = new Store(); const proposal = await new InactivePbv2QuantityTierEditService(store).prepareProposal({ organizationId: "org_1", actorUserId: "user_1", productId: "product_1", pbv2TreeVersionId: "tree_1", replacement });
    store.current.pbv2Tree.updatedAt = "2026-07-31T12:01:00.000Z";
    const command = createInactivePbv2QuantityTierEditExecutionCommand(store);
    await expect(command.revalidate({ scope, plan: { sanitizedArguments: { proposalId, proposalFingerprint: proposal.fingerprint } } as any })).resolves.toMatchObject({ valid: false, code: "PBV2_TIER_SOURCE_STALE" });
  });
});
