import { db } from "../db";
import { orderAttachments, orders, quoteAttachments } from "@shared/schema";
import { and, eq, inArray, isNotNull, isNull, not, sql } from "drizzle-orm";

type AttachmentType = "quote" | "order";

type PendingAttachmentRow = {
  attachmentType: AttachmentType;
  id: string;
  organizationId: string;
  fileUrl: string;
  mimeType: string | null;
  fileName: string | null;
  originalFilename: string | null;
  storageProvider: string | null;
  thumbStatus: "uploaded" | "thumb_pending" | "thumb_ready" | "thumb_failed" | null;
  thumbKey: string | null;
  previewKey: string | null;
};

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_BATCH_SIZE = 10;

let workerInterval: NodeJS.Timeout | null = null;
let isPolling = false;

function isWorkerEnabled(): boolean {
  const envValue = process.env.ATTACHMENT_THUMBNAIL_WORKER_ENABLED;
  if (envValue === undefined || envValue === "") return true;
  return envValue.toLowerCase() === "true";
}

function getPollIntervalMs(): number {
  const parsed = Number(process.env.THUMBNAIL_WORKER_POLL_INTERVAL_MS);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_POLL_INTERVAL_MS;
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

async function pollOnce(): Promise<void> {
  if (!isWorkerEnabled()) return;
  if (isPolling) {
    console.log("[Thumbnail Worker] Already polling, skipping");
    return;
  }

  isPolling = true;
  try {
    const batchSize = getBatchSize();

    const commonWhere = (table: typeof quoteAttachments | typeof orderAttachments) =>
      and(
        // Only process internal storage keys (Supabase/local), not external URLs.
        isNotNull(table.fileUrl),
        not(sql`${table.fileUrl} LIKE 'http%'`),
        inArray(table.storageProvider, ["supabase", "local"]),
        // Pending = missing thumbnail key. (PDFs never set previewKey.)
        isNull(table.thumbKey),
        // Don’t re-process failures endlessly; manual retry can reset status.
        inArray(table.thumbStatus, ["uploaded", "thumb_pending"])
      );

    const quoteRows = await db
      .select({
        attachmentType: sql<AttachmentType>`'quote'`,
        id: quoteAttachments.id,
        organizationId: quoteAttachments.organizationId,
        fileUrl: quoteAttachments.fileUrl,
        mimeType: quoteAttachments.mimeType,
        fileName: quoteAttachments.fileName,
        originalFilename: quoteAttachments.originalFilename,
        storageProvider: quoteAttachments.storageProvider,
        thumbStatus: quoteAttachments.thumbStatus,
        thumbKey: quoteAttachments.thumbKey,
        previewKey: quoteAttachments.previewKey,
      })
      .from(quoteAttachments)
      .where(commonWhere(quoteAttachments))
      .orderBy(quoteAttachments.createdAt)
      .limit(batchSize);

    const orderRows = await db
      .select({
        attachmentType: sql<AttachmentType>`'order'`,
        id: orderAttachments.id,
        organizationId: orders.organizationId,
        fileUrl: orderAttachments.fileUrl,
        mimeType: orderAttachments.mimeType,
        fileName: orderAttachments.fileName,
        originalFilename: orderAttachments.originalFilename,
        storageProvider: orderAttachments.storageProvider,
        thumbStatus: orderAttachments.thumbStatus,
        thumbKey: orderAttachments.thumbKey,
        previewKey: orderAttachments.previewKey,
      })
      .from(orderAttachments)
      .innerJoin(orders, eq(orders.id, orderAttachments.orderId))
      .where(commonWhere(orderAttachments))
      .orderBy(orderAttachments.createdAt)
      .limit(batchSize);

    const rows: PendingAttachmentRow[] = [...quoteRows, ...orderRows].map((r: any) => ({
      ...r,
      organizationId: r.organizationId || "",
    }));

    if (rows.length === 0) return;

    console.log(`[Thumbnail Worker] Found ${rows.length} pending attachment(s)`);

    const { generateImageDerivatives, isSupportedImageType, isThumbnailGenerationEnabled } =
      await import("../services/thumbnailGenerator");
    const { processPdfAttachmentDerivedData } = await import("../services/pdfProcessing");

    for (const row of rows) {
      try {
        if (!row.fileUrl || isHttpUrl(row.fileUrl)) {
          console.log(`[Thumbnail Worker] Skipping ${row.id}: external URL or missing fileUrl`);
          continue;
        }
        const fileName = (row.originalFilename ?? row.fileName ?? null) as string | null;
        const storageProvider = row.storageProvider;
        if (!storageProvider) {
          console.log(`[Thumbnail Worker] Skipping ${row.id}: no storageProvider`);
          continue;
        }

        console.log(`[Thumbnail Worker] Processing ${row.attachmentType} attachment ${row.id}:`, {
          fileName,
          mimeType: row.mimeType,
          fileUrl: row.fileUrl,
          storageProvider,
          thumbStatus: row.thumbStatus,
        });

        await claimForProcessing(row);

        const isPdf = isPdfLike(row.mimeType, fileName);
        if (isPdf) {
          // Best-effort: PDF -> thumbKey only.
          console.log(`[Thumbnail Worker] Processing PDF: ${row.id}`);
          await processPdfAttachmentDerivedData({
            orgId: row.organizationId || "",
            attachmentId: row.id,
            storageKey: row.fileUrl,
            storageProvider,
            mimeType: row.mimeType,
            attachmentType: row.attachmentType,
          });
          console.log(`[Thumbnail Worker] PDF processing completed for ${row.id}`);
          continue;
        }

        const isImage = isSupportedImageType(row.mimeType, fileName);
        if (!isImage) {
          console.log(`[Thumbnail Worker] Skipping ${row.id}: unsupported type (not PDF, not supported image)`);
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
          console.log(`[Thumbnail Worker] Skipping ${row.id}: thumbnail generation disabled`);
          continue;
        }

        console.log(`[Thumbnail Worker] Processing image: ${row.id}, type: ${row.mimeType}`);
        await generateImageDerivatives(
          row.id,
          row.attachmentType,
          row.fileUrl,
          row.mimeType,
          storageProvider,
          row.organizationId || "",
          fileName
        );
        console.log(`[Thumbnail Worker] Image processing completed for ${row.id}`);
      } catch (error) {
        console.error(`[Thumbnail Worker] Error processing attachment ${row.id}:`, error);
      }
    }
  } catch (error) {
    console.error("[Thumbnail Worker] Poll error:", error);
  } finally {
    isPolling = false;
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
