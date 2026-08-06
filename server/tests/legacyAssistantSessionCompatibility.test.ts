import { describe, expect, jest, test } from "@jest/globals";
import { LegacyAssistantSessionCompatibility } from "../services/assistant/legacyAssistantSessionCompatibility";
import { ProductManagementSkillService, type CanonicalProductIntentRouter } from "../services/assistant/productManagementSkill";
import { ProductIntentPersistenceError } from "../services/productIntentCompiler/productIntentPersistence";

describe("LegacyAssistantSessionCompatibility", () => {
  test("uses only the persisted canonical discriminator and never accepts message text", async () => {
    const compatibility = new LegacyAssistantSessionCompatibility();
    const canonicalProbe = {
      loadForConversation: jest.fn(async () => {
        throw new ProductIntentPersistenceError("PRODUCT_INTENT_LEGACY_SESSION", "legacy");
      }),
    };

    const result = await compatibility.inspect({
      organizationId: "org_1",
      actorUserId: "user_1",
      conversationId: "conversation_1",
      canonicalProbe,
      correlationId: "correlation_1",
    });

    expect(result.kind).toBe("legacy_session");
    expect(canonicalProbe.loadForConversation).toHaveBeenCalledWith({
      organizationId: "org_1",
      actorUserId: "user_1",
      conversationId: "conversation_1",
    });
    expect(JSON.stringify(result)).not.toContain("message");
  });

  test("does not classify ordinary conversations as legacy", async () => {
    const compatibility = new LegacyAssistantSessionCompatibility();

    await expect(compatibility.inspect({
      organizationId: "org_1",
      actorUserId: "user_1",
      conversationId: "conversation_1",
      canonicalProbe: { loadForConversation: jest.fn(async () => null) },
    })).resolves.toEqual({ kind: "not_legacy" });
  });

  test("does not swallow canonical authorization or persistence failures", async () => {
    const compatibility = new LegacyAssistantSessionCompatibility();
    const failure = new ProductIntentPersistenceError("PRODUCT_INTENT_ACTOR_MISMATCH", "actor mismatch");

    await expect(compatibility.inspect({
      organizationId: "org_1",
      actorUserId: "user_1",
      conversationId: "conversation_1",
      canonicalProbe: { loadForConversation: jest.fn(async () => { throw failure; }) },
    })).rejects.toBe(failure);
  });

  test("a planner-selected legacy continuation cannot re-enter the general product router", async () => {
    const legacyFailure = new ProductIntentPersistenceError("PRODUCT_INTENT_LEGACY_SESSION", "legacy");
    const router = {
      loadForConversation: jest.fn(async () => { throw legacyFailure; }),
      create: jest.fn(),
      continue: jest.fn(),
    } satisfies CanonicalProductIntentRouter & Record<string, jest.Mock>;
    const service = new ProductManagementSkillService({
      sessions: {} as any,
      references: jest.fn(async () => ({ materials: [], templates: [] })),
      canonicalProductIntent: router,
    });
    expect(service).not.toHaveProperty("respond");

    const result = await service.respondPlannedCanonicalProductIntent({
      organizationId: "org_1",
      userId: "user_1",
      conversationId: "conversation_1",
      message: "continue with the old product",
      operation: "continue_session",
    });

    expect(result.response).toContain("pre-canonical product proposal");
    expect(router.continue).not.toHaveBeenCalled();
    expect(router.create).not.toHaveBeenCalled();
  });
});
