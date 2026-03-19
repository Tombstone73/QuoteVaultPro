/**
 * Prepress File Service
 * 
 * Handles file operations for manual prepress workflow:
 * - Upload ORIGINAL/FINAL/REFERENCE files to storage
 * - Download with job number prefix (JOB_NUMBER  filename)
 * - Generate zip archives of ORIGINAL files
 * - Track file metadata in line_item_files table
 */

import { db } from "./db";
import { lineItemFiles, orders, orderLineItems, orderAttachments } from "../shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { getStorageClient } from "./objectStorage";
import type { Response } from "express";
import archiver from "archiver";
import type { LineItemFile } from "../shared/schema";
import { isSupabaseConfigured, SupabaseStorageService } from "./supabaseStorage";
import {
  processUploadedFile,
  generateStoredFilename,
  generateRelativePath,
} from "./utils/fileStorage";
import { decideStorageTarget } from "./services/storageTarget";
import { storagePolicyResolver } from "./services/storage/StoragePolicyResolver";
import { normalizeObjectKeyForDb } from "./lib/supabaseObjectHelpers";
import {
  createRequestLogOnce,
  resolveDerivativeFileAccess,
  resolveOriginalFileAccess,
} from "./lib/supabaseObjectHelpers";

const BUCKET_NAME = process.env.PREPRESS_FILES_BUCKET || process.env.GCS_BUCKET_NAME || "quotevaultpro-uploads";

function buildPrepressDownloadEtag(fileId: string, sizeBytes: number | null | undefined, createdAt: Date | string | null | undefined) {
  const createdAtValue = createdAt ? new Date(createdAt).getTime() : 0;
  return `W/\"prepress-${fileId}-${sizeBytes ?? 0}-${createdAtValue}\"`;
}

/**
 * Normalized shape for order-level attachments surfaced in the prepress file panel.
 * These originate from the `order_attachments` table (uploaded on the order/quote page)
 * and are bridged read-only into the prepress workspace so operators can see customer
 * artwork that was submitted before the order entered the prepress queue.
 */
export type BridgedOriginal = {
  id: string;
  originalFilename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  role: string;
  createdAt: Date;
  source: 'order_attachment';
  downloadUrl: string;
  thumbnailUrl: string | null;
  uploadedBy: string | null;
};

export type EnsuredFinalArtworkResult = {
  file: LineItemFile;
  source: "existing_final" | "line_item_original" | "order_attachment";
  created: boolean;
};
const MAX_FILE_SIZE_MB = 250;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

function splitExtension(filename: string): { base: string; ext: string } {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === filename.length - 1) {
    return { base: filename, ext: "" };
  }
  return {
    base: filename.slice(0, lastDot),
    ext: filename.slice(lastDot),
  };
}

function mapTagToDisplay(tag?: string | null): string {
  const normalized = (tag || "").trim().toLowerCase();
  if (normalized === "proof_only" || normalized === "proof") return "Proof";
  if (normalized === "cut_file" || normalized === "cut") return "CutFile";
  return "Print";
}

export function buildComputedDisplayFilename(params: {
  role: string;
  originalFilename: string;
  tag?: string | null;
}): string {
  const { role, originalFilename, tag } = params;
  if (role !== "final") return originalFilename;

  const { base, ext } = splitExtension(originalFilename);
  const suffix = mapTagToDisplay(tag);
  return `${base}_FINAL_${suffix}${ext}`;
}

/**
 * Upload a file to storage and create line_item_files record
 */
export async function uploadLineItemFile(params: {
  organizationId: string;
  orderId: string;
  lineItemId: string;
  prepressSessionId?: string;
  role: "original" | "final" | "reference";
  tag?: string;
  buffer: Buffer;
  originalFilename: string;
  mimeType: string;
  createdByUserId: string;
}): Promise<LineItemFile> {
  const {
    organizationId,
    orderId,
    lineItemId,
    prepressSessionId,
    role,
    tag,
    buffer,
    originalFilename,
    mimeType,
    createdByUserId,
  } = params;

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File size exceeds maximum allowed size of ${MAX_FILE_SIZE_MB}MB`);
  }

  const storagePolicy = await storagePolicyResolver.resolve(organizationId);
  const canonicalProviderConfig = storagePolicyResolver.resolveCanonicalStorageBehavior(storagePolicy);

  const target = decideStorageTarget({
    fileName: originalFilename,
    fileSizeBytes: buffer.length,
    organizationId,
    context: "prepress.uploadLineItemFile",
    providerConfigJson: canonicalProviderConfig.configJson,
  });

  let storagePath = "";
  let storageKey: string | null = null;
  let storageBucket: string | null = null;

  if (target === "supabase" && isSupabaseConfigured()) {
    const storedFilename = generateStoredFilename(originalFilename);
    const relativePath = generateRelativePath({
      organizationId,
      orderNumber: undefined,
      lineItemId,
      storedFilename,
      resourceType: "order",
      resourceId: orderId,
    });

    const supabase = new SupabaseStorageService();
    const uploaded = await supabase.uploadFile(relativePath, buffer, mimeType || "application/octet-stream");
    const fileKey = normalizeObjectKeyForDb(uploaded.path);

    storagePath = fileKey;
    storageKey = fileKey;
    storageBucket = null;
  } else {
    const fileMetadata = await processUploadedFile({
      originalFilename,
      buffer,
      mimeType,
      organizationId,
      lineItemId,
      resourceType: "order",
      resourceId: orderId,
    });

    storagePath = fileMetadata.relativePath;
    storageKey = fileMetadata.relativePath;
    storageBucket = null;
  }

  // Insert database record
  const [insertedFile] = await db.insert(lineItemFiles).values({
    organizationId,
    orderId,
    lineItemId,
    prepressSessionId: prepressSessionId || null,
    role,
    status: "active",
    tag: tag || null,
    storageBucket,
    storagePath,
    storageKey,
    originalFilename,
    mimeType,
    sizeBytes: buffer.length,
    supersedesFileId: null,
    createdByUserId,
  }).returning();
  return insertedFile;
}

/**
 * Replace an existing file (marks old as SUPERSEDED)
 */
export async function replaceLineItemFile(params: {
  fileId: string;
  organizationId: string;
  buffer: Buffer;
  originalFilename: string;
  mimeType: string;
  createdByUserId: string;
}): Promise<LineItemFile> {
  const { fileId, organizationId, buffer, originalFilename, mimeType, createdByUserId } = params;

  // Get existing file
  const [existingFile] = await db
    .select()
    .from(lineItemFiles)
    .where(and(eq(lineItemFiles.id, fileId), eq(lineItemFiles.organizationId, organizationId)))
    .limit(1);

  if (!existingFile) {
    throw new Error("File not found");
  }

  if (existingFile.status !== "active") {
    throw new Error("Cannot replace superseded file");
  }

  // Upload new file
  const newFile = await uploadLineItemFile({
    organizationId,
    orderId: existingFile.orderId,
    lineItemId: existingFile.lineItemId,
    prepressSessionId: existingFile.prepressSessionId || undefined,
    role: existingFile.role as "original" | "final" | "reference",
    tag: existingFile.tag || undefined,
    buffer,
    originalFilename,
    mimeType,
    createdByUserId,
  });

  // Mark old file as superseded
  await db
    .update(lineItemFiles)
    .set({ status: "superseded" })
    .where(eq(lineItemFiles.id, fileId));

  // Update new file to reference old
  await db
    .update(lineItemFiles)
    .set({ supersedesFileId: fileId })
    .where(eq(lineItemFiles.id, newFile.id));

  return newFile;
}

/**
 * Download a file with job number prefix
 * Filename format: "{JOB_NUMBER}  {original_filename}" (two spaces)
 */
export async function downloadLineItemFile(
  fileId: string,
  organizationId: string,
  res: Response,
  options?: { inline?: boolean }
): Promise<void> {
  // Get file record
  const [file] = await db
    .select({
      file: lineItemFiles,
      order: orders,
      lineItem: orderLineItems,
    })
    .from(lineItemFiles)
    .innerJoin(orders, eq(lineItemFiles.orderId, orders.id))
    .innerJoin(orderLineItems, eq(lineItemFiles.lineItemId, orderLineItems.id))
    .where(and(eq(lineItemFiles.id, fileId), eq(lineItemFiles.organizationId, organizationId)))
    .limit(1);

  if (!file) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  // Get job number from order (orders table doesn't have jobNumber, use orderNumber)
  const jobNumber = file.order.orderNumber || "NOJOB";

  // Download filename with job number prefix + TWO SPACES
  const computedDisplayFilename = buildComputedDisplayFilename({
    role: file.file.role,
    originalFilename: file.file.originalFilename,
    tag: file.file.tag,
  });
  const downloadFilename = `${jobNumber}  ${computedDisplayFilename}`;
  const dispositionType = options?.inline ? "inline" : "attachment";
  const etag = buildPrepressDownloadEtag(file.file.id, file.file.sizeBytes, file.file.createdAt);
  const ifNoneMatchHeader = Array.isArray(res.req?.headers["if-none-match"])
    ? res.req?.headers["if-none-match"][0]
    : res.req?.headers["if-none-match"];
  const ifNoneMatch = typeof ifNoneMatchHeader === "string" ? ifNoneMatchHeader : null;
  const lastModified = file.file.createdAt ? new Date(file.file.createdAt).toUTCString() : null;

  if (ifNoneMatch && ifNoneMatch === etag) {
    res.status(304).end();
    return;
  }

  res.set({
    "Content-Type": file.file.mimeType,
    "Content-Disposition": `${dispositionType}; filename="${downloadFilename}"`,
    "Cache-Control": "private, max-age=0, must-revalidate",
    ETag: etag,
    "X-Served-As": "original",
  });

  if (lastModified) {
    res.set("Last-Modified", lastModified);
  }

  // Prepress bucket path
  if (file.file.storageBucket) {
    const bucket = getStorageClient().bucket(file.file.storageBucket || BUCKET_NAME);
    const gcsFile = bucket.file(file.file.storagePath);
    const [exists] = await gcsFile.exists();
    if (!exists) {
      res.status(404).json({ error: "File not found in storage" });
      return;
    }
    gcsFile.createReadStream().pipe(res);
    return;
  }

  const storageKey = (file.file.storageKey || file.file.storagePath || "").trim();
  if (!storageKey) {
    res.status(404).json({ error: "File storage key missing" });
    return;
  }

  if (isSupabaseConfigured()) {
    try {
      const supabase = new SupabaseStorageService();
      const signedUrl = await supabase.getSignedDownloadUrl(storageKey, 3600);
      const upstream = await fetch(signedUrl);
      if (upstream.ok && upstream.body) {
        const { Readable } = await import("stream");
        Readable.fromWeb(upstream.body as any).pipe(res);
        return;
      }
    } catch {
      // Fall through to local path.
    }
  }

  try {
    const { getAbsolutePath } = await import("./utils/fileStorage");
    const fs = await import("fs");
    const fsPromises = await import("fs/promises");
    const abs = getAbsolutePath(storageKey);
    await fsPromises.access(abs, fs.constants.R_OK);
    fs.createReadStream(abs).pipe(res);
    return;
  } catch {
    res.status(404).json({ error: "File not found in storage" });
    return;
  }
}

/**
 * Download all ORIGINAL files for a line item as a ZIP
 * Each file in the zip is prefixed with job number
 */
export async function downloadOriginalsAsZip(
  lineItemId: string,
  organizationId: string,
  res: Response
): Promise<void> {
  // Get all active ORIGINAL files for this line item
  const files = await db
    .select({
      file: lineItemFiles,
      order: orders,
    })
    .from(lineItemFiles)
    .innerJoin(orders, eq(lineItemFiles.orderId, orders.id))
    .where(
      and(
        eq(lineItemFiles.lineItemId, lineItemId),
        eq(lineItemFiles.organizationId, organizationId),
        eq(lineItemFiles.role, "original"),
        eq(lineItemFiles.status, "active")
      )
    )
    .orderBy(lineItemFiles.createdAt);

  if (files.length === 0) {
    res.status(404).json({ error: "No original files found" });
    return;
  }

  const jobNumber = files[0].order.orderNumber || "NOJOB";
  const zipFilename = `${jobNumber}  originals.zip`;

  res.set({
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${zipFilename}"`,
    "Cache-Control": "private, no-cache",
    "X-Served-As": "download",
  });

  const archive = archiver("zip", { zlib: { level: 6 } });
  
  archive.on("error", (err) => {
    console.error("[PrepressFiles] Archive error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to create archive" });
    }
  });

  archive.pipe(res);

  // Add each file to the archive with job number prefix
  for (const fileRecord of files) {
    const entryName = `${jobNumber}  ${fileRecord.file.originalFilename}`;

    if (fileRecord.file.storageBucket) {
      const bucket = getStorageClient().bucket(fileRecord.file.storageBucket || BUCKET_NAME);
      const gcsFile = bucket.file(fileRecord.file.storagePath);
      const [exists] = await gcsFile.exists();
      if (!exists) {
        console.warn(`[PrepressFiles] File not found in storage: ${fileRecord.file.storagePath}`);
        continue;
      }
      archive.append(gcsFile.createReadStream(), { name: entryName });
      continue;
    }

    const storageKey = (fileRecord.file.storageKey || fileRecord.file.storagePath || "").trim();
    if (!storageKey) {
      continue;
    }

    let appended = false;

    if (isSupabaseConfigured()) {
      try {
        const supabase = new SupabaseStorageService();
        const signedUrl = await supabase.getSignedDownloadUrl(storageKey, 3600);
        const upstream = await fetch(signedUrl);
        if (upstream.ok && upstream.body) {
          const { Readable } = await import("stream");
          archive.append(Readable.fromWeb(upstream.body as any), { name: entryName });
          appended = true;
        }
      } catch {
        // Fall through to local.
      }
    }

    if (appended) continue;

    try {
      const { getAbsolutePath } = await import("./utils/fileStorage");
      const fs = await import("fs");
      const fsPromises = await import("fs/promises");
      const abs = getAbsolutePath(storageKey);
      await fsPromises.access(abs, fs.constants.R_OK);
      archive.append(fs.createReadStream(abs), { name: entryName });
    } catch {
      console.warn(`[PrepressFiles] File not found in storage: ${storageKey}`);
    }
  }

  await archive.finalize();
}

/**
 * Get files for a line item grouped by role
 */
export async function getLineItemFiles(
  lineItemId: string,
  organizationId: string
): Promise<{
  originals: LineItemFile[];
  finals: LineItemFile[];
  references: LineItemFile[];
  bridgedOriginals: BridgedOriginal[];
}> {
  const allFiles = await db
    .select()
    .from(lineItemFiles)
    .where(
      and(
        eq(lineItemFiles.lineItemId, lineItemId),
        eq(lineItemFiles.organizationId, organizationId),
        eq(lineItemFiles.status, "active")
      )
    )
    .orderBy(lineItemFiles.createdAt);

  // Bridge in any order-level attachments that were uploaded before the order
  // entered the prepress queue (e.g. uploaded by customer on the checkout or
  // order detail page). These live in order_attachments keyed by orderLineItemId.
  const legacyRows = await db
    .select({
      id: orderAttachments.id,
      originalFilename: orderAttachments.originalFilename,
      fileName: orderAttachments.fileName,
      mimeType: orderAttachments.mimeType,
      sizeBytes: orderAttachments.sizeBytes,
      fileSize: orderAttachments.fileSize,
      role: orderAttachments.role,
      fileRecordId: orderAttachments.fileRecordId,
      fileUrl: orderAttachments.fileUrl,
      thumbKey: orderAttachments.thumbKey,
      createdAt: orderAttachments.createdAt,
      uploadedByName: orderAttachments.uploadedByName,
    })
    .from(orderAttachments)
    .where(eq(orderAttachments.orderLineItemId, lineItemId))
    .orderBy(orderAttachments.createdAt);

  const logOnce = createRequestLogOnce();
  const bridgedOriginals: BridgedOriginal[] = await Promise.all(legacyRows.map(async (row) => {
    const [originalAccess, thumbAccess] = await Promise.all([
      resolveOriginalFileAccess(row, { logOnce }),
      resolveDerivativeFileAccess(row, "thumbnail", { logOnce }),
    ]);

    return {
      id: row.id,
      originalFilename: row.originalFilename || row.fileName,
      mimeType: row.mimeType ?? null,
      sizeBytes: row.sizeBytes ?? row.fileSize ?? null,
      role: row.role ?? "other",
      createdAt: row.createdAt,
      source: "order_attachment" as const,
      downloadUrl: originalAccess.downloadUrl ?? originalAccess.originalUrl ?? "",
      thumbnailUrl: thumbAccess.url,
      uploadedBy: row.uploadedByName ?? null,
    };
  }));

  return {
    originals: allFiles.filter((f) => f.role === "original"),
    finals: allFiles.filter((f) => f.role === "final"),
    references: allFiles.filter((f) => f.role === "reference"),
    bridgedOriginals,
  };
}

export async function ensureFinalArtworkForLineItem(params: {
  organizationId: string;
  orderId: string;
  lineItemId: string;
  prepressSessionId?: string | null;
  createdByUserId: string;
}): Promise<EnsuredFinalArtworkResult | null> {
  const { organizationId, orderId, lineItemId, prepressSessionId, createdByUserId } = params;

  const [existingFinal] = await db
    .select()
    .from(lineItemFiles)
    .where(
      and(
        eq(lineItemFiles.organizationId, organizationId),
        eq(lineItemFiles.lineItemId, lineItemId),
        eq(lineItemFiles.role, "final"),
        eq(lineItemFiles.status, "active"),
      ),
    )
    .orderBy(desc(lineItemFiles.createdAt))
    .limit(1);

  if (existingFinal) {
    return {
      file: existingFinal,
      source: "existing_final",
      created: false,
    };
  }

  const [existingOriginal] = await db
    .select()
    .from(lineItemFiles)
    .where(
      and(
        eq(lineItemFiles.organizationId, organizationId),
        eq(lineItemFiles.lineItemId, lineItemId),
        eq(lineItemFiles.role, "original"),
        eq(lineItemFiles.status, "active"),
      ),
    )
    .orderBy(desc(lineItemFiles.createdAt))
    .limit(1);

  if (existingOriginal) {
    const [clonedFinal] = await db.insert(lineItemFiles).values({
      organizationId,
      orderId,
      lineItemId,
      prepressSessionId: prepressSessionId || existingOriginal.prepressSessionId || null,
      fileRecordId: existingOriginal.fileRecordId || null,
      role: "final",
      status: "active",
      tag: "final_print",
      storageBucket: existingOriginal.storageBucket || null,
      storagePath: existingOriginal.storagePath,
      storageKey: existingOriginal.storageKey || existingOriginal.storagePath,
      originalFilename: existingOriginal.originalFilename,
      mimeType: existingOriginal.mimeType,
      sizeBytes: existingOriginal.sizeBytes,
      supersedesFileId: null,
      createdByUserId,
    }).returning();

    return {
      file: clonedFinal,
      source: "line_item_original",
      created: true,
    };
  }

  const attachmentCandidates = await db
    .select({
      id: orderAttachments.id,
      fileRecordId: orderAttachments.fileRecordId,
      fileName: orderAttachments.fileName,
      originalFilename: orderAttachments.originalFilename,
      mimeType: orderAttachments.mimeType,
      fileUrl: orderAttachments.fileUrl,
      relativePath: orderAttachments.relativePath,
      sizeBytes: orderAttachments.sizeBytes,
      fileSize: orderAttachments.fileSize,
      role: orderAttachments.role,
      isPrimary: orderAttachments.isPrimary,
      createdAt: orderAttachments.createdAt,
    })
    .from(orderAttachments)
    .where(eq(orderAttachments.orderLineItemId, lineItemId))
    .orderBy(desc(orderAttachments.isPrimary), desc(orderAttachments.createdAt));

  const eligibleAttachment = attachmentCandidates.find((candidate) =>
    candidate.role === "artwork" || candidate.role === "proof" || candidate.role === "reference",
  );

  if (!eligibleAttachment) {
    return null;
  }

  const resolvedOriginal = await resolveOriginalFileAccess({
    id: eligibleAttachment.id,
    fileRecordId: eligibleAttachment.fileRecordId,
    fileName: eligibleAttachment.fileName,
    originalFilename: eligibleAttachment.originalFilename,
    mimeType: eligibleAttachment.mimeType,
    fileUrl: eligibleAttachment.fileUrl,
    fileKey: eligibleAttachment.relativePath,
  });

  const resolvedStoragePath =
    resolvedOriginal.objectPath ||
    eligibleAttachment.relativePath ||
    eligibleAttachment.fileUrl ||
    null;

  if (resolvedOriginal.availabilityStatus !== "available" || !resolvedStoragePath) {
    return null;
  }

  const [clonedAttachmentFinal] = await db.insert(lineItemFiles).values({
    organizationId,
    orderId,
    lineItemId,
    prepressSessionId: prepressSessionId || null,
    fileRecordId: eligibleAttachment.fileRecordId || null,
    role: "final",
    status: "active",
    tag: "final_print",
    storageBucket: null,
    storagePath: resolvedStoragePath,
    storageKey: resolvedStoragePath,
    originalFilename: eligibleAttachment.originalFilename || eligibleAttachment.fileName || `artwork-${eligibleAttachment.id}`,
    mimeType: eligibleAttachment.mimeType || resolvedOriginal.mimeType || "application/octet-stream",
    sizeBytes: Math.max(0, Number(eligibleAttachment.sizeBytes ?? eligibleAttachment.fileSize ?? 0)),
    supersedesFileId: null,
    createdByUserId,
  }).returning();

  return {
    file: clonedAttachmentFinal,
    source: "order_attachment",
    created: true,
  };
}

/**
 * Delete a file (soft delete by marking as superseded)
 */
export async function deleteLineItemFile(
  fileId: string,
  organizationId: string
): Promise<void> {
  await db
    .update(lineItemFiles)
    .set({ status: "superseded" })
    .where(and(eq(lineItemFiles.id, fileId), eq(lineItemFiles.organizationId, organizationId)));
}
