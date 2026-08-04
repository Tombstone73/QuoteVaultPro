import { jest } from "@jest/globals";

jest.mock("../db", () => ({ db: {} }));

import { ProductManagementSkillService } from "../services/assistant/productManagementSkill";
import type { ProductIntakeSessionDetail } from "../../shared/productIntakeWizardSchemas";

function detail(overrides: Partial<ProductIntakeSessionDetail> = {}): ProductIntakeSessionDetail {
  const brief = {
    workflowState: "REVIEW_READY", source: "rule_based_fallback", fallbackReason: null,
    productIdentity: {
      likelyProductName: { value: "DEV Test Vinyl Options 080326", confidence: 90, evidence: [] },
      category: { value: "Vinyl Options", confidence: 80, evidence: [] },
      productType: { value: "product", confidence: 80, evidence: [] },
    },
    materialAnalysis: { detectedMaterialReferences: [], likelyMaterialMatches: [], confidence: 20, evidence: [] },
    sizeBehavior: { behavior: "custom_size", confidence: 80, evidence: [] },
    quantityBehavior: { behavior: "per_piece", confidence: 80, evidence: [] },
    pricingAnalysis: { behavior: "square_foot", confidence: 90, evidence: [] },
    requiredOptions: [], optionalOptions: [], templateMatches: [],
    missingDecisions: [{ id: "select-material", question: "Select material", reason: "Missing", severity: "review", evidence: [] }],
    redundantFields: [], draftWarnings: [], sourceEvidence: [], overallConfidence: 70,
  } as any;
  return {
    session: { id: "session_1", organizationId: "org_1", sourceType: "text_description", sourceFingerprint: "old", brief, confidence: {}, missingDecisions: brief.missingDecisions, status: "needs_answers", createdProductId: null, createdPbv2TreeVersionId: null, createdByUserId: "user_1", updatedByUserId: "user_1", createdAt: "2026-08-03T00:00:00.000Z", updatedAt: "2026-08-03T00:00:00.000Z", abandonedAt: null },
    brief, questions: [], answers: [],
    readiness: { unansweredRequiredCount: 1, answeredCount: 0, canCreateDraft: false, status: "needs_answers", reviewState: "needs_review", penalties: [] },
    ...overrides,
  } as ProductIntakeSessionDetail;
}

describe("Product Intake explicit correction continuation", () => {
  test("rebuilds the active session before pricing or product lookup and exposes the required option contract", async () => {
    const initial = detail();
    let replacement: any = null;
    const sessions = {
      getSessionDetail: jest.fn().mockResolvedValue(initial),
      getSessionSource: jest.fn().mockResolvedValue({ sourceText: "Create product named DEV Test Vinyl Options 080326 with custom width and height at $3 per square foot.", sourceJson: null }),
      replaceBrief: jest.fn().mockImplementation(async (input) => {
        replacement = input;
        return detail({ brief: input.brief, session: { ...initial.session, brief: input.brief, sourceFingerprint: "new", updatedAt: "2026-08-03T00:01:00.000Z" } as any });
      }),
    };
    const service = new ProductManagementSkillService({ sessions: sessions as any, references: jest.fn().mockResolvedValue({ materials: [], templates: [] }) });

    const result = await service.respond({
      organizationId: "org_1", userId: "user_1", conversationId: "conversation_1", activeSessionId: "session_1",
      message: "Use Print Products as category. Remove the Size option. Add Lamination single-select required custom option group with choices None, Gloss, Matte, defaulting to None. No production route and no minimum charge.",
    });

    expect(result.handled).toBe(true);
    expect(sessions.replaceBrief).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session_1", sourceText: expect.stringContaining("Explicit Product Intake correction") }));
    expect(replacement.brief.productIdentity.category).toMatchObject({ value: "Print Products", confidence: 100 });
    expect(replacement.brief.requiredOptions).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Lamination", required: true, selectionMode: "single", sampleValues: ["None", "Gloss", "Matte"], defaultChoice: "None" })]));
    expect([...replacement.brief.requiredOptions, ...replacement.brief.optionalOptions].some((option: any) => /^size$/i.test(option.label) || /^size$/i.test(option.normalizedGroup))).toBe(false);
    expect(result.cards.some((card) => card.kind === "action_proposal")).toBe(false);
    expect(result.cards.find((card) => card.kind === "product_options_summary")?.details?.items).toEqual(expect.arrayContaining(["Lamination", "Type: Single select", "Required: Yes", "Default: None", "Choices: None, Gloss, Matte"]));
  });
});
