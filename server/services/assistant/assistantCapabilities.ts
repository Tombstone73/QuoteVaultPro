import { DrizzleAiFoundationRepository, type AiFoundationRepository } from "../../storage/aiFoundation.repo";
import type { AssistantCapabilityResolver } from "./assistantService";

/**
 * Stage 1 intentionally reuses the organization AI kill switch.  It does not
 * resolve a provider or load a key: conversations are local foundation data
 * and the only response is the fixed no-tools notice.
 */
export class OrganizationAssistantCapabilityResolver implements AssistantCapabilityResolver {
  constructor(private readonly aiSettings: AiFoundationRepository = new DrizzleAiFoundationRepository()) {}

  async getCapabilities(organizationId: string) {
    const settings = await this.aiSettings.getSettings(organizationId);
    const enabled = Boolean(settings?.isEnabled);
    return {
      enabled,
      unavailableReason: enabled ? null : "The assistant is disabled for this organization.",
    };
  }
}
