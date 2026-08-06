import { ProductIntentPersistenceError, type CanonicalProductIntentSession } from "../productIntentCompiler/productIntentPersistence";

/**
 * Narrow, persisted-session compatibility boundary for product conversations
 * created before the canonical Product Intent discriminator existed.
 *
 * This adapter deliberately does not accept a message.  It can therefore
 * neither classify a new request nor invoke any of the removed keyword-based
 * product routers.  The only positive legacy signal is the persisted proposal
 * row that fails the canonical kind/version discriminator.
 */
export interface LegacySessionCanonicalProbe {
  loadForConversation(input: {
    organizationId: string;
    actorUserId: string;
    conversationId: string;
  }): Promise<CanonicalProductIntentSession | null>;
}

export type LegacyAssistantSessionCompatibilityResult =
  | { kind: "not_legacy" }
  | { kind: "legacy_session"; response: string };

export class LegacyAssistantSessionCompatibility {
  async inspect(input: {
    organizationId: string;
    actorUserId: string;
    conversationId: string;
    canonicalProbe: LegacySessionCanonicalProbe;
    correlationId?: string;
  }): Promise<LegacyAssistantSessionCompatibilityResult> {
    try {
      await input.canonicalProbe.loadForConversation({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        conversationId: input.conversationId,
      });
      return { kind: "not_legacy" };
    } catch (error) {
      if (!(error instanceof ProductIntentPersistenceError) || error.code !== "PRODUCT_INTENT_LEGACY_SESSION") {
        throw error;
      }

      console.info("[LEGACY_ASSISTANT_SESSION_COMPATIBILITY] Persisted legacy product session inspected.", {
        correlationId: input.correlationId ?? null,
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        adapter: "persisted_product_proposal_discriminator",
        action: "safe_unavailable_response",
      });
      return {
        kind: "legacy_session",
        response: "This conversation contains a pre-canonical product proposal that cannot be safely continued through the current assistant. No product was changed. Start a new product request to use the canonical Product Builder.",
      };
    }
  }
}
