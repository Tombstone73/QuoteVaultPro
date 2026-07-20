import { describe, expect, test } from "@jest/globals";
import { buildPromotedFinalFileLink, buildComputedDisplayFilename } from "../prepressFileService";

describe("Prepress print-ready promotion", () => {
  test("creates a final relation that references the original stored object", () => {
    const promoted = buildPromotedFinalFileLink({
      organizationId: "org-1",
      orderId: "order-1",
      lineItemId: "line-1",
      prepressSessionId: "session-1",
      createdByUserId: "user-1",
      tag: "final_print",
      source: {
        fileRecordId: "file-record-1",
        storageBucket: "private-files",
        storagePath: "org-1/orders/order-1/art.pdf",
        storageKey: "org-1/orders/order-1/art.pdf",
        originalFilename: "customer-art.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1234,
      },
    });

    expect(promoted).toMatchObject({
      role: "final",
      status: "active",
      fileRecordId: "file-record-1",
      storagePath: "org-1/orders/order-1/art.pdf",
      storageKey: "org-1/orders/order-1/art.pdf",
    });
  });

  test("uses the existing production naming policy without renaming the source record", () => {
    const filename = buildComputedDisplayFilename({
      role: "final",
      originalFilename: "customer-art.pdf",
      tag: "final_print",
      fullJobNumber: "ORD-20000",
      namingPolicy: { fileUploadJobPrefixMode: "full_job_number", prepressFileLabelMode: "required" },
    });

    expect(filename).toBe("ORD-20000_customer-art_PRINT.pdf");
  });
});
