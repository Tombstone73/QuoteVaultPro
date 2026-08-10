import { describe, expect, test } from "@jest/globals";
import {
  CloneInactiveProductDraftError,
  CloneInactiveProductDraftService,
  type CloneInactiveProductDraftStore,
  type CloneInactiveProductProposal,
  type CloneInactiveProductSourceSnapshot,
} from "../services/assistant/cloneInactiveProductDraftService";

function source(overrides: Partial<CloneInactiveProductSourceSnapshot> = {}): CloneInactiveProductSourceSnapshot {
  const value: CloneInactiveProductSourceSnapshot = {
    organizationId: "org_1",
    product: {
      id: "source_1", name: "PVC Signs", description: "Rigid PVC sign", category: "Signs", isActive: true,
      measurementMode: "dimensions_required", workflowIntent: "standard_production", isTaxable: true, pricingMode: "area",
      primaryMaterialId: "mat_pvc", pbv2ActiveTreeVersionId: "tree_1", configuration: { requiresDimensions: true, minimumChargeCents: 2500 },
    },
    pbv2Tree: {
      id: "tree_1", productId: "source_1", status: "ACTIVE", schemaVersion: 2, updatedAt: "2026-07-31T12:00:00.000Z",
      treeJson: {
        schemaVersion: 2, status: "ACTIVE", pricingMatrix: { dimensions: ["thickness"], rows: [{ id: "row_3mm", values: { thickness: "3mm" }, qtyTiers: [{ minQty: 1, maxQty: 9, perSqftCents: 450 }, { minQty: 10, perSqftCents: 400 }] }] },
        meta: { pricingV2: { base: { minimumChargeCents: 2500 } }, optionGroups: [{ name: "Finish", default: "None" }] },
      },
    },
  };
  return { ...value, ...overrides };
}

class FakeStore implements CloneInactiveProductDraftStore {
  current = source();
  names: Array<{ id: string; name: string }> = [{ id: "source_1", name: "PVC Signs" }];
  proposals = new Map<string, CloneInactiveProductProposal>();
  executions = new Map<string, { productId: string; treeId: string }>();
  executionCalls = 0;

  async loadSource() { return structuredClone(this.current); }
  async findProductsByNormalizedName({ normalizedName }: { organizationId: string; normalizedName: string }) {
    return this.names.filter((item) => item.name.trim().replace(/\s+/g, " ").toLowerCase() === normalizedName);
  }
  async createProposal(input: Omit<CloneInactiveProductProposal, "id">) {
    const proposal = { ...structuredClone(input), id: `proposal_${this.proposals.size + 1}` } as CloneInactiveProductProposal;
    this.proposals.set(proposal.id, proposal); return structuredClone(proposal);
  }
  async getProposal({ proposalId }: { organizationId: string; proposalId: string }) { return structuredClone(this.proposals.get(proposalId) ?? null); }
  async executeCloneIdempotently(input: Parameters<CloneInactiveProductDraftStore["executeCloneIdempotently"]>[0]) {
    this.executionCalls += 1;
    const prior = this.executions.get(input.idempotencyKey);
    if (prior) return { productId: prior.productId, productName: input.preview.result.product.name, pbv2TreeVersionId: prior.treeId, inactive: true as const, pbv2Status: "DRAFT" as const, reused: true };
    this.names.push({ id: "clone_1", name: input.preview.result.product.name });
    this.executions.set(input.idempotencyKey, { productId: "clone_1", treeId: "clone_tree_1" });
    const proposal = this.proposals.get(input.proposalId);
    if (proposal) proposal.status = "succeeded";
    return { productId: "clone_1", productName: input.preview.result.product.name, pbv2TreeVersionId: "clone_tree_1", inactive: true as const, pbv2Status: "DRAFT" as const, reused: false };
  }
}

describe("CloneInactiveProductDraftService", () => {
  test("persists an actor-bound source snapshot with requested changes separate from inherited before/after configuration", async () => {
    const store = new FakeStore(); const service = new CloneInactiveProductDraftService(store);
    const proposal = await service.prepareProposal({ organizationId: "org_1", actorUserId: "user_1", sourceProductId: "source_1", requestedChanges: { newName: "PVC Signs - revised", description: "Revised clone" } });
    expect(proposal).toMatchObject({ actorUserId: "user_1", sourceProductId: "source_1", sourcePbv2TreeVersionId: "tree_1", status: "proposed" });
    expect(proposal.preview.requestedChanges).toEqual({ newName: "PVC Signs - revised", description: "Revised clone" });
    expect(proposal.preview.source.pbv2Tree.treeJson).toMatchObject({ status: "ACTIVE", pricingMatrix: { rows: [{ qtyTiers: [{ minQty: 1, maxQty: 9, perSqftCents: 450 }, { minQty: 10, perSqftCents: 400 }] }] } });
    expect(proposal.preview.result).toMatchObject({ product: { name: "PVC Signs - revised", description: "Revised clone", inactive: true, measurementMode: "dimensions_required" }, pbv2Tree: { status: "DRAFT", treeJson: { status: "DRAFT", pricingMatrix: { dimensions: ["thickness"] } } });
    expect(proposal.preview.source.pbv2Tree.treeJson).not.toBe(proposal.preview.result.pbv2Tree.treeJson);
  });

  test("fails closed on duplicate clone names and never persists a proposal", async () => {
    const store = new FakeStore(); store.names.push({ id: "already_here", name: "PVC Signs - revised" });
    const service = new CloneInactiveProductDraftService(store);
    await expect(service.prepareProposal({ organizationId: "org_1", actorUserId: "user_1", sourceProductId: "source_1", requestedChanges: { newName: " pvc   signs - REVISED " } })).rejects.toMatchObject({ code: "CLONE_NAME_CONFLICT" });
    expect(store.proposals.size).toBe(0);
  });

  test("applies only explicit scalar base-pricing changes and presents complete before/after rates", async () => {
    const store = new FakeStore(); const service = new CloneInactiveProductDraftService(store);
    const proposal = await service.prepareProposal({ organizationId: "org_1", actorUserId: "user_1", sourceProductId: "source_1", requestedChanges: { newName: "Economy PVC Signs", basePricing: { perSqftCents: 110, minimumChargeCents: 2000 } } });
    expect(proposal.preview.basePricing).toEqual({ before: { perSqftCents: null, perPieceCents: null, minimumChargeCents: 2500 }, after: { perSqftCents: 110, perPieceCents: null, minimumChargeCents: 2000 } });
    expect((proposal.preview.result.pbv2Tree.treeJson.meta as any).pricingV2.base).toMatchObject({ perSqftCents: 110, minimumChargeCents: 2000 });
    expect((proposal.preview.source.pbv2Tree.treeJson.meta as any).pricingV2.base).toEqual({ minimumChargeCents: 2500 });
  });

  test("keeps both explicitly normalized clone pricing changes in the fingerprinted inactive DRAFT preview", async () => {
    const store = new FakeStore();
    (store.current.pbv2Tree.treeJson.meta as any).pricingV2.base.perSqftCents = 200;
    const service = new CloneInactiveProductDraftService(store);
    const proposal = await service.prepareProposal({ organizationId: "org_1", actorUserId: "user_1", sourceProductId: "source_1", requestedChanges: { newName: "DEV Test Minimum Charge Clone 080426", basePricing: { perSqftCents: 250, minimumChargeCents: 3000 } } });

    expect(proposal.preview.requestedChanges.basePricing).toEqual({ perSqftCents: 250, minimumChargeCents: 3000 });
    expect(proposal.preview.basePricing).toEqual({ before: { perSqftCents: 200, perPieceCents: null, minimumChargeCents: 2500 }, after: { perSqftCents: 250, perPieceCents: null, minimumChargeCents: 3000 } });
    expect(proposal.preview.result).toMatchObject({ product: { inactive: true, name: "DEV Test Minimum Charge Clone 080426" }, pbv2Tree: { status: "DRAFT" } });
    expect(proposal.preview.source.pbv2Tree.treeJson).toMatchObject({ meta: { pricingV2: { base: { perSqftCents: 200, minimumChargeCents: 2500 } } } });
    expect(proposal.fingerprint).toBe(proposal.preview.proposalFingerprint);
  });

  test("does not invent a base-pricing path for an explicit rate change", async () => {
    const store = new FakeStore(); delete (store.current.pbv2Tree.treeJson as any).meta.pricingV2;
    const service = new CloneInactiveProductDraftService(store);
    await expect(service.prepareProposal({ organizationId: "org_1", actorUserId: "user_1", sourceProductId: "source_1", requestedChanges: { newName: "Economy PVC Signs", basePricing: { perSqftCents: 110 } } })).rejects.toMatchObject({ code: "CLONE_BASE_PRICING_UNSUPPORTED" });
  });

  test("rejects a stale PBV2 source snapshot and a different actor before execution", async () => {
    const store = new FakeStore(); const service = new CloneInactiveProductDraftService(store);
    const proposal = await service.prepareProposal({ organizationId: "org_1", actorUserId: "user_1", sourceProductId: "source_1", requestedChanges: { newName: "PVC Signs Copy" } });
    await expect(service.revalidateProposal({ organizationId: "org_1", actorUserId: "user_2", proposalId: proposal.id, proposalFingerprint: proposal.fingerprint })).rejects.toMatchObject({ code: "CLONE_PROPOSAL_ACTOR_MISMATCH" });
    store.current.pbv2Tree.updatedAt = "2026-07-31T12:01:00.000Z";
    await expect(service.revalidateProposal({ organizationId: "org_1", actorUserId: "user_1", proposalId: proposal.id, proposalFingerprint: proposal.fingerprint })).rejects.toMatchObject({ code: "CLONE_SOURCE_STALE" });
  });

  test("passes exact binding and fingerprints into the idempotent executor", async () => {
    const store = new FakeStore(); const service = new CloneInactiveProductDraftService(store);
    const proposal = await service.prepareProposal({ organizationId: "org_1", actorUserId: "user_1", sourceProductId: "source_1", requestedChanges: { newName: "PVC Signs Copy" } });
    const first = await service.execute({ organizationId: "org_1", actorUserId: "user_1", proposalId: proposal.id, proposalFingerprint: proposal.fingerprint, idempotencyKey: "plan_1" });
    const replay = await service.execute({ organizationId: "org_1", actorUserId: "user_1", proposalId: proposal.id, proposalFingerprint: proposal.fingerprint, idempotencyKey: "plan_1" });
    expect(first).toMatchObject({ productId: "clone_1", inactive: true, pbv2Status: "DRAFT", reused: false });
    expect(replay).toMatchObject({ productId: "clone_1", pbv2TreeVersionId: "clone_tree_1", reused: true });
    expect(store.executionCalls).toBe(2);
  });
});
