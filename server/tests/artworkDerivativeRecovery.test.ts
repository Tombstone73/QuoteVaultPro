import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";

const getByIdForOrganization = jest.fn<(...args: any[]) => Promise<any>>();
const resolveDerivative = jest.fn<(...args: any[]) => Promise<any>>();
const resolveOriginal = jest.fn<(...args: any[]) => Promise<any>>();
const triggerThumbnailGenerationForAttachment = jest.fn();
const isThumbnailWorkerEnabled = jest.fn(() => true);
const isThumbnailGenerationEnabled = jest.fn(() => true);
const isSupportedImageType = jest.fn(() => true);
const queryRows: any[][] = [];
const limit = jest.fn(async () => queryRows.shift() ?? []);
const where = jest.fn(() => ({ limit }));
const innerJoin = jest.fn(() => ({ where }));
const from = jest.fn(() => ({ where, innerJoin }));
const select = jest.fn(() => ({ from }));

jest.unstable_mockModule("../db", () => ({ db: { select } }));
jest.unstable_mockModule("../storage/fileRecord.repo", () => ({ fileRecordRepository: { getByIdForOrganization } }));
jest.unstable_mockModule("../services/storage/CanonicalDerivativeReadResolver", () => ({ canonicalDerivativeReadResolver: { resolveDerivative } }));
jest.unstable_mockModule("../services/storage/CanonicalFileReadResolver", () => ({ canonicalFileReadResolver: { resolveOriginal } }));
jest.unstable_mockModule("../services/thumbnailGenerator", () => ({
  isSupportedImageType,
  isThumbnailGenerationEnabled,
}));
jest.unstable_mockModule("../workers/thumbnailWorker", () => ({
  isThumbnailWorkerEnabled,
  THUMBNAIL_PENDING_RETRY_MS: 30 * 60 * 1000,
  triggerThumbnailGenerationForAttachment,
}));

let requestArtworkDerivativeRecovery: typeof import("../services/artwork/requestArtworkDerivativeRecovery").requestArtworkDerivativeRecovery;
const args = { organizationId: "org_qa", fileRecordId: "file_qa", variant: "thumbnail" as const };

beforeAll(async () => {
  ({ requestArtworkDerivativeRecovery } = await import("../services/artwork/requestArtworkDerivativeRecovery"));
});

beforeEach(() => {
  jest.clearAllMocks();
  queryRows.length = 0;
  getByIdForOrganization.mockResolvedValue({ originalFilename: "qa.png", mimeType: "image/png" });
  resolveDerivative.mockResolvedValue({ status: "missing" });
  resolveOriginal.mockResolvedValue({ status: "available" });
  isThumbnailWorkerEnabled.mockReturnValue(true);
  isThumbnailGenerationEnabled.mockReturnValue(true);
  isSupportedImageType.mockReturnValue(true);
});

describe("targeted artwork derivative recovery", () => {
  test("unknown tenant-owned file cannot schedule work", async () => {
    getByIdForOrganization.mockResolvedValue(null);
    await requestArtworkDerivativeRecovery(args);
    expect(getByIdForOrganization).toHaveBeenCalledWith("org_qa", "file_qa");
    expect(select).not.toHaveBeenCalled();
    expect(triggerThumbnailGenerationForAttachment).not.toHaveBeenCalled();
  });

  test("ready or permanently failed derivatives do not retry", async () => {
    for (const status of ["available", "failed"]) {
      resolveDerivative.mockResolvedValueOnce({ status });
      await requestArtworkDerivativeRecovery(args);
    }
    expect(select).not.toHaveBeenCalled();
    expect(triggerThumbnailGenerationForAttachment).not.toHaveBeenCalled();
  });

  test("missing original cannot schedule work", async () => {
    resolveOriginal.mockResolvedValue({ status: "missing" });
    await requestArtworkDerivativeRecovery(args);
    expect(select).not.toHaveBeenCalled();
    expect(triggerThumbnailGenerationForAttachment).not.toHaveBeenCalled();
  });

  test("unsupported files and disabled workers cannot start generation", async () => {
    isSupportedImageType.mockReturnValue(false);
    await requestArtworkDerivativeRecovery(args);
    expect(select).not.toHaveBeenCalled();
    isSupportedImageType.mockReturnValue(true);
    isThumbnailWorkerEnabled.mockReturnValue(false);
    await requestArtworkDerivativeRecovery(args);
    expect(select).not.toHaveBeenCalled();
    expect(triggerThumbnailGenerationForAttachment).not.toHaveBeenCalled();
  });

  test("queues one tenant-scoped Order attachment when no Quote attachment matches", async () => {
    queryRows.push([], [{ id: "order_attachment_qa" }]);
    await requestArtworkDerivativeRecovery(args);
    expect(triggerThumbnailGenerationForAttachment).toHaveBeenCalledTimes(1);
    expect(triggerThumbnailGenerationForAttachment).toHaveBeenCalledWith({
      attachmentType: "order", attachmentId: "order_attachment_qa", reason: "authorized-derivative-read",
    });
  });

  test("queues the matching Quote attachment without scanning Order attachments", async () => {
    queryRows.push([{ id: "quote_attachment_qa" }]);
    await requestArtworkDerivativeRecovery(args);
    expect(triggerThumbnailGenerationForAttachment).toHaveBeenCalledTimes(1);
    expect(triggerThumbnailGenerationForAttachment).toHaveBeenCalledWith({
      attachmentType: "quote", attachmentId: "quote_attachment_qa", reason: "authorized-derivative-read",
    });
    expect(select).toHaveBeenCalledTimes(1);
  });

  test("skips scheduling when neither attachment is eligible for retry", async () => {
    queryRows.push([], []);
    await requestArtworkDerivativeRecovery(args);
    expect(triggerThumbnailGenerationForAttachment).not.toHaveBeenCalled();
  });
});
