import type { ProofArtifactKind, ProofArtifactPreviewStatus, ProofVersionStatus } from "@shared/proofing";

export function canGeneratePreviewRecovery(args: {
  hasSourceArtwork: boolean;
  previewStatus: ProofArtifactPreviewStatus | null | undefined;
}) {
  if (!args.hasSourceArtwork) return false;
  return args.previewStatus === "missing_preview" || args.previewStatus === "generation_failed";
}

export function canRegenerateGeneratedProof(args: {
  artifactKind: ProofArtifactKind | null | undefined;
  hasSourceArtwork: boolean;
  previewStatus: ProofArtifactPreviewStatus | null | undefined;
  previewRecoveryReady: boolean;
}) {
  if (!args.previewRecoveryReady || !args.hasSourceArtwork) return false;
  if (args.artifactKind !== "generated") return false;
  return args.previewStatus === "missing_preview" || args.previewStatus === "generation_failed";
}

export function getGenerateProofDraftDisabledReason(args: {
  hasEligibleArtwork: boolean;
  hasBlockingSentProof?: boolean;
  hasPermission?: boolean;
  previewGenerationAvailable?: boolean;
  unsupportedFileType?: boolean;
  schemaReady?: boolean;
}): string | null {
  if (args.hasPermission === false) return "permission missing";
  if (args.schemaReady === false) return "migration/schema missing";
  if (args.hasBlockingSentProof) return "existing sent proof must be cancelled or revised first";
  if (!args.hasEligibleArtwork) return "no artwork found";
  if (args.unsupportedFileType) return "unsupported file type";
  if (args.previewGenerationAvailable === false) return "preview generation unavailable";
  return null;
}

export function getProofVersionRecoveryStatusLabel(status: ProofVersionStatus | null | undefined): string {
  switch (status) {
    case "awaiting_response":
      return "Awaiting Customer Approval";
    case "cancelled":
      return "Cancelled";
    case "superseded":
      return "Superseded / Replaced";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "revision_requested":
      return "Revision Requested";
    case "draft":
    default:
      return "Ready to Send";
  }
}

export function getProofVersionRecoveryStatusNote(status: ProofVersionStatus | null | undefined): string | null {
  if (status === "cancelled") {
    return "This proof version was cancelled by staff and is no longer customer-actionable.";
  }
  if (status === "superseded") {
    return "This proof version was replaced by a newer sent proof and is no longer customer-actionable.";
  }
  if (status === "draft") {
    return "This version is still draft and ready to send.";
  }
  return null;
}
