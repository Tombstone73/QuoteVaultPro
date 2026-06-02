import {
  buildOrderOriginalArtworkDisplayFilename,
  dedupeByCanonicalOriginalFileIdentity,
  getCanonicalOriginalFileIdentity,
  withOrderOriginalArtworkDisplayFilename,
} from "../services/originalArtworkFiles";

describe("original artwork file identity and display naming", () => {
  const namingPolicy = {
    fileUploadJobPrefixMode: "numeric_only" as const,
    prepressFileLabelMode: "optional" as const,
  };

  test("new order artwork display names receive the job-number prefix once", () => {
    expect(
      buildOrderOriginalArtworkDisplayFilename({
        originalFilename: "151606 Skylake Banners 1.pdf",
        orderNumber: "1019",
        namingPolicy,
      }),
    ).toBe("1019_151606 Skylake Banners 1.pdf");

    expect(
      buildOrderOriginalArtworkDisplayFilename({
        originalFilename: "1019_151606 Skylake Banners 1.pdf",
        orderNumber: "1019",
        namingPolicy,
      }),
    ).toBe("1019_151606 Skylake Banners 1.pdf");
  });

  test("defensive dedupe collapses mirrored original artwork by file record or storage key", () => {
    const files = [
      { id: "order-attachment", fileRecordId: "file-record-1", originalFilename: "art.pdf", sizeBytes: 10 },
      { id: "line-item-file", fileRecordId: "file-record-1", originalFilename: "1019_art.pdf", sizeBytes: 10 },
      { id: "legacy-a", storageKey: "uploads/art.pdf", originalFilename: "art.pdf", sizeBytes: 10 },
      { id: "legacy-b", storagePath: "uploads/art.pdf", originalFilename: "art-copy.pdf", sizeBytes: 10 },
      { id: "proof-pdf", fileRecordId: "file-record-2", originalFilename: "proof.pdf", sizeBytes: 12 },
    ];

    expect(dedupeByCanonicalOriginalFileIdentity(files).map((file) => file.id)).toEqual([
      "order-attachment",
      "legacy-a",
      "proof-pdf",
    ]);
  });

  test("existing files without normalized names still receive a stable fallback identity and display name", () => {
    expect(
      getCanonicalOriginalFileIdentity({
        originalFilename: "old-upload.pdf",
        sizeBytes: 42,
        mimeType: "application/pdf",
      }),
    ).toBe("legacy:old-upload.pdf:42:application/pdf");

    expect(
      withOrderOriginalArtworkDisplayFilename(
        { id: "old-upload", fileName: "old-upload.pdf" },
        { orderNumber: "ORD-1019", namingPolicy },
      ).displayFilename,
    ).toBe("1019_old-upload.pdf");
  });
});
