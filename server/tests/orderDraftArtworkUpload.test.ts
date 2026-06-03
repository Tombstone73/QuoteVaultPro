import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Readable } from "stream";

import {
  createUploadSession,
  finalizeUploadSession,
  loadUploadSessionMeta,
  writeUploadChunkFromStream,
} from "../services/chunkedUploads";

describe("draft order TEMP artwork uploads", () => {
  let tmpRoot: string;
  let storageRoot: string;
  const previousTempRoot = process.env.FILE_UPLOAD_TEMP_ROOT;
  const previousStorageRoot = process.env.FILE_STORAGE_ROOT;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qvp-upload-temp-"));
    storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qvp-storage-"));
    process.env.FILE_UPLOAD_TEMP_ROOT = tmpRoot;
    process.env.FILE_STORAGE_ROOT = storageRoot;
  });

  afterEach(async () => {
    process.env.FILE_UPLOAD_TEMP_ROOT = previousTempRoot;
    process.env.FILE_STORAGE_ROOT = previousStorageRoot;
    await fs.rm(tmpRoot, { recursive: true, force: true });
    await fs.rm(storageRoot, { recursive: true, force: true });
  });

  test("finalizes an order attachment TEMP session before an order exists", async () => {
    const session = await createUploadSession({
      organizationId: "org-temp-art",
      createdByUserId: "user-1",
      purpose: "order-attachment",
      orderId: null,
      filename: "banner-art.pdf",
      mimeType: "application/pdf",
      sizeBytes: 11,
      chunkSizeBytes: 64,
    });

    await writeUploadChunkFromStream({
      uploadId: session.uploadId,
      chunkIndex: 0,
      stream: Readable.from(Buffer.from("hello world")),
    });

    const finalized = await finalizeUploadSession({
      uploadId: session.uploadId,
      organizationId: "org-temp-art",
    });

    expect(finalized.fileId).toBe(session.uploadId);
    expect(finalized.filename).toBe("banner-art.pdf");
    expect(finalized.relativePath).toContain("orders/draft-");

    const meta = await loadUploadSessionMeta(session.uploadId);
    expect(meta.status).toBe("finalized");
    expect(meta.orderId).toBeNull();
    expect(meta.linkedAt).toBeNull();
  });

  test("rejects promotion to a different saved order than the upload session already belongs to", async () => {
    const session = await createUploadSession({
      organizationId: "org-temp-art",
      createdByUserId: "user-1",
      purpose: "order-attachment",
      orderId: "order-1",
      filename: "banner-art.pdf",
      mimeType: "application/pdf",
      sizeBytes: 11,
      chunkSizeBytes: 64,
    });

    await expect(finalizeUploadSession({
      uploadId: session.uploadId,
      organizationId: "org-temp-art",
      orderId: "order-2",
    })).rejects.toThrow("Upload session orderId mismatch");
  });
});
