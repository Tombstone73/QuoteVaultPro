import { describe, expect, jest, test } from "@jest/globals";
import { AssistantProductIntakeAdapter, formatProductIntakeQuantityBehavior } from "../services/assistant/productIntakeAdapter";

function detail(overrides: Record<string, unknown> = {}) {
  return {
    session: { id: "session_1", status: "ready_for_draft", sourceType: "text_description", sourceFingerprint: "source_1", updatedAt: "2026-07-21T12:00:00.000Z", createdProductId: null, createdPbv2TreeVersionId: null },
    brief: { productIdentity: { likelyProductName: { value: "Window Decal" } }, quantityBehavior: { behavior: "per_piece", confidence: 100 } },
    readiness: { canCreateDraft: true, unansweredRequiredCount: 0, reviewState: "ready_for_draft", penalties: [] },
    ...overrides,
  };
}

function review(overrides: Record<string, unknown> = {}) {
  return {
    product: { id: "product_1", name: "Window Decal", isActive: false },
    pbv2Tree: { id: "tree_1", status: "DRAFT" },
    publishReadiness: { activeTreeAssigned: false },
    ...overrides,
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    sessionStore: { getSessionDetail: jest.fn(async () => detail()) },
    diagnosticsStore: { listRecent: jest.fn(async () => [{ rawAiResponse: "never-return", failedSchemaPaths: ["requiredOptions"], createdAt: "2026-07-21T12:00:00.000Z" }]) },
    draftCreator: { createDraftFromSession: jest.fn(async () => ({ productId: "product_1", pbv2TreeVersionId: "tree_1", draftQuality: {}, session: {} })) },
    draftReviewService: { getDraftReview: jest.fn(async () => review()) },
    ...overrides,
  };
}

describe("AssistantProductIntakeAdapter", () => {
  test("formats live structured quantity behavior before it reaches preview or confirmation DTOs", () => {
    expect(formatProductIntakeQuantityBehavior({ behavior: "per_piece", confidence: 100 }, false)).toEqual({ label: "Customer enters quantity", resolved: true });
    expect(formatProductIntakeQuantityBehavior({ behavior: "quantity_tiers", confidence: 90 }, false)).toEqual({ label: "Customer enters quantity", resolved: true });
    expect(formatProductIntakeQuantityBehavior({ behavior: "fixed_quantity", quantity: 12 }, false)).toEqual({ label: "Fixed quantity: 12", resolved: true });
    expect(formatProductIntakeQuantityBehavior({ confidence: 100 }, false)).toEqual({ label: "Unresolved", resolved: false });
  });

  test("carries the complete corrected category and Lamination contract into the proposal fingerprint", async () => {
    const correctedBrief: any = {
      productIdentity: { likelyProductName: { value: "DEV Test Vinyl Options 080326" }, category: { value: "Print Products" } },
      sizeBehavior: { behavior: "custom_size" }, quantityBehavior: { behavior: "per_piece" }, pricingAnalysis: { behavior: "square_foot" },
      requiredOptions: [{ label: "Lamination", normalizedGroup: "Lamination", required: true, selectionMode: "single", sampleValues: ["None", "Gloss", "Matte"], defaultChoice: "None" }], optionalOptions: [],
    };
    const sessionStore = { getSessionDetail: jest.fn(async () => detail({ brief: correctedBrief })) };
    const adapter = new AssistantProductIntakeAdapter(dependencies({ sessionStore }) as any);
    const proposal = await adapter.buildProposal({ organizationId: "org_1", sessionId: "session_1" });
    expect(proposal.preview.proposedFields).toMatchObject({ category: "Print Products", measurementMode: "custom_size", pricingModel: "square_foot", perSqftCents: null, productionRoute: null, minimumChargeCents: null, optionGroups: [{ label: "Lamination", required: true, selectionMode: "single", choices: ["None", "Gloss", "Matte"], defaultChoice: "None" }] });
    sessionStore.getSessionDetail.mockResolvedValue(detail({ brief: { ...correctedBrief, productIdentity: { ...correctedBrief.productIdentity, category: { value: "Vinyl Options" } } } }));
    const changed = await adapter.buildProposal({ organizationId: "org_1", sessionId: "session_1" });
    expect(changed.fingerprint).not.toBe(proposal.fingerprint);
  });

  test("exposes canonical quantity-only service-fee values in the confirmation proposal", async () => {
    const serviceBrief: any = {
      productIdentity: { likelyProductName: { value: "DEV Test Service 080426" }, category: { value: "Print Products" } },
      sizeBehavior: { behavior: "none" }, quantityBehavior: { behavior: "per_piece" }, pricingAnalysis: { behavior: "per_piece" },
      workflowIntent: "service_fee", requiresProductionJob: false, requiredOptions: [], optionalOptions: [],
    };
    const sessionStore = {
      getSessionDetail: jest.fn(async () => detail({ brief: serviceBrief })),
      getSessionSource: jest.fn(async () => ({ sourceText: "Create a quantity-only service fee at $20 per piece. It must not create production work.", sourceJson: null })),
    };
    const adapter = new AssistantProductIntakeAdapter(dependencies({ sessionStore }) as any);
    const proposal = await adapter.buildProposal({ organizationId: "org_1", sessionId: "session_1" });
    expect(proposal.preview.proposedFields).toMatchObject({ measurementMode: "quantity_only", quantityBehavior: "Customer enters quantity", workflowIntent: "service_fee", requiresProductionJob: false, productionRoute: null, sheetOrRollConstraints: null, allowRotation: null });
  });

  test("uses explicit corrected workflow decisions rather than stale source inference", async () => {
    const correctedBrief: any = {
      productIdentity: { likelyProductName: { value: "Flatbed Proof Product" }, category: { value: "Print Products" } },
      sizeBehavior: { behavior: "custom_size" }, quantityBehavior: { behavior: "per_piece" }, pricingAnalysis: { behavior: "square_foot" },
      materialSelection: "unset", requiresProofApproval: true, workflowIntent: "standard_production", requiresProductionJob: true, productionRoute: "Flatbed",
      requiredOptions: [], optionalOptions: [],
    };
    const sessionStore = {
      getSessionDetail: jest.fn(async () => detail({ brief: correctedBrief })),
      getSessionSource: jest.fn(async () => ({ sourceText: "Old request routes to Roll and selects material.", sourceJson: null })),
    };
    const adapter = new AssistantProductIntakeAdapter(dependencies({ sessionStore }) as any);
    const proposal = await adapter.buildProposal({ organizationId: "org_1", sessionId: "session_1" });
    expect(proposal.preview.proposedFields).toMatchObject({ material: null, productionRoute: "Flatbed", requiresProofApproval: true, requiresProductionJob: true, quantityBehavior: "Customer enters quantity" });
    sessionStore.getSessionDetail.mockResolvedValue(detail({ brief: { ...correctedBrief, requiresProofApproval: false } }));
    const proofRemoved = await adapter.buildProposal({ organizationId: "org_1", sessionId: "session_1" });
    expect(proofRemoved.preview.proposedFields.requiresProofApproval).toBe(false);
    expect(proofRemoved.fingerprint).not.toBe(proposal.fingerprint);
  });

  test("blocks an unrecognized live quantity object instead of serializing it", async () => {
    const malformedBrief: any = {
      productIdentity: { likelyProductName: { value: "Malformed Quantity" }, category: { value: "Print Products" } },
      sizeBehavior: { behavior: "custom_size" }, quantityBehavior: { confidence: 100 }, pricingAnalysis: { behavior: "square_foot" },
      materialSelection: "unset", requiresProofApproval: true, workflowIntent: "standard_production", requiresProductionJob: true, productionRoute: "Flatbed", requiredOptions: [], optionalOptions: [],
    };
    const adapter = new AssistantProductIntakeAdapter(dependencies({ sessionStore: { getSessionDetail: jest.fn(async () => detail({ brief: malformedBrief })) } }) as any);
    const proposal = await adapter.buildProposal({ organizationId: "org_1", sessionId: "session_1" });
    expect(proposal.preview.proposedFields.quantityBehavior).toBe("Unresolved");
    expect(proposal.executable).toBe(false);
    expect(JSON.stringify(proposal)).not.toContain("[object");
  });

  test("loads tenant-scoped authoritative readiness and redacts raw diagnostics", async () => {
    const deps = dependencies();
    const adapter = new AssistantProductIntakeAdapter(deps as any);
    const result = await adapter.loadSession({ organizationId: "org_1", sessionId: "session_1" });
    expect(result).toEqual(expect.objectContaining({ sessionId: "session_1", status: "ready_for_draft", diagnostics: { count: 1, failedSchemaPaths: ["requiredOptions"], latestCreatedAt: "2026-07-21T12:00:00.000Z" } }));
    expect(JSON.stringify(result)).not.toContain("never-return");
    expect(deps.sessionStore.getSessionDetail).toHaveBeenCalledWith("org_1", "session_1");
  });

  test("does not create a draft when canonical session readiness is not ready", async () => {
    const deps = dependencies({ sessionStore: { getSessionDetail: jest.fn(async () => detail({ session: { id: "session_1", status: "awaiting_answers", createdProductId: null, createdPbv2TreeVersionId: null }, readiness: { canCreateDraft: false, unansweredRequiredCount: 1, penalties: [] } })) } });
    const adapter = new AssistantProductIntakeAdapter(deps as any);
    await expect(adapter.createInactiveDraft({ organizationId: "org_1", userId: "user_1", sessionId: "session_1", planId: "plan_1" })).rejects.toMatchObject({ errorCode: "INTAKE_NOT_READY" });
    expect(deps.draftCreator.createDraftFromSession).not.toHaveBeenCalled();
  });

  test("builds a reduced inactive-only proposal and detects a changed session fingerprint", async () => {
    const sessionStore = { getSessionDetail: jest.fn(async () => detail({ session: { id: "session_1", status: "ready_for_draft", sourceType: "text_description", sourceFingerprint: "source_1", updatedAt: "2026-07-21T12:00:00.000Z", createdProductId: null, createdPbv2TreeVersionId: null }, brief: { productIdentity: { likelyProductName: { value: "Window Decal" } }, quantityBehavior: { behavior: "per_piece", confidence: 100 } } })) };
    const adapter = new AssistantProductIntakeAdapter(dependencies({ sessionStore }) as any);
    const proposal = await adapter.buildProposal({ organizationId: "org_1", sessionId: "session_1" });
    expect(proposal).toEqual(expect.objectContaining({ productName: "Window Decal", executable: true, fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/), sourceLink: { label: "Open Product Intake review", href: "/admin/product-intake/sessions/session_1/review" } }));
    expect(proposal.preview.summary).toContain("activation remain separate");
    sessionStore.getSessionDetail.mockResolvedValue(detail({ session: { id: "session_1", status: "ready_for_draft", sourceType: "text_description", sourceFingerprint: "source_1", updatedAt: "2026-07-21T12:01:00.000Z", createdProductId: null, createdPbv2TreeVersionId: null }, brief: { productIdentity: { likelyProductName: { value: "Window Decal" } }, quantityBehavior: { behavior: "per_piece", confidence: 100 } } }));
    await expect(adapter.revalidateProposal({ organizationId: "org_1", sessionId: "session_1", expectedFingerprint: proposal.fingerprint })).resolves.toMatchObject({ valid: false, code: "PRODUCT_INTAKE_SESSION_CHANGED" });
  });

  test("delegates creation to canonical creator and requires inactive DRAFT output", async () => {
    const planResultStore = { get: jest.fn(async () => null), put: jest.fn(async () => undefined) };
    const deps = dependencies({ planResultStore });
    const adapter = new AssistantProductIntakeAdapter(deps as any);
    const result = await adapter.createInactiveDraft({ organizationId: "org_1", userId: "user_1", userName: "Staff", sessionId: "session_1", planId: "plan_1" });
    expect(result).toEqual({ productId: "product_1", pbv2TreeVersionId: "tree_1", productName: "Window Decal", productIsActive: false, pbv2Status: "DRAFT", reused: false });
    expect(deps.draftCreator.createDraftFromSession).toHaveBeenCalledWith({ organizationId: "org_1", sessionId: "session_1", userId: "user_1", userName: "Staff" });
    expect(planResultStore.put).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org_1", planId: "plan_1" }));
  });

  test("forwards confirmation-bound plan metadata to the canonical draft audit", async () => {
    const deps = dependencies();
    const adapter = new AssistantProductIntakeAdapter(deps as any);
    await adapter.createInactiveDraft({
      organizationId: "org_1", userId: "user_1", sessionId: "session_1", planId: "plan_1",
      idempotencyKey: "plan:plan_1", correlationId: "correlation_1",
    });
    expect(deps.draftCreator.createDraftFromSession).toHaveBeenCalledWith(expect.objectContaining({
      assistantAudit: {
        command: "products.create_inactive_draft@v1", planId: "plan_1", idempotencyKey: "plan:plan_1",
        correlationId: "correlation_1", confirmationConsumed: true,
      },
    }));
  });

  test("reuses a durable plan-bound result without invoking the creator", async () => {
    const planResultStore = { get: jest.fn(async () => ({ productId: "product_1", pbv2TreeVersionId: "tree_1", productName: "Window Decal", productIsActive: false as const, pbv2Status: "DRAFT" as const, reused: false })), put: jest.fn() };
    const deps = dependencies({ planResultStore });
    const adapter = new AssistantProductIntakeAdapter(deps as any);
    await expect(adapter.createInactiveDraft({ organizationId: "org_1", userId: "user_1", sessionId: "session_1", planId: "plan_1" })).resolves.toMatchObject({ reused: true });
    expect(deps.draftCreator.createDraftFromSession).not.toHaveBeenCalled();
  });

  test("rejects a creator result if the review reports activation or an active tree", async () => {
    const deps = dependencies({ draftReviewService: { getDraftReview: jest.fn(async () => review({ product: { id: "product_1", name: "Window Decal", isActive: true }, pbv2Tree: { id: "tree_1", status: "ACTIVE" }, publishReadiness: { activeTreeAssigned: true } })) } });
    const adapter = new AssistantProductIntakeAdapter(deps as any);
    await expect(adapter.createInactiveDraft({ organizationId: "org_1", userId: "user_1", sessionId: "session_1", planId: "plan_1" })).rejects.toMatchObject({ errorCode: "INTAKE_DRAFT_NOT_INACTIVE" });
  });
});
