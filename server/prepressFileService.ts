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
import { lineItemFiles, prepressSessions, orders, orderLineItems } from "../shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { objectStorageClient } from "./objectStorage";
import type { Response } from "express";
import { randomUUID } from "crypto";
import archiver from "archiver";
import type { InsertLineItemFile, LineItemFile } from "../shared/schema";

const BUCKET_NAME = process.env.PREPRESS_FILES_BUCKET || process.env.GCS_BUCKET_NAME || "quotevaultpro-uploads";
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

  // Generate storage path: prepress/{org_id}/{line_item_id}/{uuid}_{filename}
  const fileId = randomUUID();
  const safeName = originalFilename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `prepress/${organizationId}/${lineItemId}/${fileId}_${safeName}`;

  // Upload to GCS
  const bucket = objectStorageClient.bucket(BUCKET_NAME);
  const file = bucket.file(storagePath);
  
  await file.save(buffer, {
    contentType: mimeType,
    metadata: {
      metadata: {
        organizationId,
        orderId,
        lineItemId,
        role,
        originalFilename,
        uploadedBy: createdByUserId,
      },
    },
  });

  // Insert database record
  const [insertedFile] = await db.insert(lineItemFiles).values({
    organizationId,
    orderId,
    lineItemId,
    prepressSessionId: prepressSessionId || null,
    role,
    status: "active",
    tag: tag || null,
    storageBucket: BUCKET_NAME,
    storagePath,
    storageKey: null,
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

  // Download from storage
  const bucket = objectStorageClient.bucket(file.file.storageBucket || BUCKET_NAME);
  const gcsFile = bucket.file(file.file.storagePath);

  const [exists] = await gcsFile.exists();
  if (!exists) {
    res.status(404).json({ error: "File not found in storage" });
    return;
  }

  const [metadata] = await gcsFile.getMetadata();

  // Download filename with job number prefix + TWO SPACES
  const computedDisplayFilename = buildComputedDisplayFilename({
    role: file.file.role,
    originalFilename: file.file.originalFilename,
    tag: file.file.tag,
  });
  const downloadFilename = `${jobNumber}  ${computedDisplayFilename}`;
  const dispositionType = options?.inline ? "inline" : "attachment";

  res.set({
    "Content-Type": file.file.mimeType,
    "Content-Length": metadata.size,
    "Content-Disposition": `${dispositionType}; filename="${downloadFilename}"`,
    "Cache-Control": "private, no-cache",
  });

  gcsFile.createReadStream().pipe(res);
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
    const bucket = objectStorageClient.bucket(fileRecord.file.storageBucket || BUCKET_NAME);
    const gcsFile = bucket.file(fileRecord.file.storagePath);

    const [exists] = await gcsFile.exists();
    if (!exists) {
      console.warn(`[PrepressFiles] File not found in storage: ${fileRecord.file.storagePath}`);
      continue;
    }

    // Archive entry name with job number prefix + TWO SPACES
    const entryName = `${jobNumber}  ${fileRecord.file.originalFilename}`;
    
    archive.append(gcsFile.createReadStream(), { name: entryName });
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

  return {
    originals: allFiles.filter((f) => f.role === "original"),
    finals: allFiles.filter((f) => f.role === "final"),
    references: allFiles.filter((f) => f.role === "reference"),
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
