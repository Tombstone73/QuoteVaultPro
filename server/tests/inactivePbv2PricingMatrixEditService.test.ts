import { describe, expect, test } from "@jest/globals";
import {
  InactivePbv2PricingMatrixEditService,
  type InactivePbv2PricingMatrixEditStore,
  type InactivePbv2PricingMatrixProposal,
  type InactivePbv2PricingMatrixSourceSnapshot,
  exactDraftEditorLink,
  inactivePbv2PricingMatrixEditAction,
} from "../services/assistant/inactivePbv2PricingMatrixEditService";

function source(): InactivePbv2PricingMatrixSourceSnapshot {
  return {
    organizationId: "org_1",
    product: { id: "product_1", name: "Rigid Signs", isActive: false, pbv2ActiveTreeVersionId: null },
    pbv2Tree: {
      id: "tree_1", productId: "product_1", status: "DRAFT", schemaVersion: 2, updatedAt: "2026-07-31T12:00:00.000Z",
      treeJson: {
        schemaVersion: 2, status: "DRAFT", nodes: {
          thickness: { id: "thickness", type: "INPUT", status: "ENABLED", input: { type: "select", selectionKey: "thickness" }, choices: [{ value: "3mm" }, { value: "6mm" }] },
          sides: { id: "sides", type: "INPUT", status: "ENABLED", input: { type: "select", selectionKey: "sides" }, choices: [{ value: "single" }, { value: "double" }] },
        }, edges: [],
        pricingMatrix: { dimensions: ["thickness", "sides"], rows: [
          { id: "3-single", when: { thickness: "3mm", sides: "single" }, variables: { base_price: 400 } },
          { id: "3-double", when: { thickness: "3mm", sides: "double" }, variables: { base_price: 500 } },
          { id: "6-single", when: { thickness: "6mm", sides: "single" }, variables: { base_price: 600 } },
          { id: "6-double", when: { thickness: "6mm", sides: "double" }, variables: { base_price: 700 } },
        ] },
      },
    },
  };
}

function replacement() {
  return { dimensions: ["thickness", "sides"], rows: [
    { id: "3-single", when: { thickness: "3mm", sides: "single" }, variables: { base_price: 450 } },
    { id: "3-double", when: { thickness: "3mm", sides: "double" }, variables: { base_price: 550 } },
    { id: "6-single", when: { thickness: "6mm", sides: "single" }, variables: { base_price: 650 } },
    { id: "6-double", when: { thickness: "6mm", sides: "double" }, variables: { base_price: 750 } },
  ] };
}

class FakeStore implements InactivePbv2PricingMatrixEditStore {
  current = source();
  proposals = new Map<string, InactivePbv2PricingMatrixProposal>();
  executions = new Map<string, { productId: string; pbv2TreeVersionId: string }>();
  executorInputs: Array<Parameters<InactivePbv2PricingMatrixEditStore["executeReplacementIdempotently"]>[0]> = [];

  async loadSource() { return structuredClone(this.current); }
  async createProposal(input: Omit<InactivePbv2PricingMatrixProposal, "id">) {
    const proposal = { ...structuredClone(input), id: `proposal_${this.proposals.size + 1}` } as InactivePbv2PricingMatrixProposal;
    this.proposals.set(proposal.id, proposal); return structuredClone(proposal);
  }
  async getProposal({ proposalId }: { organizationId: string; proposalId: string }) { return structuredClone(this.proposals.get(proposalId) ?? null); }
  async executeReplacementIdempotently(input: Parameters<InactivePbv2PricingMatrixEditStore["executeReplacementIdempotently"]>[0]) {
    this.executorInputs.push(structuredClone(input));
    const previous = this.executions.get(input.idempotencyKey);
    if (previous) return { ...previous, inactive: true as const, pbv2Status: "DRAFT" as const, editorLink: exactDraftEditorLink(previous.productId, previous.pbv2TreeVersionId), reused: true };
    this.executions.set(input.idempotencyKey, { productId: input.preview.source.product.id, pbv2TreeVersionId: input.preview.source.pbv2Tree.id });
    const proposal = this.proposals.get(input.proposalId); if (proposal) proposal.status = "succeeded";
    return { productId: input.preview.source.product.id, pbv2TreeVersionId: input.preview.source.pbv2Tree.id, inactive: true as const, pbv2Status: "DRAFT" as const, editorLink: input.preview.editorLink, reused: false };
  }
}

describe("InactivePbv2PricingMatrixEditService", () => {
  test("creates an actor-bound full before/after preview for the exact inactive DRAFT", async () => {
    const store = new FakeStore(); const service = new InactivePbv2PricingMatrixEditService(store);
    const proposal = await service.prepareProposal({ organizationId: "org_1", actorUserId: "user_1", productId: "product_1", pbv2TreeVersionId: "tree_1", replacement: replacement() });
    expect(inactivePbv2PricingMatrixEditAction).toBe("products.update_inactive_draft_matrix");
    expect(proposal.preview).toMatchObject({ location: "tree.pricingMatrix", editorLink: "/products/product_1/edit?draftTreeVersionId=tree_1" });
    expect(proposal.preview.before.rows[0]).toMatchObject({ variables: { base_price: 400 } });
    expect(proposal.preview.after.rows[0]).toMatchObject({ variables: { base_price: 450 } });
    expect(proposal.preview.before.rows).toHaveLength(4);
    expect(proposal.preview.after.rows).toHaveLength(4);
  });

  test("rejects missing or duplicate cells before persisting a proposal", async () => {
    const store = new FakeStore(); const service = new InactivePbv2PricingMatrixEditService(store);
    const missing = replacement(); missing.rows.pop();
    await expect(service.prepareProposal({ organizationId: "org_1", actorUserId: "user_1", productId: "product_1", pbv2TreeVersionId: "tree_1", replacement: missing })).rejects.toMatchObject({ code: "PBV2_MATRIX_CELLS_MISSING" });
    const duplicate = replacement(); duplicate.rows[3] = { ...duplicate.rows[3], when: { thickness: "6mm", sides: "single" } };
    await expect(service.prepareProposal({ organizationId: "org_1", actorUserId: "user_1", productId: "product_1", pbv2TreeVersionId: "tree_1", replacement: duplicate })).rejects.toMatchObject({ code: "PBV2_MATRIX_CELL_DUPLICATE" });
    expect(store.proposals.size).toBe(0);
  });

  test("rejects a changed DRAFT or a proposal held by another actor", async () => {
    const store = new FakeStore(); const service = new InactivePbv2PricingMatrixEditService(store);
    const proposal = await service.prepareProposal({ organizationId: "org_1", actorUserId: "user_1", productId: "product_1", pbv2TreeVersionId: "tree_1", replacement: replacement() });
    await expect(service.revalidateProposal({ organizationId: "org_1", actorUserId: "user_2", proposalId: proposal.id, proposalFingerprint: proposal.fingerprint })).rejects.toMatchObject({ code: "PBV2_MATRIX_PROPOSAL_ACTOR_MISMATCH" });
    store.current.pbv2Tree.updatedAt = "2026-07-31T12:01:00.000Z";
    await expect(service.revalidateProposal({ organizationId: "org_1", actorUserId: "user_1", proposalId: proposal.id, proposalFingerprint: proposal.fingerprint })).rejects.toMatchObject({ code: "PBV2_MATRIX_SOURCE_STALE" });
  });

  test("passes source binding and fingerprint to the idempotent boundary and returns the exact DRAFT link", async () => {
    const store = new FakeStore(); const service = new InactivePbv2PricingMatrixEditService(store);
    const proposal = await service.prepareProposal({ organizationId: "org_1", actorUserId: "user_1", productId: "product_1", pbv2TreeVersionId: "tree_1", replacement: replacement() });
    const first = await service.execute({ organizationId: "org_1", actorUserId: "user_1", proposalId: proposal.id, proposalFingerprint: proposal.fingerprint, idempotencyKey: "go_1" });
    const replay = await service.execute({ organizationId: "org_1", actorUserId: "user_1", proposalId: proposal.id, proposalFingerprint: proposal.fingerprint, idempotencyKey: "go_1" });
    expect(first).toMatchObject({ inactive: true, pbv2Status: "DRAFT", reused: false, editorLink: "/products/product_1/edit?draftTreeVersionId=tree_1" });
    expect(replay.reused).toBe(true);
    expect(store.executorInputs).toHaveLength(2);
    expect(store.executorInputs[0]).toMatchObject({ expectedSourceFingerprint: proposal.sourceFingerprint, proposalFingerprint: proposal.fingerprint, preview: { location: "tree.pricingMatrix" } });
  });
});
