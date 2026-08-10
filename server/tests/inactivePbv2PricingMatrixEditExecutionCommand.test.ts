import { describe, expect, test } from "@jest/globals";
import {
  InactivePbv2PricingMatrixEditService,
  type InactivePbv2PricingMatrixEditStore,
  type InactivePbv2PricingMatrixProposal,
  type InactivePbv2PricingMatrixSourceSnapshot,
} from "../services/assistant/inactivePbv2PricingMatrixEditService";
import { createInactivePbv2PricingMatrixEditExecutionCommand } from "../services/assistant/execution/inactivePbv2PricingMatrixEditExecutionCommand";

const proposalId = "11111111-1111-4111-8111-111111111111";
const scope = { organizationId: "org_1", userId: "user_1", permissions: ["assistant.products.replace_inactive_matrix"], environment: "test" } as const;

class Store implements InactivePbv2PricingMatrixEditStore {
  proposal: InactivePbv2PricingMatrixProposal | null = null;
  source: InactivePbv2PricingMatrixSourceSnapshot = {
    organizationId: "org_1",
    product: { id: "product_1", name: "Inactive Coroplast", isActive: false, pbv2ActiveTreeVersionId: null },
    pbv2Tree: {
      id: "tree_1", productId: "product_1", status: "DRAFT", schemaVersion: 2, updatedAt: "2026-07-31T12:00:00.000Z",
      treeJson: {
        schemaVersion: 2, status: "DRAFT", edges: [], nodes: {
          thickness: { id: "thickness", type: "INPUT", status: "ENABLED", input: { type: "select", selectionKey: "thickness" }, choices: [{ value: "3mm" }, { value: "6mm" }] },
          sides: { id: "sides", type: "INPUT", status: "ENABLED", input: { type: "select", selectionKey: "sides" }, choices: [{ value: "single" }, { value: "double" }] },
        },
        pricingMatrix: {
          dimensions: ["thickness", "sides"],
          rows: [
            { when: { thickness: "3mm", sides: "single" }, variables: { base_price: 2 } },
            { when: { thickness: "3mm", sides: "double" }, variables: { base_price: 3 } },
            { when: { thickness: "6mm", sides: "single" }, variables: { base_price: 4 } },
            { when: { thickness: "6mm", sides: "double" }, variables: { base_price: 5 } },
          ],
        },
      },
    },
  };
  calls = 0;
  async loadSource() { return structuredClone(this.source); }
  async createProposal(input: Omit<InactivePbv2PricingMatrixProposal, "id">) { this.proposal = { ...structuredClone(input), id: proposalId }; return structuredClone(this.proposal); }
  async getProposal() { return structuredClone(this.proposal); }
  async executeReplacementIdempotently(input: Parameters<InactivePbv2PricingMatrixEditStore["executeReplacementIdempotently"]>[0]) {
    this.calls += 1;
    if (this.proposal?.status === "succeeded") return { productId: "product_1", pbv2TreeVersionId: "tree_1", inactive: true as const, pbv2Status: "DRAFT" as const, editorLink: input.preview.editorLink, reused: true };
    if (this.proposal) this.proposal.status = "succeeded";
    return { productId: "product_1", pbv2TreeVersionId: "tree_1", inactive: true as const, pbv2Status: "DRAFT" as const, editorLink: input.preview.editorLink, reused: false };
  }
}

function replacement() {
  return {
    dimensions: ["thickness", "sides"],
    rows: [
      { when: { thickness: "3mm", sides: "single" }, variables: { base_price: 200 } },
      { when: { thickness: "3mm", sides: "double" }, variables: { base_price: 300 } },
      { when: { thickness: "6mm", sides: "single" }, variables: { base_price: 400 } },
      { when: { thickness: "6mm", sides: "double" }, variables: { base_price: 500 } },
    ],
  };
}

describe("inactive PBV2 pricing matrix execution command", () => {
  test("creates an exact-draft confirmation preview and preserves it in the result", async () => {
    const store = new Store();
    const service = new InactivePbv2PricingMatrixEditService(store);
    const proposal = await service.prepareProposal({ organizationId: "org_1", actorUserId: "user_1", productId: "product_1", pbv2TreeVersionId: "tree_1", replacement: replacement() });
    const command = createInactivePbv2PricingMatrixEditExecutionCommand(store);
    const built = await command.buildPreview({ scope, context: {} as any, arguments: { proposalId, proposalFingerprint: proposal.fingerprint } });
    expect((built.preview as any).inactivePbv2MatrixEdit).toMatchObject({ proposalId, proposalFingerprint: proposal.fingerprint, preview: { source: { product: { id: "product_1" }, pbv2Tree: { id: "tree_1", status: "DRAFT" } }, editorLink: "/products/product_1/edit?draftTreeVersionId=tree_1" } });
    const result = await command.execute({ scope, plan: { id: "plan_1", idempotencyKey: "aicmd_00000000-0000-0000-0000-000000000000", correlationId: "corr_1", sanitizedArguments: built.arguments } as any });
    expect(result.details).toMatchObject({ inactivePbv2MatrixEdit: { productId: "product_1", pbv2TreeVersionId: "tree_1", editorLink: "/products/product_1/edit?draftTreeVersionId=tree_1", inactive: true, pbv2Status: "DRAFT" } });
  });

  test("rejects a stale exact draft before GO", async () => {
    const store = new Store();
    const service = new InactivePbv2PricingMatrixEditService(store);
    const proposal = await service.prepareProposal({ organizationId: "org_1", actorUserId: "user_1", productId: "product_1", pbv2TreeVersionId: "tree_1", replacement: replacement() });
    store.source.pbv2Tree.updatedAt = "2026-07-31T12:01:00.000Z";
    const command = createInactivePbv2PricingMatrixEditExecutionCommand(store);
    await expect(command.revalidate({ scope, plan: { sanitizedArguments: { proposalId, proposalFingerprint: proposal.fingerprint } } as any })).resolves.toMatchObject({ valid: false, code: "PBV2_MATRIX_SOURCE_STALE" });
  });
});
