import { describe, expect, test } from "@jest/globals";
import { CloneInactiveProductDraftService, type CloneInactiveProductDraftStore, type CloneInactiveProductProposal, type CloneInactiveProductSourceSnapshot } from "../services/assistant/cloneInactiveProductDraftService";
import { createCloneInactiveProductDraftExecutionCommand } from "../services/assistant/execution/cloneInactiveProductDraftExecutionCommand";

const proposalId = "11111111-1111-4111-8111-111111111111";
const fingerprint = "a".repeat(64);
const scope = { organizationId: "org_1", userId: "user_1", permissions: ["assistant.products.clone_to_inactive_draft"], environment: "test" } as const;

class Store implements CloneInactiveProductDraftStore {
  proposal: CloneInactiveProductProposal | null = null;
  source: CloneInactiveProductSourceSnapshot = {
    organizationId: "org_1",
    product: { id: "source_1", name: "13oz Banner", description: "Banner", category: "Banners", isActive: true, measurementMode: "dimensions_required", workflowIntent: "standard_production", isTaxable: true, pricingMode: "area", primaryMaterialId: null, pbv2ActiveTreeVersionId: "tree_1", configuration: { minimumChargeCents: 1500 } },
    pbv2Tree: { id: "tree_1", productId: "source_1", status: "ACTIVE", schemaVersion: 2, updatedAt: "2026-07-31T12:00:00.000Z", treeJson: { status: "ACTIVE", pricingMatrix: { rows: [{ id: "r1" }] } } },
  };
  calls = 0;
  async loadSource() { return structuredClone(this.source); }
  async findProductsByNormalizedName() { return []; }
  async createProposal(input: Omit<CloneInactiveProductProposal, "id">) { this.proposal = { ...structuredClone(input), id: proposalId }; return structuredClone(this.proposal); }
  async getProposal() { return structuredClone(this.proposal); }
  async executeCloneIdempotently(input: Parameters<CloneInactiveProductDraftStore["executeCloneIdempotently"]>[0]) {
    this.calls += 1;
    if (this.proposal?.status === "succeeded") return { productId: "clone_1", productName: input.preview.result.product.name, pbv2TreeVersionId: "tree_clone_1", inactive: true as const, pbv2Status: "DRAFT" as const, reused: true };
    if (this.proposal) this.proposal.status = "succeeded";
    return { productId: "clone_1", productName: input.preview.result.product.name, pbv2TreeVersionId: "tree_clone_1", inactive: true as const, pbv2Status: "DRAFT" as const, reused: false };
  }
}

describe("clone inactive product draft execution command", () => {
  test("binds the preview to the source snapshot and returns an exact PBV2 DRAFT editor link", async () => {
    const store = new Store(); const service = new CloneInactiveProductDraftService(store);
    const proposal = await service.prepareProposal({ organizationId: "org_1", actorUserId: "user_1", sourceProductId: "source_1", requestedChanges: { newName: "Economy Banner" } });
    const command = createCloneInactiveProductDraftExecutionCommand(store);
    const built = await command.buildPreview({ scope, context: {} as any, arguments: { proposalId, proposalFingerprint: proposal.fingerprint } });
    expect((built.preview as any).cloneInactiveDraft).toMatchObject({ action: "products.clone_to_inactive_draft", proposalId, proposalFingerprint: proposal.fingerprint, preview: { source: { product: { id: "source_1" } }, result: { product: { name: "Economy Banner", inactive: true } } } });
    const result = await command.execute({ scope, plan: { id: "plan_1", idempotencyKey: "aicmd_00000000-0000-0000-0000-000000000000", correlationId: "corr_1", sanitizedArguments: built.arguments } as any });
    expect(result.details).toMatchObject({ cloneInactiveDraft: { productId: "clone_1", pbv2TreeVersionId: "tree_clone_1", editorLink: "/products/clone_1/edit?draftTreeVersionId=tree_clone_1", inactive: true, pbv2Status: "DRAFT" } });
  });

  test("fails revalidation when the exact source snapshot is stale", async () => {
    const store = new Store(); const service = new CloneInactiveProductDraftService(store);
    const proposal = await service.prepareProposal({ organizationId: "org_1", actorUserId: "user_1", sourceProductId: "source_1", requestedChanges: { newName: "Economy Banner" } });
    store.source.pbv2Tree.updatedAt = "2026-07-31T12:01:00.000Z";
    const command = createCloneInactiveProductDraftExecutionCommand(store);
    await expect(command.revalidate({ scope, plan: { sanitizedArguments: { proposalId, proposalFingerprint: proposal.fingerprint } } as any })).resolves.toMatchObject({ valid: false, code: "CLONE_SOURCE_STALE" });
  });
});
