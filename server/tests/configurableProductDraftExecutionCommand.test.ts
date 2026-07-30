import { jest } from "@jest/globals";
import { createInitialComplexProductSpecification } from "../services/assistant/complexProductConversation";

const persistence = {
  createComplexProductDraft: jest.fn(),
  getComplexProductConfirmation: jest.fn(),
  getComplexProductProposal: jest.fn(),
};
jest.mock("../services/assistant/complexProductDraftPersistence", () => persistence);

import { createConfigurableProductDraftExecutionCommand } from "../services/assistant/execution/configurableProductDraftExecutionCommand";

const proposalId = "11111111-1111-4111-8111-111111111111";
const fingerprint = "a".repeat(64);
const specification = createInitialComplexProductSpecification("Create PVC product with 3mm and 6mm thickness options.");
specification.review.blockers = [];
const scope = { organizationId: "org_1", userId: "user_1", permissions: ["assistant.products.create_inactive_draft"], environment: "test" } as const;
const confirmation = { proposalId, fingerprint, goEligible: true, product: { name: "PVC Configurable Product" } } as any;

describe("configurable product draft execution command", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    persistence.getComplexProductProposal.mockResolvedValue({ id: proposalId, fingerprint, specification });
    persistence.getComplexProductConfirmation.mockResolvedValue(confirmation);
  });

  it("uses the canonical draft writer once and returns the persisted inactive PBV2 DRAFT result", async () => {
    persistence.createComplexProductDraft.mockResolvedValue({ productId: "product_1", pbv2TreeVersionId: "tree_1", reused: false });
    const command = createConfigurableProductDraftExecutionCommand();
    const built = await command.buildPreview({ scope, context: {} as any, arguments: { proposalId, fingerprint } });
    const result = await command.execute({ scope, plan: { id: "plan_1", idempotencyKey: "key_1", correlationId: "corr_1", sanitizedArguments: built.arguments } as any });

    expect(persistence.createComplexProductDraft).toHaveBeenCalledTimes(1);
    expect(persistence.createComplexProductDraft).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org_1", proposalId, fingerprint, actorUserId: "user_1" }));
    expect(result.details).toMatchObject({ configurableProduct: { productId: "product_1", pbv2TreeVersionId: "tree_1", inactive: true, pbv2Status: "DRAFT", reused: false } });
  });

  it("rejects a changed or cross-tenant proposal during revalidation", async () => {
    persistence.getComplexProductProposal.mockResolvedValue(null);
    const command = createConfigurableProductDraftExecutionCommand();
    const validation = await command.revalidate({ scope: { ...scope, organizationId: "other_org" }, plan: { sanitizedArguments: { proposalId, fingerprint } } as any });
    expect(validation).toMatchObject({ valid: false, code: "CONFIGURABLE_PROPOSAL_CHANGED" });
    expect(persistence.createComplexProductDraft).not.toHaveBeenCalled();
  });
});
