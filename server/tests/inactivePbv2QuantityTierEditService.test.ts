import { describe, expect, test } from "@jest/globals";
import {
  InactivePbv2QuantityTierEditService,
  exactInactiveDraftTierEditorLink,
  inactivePbv2QuantityTierEditAction,
  type InactivePbv2QuantityTierEditStore,
  type InactivePbv2QuantityTierProposal,
  type InactivePbv2QuantityTierSourceSnapshot,
} from "../services/assistant/inactivePbv2QuantityTierEditService";

function source(): InactivePbv2QuantityTierSourceSnapshot {
  return { organizationId: "org_1", product: { id: "product_1", name: "Vinyl", isActive: false, pbv2ActiveTreeVersionId: null }, pbv2Tree: { id: "tree_1", productId: "product_1", status: "DRAFT", schemaVersion: 2, updatedAt: "2026-07-31T12:00:00.000Z", treeJson: { schemaVersion: 2, status: "DRAFT", meta: { pricingV2: { tierBasis: "line_item_quantity", qtyTiers: [{ id: "tier_1", minQty: 1, perSqftCents: 450 }, { id: "tier_10", minQty: 10, perSqftCents: 400 }] } } } } };
}
function replacement() { return { tierType: "qtyTiers" as const, tiers: [{ id: "tier_1", minQty: 1, perSqftCents: 425 }, { id: "tier_10", minQty: 10, perSqftCents: 375 }, { id: "tier_25", minQty: 25, perSqftCents: 350 }] }; }

class FakeStore implements InactivePbv2QuantityTierEditStore {
  current = source(); proposals = new Map<string, InactivePbv2QuantityTierProposal>(); executions = new Map<string, true>(); calls: Array<Parameters<InactivePbv2QuantityTierEditStore["executeTierReplacementIdempotently"]>[0]> = [];
  async loadSource() { return structuredClone(this.current); }
  async createProposal(input: Omit<InactivePbv2QuantityTierProposal, "id">) { const proposal = { ...structuredClone(input), id: `proposal_${this.proposals.size + 1}` } as InactivePbv2QuantityTierProposal; this.proposals.set(proposal.id, proposal); return structuredClone(proposal); }
  async getProposal({ proposalId }: { organizationId: string; proposalId: string }) { return structuredClone(this.proposals.get(proposalId) ?? null); }
  async executeTierReplacementIdempotently(input: Parameters<InactivePbv2QuantityTierEditStore["executeTierReplacementIdempotently"]>[0]) { this.calls.push(structuredClone(input)); const reused = this.executions.has(input.idempotencyKey); this.executions.set(input.idempotencyKey, true); const proposal = this.proposals.get(input.proposalId); if (proposal) proposal.status = "succeeded"; return { productId: "product_1", pbv2TreeVersionId: "tree_1", inactive: true as const, pbv2Status: "DRAFT" as const, editorLink: exactInactiveDraftTierEditorLink("product_1", "tree_1"), reused }; }
}

describe("InactivePbv2QuantityTierEditService", () => {
  test("builds full typed before/after tier preview for the exact inactive DRAFT", async () => {
    const store = new FakeStore(); const service = new InactivePbv2QuantityTierEditService(store);
    const proposal = await service.prepareProposal({ organizationId: "org_1", actorUserId: "user_1", productId: "product_1", pbv2TreeVersionId: "tree_1", replacement: replacement() });
    expect(inactivePbv2QuantityTierEditAction).toBe("products.update_inactive_draft_tiers");
    expect(proposal.preview).toMatchObject({ before: { tierType: "qtyTiers" }, after: { tierType: "qtyTiers" }, editorLink: "/products/product_1/edit?draftTreeVersionId=tree_1" });
    expect(proposal.preview.before.tiers).toHaveLength(2); expect(proposal.preview.after.tiers).toHaveLength(3);
  });

  test("creates a missing requested tier family as a full replacement from an empty before state", async () => {
    const store = new FakeStore(); delete (store.current.pbv2Tree.treeJson.meta as any).pricingV2.qtyTiers;
    const service = new InactivePbv2QuantityTierEditService(store);
    const proposal = await service.prepareProposal({ organizationId: "org_1", actorUserId: "user_1", productId: "product_1", pbv2TreeVersionId: "tree_1", replacement: replacement() });
    expect(proposal.preview.before).toEqual({ tierType: "qtyTiers", tiers: [] });
    expect(proposal.preview.after.tiers).toHaveLength(3);
  });

  test("rejects missing coverage, duplicate/overlapping bounds, mixed bases, and empty price rows", async () => {
    const service = new InactivePbv2QuantityTierEditService(new FakeStore());
    const missing = replacement(); missing.tiers[0].minQty = 2;
    await expect(service.prepareProposal({ organizationId: "org_1", actorUserId: "user_1", productId: "product_1", pbv2TreeVersionId: "tree_1", replacement: missing })).rejects.toMatchObject({ code: "PBV2_TIER_COVERAGE_INVALID" });
    const duplicate = replacement(); duplicate.tiers[2].minQty = 10;
    await expect(service.prepareProposal({ organizationId: "org_1", actorUserId: "user_1", productId: "product_1", pbv2TreeVersionId: "tree_1", replacement: duplicate })).rejects.toMatchObject({ code: "PBV2_TIER_ORDER_INVALID" });
    const mixed = replacement(); (mixed.tiers[0] as any).minSqft = 1;
    await expect(service.prepareProposal({ organizationId: "org_1", actorUserId: "user_1", productId: "product_1", pbv2TreeVersionId: "tree_1", replacement: mixed })).rejects.toMatchObject({ code: "PBV2_TIER_BASIS_MIXED" });
    const emptyRate = replacement(); delete emptyRate.tiers[0].perSqftCents;
    await expect(service.prepareProposal({ organizationId: "org_1", actorUserId: "user_1", productId: "product_1", pbv2TreeVersionId: "tree_1", replacement: emptyRate })).rejects.toMatchObject({ code: "PBV2_TIER_RATE_MISSING" });
  });

  test("fails closed for a different actor or stale DRAFT snapshot", async () => {
    const store = new FakeStore(); const service = new InactivePbv2QuantityTierEditService(store);
    const proposal = await service.prepareProposal({ organizationId: "org_1", actorUserId: "user_1", productId: "product_1", pbv2TreeVersionId: "tree_1", replacement: replacement() });
    await expect(service.revalidateProposal({ organizationId: "org_1", actorUserId: "user_2", proposalId: proposal.id, proposalFingerprint: proposal.fingerprint })).rejects.toMatchObject({ code: "PBV2_TIER_PROPOSAL_ACTOR_MISMATCH" });
    store.current.pbv2Tree.updatedAt = "2026-07-31T12:01:00.000Z";
    await expect(service.revalidateProposal({ organizationId: "org_1", actorUserId: "user_1", proposalId: proposal.id, proposalFingerprint: proposal.fingerprint })).rejects.toMatchObject({ code: "PBV2_TIER_SOURCE_STALE" });
  });

  test("uses an idempotent executor boundary with the exact source fingerprint", async () => {
    const store = new FakeStore(); const service = new InactivePbv2QuantityTierEditService(store);
    const proposal = await service.prepareProposal({ organizationId: "org_1", actorUserId: "user_1", productId: "product_1", pbv2TreeVersionId: "tree_1", replacement: replacement() });
    const first = await service.execute({ organizationId: "org_1", actorUserId: "user_1", proposalId: proposal.id, proposalFingerprint: proposal.fingerprint, idempotencyKey: "go_1" });
    const replay = await service.execute({ organizationId: "org_1", actorUserId: "user_1", proposalId: proposal.id, proposalFingerprint: proposal.fingerprint, idempotencyKey: "go_1" });
    expect(first.reused).toBe(false); expect(replay.reused).toBe(true);
    expect(store.calls[0]).toMatchObject({ expectedSourceFingerprint: proposal.sourceFingerprint, proposalFingerprint: proposal.fingerprint, preview: { after: { tierType: "qtyTiers" } } });
  });
});
