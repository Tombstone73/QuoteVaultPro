import { jest } from "@jest/globals";
import { classifyCanonicalSessionMessage, ProductManagementSkillService, type CanonicalProductIntentRouter } from "../services/assistant/productManagementSkill";
import type { CanonicalProductIntentInspection, CanonicalProductIntentOutcome } from "../services/productIntentCompiler/canonicalProductIntentService";

const fingerprint = "a".repeat(64);

function inspection(state: "ready_for_review" | "awaiting_confirmation" = "ready_for_review"): CanonicalProductIntentInspection {
  const session: any = {
    proposalId: "proposal-1", organizationId: "org-1", actorUserId: "user-1", conversationId: "conversation-1", fingerprint, status: state,
    specification: { session: { state, currentRevision: 2, confirmationRevision: state === "awaiting_confirmation" ? 2 : null, revisions: [{ intent: { revision: 2 } }] }, resolutionMetadata: { dismissedRecommendationIds: [] } },
  };
  return {
    session,
    issues: [],
    card: {
      kind: "canonical_product_intent_proposal", revision: 2, fingerprint, title: "Create inactive draft: Yard Signs Test 7",
      readiness: { ready: true, blockers: [], questions: [] }, requiredQuestions: [], candidateResolutions: [],
      optionalRecommendations: [{ id: "rec-proof", revision: 2, fingerprint, kind: "enable_proof_approval", title: "Require proof approval", description: "Add proof approval before production begins.", reason: "Optional", source: "canonical_rule", dismissible: true, patch: { contractVersion: 1, baseRevision: 2, preserveUnchanged: true, operations: [] } } as any],
      fields: { Product: "Yard Signs Test 7", Category: "Flatbed Printing", Measurement: "Quantity only", Quantity: "Customer enters quantity", Pricing: "Per piece matrix (4 prices)", Options: ["Thickness: 3mm, 6mm", "Sides: Single-sided, Double-sided"], Proof: "Not required", "Production route": "Not set", Lifecycle: "Inactive draft" },
    },
  };
}

function routerFor(view = inspection()) {
  const continued: CanonicalProductIntentOutcome = { ok: true, session: view.session, issues: view.issues, card: view.card };
  return {
    loadForConversation: jest.fn(async () => view.session),
    inspect: jest.fn(async () => view),
    continue: jest.fn(async () => continued),
    create: jest.fn(async () => continued),
    interact: jest.fn(),
  } satisfies CanonicalProductIntentRouter & Record<string, jest.Mock>;
}

function service(router: CanonicalProductIntentRouter) {
  return new ProductManagementSkillService({ sessions: {} as any, references: jest.fn(async () => ({ materials: [], templates: [] })), canonicalProductIntent: router });
}

describe("canonical Product Intent active-session inquiries", () => {
  test.each([
    "Are there any other questions?", "Any other questions?", "Is anything missing?", "Is this ready?", "What do you still need?", "What is still missing?", "Can I use GO?", "Can I create it now?", "What happens if I click GO?",
  ])("classifies %p as a read-only session-status inquiry", (message) => {
    expect(classifyCanonicalSessionMessage(message)).toBe("ask_session_status");
  });

  test.each([
    "What pricing did I choose?", "What is the pricing?", "Is proof required?", "Did Flatbed work?", "Did the category selection work?", "What category is selected?", "What options did I choose?",
  ])("classifies %p as a read-only current-product inquiry", (message) => {
    expect(classifyCanonicalSessionMessage(message)).toBe("ask_about_current_product");
  });

  test("answers the Yard Signs status inquiry from the latest card without a patch, revision, product, or provider call", async () => {
    const router = routerFor();
    const result = await service(router).respond({ organizationId: "org-1", userId: "user-1", conversationId: "conversation-1", message: "Are there any other questions?" });

    expect(result).toMatchObject({ handled: true, response: expect.stringContaining("No required questions remain") });
    expect(result.response).toContain("optional suggestion");
    expect(router.inspect).toHaveBeenCalledTimes(1);
    expect(router.continue).not.toHaveBeenCalled();
    expect(router.create).not.toHaveBeenCalled();
    expect(result.cards).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "canonical_product_intent_proposal" }), expect.objectContaining({ kind: "action_proposal", plan: expect.objectContaining({ action: "products.create_from_canonical_intent", revision: 2, fingerprint }) })]));
  });

  test("answers current-product inquiries from canonical presentation fields without changing the revision or fingerprint", async () => {
    const router = routerFor();
    const productService = service(router);
    for (const message of ["What pricing did I choose?", "Is proof required?", "Did Flatbed work?"]) {
      const result = await productService.respond({ organizationId: "org-1", userId: "user-1", conversationId: "conversation-1", message });
      expect(result.response).toContain("Flatbed Printing");
      expect(result.response).toContain("Per piece matrix");
      expect(result.response).toContain("Not required");
      expect(result.response).toContain("Not set");
    }
    expect(router.continue).not.toHaveBeenCalled();
    expect(router.inspect).toHaveBeenCalledTimes(3);
  });

  test("preserves an awaiting confirmation state and returns a clarification for an uncertain question", async () => {
    const router = routerFor(inspection("awaiting_confirmation"));
    const productService = service(router);
    const status = await productService.respond({ organizationId: "org-1", userId: "user-1", conversationId: "conversation-1", message: "Can I use GO?" });
    const uncertain = await productService.respond({ organizationId: "org-1", userId: "user-1", conversationId: "conversation-1", message: "Can you tell me a joke?" });
    expect(status.response).toContain("awaiting confirmation");
    expect(uncertain.response).toContain("current product configuration");
    expect(router.continue).not.toHaveBeenCalled();
  });

  test("keeps required answers and corrections on the mutating continuation path, while a separate new request is not merged", async () => {
    const router = routerFor();
    const productService = service(router);
    await productService.respond({ organizationId: "org-1", userId: "user-1", conversationId: "conversation-1", message: "Per piece" });
    await productService.respond({ organizationId: "org-1", userId: "user-1", conversationId: "conversation-1", message: "Change it to per square foot" });
    const separate = await productService.respond({ organizationId: "org-1", userId: "user-1", conversationId: "conversation-1", message: "Create a new product called Other Signs" });
    expect(router.continue).toHaveBeenCalledTimes(2);
    expect(router.create).not.toHaveBeenCalled();
    expect(separate.response).toContain("separate conversation");
  });
});
