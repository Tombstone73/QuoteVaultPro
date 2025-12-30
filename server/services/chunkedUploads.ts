import crypto from "crypto";
import path from "path";
import fs from "fs";
import * as fsPromises from "fs/promises";
import {
  ensureDirectory,
  generateRelativePath,
  generateStoredFilename,
  getAbsolutePath,
  getFileExtension,
} from "../utils/fileStorage";

export type UploadPurpose = "quote-attachment" | "order-attachment";

type UploadSessionStatus = "initiated" | "uploading" | "finalized" | "failed";

type UploadSessionMeta = {
  uploadId: string;
  organizationId: string;
  createdByUserId: string | null;
  purpose: UploadPurpose;
  quoteId: string | null;
  orderId: string | null;

  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  chunkSizeBytes: number;
  totalChunks: number;

  status: UploadSessionStatus;
  createdAt: string;
  expiresAt: string;

  // Set on finalize
  finalizedAt?: string;

  // Set on finalize
  storedFilename?: string;
  relativePath?: string;
  extension?: string;
  checksum?: string;
  linkedAt?: string | null;
};

export const DEFAULT_CHUNK_SIZE_BYTES = 8 * 1024 * 1024; // 8MB
export const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
export const DEFAULT_FINALIZED_UNLINKED_GRACE_MINUTES = 1440; // 24h

function getFinalizedUnlinkedGraceMs(): number {
  const raw = process.env.FILE_UPLOAD_FINALIZED_UNLINKED_GRACE_MINUTES;
  const minutes = raw == null ? DEFAULT_FINALIZED_UNLINKED_GRACE_MINUTES : Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) return DEFAULT_FINALIZED_UNLINKED_GRACE_MINUTES * 60 * 1000;
  return Math.floor(minutes) * 60 * 1000;
}

function getTempRoot(): string {
  return (
    process.env.FILE_UPLOAD_TEMP_ROOT ||
    path.join(process.cwd(), "uploads", "_tmp", "chunked")
  );
}

function sessionDir(uploadId: string): string {
  return path.join(getTempRoot(), uploadId);
}

function metaPath(uploadId: string): string {
  return path.join(sessionDir(uploadId), "meta.json");
}

function chunksDir(uploadId: string): string {
  return path.join(sessionDir(uploadId), "chunks");
}

function chunkPath(uploadId: string, chunkIndex: number): string {
  return path.join(chunksDir(uploadId), `${chunkIndex}.part`);
}

export async function createUploadSession(input: {
  organizationId: string;
  createdByUserId: string | null;
  purpose: UploadPurpose;
  quoteId?: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  chunkSizeBytes?: number;
  ttlMs?: number;
}): Promise<{ uploadId: string; chunkSizeBytes: number; totalChunks: number; expiresAt: string }> {
  const uploadId = crypto.randomUUID();
  const chunkSizeBytes = input.chunkSizeBytes ?? DEFAULT_CHUNK_SIZE_BYTES;
  const totalChunks = Math.max(1, Math.ceil(input.sizeBytes / chunkSizeBytes));
  const ttlMs = input.ttlMs ?? DEFAULT_SESSION_TTL_MS;

  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ttlMs);

  const meta: UploadSessionMeta = {
    uploadId,
    organizationId: input.organizationId,
    createdByUserId: input.createdByUserId,
    purpose: input.purpose,
    quoteId: input.quoteId ?? null,
    originalFilename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    chunkSizeBytes,
    totalChunks,
    status: "initiated",
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    linkedAt: null,
  };

  await ensureDirectory(chunksDir(uploadId));
  await fsPromises.writeFile(metaPath(uploadId), JSON.stringify(meta, null, 2), "utf8");

  return { uploadId, chunkSizeBytes, totalChunks, expiresAt: meta.expiresAt };
}

export async function loadUploadSessionMeta(uploadId: string): Promise<UploadSessionMeta> {
  const raw = await fsPromises.readFile(metaPath(uploadId), "utf8");
  return JSON.parse(raw) as UploadSessionMeta;
}

export async function saveUploadSessionMeta(uploadId: string, meta: UploadSessionMeta): Promise<void> {
  await fsPromises.writeFile(metaPath(uploadId), JSON.stringify(meta, null, 2), "utf8");
}

export async function writeUploadChunkFromStream(options: {
  uploadId: string;
  chunkIndex: number;
  stream: NodeJS.ReadableStream;
}): Promise<void> {
  const dest = chunkPath(options.uploadId, options.chunkIndex);
  await ensureDirectory(chunksDir(options.uploadId));

  await new Promise<void>((resolve, reject) => {
    const writeStream = fs.createWriteStream(dest, { flags: "w" });
    options.stream
      .pipe(writeStream)
      .on("finish", () => resolve())
      .on("error", (err) => reject(err));
    options.stream.on("error", (err) => reject(err));
  });
}

export async function finalizeUploadSession(options: {
  uploadId: string;
  organizationId: string;
  quoteId?: string;
  orderId?: string;
}): Promise<{
  fileId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  relativePath: string;
}> {
  const meta = await loadUploadSessionMeta(options.uploadId);

  if (meta.organizationId !== options.organizationId) {
    throw new Error("Upload session does not belong to this organization");
  }
  if (meta.purpose !== "quote-attachment" && meta.purpose !== "order-attachment") {
    throw new Error("Unsupported upload purpose");
  }

  // For quote attachments we require quoteId; for order attachments we require orderId
  if (meta.purpose === "quote-attachment") {
    if (!options.quoteId) throw new Error("quoteId is required for quote-attachment");
    if (meta.quoteId && meta.quoteId !== options.quoteId) {
      throw new Error("Upload session quoteId mismatch");
    }
    meta.quoteId = options.quoteId;
  } else if (meta.purpose === "order-attachment") {
    if (!options.orderId) throw new Error("orderId is required for order-attachment");
    if (meta.orderId && meta.orderId !== options.orderId) {
      throw new Error("Upload session orderId mismatch");
    }
    meta.orderId = options.orderId;
  }

  if (meta.status === "finalized" && meta.relativePath && meta.checksum) {
    return {
      fileId: meta.uploadId,
      filename: meta.originalFilename,
      mimeType: meta.mimeType,
      sizeBytes: meta.sizeBytes,
      checksum: meta.checksum,
      relativePath: meta.relativePath,
    };
  }

  // Verify chunks exist
  for (let i = 0; i < meta.totalChunks; i++) {
    const p = chunkPath(meta.uploadId, i);
    try {
      await fsPromises.access(p);
    } catch {
      meta.status = "failed";
      await saveUploadSessionMeta(meta.uploadId, meta);
      throw new Error(`Missing chunk ${i}`);
    }
  }

  meta.status = "uploading";
  await saveUploadSessionMeta(meta.uploadId, meta);

  const storedFilename = generateStoredFilename(meta.originalFilename);
  const relativePath = generateRelativePath({
    organizationId: meta.organizationId,
    resourceType: meta.purpose === "quote-attachment" ? "quote" : "order",
    resourceId: meta.purpose === "quote-attachment" ? options.quoteId! : options.orderId!,
    storedFilename,
  });

  const absolutePath = getAbsolutePath(relativePath);
  await ensureDirectory(path.dirname(absolutePath));

  const hash = crypto.createHash("sha256");

  await new Promise<void>(async (resolve, reject) => {
    const out = fs.createWriteStream(absolutePath, { flags: "w" });

    const writeWithBackpressure = async (buf: Buffer) => {
      if (!out.write(buf)) {
        await new Promise<void>((r) => out.once("drain", () => r()));
      }
    };

    try {
      for (let i = 0; i < meta.totalChunks; i++) {
        const p = chunkPath(meta.uploadId, i);
        await new Promise<void>((chunkResolve, chunkReject) => {
          const rs = fs.createReadStream(p);
          rs.on("data", async (data: Buffer) => {
            rs.pause();
            try {
              hash.update(data);
              await writeWithBackpressure(data);
              rs.resume();
            } catch (err) {
              chunkReject(err);
            }
          });
          rs.on("end", () => chunkResolve());
          rs.on("error", (err) => chunkReject(err));
        });
      }

      out.end();
      out.on("finish", () => resolve());
      out.on("error", (err) => reject(err));
    } catch (err) {
      out.destroy();
      reject(err);
    }
  });

  const checksum = hash.digest("hex");

  // Cleanup chunk parts
  try {
    await fsPromises.rm(chunksDir(meta.uploadId), { recursive: true, force: true });
  } catch {
    // best-effort
  }

  meta.status = "finalized";
  meta.finalizedAt = new Date().toISOString();
  meta.storedFilename = storedFilename;
  meta.relativePath = relativePath;
  meta.extension = getFileExtension(meta.originalFilename);
  meta.checksum = checksum;
  await saveUploadSessionMeta(meta.uploadId, meta);

  return {
    fileId: meta.uploadId,
    filename: meta.originalFilename,
    mimeType: meta.mimeType,
    sizeBytes: meta.sizeBytes,
    checksum,
    relativePath,
  };
}

export async function deleteUploadSession(uploadId: string): Promise<void> {
  await fsPromises.rm(sessionDir(uploadId), { recursive: true, force: true });
}

export async function cleanupExpiredUploadSessions(): Promise<{ deleted: number; errors: number }> {
  const root = getTempRoot();
  let deleted = 0;
  let errors = 0;

  try {
    await fsPromises.mkdir(root, { recursive: true });
  } catch {
    // ignore
  }

  let entries: fs.Dirent[] = [];
  try {
    entries = await fsPromises.readdir(root, { withFileTypes: true });
  } catch {
    return { deleted, errors };
  }

  const now = Date.now();
  const finalizedUnlinkedGraceMs = getFinalizedUnlinkedGraceMs();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const uploadId = entry.name;
    try {
      const meta = await loadUploadSessionMeta(uploadId);
      const expiresAtMs = Date.parse(meta.expiresAt);

      // Non-finalized sessions: purge when expired (fast cleanup)
      if (meta.status !== "finalized") {
        const isExpired = Number.isFinite(expiresAtMs) && expiresAtMs <= now;
        if (!isExpired) continue;
        await deleteUploadSession(uploadId);
        deleted += 1;
        continue;
      }

      // Finalized sessions:
      // - If linked, the link endpoint deletes the session folder immediately (no-op here).
      // - If not linked, keep the assembled file + session metadata for a grace period,
      //   so a transient client failure doesn't destroy a legitimate upload.
      if (meta.linkedAt) {
        // If somehow still present, treat as expired-only cleanup.
        const isExpired = Number.isFinite(expiresAtMs) && expiresAtMs <= now;
        if (!isExpired) continue;
        await deleteUploadSession(uploadId);
        deleted += 1;
        continue;
      }

      const finalizedAtMs = Date.parse(meta.finalizedAt || meta.createdAt);
      const isPastGrace = Number.isFinite(finalizedAtMs) && finalizedAtMs + finalizedUnlinkedGraceMs <= now;
      if (!isPastGrace) {
        // Preserve for grace period (even if expiresAt has passed).
        continue;
      }

      // Grace elapsed: delete assembled file + session folder.
      if (meta.relativePath) {
        try {
          await fsPromises.unlink(getAbsolutePath(meta.relativePath));
        } catch {
          // best-effort
        }
      }
      await deleteUploadSession(uploadId);
      deleted += 1;
    } catch {
      errors += 1;
    }
  }

  return { deleted, errors };
}

export function startUploadCleanupTimerOnce(options?: {
  intervalMs?: number;
}): void {
  const key = "__qvp_chunked_upload_cleanup_timer_started__";
  if ((globalThis as any)[key]) return;
  (globalThis as any)[key] = true;

  const intervalMs = options?.intervalMs ?? 10 * 60 * 1000; // 10 minutes
  setInterval(() => {
    cleanupExpiredUploadSessions().catch(() => {
      // fail-soft
    });
  }, intervalMs);
}
