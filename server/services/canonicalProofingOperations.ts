import {
  markProofVersionSent,
  recordProofResponse,
} from "./proofingService";

/**
 * Shared proofing mutation boundary.  The proofing service remains the state
 * machine owner; this façade deliberately keeps route, portal, and future
 * confirmed-command adapters from reimplementing its transition rules.
 */
export class CanonicalProofingOperations {
  sendVersion(tx: any, input: {
    organizationId: string;
    proofVersionId: string;
    actorUserId: string;
    sentToName?: string | null;
    sentToEmail?: string | null;
    customerMessage?: string | null;
    customerVisibleDisclaimer?: string | null;
  }) {
    return markProofVersionSent(tx, input);
  }

  recordResponse(tx: any, input: {
    organizationId: string;
    proofVersionId: string;
    actorUserId?: string | null;
    responderName?: string | null;
    responderEmail?: string | null;
    responderSource?: string | null;
    decision: "approved" | "rejected" | "revision_requested";
    responseNotes?: string | null;
  }) {
    return recordProofResponse(tx, input);
  }
}

export const canonicalProofingOperations = new CanonicalProofingOperations();

export function renderCanonicalProofingOperationMigrationMarkdown() {
  return `# Shared canonical Proofing operations\n\n| Operation | Existing state owner | UI / portal use | AI status |\n|---|---|---|---|\n| \`proofing.send_version.v1\` | \`proofingService.markProofVersionSent\` and line-item workflow service | Staff proofing route | No normal Operator mutation is approved |\n| \`proofing.record_response.v1\` | \`proofingService.recordProofResponse\` and line-item workflow service | Staff and portal proof response | No normal Operator mutation is approved |\n\nProof policy configuration remains an explicit UI-only Order configuration surface. The façade does not create a second proof state machine or broaden AI authority.\n`;
}
