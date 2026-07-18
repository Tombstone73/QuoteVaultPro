import { describe, expect, jest, test } from "@jest/globals";

import { generateFinalProductionFilePreview, queueLineItemFilePreviewRepair } from "../prepressFileService";

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

  test("on-demand preview repair deduplicates concurrent requests", async () => {
    let finish!: (value: { fileRecordId: string; previewStatus: "ready" }) => void;
    const runner = jest.fn((_params: { fileId: string; organizationId: string; actorUserId: string }) => new Promise<{ fileRecordId: string; previewStatus: "ready" }>((resolve) => {
      finish = resolve;
    }));
    const params = { fileId: "file-1", organizationId: "org-1", actorUserId: "user-1" };

    const first = queueLineItemFilePreviewRepair(params, runner);
    const second = queueLineItemFilePreviewRepair(params, runner);

    expect(first.status).toBe("processing");
    expect(second.status).toBe("processing");
    expect(runner).toHaveBeenCalledTimes(1);

    finish({ fileRecordId: "record-1", previewStatus: "ready" });
    await expect(first.completion).resolves.toEqual({ fileRecordId: "record-1", previewStatus: "ready" });
    await expect(second.completion).resolves.toEqual({ fileRecordId: "record-1", previewStatus: "ready" });
  });
});
