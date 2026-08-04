import { jest } from "@jest/globals";

jest.mock("../db", () => ({ db: {} }));

import { ProductManagementSkillService } from "../services/assistant/productManagementSkill";
import type { ProductIntakeSessionDetail } from "../../shared/productIntakeWizardSchemas";

const multilineRequest = `Create a new inactive product called DEV Test Vinyl Options 080326B.

Use the Print Products category.

Customers must enter width and height.

Price it at $3.00 per square foot.

Add one required single-select option named Lamination with these choices:
- None
- Gloss
- Matte

Set None as the default.

Do not set production routing, sheet settings, rotation, or a minimum charge.

Show me the complete product before GO.`;

function sessionDetail(brief: any): ProductIntakeSessionDetail {
  return {
    session: {
      id: "session_single_request", organizationId: "org_1", sourceType: "text_description", sourceFingerprint: "fingerprint", brief,
      confidence: {}, missingDecisions: brief.missingDecisions, status: "needs_answers", createdProductId: null, createdPbv2TreeVersionId: null,
      createdByUserId: "user_1", updatedByUserId: "user_1", createdAt: "2026-08-03T00:00:00.000Z", updatedAt: "2026-08-03T00:00:00.000Z", abandonedAt: null,
    },
    brief, questions: [], answers: [],
    readiness: { unansweredRequiredCount: 1, answeredCount: 0, canCreateDraft: false, status: "needs_answers", reviewState: "needs_review", penalties: [] },
  } as ProductIntakeSessionDetail;
}

describe("Product Intake single-request routing", () => {
  test("creates exactly one session for a multiline product request and preserves its configuration", async () => {
    const createFromAnalysis = jest.fn(async (input: any) => sessionDetail(input.brief));
    const findProductsByNormalizedName = jest.fn().mockResolvedValue([]);
    const service = new ProductManagementSkillService({
      sessions: { createFromAnalysis } as any,
      references: jest.fn().mockResolvedValue({ materials: [], templates: [] }),
      findProductsByNormalizedName,
    });

    const result = await service.respond({ organizationId: "org_1", userId: "user_1", message: multilineRequest });

    expect(result.handled).toBe(true);
    expect(createFromAnalysis).toHaveBeenCalledTimes(1);
    expect(findProductsByNormalizedName).toHaveBeenCalledTimes(1);
    const brief = createFromAnalysis.mock.calls[0]![0].brief;
    expect(brief.productIdentity.likelyProductName.value).toBe("DEV Test Vinyl Options 080326B");
    expect(brief.productIdentity.category.value).toBe("Print Products");
    expect(brief.sizeBehavior.behavior).toBe("custom_size");
    expect(brief.pricingAnalysis.behavior).toBe("square_foot");
    expect(brief.requiredOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Lamination", required: true, selectionMode: "single", sampleValues: ["None", "Gloss", "Matte"], defaultChoice: "None" }),
    ]));
    expect(result.cards.some((card) => card.kind === "action_proposal")).toBe(false);
  });

  test("asks for clarification without creating sessions when batch intent is ambiguous", async () => {
    const createFromAnalysis = jest.fn();
    const findProductsByNormalizedName = jest.fn();
    const service = new ProductManagementSkillService({
      sessions: { createFromAnalysis } as any,
      references: jest.fn().mockResolvedValue({ materials: [], templates: [] }),
      findProductsByNormalizedName,
    });

    const result = await service.respond({ organizationId: "org_1", userId: "user_1", message: "Create several products with these settings." });

    expect(result).toMatchObject({ handled: true, response: "Are you creating one product with these settings, or several separate products?", cards: [] });
    expect(createFromAnalysis).not.toHaveBeenCalled();
    expect(findProductsByNormalizedName).not.toHaveBeenCalled();
  });
});
