import type { PrincipalKind } from "../../authorization/principals.js";
import type { ArtworkAssignmentId, ArtworkFileId, CustomerId, OrderId, OrderLineId, OrganizationId, ProofResponseId, ProofVersionId, ProofWorkId } from "../shared/commercialValues.js";

/** Proofing owns review history, never Artwork identity or Route state. */
export type ProofOutcome = "approved" | "revision_requested";
export type ProofResponseOrigin = "direct" | "staff_recorded_customer";

export type ProofWork = Readonly<{
  proofWorkId: ProofWorkId; organizationId: OrganizationId; orderId: OrderId; orderLineId: OrderLineId;
  createdAt: string; createdPrincipalKind: PrincipalKind; createdPrincipalSubject: string; createdStaffActorUserId?: string;
}>;
export type ProofVersionArtwork = Readonly<{
  position: number; artworkAssignmentId: ArtworkAssignmentId; artworkFileId: ArtworkFileId;
}>;
export type ProofVersion = Readonly<{
  proofVersionId: ProofVersionId; organizationId: OrganizationId; proofWorkId: ProofWorkId; sequence: number;
  artwork: readonly ProofVersionArtwork[]; createdAt: string; createdPrincipalKind: PrincipalKind; createdPrincipalSubject: string; createdStaffActorUserId?: string;
  issuedAt?: string; issuedPrincipalKind?: PrincipalKind; issuedPrincipalSubject?: string; issuedStaffActorUserId?: string;
}>;
export type ProofResponse = Readonly<{
  proofResponseId: ProofResponseId; organizationId: OrganizationId; proofVersionId: ProofVersionId; outcome: ProofOutcome;
  comment?: string; origin: ProofResponseOrigin; recordedCustomerId?: CustomerId;
  respondedAt: string; responderPrincipalKind: PrincipalKind; responderPrincipalSubject: string; responderStaffActorUserId?: string;
}>;
export type ProofVersionProjection = Readonly<{ version: ProofVersion; response?: ProofResponse }>;
export type ProofWorkProjection = Readonly<{ work: ProofWork; versions: readonly ProofVersionProjection[] }>;

export type StartProofWorkInput = Readonly<{ businessRequestId: string; orderId: OrderId; orderLineId: OrderLineId }>;
export type CreateProofVersionInput = Readonly<{ businessRequestId: string; proofWorkId: ProofWorkId; artworkAssignmentIds: readonly ArtworkAssignmentId[] }>;
export type IssueProofVersionInput = Readonly<{ businessRequestId: string; proofVersionId: ProofVersionId }>;
export type RespondToProofInput = Readonly<{
  businessRequestId: string; proofVersionId: ProofVersionId; outcome: ProofOutcome; comment?: string;
  /** A Staff actor can truthfully record a known customer response without impersonating that customer. */
  recordedCustomerId?: CustomerId;
}>;

export const validateProofComment = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > 8_000) throw new Error("Proof feedback must not exceed 8,000 characters.");
  return normalized;
};
