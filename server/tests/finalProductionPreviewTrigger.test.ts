import { describe, expect, jest, test } from "@jest/globals";

import {
  generateFinalProductionFilePreview,
  getLineItemFilePreviewRepairState,
  queueLineItemFilePreviewRepair,
  shouldQueueLineItemFilePreviewRepair,
} from "../prepressFileService";

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
    expect(getLineItemFilePreviewRepairState(params).inFlight).toBe(true);

    finish({ fileRecordId: "record-1", previewStatus: "ready" });
    await expect(first.completion).resolves.toEqual({ fileRecordId: "record-1", previewStatus: "ready" });
    await expect(second.completion).resolves.toEqual({ fileRecordId: "record-1", previewStatus: "ready" });
    expect(getLineItemFilePreviewRepairState(params).inFlight).toBe(false);
  });

  test("orphaned pending derivatives restart but active repairs do not duplicate", () => {
    expect(shouldQueueLineItemFilePreviewRepair({
      canRepair: true,
      derivativeStatus: "pending",
      repairInFlight: false,
    })).toBe(true);
    expect(shouldQueueLineItemFilePreviewRepair({
      canRepair: true,
      derivativeStatus: "pending",
      repairInFlight: true,
    })).toBe(false);
    expect(shouldQueueLineItemFilePreviewRepair({
      canRepair: true,
      derivativeStatus: "failed",
      repairInFlight: false,
    })).toBe(false);
  });

  test("repair failures transition to failed and invoke durable failure persistence", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const runner = jest.fn(async () => {
      throw new Error("PDF renderer unavailable");
    });
    const persistFailure = jest.fn(async () => undefined);
    const params = { fileId: "file-failure", organizationId: "org-1", actorUserId: "user-1" };

    const repair = queueLineItemFilePreviewRepair(params, runner, { persistFailure });

    await expect(repair.completion).resolves.toEqual({ fileRecordId: "", previewStatus: "failed" });
    expect(persistFailure).toHaveBeenCalledWith(params, expect.objectContaining({ message: "PDF renderer unavailable" }));
    expect(getLineItemFilePreviewRepairState(params).inFlight).toBe(false);
    errorSpy.mockRestore();
  });

  test("hung repairs time out and persist a failed terminal state", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const runner = jest.fn(() => new Promise<{ fileRecordId: string; previewStatus: "ready" }>(() => undefined));
    const persistFailure = jest.fn(async () => undefined);
    const params = { fileId: "file-timeout", organizationId: "org-1", actorUserId: "user-1" };

    const repair = queueLineItemFilePreviewRepair(params, runner, { timeoutMs: 5, persistFailure });

    await expect(repair.completion).resolves.toEqual({ fileRecordId: "", previewStatus: "failed" });
    expect(persistFailure).toHaveBeenCalledWith(
      params,
      expect.objectContaining({ message: expect.stringContaining("timed out") }),
    );
    expect(getLineItemFilePreviewRepairState(params).inFlight).toBe(false);
    errorSpy.mockRestore();
  });
});
