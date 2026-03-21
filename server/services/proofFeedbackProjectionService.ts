import { proofFeedbackProjectionRepository } from "../storage/proofFeedbackProjection.repo";

const RESPONSE_SNIPPET_LIMIT = 180;

const trimNullable = (value: string | null | undefined): string | null => {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
};

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const formatDecisionLabel = (value: string): string => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "Unknown";
  return normalized
    .split("_")
    .map((segment) => (segment ? `${segment[0].toUpperCase()}${segment.slice(1)}` : ""))
    .join(" ");
};

const buildResponseSnippet = (responseNotes: string | null, decision: string): string => {
  if (responseNotes) {
    const collapsed = collapseWhitespace(responseNotes);
    if (collapsed.length <= RESPONSE_SNIPPET_LIMIT) {
      return collapsed;
    }

    return `${collapsed.slice(0, RESPONSE_SNIPPET_LIMIT - 1).trimEnd()}...`;
  }

  return `${formatDecisionLabel(decision)} without written feedback.`;
};

const deriveResponderRole = (args: {
  responderRole: string | null;
  responderSource: string | null;
}): string | null => {
  const normalizedRole = trimNullable(args.responderRole);
  if (normalizedRole) {
    return normalizedRole;
  }

  return trimNullable(args.responderSource);
};

export type LatestProofFeedbackProjection = {
  decision: string;
  responseNotes: string | null;
  responseSnippet: string;
  responderName: string | null;
  responderRole: string | null;
  respondedAt: string;
  versionId: string;
  versionNumber: number;
};

export async function getLatestProofFeedbackByLineItemId(args: {
  organizationId: string;
  lineItemId: string;
  executor?: any;
}): Promise<LatestProofFeedbackProjection | null> {
  const row = await proofFeedbackProjectionRepository.getLatestByLineItemId(
    args.organizationId,
    args.lineItemId,
    args.executor,
  );

  if (!row) {
    return null;
  }

  const responseNotes = trimNullable(row.responseNotes);
  const responderName = trimNullable(row.responderName) ?? trimNullable(row.responderEmail);

  return {
    decision: row.decision,
    responseNotes,
    responseSnippet: buildResponseSnippet(responseNotes, row.decision),
    responderName,
    responderRole: deriveResponderRole({
      responderRole: row.responderRole,
      responderSource: row.responderSource,
    }),
    respondedAt: row.respondedAt.toISOString(),
    versionId: row.versionId,
    versionNumber: row.versionNumber,
  };
}