import { describe, expect, test } from "@jest/globals";
import { mergeArtworkSidesIntoPrepressFiles } from "../prepressFileService";

describe("prepress artwork side hydration", () => {
  test("preserves Front, Back, Both, and Unassigned metadata across refetch", () => {
    const files = [
      { id: "prepress-front", fileRecordId: "record-front", originalFilename: "front.pdf", sizeBytes: 10 },
      { id: "prepress-back", fileRecordId: "record-back", originalFilename: "back.pdf", sizeBytes: 20 },
      { id: "prepress-both", fileRecordId: "record-both", originalFilename: "same.pdf", sizeBytes: 30 },
      { id: "prepress-unassigned", fileRecordId: "record-other", originalFilename: "other.pdf", sizeBytes: 40 },
    ];
    const hydrated = mergeArtworkSidesIntoPrepressFiles(files, [
      { id: "attachment-front", fileRecordId: "record-front", side: "front" },
      { id: "attachment-back", fileRecordId: "record-back", side: "back" },
      { id: "attachment-both", fileRecordId: "record-both", side: "both" },
    ]);

    expect(hydrated.map((file) => [file.id, file.artworkSide])).toEqual([
      ["prepress-front", "front"],
      ["prepress-back", "back"],
      ["prepress-both", "both"],
      ["prepress-unassigned", "na"],
    ]);
  });

  test("combines matching Front and Back links for one physical file as Both", () => {
    const [hydrated] = mergeArtworkSidesIntoPrepressFiles(
      [{ id: "prepress-shared", fileRecordId: "record-shared", originalFilename: "shared.pdf" }],
      [
        { id: "attachment-front", fileRecordId: "record-shared", side: "front" },
        { id: "attachment-back", fileRecordId: "record-shared", side: "back" },
      ],
    );
    expect(hydrated.artworkSide).toBe("both");
  });
});
