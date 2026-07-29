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
import { auditLogs, lineItemFiles, orders, orderLineItems, orderAttachments, organizations, productionJobs, localFileDestinations, localFileCopyJobs } from "../shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { getStorageClient } from "./objectStorage";
import type { Response } from "express";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import archiver from "archiver";
import type { LineItemFile } from "../shared/schema";
import { isSupabaseConfigured, SupabaseStorageService } from "./supabaseStorage";
import {
  createRequestLogOnce,
  resolveDerivativeFileAccess,
  resolveOriginalFileAccess,
} from "./lib/supabaseObjectHelpers";
import {
  DEFAULT_FILE_UPLOAD_NAMING_POLICY,
  buildFileUploadDisplayFilename,
  normalizeFileUploadJobPrefixMode,
  normalizePrepressFileLabel,
  normalizePrepressFileLabelMode,
  numericJobNumberFromFull,
  type FileUploadNamingPolicy,
  type PrepressFileLabel,
} from "@shared/fileUploadNaming";
import { DEFAULT_ORGANIZATION_ID } from "./tenantContext";
import {
  getCanonicalOriginalFileIdentity,
  withOrderOriginalArtworkDisplayFilename,
} from "./services/originalArtworkFiles";
import {
  classifyPrepressFileForDisplay,
  type PrepressFileDisplayCategory,
} from "@shared/prepressFileClassification";
import { storageApplicationService } from "./services/storage/StorageApplicationService";
import { assetPreviewGenerator } from "./services/assets/AssetPreviewGenerator";
import { fileDerivativeRepository } from "./storage/fileDerivative.repo";
import { storagePlacementRepository } from "./storage/storagePlacement.repo";
import { resolveProductionSides } from "@shared/productionHydration";

const BUCKET_NAME = process.env.PREPRESS_FILES_BUCKET || process.env.GCS_BUCKET_NAME || "quotevaultpro-uploads";

function buildPrepressDownloadEtag(fileId: string, sizeBytes: number | null | undefined, createdAt: Date | string | null | undefined) {
  const createdAtValue = createdAt ? new Date(createdAt).getTime() : 0;
  return `W/\"prepress-${fileId}-${sizeBytes ?? 0}-${createdAtValue}\"`;
}

type DownloadFailureStatus = 404 | 409 | 410 | 422 | 502 | 503;

function createDownloadRequestId() {
  return `prepress-download-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sendDownloadFailure(
  res: Response,
  status: DownloadFailureStatus,
  code: string,
  message: string,
  requestId: string,
): void {
  if (res.headersSent) {
    // A status body cannot safely be added after file bytes have begun. Keep the
    // response valid for the client that already received it and record a
    // correlation id for server-side diagnosis.
    console.error("[PrepressFileDownload] Stream failed after response started", { requestId, code });
    res.destroy();
    return;
  }

  res.removeHeader("Content-Disposition");
  res.removeHeader("Content-Length");
  res.removeHeader("ETag");
  res.removeHeader("Last-Modified");
  res.status(status).json({ error: message, code, requestId });
}

function logDownloadFailure(
  requestId: string,
  fileId: string,
  organizationId: string,
  stage: string,
  error: unknown,
): void {
  console.error("[PrepressFileDownload] Failed", {
    requestId,
    fileId,
    organizationId,
    stage,
    error: error instanceof Error ? error.message : String(error),
  });
}

function buildContentDisposition(dispositionType: "attachment" | "inline", filename: string): string {
  const normalized = filename
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "_")
    .trim() || "download";
  const asciiFallback = normalized
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_") || "download";
  const encoded = encodeURIComponent(normalized).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `${dispositionType}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

function resolveDownloadContentType(mimeType: string | null | undefined, filename: string): string {
  if (mimeType && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:;\s*charset=[a-z0-9._-]+)?$/i.test(mimeType)) {
    return mimeType;
  }

  const extension = filename.split(".").pop()?.toLowerCase();
  const fallbackByExtension: Record<string, string> = {
    pdf: "application/pdf",
    ai: "application/pdf",
    eps: "application/postscript",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    tif: "image/tiff",
    tiff: "image/tiff",
  };
  return (extension && fallbackByExtension[extension]) || "application/octet-stream";
}

function setDownloadHeaders(
  res: Response,
  params: { contentType: string; dispositionType: "attachment" | "inline"; filename: string; etag: string; lastModified: string | null },
): void {
  res.set({
    "Content-Type": params.contentType,
    "Content-Disposition": buildContentDisposition(params.dispositionType, params.filename),
    "Cache-Control": "private, max-age=0, must-revalidate",
    ETag: params.etag,
    "X-Served-As": "original",
  });
  if (params.lastModified) {
    res.set("Last-Modified", params.lastModified);
  }
}

async function streamDownload(
  source: NodeJS.ReadableStream,
  res: Response,
  context: { requestId: string; fileId: string; organizationId: string; stage: string },
  onReadyToRespond: () => void,
): Promise<void> {
  try {
    // Read the first chunk before committing response headers. A missing object,
    // expired private URL, or immediate provider-stream error is therefore a
    // normal JSON failure rather than a browser-level invalid response.
    const iterator = (source as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    const firstChunk = await iterator.next();
    const preparedSource = Readable.from((async function* () {
      if (!firstChunk.done) yield firstChunk.value;
      for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) {
        yield chunk;
      }
    })());

    onReadyToRespond();
    await pipeline(preparedSource, res);
  } catch (error) {
    logDownloadFailure(context.requestId, context.fileId, context.organizationId, context.stage, error);
    sendDownloadFailure(res, 503, "FILE_STREAM_UNAVAILABLE", "The file is temporarily unavailable. Please try again.", context.requestId);
  }
}

/**
 * Normalized shape for order-level attachments surfaced in the prepress file panel.
 * These originate from the `order_attachments` table and are bridged read-only
 * into the appropriate customer-original or proof collection.
 */
export type BridgedOriginal = {
  id: string;
  originalFilename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  role: string;
  side: "front" | "back" | "both" | "na";
  createdAt: Date;
  source: 'order_attachment';
  prepressCategory: PrepressFileDisplayCategory;
  systemGenerated: boolean;
  tagLabel: string;
  downloadUrl: string;
  thumbnailUrl: string | null;
  uploadedBy: string | null;
  displayFilename: string;
  computedDisplayFilename: string;
};

export type PrepressLineItemFile = LineItemFile & {
  artworkSide: "front" | "back" | "both" | "na";
  orderAttachmentId?: string | null;
};

type ArtworkSideSource = {
  id: string;
  fileRecordId?: string | null;
  fileName?: string | null;
  originalFilename?: string | null;
  fileSize?: number | null;
  sizeBytes?: number | null;
  side?: string | null;
};

/** Merge order-attachment side metadata onto canonical prepress originals. */
export function mergeArtworkSidesIntoPrepressFiles<T extends Record<string, any>>(
  files: T[],
  attachments: ArtworkSideSource[],
): Array<T & { artworkSide: "front" | "back" | "both" | "na"; orderAttachmentId?: string | null }> {
  const attachmentsByIdentity = new Map<string, ArtworkSideSource[]>();
  for (const attachment of attachments) {
    const identity = getCanonicalOriginalFileIdentity(attachment);
    if (!identity) continue;
    const existing = attachmentsByIdentity.get(identity) ?? [];
    existing.push(attachment);
    attachmentsByIdentity.set(identity, existing);
  }

  return files.map((file) => {
    const identity = getCanonicalOriginalFileIdentity(file);
    const matches = identity ? attachmentsByIdentity.get(identity) ?? [] : [];
    const sides = new Set(matches.map((match) => String(match.side ?? "na").toLowerCase()));
    const artworkSide = sides.has("both") || (sides.has("front") && sides.has("back"))
      ? "both"
      : sides.has("front")
        ? "front"
        : sides.has("back")
          ? "back"
          : "na";
    const matchingAttachment = matches.find((match) => String(match.side ?? "na").toLowerCase() === artworkSide)
      ?? matches[0];
    return {
      ...file,
      artworkSide,
      orderAttachmentId: matchingAttachment?.id ?? null,
    };
  });
}

export type EnsuredFinalArtworkResult = {
  file: LineItemFile;
  files: LineItemFile[];
  source: "existing_final" | "line_item_original" | "order_attachment";
  created: boolean;
};

export type PrintReadyArtworkCandidate = {
  id: string;
  fileRecordId?: string | null;
  aliasIds?: string[];
  side?: string | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function candidateMatchesId(candidate: PrintReadyArtworkCandidate, fileId: string): boolean {
  return candidate.id === fileId
    || candidate.fileRecordId === fileId
    || candidate.aliasIds?.includes(fileId) === true;
}

/**
 * Resolves print-ready source files from stable assignment IDs/side metadata.
 * Multiple unassigned files are deliberately rejected: upload order, filename,
 * and `isPrimary` are not safe production-artwork signals.
 */
export function resolvePrintReadyArtworkCandidates<T extends PrintReadyArtworkCandidate>(args: {
  lineItem: unknown;
  candidates: T[];
}): T[] {
  const candidates = args.candidates;
  if (candidates.length <= 1) return candidates;

  const lineItem = record(args.lineItem) ?? {};
  const specs = record(lineItem.specsJson);
  const assignment = record(specs?.artworkSideAssignment);
  const assignedCandidate = (value: unknown): T | null => typeof value === "string" && value.trim()
    ? candidates.find((candidate) => candidateMatchesId(candidate, value.trim())) ?? null
    : null;
  const side = (candidate: T) => String(candidate.side ?? "").trim().toLowerCase();
  const both = assignedCandidate(assignment?.bothFileId)
    ?? assignedCandidate(assignment?.sharedFileId)
    ?? candidates.find((candidate) => side(candidate) === "both")
    ?? null;
  const front = assignedCandidate(assignment?.frontFileId)
    ?? assignedCandidate(assignment?.fileId)
    ?? candidates.find((candidate) => side(candidate) === "front")
    ?? null;
  const back = assignedCandidate(assignment?.backFileId)
    ?? candidates.find((candidate) => side(candidate) === "back")
    ?? null;
  if (both) return [both];

  if (resolveProductionSides(lineItem) === "Double-sided") {
    if (assignment?.useSameArtworkBothSides === true && front) return [front];
    if (front && back) return front.id === back.id ? [front] : [front, back];
    throw Object.assign(
      new Error("This double-sided line needs explicit Front and Back artwork, or one file assigned as Both, before using artwork as the print file."),
      { statusCode: 409, code: "PRINT_READY_ARTWORK_SIDES_INCOMPLETE" },
    );
  }
  if (front && !back) return [front];

  throw Object.assign(
    new Error("This line has multiple artwork files. Assign the production artwork as Front, Back, or Both before using artwork as the print file."),
    { statusCode: 409, code: "PRINT_READY_ARTWORK_AMBIGUOUS" },
  );
}
const MAX_FILE_SIZE_MB = 250;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

function mapTagToPrepressLabel(tag?: string | null): PrepressFileLabel {
  const normalized = (tag || "").trim().toLowerCase();
  if (!normalized || normalized === "none") return "none";
  if (normalized === "proof_only" || normalized === "proof") return "proof";
  if (normalized === "cut_file" || normalized === "cut") return "cut_file";
  if (normalized === "final_print" || normalized === "print") return "print";
  return normalizePrepressFileLabel(normalized);
}

export function resolveFileUploadNamingPolicyFromPreferences(
  preferences: unknown,
  organizationId?: string | null
): FileUploadNamingPolicy {
  const namingPreferences = ((preferences as any)?.fileUploadNaming && typeof (preferences as any).fileUploadNaming === "object")
    ? (preferences as any).fileUploadNaming
    : {};

  const titanDefault: FileUploadNamingPolicy | null = organizationId === DEFAULT_ORGANIZATION_ID
    ? {
        fileUploadJobPrefixMode: "numeric_only",
        prepressFileLabelMode: "optional",
      }
    : null;

  const base = titanDefault ?? DEFAULT_FILE_UPLOAD_NAMING_POLICY;

  return {
    fileUploadJobPrefixMode: normalizeFileUploadJobPrefixMode(
      namingPreferences.fileUploadJobPrefixMode ?? base.fileUploadJobPrefixMode
    ),
    prepressFileLabelMode: normalizePrepressFileLabelMode(
      namingPreferences.prepressFileLabelMode ?? base.prepressFileLabelMode
    ),
  };
}

export async function getFileUploadNamingPolicy(organizationId: string): Promise<FileUploadNamingPolicy> {
  const [org] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const preferences = (org?.settings as any)?.preferences;
  return resolveFileUploadNamingPolicyFromPreferences(preferences, organizationId);
}

export function buildComputedDisplayFilename(params: {
  role: string;
  originalFilename: string;
  tag?: string | null;
  fullJobNumber?: string | null;
  numericJobNumber?: string | null;
  namingPolicy?: FileUploadNamingPolicy | null;
}): string {
  const { role, originalFilename, tag } = params;
  const namingPolicy = params.namingPolicy ?? DEFAULT_FILE_UPLOAD_NAMING_POLICY;
  const fullJobNumber = params.fullJobNumber ?? "";
  const numericJobNumber = params.numericJobNumber ?? numericJobNumberFromFull(fullJobNumber);
  const prepressLabel = role === "final" ? mapTagToPrepressLabel(tag) : "none";

  return buildFileUploadDisplayFilename({
    originalFilename,
    fullJobNumber,
    numericJobNumber,
    fileUploadJobPrefixMode: namingPolicy.fileUploadJobPrefixMode,
    prepressLabel,
    labelPlacement: role === "final" ? "after_job_prefix" : "suffix",
  });
}

export async function generateFinalProductionFilePreview(
  args: {
    role: "original" | "final" | "reference";
    organizationId: string;
    fileRecordId: string;
    fileName: string;
    mimeType?: string | null;
  },
  generator: Pick<typeof assetPreviewGenerator, "generateCanonicalFilePreviews"> = assetPreviewGenerator,
): Promise<"ready" | "unsupported" | "failed" | "not_applicable"> {
  if (args.role !== "final") return "not_applicable";
  return generator.generateCanonicalFilePreviews({
    organizationId: args.organizationId,
    fileRecordId: args.fileRecordId,
    fileName: args.fileName,
    mimeType: args.mimeType,
  });
}

/**
 * Upload a file to storage and create line_item_files record
 */
export async function uploadLineItemFile(params: {
  organizationId: string;
  orderId: string;
  lineItemId: string;
  productionRunId?: string | null;
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
    productionRunId,
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

  const stored = await storageApplicationService.finalizeUpload({
    organizationId,
    createdByUserId,
    resource: {
      organizationId,
      resourceType: "order",
      resourceId: orderId,
      lineItemId,
    },
    source: {
      kind: "buffer",
      buffer,
      originalFilename,
      mimeType: mimeType || "application/octet-stream",
    },
    persistLink: async (tx, result) => {
      const storagePath = result.legacyRelativePath ?? result.legacyFileUrl;
      const [inserted] = await tx.insert(lineItemFiles).values({
        organizationId,
        orderId,
        lineItemId,
        productionRunId: productionRunId ?? null,
        prepressSessionId: prepressSessionId || null,
        fileRecordId: result.fileRecord.id,
        role,
        status: "active",
        tag: tag || null,
        storageBucket: result.storedObject.bucket,
        storagePath,
        storageKey: result.storedObject.objectKey ?? result.storedObject.localPathRef,
        originalFilename,
        mimeType: result.storedObject.mimeType,
        sizeBytes: result.storedObject.sizeBytes,
        supersedesFileId: null,
        createdByUserId,
      }).returning();
      return inserted;
    },
  });

  if (role === "final") {
    await queueLineItemFilePreviewRepair({
      fileId: stored.linkedRecord.id,
      organizationId,
      actorUserId: createdByUserId,
    }).completion;
  }

  return stored.linkedRecord;
}

/**
 * Queue a copy only after a final production-file relationship is authoritative.
 * A prepress upload can be a candidate; it must not be copied merely because it
 * was uploaded. The final relation ID makes retries idempotent.
 */
export async function enqueueFinalProductionFileCopy(params: {
  organizationId: string;
  file: LineItemFile;
}): Promise<{ enqueued: boolean; copyJobId: string | null }> {
  const [order] = await db
    .select({ customerId: orders.customerId, orderNumber: orders.orderNumber })
    .from(orders)
    .where(and(eq(orders.id, params.file.orderId), eq(orders.organizationId, params.organizationId)))
    .limit(1);
  if (!order?.customerId) return { enqueued: false, copyJobId: null };

  const [destination] = await db
    .select({ id: localFileDestinations.id })
    .from(localFileDestinations)
    .where(and(
      eq(localFileDestinations.organizationId, params.organizationId),
      eq(localFileDestinations.customerId, order.customerId),
      eq(localFileDestinations.enabled, true),
    ))
    .limit(1);
  if (!destination) return { enqueued: false, copyJobId: null };

  const [existing] = await db
    .select({ id: localFileCopyJobs.id })
    .from(localFileCopyJobs)
    .where(and(
      eq(localFileCopyJobs.organizationId, params.organizationId),
      eq(localFileCopyJobs.destinationId, destination.id),
      eq(localFileCopyJobs.sourceFileId, params.file.id),
    ))
    .limit(1);
  if (existing) return { enqueued: false, copyJobId: existing.id };

  const namingPolicy = await getFileUploadNamingPolicy(params.organizationId);
  const outputFilename = buildComputedDisplayFilename({
    role: params.file.role,
    originalFilename: params.file.originalFilename,
    tag: params.file.tag,
    fullJobNumber: order.orderNumber || "",
    numericJobNumber: numericJobNumberFromFull(order.orderNumber || ""),
    namingPolicy,
  });
  const [copyJob] = await db.insert(localFileCopyJobs).values({
    organizationId: params.organizationId,
    destinationId: destination.id,
    sourceFileId: params.file.id,
    orderId: params.file.orderId,
    orderLineItemId: params.file.lineItemId,
    customerId: order.customerId,
    outputFilename,
  }).returning({ id: localFileCopyJobs.id });
  return { enqueued: true, copyJobId: copyJob.id };
}

/** Canonicalize a legacy line-item file when necessary and generate its preview derivatives. */
export async function ensureLineItemFilePreview(params: {
  fileId: string;
  organizationId: string;
  actorUserId: string;
}): Promise<{ fileRecordId: string; previewStatus: "ready" | "unsupported" | "failed" }> {
  const { fileId, organizationId, actorUserId } = params;
  const [existing] = await db
    .select()
    .from(lineItemFiles)
    .where(and(
      eq(lineItemFiles.id, fileId),
      eq(lineItemFiles.organizationId, organizationId),
      eq(lineItemFiles.status, "active"),
    ))
    .limit(1);

  if (!existing) throw new Error("File not found");

  let fileRecordId = existing.fileRecordId;
  if (!fileRecordId) {
    const legacyKey = existing.storageKey || existing.storagePath;
    if (!legacyKey) throw new Error("File storage location is missing");

    const canonicalized = await storageApplicationService.finalizeUpload({
      organizationId,
      createdByUserId: actorUserId,
      resource: {
        organizationId,
        resourceType: "order",
        resourceId: existing.orderId,
        lineItemId: existing.lineItemId,
      },
      source: {
        kind: "existing-key",
        fileUrl: legacyKey,
        originalFilename: existing.originalFilename,
        mimeType: existing.mimeType,
        fileSize: existing.sizeBytes,
      },
      persistLink: async (tx, result) => {
        const [updated] = await tx
          .update(lineItemFiles)
          .set({ fileRecordId: result.fileRecord.id })
          .where(and(
            eq(lineItemFiles.id, fileId),
            eq(lineItemFiles.organizationId, organizationId),
          ))
          .returning();
        return updated;
      },
    });
    fileRecordId = canonicalized.fileRecord.id;
  }

  const previewResult = await generateFinalProductionFilePreview({
    role: "final",
    organizationId,
    fileRecordId,
    fileName: existing.originalFilename,
    mimeType: existing.mimeType,
  });
  const previewStatus = previewResult === "not_applicable" ? "failed" : previewResult;

  return { fileRecordId, previewStatus };
}

type PreviewRepairResult = Awaited<ReturnType<typeof ensureLineItemFilePreview>>;
type PreviewRepairEntry = {
  completion: Promise<PreviewRepairResult>;
  startedAt: Date;
};

type PromotableArtworkFile = {
  fileRecordId?: string | null;
  sourceFileId?: string | null;
  sourceOrderAttachmentId?: string | null;
  sourceType?: "line_item_original" | "order_attachment" | null;
  productionArtworkSourceType?: string | null;
  sourceArtworkSide?: "front" | "back" | "both" | "na" | null;
  storageBucket?: string | null;
  storagePath: string;
  storageKey?: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  productionQuantity?: number | null;
  productionGroupId?: string | null;
};

export function buildPromotedFinalFileLink(params: {
  organizationId: string;
  orderId: string;
  lineItemId: string;
  prepressSessionId?: string | null;
  createdByUserId: string;
  tag?: string | null;
  source: PromotableArtworkFile;
}) {
  return {
    organizationId: params.organizationId,
    orderId: params.orderId,
    lineItemId: params.lineItemId,
    prepressSessionId: params.prepressSessionId ?? null,
    fileRecordId: params.source.fileRecordId ?? null,
    role: "final" as const,
    status: "active" as const,
    tag: params.tag ?? null,
    productionArtworkSourceType: params.source.productionArtworkSourceType ?? (params.source.sourceType ? "customer_artwork_promotion" : null),
    sourceFileId: params.source.sourceFileId ?? null,
    sourceOrderAttachmentId: params.source.sourceOrderAttachmentId ?? null,
    sourceArtworkSide: params.source.sourceArtworkSide ?? null,
    productionQuantity: params.source.productionQuantity ?? null,
    productionGroupId: params.source.productionGroupId ?? null,
    storageBucket: params.source.storageBucket ?? null,
    storagePath: params.source.storagePath,
    storageKey: params.source.storageKey ?? params.source.storagePath,
    originalFilename: params.source.originalFilename,
    mimeType: params.source.mimeType,
    sizeBytes: params.source.sizeBytes,
    supersedesFileId: null,
    createdByUserId: params.createdByUserId,
  };
}

export type PromoteCustomerArtworkSource =
  | { kind: "line_item_original"; fileId: string }
  | { kind: "order_attachment"; attachmentId: string };

export async function promoteCustomerArtworkToProductionArtwork(params: {
  organizationId: string;
  orderId: string;
  lineItemId: string;
  prepressSessionId?: string | null;
  createdByUserId: string;
  tag: string;
  artworkSide: "front" | "back" | "both" | "na";
  source: PromoteCustomerArtworkSource;
}): Promise<{ file: LineItemFile; created: boolean }> {
  const tag = params.tag.trim();
  if (!tag || tag === "none") {
    throw Object.assign(new Error("Production tag is required."), { statusCode: 400, code: "PRODUCTION_TAG_REQUIRED" });
  }

  let source: PromotableArtworkFile;
  if (params.source.kind === "line_item_original") {
    const [original] = await db
      .select()
      .from(lineItemFiles)
      .where(and(
        eq(lineItemFiles.id, params.source.fileId),
        eq(lineItemFiles.organizationId, params.organizationId),
        eq(lineItemFiles.orderId, params.orderId),
        eq(lineItemFiles.lineItemId, params.lineItemId),
        eq(lineItemFiles.role, "original"),
        eq(lineItemFiles.status, "active"),
      ))
      .limit(1);
    if (!original) {
      throw Object.assign(new Error("Customer artwork source file not found."), { statusCode: 404, code: "SOURCE_ARTWORK_NOT_FOUND" });
    }
    source = {
      fileRecordId: original.fileRecordId,
      sourceFileId: original.id,
      sourceOrderAttachmentId: null,
      sourceType: "line_item_original",
      sourceArtworkSide: params.artworkSide,
      storageBucket: original.storageBucket,
      storagePath: original.storagePath,
      storageKey: original.storageKey,
      originalFilename: original.originalFilename,
      mimeType: original.mimeType,
      sizeBytes: original.sizeBytes,
      productionQuantity: original.productionQuantity,
      productionGroupId: original.productionGroupId,
    };
  } else {
    const [attachment] = await db
      .select({
        id: orderAttachments.id,
        orderId: orderAttachments.orderId,
        orderLineItemId: orderAttachments.orderLineItemId,
        fileRecordId: orderAttachments.fileRecordId,
        fileName: orderAttachments.fileName,
        originalFilename: orderAttachments.originalFilename,
        mimeType: orderAttachments.mimeType,
        fileUrl: orderAttachments.fileUrl,
        relativePath: orderAttachments.relativePath,
        sizeBytes: orderAttachments.sizeBytes,
        fileSize: orderAttachments.fileSize,
        role: orderAttachments.role,
        side: orderAttachments.side,
        productionQuantity: orderAttachments.productionQuantity,
        productionGroupId: orderAttachments.productionGroupId,
      })
      .from(orderAttachments)
      .innerJoin(orders, eq(orderAttachments.orderId, orders.id))
      .where(and(
        eq(orderAttachments.id, params.source.attachmentId),
        eq(orderAttachments.orderId, params.orderId),
        eq(orderAttachments.orderLineItemId, params.lineItemId),
        eq(orderAttachments.role, "artwork"),
        eq(orders.organizationId, params.organizationId),
      ))
      .limit(1);
    if (!attachment) {
      throw Object.assign(new Error("Customer artwork attachment not found."), { statusCode: 404, code: "SOURCE_ARTWORK_NOT_FOUND" });
    }
    const resolvedOriginal = await resolveOriginalFileAccess({
      id: attachment.id,
      fileRecordId: attachment.fileRecordId,
      fileName: attachment.fileName,
      originalFilename: attachment.originalFilename,
      mimeType: attachment.mimeType,
      fileUrl: attachment.fileUrl,
      fileKey: attachment.relativePath,
    });
    const resolvedStoragePath = resolvedOriginal.objectPath || attachment.relativePath || attachment.fileUrl || null;
    if (resolvedOriginal.availabilityStatus !== "available" || !resolvedStoragePath) {
      throw Object.assign(new Error("Customer artwork source is not available for promotion."), { statusCode: 409, code: "SOURCE_STORAGE_PLACEMENT_MISSING" });
    }
    source = {
      fileRecordId: attachment.fileRecordId,
      sourceFileId: null,
      sourceOrderAttachmentId: attachment.id,
      sourceType: "order_attachment",
      sourceArtworkSide: params.artworkSide,
      storageBucket: null,
      storagePath: resolvedStoragePath,
      storageKey: resolvedStoragePath,
      originalFilename: attachment.originalFilename || attachment.fileName || `artwork-${attachment.id}`,
      mimeType: attachment.mimeType || resolvedOriginal.mimeType || "application/octet-stream",
      sizeBytes: Math.max(0, Number(attachment.sizeBytes ?? attachment.fileSize ?? 0)),
      productionQuantity: attachment.productionQuantity ?? null,
      productionGroupId: attachment.productionGroupId ?? null,
    };
  }

  const sourceConditions = params.source.kind === "line_item_original"
    ? [eq(lineItemFiles.sourceFileId, params.source.fileId)]
    : [eq(lineItemFiles.sourceOrderAttachmentId, params.source.attachmentId)];
  const [existing] = await db
    .select()
    .from(lineItemFiles)
    .where(and(
      eq(lineItemFiles.organizationId, params.organizationId),
      eq(lineItemFiles.orderId, params.orderId),
      eq(lineItemFiles.lineItemId, params.lineItemId),
      eq(lineItemFiles.role, "final"),
      eq(lineItemFiles.status, "active"),
      eq(lineItemFiles.tag, tag),
      eq(lineItemFiles.sourceArtworkSide, params.artworkSide),
      eq(lineItemFiles.productionArtworkSourceType, "customer_artwork_promotion"),
      ...sourceConditions,
    ))
    .limit(1);
  if (existing) return { file: existing, created: false };

  if (!source.fileRecordId) {
    throw Object.assign(new Error("Customer artwork is missing a canonical source file record."), { statusCode: 409, code: "SOURCE_STORAGE_PLACEMENT_MISSING" });
  }

  const stored = await storageApplicationService.finalizeUpload({
    organizationId: params.organizationId,
    createdByUserId: params.createdByUserId,
    resource: {
      organizationId: params.organizationId,
      resourceType: "order",
      resourceId: params.orderId,
      lineItemId: params.lineItemId,
    },
    source: {
      kind: "existing-file-record",
      fileRecordId: source.fileRecordId,
      originalFilename: source.originalFilename,
      mimeType: source.mimeType,
      fileSize: source.sizeBytes,
    },
    persistLink: async (tx, result) => {
      const storagePath = result.legacyRelativePath ?? result.legacyFileUrl;
      const [inserted] = await tx.insert(lineItemFiles).values(buildPromotedFinalFileLink({
        organizationId: params.organizationId,
        orderId: params.orderId,
        lineItemId: params.lineItemId,
        prepressSessionId: params.prepressSessionId ?? null,
        createdByUserId: params.createdByUserId,
        tag,
        source: {
          ...source,
          fileRecordId: result.fileRecord.id,
          storageBucket: result.storedObject.bucket,
          storagePath,
          storageKey: result.storedObject.objectKey ?? result.storedObject.localPathRef ?? storagePath,
          mimeType: result.storedObject.mimeType,
          sizeBytes: result.storedObject.sizeBytes,
        },
      })).returning();
      await tx.insert(auditLogs).values({
        organizationId: params.organizationId,
        userId: params.createdByUserId,
        actionType: "promoted_customer_artwork_to_production_artwork",
        entityType: "order_line_item",
        entityId: params.lineItemId,
        description: "Promoted customer artwork to production artwork.",
        newValues: {
          originalCustomerFileId: source.sourceFileId,
          originalCustomerAttachmentId: source.sourceOrderAttachmentId,
          productionFileId: inserted.id,
          lineItemId: params.lineItemId,
          tag,
          artworkSide: params.artworkSide,
          sourceType: source.sourceType,
        },
      });
      return inserted;
    },
  });

  await queueLineItemFilePreviewRepair({
    fileId: stored.linkedRecord.id,
    organizationId: params.organizationId,
    actorUserId: params.createdByUserId,
  }).completion;
  await enqueueFinalProductionFileCopy({ organizationId: params.organizationId, file: stored.linkedRecord }).catch(() => ({ enqueued: false, copyJobId: null }));
  return { file: stored.linkedRecord, created: true };
}

export async function assignCustomerArtworkAsProductionArtwork(params: {
  organizationId: string;
  orderId: string;
  lineItemId: string;
  prepressSessionId?: string | null;
  createdByUserId: string;
  tag: string;
  artworkSide: "front" | "back" | "both" | "na";
  source: PromoteCustomerArtworkSource;
}): Promise<{ file: LineItemFile; created: boolean }> {
  const tag = params.tag.trim();
  if (!tag || tag === "none") {
    throw Object.assign(new Error("Production tag is required."), { statusCode: 400, code: "PRODUCTION_TAG_REQUIRED" });
  }

  let source: PromotableArtworkFile;
  if (params.source.kind === "line_item_original") {
    const [original] = await db
      .select()
      .from(lineItemFiles)
      .where(and(
        eq(lineItemFiles.id, params.source.fileId),
        eq(lineItemFiles.organizationId, params.organizationId),
        eq(lineItemFiles.orderId, params.orderId),
        eq(lineItemFiles.lineItemId, params.lineItemId),
        eq(lineItemFiles.role, "original"),
        eq(lineItemFiles.status, "active"),
      ))
      .limit(1);
    if (!original) {
      throw Object.assign(new Error("Customer artwork source file not found."), { statusCode: 404, code: "SOURCE_ARTWORK_NOT_FOUND" });
    }
    if (!original.fileRecordId) {
      throw Object.assign(new Error("Customer artwork is missing a canonical file identity and cannot be assigned without copying."), { statusCode: 409, code: "SOURCE_STORAGE_PLACEMENT_MISSING" });
    }
    source = {
      fileRecordId: original.fileRecordId,
      sourceFileId: original.id,
      sourceOrderAttachmentId: null,
      sourceType: "line_item_original",
      sourceArtworkSide: params.artworkSide,
      storageBucket: original.storageBucket,
      storagePath: original.storagePath,
      storageKey: original.storageKey,
      originalFilename: original.originalFilename,
      mimeType: original.mimeType,
      sizeBytes: original.sizeBytes,
      productionQuantity: original.productionQuantity,
      productionGroupId: original.productionGroupId,
    };
  } else {
    const [attachment] = await db
      .select({
        id: orderAttachments.id,
        orderId: orderAttachments.orderId,
        orderLineItemId: orderAttachments.orderLineItemId,
        fileRecordId: orderAttachments.fileRecordId,
        fileName: orderAttachments.fileName,
        originalFilename: orderAttachments.originalFilename,
        mimeType: orderAttachments.mimeType,
        fileUrl: orderAttachments.fileUrl,
        relativePath: orderAttachments.relativePath,
        sizeBytes: orderAttachments.sizeBytes,
        fileSize: orderAttachments.fileSize,
        role: orderAttachments.role,
        side: orderAttachments.side,
        productionQuantity: orderAttachments.productionQuantity,
        productionGroupId: orderAttachments.productionGroupId,
      })
      .from(orderAttachments)
      .innerJoin(orders, eq(orderAttachments.orderId, orders.id))
      .where(and(
        eq(orderAttachments.id, params.source.attachmentId),
        eq(orderAttachments.orderId, params.orderId),
        eq(orderAttachments.orderLineItemId, params.lineItemId),
        eq(orderAttachments.role, "artwork"),
        eq(orders.organizationId, params.organizationId),
      ))
      .limit(1);
    if (!attachment) {
      throw Object.assign(new Error("Customer artwork attachment not found."), { statusCode: 404, code: "SOURCE_ARTWORK_NOT_FOUND" });
    }
    if (!attachment.fileRecordId) {
      throw Object.assign(new Error("Customer artwork is missing a canonical file identity and cannot be assigned without copying."), { statusCode: 409, code: "SOURCE_STORAGE_PLACEMENT_MISSING" });
    }
    const resolvedOriginal = await resolveOriginalFileAccess({
      id: attachment.id,
      fileRecordId: attachment.fileRecordId,
      fileName: attachment.fileName,
      originalFilename: attachment.originalFilename,
      mimeType: attachment.mimeType,
      fileUrl: attachment.fileUrl,
      fileKey: attachment.relativePath,
    });
    const resolvedStoragePath = resolvedOriginal.objectPath || attachment.relativePath || attachment.fileUrl || null;
    if (resolvedOriginal.availabilityStatus !== "available" || !resolvedStoragePath) {
      throw Object.assign(new Error("Customer artwork source is not available for assignment."), { statusCode: 409, code: "SOURCE_STORAGE_PLACEMENT_MISSING" });
    }
    source = {
      fileRecordId: attachment.fileRecordId,
      sourceFileId: null,
      sourceOrderAttachmentId: attachment.id,
      sourceType: "order_attachment",
      sourceArtworkSide: params.artworkSide,
      storageBucket: null,
      storagePath: resolvedStoragePath,
      storageKey: resolvedStoragePath,
      originalFilename: attachment.originalFilename || attachment.fileName || `artwork-${attachment.id}`,
      mimeType: attachment.mimeType || resolvedOriginal.mimeType || "application/octet-stream",
      sizeBytes: Math.max(0, Number(attachment.sizeBytes ?? attachment.fileSize ?? 0)),
      productionQuantity: attachment.productionQuantity ?? null,
      productionGroupId: attachment.productionGroupId ?? null,
    };
  }

  const sourceConditions = params.source.kind === "line_item_original"
    ? [eq(lineItemFiles.sourceFileId, params.source.fileId)]
    : [eq(lineItemFiles.sourceOrderAttachmentId, params.source.attachmentId)];
  const [existing] = await db
    .select()
    .from(lineItemFiles)
    .where(and(
      eq(lineItemFiles.organizationId, params.organizationId),
      eq(lineItemFiles.orderId, params.orderId),
      eq(lineItemFiles.lineItemId, params.lineItemId),
      eq(lineItemFiles.role, "final"),
      eq(lineItemFiles.status, "active"),
      eq(lineItemFiles.tag, tag),
      eq(lineItemFiles.sourceArtworkSide, params.artworkSide),
      ...sourceConditions,
    ))
    .limit(1);
  if (existing) return { file: existing, created: false };

  const [inserted] = await db.transaction(async (tx) => {
    const [created] = await tx.insert(lineItemFiles).values(buildPromotedFinalFileLink({
      organizationId: params.organizationId,
      orderId: params.orderId,
      lineItemId: params.lineItemId,
      prepressSessionId: params.prepressSessionId ?? null,
      createdByUserId: params.createdByUserId,
      tag,
      source: {
        ...source,
        productionArtworkSourceType: "customer_artwork_assignment",
      },
    })).returning();
    await tx.insert(auditLogs).values({
      organizationId: params.organizationId,
      userId: params.createdByUserId,
      actionType: "assigned_customer_artwork_to_production_artwork",
      entityType: "order_line_item",
      entityId: params.lineItemId,
      description: "Assigned customer artwork as production artwork without copying storage.",
      newValues: {
        originalCustomerFileId: source.sourceFileId,
        originalCustomerAttachmentId: source.sourceOrderAttachmentId,
        productionFileId: created.id,
        sharedFileRecordId: source.fileRecordId,
        lineItemId: params.lineItemId,
        tag,
        artworkSide: params.artworkSide,
        sourceType: source.sourceType,
      },
    });
    return [created];
  });

  await queueLineItemFilePreviewRepair({
    fileId: inserted.id,
    organizationId: params.organizationId,
    actorUserId: params.createdByUserId,
  }).completion;
  await enqueueFinalProductionFileCopy({ organizationId: params.organizationId, file: inserted }).catch(() => ({ enqueued: false, copyJobId: null }));
  return { file: inserted, created: true };
}

const previewRepairsInFlight = new Map<string, PreviewRepairEntry>();
const DEFAULT_PREVIEW_REPAIR_TIMEOUT_MS = 120_000;

function previewRepairKey(params: Pick<Parameters<typeof ensureLineItemFilePreview>[0], "organizationId" | "fileId">): string {
  return `${params.organizationId}:${params.fileId}`;
}

export function getLineItemFilePreviewRepairState(params: Pick<Parameters<typeof ensureLineItemFilePreview>[0], "organizationId" | "fileId">): {
  inFlight: boolean;
  startedAt: Date | null;
} {
  const entry = previewRepairsInFlight.get(previewRepairKey(params));
  return {
    inFlight: !!entry,
    startedAt: entry?.startedAt ?? null,
  };
}

export function shouldQueueLineItemFilePreviewRepair(args: {
  canRepair: boolean;
  derivativeStatus: "available" | "pending" | "missing" | "failed";
  repairInFlight: boolean;
}): boolean {
  if (!args.canRepair || args.repairInFlight) return false;
  return args.derivativeStatus === "missing" || args.derivativeStatus === "pending";
}

async function persistLineItemFilePreviewRepairFailure(
  params: Parameters<typeof ensureLineItemFilePreview>[0],
  error: unknown,
): Promise<void> {
  const [file] = await db
    .select({ fileRecordId: lineItemFiles.fileRecordId })
    .from(lineItemFiles)
    .where(and(
      eq(lineItemFiles.id, params.fileId),
      eq(lineItemFiles.organizationId, params.organizationId),
      eq(lineItemFiles.status, "active"),
    ))
    .limit(1);

  if (!file?.fileRecordId) return;
  const placement = await storagePlacementRepository.getActiveCanonicalPlacementByFileRecordId(file.fileRecordId);
  const errorText = error instanceof Error ? error.message : String(error);
  await Promise.all(["thumbnail", "preview"].map((derivativeType) =>
    fileDerivativeRepository.setState({
      fileRecordId: file.fileRecordId!,
      derivativeType: derivativeType as "thumbnail" | "preview",
      state: "failed",
      sourcePlacementId: placement?.id,
      errorText,
    })
  ));
}

function runWithPreviewRepairTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Final production preview generation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    if (typeof timeout.unref === "function") timeout.unref();

    operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

/**
 * Start one background repair per tenant/file. Callers can return a processing
 * response immediately while the canonical derivative pipeline runs.
 */
export function queueLineItemFilePreviewRepair(
  params: Parameters<typeof ensureLineItemFilePreview>[0],
  runner: typeof ensureLineItemFilePreview = ensureLineItemFilePreview,
  options: {
    timeoutMs?: number;
    persistFailure?: typeof persistLineItemFilePreviewRepairFailure;
  } = {},
): { status: "processing"; completion: Promise<PreviewRepairResult> } {
  const key = previewRepairKey(params);
  const existing = previewRepairsInFlight.get(key);
  if (existing) return { status: "processing", completion: existing.completion };

  const startedAt = new Date();
  const timeoutMs = options.timeoutMs ?? DEFAULT_PREVIEW_REPAIR_TIMEOUT_MS;
  const persistFailure = options.persistFailure ?? persistLineItemFilePreviewRepairFailure;
  const completion = runWithPreviewRepairTimeout(runner(params), timeoutMs)
    .then((result) => {
      if (result.previewStatus === "failed") {
        console.error("[Prepress] Final production preview repair failed", {
          organizationId: params.organizationId,
          fileId: params.fileId,
        });
      }
      return result;
    })
    .catch(async (error) => {
      console.error("[Prepress] Final production preview repair failed", {
        organizationId: params.organizationId,
        fileId: params.fileId,
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        await persistFailure(params, error);
      } catch (persistError) {
        console.error("[Prepress] Failed to persist final production preview repair failure", {
          organizationId: params.organizationId,
          fileId: params.fileId,
          error: persistError instanceof Error ? persistError.message : String(persistError),
        });
      }
      return { fileRecordId: "", previewStatus: "failed" as const };
    })
    .finally(() => {
      previewRepairsInFlight.delete(key);
    });

  previewRepairsInFlight.set(key, { completion, startedAt });
  return { status: "processing", completion };
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
    productionRunId: existingFile.productionRunId,
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
  const requestId = createDownloadRequestId();

  try {
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
      sendDownloadFailure(res, 404, "FILE_NOT_FOUND", "File not found", requestId);
      return;
    }

    const jobNumber = file.order.orderNumber || "NOJOB";
    const namingPolicy = await getFileUploadNamingPolicy(organizationId);
    const downloadFilename = buildComputedDisplayFilename({
      role: file.file.role,
      originalFilename: file.file.originalFilename,
      tag: file.file.tag,
      fullJobNumber: jobNumber,
      numericJobNumber: numericJobNumberFromFull(jobNumber),
      namingPolicy,
    });
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

    const headers = {
      contentType: resolveDownloadContentType(file.file.mimeType, downloadFilename),
      dispositionType: dispositionType as "attachment" | "inline",
      filename: downloadFilename,
      etag,
      lastModified,
    };

    // Legacy GCS records keep an explicit bucket; newer records resolve through
    // the configured private Supabase storage service.
    if (file.file.storageBucket) {
      try {
        const bucket = getStorageClient().bucket(file.file.storageBucket || BUCKET_NAME);
        const gcsFile = bucket.file(file.file.storagePath);
        const [exists] = await gcsFile.exists();
        if (!exists) {
          sendDownloadFailure(res, 404, "FILE_MISSING_FROM_STORAGE", "File not found in storage", requestId);
          return;
        }
        await streamDownload(
          gcsFile.createReadStream(),
          res,
          { requestId, fileId, organizationId, stage: "gcs-stream" },
          () => setDownloadHeaders(res, headers),
        );
        return;
      } catch (error) {
        logDownloadFailure(requestId, fileId, organizationId, "gcs-lookup", error);
        sendDownloadFailure(res, 503, "FILE_STORAGE_UNAVAILABLE", "The file is temporarily unavailable. Please try again.", requestId);
        return;
      }
    }

    const storageKey = (file.file.storageKey || file.file.storagePath || "").trim();
    if (!storageKey) {
      sendDownloadFailure(res, 404, "FILE_STORAGE_KEY_MISSING", "File storage key missing", requestId);
      return;
    }

    if (isSupabaseConfigured()) {
      try {
        const supabase = new SupabaseStorageService();
        const signedUrl = await supabase.getSignedDownloadUrl(storageKey, 60);
        const upstream = await fetch(signedUrl);
        if (!upstream.ok || !upstream.body) {
          const status = upstream.status === 404 || upstream.status === 410 ? 404 : 503;
          sendDownloadFailure(
            res,
            status,
            status === 404 ? "FILE_MISSING_FROM_STORAGE" : "FILE_STORAGE_UNAVAILABLE",
            status === 404 ? "File not found in storage" : "The file is temporarily unavailable. Please try again.",
            requestId,
          );
          return;
        }
        await streamDownload(
          Readable.fromWeb(upstream.body as any),
          res,
          { requestId, fileId, organizationId, stage: "supabase-stream" },
          () => setDownloadHeaders(res, headers),
        );
        return;
      } catch (error) {
        logDownloadFailure(requestId, fileId, organizationId, "supabase-lookup", error);
        sendDownloadFailure(res, 503, "FILE_STORAGE_UNAVAILABLE", "The file is temporarily unavailable. Please try again.", requestId);
        return;
      }
    }

    try {
      const { getAbsolutePath } = await import("./utils/fileStorage");
      const fs = await import("fs");
      const fsPromises = await import("fs/promises");
      const abs = getAbsolutePath(storageKey);
      await fsPromises.access(abs, fs.constants.R_OK);
      await streamDownload(
        fs.createReadStream(abs),
        res,
        { requestId, fileId, organizationId, stage: "local-stream" },
        () => setDownloadHeaders(res, headers),
      );
    } catch (error: any) {
      const status = error?.code === "ENOENT" ? 404 : 503;
      logDownloadFailure(requestId, fileId, organizationId, "local-lookup", error);
      sendDownloadFailure(
        res,
        status,
        status === 404 ? "FILE_MISSING_FROM_STORAGE" : "FILE_STORAGE_UNAVAILABLE",
        status === 404 ? "File not found in storage" : "The file is temporarily unavailable. Please try again.",
        requestId,
      );
    }
  } catch (error) {
    logDownloadFailure(requestId, fileId, organizationId, "file-lookup", error);
    sendDownloadFailure(res, 503, "FILE_DOWNLOAD_UNAVAILABLE", "The file is temporarily unavailable. Please try again.", requestId);
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
  const namingPolicy = await getFileUploadNamingPolicy(organizationId);
  const zipFilename = buildFileUploadDisplayFilename({
    originalFilename: "originals.zip",
    fullJobNumber: jobNumber,
    numericJobNumber: numericJobNumberFromFull(jobNumber),
    fileUploadJobPrefixMode: namingPolicy.fileUploadJobPrefixMode,
    prepressLabel: "none",
  });

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

  // Add each file to the archive with the org's configured human-readable name.
  for (const fileRecord of files) {
    const entryName = buildComputedDisplayFilename({
      role: fileRecord.file.role,
      originalFilename: fileRecord.file.originalFilename,
      tag: fileRecord.file.tag,
      fullJobNumber: jobNumber,
      numericJobNumber: numericJobNumberFromFull(jobNumber),
      namingPolicy,
    });

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
  originals: PrepressLineItemFile[];
  finals: PrepressLineItemFile[];
  references: PrepressLineItemFile[];
  bridgedOriginals: BridgedOriginal[];
  proofs: BridgedOriginal[];
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
  const namingPolicy = await getFileUploadNamingPolicy(organizationId);

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
      description: orderAttachments.description,
      side: orderAttachments.side,
      productionQuantity: orderAttachments.productionQuantity,
      productionGroupId: orderAttachments.productionGroupId,
      fileRecordId: orderAttachments.fileRecordId,
      fileUrl: orderAttachments.fileUrl,
      thumbKey: orderAttachments.thumbKey,
      createdAt: orderAttachments.createdAt,
      uploadedByName: orderAttachments.uploadedByName,
      orderNumber: orders.orderNumber,
    })
    .from(orderAttachments)
    .innerJoin(orders, eq(orderAttachments.orderId, orders.id))
    .where(and(eq(orderAttachments.orderLineItemId, lineItemId), eq(orders.organizationId, organizationId)))
    .orderBy(orderAttachments.createdAt);

  const logOnce = createRequestLogOnce();
  const originalIdentities = allFiles
    .filter((file) => file.role === "original")
    .map((file) => getCanonicalOriginalFileIdentity(file));
  // A single artwork record may deliberately be linked to both Front and Back.
  // Preserve that explicit mapping in prepress while still deduplicating accidental
  // duplicate rows for the same file and same side.
  const knownOriginalIdentities = new Set(originalIdentities.filter((identity): identity is string => Boolean(identity)));
  const classifiedLegacyRows = legacyRows.map((row) => ({
    row,
    classification: classifyPrepressFileForDisplay({
      source: "order_attachment",
      role: row.role,
      description: row.description,
      originalFilename: row.originalFilename,
      fileName: row.fileName,
    }),
  }));
  const proofRows = classifiedLegacyRows
    .filter(({ classification }) => classification.category === "proof")
    .map(({ row }) => row);
  const nonProofRows = classifiedLegacyRows
    .filter(({ classification }) => classification.category !== "proof")
    .map(({ row }) => row);
  const filesWithArtworkSides = mergeArtworkSidesIntoPrepressFiles(allFiles, nonProofRows);
  const seenLegacyArtworkSides = new Set<string>();
  const dedupedLegacyRows = nonProofRows.filter((row) => {
    const identity = getCanonicalOriginalFileIdentity(row);
    if (identity && knownOriginalIdentities.has(identity)) return false;
    const side = row.side === "front" || row.side === "back" || row.side === "both" ? row.side : "na";
    const dedupeKey = `${identity ?? `attachment:${row.id}`}:${side}`;
    if (seenLegacyArtworkSides.has(dedupeKey)) return false;
    seenLegacyArtworkSides.add(dedupeKey);
    return true;
  });

  const buildBridgedFile = async (row: typeof legacyRows[number]): Promise<BridgedOriginal> => {
    const classification = classifyPrepressFileForDisplay({
      source: "order_attachment",
      role: row.role,
      description: row.description,
      originalFilename: row.originalFilename,
      fileName: row.fileName,
    });
    const displayRow = withOrderOriginalArtworkDisplayFilename(row, {
      orderNumber: row.orderNumber,
      namingPolicy,
    });
    const [originalAccess, thumbAccess] = await Promise.all([
      resolveOriginalFileAccess(displayRow, { logOnce }),
      resolveDerivativeFileAccess(row, "thumbnail", { logOnce }),
    ]);

    return {
      id: row.id,
      originalFilename: row.originalFilename || row.fileName,
      mimeType: row.mimeType ?? null,
      sizeBytes: row.sizeBytes ?? row.fileSize ?? null,
      role: row.role ?? "other",
      side: row.side === "front" || row.side === "back" || row.side === "both" ? row.side : "na",
      createdAt: row.createdAt,
      source: "order_attachment" as const,
      prepressCategory: classification.category,
      systemGenerated: classification.systemGenerated,
      tagLabel: classification.tagLabel,
      downloadUrl: originalAccess.downloadUrl ?? originalAccess.originalUrl ?? "",
      thumbnailUrl: thumbAccess.url,
      uploadedBy: classification.systemGenerated ? "System generated" : row.uploadedByName ?? null,
      displayFilename: displayRow.displayFilename,
      computedDisplayFilename: displayRow.computedDisplayFilename,
    };
  };
  const [bridgedOriginals, proofs] = await Promise.all([
    Promise.all(dedupedLegacyRows.map(buildBridgedFile)),
    Promise.all(proofRows.map(buildBridgedFile)),
  ]);

  return {
    originals: filesWithArtworkSides.filter((f) => f.role === "original"),
    finals: filesWithArtworkSides.filter((f) => f.role === "final"),
    references: filesWithArtworkSides.filter((f) => f.role === "reference"),
    bridgedOriginals,
    proofs,
  };
}

export class ProductionFileAccessError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = "ProductionFileAccessError";
  }
}

/**
 * Stream a final file only when it belongs to the requested production job and tenant.
 * This is the Production-screen transport boundary; Prepress keeps its existing file route.
 */
export async function downloadProductionFileForJob(params: {
  jobId: string;
  fileId: string;
  organizationId: string;
  inline?: boolean;
  res: Response;
}): Promise<void> {
  const [ownedFile] = await db
    .select({ fileId: lineItemFiles.id })
    .from(productionJobs)
    .innerJoin(
      lineItemFiles,
      and(
        eq(lineItemFiles.lineItemId, productionJobs.lineItemId),
        eq(lineItemFiles.orderId, productionJobs.orderId),
      ),
    )
    .where(and(
      eq(productionJobs.id, params.jobId),
      eq(productionJobs.organizationId, params.organizationId),
      eq(lineItemFiles.id, params.fileId),
      eq(lineItemFiles.organizationId, params.organizationId),
      eq(lineItemFiles.role, "final"),
      eq(lineItemFiles.status, "active"),
    ))
    .limit(1);

  if (!ownedFile) {
    throw new ProductionFileAccessError(404, "Production file not found");
  }

  await downloadLineItemFile(params.fileId, params.organizationId, params.res, { inline: params.inline });
}

export async function ensureFinalArtworkForLineItem(params: {
  organizationId: string;
  orderId: string;
  lineItemId: string;
  prepressSessionId?: string | null;
  createdByUserId: string;
  forcePromoteArtwork?: boolean;
}): Promise<EnsuredFinalArtworkResult | null> {
  const { organizationId, orderId, lineItemId, prepressSessionId, createdByUserId, forcePromoteArtwork = false } = params;
  const namingPolicy = await getFileUploadNamingPolicy(organizationId);
  // Finalized production artwork always carries the established print ending.
  // This keeps the production/download name informative even when the general
  // prepress upload label preference is optional.
  const defaultFinalTag = "final_print";

  const existingFinals = await db
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
    .orderBy(desc(lineItemFiles.createdAt));

  if (existingFinals[0] && !forcePromoteArtwork) {
    const finalizedExistingFiles = await Promise.all(existingFinals.map(async (file) => {
      if (file.tag) return file;
      const [updated] = await db
        .update(lineItemFiles)
        .set({ tag: defaultFinalTag })
        .where(and(eq(lineItemFiles.id, file.id), eq(lineItemFiles.organizationId, organizationId)))
        .returning();
      return updated;
    }));
    return {
      file: finalizedExistingFiles[0],
      files: finalizedExistingFiles,
      source: "existing_final",
      created: false,
    };
  }

  const [lineItem] = await db
    .select({
      id: orderLineItems.id,
      optionSelectionsJson: orderLineItems.optionSelectionsJson,
      pbv2SnapshotJson: orderLineItems.pbv2SnapshotJson,
      selectedOptions: orderLineItems.selectedOptions,
      specsJson: orderLineItems.specsJson,
    })
    .from(orderLineItems)
    .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
    .where(and(
      eq(orderLineItems.id, lineItemId),
      eq(orders.id, orderId),
      eq(orders.organizationId, organizationId),
    ))
    .limit(1);
  if (!lineItem) return null;

  const existingOriginals = await db
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
    .orderBy(desc(lineItemFiles.createdAt));

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
      side: orderAttachments.side,
      productionQuantity: orderAttachments.productionQuantity,
      productionGroupId: orderAttachments.productionGroupId,
      isPrimary: orderAttachments.isPrimary,
      createdAt: orderAttachments.createdAt,
    })
    .from(orderAttachments)
    .where(eq(orderAttachments.orderLineItemId, lineItemId))
    .orderBy(desc(orderAttachments.isPrimary), desc(orderAttachments.createdAt));

  // The print-ready fast path is deliberately limited to customer artwork.
  // Proof/reference documents remain visible in Prepress but must never become
  // a production file merely because no final file exists.
  const artworkAttachments = attachmentCandidates.filter((candidate) => candidate.role === "artwork");
  type InternalCandidate = PrintReadyArtworkCandidate & {
    source: "line_item_original" | "order_attachment";
    original?: typeof existingOriginals[number];
    attachment?: typeof artworkAttachments[number];
  };
  const candidates: InternalCandidate[] = [];
  const matchedAttachmentIds = new Set<string>();

  for (const original of existingOriginals) {
    const matches = original.fileRecordId
      ? artworkAttachments.filter((attachment) => attachment.fileRecordId === original.fileRecordId)
      : [];
    matches.forEach((attachment) => matchedAttachmentIds.add(attachment.id));
    const sides = new Set(matches.map((attachment) => String(attachment.side ?? "na").toLowerCase()));
    const side = sides.has("both") || (sides.has("front") && sides.has("back"))
      ? "both"
      : sides.has("front")
        ? "front"
        : sides.has("back")
          ? "back"
          : "na";
    candidates.push({
      id: original.id,
      fileRecordId: original.fileRecordId,
      aliasIds: matches.map((attachment) => attachment.id),
      side,
      source: "line_item_original",
      original: {
        ...original,
        productionQuantity: matches[0]?.productionQuantity ?? null,
        productionGroupId: matches[0]?.productionGroupId ?? null,
      },
    });
  }

  for (const attachment of artworkAttachments) {
    if (matchedAttachmentIds.has(attachment.id)) continue;
    candidates.push({
      id: attachment.id,
      fileRecordId: attachment.fileRecordId,
      side: attachment.side,
      source: "order_attachment",
      attachment,
    });
  }

  const selectedCandidates = resolvePrintReadyArtworkCandidates({ lineItem, candidates });
  if (selectedCandidates.length === 0) return null;

  const selectedFileRecordIds = new Set(selectedCandidates
    .map((candidate) => candidate.fileRecordId)
    .filter((id): id is string => typeof id === "string" && id.length > 0));
  const selectedSourceFileIds = new Set(selectedCandidates
    .filter((candidate) => candidate.source === "line_item_original")
    .map((candidate) => candidate.id));
  const selectedSourceAttachmentIds = new Set(selectedCandidates
    .filter((candidate) => candidate.source === "order_attachment")
    .map((candidate) => candidate.id));
  const matchingExistingFinals = existingFinals.filter((file) =>
    (file.sourceFileId && selectedSourceFileIds.has(file.sourceFileId))
    || (file.sourceOrderAttachmentId && selectedSourceAttachmentIds.has(file.sourceOrderAttachmentId))
    || (file.fileRecordId && selectedFileRecordIds.has(file.fileRecordId)),
  );
  const matchedSourceFileIds = new Set(matchingExistingFinals.map((file) => file.sourceFileId).filter((id): id is string => !!id));
  const matchedSourceAttachmentIds = new Set(matchingExistingFinals.map((file) => file.sourceOrderAttachmentId).filter((id): id is string => !!id));
  const matchedRecordIds = new Set(matchingExistingFinals.map((file) => file.fileRecordId).filter((id): id is string => !!id));
  const candidatesToCreate = selectedCandidates.filter((candidate) =>
    candidate.source === "line_item_original"
      ? !matchedSourceFileIds.has(candidate.id) && (!candidate.fileRecordId || !matchedRecordIds.has(candidate.fileRecordId))
      : !matchedSourceAttachmentIds.has(candidate.id) && (!candidate.fileRecordId || !matchedRecordIds.has(candidate.fileRecordId)),
  );

  const preparedSources: Array<{ candidate: InternalCandidate; source: PromotableArtworkFile; promotionSource: PromoteCustomerArtworkSource }> = [];
  for (const candidate of candidatesToCreate) {
    let source: PromotableArtworkFile;
    let promotionSource: PromoteCustomerArtworkSource;
    if (candidate.source === "line_item_original" && candidate.original) {
      promotionSource = { kind: "line_item_original", fileId: candidate.original.id };
      source = {
        ...candidate.original,
        sourceFileId: candidate.original.id,
        sourceOrderAttachmentId: null,
        sourceType: "line_item_original",
        sourceArtworkSide: candidate.side === "front" || candidate.side === "back" || candidate.side === "both" ? candidate.side : "na",
      };
    } else if (candidate.attachment) {
      const attachment = candidate.attachment;
      promotionSource = { kind: "order_attachment", attachmentId: attachment.id };
      const resolvedOriginal = await resolveOriginalFileAccess({
        id: attachment.id,
        fileRecordId: attachment.fileRecordId,
        fileName: attachment.fileName,
        originalFilename: attachment.originalFilename,
        mimeType: attachment.mimeType,
        fileUrl: attachment.fileUrl,
        fileKey: attachment.relativePath,
      });
      const resolvedStoragePath = resolvedOriginal.objectPath || attachment.relativePath || attachment.fileUrl || null;
      if (resolvedOriginal.availabilityStatus !== "available" || !resolvedStoragePath) return null;
      source = {
        fileRecordId: attachment.fileRecordId || null,
        sourceFileId: null,
        sourceOrderAttachmentId: attachment.id,
        sourceType: "order_attachment",
        sourceArtworkSide: candidate.side === "front" || candidate.side === "back" || candidate.side === "both" ? candidate.side : "na",
        storageBucket: null,
        storagePath: resolvedStoragePath,
        storageKey: resolvedStoragePath,
        originalFilename: attachment.originalFilename || attachment.fileName || `artwork-${attachment.id}`,
        mimeType: attachment.mimeType || resolvedOriginal.mimeType || "application/octet-stream",
        sizeBytes: Math.max(0, Number(attachment.sizeBytes ?? attachment.fileSize ?? 0)),
        productionQuantity: attachment.productionQuantity ?? null,
        productionGroupId: attachment.productionGroupId ?? null,
      };
    } else {
      continue;
    }

    preparedSources.push({ candidate, source, promotionSource });
  }

  const createdFiles: LineItemFile[] = [];
  for (const { candidate, promotionSource } of preparedSources) {
    const promoted = await promoteCustomerArtworkToProductionArtwork({
      organizationId,
      orderId,
      lineItemId,
      prepressSessionId: prepressSessionId || candidate.original?.prepressSessionId || null,
      createdByUserId,
      tag: defaultFinalTag,
      artworkSide: candidate.side === "front" || candidate.side === "back" || candidate.side === "both" ? candidate.side : "na",
      source: promotionSource,
    });
    createdFiles.push(promoted.file);
  }

  if (forcePromoteArtwork) {
    const staleFinalIds = existingFinals
      .filter((file) => !file.fileRecordId || !selectedFileRecordIds.has(file.fileRecordId))
      .map((file) => file.id);
    for (const staleFinalId of staleFinalIds) {
      await db.update(lineItemFiles)
        .set({ status: "superseded" })
        .where(and(eq(lineItemFiles.id, staleFinalId), eq(lineItemFiles.organizationId, organizationId)));
    }
  }

  const finalFiles = [...matchingExistingFinals, ...createdFiles];
  if (finalFiles.length === 0) return null;
  return {
    file: finalFiles[0],
    files: finalFiles,
    source: createdFiles.length === 0 ? "existing_final" : selectedCandidates[0].source,
    created: createdFiles.length > 0,
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
