import { isWorkerEnabled } from "../../workers/workerGates";

export function inboundEmailProcessingOrganizations(): string[] {
  return Array.from(new Set((process.env.INBOUND_EMAIL_AUTO_DRAFT_ORGANIZATION_IDS ?? "").split(",").map(value => value.trim()).filter(value => value && value !== "*")));
}
export function isInboundEmailProcessingEnabled(organizationId?: string): boolean {
  const organizations = inboundEmailProcessingOrganizations();
  return isWorkerEnabled("INBOUND_EMAIL_DRAFTS", false) && organizations.length > 0
    && (!organizationId || organizations.includes(organizationId));
}
