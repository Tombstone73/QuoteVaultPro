import crypto from "crypto";

import { and, eq } from "drizzle-orm";

import {
  lineItemProofVersions,
  orderLineItems,
  orders,
  proofAccessTokens,
} from "@shared/schema";
import { sha256Hex } from "../lib/tokenHash";
import { resolveLineItemProofingTruth } from "./proofingService";

export type PortalProofStatus = "pending" | "approved" | "rejected" | "revision_requested";

export type ProofTokenApprovalState = {
  status: PortalProofStatus;
  isResolved: boolean;
  isOverridden: boolean;
  decisionId: string | null;
  overrideId: string | null;
};

export type ProofTokenValidationResult = {
  tokenRecord: {
    id: string;
    organizationId: string;
    lineItemId: string;
    proofVersionId: string;
    expiresAt: Date | string;
    revokedAt: Date | string | null;
    createdAt: Date | string;
    createdBy: string;
  };
  lineItem: {
    id: string;
    orderId: string;
    organizationId: string;
    workflowState: string;
    requiresProofApproval: boolean;
    approvedProofVersionId: string | null;
  };
  proofVersion: {
    id: string;
    orderId: string;
    lineItemId: string;
    proofFileId: string;
    versionNumber: number;
    status: string;
    sentToName: string | null;
    sentToEmail: string | null;
    createdAt: Date | string;
  };
  currentApprovalState: ProofTokenApprovalState;
};

function throwForbidden(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 403 });
}

function throwConflict(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 409 });
}

function normalizePortalProofStatus(args: {
  proofVersionStatus: string;
  decision: "approved" | "rejected" | "revision_requested" | null;
  isOverridden: boolean;
}): PortalProofStatus {
  if (args.isOverridden) return "approved";
  if (args.decision === "approved" || args.decision === "rejected" || args.decision === "revision_requested") {
    return args.decision;
  }
  if (args.proofVersionStatus === "awaiting_response") return "pending";
  if (args.proofVersionStatus === "approved") return "approved";
  if (args.proofVersionStatus === "rejected") return "rejected";
  if (args.proofVersionStatus === "revision_requested") return "revision_requested";
  // A superseded proof version (staff sent a newer version) has no recorded decision
  // against this version, but it is resolved from the customer's perspective.
  // Show it as read-only "revision_requested" — the closest public-facing resolved state.
  if (args.proofVersionStatus === "superseded") return "revision_requested";
  throwConflict("Proof token is not valid for the current proof state");
}

export async function createProofAccessToken(tx: any, args: {
  organizationId: string;
  lineItemId: string;
  proofVersionId: string;
  expiresAt: Date;
  createdBy: string;
}) {
  const [proofVersion] = await tx
    .select({
      id: lineItemProofVersions.id,
      organizationId: lineItemProofVersions.organizationId,
      lineItemId: lineItemProofVersions.lineItemId,
      status: lineItemProofVersions.status,
    })
    .from(lineItemProofVersions)
    .where(
      and(
        eq(lineItemProofVersions.id, args.proofVersionId),
        eq(lineItemProofVersions.organizationId, args.organizationId),
        eq(lineItemProofVersions.lineItemId, args.lineItemId),
      ),
    )
    .limit(1);

  if (!proofVersion) {
    throw Object.assign(new Error("Proof version not found"), { statusCode: 404 });
  }

  if (proofVersion.status !== "awaiting_response") {
    throwConflict("Proof access tokens can only be created for proof versions awaiting response");
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = sha256Hex(rawToken);

    try {
      const [created] = await tx
        .insert(proofAccessTokens)
        .values({
          organizationId: args.organizationId,
          lineItemId: args.lineItemId,
          proofVersionId: args.proofVersionId,
          token: tokenHash,
          expiresAt: args.expiresAt,
          createdBy: args.createdBy,
        })
        .returning();

      return {
        rawToken,
        tokenRecord: created,
      };
    } catch (error: any) {
      if (error?.code === "23505" && error?.constraint === "proof_access_tokens_token_uidx") {
        continue;
      }
      throw error;
    }
  }

  throw Object.assign(new Error("Failed to generate a unique proof access token"), { statusCode: 500 });
}

export async function validateProofToken(tx: any, rawToken: string): Promise<ProofTokenValidationResult> {
  const normalizedToken = String(rawToken ?? "").trim();
  if (!normalizedToken) {
    throwForbidden("Invalid proof token");
  }

  const tokenHash = sha256Hex(normalizedToken);

  const [tokenRecord] = await tx
    .select({
      id: proofAccessTokens.id,
      organizationId: proofAccessTokens.organizationId,
      lineItemId: proofAccessTokens.lineItemId,
      proofVersionId: proofAccessTokens.proofVersionId,
      expiresAt: proofAccessTokens.expiresAt,
      revokedAt: proofAccessTokens.revokedAt,
      createdAt: proofAccessTokens.createdAt,
      createdBy: proofAccessTokens.createdBy,
    })
    .from(proofAccessTokens)
    .where(eq(proofAccessTokens.token, tokenHash))
    .limit(1);

  if (!tokenRecord) {
    throwForbidden("Invalid proof token");
  }

  if (tokenRecord.revokedAt) {
    throwForbidden("Proof token has been revoked");
  }

  if (new Date(tokenRecord.expiresAt).getTime() <= Date.now()) {
    throwForbidden("Proof token has expired");
  }

  const [proofContext] = await tx
    .select({
      lineItemId: orderLineItems.id,
      orderId: orderLineItems.orderId,
      organizationId: orders.organizationId,
      workflowState: orderLineItems.workflowState,
      requiresProofApproval: orderLineItems.requiresProofApproval,
      approvedProofVersionId: orderLineItems.approvedProofVersionId,
      proofVersionId: lineItemProofVersions.id,
      proofFileId: lineItemProofVersions.proofFileId,
      versionNumber: lineItemProofVersions.versionNumber,
      proofStatus: lineItemProofVersions.status,
      sentToName: lineItemProofVersions.sentToName,
      sentToEmail: lineItemProofVersions.sentToEmail,
      proofCreatedAt: lineItemProofVersions.createdAt,
    })
    .from(lineItemProofVersions)
    .innerJoin(orderLineItems, eq(orderLineItems.id, lineItemProofVersions.lineItemId))
    .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
    .where(
      and(
        eq(lineItemProofVersions.id, tokenRecord.proofVersionId),
        eq(orderLineItems.id, tokenRecord.lineItemId),
        eq(orders.organizationId, tokenRecord.organizationId),
      ),
    )
    .limit(1);

  if (!proofContext) {
    throwForbidden("Invalid proof token");
  }

  if (proofContext.proofStatus === "draft") {
    // Draft proofs should never have tokens; this is an internal consistency error.
    throwConflict("Proof token is not valid for the current proof state");
  }
  // "superseded" is handled below in normalizePortalProofStatus → returns "revision_requested"
  // so the page renders as read-only resolved instead of an error.

  const truth = await resolveLineItemProofingTruth(tx, {
    organizationId: proofContext.organizationId,
    lineItemId: proofContext.lineItemId,
  });

  const matchedDecision = truth.proofDecisionHistory.find((approval) => approval.proofVersionId === proofContext.proofVersionId) ?? null;
  const matchedOverride = truth.manualApprovalOverrideHistory.find((override) => override.proofVersionId === proofContext.proofVersionId) ?? null;

  return {
    tokenRecord,
    lineItem: {
      id: proofContext.lineItemId,
      orderId: proofContext.orderId,
      organizationId: proofContext.organizationId,
      workflowState: proofContext.workflowState,
      requiresProofApproval: Boolean(proofContext.requiresProofApproval),
      approvedProofVersionId: proofContext.approvedProofVersionId,
    },
    proofVersion: {
      id: proofContext.proofVersionId,
      orderId: proofContext.orderId,
      lineItemId: proofContext.lineItemId,
      proofFileId: proofContext.proofFileId,
      versionNumber: proofContext.versionNumber,
      status: proofContext.proofStatus,
      sentToName: proofContext.sentToName ?? null,
      sentToEmail: proofContext.sentToEmail ?? null,
      createdAt: proofContext.proofCreatedAt,
    },
    currentApprovalState: {
      status: normalizePortalProofStatus({
        proofVersionStatus: proofContext.proofStatus,
        decision: matchedDecision?.decision ?? null,
        isOverridden: matchedOverride !== null,
      }),
      isResolved: matchedDecision !== null || matchedOverride !== null || proofContext.proofStatus !== "awaiting_response",
      isOverridden: matchedOverride !== null,
      decisionId: matchedDecision?.id ?? null,
      overrideId: matchedOverride?.id ?? null,
    },
  };
}