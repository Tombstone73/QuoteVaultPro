import { describe, expect, jest, test } from "@jest/globals";

import { ensureGeneratedProofCanonicalDerivatives } from "../services/proofingService";

describe("generated proof canonical derivatives", () => {
  test("generates the canonical thumbnail and preview for a generated proof file record", async () => {
    const generateCanonicalFilePreviews = jest.fn(async () => "ready" as const);

    await ensureGeneratedProofCanonicalDerivatives({
      organizationId: "org-1",
      fileRecordId: "file-record-1",
      fileName: "order-proof.pdf",
    }, { generateCanonicalFilePreviews });

    expect(generateCanonicalFilePreviews).toHaveBeenCalledWith({
      organizationId: "org-1",
      fileRecordId: "file-record-1",
      fileName: "order-proof.pdf",
      mimeType: "application/pdf",
    });
  });

  test("does not invalidate an otherwise-created proof if presentation derivatives fail", async () => {
    const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const generateCanonicalFilePreviews = jest.fn(async () => {
      throw new Error("PDF preview renderer unavailable");
    });

    await expect(ensureGeneratedProofCanonicalDerivatives({
      organizationId: "org-1",
      fileRecordId: "file-record-1",
      fileName: "order-proof.pdf",
    }, { generateCanonicalFilePreviews })).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledWith(
      "[ProofComposition] canonical_proof_derivative_generation_failed",
      expect.objectContaining({ fileRecordId: "file-record-1" }),
    );
    warning.mockRestore();
  });
});
