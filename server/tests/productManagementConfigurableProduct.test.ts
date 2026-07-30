import { jest } from "@jest/globals";

const persistence = {
  getComplexProductConfirmation: jest.fn(),
  persistComplexProductProposal: jest.fn(),
  resolveConfigurableProductContinuation: jest.fn(),
  updateComplexProductProposal: jest.fn(),
};

jest.mock("../services/assistant/complexProductDraftPersistence", () => persistence);
jest.mock("../db", () => ({ db: {} }));

import { ProductManagementSkillService } from "../services/assistant/productManagementSkill";
import { createInitialComplexProductSpecification } from "../services/assistant/complexProductConversation";

const spec = createInitialComplexProductSpecification("Create a PVC product with 3mm and 6mm thickness options.");
const readyConfirmation = (fingerprint: string) => ({
  kind: "configurable_product_confirmation", proposalId: "11111111-1111-4111-8111-111111111111", fingerprint,
  goEligible: true, blockers: [], product: { name: "PVC Configurable Product" },
});

describe("ProductManagementSkillService configurable-product integration", () => {
  beforeEach(() => jest.resetAllMocks());

  it("handles configurable messages before legacy routes and binds the exact persisted proposal and fingerprint", async () => {
    persistence.resolveConfigurableProductContinuation.mockResolvedValue(null);
    persistence.persistComplexProductProposal.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", fingerprint: "a".repeat(64), specification: spec });
    persistence.getComplexProductConfirmation.mockResolvedValue(readyConfirmation("a".repeat(64)));
    const service = new ProductManagementSkillService({ sessions: {} as any, references: jest.fn() });

    const response = await service.respond({ organizationId: "org_1", userId: "user_1", conversationId: "conversation_1", message: "Create a PVC product with thickness options and price it with a matrix." });

    expect(response.handled).toBe(true);
    expect(persistence.persistComplexProductProposal).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org_1", conversationId: "conversation_1", actorUserId: "user_1" }));
    expect(response.cards.find((card) => card.kind === "action_proposal")?.plan).toMatchObject({ action: "products.create_configurable_draft", proposalId: "11111111-1111-4111-8111-111111111111", fingerprint: "a".repeat(64), configurableProduct: { proposalId: "11111111-1111-4111-8111-111111111111", fingerprint: "a".repeat(64) } });
  });

  it("updates the one conversation proposal and emits no executable action while structurally blocked", async () => {
    persistence.resolveConfigurableProductContinuation.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", specification: spec });
    persistence.updateComplexProductProposal.mockResolvedValue({ proposal: { id: "11111111-1111-4111-8111-111111111111" }, blockers: [] });
    persistence.getComplexProductConfirmation.mockResolvedValue({ ...readyConfirmation("b".repeat(64)), goEligible: false, blockers: ["Provide the matrix."] });
    const service = new ProductManagementSkillService({ sessions: {} as any, references: jest.fn() });

    const response = await service.respond({ organizationId: "org_1", userId: "user_1", conversationId: "conversation_1", message: "Set minimum charge to $25." });

    expect(persistence.persistComplexProductProposal).not.toHaveBeenCalled();
    expect(persistence.updateComplexProductProposal).toHaveBeenCalledWith(expect.objectContaining({ proposalId: "11111111-1111-4111-8111-111111111111", organizationId: "org_1" }));
    expect(response.cards.some((card) => card.kind === "action_proposal")).toBe(false);
  });

  it("continues a settings-only correction through the canonical conversation resolver", async () => {
    persistence.resolveConfigurableProductContinuation.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", specification: spec });
    persistence.updateComplexProductProposal.mockResolvedValue({ proposal: { id: "11111111-1111-4111-8111-111111111111" }, blockers: [] });
    persistence.getComplexProductConfirmation.mockResolvedValue({ ...readyConfirmation("c".repeat(64)), goEligible: false, blockers: ["Provide the matrix."] });
    const service = new ProductManagementSkillService({ sessions: {} as any, references: jest.fn() });

    const response = await service.respond({ organizationId: "org_1", userId: "user_1", conversationId: "conversation_1", activeConfigurableProposalId: "11111111-1111-4111-8111-111111111111", message: "Use 48×96 sheets, Flatbed routing, allow rotation, and set a $25 minimum." });

    expect(response.handled).toBe(true);
    expect(persistence.resolveConfigurableProductContinuation).toHaveBeenCalledWith({ organizationId: "org_1", actorUserId: "user_1", conversationId: "conversation_1", priorProposalId: "11111111-1111-4111-8111-111111111111" });
    expect(persistence.updateComplexProductProposal).toHaveBeenCalledWith(expect.objectContaining({ proposalId: "11111111-1111-4111-8111-111111111111", organizationId: "org_1" }));
  });
});
