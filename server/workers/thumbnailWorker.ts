import { db } from "../db";
import { orderAttachments, orders, quoteAttachments } from "@shared/schema";
import { and, eq, inArray, isNotNull, isNull, not, or, sql } from "drizzle-orm";
import { fileExists } from "../utils/fileStorage";
import { canonicalDerivativeReadResolver } from "../services/storage/CanonicalDerivativeReadResolver";
import { canonicalFileReadResolver } from "../services/storage/CanonicalFileReadResolver";
import { getWorkerIntervalOverride, logWorkerTick } from "./workerGates";

type AttachmentType = "quote" | "order";

type PendingAttachmentRow = {
  attachmentType: AttachmentType;
  id: string;
  organizationId: string;
  fileRecordId: string;
  mimeType: string | null;
  fileName: string | null;
  originalFilename: string | null;
  thumbStatus: "uploaded" | "thumb_pending" | "thumb_ready" | "thumb_failed" | null;
  thumbError: string | null;
};

// Production default: 10s (existing behavior)
// Non-production default: 5min (to prevent Neon compute burn)
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_NON_PROD_POLL_INTERVAL_MS = 300_000;
const DEFAULT_BATCH_SIZE = 10;

let workerInterval: NodeJS.Timeout | null = null;
let isPolling = false;

const LOCAL_ORIGINAL_NOT_PRESENT = "local_original_not_present";

function isDebugEnabled(): boolean {
  const v = process.env.DEBUG_THUMBNAILS;
  if (v === undefined || v === "") return false;
  return v === "1" || v.toLowerCase() === "true";
}

function isLocalOriginalMissingMarker(value: string | null | undefined): boolean {
  return (value ?? "").toString().toLowerCase().includes(LOCAL_ORIGINAL_NOT_PRESENT);
}

/**
 * Thumbnail storage contract (WRITES):
 * - Bucket: Supabase Storage bucket from `SUPABASE_BUCKET` (defaults to "titan-private") when `storageProvider === 'supabase'`.
 * - Image attachments (server/services/thumbnailGenerator.ts):
 *   - `thumbKey`   = `thumbs/{organizationId}/{attachmentType}/{attachmentId}.thumb.jpg`
 *   - `previewKey` = `thumbs/{organizationId}/{attachmentType}/{attachmentId}.preview.jpg`
 * - PDF attachments (server/services/pdfProcessing.ts):
 *   - `thumbKey`   = `thumbs/{organizationId}/{attachmentType}/{attachmentId}.thumb.jpg` (PDFs currently do not set previewKey)
 *
 * IMPORTANT: Client/UI should render thumbnails via the URLs returned by `enrichAttachmentWithUrls` (or `/objects/{thumbKey}`),
 * and must not guess alternate key formats (e.g. inserting orderId path segments).
 */

function isWorkerEnabled(): boolean {
  const envValue = process.env.ATTACHMENT_THUMBNAIL_WORKER_ENABLED;
  if (envValue === undefined || envValue === "") return true;
  return envValue.toLowerCase() === "true";
}

function getPollIntervalMs(): number {
  return getWorkerIntervalOverride(
    'THUMBNAILS',
    DEFAULT_POLL_INTERVAL_MS,
    DEFAULT_NON_PROD_POLL_INTERVAL_MS,
    'THUMBNAIL_WORKER_POLL_INTERVAL_MS'
  );
}

function getBatchSize(): number {
  const parsed = Number(process.env.THUMBNAIL_WORKER_BATCH_SIZE);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return DEFAULT_BATCH_SIZE;
}

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function isPdfLike(mimeType: string | null, fileName: string | null): boolean {
  const lowerMime = (mimeType ?? "").toLowerCase();
  if (lowerMime.includes("pdf")) return true;
  const lowerName = (fileName ?? "").toLowerCase();
  return lowerName.endsWith(".pdf");
}

async function claimForProcessing(row: PendingAttachmentRow): Promise<void> {
  const baseTable = row.attachmentType === "quote" ? quoteAttachments : orderAttachments;
  // Best-effort claim: set status to pending unless already ready/failed.
  // This keeps the worker idempotent and prevents tight re-processing loops.
  await db
    .update(baseTable)
    .set({
      thumbStatus: "thumb_pending",
      thumbError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(baseTable.id, row.id),
        inArray(baseTable.thumbStatus, ["uploaded", "thumb_pending"])
      )
    );
}

async function getCanonicalOriginalWorkInput(row: PendingAttachmentRow): Promise<{ storageProvider: "local" | "supabase" | "s3" | "gcs" | "azure_blob" | "titan_managed"; storageKey: string } | null> {
  const originalAccess = await canonicalFileReadResolver.resolveOriginal(row.fileRecordId);
  if (originalAccess.status !== "available") return null;

  const storageKey = originalAccess.localPathRef ?? originalAccess.objectKey ?? null;
  if (!storageKey) return null;

  return {
    storageProvider: originalAccess.providerType === "local_filesystem"
      ? "local"
      : originalAccess.providerType === "s3"
        ? "s3"
        : originalAccess.providerType === "gcs"
          ? "gcs"
          : originalAccess.providerType === "azure_blob"
            ? "azure_blob"
            : originalAccess.providerType === "titan_managed"
              ? "titan_managed"
              : "supabase",
    storageKey,
  };
}

async function resetCorruptLocalDerivatives(row: PendingAttachmentRow): Promise<boolean> {
  if (row.thumbStatus !== "thumb_ready") return false;
  // If we already know the local original isn't available on this machine, don't try to self-heal.
  if (isLocalOriginalMissingMarker(row.thumbError)) return false;

  const originalInput = await getCanonicalOriginalWorkInput(row);
  if (!originalInput || originalInput.storageProvider !== "local") return false;

  const [thumbAccess, previewAccess] = await Promise.all([
    canonicalDerivativeReadResolver.resolveDerivative(row.fileRecordId, "thumbnail"),
    canonicalDerivativeReadResolver.resolveDerivative(row.fileRecordId, "preview"),
  ]);

  const thumbKey = thumbAccess.objectKey;
  const previewKey = previewAccess.objectKey;
  if (!thumbKey) return false;

  // For local storage, `thumbKey`/`previewKey` are relative paths under FILE_STORAGE_ROOT/uploads.
  // If the DB says thumb_ready but the file doesn't exist, treat it as corrupt and re-generate.
  const thumbExists = await fileExists(thumbKey);
  const previewRequired = !isPdfLike(row.mimeType, row.originalFilename ?? row.fileName);
  const previewExists = previewRequired && previewKey ? await fileExists(previewKey) : true;
  if (thumbExists && previewExists) return false;

  const originalExists = await fileExists(originalInput.storageKey);
  const baseTable = row.attachmentType === "quote" ? quoteAttachments : orderAttachments;
  const debug = isDebugEnabled();

  // If the original is missing locally, do not retry-loop. Mark a neutral, machine-readable reason.
  if (!originalExists) {
    await db
      .update(baseTable)
      .set({
        thumbStatus: "thumb_failed",
        thumbKey: null,
        previewKey: null,
        thumbError: LOCAL_ORIGINAL_NOT_PRESENT,
        updatedAt: new Date(),
      })
      .where(eq(baseTable.id, row.id));

    if (debug) {
      console.warn(`[Thumbnail Worker] Local original missing; skipping regeneration for ${row.attachmentType} attachment ${row.id}`, {
        fileRecordId: row.fileRecordId,
        originalKey: originalInput.storageKey,
        thumbKey,
        previewKey,
        thumbExists,
        previewExists,
      });
    }

    row.thumbStatus = "thumb_failed";
    row.thumbError = LOCAL_ORIGINAL_NOT_PRESENT;
    return true;
  }
  await db
    .update(baseTable)
    .set({
      thumbStatus: "uploaded",
      thumbKey: null,
      previewKey: null,
      thumbError: null,
      updatedAt: new Date(),
    })
    .where(eq(baseTable.id, row.id));

  if (debug) {
    console.warn(`[Thumbnail Worker] Reset missing local derivatives for ${row.attachmentType} attachment ${row.id}`, {
      thumbKey,
      previewKey,
      thumbExists,
      previewExists,
    });
  }

  // Update the in-memory row too so this poll iteration can regenerate immediately.
  row.thumbStatus = "uploaded";
  return true;
}

async function pollOnce(): Promise<void> {
  if (!isWorkerEnabled()) return;
  const debug = isDebugEnabled();
  if (isPolling) {
    if (debug) console.log("[Thumbnail Worker] Already polling, skipping");
    return;
  }

  const startTime = Date.now();
  isPolling = true;
  let rowsProcessed = 0;
  
  try {
    const batchSize = getBatchSize();

    const commonWhere = (table: typeof quoteAttachments | typeof orderAttachments) =>
      and(
        isNotNull(table.fileRecordId),
        // Work queue includes:
        // - Pending items: status is uploaded/pending
        // - Self-heal local items: thumb_ready but canonical derivative file missing on disk (checked at runtime)
        or(
          isNull(table.thumbStatus),
          inArray(table.thumbStatus, ["uploaded", "thumb_pending"]),
          and(
            eq(table.thumbStatus, "thumb_ready"),
            sql`(${table.storageProvider} = 'local' OR ${table.storageProvider} IS NULL)`
          )
        ),
        // Don’t re-process failures endlessly; manual retry can reset status.
        inArray(table.thumbStatus, ["uploaded", "thumb_pending", "thumb_ready"])
      );

    const quoteRows = await db
      .select({
        attachmentType: sql<AttachmentType>`'quote'`,
        id: quoteAttachments.id,
        organizationId: quoteAttachments.organizationId,
        fileRecordId: quoteAttachments.fileRecordId,
        mimeType: quoteAttachments.mimeType,
        fileName: quoteAttachments.fileName,
        originalFilename: quoteAttachments.originalFilename,
        thumbStatus: quoteAttachments.thumbStatus,
        thumbError: quoteAttachments.thumbError,
      })
      .from(quoteAttachments)
      .where(commonWhere(quoteAttachments))
      .orderBy(sql`CASE WHEN ${quoteAttachments.thumbStatus} IN ('uploaded', 'thumb_pending') OR ${quoteAttachments.thumbStatus} IS NULL THEN 0 ELSE 1 END`, quoteAttachments.createdAt)
      .limit(batchSize);

    const orderRows = await db
      .select({
        attachmentType: sql<AttachmentType>`'order'`,
        id: orderAttachments.id,
        organizationId: orders.organizationId,
        fileRecordId: orderAttachments.fileRecordId,
        mimeType: orderAttachments.mimeType,
        fileName: orderAttachments.fileName,
        originalFilename: orderAttachments.originalFilename,
        thumbStatus: orderAttachments.thumbStatus,
        thumbError: orderAttachments.thumbError,
      })
      .from(orderAttachments)
      .innerJoin(orders, eq(orders.id, orderAttachments.orderId))
      .where(commonWhere(orderAttachments))
      .orderBy(sql`CASE WHEN ${orderAttachments.thumbStatus} IN ('uploaded', 'thumb_pending') OR ${orderAttachments.thumbStatus} IS NULL THEN 0 ELSE 1 END`, orderAttachments.createdAt)
      .limit(batchSize);

    const rows: PendingAttachmentRow[] = [...quoteRows, ...orderRows].map((r: any) => ({
      ...r,
      organizationId: r.organizationId || "",
    }));

    if (rows.length === 0) return;

    if (debug) console.log(`[Thumbnail Worker] Found ${rows.length} pending attachment(s)`);

    const { generateImageDerivatives, isSupportedImageType, isThumbnailGenerationEnabled } =
      await import("../services/thumbnailGenerator");
    const { processPdfAttachmentDerivedData } = await import("../services/pdfProcessing");

    for (const row of rows) {
      try {
        const originalInput = await getCanonicalOriginalWorkInput(row);
        if (!originalInput) {
          if (debug) console.log(`[Thumbnail Worker] Skipping ${row.id}: canonical original unavailable`);
          continue;
        }
        const fileName = (row.originalFilename ?? row.fileName ?? null) as string | null;
        const storageProvider = originalInput.storageProvider;

        // Self-heal check for local thumb_ready rows: if derivatives exist, skip quietly.
        if (storageProvider === 'local' && row.thumbStatus === 'thumb_ready') {
          const changed = await resetCorruptLocalDerivatives(row);
          if (!changed) {
            continue;
          }
          if (isLocalOriginalMissingMarker(row.thumbError)) {
            continue;
          }
        }

        if (debug) {
          console.log(`[Thumbnail Worker] Processing ${row.attachmentType} attachment ${row.id}:`, {
            fileName,
            mimeType: row.mimeType,
            fileRecordId: row.fileRecordId,
            storageKey: originalInput.storageKey,
            storageProvider,
            thumbStatus: row.thumbStatus,
          });
        }

        // If the original is missing locally, mark and stop (do not retry-loop).
        if (storageProvider === 'local') {
          const originalExists = await fileExists(originalInput.storageKey);
          if (!originalExists) {
            const baseTable = row.attachmentType === "quote" ? quoteAttachments : orderAttachments;
            await db
              .update(baseTable)
              .set({
                thumbStatus: 'thumb_failed',
                thumbKey: null,
                previewKey: null,
                thumbError: LOCAL_ORIGINAL_NOT_PRESENT,
                updatedAt: new Date(),
              })
              .where(eq(baseTable.id, row.id));

            if (debug) {
              console.warn(`[Thumbnail Worker] Skipping generation: local original missing for ${row.id}`, {
                fileRecordId: row.fileRecordId,
                storageKey: originalInput.storageKey,
              });
            }
            continue;
          }
        }

        await claimForProcessing(row);

        const isPdf = isPdfLike(row.mimeType, fileName);
        if (isPdf) {
          // Best-effort: PDF -> thumbKey only.
          if (debug) console.log(`[Thumbnail Worker] Processing PDF: ${row.id}`);
          await processPdfAttachmentDerivedData({
            orgId: row.organizationId || "",
            attachmentId: row.id,
            storageKey: originalInput.storageKey,
            storageProvider,
            mimeType: row.mimeType,
            attachmentType: row.attachmentType,
          });
          if (debug) console.log(`[Thumbnail Worker] PDF processing completed for ${row.id}`);
          continue;
        }

        const isImage = isSupportedImageType(row.mimeType, fileName);
        if (!isImage) {
          if (debug) console.log(`[Thumbnail Worker] Skipping ${row.id}: unsupported type (not PDF, not supported image)`);
          // Mark as thumb_failed so it doesn't keep reprocessing
          const baseTable = row.attachmentType === "quote" ? quoteAttachments : orderAttachments;
          try {
            await db
              .update(baseTable)
              .set({
                thumbStatus: "thumb_failed",
                thumbError: `Unsupported file type for thumbnail generation: ${row.mimeType || 'unknown'}`,
                updatedAt: new Date(),
              })
              .where(eq(baseTable.id, row.id));
          } catch (dbError) {
            console.error(`[Thumbnail Worker] Failed to update status for unsupported type ${row.id}:`, dbError);
          }
          continue;
        }
        if (!isThumbnailGenerationEnabled()) {
          if (debug) console.log(`[Thumbnail Worker] Skipping ${row.id}: thumbnail generation disabled`);
          continue;
        }

        if (debug) console.log(`[Thumbnail Worker] Processing image: ${row.id}, type: ${row.mimeType}`);
        await generateImageDerivatives(
          row.id,
          row.attachmentType,
          originalInput.storageKey,
          row.mimeType,
          storageProvider,
          row.organizationId || "",
          fileName
        );
        if (debug) console.log(`[Thumbnail Worker] Image processing completed for ${row.id}`);
        rowsProcessed++;
      } catch (error) {
        console.error(`[Thumbnail Worker] Error processing attachment ${row.id}:`, error);
      }
    }
  } catch (error) {
    console.error("[Thumbnail Worker] Poll error:", error);
  } finally {
    isPolling = false;
    const duration = Date.now() - startTime;
    logWorkerTick('thumbnails', duration, rowsProcessed);
  }
}

export function startThumbnailWorker(): void {
  if (workerInterval) {
    console.log("[Thumbnail Worker] Worker already running");
    return;
  }

  if (!isWorkerEnabled()) {
    console.log("[Thumbnail Worker] Worker disabled via env (ATTACHMENT_THUMBNAIL_WORKER_ENABLED)"
    );
    return;
  }

  const intervalMs = getPollIntervalMs();
  console.log(`[Thumbnail Worker] Starting worker (poll interval: ${intervalMs}ms)`);

  void pollOnce();
  workerInterval = setInterval(() => {
    void pollOnce();
  }, intervalMs);
}

export function stopThumbnailWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    console.log("[Thumbnail Worker] Worker stopped");
  }
}
