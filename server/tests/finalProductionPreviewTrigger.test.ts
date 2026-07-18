import { describe, expect, jest, test } from "@jest/globals";

import { generateFinalProductionFilePreview } from "../prepressFileService";

describe("final production preview trigger", () => {
  test("final PDF upload triggers canonical first-page preview generation", async () => {
    const generateCanonicalFilePreviews = jest.fn(async () => "ready" as const);

    const result = await generateFinalProductionFilePreview({
      role: "final",
      organizationId: "org_1",
      fileRecordId: "file_record_1",
      fileName: "imposed-sheet.pdf",
      mimeType: "application/pdf",
    }, { generateCanonicalFilePreviews });

    expect(result).toBe("ready");
    expect(generateCanonicalFilePreviews).toHaveBeenCalledWith({
      organizationId: "org_1",
      fileRecordId: "file_record_1",
      fileName: "imposed-sheet.pdf",
      mimeType: "application/pdf",
    });
  });

  test("non-final files do not enter the final production preview path", async () => {
    const generateCanonicalFilePreviews = jest.fn(async () => "ready" as const);

    const result = await generateFinalProductionFilePreview({
      role: "original",
      organizationId: "org_1",
      fileRecordId: "file_record_1",
      fileName: "customer-art.pdf",
      mimeType: "application/pdf",
    }, { generateCanonicalFilePreviews });

    expect(result).toBe("not_applicable");
    expect(generateCanonicalFilePreviews).not.toHaveBeenCalled();
  });
});
