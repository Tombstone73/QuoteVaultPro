import type { RequestHandler } from "express";
import { getRequestOrganizationId } from "../tenantContext";
import { OrganizationAssistantCapabilityResolver } from "../services/assistant/assistantCapabilities";

export function requireAssistantEnabled(settings: Pick<OrganizationAssistantCapabilityResolver, "isEnabled"> = new OrganizationAssistantCapabilityResolver()): RequestHandler {
  return async (req, res, next) => {
    try {
      // Re-read on every request, including GO and replay. Never trust a plan's older snapshot.
      if (await settings.isEnabled(getRequestOrganizationId(req))) { next(); return; }
      res.status(503).json({ success: false, error: { code: "assistant_disabled", message: "The assistant is disabled for this organization.", retryable: false } });
    } catch {
      res.status(503).json({ success: false, error: { code: "assistant_unavailable", message: "Could not verify assistant availability.", retryable: true } });
    }
  };
}
