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
import { lineItemFiles, orders, orderLineItems, orderAttachments, organizations, productionJobs, localFileDestinations, localFileCopyJobs } from "../shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { getStorageClient } from "./objectStorage";
import type { Response } from "express";
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
  storageBucket?: string | null;
  storagePath: string;
  storageKey?: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
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

  const jobNumber = file.order.orderNumber || "NOJOB";
  const namingPolicy = await getFileUploadNamingPolicy(organizationId);
  const computedDisplayFilename = buildComputedDisplayFilename({
    role: file.file.role,
    originalFilename: file.file.originalFilename,
    tag: file.file.tag,
    fullJobNumber: jobNumber,
    numericJobNumber: numericJobNumberFromFull(jobNumber),
    namingPolicy,
  });
  const downloadFilename = computedDisplayFilename;
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
      original,
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
  const matchingExistingFinals = existingFinals.filter((file) =>
    file.fileRecordId && selectedFileRecordIds.has(file.fileRecordId),
  );
  const matchedRecordIds = new Set(matchingExistingFinals
    .map((file) => file.fileRecordId)
    .filter((id): id is string => typeof id === "string" && id.length > 0));
  const candidatesToCreate = selectedCandidates.filter((candidate) =>
    !candidate.fileRecordId || !matchedRecordIds.has(candidate.fileRecordId),
  );

  const preparedSources: Array<{ candidate: InternalCandidate; source: PromotableArtworkFile }> = [];
  for (const candidate of candidatesToCreate) {
    let source: PromotableArtworkFile;
    if (candidate.source === "line_item_original" && candidate.original) {
      source = candidate.original;
    } else if (candidate.attachment) {
      const attachment = candidate.attachment;
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
        storageBucket: null,
        storagePath: resolvedStoragePath,
        storageKey: resolvedStoragePath,
        originalFilename: attachment.originalFilename || attachment.fileName || `artwork-${attachment.id}`,
        mimeType: attachment.mimeType || resolvedOriginal.mimeType || "application/octet-stream",
        sizeBytes: Math.max(0, Number(attachment.sizeBytes ?? attachment.fileSize ?? 0)),
      };
    } else {
      continue;
    }

    preparedSources.push({ candidate, source });
  }

  const createdFiles: LineItemFile[] = [];
  for (const { candidate, source } of preparedSources) {
    const [created] = await db.insert(lineItemFiles).values(buildPromotedFinalFileLink({
      organizationId,
      orderId,
      lineItemId,
      prepressSessionId: prepressSessionId || candidate.original?.prepressSessionId || null,
      tag: defaultFinalTag,
      createdByUserId,
      source,
    })).returning();
    createdFiles.push(created);
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
