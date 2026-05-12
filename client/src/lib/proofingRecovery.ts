import type { ProofArtifactKind, ProofArtifactPreviewStatus } from "@shared/proofing";

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
