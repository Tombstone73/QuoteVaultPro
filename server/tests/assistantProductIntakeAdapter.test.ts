import { describe, expect, jest, test } from "@jest/globals";
import { AssistantProductIntakeAdapter } from "../services/assistant/productIntakeAdapter";

function detail(overrides: Record<string, unknown> = {}) {
  return {
    session: { id: "session_1", status: "ready_for_draft", sourceType: "text_description", sourceFingerprint: "source_1", updatedAt: "2026-07-21T12:00:00.000Z", createdProductId: null, createdPbv2TreeVersionId: null },
    brief: { productIdentity: { likelyProductName: { value: "Window Decal" } } },
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
    const sessionStore = { getSessionDetail: jest.fn(async () => detail({ session: { id: "session_1", status: "ready_for_draft", sourceType: "text_description", sourceFingerprint: "source_1", updatedAt: "2026-07-21T12:00:00.000Z", createdProductId: null, createdPbv2TreeVersionId: null }, brief: { productIdentity: { likelyProductName: { value: "Window Decal" } } } })) };
    const adapter = new AssistantProductIntakeAdapter(dependencies({ sessionStore }) as any);
    const proposal = await adapter.buildProposal({ organizationId: "org_1", sessionId: "session_1" });
    expect(proposal).toEqual(expect.objectContaining({ productName: "Window Decal", executable: true, fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/), sourceLink: { label: "Open Product Intake review", href: "/admin/product-intake/sessions/session_1/review" } }));
    expect(proposal.preview.summary).toContain("activation remain separate");
    sessionStore.getSessionDetail.mockResolvedValue(detail({ session: { id: "session_1", status: "ready_for_draft", sourceType: "text_description", sourceFingerprint: "source_1", updatedAt: "2026-07-21T12:01:00.000Z", createdProductId: null, createdPbv2TreeVersionId: null }, brief: { productIdentity: { likelyProductName: { value: "Window Decal" } } } }));
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
