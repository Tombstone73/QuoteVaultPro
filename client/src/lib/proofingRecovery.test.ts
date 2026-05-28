import { describe, expect, test } from "@jest/globals";

import { canGeneratePreviewRecovery, canRegenerateGeneratedProof, getGenerateProofDraftDisabledReason } from "./proofingRecovery";

describe("proofing recovery helpers", () => {
  test("shows generate preview only for incomplete proofs with saved artwork", () => {
    expect(canGeneratePreviewRecovery({ hasSourceArtwork: true, previewStatus: "missing_preview" })).toBe(true);
    expect(canGeneratePreviewRecovery({ hasSourceArtwork: true, previewStatus: "generation_failed" })).toBe(true);
    expect(canGeneratePreviewRecovery({ hasSourceArtwork: true, previewStatus: "ready" })).toBe(false);
    expect(canGeneratePreviewRecovery({ hasSourceArtwork: false, previewStatus: "missing_preview" })).toBe(false);
  });

  test("shows regenerate proof only after preview recovery succeeds for generated proofs", () => {
    expect(
      canRegenerateGeneratedProof({
        artifactKind: "generated",
        hasSourceArtwork: true,
        previewStatus: "missing_preview",
        previewRecoveryReady: true,
      }),
    ).toBe(true);

    expect(
      canRegenerateGeneratedProof({
        artifactKind: "uploaded",
        hasSourceArtwork: true,
        previewStatus: "missing_preview",
        previewRecoveryReady: true,
      }),
    ).toBe(false);

    expect(
      canRegenerateGeneratedProof({
        artifactKind: "generated",
        hasSourceArtwork: true,
        previewStatus: "ready",
        previewRecoveryReady: true,
      }),
    ).toBe(false);

    expect(
      canRegenerateGeneratedProof({
        artifactKind: "generated",
        hasSourceArtwork: true,
        previewStatus: "generation_failed",
        previewRecoveryReady: false,
      }),
    ).toBe(false);
  });

  test("surfaces no-artwork disabled reason for proof draft generation", () => {
    expect(getGenerateProofDraftDisabledReason({ hasEligibleArtwork: false })).toBe("no artwork found");
  });

  test("enables proof draft generation when eligible artwork exists", () => {
    expect(getGenerateProofDraftDisabledReason({ hasEligibleArtwork: true })).toBeNull();
  });
});
