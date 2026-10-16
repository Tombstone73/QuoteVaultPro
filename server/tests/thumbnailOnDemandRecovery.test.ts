import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";

const originalWorkersEnabled = process.env.WORKERS_ENABLED;
process.env.WORKERS_ENABLED = "false";

const attachment = {
  attachmentType: "order" as const,
  id: "order_attachment_qa",
  organizationId: "org_qa",
  fileRecordId: "file_qa",
  mimeType: "image/png",
  fileName: "older-qa.png",
  originalFilename: "older-qa.png",
  thumbStatus: "uploaded" as const,
  thumbError: null,
};

const selectLimit = jest.fn<() => Promise<typeof attachment[]>>(async () => [attachment]);
const selectWhere = jest.fn(() => ({ limit: selectLimit }));
const innerJoin = jest.fn(() => ({ where: selectWhere }));
const from = jest.fn(() => ({ innerJoin }));
const select = jest.fn(() => ({ from }));
const returning = jest.fn<() => Promise<{ id: string }[]>>(async () => [{ id: attachment.id }]);
const updateWhere = jest.fn(() => ({ returning }));
const set = jest.fn(() => ({ where: updateWhere }));
const update = jest.fn(() => ({ set }));
const resolveOriginal = jest.fn<() => Promise<object>>(async () => ({
  status: "available",
  providerType: "supabase",
  objectKey: "qa/original.png",
}));
const generateImageDerivatives = jest.fn<(...args: unknown[]) => Promise<void>>(async () => {});

jest.unstable_mockModule("../db", () => ({ db: { select, update } }));
jest.unstable_mockModule("../services/storage/CanonicalFileReadResolver", () => ({
  canonicalFileReadResolver: { resolveOriginal },
}));
jest.unstable_mockModule("../services/storage/CanonicalDerivativeReadResolver", () => ({
  canonicalDerivativeReadResolver: { resolveDerivative: jest.fn() },
}));
jest.unstable_mockModule("../services/thumbnailGenerator", () => ({
  generateImageDerivatives,
  isSupportedImageType: () => true,
  isThumbnailGenerationEnabled: () => true,
}));
jest.unstable_mockModule("../services/pdfProcessing", () => ({
  processPdfAttachmentDerivedData: jest.fn(),
}));

async function waitForCallCount(mock: { mock: { calls: unknown[][] } }, count: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (mock.mock.calls.length >= count) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Expected " + count + " calls, received " + mock.mock.calls.length);
}

let worker: typeof import("../workers/thumbnailWorker");

beforeAll(async () => {
  worker = await import("../workers/thumbnailWorker");
});

beforeEach(() => {
  jest.clearAllMocks();
  selectLimit.mockResolvedValue([attachment]);
  returning.mockResolvedValue([{ id: attachment.id }]);
  resolveOriginal.mockResolvedValue({
    status: "available",
    providerType: "supabase",
    objectKey: "qa/original.png",
  });
});

afterAll(() => {
  if (originalWorkersEnabled === undefined) delete process.env.WORKERS_ENABLED;
  else process.env.WORKERS_ENABLED = originalWorkersEnabled;
});

describe("authorized artwork recovery with scheduled workers disabled", () => {
  test("ordinary upload trigger remains gated", async () => {
    expect(worker.isThumbnailWorkerEnabled()).toBe(false);
    worker.triggerThumbnailGenerationForAttachment({
      attachmentType: "order",
      attachmentId: attachment.id,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(select).not.toHaveBeenCalled();
    expect(generateImageDerivatives).not.toHaveBeenCalled();
  });

  test("an authorized read claims only its attachment and runs the existing image pipeline", async () => {
    expect(worker.isThumbnailWorkerEnabled()).toBe(false);
    worker.triggerThumbnailGenerationForAuthorizedRead({
      attachmentType: "order",
      attachmentId: attachment.id,
    });

    await waitForCallCount(generateImageDerivatives, 1);
    expect(select).toHaveBeenCalledTimes(1);
    expect(innerJoin).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(returning).toHaveBeenCalledTimes(1);
    expect(generateImageDerivatives).toHaveBeenCalledWith(
      attachment.id, "order", "qa/original.png", "image/png", "supabase", "org_qa", "older-qa.png",
    );
  });

  test("a failed compare-and-swap claim does not regenerate", async () => {
    returning.mockResolvedValue([]);
    worker.triggerThumbnailGenerationForAuthorizedRead({
      attachmentType: "order",
      attachmentId: attachment.id,
    });

    await waitForCallCount(returning, 1);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(generateImageDerivatives).not.toHaveBeenCalled();
  });
});
