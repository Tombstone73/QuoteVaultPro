import { describe, expect, test } from "@jest/globals";
import {
  buildPromotedFinalFileLink,
  buildComputedDisplayFilename,
  resolvePrintReadyArtworkCandidates,
} from "../prepressFileService";

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

  test("resolves each line from its own stable selected artwork ID", () => {
    const lineTwo = resolvePrintReadyArtworkCandidates({
      lineItem: { specsJson: { artworkSideAssignment: { bothFileId: "record-party" } } },
      candidates: [
        { id: "party-attachment", fileRecordId: "record-party", side: "both" },
        { id: "other-attachment", fileRecordId: "record-other", side: "na" },
      ],
    });
    const lineThree = resolvePrintReadyArtworkCandidates({
      lineItem: { specsJson: { artworkSideAssignment: { frontFileId: "record-line-3" } } },
      candidates: [
        { id: "line-3-art", fileRecordId: "record-line-3", side: "front" },
        { id: "line-3-extra", fileRecordId: "record-line-3-extra", side: "na" },
      ],
    });

    expect(lineTwo.map((file) => file.fileRecordId)).toEqual(["record-party"]);
    expect(lineThree.map((file) => file.fileRecordId)).toEqual(["record-line-3"]);
  });

  test("fails closed instead of selecting the first of multiple unassigned artworks", () => {
    expect(() => resolvePrintReadyArtworkCandidates({
      lineItem: { specsJson: {} },
      candidates: [
        { id: "party", fileRecordId: "record-party", side: "na" },
        { id: "design-2", fileRecordId: "record-design-2", side: "na" },
      ],
    })).toThrow("Assign the production artwork as Front, Back, or Both");
  });

  test("keeps explicit front and back files for a double-sided production line", () => {
    const selected = resolvePrintReadyArtworkCandidates({
      lineItem: {
        optionSelectionsJson: { print_sides: "double_sided" },
        specsJson: { artworkSideAssignment: { frontFileId: "front-record", backFileId: "back-record" } },
      },
      candidates: [
        { id: "front", fileRecordId: "front-record", side: "front" },
        { id: "back", fileRecordId: "back-record", side: "back" },
      ],
    });
    expect(selected.map((file) => file.fileRecordId)).toEqual(["front-record", "back-record"]);
  });

  test("blocks a double-sided line when only one side is assigned", () => {
    expect(() => resolvePrintReadyArtworkCandidates({
      lineItem: {
        optionSelectionsJson: { print_sides: "double_sided" },
        specsJson: { artworkSideAssignment: { frontFileId: "front-record" } },
      },
      candidates: [
        { id: "front", fileRecordId: "front-record", side: "front" },
        { id: "unassigned", fileRecordId: "other-record", side: "na" },
      ],
    })).toThrow("needs explicit Front and Back artwork");
  });
});
