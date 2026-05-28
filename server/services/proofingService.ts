import { and, desc, eq, inArray, isNotNull, isNull, ne, notInArray, or, sql } from "drizzle-orm";

import type {
  ManualApprovalOverrideHistoryEntry,
  ProofApprovalSource,
  ProofArtifactSummary,
  ProofArtifactPreviewStatus,
  ProofDecisionHistoryEntry,
  ProofInputSnapshot,
  ProofQueueSlice,
  ProofQueueStatus,
  ProofVersionHistoryEntry,
  ProofingQueueCounts,
  ProofingQueueResponse,
  ProofingQueueRow,
  ProofingReadModel,
} from "@shared/proofing";

import {
  assetLinks,
  assets,
  customers,
  lineItemProofApprovals,
  lineItemProofManualApprovalOverrides,
  lineItemProofVersions,
  lineItemFiles,
  orderAttachments,
  orderAuditLog,
  orderLineItems,
  orders,
  productionJobs,
  proofAccessTokens,
  quoteAttachmentPages,
} from "@shared/schema";
import { generateBasicProofPdfBytes } from "../lib/proofPdf";
import { assetRepository } from "./assets/AssetRepository";
import { assetPreviewGenerator } from "./assets/AssetPreviewGenerator";
import { processPdfAttachmentDerivedData } from "./pdfProcessing";
import { resolveProofPreviewSource, type ProofPreviewCandidate } from "./proofPreviewResolver";
import { ensureSharp, generateImageDerivatives, isSupportedImageType } from "./thumbnailGenerator";
import { storageApplicationService } from "./storage/StorageApplicationService";
import { transitionLineItemWorkflowState } from "./lineItemWorkflowService";
import { resolveActiveProductionOwners } from "./productionOwnership";
import { resolveLineItemProofReleaseGate } from "./proofGateService";
import { isCanceledOrder } from "@shared/operationalState";

type ProofDecision = "approved" | "rejected" | "revision_requested";
type ProofVersionStatus = "draft" | "awaiting_response" | "approved" | "rejected" | "revision_requested" | "cancelled" | "superseded";
type ProofSyncReason = "order_saved" | "line_item_saved" | "artwork_saved" | "artwork_deleted" | "design_completed";
type ProofSendMode = "generated" | "uploaded";

const GENERATED_PROOF_DESCRIPTION_MARKER = "[proof-artifact:generated-basic]";
const GENERATED_PROOF_PREVIEW_READY_MARKER = "[proof-preview:ready]";
const GENERATED_PROOF_MISSING_PREVIEW_MARKER = "[proof-preview:missing-preview]";
const GENERATED_PROOF_GENERATION_FAILED_MARKER = "[proof-preview:generation-failed]";
const GENERATED_PROOF_METADATA_ONLY_MARKER = "[proof-preview:metadata-only]";
const GENERATED_PROOF_PREVIEW_ERROR_PREFIX = "[proof-preview-error:";
export const INCOMPLETE_PROOF_MESSAGE = "This proof does not include an artwork preview and cannot be sent to the customer.";

type ArtworkProofSource = {
  sourceType: "attachment" | "asset" | "line_item_file";
  sourceId: string;
  orderId: string;
  orderLineItemId: string;
  fileRecordId: string | null;
  fileName: string;
  fileUrl: string | null;
  fileSize: number | null;
  sizeBytes: number | null;
  mimeType: string | null;
  description: string | null;
  originalFilename: string | null;
  storedFilename: string | null;
  relativePath: string | null;
  storageProvider: string | null;
  extension: string | null;
  checksum: string | null;
  thumbKey: string | null;
  previewKey: string | null;
  thumbStatus?: string | null;
  thumbError?: string | null;
  thumbnailRelativePath: string | null;
  thumbnailGeneratedAt: Date | null;
  thumbnailUrl: string | null;
  pagePreviewFileRecordId?: string | null;
  pageThumbFileRecordId?: string | null;
  uploadedByUserId: string | null;
  uploadedByName: string | null;
  updatedAt: Date | null;
  assetPreviewStatus?: "pending" | "ready" | "failed" | null;
  assetPreviewError?: string | null;
};

export type EligibleProofArtworkSource = {
  id: string;
  sourceType: "line_item_artwork" | "line_item_asset" | "line_item_file";
  sourceId: string;
  attachmentId: string | null;
  fileRecordId: string | null;
  fileName: string;
  originalFilename: string | null;
  mimeType: string | null;
  fileUrl: string | null;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  role: string | null;
  eligible: boolean;
  eligibilityReason: string | null;
};

type LoadedProofSnapshotLineItem = {
  lineItemId: string;
  orderId: string;
  orderNumber: string | null;
  lineItemLabel: string;
  width: string | null;
  height: string | null;
  quantity: number;
  specsJson: Record<string, any> | null;
  selectedOptions: Array<{
    optionId: string;
    optionName: string;
    value: string | number | boolean;
    note?: string;
    setupCost: number;
    calculatedCost: number;
  }>;
  materialUsages: Array<{
    materialId?: string;
    materialName?: string;
    quantityUsed?: number;
    unitOfMeasure?: string;
  }>;
  updatedAt: Date;
};

type ProofArtifactAttachmentRow = {
  id: string;
  fileName: string;
  mimeType: string | null;
  description: string | null;
  fileRecordId: string | null;
  fileUrl?: string | null;
  thumbKey: string | null;
  previewKey: string | null;
  thumbnailUrl: string | null;
  pagePreviewCount: number;
  pageThumbCount: number;
};

type ResolvedProofPreview = {
  kind: "image" | "pdf" | "unavailable";
  preview: { bytes: Buffer; mimeType: string | null; fileName: string } | null;
  previewStatus: ProofArtifactPreviewStatus;
  previewError: string | null;
  reason: string | null;
};

function proofArtifactIsCustomerSendable(artifact: ProofArtifactSummary | null | undefined) {
  return artifact?.previewStatus === "ready";
}

function parseGeneratedPreviewStatusFromDescription(description: string | null | undefined): ProofArtifactPreviewStatus | null {
  const normalized = String(description || "");
  if (normalized.includes(GENERATED_PROOF_PREVIEW_READY_MARKER)) return "ready";
  if (normalized.includes(GENERATED_PROOF_MISSING_PREVIEW_MARKER)) return "missing_preview";
  if (normalized.includes(GENERATED_PROOF_GENERATION_FAILED_MARKER)) return "generation_failed";
  if (normalized.includes(GENERATED_PROOF_METADATA_ONLY_MARKER)) return "metadata_only";
  return null;
}

function parseGeneratedPreviewErrorFromDescription(description: string | null | undefined): string | null {
  const normalized = String(description || "");
  const startIndex = normalized.indexOf(GENERATED_PROOF_PREVIEW_ERROR_PREFIX);
  if (startIndex < 0) return null;

  const remainder = normalized.slice(startIndex + GENERATED_PROOF_PREVIEW_ERROR_PREFIX.length);
  const endIndex = remainder.indexOf("]");
  if (endIndex < 0) return null;

  const parsed = remainder.slice(0, endIndex).trim();
  return parsed.length > 0 ? parsed : null;
}

function derivePreviewStatusFromSource(source: ArtworkProofSource | null): { status: ProofArtifactPreviewStatus; error: string | null } {
  if (!source) {
    return { status: "missing_preview", error: "No artwork attachment is available for preview generation." };
  }

  const mime = String(source.mimeType || "").toLowerCase();
  const hasDerivativePreview = Boolean(source.previewKey || source.thumbKey || source.thumbnailUrl);

  if (source.sourceType === "asset" && source.assetPreviewStatus === "failed") {
    return { status: "generation_failed", error: source.assetPreviewError?.trim() || "Preview generation failed for the linked artwork asset." };
  }

  if (hasDerivativePreview) {
    return { status: "ready", error: null };
  }

  if (mime.startsWith("image/png") || mime.startsWith("image/jpeg") || mime.startsWith("image/jpg") || mime === "application/pdf") {
    if (source.sourceType === "asset" && source.assetPreviewStatus === "pending") {
      return { status: "missing_preview", error: "Artwork preview has not finished generating yet." };
    }
    return { status: "missing_preview", error: "Artwork preview is not available for the selected source file." };
  }

  return { status: "missing_preview", error: `Unsupported artwork type${source.fileName ? `: ${source.fileName}` : ""}.` };
}

type AutoSyncProofResult =
  | { status: "not_required" | "no_source" | "already_current" }
  | { status: "created" | "refreshed" | "invalidated"; proofVersionId?: string | null; proofFileId?: string | null; toState?: string | null };

type PreviewDerivativeGenerationResult = {
  sourceType: ArtworkProofSource["sourceType"];
  sourceId: string;
  derivativeStatus: "ready" | "pending" | "failed";
  previewStatus: ProofArtifactPreviewStatus;
  sourceFileName: string;
  message: string;
};

function throwProofingConflict(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 409 });
}

function throwProofingBadRequest(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

function isPdfCompatibleArtworkMime(mimeType: string | null | undefined) {
  const normalized = String(mimeType || "").toLowerCase();
  return normalized.includes("pdf") || /(illustrator|postscript)/i.test(normalized);
}

function sourceHasUsablePreviewDerivative(source: ArtworkProofSource | null) {
  if (!source) return false;
  return Boolean(
    source.previewKey ||
    source.thumbKey ||
    source.thumbnailUrl ||
    source.pagePreviewFileRecordId ||
    source.pageThumbFileRecordId,
  );
}

function isSupportedProofArtworkSource(source: {
  fileName?: string | null;
  mimeType?: string | null;
  fileRecordId?: string | null;
  fileUrl?: string | null;
  relativePath?: string | null;
  previewKey?: string | null;
  thumbKey?: string | null;
  thumbnailUrl?: string | null;
  pagePreviewFileRecordId?: string | null;
  pageThumbFileRecordId?: string | null;
}) {
  const mime = String(source.mimeType || "").toLowerCase();
  const fileName = String(source.fileName || "").toLowerCase();
  const hasReadableReference = Boolean(
    source.fileRecordId ||
    source.fileUrl ||
    source.relativePath ||
    source.previewKey ||
    source.thumbKey ||
    source.thumbnailUrl ||
    source.pagePreviewFileRecordId ||
    source.pageThumbFileRecordId,
  );

  if (!hasReadableReference) {
    return { eligible: false, reason: "missing file reference" };
  }

  const supported =
    mime.startsWith("image/") ||
    mime.includes("pdf") ||
    /(illustrator|postscript)/i.test(mime) ||
    /\.(png|jpe?g|webp|tiff?|pdf|ai|eps)$/i.test(fileName);

  if (!supported) {
    return { eligible: false, reason: "unsupported file type" };
  }

  return { eligible: true, reason: null };
}

function buildPreviewGenerationUnavailableMessage(source: ArtworkProofSource) {
  if (isPdfCompatibleArtworkMime(source.mimeType)) {
    return "Preview generation for PDF artwork is not available in this runtime.";
  }

  return "Preview generation failed. Upload a manual proof or retry once image preview generation is available.";
}

function buildAttachmentPreviewGenerationFailureMessage(source: ArtworkProofSource) {
  const rawError = String(source.thumbError || "").trim();
  if (/dependencies unavailable|pdfjs unavailable|canvas unavailable|sharp unavailable/i.test(rawError)) {
    return buildPreviewGenerationUnavailableMessage(source);
  }
  if (rawError.length > 0) {
    return `Preview generation failed. ${rawError}`;
  }
  return "Preview generation failed. Upload a manual proof or check the artwork attachment.";
}

function buildAssetPreviewGenerationFailureMessage(source: ArtworkProofSource) {
  const rawError = String(source.assetPreviewError || "").trim();
  if (/unsupported|unavailable|missing/i.test(rawError)) {
    return buildPreviewGenerationUnavailableMessage(source);
  }
  if (rawError.length > 0) {
    return `Preview generation failed. ${rawError}`;
  }
  return "Preview generation failed. Upload a manual proof or check the linked artwork asset.";
}

function normalizeProofingWriteError(error: any): never {
  if (error?.statusCode) {
    throw error;
  }

  if (error?.code === "23505") {
    if (error?.constraint === "line_item_proof_versions_active_review_uidx") {
      throwProofingConflict("Another proof version is already awaiting response");
    }

    if (error?.constraint === "line_item_proof_versions_line_item_version_uidx") {
      throwProofingConflict("Proof version numbering conflicted with another write; retry the action");
    }

    if (error?.constraint === "line_item_proof_approvals_version_uidx") {
      throwProofingConflict("A response has already been recorded for this proof version");
    }

    if (error?.constraint === "line_item_proof_manual_approval_overrides_version_uidx") {
      throwProofingConflict("A manual approval override has already been recorded for this proof version");
    }
  }

  throw error;
}

async function supersedeProofVersions(tx: any, args: {
  organizationId: string;
  orderId: string;
  lineItemId: string;
  statuses: ProofVersionStatus[];
  actorUserId?: string | null;
  reason?: string | null;
}) {
  const existing = await tx
    .select({
      id: lineItemProofVersions.id,
      versionNumber: lineItemProofVersions.versionNumber,
      status: lineItemProofVersions.status,
    })
    .from(lineItemProofVersions)
    .where(
      and(
        eq(lineItemProofVersions.organizationId, args.organizationId),
        eq(lineItemProofVersions.lineItemId, args.lineItemId),
        inArray(lineItemProofVersions.status, args.statuses),
      ),
    );

  if (existing.length === 0) {
    return [];
  }

  await tx
    .update(lineItemProofVersions)
    .set({
      status: "superseded",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(lineItemProofVersions.organizationId, args.organizationId),
        eq(lineItemProofVersions.lineItemId, args.lineItemId),
        inArray(lineItemProofVersions.status, args.statuses),
      ),
    );

  for (const version of existing) {
    await appendProofingEvent(tx, {
      organizationId: args.organizationId,
      orderId: args.orderId,
      lineItemId: args.lineItemId,
      eventType: "proof_superseded",
      actorUserId: args.actorUserId ?? null,
      payload: {
        proofVersionId: version.id,
        versionNumber: version.versionNumber,
        previousProofStatus: version.status,
        newProofStatus: "superseded",
        reason: args.reason ?? null,
      },
    });
  }

  return existing;
}

async function supersedeObsoleteDraftVersions(tx: any, args: {
  organizationId: string;
  orderId: string;
  lineItemId: string;
  actorUserId?: string | null;
  reason?: string | null;
}) {
  return supersedeProofVersions(tx, {
    ...args,
    statuses: ["draft"],
  });
}

async function supersedeActionableProofVersions(tx: any, args: {
  organizationId: string;
  orderId: string;
  lineItemId: string;
  actorUserId?: string | null;
  reason?: string | null;
}) {
  return supersedeProofVersions(tx, {
    ...args,
    statuses: ["draft", "awaiting_response"],
  });
}

async function cancelActionableProofVersions(tx: any, args: {
  organizationId: string;
  orderId: string;
  lineItemId: string;
  actorUserId?: string | null;
  reason?: string | null;
}) {
  const existing = await tx
    .select({
      id: lineItemProofVersions.id,
      versionNumber: lineItemProofVersions.versionNumber,
      status: lineItemProofVersions.status,
    })
    .from(lineItemProofVersions)
    .where(
      and(
        eq(lineItemProofVersions.organizationId, args.organizationId),
        eq(lineItemProofVersions.lineItemId, args.lineItemId),
        inArray(lineItemProofVersions.status, ["draft", "awaiting_response"]),
      ),
    );

  if (existing.length === 0) {
    return [];
  }

  await tx
    .update(lineItemProofVersions)
    .set({
      status: "cancelled",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(lineItemProofVersions.organizationId, args.organizationId),
        eq(lineItemProofVersions.lineItemId, args.lineItemId),
        inArray(lineItemProofVersions.status, ["draft", "awaiting_response"]),
      ),
    );

  for (const version of existing) {
    await appendProofingEvent(tx, {
      organizationId: args.organizationId,
      orderId: args.orderId,
      lineItemId: args.lineItemId,
      eventType: version.status === "draft" ? "proof_draft_cancelled" : "proof_version_cancelled",
      actorUserId: args.actorUserId ?? null,
      payload: {
        proofVersionId: version.id,
        versionNumber: version.versionNumber,
        previousProofStatus: version.status,
        newProofStatus: "cancelled",
        reason: args.reason ?? null,
      },
    });
  }

  return existing;
}

function isActionableProofStatus(status: string | null | undefined): status is "draft" | "awaiting_response" {
  return status === "draft" || status === "awaiting_response";
}

function isBlockedPendingProofApproval(args: {
  workflowState: string;
  requiresProofApproval: boolean;
  approvedProofVersionId: string | null;
  currentActionableProofVersion: ProofVersionHistoryEntry | null;
}) {
  return (
    args.requiresProofApproval &&
    !args.approvedProofVersionId &&
    (args.workflowState === "awaiting_proof_approval" || args.currentActionableProofVersion?.status === "awaiting_response")
  );
}

function normalizeProofingWorkflowState(value: string): ProofingReadModel["workflowState"] {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "new" ||
    normalized === "needs_design" ||
    normalized === "in_design" ||
    normalized === "awaiting_proof_approval" ||
    normalized === "ready_for_prepress" ||
    normalized === "in_prepress" ||
    normalized === "ready_for_production" ||
    normalized === "in_production" ||
    normalized === "completed" ||
    normalized === "on_hold" ||
    normalized === "canceled"
  ) {
    return normalized;
  }

  throw Object.assign(new Error(`Invalid line item workflow state for proofing: ${value}`), { statusCode: 409 });
}

export function deriveProofResponseWorkflowState(args: { decision: ProofDecision; requiresPrepress: boolean }) {
  if (args.decision === "approved") {
    return args.requiresPrepress ? "ready_for_prepress" : "ready_for_production";
  }

  return "needs_design";
}

type LoadedProofLineItem = {
  lineItemId: string;
  orderId: string;
  organizationId: string;
  orderState: string | null;
  orderStatus: string | null;
  orderCanceledAt: string | Date | null;
  workflowState: string;
  requiresPrepress: boolean;
  requiresProofApproval: boolean;
  approvedProofVersionId: string | null;
  updatedAt: Date;
};

type LoadedProofQueueLineItem = LoadedProofLineItem & {
  orderNumber: string | null;
  customerDisplayName: string | null;
  lineItemLabel: string;
  packageLabel: string;
  activeOwnerJobId?: string | null;
  activeOwnerStationKey?: string | null;
  activeOwnerStepKey?: string | null;
  productionJobId?: string | null;
};

async function loadProofLineItem(tx: any, args: { organizationId: string; lineItemId: string }): Promise<LoadedProofLineItem> {
  const [row] = await tx
    .select({
      lineItemId: orderLineItems.id,
      orderId: orderLineItems.orderId,
      organizationId: orders.organizationId,
      orderState: orders.state,
      orderStatus: orders.status,
      orderCanceledAt: orders.canceledAt,
      workflowState: orderLineItems.workflowState,
      requiresPrepress: orderLineItems.requiresPrepress,
      requiresProofApproval: orderLineItems.requiresProofApproval,
      approvedProofVersionId: orderLineItems.approvedProofVersionId,
      updatedAt: orderLineItems.updatedAt,
    })
    .from(orderLineItems)
    .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
    .where(and(eq(orderLineItems.id, args.lineItemId), eq(orders.organizationId, args.organizationId)))
    .limit(1);

  if (!row) {
    throw Object.assign(new Error("Line item not found"), { statusCode: 404 });
  }

  return {
    ...row,
    requiresPrepress: Boolean(row.requiresPrepress),
    requiresProofApproval: Boolean(row.requiresProofApproval),
  };
}

function trimNullable(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toIsoString(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

function maxIsoTimestamp(values: Array<string | null | undefined>): string {
  let maxTimestamp = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    if (!value) continue;
    const timestamp = new Date(value).getTime();
    if (Number.isFinite(timestamp) && timestamp > maxTimestamp) {
      maxTimestamp = timestamp;
    }
  }

  return Number.isFinite(maxTimestamp) ? new Date(maxTimestamp).toISOString() : new Date(0).toISOString();
}

function formatProofVersionLabel(versionNumber: number): string {
  return `Proof v${versionNumber}`;
}

function parseNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildDisplaySizeLabel(width: number | null, height: number | null): string | null {
  if (width != null && height != null) {
    return `${width}" x ${height}"`;
  }
  if (width != null) return `${width}" wide`;
  if (height != null) return `${height}" high`;
  return null;
}

function pickSpecValue(specsJson: Record<string, any> | null | undefined, candidates: string[]): string | null {
  if (!specsJson || typeof specsJson !== "object") return null;
  const lowered = new Map(Object.entries(specsJson).map(([key, value]) => [key.toLowerCase(), value]));
  for (const candidate of candidates) {
    const value = lowered.get(candidate.toLowerCase());
    if (value == null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return null;
}

function buildFinishingSummary(lineItem: LoadedProofSnapshotLineItem): string[] {
  const facts: string[] = [];
  const pushFact = (label: string, value: unknown) => {
    const normalized = String(value ?? "").trim();
    if (!normalized) return;
    const fact = `${label}: ${normalized}`;
    if (!facts.includes(fact)) facts.push(fact);
  };

  for (const option of Array.isArray(lineItem.selectedOptions) ? lineItem.selectedOptions : []) {
    const optionName = String(option?.optionName ?? "").trim();
    if (!optionName) continue;
    const value = typeof option?.value === "boolean"
      ? option.value ? "Yes" : "No"
      : String(option?.value ?? "").trim();
    if (!value || value === "false" || value === "0") continue;
    pushFact(optionName, value);
  }

  for (const usage of Array.isArray(lineItem.materialUsages) ? lineItem.materialUsages : []) {
    const materialName = String(usage?.materialName ?? "").trim();
    if (!materialName) continue;
    const qty = usage?.quantityUsed != null ? Number(usage.quantityUsed) : null;
    const uom = String(usage?.unitOfMeasure ?? "").trim();
    pushFact("Material", qty != null && Number.isFinite(qty) ? `${materialName} (${qty}${uom ? ` ${uom}` : ""})` : materialName);
  }

  pushFact("Laminate", pickSpecValue(lineItem.specsJson, ["laminate", "lamination", "laminateType"]));
  pushFact("Cut", pickSpecValue(lineItem.specsJson, ["cut", "cutType", "trim", "trimType"]));
  pushFact("Hem", pickSpecValue(lineItem.specsJson, ["hem", "hemming"]));
  pushFact("Grommets", pickSpecValue(lineItem.specsJson, ["grommets", "grommetSpacing"]));
  pushFact("Sides", pickSpecValue(lineItem.specsJson, ["sides", "printSides"]));

  return facts.slice(0, 8);
}

async function loadProofSnapshotLineItem(tx: any, args: { organizationId: string; lineItemId: string }): Promise<LoadedProofSnapshotLineItem> {
  const [row] = await tx
    .select({
      lineItemId: orderLineItems.id,
      orderId: orderLineItems.orderId,
      orderNumber: orders.orderNumber,
      lineItemLabel: orderLineItems.description,
      width: orderLineItems.width,
      height: orderLineItems.height,
      quantity: orderLineItems.quantity,
      specsJson: orderLineItems.specsJson,
      selectedOptions: orderLineItems.selectedOptions,
      materialUsages: orderLineItems.materialUsages,
      updatedAt: orderLineItems.updatedAt,
    })
    .from(orderLineItems)
    .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
    .where(and(eq(orderLineItems.id, args.lineItemId), eq(orders.organizationId, args.organizationId)))
    .limit(1);

  if (!row) {
    throw Object.assign(new Error("Line item not found"), { statusCode: 404 });
  }

  return {
    ...row,
    specsJson: (row.specsJson as Record<string, any> | null) ?? null,
    selectedOptions: Array.isArray(row.selectedOptions) ? row.selectedOptions as LoadedProofSnapshotLineItem["selectedOptions"] : [],
    materialUsages: Array.isArray(row.materialUsages) ? row.materialUsages as LoadedProofSnapshotLineItem["materialUsages"] : [],
  };
}

function buildSelectedOptionMap(lineItem: LoadedProofSnapshotLineItem): Record<string, string> {
  const map: Record<string, string> = {};
  for (const option of Array.isArray(lineItem.selectedOptions) ? lineItem.selectedOptions : []) {
    const name = String(option?.optionName ?? "").trim();
    if (!name) continue;
    const value = typeof option?.value === "boolean"
      ? (option.value ? "Yes" : "No")
      : String(option?.value ?? "").trim();
    if (!value || value === "false" || value === "0") continue;
    map[name] = value;
  }
  // Include material usages as "Material" entries when not already set by selectedOptions
  for (const usage of Array.isArray(lineItem.materialUsages) ? lineItem.materialUsages : []) {
    const materialName = String(usage?.materialName ?? "").trim();
    if (!materialName) continue;
    const key = "Material";
    if (!map[key]) map[key] = materialName;
  }
  return map;
}

export async function buildProofInputSnapshot(tx: any, args: {
  organizationId: string;
  lineItemId: string;
  selectedArtworkSourceIds?: string[] | null;
}): Promise<ProofInputSnapshot> {
  const lineItem = await loadProofSnapshotLineItem(tx, args);
  const source = await loadLatestArtworkProofSource(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
    selectedSourceIds: args.selectedArtworkSourceIds ?? null,
  });
  const finishedWidth = parseNullableNumber(lineItem.width);
  const finishedHeight = parseNullableNumber(lineItem.height);
  const snapshotBasisAt = maxIsoTimestamp([
    toIsoString(lineItem.updatedAt),
    toIsoString(source?.updatedAt ?? null),
  ]);

  return {
    lineItemId: lineItem.lineItemId,
    orderId: lineItem.orderId,
    orderNumber: lineItem.orderNumber,
    lineItemLabel: lineItem.lineItemLabel,
    sourceArtwork: source
      ? {
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          fileRecordId: source.fileRecordId ?? null,
          fileName: source.originalFilename || source.fileName,
          mimeType: source.mimeType ?? null,
          fileUrl: source.fileUrl ?? null,
        }
      : null,
    finishedWidth,
    finishedHeight,
    displaySizeLabel: buildDisplaySizeLabel(finishedWidth, finishedHeight),
    quantity: Number.isFinite(lineItem.quantity) ? lineItem.quantity : null,
    finishingSummary: buildFinishingSummary(lineItem),
    selectedOptionMap: buildSelectedOptionMap(lineItem),
    snapshotBasisAt,
    lineItemUpdatedAt: toIsoString(lineItem.updatedAt),
    sourceUpdatedAt: toIsoString(source?.updatedAt ?? null),
    preflightStatus: "not_run",
  };
}

async function loadProofAttachment(tx: any, args: { organizationId: string; attachmentId: string }): Promise<ProofArtifactAttachmentRow> {
  const [attachment] = await tx
    .select({
      id: orderAttachments.id,
      fileName: orderAttachments.fileName,
      mimeType: orderAttachments.mimeType,
      description: orderAttachments.description,
      fileRecordId: orderAttachments.fileRecordId,
      fileUrl: orderAttachments.fileUrl,
      thumbKey: orderAttachments.thumbKey,
      previewKey: orderAttachments.previewKey,
      thumbnailUrl: orderAttachments.thumbnailUrl,
      pagePreviewCount: sql<number>`(
        select count(*)::int from ${quoteAttachmentPages}
        where ${quoteAttachmentPages.attachmentId} = ${orderAttachments.id}
          and ${quoteAttachmentPages.previewFileRecordId} is not null
      )`,
      pageThumbCount: sql<number>`(
        select count(*)::int from ${quoteAttachmentPages}
        where ${quoteAttachmentPages.attachmentId} = ${orderAttachments.id}
          and ${quoteAttachmentPages.thumbFileRecordId} is not null
      )`,
    })
    .from(orderAttachments)
    .innerJoin(orders, eq(orderAttachments.orderId, orders.id))
    .where(and(eq(orderAttachments.id, args.attachmentId), eq(orders.organizationId, args.organizationId)))
    .limit(1);

  if (!attachment) {
    throw Object.assign(new Error("Proof attachment not found"), { statusCode: 404 });
  }

  return attachment;
}

export function buildProofArtifactSummary(args: {
  attachment: ProofArtifactAttachmentRow;
  snapshot: ProofInputSnapshot | null;
}): ProofArtifactSummary {
  const normalizedDescription = String(args.attachment.description || "");
  let artifactKind: ProofArtifactSummary["artifactKind"] = normalizedDescription.includes(GENERATED_PROOF_DESCRIPTION_MARKER)
    ? "generated"
    : "uploaded";

  if (
    artifactKind === "uploaded" &&
    args.snapshot?.sourceArtwork?.fileRecordId &&
    args.attachment.fileRecordId &&
    args.snapshot.sourceArtwork.fileRecordId === args.attachment.fileRecordId
  ) {
    artifactKind = "promoted_artwork";
  }

  const explicitGeneratedPreviewStatus = parseGeneratedPreviewStatusFromDescription(args.attachment.description);
  const explicitGeneratedPreviewError = parseGeneratedPreviewErrorFromDescription(args.attachment.description);
  const mime = String(args.attachment.mimeType || "").toLowerCase();
  const isImage = mime.startsWith("image/");
  const isPdf = mime === "application/pdf";
  const hasDirectFileUrl = Boolean(args.attachment.fileUrl);
  const hasDerivedPreview = Boolean(
    args.attachment.previewKey ||
    args.attachment.thumbKey ||
    args.attachment.thumbnailUrl ||
    args.attachment.pagePreviewCount > 0 ||
    args.attachment.pageThumbCount > 0
  );

  let previewStatus: ProofArtifactPreviewStatus;
  let previewError: string | null = null;

  if (artifactKind === "generated") {
    previewStatus = explicitGeneratedPreviewStatus ?? "metadata_only";
    if (previewStatus !== "ready") {
      previewError = explicitGeneratedPreviewError || "Generated proof does not contain an artwork preview.";
    }
  } else if (hasDerivedPreview || isImage || ((isImage || isPdf) && hasDirectFileUrl)) {
    previewStatus = "ready";
  } else if (isPdf && args.attachment.fileRecordId) {
    previewStatus = "ready";
  } else {
    previewStatus = "missing_preview";
    previewError = "No previewable proof content is available for this attachment.";
  }

  return {
    attachmentId: args.attachment.id,
    artifactKind,
    fileName: args.attachment.fileName,
    mimeType: args.attachment.mimeType ?? null,
    generatedFromSnapshot: artifactKind === "generated",
    previewStatus,
    previewError,
  };
}

async function loadPreferredProofPreviewCandidate(tx: any, args: {
  organizationId: string;
  lineItemId: string;
}): Promise<ProofPreviewCandidate | null> {
  const [proofAttachment] = await tx
    .select({
      id: orderAttachments.id,
      fileName: orderAttachments.originalFilename,
      fallbackFileName: orderAttachments.fileName,
      mimeType: orderAttachments.mimeType,
      fileRecordId: orderAttachments.fileRecordId,
      previewKey: orderAttachments.previewKey,
      thumbKey: orderAttachments.thumbKey,
      storageProvider: orderAttachments.storageProvider,
      pagePreviewFileRecordId: sql<string | null>`(
        select ${quoteAttachmentPages.previewFileRecordId}
        from ${quoteAttachmentPages}
        where ${quoteAttachmentPages.attachmentId} = ${orderAttachments.id}
          and ${quoteAttachmentPages.previewFileRecordId} is not null
        order by ${quoteAttachmentPages.pageIndex} asc
        limit 1
      )`,
      pageThumbFileRecordId: sql<string | null>`(
        select ${quoteAttachmentPages.thumbFileRecordId}
        from ${quoteAttachmentPages}
        where ${quoteAttachmentPages.attachmentId} = ${orderAttachments.id}
          and ${quoteAttachmentPages.thumbFileRecordId} is not null
        order by ${quoteAttachmentPages.pageIndex} asc
        limit 1
      )`,
    })
    .from(orderAttachments)
    .innerJoin(orders, eq(orderAttachments.orderId, orders.id))
    .where(
      and(
        eq(orders.organizationId, args.organizationId),
        eq(orderAttachments.orderLineItemId, args.lineItemId),
        eq(orderAttachments.role, "proof"),
        sql`coalesce(${orderAttachments.description}, '') not like ${`%${GENERATED_PROOF_DESCRIPTION_MARKER}%`}`,
      ),
    )
    .orderBy(desc(orderAttachments.isPrimary), desc(orderAttachments.updatedAt), desc(orderAttachments.createdAt))
    .limit(1);

  if (!proofAttachment) {
    return null;
  }

  return {
    candidateId: `proof:${proofAttachment.id}`,
    fileName: proofAttachment.fileName || proofAttachment.fallbackFileName,
    mimeType: proofAttachment.mimeType ?? null,
    fileRecordId: proofAttachment.fileRecordId ?? null,
    previewStorageKey: proofAttachment.previewKey ?? null,
    thumbStorageKey: proofAttachment.thumbKey ?? null,
    storageProviderHint: proofAttachment.storageProvider ?? null,
    pagePreviewFileRecordId: proofAttachment.pagePreviewFileRecordId ?? null,
    pageThumbFileRecordId: proofAttachment.pageThumbFileRecordId ?? null,
    allowOriginalPdf: true,
  };
}

async function resolveGeneratedProofPreview(tx: any, args: {
  organizationId: string;
  lineItemId: string;
  orderId: string;
  source: ArtworkProofSource | null;
}): Promise<ResolvedProofPreview> {
  const sourceAssessment = derivePreviewStatusFromSource(args.source);
  if (!args.source) {
    return {
      kind: "unavailable",
      preview: null,
      previewStatus: sourceAssessment.status,
      previewError: sourceAssessment.error,
      reason: "no_preview_source",
    };
  }

  const candidates: ProofPreviewCandidate[] = [];
  const preferredProofCandidate = await loadPreferredProofPreviewCandidate(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
  });
  if (preferredProofCandidate) {
    candidates.push(preferredProofCandidate);
  }

  candidates.push({
    candidateId: `${args.source.sourceType}:${args.source.sourceId}`,
    fileName: args.source.originalFilename || args.source.fileName,
    mimeType: args.source.mimeType ?? null,
    fileRecordId: args.source.fileRecordId ?? null,
    previewStorageKey: args.source.previewKey ?? null,
    thumbStorageKey: args.source.thumbKey ?? null,
    storageProviderHint: args.source.storageProvider ?? null,
    pagePreviewFileRecordId: args.source.pagePreviewFileRecordId ?? null,
    pageThumbFileRecordId: args.source.pageThumbFileRecordId ?? null,
    allowOriginalPdf: false,
  });

  const resolved = await resolveProofPreviewSource({
    context: {
      organizationId: args.organizationId,
      orderId: args.orderId,
      lineItemId: args.lineItemId,
    },
    candidates,
  });

  if (resolved.kind === "unavailable") {
    return {
      kind: "unavailable",
      preview: null,
      previewStatus: resolved.previewStatus,
      previewError: resolved.previewError || sourceAssessment.error,
      reason: resolved.reason,
    };
  }

  return {
    kind: resolved.kind,
    preview: {
      bytes: resolved.sourceBuffer,
      mimeType: resolved.mimeType,
      fileName: resolved.filename,
    },
    previewStatus: "ready",
    previewError: null,
    reason: null,
  };
}

async function createGeneratedProofAttachment(tx: any, args: {
  organizationId: string;
  actorUserId: string;
  snapshot: ProofInputSnapshot;
  source: ArtworkProofSource | null;
}): Promise<ProofArtifactSummary> {
  const resolvedPreview = await resolveGeneratedProofPreview(tx, {
    organizationId: args.organizationId,
    lineItemId: args.snapshot.lineItemId,
    orderId: args.snapshot.orderId,
    source: args.source,
  });
  const timestampToken = new Date().toISOString().replace(/[:.]/g, "-");
  const safeLineItem = args.snapshot.lineItemLabel.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "line-item";
  const fileName = `${safeLineItem}-proof-${timestampToken}.pdf`;
  const pdfResult = await generateBasicProofPdfBytes({
    orderNumber: args.snapshot.orderNumber,
    lineItemLabel: args.snapshot.lineItemLabel,
    displaySizeLabel: args.snapshot.displaySizeLabel,
    quantity: args.snapshot.quantity,
    finishingSummary: args.snapshot.finishingSummary,
    preflightStatus: args.snapshot.preflightStatus,
    sourceFileName: args.snapshot.sourceArtwork?.fileName ?? null,
    generatedAt: new Date(),
    preview: resolvedPreview.preview,
    previewError: resolvedPreview.previewError,
  });
  const finalPreviewStatus: ProofArtifactPreviewStatus = resolvedPreview.previewStatus === "ready" && pdfResult.renderStatus === "ready"
    ? "ready"
    : resolvedPreview.previewStatus === "ready"
      ? "generation_failed"
      : resolvedPreview.previewStatus;
  const descriptionPreviewMarker = finalPreviewStatus === "ready"
    ? GENERATED_PROOF_PREVIEW_READY_MARKER
    : finalPreviewStatus === "generation_failed"
      ? GENERATED_PROOF_GENERATION_FAILED_MARKER
      : finalPreviewStatus === "missing_preview"
        ? GENERATED_PROOF_MISSING_PREVIEW_MARKER
        : GENERATED_PROOF_METADATA_ONLY_MARKER;
  const descriptionPreviewError = resolvedPreview.previewError
    ? ` ${GENERATED_PROOF_PREVIEW_ERROR_PREFIX}${resolvedPreview.previewError.replace(/\]/g, ")")}]`
    : "";

  const stored = await storageApplicationService.finalizeUpload({
    organizationId: args.organizationId,
    createdByUserId: args.actorUserId,
    resource: {
      organizationId: args.organizationId,
      resourceType: "order",
      resourceId: args.snapshot.orderId,
      lineItemId: args.snapshot.lineItemId,
    },
    source: {
      kind: "buffer",
      buffer: Buffer.from(pdfResult.bytes),
      originalFilename: fileName,
      mimeType: "application/pdf",
    },
    persistLink: async (persistTx, storedResult) => {
      const [created] = await persistTx
        .insert(orderAttachments)
        .values({
          orderId: args.snapshot.orderId,
          orderLineItemId: args.snapshot.lineItemId,
          fileRecordId: storedResult.fileRecord.id,
          uploadedByUserId: args.actorUserId,
          fileName: storedResult.storedObject.originalFilename,
          fileUrl: storedResult.legacyFileUrl,
          fileSize: storedResult.storedObject.sizeBytes,
          mimeType: "application/pdf",
          description: `${GENERATED_PROOF_DESCRIPTION_MARKER} ${descriptionPreviewMarker}${descriptionPreviewError} Generated basic proof from persisted line-item truth.`,
          originalFilename: storedResult.storedObject.originalFilename,
          storedFilename: storedResult.storedObject.storedFilename,
          relativePath: storedResult.legacyRelativePath,
          storageProvider: storedResult.legacyStorageProvider as any,
          extension: "pdf",
          sizeBytes: storedResult.storedObject.sizeBytes,
          checksum: storedResult.storedObject.checksum,
          role: "proof",
          side: "na",
          isPrimary: true,
          updatedAt: new Date(),
        })
        .returning({
          id: orderAttachments.id,
          fileName: orderAttachments.fileName,
          mimeType: orderAttachments.mimeType,
          description: orderAttachments.description,
          fileRecordId: orderAttachments.fileRecordId,
        });

      return created;
    },
  });

  return buildProofArtifactSummary({
    attachment: stored.linkedRecord,
    snapshot: args.snapshot,
  });
}

export async function createAndSendProofVersion(tx: any, args: {
  organizationId: string;
  lineItemId: string;
  actorUserId: string;
  mode: ProofSendMode;
  proofFileId?: string | null;
  artworkSourceIds?: string[] | null;
  internalNotes?: string | null;
  sentToName?: string | null;
  sentToEmail?: string | null;
  customerMessage?: string | null;
  customerVisibleDisclaimer?: string | null;
}) {
  const snapshot = await buildProofInputSnapshot(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
    selectedArtworkSourceIds: args.artworkSourceIds ?? null,
  });

  let proofFileId = trimNullable(args.proofFileId);
  let artifact: ProofArtifactSummary;

  if (args.mode === "generated") {
    const source = await loadLatestArtworkProofSource(tx, {
      organizationId: args.organizationId,
      lineItemId: args.lineItemId,
      selectedSourceIds: args.artworkSourceIds ?? null,
    });

    if (!source) {
      throw Object.assign(new Error("No eligible artwork files found for this line item"), {
        statusCode: 409,
        code: "no_eligible_artwork_found",
      });
    }

    artifact = await createGeneratedProofAttachment(tx, {
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      snapshot,
      source,
    });
    proofFileId = artifact.attachmentId;
  } else {
    if (!proofFileId) {
      throwProofingBadRequest("Select or upload a proof file before sending");
    }

    const resolvedProofFileId = String(proofFileId);

    const attachment = await loadProofAttachment(tx, {
      organizationId: args.organizationId,
      attachmentId: resolvedProofFileId,
    });
    artifact = buildProofArtifactSummary({ attachment, snapshot });
  }

  if (!proofArtifactIsCustomerSendable(artifact)) {
    throw Object.assign(new Error(INCOMPLETE_PROOF_MESSAGE), { statusCode: 400 });
  }

  if (!proofFileId) {
    throw Object.assign(new Error("Proof artifact resolution failed"), { statusCode: 500 });
  }

  const createdVersion = await createLineItemProofVersion(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
    proofFileId,
    createdByUserId: args.actorUserId,
    internalNotes: args.internalNotes ?? null,
    sourceAction: args.mode === "generated" ? "proof_file_generated" : "proof_file_uploaded",
  });

  const sendResult = await markProofVersionSent(tx, {
    organizationId: args.organizationId,
    proofVersionId: createdVersion.id,
    actorUserId: args.actorUserId,
    sentToName: args.sentToName ?? null,
    sentToEmail: args.sentToEmail ?? null,
    customerMessage: args.customerMessage ?? null,
    customerVisibleDisclaimer: args.customerVisibleDisclaimer ?? null,
  });

  return {
    proofVersion: sendResult.proofVersion,
    workflowTransition: sendResult.workflowTransition,
    snapshot,
    artifact,
  };
}

/**
 * Create a generated proof version as a draft only — does NOT send or transition workflow state.
 * Produces the same artifact as createAndSendProofVersion (mode=generated) but stops before
 * markProofVersionSent, so staff must explicitly send via the /send endpoint.
 */
export async function createGeneratedDraftProofVersion(tx: any, args: {
  organizationId: string;
  lineItemId: string;
  actorUserId: string;
  artworkSourceIds?: string[] | null;
  internalNotes?: string | null;
}) {
  const snapshot = await buildProofInputSnapshot(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
    selectedArtworkSourceIds: args.artworkSourceIds ?? null,
  });

  const source = await loadLatestArtworkProofSource(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
    selectedSourceIds: args.artworkSourceIds ?? null,
  });

  if (!source) {
    throw Object.assign(
      new Error("No eligible artwork files found for this line item"),
      { statusCode: 409, code: "no_eligible_artwork_found" },
    );
  }

  const artifact = await createGeneratedProofAttachment(tx, {
    organizationId: args.organizationId,
    actorUserId: args.actorUserId,
    snapshot,
    source,
  });

  const createdVersion = await createLineItemProofVersion(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
    proofFileId: artifact.attachmentId,
    createdByUserId: args.actorUserId,
    internalNotes: args.internalNotes ?? null,
    sourceAction: "proof_file_generated",
  });

  const proofing = await resolveLineItemProofingTruth(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
  });

  return { proofVersion: createdVersion, proofing };
}

/**
 * Resend an already-sent proof notification for an awaiting_response version.
 * Updates sentToEmail/sentToName/sentAt, revokes old access tokens for this version,
 * and returns the updated version so the route layer can create a fresh access token
 * and fire the email.
 */
export async function resendProofVersion(tx: any, args: {
  organizationId: string;
  proofVersionId: string;
  actorUserId: string;
  sentToName?: string | null;
  sentToEmail?: string | null;
  customerMessage?: string | null;
  customerVisibleDisclaimer?: string | null;
}) {
  const proofVersion = await loadProofVersion(tx, {
    organizationId: args.organizationId,
    proofVersionId: args.proofVersionId,
  });

  if (proofVersion.status !== "awaiting_response") {
    throw Object.assign(
      new Error("Only awaiting_response proof versions can be resent"),
      { statusCode: 409 },
    );
  }

  const artifact = buildProofArtifactSummary({
    attachment: await loadProofAttachment(tx, {
      organizationId: args.organizationId,
      attachmentId: proofVersion.proofFileId,
    }),
    snapshot: await buildProofInputSnapshot(tx, {
      organizationId: args.organizationId,
      lineItemId: proofVersion.lineItemId,
    }),
  });

  if (!proofArtifactIsCustomerSendable(artifact)) {
    throw Object.assign(new Error(INCOMPLETE_PROOF_MESSAGE), { statusCode: 400 });
  }

  // Revoke all existing active tokens for this proof version so old links stop working.
  await tx
    .update(proofAccessTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(proofAccessTokens.proofVersionId, proofVersion.id),
        eq(proofAccessTokens.organizationId, args.organizationId),
        isNull(proofAccessTokens.revokedAt),
      ),
    );

  const [updatedVersion] = await tx
    .update(lineItemProofVersions)
    .set({
      sentToName: args.sentToName ?? null,
      sentToEmail: args.sentToEmail ?? null,
      customerMessage: args.customerMessage ?? null,
      customerVisibleDisclaimer: args.customerVisibleDisclaimer ?? null,
      sentByUserId: args.actorUserId,
      sentAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(lineItemProofVersions.id, proofVersion.id))
    .returning();

  await appendProofingEvent(tx, {
    organizationId: args.organizationId,
    orderId: proofVersion.orderId,
    lineItemId: proofVersion.lineItemId,
    eventType: "proof_resent",
    actorUserId: args.actorUserId,
    payload: {
      proofVersionId: proofVersion.id,
      versionNumber: proofVersion.versionNumber,
      previousProofStatus: proofVersion.status,
      newProofStatus: proofVersion.status,
      sentToEmail: args.sentToEmail ?? null,
      customerMessage: args.customerMessage ?? null,
    },
  });

  return { proofVersion: updatedVersion };
}

function logProofAutoSync(event: string, payload: Record<string, unknown>) {
  console.info(`[ProofingAutoSync] ${event}`, payload);
}

type ResolvedEligibleArtworkSource = EligibleProofArtworkSource & {
  artworkSource: ArtworkProofSource | null;
};

function buildEligibleArtworkSource(source: ArtworkProofSource, args: {
  publicSourceType: EligibleProofArtworkSource["sourceType"];
  role: string | null;
}): ResolvedEligibleArtworkSource {
  const displayName = source.originalFilename || source.fileName;
  const eligibility = isSupportedProofArtworkSource(source);

  return {
    id: source.sourceId,
    sourceType: args.publicSourceType,
    sourceId: source.sourceId,
    attachmentId: source.sourceType === "attachment" ? source.sourceId : null,
    fileRecordId: source.fileRecordId ?? null,
    fileName: displayName,
    originalFilename: source.originalFilename ?? null,
    mimeType: source.mimeType ?? null,
    fileUrl: source.fileUrl ?? null,
    thumbnailUrl: source.thumbnailUrl ?? null,
    previewUrl: source.previewKey ?? null,
    role: args.role,
    eligible: eligibility.eligible,
    eligibilityReason: eligibility.reason,
    artworkSource: eligibility.eligible ? source : null,
  };
}

async function resolveEligibleProofArtworkSourceRows(tx: any, args: {
  organizationId: string;
  lineItemId: string;
}): Promise<ResolvedEligibleArtworkSource[]> {
  const attachmentSources = await tx
    .select({
      sourceId: orderAttachments.id,
      orderId: orderAttachments.orderId,
      orderLineItemId: orderAttachments.orderLineItemId,
      role: orderAttachments.role,
      fileRecordId: orderAttachments.fileRecordId,
      fileName: orderAttachments.fileName,
      fileUrl: orderAttachments.fileUrl,
      fileSize: orderAttachments.fileSize,
      sizeBytes: orderAttachments.sizeBytes,
      mimeType: orderAttachments.mimeType,
      description: orderAttachments.description,
      originalFilename: orderAttachments.originalFilename,
      storedFilename: orderAttachments.storedFilename,
      relativePath: orderAttachments.relativePath,
      storageProvider: orderAttachments.storageProvider,
      extension: orderAttachments.extension,
      checksum: orderAttachments.checksum,
      thumbKey: orderAttachments.thumbKey,
      previewKey: orderAttachments.previewKey,
      thumbStatus: orderAttachments.thumbStatus,
      thumbError: orderAttachments.thumbError,
      thumbnailRelativePath: orderAttachments.thumbnailRelativePath,
      thumbnailGeneratedAt: orderAttachments.thumbnailGeneratedAt,
      thumbnailUrl: orderAttachments.thumbnailUrl,
      pagePreviewFileRecordId: sql<string | null>`(
        select ${quoteAttachmentPages.previewFileRecordId}
        from ${quoteAttachmentPages}
        where ${quoteAttachmentPages.attachmentId} = ${orderAttachments.id}
          and ${quoteAttachmentPages.previewFileRecordId} is not null
        order by ${quoteAttachmentPages.pageIndex} asc
        limit 1
      )`,
      pageThumbFileRecordId: sql<string | null>`(
        select ${quoteAttachmentPages.thumbFileRecordId}
        from ${quoteAttachmentPages}
        where ${quoteAttachmentPages.attachmentId} = ${orderAttachments.id}
          and ${quoteAttachmentPages.thumbFileRecordId} is not null
        order by ${quoteAttachmentPages.pageIndex} asc
        limit 1
      )`,
      uploadedByUserId: orderAttachments.uploadedByUserId,
      uploadedByName: orderAttachments.uploadedByName,
      updatedAt: orderAttachments.updatedAt,
    })
    .from(orderLineItems)
    .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
    .innerJoin(orderAttachments, eq(orderAttachments.orderId, orders.id))
    .where(
      and(
        eq(orders.organizationId, args.organizationId),
        eq(orderLineItems.id, args.lineItemId),
        or(
          eq(orderAttachments.orderLineItemId, args.lineItemId),
          isNull(orderAttachments.orderLineItemId),
        ),
        inArray(orderAttachments.role, ["artwork", "reference"]),
      ),
    )
    .orderBy(desc(orderAttachments.isPrimary), desc(orderAttachments.updatedAt), desc(orderAttachments.createdAt));

  const resolved: ResolvedEligibleArtworkSource[] = [];
  const seen = new Set<string>();

  for (const attachmentSource of attachmentSources) {
    const source: ArtworkProofSource = {
      sourceType: "attachment",
      sourceId: attachmentSource.sourceId,
      orderId: attachmentSource.orderId,
      orderLineItemId: String(attachmentSource.orderLineItemId || args.lineItemId),
      fileRecordId: attachmentSource.fileRecordId ?? null,
      fileName: attachmentSource.fileName,
      fileUrl: attachmentSource.fileUrl ?? null,
      fileSize: attachmentSource.fileSize ?? null,
      sizeBytes: attachmentSource.sizeBytes ?? null,
      mimeType: attachmentSource.mimeType ?? null,
      description: attachmentSource.description ?? null,
      originalFilename: attachmentSource.originalFilename ?? null,
      storedFilename: attachmentSource.storedFilename ?? null,
      relativePath: attachmentSource.relativePath ?? null,
      storageProvider: attachmentSource.storageProvider ?? null,
      extension: attachmentSource.extension ?? null,
      checksum: attachmentSource.checksum ?? null,
      thumbKey: attachmentSource.thumbKey ?? null,
      previewKey: attachmentSource.previewKey ?? null,
      thumbStatus: attachmentSource.thumbStatus ?? null,
      thumbError: attachmentSource.thumbError ?? null,
      thumbnailRelativePath: attachmentSource.thumbnailRelativePath ?? null,
      thumbnailGeneratedAt: attachmentSource.thumbnailGeneratedAt ?? null,
      thumbnailUrl: attachmentSource.thumbnailUrl ?? null,
      pagePreviewFileRecordId: attachmentSource.pagePreviewFileRecordId ?? null,
      pageThumbFileRecordId: attachmentSource.pageThumbFileRecordId ?? null,
      uploadedByUserId: attachmentSource.uploadedByUserId ?? null,
      uploadedByName: attachmentSource.uploadedByName ?? null,
      updatedAt: attachmentSource.updatedAt ?? null,
    };
    if (!seen.has(`attachment:${source.sourceId}`)) {
      resolved.push(buildEligibleArtworkSource(source, {
        publicSourceType: "line_item_artwork",
        role: attachmentSource.role ?? null,
      }));
      seen.add(`attachment:${source.sourceId}`);
    }
  }

  const assetSources = await tx
    .select({
      sourceId: assets.id,
      orderId: orderLineItems.orderId,
      orderLineItemId: orderLineItems.id,
      fileRecordId: assets.fileRecordId,
      fileName: assets.fileName,
      fileUrl: assets.fileKey,
      fileSize: sql<number | null>`null`,
      sizeBytes: assets.sizeBytes,
      mimeType: assets.mimeType,
      description: sql<string | null>`null`,
      originalFilename: sql<string | null>`null`,
      storedFilename: sql<string | null>`null`,
      relativePath: sql<string | null>`null`,
      storageProvider: sql<string | null>`null`,
      extension: sql<string | null>`null`,
      checksum: sql<string | null>`null`,
      thumbKey: assets.thumbKey,
      previewKey: assets.previewKey,
      thumbnailRelativePath: sql<string | null>`null`,
      thumbnailGeneratedAt: sql<Date | null>`null`,
      thumbnailUrl: sql<string | null>`null`,
      uploadedByUserId: sql<string | null>`null`,
      uploadedByName: sql<string | null>`null`,
      updatedAt: assets.updatedAt,
      assetPreviewStatus: assets.previewStatus,
      assetPreviewError: assets.previewError,
      role: assetLinks.role,
    })
    .from(assetLinks)
    .innerJoin(assets, eq(assetLinks.assetId, assets.id))
    .innerJoin(orderLineItems, eq(orderLineItems.id, assetLinks.parentId))
    .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
    .where(
      and(
        eq(assetLinks.organizationId, args.organizationId),
        eq(assetLinks.parentType, "order_line_item"),
        eq(assetLinks.parentId, args.lineItemId),
        inArray(assetLinks.role, ["primary", "attachment", "reference"]),
      ),
    )
    .orderBy(sql`case when ${assetLinks.role} = 'primary' then 0 else 1 end`, desc(assetLinks.createdAt), desc(assets.updatedAt), desc(assets.createdAt));

  for (const assetSource of assetSources) {
    const source: ArtworkProofSource = {
      sourceType: "asset",
      sourceId: assetSource.sourceId,
      orderId: assetSource.orderId,
      orderLineItemId: assetSource.orderLineItemId,
      fileRecordId: assetSource.fileRecordId ?? null,
      fileName: assetSource.fileName,
      fileUrl: assetSource.fileUrl ?? null,
      fileSize: assetSource.fileSize ?? null,
      sizeBytes: assetSource.sizeBytes ?? null,
      mimeType: assetSource.mimeType ?? null,
      description: assetSource.description ?? null,
      originalFilename: assetSource.originalFilename ?? null,
      storedFilename: assetSource.storedFilename ?? null,
      relativePath: assetSource.relativePath ?? null,
      storageProvider: assetSource.storageProvider ?? null,
      extension: assetSource.extension ?? null,
      checksum: assetSource.checksum ?? null,
      thumbKey: assetSource.thumbKey ?? null,
      previewKey: assetSource.previewKey ?? null,
      thumbStatus: null,
      thumbError: null,
      thumbnailRelativePath: assetSource.thumbnailRelativePath ?? null,
      thumbnailGeneratedAt: assetSource.thumbnailGeneratedAt ?? null,
      thumbnailUrl: assetSource.thumbnailUrl ?? null,
      uploadedByUserId: assetSource.uploadedByUserId ?? null,
      uploadedByName: assetSource.uploadedByName ?? null,
      updatedAt: assetSource.updatedAt ?? null,
      assetPreviewStatus: assetSource.assetPreviewStatus ?? null,
      assetPreviewError: assetSource.assetPreviewError ?? null,
    };
    if (!seen.has(`asset:${source.sourceId}`)) {
      resolved.push(buildEligibleArtworkSource(source, {
        publicSourceType: "line_item_asset",
        role: assetSource.role ?? null,
      }));
      seen.add(`asset:${source.sourceId}`);
    }
  }

  const lineItemFileSources = await tx
    .select({
      sourceId: lineItemFiles.id,
      orderId: lineItemFiles.orderId,
      orderLineItemId: lineItemFiles.lineItemId,
      fileRecordId: lineItemFiles.fileRecordId,
      fileName: lineItemFiles.originalFilename,
      fileUrl: lineItemFiles.storageKey,
      mimeType: lineItemFiles.mimeType,
      sizeBytes: lineItemFiles.sizeBytes,
      relativePath: lineItemFiles.storagePath,
      storageProvider: lineItemFiles.storageBucket,
      role: lineItemFiles.role,
      updatedAt: lineItemFiles.createdAt,
    })
    .from(lineItemFiles)
    .where(
      and(
        eq(lineItemFiles.organizationId, args.organizationId),
        eq(lineItemFiles.lineItemId, args.lineItemId),
        eq(lineItemFiles.status, "active"),
        inArray(lineItemFiles.role, ["original", "reference"]),
      ),
    )
    .orderBy(sql`case when ${lineItemFiles.role} = 'original' then 0 else 1 end`, desc(lineItemFiles.createdAt));

  for (const lineItemFile of lineItemFileSources) {
    const source: ArtworkProofSource = {
      sourceType: "line_item_file",
      sourceId: lineItemFile.sourceId,
      orderId: lineItemFile.orderId,
      orderLineItemId: lineItemFile.orderLineItemId,
      fileRecordId: lineItemFile.fileRecordId ?? null,
      fileName: lineItemFile.fileName,
      fileUrl: lineItemFile.fileUrl ?? lineItemFile.relativePath ?? null,
      fileSize: lineItemFile.sizeBytes ?? null,
      sizeBytes: lineItemFile.sizeBytes ?? null,
      mimeType: lineItemFile.mimeType ?? null,
      description: null,
      originalFilename: lineItemFile.fileName,
      storedFilename: null,
      relativePath: lineItemFile.relativePath ?? null,
      storageProvider: lineItemFile.storageProvider ?? null,
      extension: null,
      checksum: null,
      thumbKey: null,
      previewKey: lineItemFile.fileRecordId ? null : (lineItemFile.fileUrl ?? lineItemFile.relativePath ?? null),
      thumbStatus: null,
      thumbError: null,
      thumbnailRelativePath: null,
      thumbnailGeneratedAt: null,
      thumbnailUrl: null,
      uploadedByUserId: null,
      uploadedByName: null,
      updatedAt: lineItemFile.updatedAt ?? null,
    };
    if (!seen.has(`line-item-file:${source.sourceId}`)) {
      resolved.push(buildEligibleArtworkSource(source, {
        publicSourceType: "line_item_file",
        role: lineItemFile.role ?? null,
      }));
      seen.add(`line-item-file:${source.sourceId}`);
    }
  }

  return resolved;
}

export async function listEligibleProofArtworkSources(tx: any, args: {
  organizationId: string;
  lineItemId: string;
}): Promise<EligibleProofArtworkSource[]> {
  const rows = await resolveEligibleProofArtworkSourceRows(tx, args);
  return rows.map(({ artworkSource: _artworkSource, ...publicSource }) => publicSource);
}

async function loadLatestArtworkProofSource(tx: any, args: {
  organizationId: string;
  lineItemId: string;
  selectedSourceIds?: string[] | null;
}): Promise<ArtworkProofSource | null> {
  const sources = await resolveEligibleProofArtworkSourceRows(tx, args);
  const selectedIds = new Set((args.selectedSourceIds ?? []).map((id) => String(id || "").trim()).filter(Boolean));
  if (selectedIds.size > 0) {
    return sources.find((source) => source.eligible && source.artworkSource && selectedIds.has(source.id))?.artworkSource ?? null;
  }
  return sources.find((source) => source.eligible && source.artworkSource)?.artworkSource ?? null;
}

export async function generateLineItemArtworkPreviewDerivative(tx: any, args: {
  organizationId: string;
  lineItemId: string;
}): Promise<PreviewDerivativeGenerationResult> {
  const source = await loadLatestArtworkProofSource(tx, args);

  if (!source) {
    throwProofingBadRequest("No artwork file is attached to this line item.");
  }

  if (sourceHasUsablePreviewDerivative(source)) {
    return {
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      derivativeStatus: "ready",
      previewStatus: "ready",
      sourceFileName: source.fileName,
      message: "Preview already exists.",
    };
  }

  if (source.sourceType === "asset") {
    const asset = await assetRepository.getAssetById(args.organizationId, source.sourceId);
    if (!asset) {
      throwProofingBadRequest("No artwork file is attached to this line item.");
    }

    await assetPreviewGenerator.generatePreviews(asset);

    const refreshedSource = await loadLatestArtworkProofSource(tx, args);
    if (sourceHasUsablePreviewDerivative(refreshedSource)) {
      return {
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        derivativeStatus: "ready",
        previewStatus: "ready",
        sourceFileName: refreshedSource?.fileName || source.fileName,
        message: "Preview generated successfully.",
      };
    }

    if (refreshedSource?.assetPreviewStatus === "pending") {
      return {
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        derivativeStatus: "pending",
        previewStatus: "missing_preview",
        sourceFileName: refreshedSource.fileName,
        message: "Preview generation started. Refresh proofing in a moment to continue.",
      };
    }

    throwProofingConflict(buildAssetPreviewGenerationFailureMessage(refreshedSource || source));
  }

  const storageKey = source.relativePath || source.fileUrl || "";
  const storageProvider = source.storageProvider || "local";
  const fileName = source.originalFilename || source.fileName || null;

  if (isPdfCompatibleArtworkMime(source.mimeType)) {
    await processPdfAttachmentDerivedData({
      orgId: args.organizationId,
      attachmentId: source.sourceId,
      storageKey,
      storageProvider,
      mimeType: source.mimeType,
      attachmentType: "order",
    });
  } else if (isSupportedImageType(source.mimeType, fileName)) {
    const sharpReady = await ensureSharp();
    if (!sharpReady) {
      throwProofingConflict(buildPreviewGenerationUnavailableMessage(source));
    }

    await generateImageDerivatives(
      source.sourceId,
      "order",
      storageKey,
      source.mimeType,
      storageProvider,
      args.organizationId,
      fileName,
    );
  } else {
    throwProofingConflict(`Preview generation failed. Unsupported artwork type: ${source.fileName}.`);
  }

  const refreshedSource = await loadLatestArtworkProofSource(tx, args);
  if (sourceHasUsablePreviewDerivative(refreshedSource)) {
    return {
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      derivativeStatus: "ready",
      previewStatus: "ready",
      sourceFileName: refreshedSource?.fileName || source.fileName,
      message: "Preview generated successfully.",
    };
  }

  if (refreshedSource?.thumbStatus === "thumb_pending") {
    return {
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      derivativeStatus: "pending",
      previewStatus: "missing_preview",
      sourceFileName: refreshedSource.fileName,
      message: "Preview generation started. Refresh proofing in a moment to continue.",
    };
  }

  throwProofingConflict(buildAttachmentPreviewGenerationFailureMessage(refreshedSource || source));
}

async function ensureProofAttachmentForSource(tx: any, args: {
  organizationId: string;
  lineItemId: string;
  source: ArtworkProofSource;
}): Promise<string> {
  const matchingWhere = args.source.fileRecordId
    ? and(
        eq(orderAttachments.orderId, args.source.orderId),
        eq(orderAttachments.orderLineItemId, args.lineItemId),
        eq(orderAttachments.role, "proof"),
        eq(orderAttachments.fileRecordId, args.source.fileRecordId),
      )
    : and(
        eq(orderAttachments.orderId, args.source.orderId),
        eq(orderAttachments.orderLineItemId, args.lineItemId),
        eq(orderAttachments.role, "proof"),
        eq(orderAttachments.fileUrl, args.source.fileUrl ?? ""),
      );

  const [existing] = await tx
    .select({ id: orderAttachments.id })
    .from(orderAttachments)
    .where(matchingWhere)
    .orderBy(desc(orderAttachments.updatedAt), desc(orderAttachments.createdAt))
    .limit(1);

  if (existing) {
    return existing.id;
  }

  const [created] = await tx
    .insert(orderAttachments)
    .values({
      orderId: args.source.orderId,
      orderLineItemId: args.lineItemId,
      fileRecordId: args.source.fileRecordId,
      uploadedByUserId: args.source.uploadedByUserId,
      uploadedByName: args.source.uploadedByName,
      fileName: args.source.fileName,
      fileUrl: args.source.fileUrl,
      fileSize: args.source.fileSize,
      mimeType: args.source.mimeType,
      description: args.source.description,
      originalFilename: args.source.originalFilename,
      storedFilename: args.source.storedFilename,
      relativePath: args.source.relativePath,
      storageProvider: args.source.storageProvider as any,
      extension: args.source.extension,
      sizeBytes: args.source.sizeBytes,
      checksum: args.source.checksum,
      thumbnailRelativePath: args.source.thumbnailRelativePath,
      thumbnailGeneratedAt: args.source.thumbnailGeneratedAt,
      thumbKey: args.source.thumbKey,
      previewKey: args.source.previewKey,
      thumbnailUrl: args.source.thumbnailUrl,
      role: "proof",
      side: "na",
      isPrimary: true,
      updatedAt: new Date(),
    })
    .returning({ id: orderAttachments.id });

  return created.id;
}

async function ensureProofAttachmentForExistingAttachment(tx: any, args: {
  organizationId: string;
  lineItemId: string;
  attachmentId: string;
}): Promise<string> {
  const lineItem = await loadProofLineItem(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
  });

  const [attachment] = await tx
    .select({
      sourceId: orderAttachments.id,
      orderId: orderAttachments.orderId,
      orderLineItemId: orderAttachments.orderLineItemId,
      role: orderAttachments.role,
      fileRecordId: orderAttachments.fileRecordId,
      fileName: orderAttachments.fileName,
      fileUrl: orderAttachments.fileUrl,
      fileSize: orderAttachments.fileSize,
      sizeBytes: orderAttachments.sizeBytes,
      mimeType: orderAttachments.mimeType,
      description: orderAttachments.description,
      originalFilename: orderAttachments.originalFilename,
      storedFilename: orderAttachments.storedFilename,
      relativePath: orderAttachments.relativePath,
      storageProvider: orderAttachments.storageProvider,
      extension: orderAttachments.extension,
      checksum: orderAttachments.checksum,
      thumbKey: orderAttachments.thumbKey,
      previewKey: orderAttachments.previewKey,
      thumbStatus: orderAttachments.thumbStatus,
      thumbError: orderAttachments.thumbError,
      thumbnailRelativePath: orderAttachments.thumbnailRelativePath,
      thumbnailGeneratedAt: orderAttachments.thumbnailGeneratedAt,
      thumbnailUrl: orderAttachments.thumbnailUrl,
      uploadedByUserId: orderAttachments.uploadedByUserId,
      uploadedByName: orderAttachments.uploadedByName,
      updatedAt: orderAttachments.updatedAt,
    })
    .from(orderAttachments)
    .innerJoin(orders, eq(orderAttachments.orderId, orders.id))
    .where(and(eq(orderAttachments.id, args.attachmentId), eq(orders.organizationId, args.organizationId)))
    .limit(1);

  if (!attachment) {
    throw Object.assign(new Error("Proof source file not found"), { statusCode: 404 });
  }

  if (attachment.orderId !== lineItem.orderId) {
    throwProofingConflict("Proof source file does not belong to the target order");
  }

  if (attachment.orderLineItemId && attachment.orderLineItemId !== lineItem.lineItemId) {
    throwProofingConflict("Proof source file belongs to a different line item");
  }

  if (String(attachment.role || "") === "proof" && attachment.orderLineItemId === lineItem.lineItemId) {
    return attachment.sourceId;
  }

  if (!["artwork", "attachment", "reference", "proof"].includes(String(attachment.role || ""))) {
    throwProofingConflict("Selected file is not eligible for proof draft creation");
  }

  return ensureProofAttachmentForSource(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
    source: {
      sourceType: "attachment",
      sourceId: attachment.sourceId,
      orderId: attachment.orderId,
      orderLineItemId: lineItem.lineItemId,
      fileRecordId: attachment.fileRecordId ?? null,
      fileName: attachment.fileName,
      fileUrl: attachment.fileUrl ?? null,
      fileSize: attachment.fileSize ?? null,
      sizeBytes: attachment.sizeBytes ?? null,
      mimeType: attachment.mimeType ?? null,
      description: attachment.description ?? null,
      originalFilename: attachment.originalFilename ?? null,
      storedFilename: attachment.storedFilename ?? null,
      relativePath: attachment.relativePath ?? null,
      storageProvider: attachment.storageProvider ?? null,
      extension: attachment.extension ?? null,
      checksum: attachment.checksum ?? null,
      thumbKey: attachment.thumbKey ?? null,
      previewKey: attachment.previewKey ?? null,
      thumbStatus: attachment.thumbStatus ?? null,
      thumbError: attachment.thumbError ?? null,
      thumbnailRelativePath: attachment.thumbnailRelativePath ?? null,
      thumbnailGeneratedAt: attachment.thumbnailGeneratedAt ?? null,
      thumbnailUrl: attachment.thumbnailUrl ?? null,
      uploadedByUserId: attachment.uploadedByUserId ?? null,
      uploadedByName: attachment.uploadedByName ?? null,
      updatedAt: attachment.updatedAt ?? null,
    },
  });
}

export async function createLineItemProofVersionFromExistingAttachment(tx: any, args: {
  organizationId: string;
  lineItemId: string;
  attachmentId: string;
  createdByUserId: string;
  internalNotes?: string | null;
}) {
  const proofFileId = await ensureProofAttachmentForExistingAttachment(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
    attachmentId: args.attachmentId,
  });

  return createLineItemProofVersion(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
    proofFileId,
    createdByUserId: args.createdByUserId,
    internalNotes: args.internalNotes ?? null,
    sourceAction: proofFileId === args.attachmentId ? null : "proof_file_uploaded",
  });
}

async function invalidateApprovedProofContext(tx: any, args: {
  organizationId: string;
  orderId: string;
  lineItemId: string;
  actorUserId?: string | null;
  reason: ProofSyncReason;
}) {
  await supersedeActionableProofVersions(tx, {
    organizationId: args.organizationId,
    orderId: args.orderId,
    lineItemId: args.lineItemId,
    actorUserId: args.actorUserId ?? null,
    reason: args.reason,
  });

  await tx
    .update(orderLineItems)
    .set({
      approvedProofVersionId: null,
      updatedAt: new Date(),
    })
    .where(eq(orderLineItems.id, args.lineItemId));

}

export async function autoSyncCanonicalProofForLineItem(tx: any, args: {
  organizationId: string;
  lineItemId: string;
  actorUserId: string;
  reason: ProofSyncReason;
}): Promise<AutoSyncProofResult> {
  const lineItem = await loadProofLineItem(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
  });
  assertProofOrderNotCancelled(lineItem);

  if (!lineItem.requiresProofApproval) {
    return { status: "not_required" };
  }

  const source = await loadLatestArtworkProofSource(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
  });

  const truth = await resolveLineItemProofingTruth(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
  });

  if (!source) {
    if (truth.approvedProofVersionId || truth.currentActionableProofVersionId) {
      await invalidateApprovedProofContext(tx, {
        organizationId: args.organizationId,
        orderId: lineItem.orderId,
        lineItemId: args.lineItemId,
        actorUserId: args.actorUserId,
        reason: args.reason,
      });

      const currentWorkflowState = String(lineItem.workflowState || "").trim().toLowerCase();
      const proofPendingTarget =
        lineItem.requiresPrepress && (currentWorkflowState === "ready_for_prepress" || currentWorkflowState === "in_prepress")
          ? (currentWorkflowState as any)
          : "awaiting_proof_approval";

      if (lineItem.workflowState !== proofPendingTarget) {
        const workflowTransition = await transitionLineItemWorkflowState(tx, {
          organizationId: args.organizationId,
          lineItemId: args.lineItemId,
          toState: proofPendingTarget,
          actorUserId: args.actorUserId,
          metadata: {
            source: "proofing_auto_sync_missing_artwork",
            reason: args.reason,
          },
        });

        logProofAutoSync("invalidated_without_source", {
          organizationId: args.organizationId,
          lineItemId: args.lineItemId,
          reason: args.reason,
          toState: workflowTransition.toState,
        });

        return { status: "invalidated", toState: workflowTransition.toState };
      }

      logProofAutoSync("invalidated_without_source", {
        organizationId: args.organizationId,
        lineItemId: args.lineItemId,
        reason: args.reason,
        toState: lineItem.workflowState,
      });

      return { status: "invalidated", toState: lineItem.workflowState };
    }

    return { status: "no_source" };
  }

  const proofFileId = await ensureProofAttachmentForSource(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
    source,
  });

  const currentRelevantVersionId = truth.currentActionableProofVersionId || truth.approvedProofVersionId;
  const currentRelevantVersion = currentRelevantVersionId
    ? truth.proofVersionHistory.find((version) => version.id === currentRelevantVersionId) ?? null
    : null;

  if (currentRelevantVersion?.proofFileId === proofFileId) {
    return { status: "already_current" };
  }

  await invalidateApprovedProofContext(tx, {
    organizationId: args.organizationId,
    orderId: lineItem.orderId,
    lineItemId: args.lineItemId,
    actorUserId: args.actorUserId,
    reason: args.reason,
  });

  const proofVersion = await createLineItemProofVersion(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
    proofFileId,
    createdByUserId: args.actorUserId,
    internalNotes: `Auto-synced from persisted artwork (${args.reason})`,
  });

  const sendResult = await markProofVersionSent(tx, {
    organizationId: args.organizationId,
    proofVersionId: proofVersion.id,
    actorUserId: args.actorUserId,
    sentToName: null,
    sentToEmail: null,
    customerMessage: null,
  });

  logProofAutoSync(currentRelevantVersion ? "refreshed" : "created", {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
    reason: args.reason,
    proofVersionId: proofVersion.id,
    proofFileId,
    workflowToState: sendResult.workflowTransition.toState,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
  });

  return {
    status: currentRelevantVersion ? "refreshed" : "created",
    proofVersionId: proofVersion.id,
    proofFileId,
    toState: sendResult.workflowTransition.toState,
  };
}

function normalizeProofingQueueSlice(value: unknown): ProofQueueSlice {
  const normalized = String(value ?? "all").trim().toLowerCase();
  if (
    normalized === "awaiting_send" ||
    normalized === "awaiting_approval" ||
    normalized === "revision_requested" ||
    normalized === "approved"
  ) {
    return normalized;
  }

  return "all";
}

function deriveProofingQueueStatus(truth: ProofingReadModel): ProofQueueStatus {
  if (truth.approvedByOverride) return "approved_by_override";
  if (truth.approvedProofVersionId) return "approved";

  if (truth.currentActionableProofVersion?.status === "awaiting_response") {
    return "awaiting_approval";
  }

  if (truth.currentActionableProofVersion?.status === "draft") {
    return "awaiting_send";
  }

  const latestDecision = truth.proofDecisionHistory[0]?.decision ?? null;
  if (latestDecision === "revision_requested") {
    return "revision_requested";
  }

  if (latestDecision === "rejected") {
    return "rejected";
  }

  return "no_active_proof";
}

function deriveProofingQueueBadge(status: ProofQueueStatus): string {
  switch (status) {
    case "awaiting_send":
      return "Awaiting Send";
    case "awaiting_approval":
      return "Awaiting Approval";
    case "revision_requested":
      return "Revision Requested";
    case "approved":
      return "Approved";
    case "approved_by_override":
      return "Approved by Override";
    case "rejected":
      return "Rejected";
    default:
      return "No Active Proof";
  }
}

export async function cancelProofVersion(tx: any, args: {
  organizationId: string;
  proofVersionId: string;
  actorUserId: string;
  reason?: string | null;
}) {
  try {
    const proofVersion = await loadProofVersion(tx, {
      organizationId: args.organizationId,
      proofVersionId: args.proofVersionId,
    });

    if (proofVersion.status === "approved" || proofVersion.status === "rejected" || proofVersion.status === "revision_requested") {
      throwProofingBadRequest("Resolved proof versions cannot be cancelled from this workflow.");
    }

    if (proofVersion.status === "draft") {
      const [updatedDraft] = await tx
        .update(lineItemProofVersions)
        .set({
          status: "cancelled",
          updatedAt: new Date(),
        })
        .where(eq(lineItemProofVersions.id, proofVersion.id))
        .returning();

      const lineItem = await loadProofLineItem(tx, {
        organizationId: args.organizationId,
        lineItemId: proofVersion.lineItemId,
      });

      await appendProofingEvent(tx, {
        organizationId: args.organizationId,
        orderId: proofVersion.orderId,
        lineItemId: proofVersion.lineItemId,
        eventType: "proof_draft_cancelled",
        actorUserId: args.actorUserId,
        payload: {
          proofVersionId: proofVersion.id,
          versionNumber: proofVersion.versionNumber,
          previousProofStatus: proofVersion.status,
          newProofStatus: updatedDraft.status,
          reason: trimNullable(args.reason),
        },
      });

      return {
        proofVersion: updatedDraft,
        lineItem,
        workflowTransition: null,
      };
    }

    if (proofVersion.status !== "awaiting_response") {
      const statusLabel = proofVersion.status === "superseded" ? "superseded" : proofVersion.status;
      throwProofingBadRequest(`Only active sent proof versions can be cancelled. Current status: ${statusLabel}.`);
    }

    const lineItem = await loadProofLineItem(tx, {
      organizationId: args.organizationId,
      lineItemId: proofVersion.lineItemId,
    });

    const [updatedVersion] = await tx
      .update(lineItemProofVersions)
      .set({
        status: "cancelled",
        updatedAt: new Date(),
      })
      .where(eq(lineItemProofVersions.id, proofVersion.id))
      .returning();

    await tx
      .update(orderLineItems)
      .set({
        approvedProofVersionId: null,
        requiresProofApproval: true,
        updatedAt: new Date(),
      })
      .where(eq(orderLineItems.id, lineItem.lineItemId));

    let workflowTransition: Awaited<ReturnType<typeof transitionLineItemWorkflowState>> | null = null;
    const currentWorkflowState = String(lineItem.workflowState || "").trim().toLowerCase();
    const proofPendingTarget =
      lineItem.requiresPrepress && (currentWorkflowState === "ready_for_prepress" || currentWorkflowState === "in_prepress")
        ? (currentWorkflowState as any)
        : "awaiting_proof_approval";

    if (lineItem.workflowState !== proofPendingTarget) {
      workflowTransition = await transitionLineItemWorkflowState(tx, {
        organizationId: args.organizationId,
        lineItemId: lineItem.lineItemId,
        toState: proofPendingTarget,
        actorUserId: args.actorUserId,
        metadata: {
          source: "proofing_cancel_version",
          proofVersionId: proofVersion.id,
          versionNumber: proofVersion.versionNumber,
        },
      });
    }

    await appendProofingEvent(tx, {
      organizationId: args.organizationId,
      orderId: proofVersion.orderId,
      lineItemId: proofVersion.lineItemId,
      eventType: "proof_version_cancelled",
      actorUserId: args.actorUserId,
      payload: {
        proofVersionId: proofVersion.id,
        versionNumber: proofVersion.versionNumber,
        previousProofStatus: proofVersion.status,
        newProofStatus: updatedVersion.status,
        workflowToState: workflowTransition?.toState ?? lineItem.workflowState,
        reason: trimNullable(args.reason),
      },
    });

    return {
      proofVersion: updatedVersion,
      lineItem,
      workflowTransition,
    };
  } catch (error: any) {
    normalizeProofingWriteError(error);
  }
}

function matchesProofingQueueSlice(status: ProofQueueStatus, slice: ProofQueueSlice): boolean {
  if (slice === "all") return true;
  if (slice === "approved") return status === "approved" || status === "approved_by_override";
  return status === slice;
}

function isProofRelevantTruth(truth: ProofingReadModel): boolean {
  return (
    truth.requiresProofApproval ||
    truth.approvedProofVersionId !== null ||
    truth.proofVersionHistory.length > 0 ||
    truth.proofDecisionHistory.length > 0 ||
    truth.manualApprovalOverrideHistory.length > 0 ||
    truth.workflowState === "awaiting_proof_approval"
  );
}

async function appendProofingEvent(tx: any, args: {
  organizationId: string;
  orderId: string;
  lineItemId: string;
  eventType: string;
  actorUserId?: string | null;
  payload?: Record<string, unknown>;
}) {
  const payload = args.payload ?? {};
  const note = trimNullable(
    typeof payload.note === "string"
      ? payload.note
      : typeof payload.reason === "string"
        ? payload.reason
        : typeof payload.responseNotes === "string"
          ? payload.responseNotes
          : typeof payload.internalNotes === "string"
            ? payload.internalNotes
            : typeof payload.internalNote === "string"
              ? payload.internalNote
              : null,
  );

  await tx.insert(orderAuditLog).values({
    orderId: args.orderId,
    orderLineItemId: args.lineItemId,
    userId: args.actorUserId ?? null,
    actionType: args.eventType,
    fromStatus: typeof payload.previousProofStatus === "string" ? payload.previousProofStatus : null,
    toStatus: typeof payload.newProofStatus === "string" ? payload.newProofStatus : null,
    note,
    metadata: {
      orderId: args.orderId,
      orderLineItemId: args.lineItemId,
      actorUserId: args.actorUserId ?? null,
      ...payload,
    },
  } as any);
}

async function loadProofVersion(tx: any, args: { organizationId: string; proofVersionId: string }) {
  const [row] = await tx
    .select({
      id: lineItemProofVersions.id,
      organizationId: lineItemProofVersions.organizationId,
      orderId: lineItemProofVersions.orderId,
      lineItemId: lineItemProofVersions.lineItemId,
      proofFileId: lineItemProofVersions.proofFileId,
      versionNumber: lineItemProofVersions.versionNumber,
      status: lineItemProofVersions.status,
      customerMessage: lineItemProofVersions.customerMessage,
      sentToName: lineItemProofVersions.sentToName,
      sentToEmail: lineItemProofVersions.sentToEmail,
      sentAt: lineItemProofVersions.sentAt,
      internalNotes: lineItemProofVersions.internalNotes,
    })
    .from(lineItemProofVersions)
    .where(and(eq(lineItemProofVersions.organizationId, args.organizationId), eq(lineItemProofVersions.id, args.proofVersionId)))
    .limit(1);

  if (!row) {
    throw Object.assign(new Error("Proof version not found"), { statusCode: 404 });
  }

  return row;
}

async function resolveProofingTruthMap(tx: any, args: {
  organizationId: string;
  lineItems: LoadedProofLineItem[];
}): Promise<Map<string, ProofingReadModel>> {
  const truthMap = new Map<string, ProofingReadModel>();
  const lineItemIds = args.lineItems.map((lineItem) => lineItem.lineItemId);

  if (lineItemIds.length === 0) {
    return truthMap;
  }

  const rawVersions = await tx
    .select({
      id: lineItemProofVersions.id,
      lineItemId: lineItemProofVersions.lineItemId,
      proofFileId: lineItemProofVersions.proofFileId,
      versionNumber: lineItemProofVersions.versionNumber,
      status: lineItemProofVersions.status,
      sentAt: lineItemProofVersions.sentAt,
      createdAt: lineItemProofVersions.createdAt,
      updatedAt: lineItemProofVersions.updatedAt,
      sentToName: lineItemProofVersions.sentToName,
      sentToEmail: lineItemProofVersions.sentToEmail,
    })
    .from(lineItemProofVersions)
    .where(and(eq(lineItemProofVersions.organizationId, args.organizationId), inArray(lineItemProofVersions.lineItemId, lineItemIds)))
    .orderBy(desc(lineItemProofVersions.versionNumber), desc(lineItemProofVersions.createdAt));

  const rawApprovals = await tx
    .select({
      id: lineItemProofApprovals.id,
      lineItemId: lineItemProofApprovals.lineItemId,
      proofVersionId: lineItemProofApprovals.proofVersionId,
      decision: lineItemProofApprovals.decision,
      responseNotes: lineItemProofApprovals.responseNotes,
      responderName: lineItemProofApprovals.responderName,
      responderEmail: lineItemProofApprovals.responderEmail,
      responderSource: lineItemProofApprovals.responderSource,
      respondedAt: lineItemProofApprovals.respondedAt,
      createdAt: lineItemProofApprovals.createdAt,
    })
    .from(lineItemProofApprovals)
    .where(and(eq(lineItemProofApprovals.organizationId, args.organizationId), inArray(lineItemProofApprovals.lineItemId, lineItemIds)))
    .orderBy(desc(lineItemProofApprovals.respondedAt), desc(lineItemProofApprovals.createdAt));

  const rawManualOverrides = await tx
    .select({
      id: lineItemProofManualApprovalOverrides.id,
      orderId: lineItemProofManualApprovalOverrides.orderId,
      lineItemId: lineItemProofManualApprovalOverrides.lineItemId,
      proofVersionId: lineItemProofManualApprovalOverrides.proofVersionId,
      source: lineItemProofManualApprovalOverrides.source,
      overrideReason: lineItemProofManualApprovalOverrides.overrideReason,
      internalNote: lineItemProofManualApprovalOverrides.internalNote,
      actorUserId: lineItemProofManualApprovalOverrides.actorUserId,
      actorName: lineItemProofManualApprovalOverrides.actorName,
      actorEmail: lineItemProofManualApprovalOverrides.actorEmail,
      overriddenAt: lineItemProofManualApprovalOverrides.overriddenAt,
      createdAt: lineItemProofManualApprovalOverrides.createdAt,
    })
    .from(lineItemProofManualApprovalOverrides)
    .where(
      and(
        eq(lineItemProofManualApprovalOverrides.organizationId, args.organizationId),
        inArray(lineItemProofManualApprovalOverrides.lineItemId, lineItemIds),
      ),
    )
    .orderBy(desc(lineItemProofManualApprovalOverrides.overriddenAt), desc(lineItemProofManualApprovalOverrides.createdAt));

  const versionsByLineItem = new Map<string, ProofVersionHistoryEntry[]>();
  for (const version of rawVersions) {
    const bucket = versionsByLineItem.get(version.lineItemId) ?? [];
    bucket.push({
      id: version.id,
      proofFileId: version.proofFileId,
      versionNumber: version.versionNumber,
      status: version.status,
      sentAt: toIsoString(version.sentAt),
      createdAt: toIsoString(version.createdAt)!,
      updatedAt: toIsoString(version.updatedAt)!,
      sentToName: version.sentToName ?? null,
      sentToEmail: version.sentToEmail ?? null,
    });
    versionsByLineItem.set(version.lineItemId, bucket);
  }

  const approvalsByLineItem = new Map<string, ProofDecisionHistoryEntry[]>();
  for (const approval of rawApprovals) {
    const bucket = approvalsByLineItem.get(approval.lineItemId) ?? [];
    bucket.push({
      id: approval.id,
      proofVersionId: approval.proofVersionId,
      decision: approval.decision,
      responseNotes: approval.responseNotes ?? null,
      responderName: approval.responderName ?? null,
      responderEmail: approval.responderEmail ?? null,
      responderSource: approval.responderSource ?? null,
      respondedAt: toIsoString(approval.respondedAt)!,
    });
    approvalsByLineItem.set(approval.lineItemId, bucket);
  }

  const manualOverridesByLineItem = new Map<string, ManualApprovalOverrideHistoryEntry[]>();
  for (const override of rawManualOverrides) {
    const bucket = manualOverridesByLineItem.get(override.lineItemId) ?? [];
    bucket.push({
      id: override.id,
      orderId: override.orderId,
      lineItemId: override.lineItemId,
      proofVersionId: override.proofVersionId,
      source: "manual_override",
      overrideReason: override.overrideReason,
      internalNote: override.internalNote ?? null,
      actorUserId: override.actorUserId ?? null,
      actorName: override.actorName ?? null,
      actorEmail: override.actorEmail ?? null,
      overriddenAt: toIsoString(override.overriddenAt)!,
    });
    manualOverridesByLineItem.set(override.lineItemId, bucket);
  }

  for (const lineItem of args.lineItems) {
    const versions = versionsByLineItem.get(lineItem.lineItemId) ?? [];
    const approvals = approvalsByLineItem.get(lineItem.lineItemId) ?? [];
    const manualOverrides = manualOverridesByLineItem.get(lineItem.lineItemId) ?? [];
    const currentActionableProofVersion = versions.find((version) => isActionableProofStatus(version.status)) ?? null;
    const approvedProofVersion = lineItem.approvedProofVersionId
      ? versions.find((version) => version.id === lineItem.approvedProofVersionId) ?? null
      : null;
    const approvedNormalDecision = lineItem.approvedProofVersionId
      ? approvals.find(
          (approval) => approval.proofVersionId === lineItem.approvedProofVersionId && approval.decision === "approved",
        ) ?? null
      : null;
    const approvedManualOverride = lineItem.approvedProofVersionId
      ? manualOverrides.find((override) => override.proofVersionId === lineItem.approvedProofVersionId) ?? null
      : null;
    const approvedProofSource: ProofApprovalSource | null = approvedManualOverride
      ? "manual_override"
      : approvedNormalDecision
        ? "normal"
        : null;
    const approvalIdsByVersionId = new Map(approvals.map((approval) => [approval.proofVersionId, approval.id]));
    const currentActionableProofVersionId = currentActionableProofVersion?.id ?? null;
    const currentActionableProofDecisionId = currentActionableProofVersionId
      ? approvalIdsByVersionId.get(currentActionableProofVersionId) ?? null
      : null;

    truthMap.set(lineItem.lineItemId, {
      lineItemId: lineItem.lineItemId,
      orderId: lineItem.orderId,
      workflowState: normalizeProofingWorkflowState(lineItem.workflowState),
      requiresProofApproval: lineItem.requiresProofApproval,
      approvedProofVersionId: lineItem.approvedProofVersionId,
      approvedProofDecisionId: approvedNormalDecision?.id ?? null,
      approvedProofSource,
      approvedNormally: approvedProofSource === "normal",
      approvedByOverride: approvedProofSource === "manual_override",
      currentActionableProofVersionId,
      currentActionableProofDecisionId,
      currentActionableProofVersion,
      approvedProofVersion,
      currentProofInputSnapshot: null,
      currentDisplayedProofArtifact: null,
      proofVersionHistory: versions,
      proofDecisionHistory: approvals,
      manualApprovalOverrideHistory: manualOverrides,
      blockedPendingProofApproval: isBlockedPendingProofApproval({
        workflowState: lineItem.workflowState,
        requiresProofApproval: lineItem.requiresProofApproval,
        approvedProofVersionId: lineItem.approvedProofVersionId,
        currentActionableProofVersion,
      }),
    });
  }

  return truthMap;
}

function buildProofingQueueRow(base: LoadedProofQueueLineItem, truth: ProofingReadModel): ProofingQueueRow {
  const currentQueueStatus = deriveProofingQueueStatus(truth);
  const currentDisplayedProofVersion = truth.currentActionableProofVersion ?? truth.approvedProofVersion ?? truth.proofVersionHistory[0] ?? null;

  return {
    lineItemId: base.lineItemId,
    orderId: base.orderId,
    orderNumber: base.orderNumber,
    customerDisplayName: base.customerDisplayName,
    lineItemLabel: base.lineItemLabel,
    packageLabel: base.packageLabel,
    workflowState: truth.workflowState,
    currentQueueStatus,
    currentQueueBadge: deriveProofingQueueBadge(currentQueueStatus),
    currentDisplayedProofVersionId: currentDisplayedProofVersion?.id ?? null,
    currentDisplayedProofVersionLabel: currentDisplayedProofVersion ? formatProofVersionLabel(currentDisplayedProofVersion.versionNumber) : null,
    currentDisplayedProofVersionStatus: currentDisplayedProofVersion?.status ?? null,
    approvedProofVersionId: truth.approvedProofVersionId,
    approvedProofSource: truth.approvedProofSource,
    approvedNormally: truth.approvedNormally,
    approvedByOverride: truth.approvedByOverride,
    lastDecision: truth.proofDecisionHistory[0]?.decision ?? null,
    lastActivityAt: maxIsoTimestamp([
      toIsoString(base.updatedAt),
      truth.proofVersionHistory[0]?.updatedAt ?? null,
      truth.proofDecisionHistory[0]?.respondedAt ?? null,
      truth.manualApprovalOverrideHistory[0]?.overriddenAt ?? null,
    ]),
    blockedPendingProofApproval: truth.blockedPendingProofApproval,
    hasApprovedProof: truth.approvedProofVersionId !== null,
    requiresProofApproval: truth.requiresProofApproval,
    requiresPrepress: base.requiresPrepress,
    activeOwnerJobId: base.activeOwnerJobId ?? null,
    activeOwnerStationKey: base.activeOwnerStationKey ?? null,
    activeOwnerStepKey: base.activeOwnerStepKey ?? null,
    productionJobId: base.productionJobId ?? null,
    proofCount: truth.proofVersionHistory.length,
  };
}

function assertProofOrderNotCancelled(lineItem: LoadedProofLineItem): void {
  if (isCanceledOrder({
    state: lineItem.orderState,
    status: lineItem.orderStatus,
    canceledAt: lineItem.orderCanceledAt,
  })) {
    throwProofingConflict("Cancelled orders cannot advance proof approval workflow");
  }
}

export async function listProofingQueue(tx: any, args: {
  organizationId: string;
  slice?: ProofQueueSlice | null;
}): Promise<ProofingQueueResponse> {
  const slice = normalizeProofingQueueSlice(args.slice);

  const queueBaseRows: LoadedProofQueueLineItem[] = await tx
    .select({
      lineItemId: orderLineItems.id,
      orderId: orderLineItems.orderId,
      organizationId: orders.organizationId,
      orderNumber: orders.orderNumber,
      customerDisplayName: customers.companyName,
      lineItemLabel: orderLineItems.description,
      packageLabel: orderLineItems.description,
      workflowState: orderLineItems.workflowState,
      requiresPrepress: orderLineItems.requiresPrepress,
      requiresProofApproval: orderLineItems.requiresProofApproval,
      approvedProofVersionId: orderLineItems.approvedProofVersionId,
      updatedAt: orderLineItems.updatedAt,
    })
    .from(orderLineItems)
    .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .where(
      and(
        eq(orders.organizationId, args.organizationId),
        notInArray(orders.state, ["closed", "canceled", "production_complete"]),
        or(
          eq(orderLineItems.requiresProofApproval, true),
          isNotNull(orderLineItems.approvedProofVersionId),
          eq(orderLineItems.workflowState, "awaiting_proof_approval"),
          sql`exists (
            select 1
            from line_item_proof_versions proof_versions
            where proof_versions.organization_id = ${args.organizationId}
              and proof_versions.line_item_id = ${orderLineItems.id}
          )`,
          sql`exists (
            select 1
            from line_item_proof_approvals proof_approvals
            where proof_approvals.organization_id = ${args.organizationId}
              and proof_approvals.line_item_id = ${orderLineItems.id}
          )`,
          sql`exists (
            select 1
            from line_item_proof_manual_approval_overrides proof_overrides
            where proof_overrides.organization_id = ${args.organizationId}
              and proof_overrides.line_item_id = ${orderLineItems.id}
          )`,
        ),
      ),
    )
    .orderBy(desc(orderLineItems.updatedAt), desc(orders.updatedAt));

  const truthMap = await resolveProofingTruthMap(tx, {
    organizationId: args.organizationId,
    lineItems: queueBaseRows,
  });
  const activeOwnersByLineItem = await resolveActiveProductionOwners(tx, {
    organizationId: args.organizationId,
    lineItemIds: queueBaseRows.map((row) => row.lineItemId),
    debugLabel: "GET /api/proofing/queue",
  });
  const latestProductionJobRows = queueBaseRows.length > 0
    ? await tx
      .select({
        id: productionJobs.id,
        lineItemId: productionJobs.lineItemId,
      })
      .from(productionJobs)
      .where(and(
        eq(productionJobs.organizationId, args.organizationId),
        inArray(productionJobs.lineItemId, queueBaseRows.map((row) => row.lineItemId)),
        notInArray(productionJobs.status, ["void", "canceled", "cancelled"]),
      ))
      .orderBy(desc(productionJobs.updatedAt), desc(productionJobs.createdAt))
    : [];
  const latestProductionJobByLineItem = new Map<string, string>();
  for (const job of latestProductionJobRows) {
    if (!job.lineItemId || latestProductionJobByLineItem.has(job.lineItemId)) continue;
    latestProductionJobByLineItem.set(job.lineItemId, job.id);
  }

  const allRows = queueBaseRows
    .map((base) => {
      const truth = truthMap.get(base.lineItemId);
      if (!truth || !isProofRelevantTruth(truth)) {
        return null;
      }

      const activeOwner = activeOwnersByLineItem.get(base.lineItemId);
      return buildProofingQueueRow({
        ...base,
        activeOwnerJobId: activeOwner?.id ?? null,
        activeOwnerStationKey: activeOwner?.stationKey ?? null,
        activeOwnerStepKey: activeOwner?.stepKey ?? null,
        productionJobId: latestProductionJobByLineItem.get(base.lineItemId) ?? null,
      }, truth);
    })
    .filter((row): row is ProofingQueueRow => row !== null)
    .sort((left, right) => {
      const delta = new Date(right.lastActivityAt).getTime() - new Date(left.lastActivityAt).getTime();
      if (delta !== 0) return delta;
      return String(left.orderNumber ?? left.lineItemId).localeCompare(String(right.orderNumber ?? right.lineItemId), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });

  const counts: ProofingQueueCounts = {
    all: allRows.length,
    awaitingSend: allRows.filter((row) => row.currentQueueStatus === "awaiting_send").length,
    awaitingApproval: allRows.filter((row) => row.currentQueueStatus === "awaiting_approval").length,
    revisionRequested: allRows.filter((row) => row.currentQueueStatus === "revision_requested").length,
    approved: allRows.filter((row) => row.currentQueueStatus === "approved" || row.currentQueueStatus === "approved_by_override").length,
  };

  return {
    slice,
    counts,
    rows: allRows.filter((row) => matchesProofingQueueSlice(row.currentQueueStatus, slice)),
  };
}

export async function createLineItemProofVersion(tx: any, args: {
  organizationId: string;
  lineItemId: string;
  proofFileId: string;
  createdByUserId: string;
  internalNotes?: string | null;
  sourceAction?: "proof_file_uploaded" | "proof_file_generated" | null;
}) {
  try {
    const lineItem = await loadProofLineItem(tx, {
      organizationId: args.organizationId,
      lineItemId: args.lineItemId,
    });
    assertProofOrderNotCancelled(lineItem);

    const [attachment] = await tx
      .select({
        id: orderAttachments.id,
        orderId: orderAttachments.orderId,
        orderLineItemId: orderAttachments.orderLineItemId,
        role: orderAttachments.role,
      })
      .from(orderAttachments)
      .innerJoin(orders, eq(orderAttachments.orderId, orders.id))
      .where(and(eq(orderAttachments.id, args.proofFileId), eq(orders.organizationId, args.organizationId)))
      .limit(1);

    if (!attachment) {
      throw Object.assign(new Error("Proof file not found"), { statusCode: 404 });
    }

    if (attachment.orderId !== lineItem.orderId || attachment.orderLineItemId !== lineItem.lineItemId) {
      throwProofingConflict("Proof file does not belong to the target line item");
    }

    if (String(attachment.role || "") !== "proof") {
      throwProofingConflict("Order attachment must have role=proof before creating a proof version");
    }

    const [blockingVersion] = await tx
      .select({ id: lineItemProofVersions.id })
      .from(lineItemProofVersions)
      .where(
        and(
          eq(lineItemProofVersions.organizationId, args.organizationId),
          eq(lineItemProofVersions.lineItemId, lineItem.lineItemId),
          eq(lineItemProofVersions.status, "awaiting_response"),
        ),
      )
      .limit(1);

    if (blockingVersion) {
      throwProofingConflict("Cannot create a new proof version while another proof is awaiting response");
    }

    await supersedeObsoleteDraftVersions(tx, {
      organizationId: args.organizationId,
      orderId: lineItem.orderId,
      lineItemId: lineItem.lineItemId,
      actorUserId: args.createdByUserId,
      reason: "replaced_by_new_draft",
    });

    const [versionNumberRow] = await tx
      .select({ nextVersionNumber: sql<number>`coalesce(max(${lineItemProofVersions.versionNumber}), 0)::int + 1` })
      .from(lineItemProofVersions)
      .where(and(eq(lineItemProofVersions.organizationId, args.organizationId), eq(lineItemProofVersions.lineItemId, lineItem.lineItemId)));

    const [created] = await tx
      .insert(lineItemProofVersions)
      .values({
        organizationId: args.organizationId,
        orderId: lineItem.orderId,
        lineItemId: lineItem.lineItemId,
        proofFileId: args.proofFileId,
        versionNumber: versionNumberRow?.nextVersionNumber ?? 1,
        status: "draft",
        internalNotes: args.internalNotes ?? null,
        createdByUserId: args.createdByUserId,
        updatedAt: new Date(),
      })
      .returning();

    await appendProofingEvent(tx, {
      organizationId: args.organizationId,
      orderId: lineItem.orderId,
      lineItemId: lineItem.lineItemId,
      eventType: "proof_draft_created",
      actorUserId: args.createdByUserId,
      payload: {
        proofVersionId: created.id,
        proofFileId: created.proofFileId,
        versionNumber: created.versionNumber,
        newProofStatus: created.status,
        internalNotes: args.internalNotes ?? null,
      },
    });

    if (args.sourceAction) {
      await appendProofingEvent(tx, {
        organizationId: args.organizationId,
        orderId: lineItem.orderId,
        lineItemId: lineItem.lineItemId,
        eventType: args.sourceAction,
        actorUserId: args.createdByUserId,
        payload: {
          proofVersionId: created.id,
          proofFileId: created.proofFileId,
          versionNumber: created.versionNumber,
          newProofStatus: created.status,
        },
      });
    }

    return created;
  } catch (error: any) {
    normalizeProofingWriteError(error);
  }
}

export async function markProofVersionSent(tx: any, args: {
  organizationId: string;
  proofVersionId: string;
  actorUserId: string;
  sentToName?: string | null;
  sentToEmail?: string | null;
  customerMessage?: string | null;
  customerVisibleDisclaimer?: string | null;
}) {
  try {
    const proofVersion = await loadProofVersion(tx, {
      organizationId: args.organizationId,
      proofVersionId: args.proofVersionId,
    });
    const lineItem = await loadProofLineItem(tx, {
      organizationId: args.organizationId,
      lineItemId: proofVersion.lineItemId,
    });
    assertProofOrderNotCancelled(lineItem);

    if (proofVersion.status !== "draft") {
      throwProofingConflict("Only draft proof versions can be sent for review");
    }

    const [blockingVersion] = await tx
      .select({ id: lineItemProofVersions.id })
      .from(lineItemProofVersions)
      .where(
        and(
          eq(lineItemProofVersions.organizationId, args.organizationId),
          eq(lineItemProofVersions.lineItemId, proofVersion.lineItemId),
          eq(lineItemProofVersions.status, "awaiting_response"),
          ne(lineItemProofVersions.id, proofVersion.id),
        ),
      )
      .limit(1);

    if (blockingVersion) {
      throwProofingConflict("Another proof version is already awaiting response");
    }

    const artifact = buildProofArtifactSummary({
      attachment: await loadProofAttachment(tx, {
        organizationId: args.organizationId,
        attachmentId: proofVersion.proofFileId,
      }),
      snapshot: await buildProofInputSnapshot(tx, {
        organizationId: args.organizationId,
        lineItemId: proofVersion.lineItemId,
      }),
    });

    if (!proofArtifactIsCustomerSendable(artifact)) {
      throw Object.assign(new Error(INCOMPLETE_PROOF_MESSAGE), { statusCode: 400 });
    }

    await tx
      .update(orderLineItems)
      .set({
        requiresProofApproval: true,
        approvedProofVersionId: null,
        updatedAt: new Date(),
      })
      .where(eq(orderLineItems.id, proofVersion.lineItemId));

    const [updatedVersion] = await tx
      .update(lineItemProofVersions)
      .set({
        status: "awaiting_response",
        sentToName: args.sentToName ?? null,
        sentToEmail: args.sentToEmail ?? null,
        customerMessage: args.customerMessage ?? null,
        customerVisibleDisclaimer: args.customerVisibleDisclaimer ?? null,
        sentByUserId: args.actorUserId,
        sentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(lineItemProofVersions.id, proofVersion.id))
      .returning();

    const currentWorkflowState = String(lineItem.workflowState || "").trim().toLowerCase();
    const proofAwaitingTarget =
      lineItem.requiresPrepress && (currentWorkflowState === "ready_for_prepress" || currentWorkflowState === "in_prepress")
        ? (currentWorkflowState as any)
        : "awaiting_proof_approval";

    const workflowTransition = await transitionLineItemWorkflowState(tx, {
      organizationId: args.organizationId,
      lineItemId: proofVersion.lineItemId,
      toState: proofAwaitingTarget,
      actorUserId: args.actorUserId,
      metadata: {
        source: "proofing_send_for_review",
        proofVersionId: proofVersion.id,
        versionNumber: proofVersion.versionNumber,
      },
    });

    await appendProofingEvent(tx, {
      organizationId: args.organizationId,
      orderId: proofVersion.orderId,
      lineItemId: proofVersion.lineItemId,
      eventType: "proof_sent",
      actorUserId: args.actorUserId,
      payload: {
        proofVersionId: proofVersion.id,
        versionNumber: proofVersion.versionNumber,
        previousProofStatus: proofVersion.status,
        newProofStatus: updatedVersion.status,
        workflowToState: workflowTransition.toState,
        sentToEmail: args.sentToEmail ?? null,
        customerMessage: args.customerMessage ?? null,
      },
    });

    return { proofVersion: updatedVersion, workflowTransition };
  } catch (error: any) {
    normalizeProofingWriteError(error);
  }
}

export async function recordProofResponse(tx: any, args: {
  organizationId: string;
  proofVersionId: string;
  actorUserId?: string | null;
  responderName?: string | null;
  responderEmail?: string | null;
  responderSource?: string | null;
  decision: ProofDecision;
  responseNotes?: string | null;
}) {
  try {
    const proofVersion = await loadProofVersion(tx, {
      organizationId: args.organizationId,
      proofVersionId: args.proofVersionId,
    });

    if (proofVersion.status === "cancelled") {
      throwProofingConflict("This proof version has been cancelled and is no longer available for approval.");
    }

    if (proofVersion.status === "superseded") {
      throwProofingConflict("This proof version has been replaced by a newer proof and is no longer available for approval.");
    }

    if (proofVersion.status === "approved" || proofVersion.status === "rejected" || proofVersion.status === "revision_requested") {
      throwProofingConflict("This proof has already been reviewed.");
    }

    if (proofVersion.status !== "awaiting_response") {
      throwProofingConflict("Only active sent proof versions awaiting response can be decided");
    }

    const lineItem = await loadProofLineItem(tx, {
      organizationId: args.organizationId,
      lineItemId: proofVersion.lineItemId,
    });
    assertProofOrderNotCancelled(lineItem);

    const [existingResponse] = await tx
      .select({ id: lineItemProofApprovals.id })
      .from(lineItemProofApprovals)
      .where(eq(lineItemProofApprovals.proofVersionId, proofVersion.id))
      .limit(1);

    if (existingResponse) {
      throwProofingConflict("This proof has already been reviewed.");
    }

    const [approval] = await tx
      .insert(lineItemProofApprovals)
      .values({
        organizationId: args.organizationId,
        orderId: lineItem.orderId,
        lineItemId: lineItem.lineItemId,
        proofVersionId: proofVersion.id,
        decision: args.decision,
        responseNotes: args.responseNotes ?? null,
        responderUserId: args.actorUserId ?? null,
        responderName: args.responderName ?? null,
        responderEmail: args.responderEmail ?? null,
        responderSource: args.responderSource ?? (args.actorUserId ? "internal" : "external"),
      })
      .returning();

    const nextProofStatus: ProofVersionStatus = args.decision;
    const nextWorkflowState = deriveProofResponseWorkflowState({
      decision: args.decision,
      requiresPrepress: lineItem.requiresPrepress,
    });

    await tx
      .update(lineItemProofVersions)
      .set({
        status: nextProofStatus,
        updatedAt: new Date(),
      })
      .where(eq(lineItemProofVersions.id, proofVersion.id));

    await tx
      .update(orderLineItems)
      .set({
        approvedProofVersionId: args.decision === "approved" ? proofVersion.id : null,
        updatedAt: new Date(),
      })
      .where(eq(orderLineItems.id, lineItem.lineItemId));

    const workflowTransition = await transitionLineItemWorkflowState(tx, {
      organizationId: args.organizationId,
      lineItemId: lineItem.lineItemId,
      toState: nextWorkflowState,
      actorUserId: args.actorUserId ?? null,
      metadata: {
        source: "proofing_record_response",
        proofVersionId: proofVersion.id,
        approvalId: approval.id,
        decision: args.decision,
      },
    });

    await appendProofingEvent(tx, {
      organizationId: args.organizationId,
      orderId: lineItem.orderId,
      lineItemId: lineItem.lineItemId,
      eventType:
        args.decision === "approved"
          ? "proof_approved"
          : args.decision === "rejected"
            ? "proof_rejected"
            : "proof_revision_requested",
      actorUserId: args.actorUserId ?? null,
      payload: {
        proofVersionId: proofVersion.id,
        approvalId: approval.id,
        previousProofStatus: proofVersion.status,
        newProofStatus: nextProofStatus,
        workflowToState: workflowTransition.toState,
        customerAction: !args.actorUserId || args.responderSource === "customer",
        responseNotes: args.responseNotes ?? null,
      },
    });

    return {
      approval,
      workflowTransition,
    };
  } catch (error: any) {
    normalizeProofingWriteError(error);
  }
}

export async function recordManualProofApprovalOverride(tx: any, args: {
  organizationId: string;
  lineItemId: string;
  proofVersionId?: string | null;
  actorUserId: string;
  actorName?: string | null;
  actorEmail?: string | null;
  overrideReason: string;
  internalNote?: string | null;
}) {
  try {
    const overrideReason = trimNullable(args.overrideReason);
    if (!overrideReason) {
      throwProofingBadRequest("Manual approval override reason is required");
    }

    const lineItem = await loadProofLineItem(tx, {
      organizationId: args.organizationId,
      lineItemId: args.lineItemId,
    });
    assertProofOrderNotCancelled(lineItem);

    if (lineItem.approvedProofVersionId) {
      throwProofingConflict("This line item already has an approved proof");
    }

    const candidateVersions = await tx
      .select({
        id: lineItemProofVersions.id,
        status: lineItemProofVersions.status,
        versionNumber: lineItemProofVersions.versionNumber,
        createdAt: lineItemProofVersions.createdAt,
      })
      .from(lineItemProofVersions)
      .where(
        and(
          eq(lineItemProofVersions.organizationId, args.organizationId),
          eq(lineItemProofVersions.lineItemId, lineItem.lineItemId),
        ),
      )
      .orderBy(
        sql`case ${lineItemProofVersions.status}
          when 'awaiting_response' then 0
          when 'draft' then 1
          when 'revision_requested' then 2
          when 'rejected' then 3
          when 'cancelled' then 4
          when 'superseded' then 5
          else 6
        end`,
        desc(lineItemProofVersions.versionNumber),
        desc(lineItemProofVersions.createdAt),
      );

    const proofGate = await resolveLineItemProofReleaseGate(tx, {
      organizationId: args.organizationId,
      lineItemId: lineItem.lineItemId,
    });

    const overrideEligible =
      lineItem.requiresProofApproval ||
      lineItem.workflowState === "awaiting_proof_approval" ||
      candidateVersions.length > 0 ||
      !proofGate.allowed;

    if (!overrideEligible) {
      throwProofingConflict("Line item is not eligible for manual approval override");
    }

    const requestedProofVersionId = trimNullable(args.proofVersionId);
    let proofVersion = null as Awaited<ReturnType<typeof loadProofVersion>> | null;

    if (requestedProofVersionId) {
      proofVersion = await loadProofVersion(tx, {
        organizationId: args.organizationId,
        proofVersionId: requestedProofVersionId,
      });

      if (proofVersion.lineItemId !== lineItem.lineItemId || proofVersion.orderId !== lineItem.orderId) {
        throwProofingConflict("Proof version does not belong to the target line item");
      }
    } else if (candidateVersions.length > 0) {
      proofVersion = await loadProofVersion(tx, {
        organizationId: args.organizationId,
        proofVersionId: candidateVersions[0].id,
      });
    }

    if (!proofVersion) {
      throwProofingConflict("Proof context is unavailable for manual approval override. Use Mark Proof Not Required to bypass the proof gate without a proof version.");
    }

    if (proofVersion.status === "approved") {
      throwProofingConflict("This proof version is already approved");
    }

    const [existingResponse] = await tx
      .select({ id: lineItemProofApprovals.id })
      .from(lineItemProofApprovals)
      .where(eq(lineItemProofApprovals.proofVersionId, proofVersion.id))
      .limit(1);

    const [existingOverride] = await tx
      .select({ id: lineItemProofManualApprovalOverrides.id })
      .from(lineItemProofManualApprovalOverrides)
      .where(eq(lineItemProofManualApprovalOverrides.proofVersionId, proofVersion.id))
      .limit(1);

    if (existingOverride) {
      throwProofingConflict("A manual approval override already exists for this proof version");
    }

    const [manualApprovalOverride] = await tx
      .insert(lineItemProofManualApprovalOverrides)
      .values({
        organizationId: args.organizationId,
        orderId: lineItem.orderId,
        lineItemId: lineItem.lineItemId,
        proofVersionId: proofVersion.id,
        source: "manual_override",
        overrideReason,
        internalNote: trimNullable(args.internalNote),
        actorUserId: args.actorUserId,
        actorName: trimNullable(args.actorName),
        actorEmail: trimNullable(args.actorEmail),
      })
      .returning();

    const preservesTerminalProofStatus = proofVersion.status === "cancelled" || proofVersion.status === "superseded";
    const manualOverrideProofStatus = preservesTerminalProofStatus ? proofVersion.status : "approved";

    if (!preservesTerminalProofStatus) {
      await tx
        .update(lineItemProofVersions)
        .set({
          status: "approved",
          updatedAt: new Date(),
        })
        .where(eq(lineItemProofVersions.id, proofVersion.id));
    }

    await tx
      .update(orderLineItems)
      .set({
        approvedProofVersionId: proofVersion.id,
        updatedAt: new Date(),
      })
      .where(eq(orderLineItems.id, lineItem.lineItemId));

    const workflowTransition = await transitionLineItemWorkflowState(tx, {
      organizationId: args.organizationId,
      lineItemId: lineItem.lineItemId,
      toState: deriveProofResponseWorkflowState({
        decision: "approved",
        requiresPrepress: lineItem.requiresPrepress,
      }),
      actorUserId: args.actorUserId,
      metadata: {
        source: "proofing_manual_approval_override",
        proofVersionId: proofVersion.id,
        manualApprovalOverrideId: manualApprovalOverride.id,
        overrideReason,
      },
    });

    await appendProofingEvent(tx, {
      organizationId: args.organizationId,
      orderId: lineItem.orderId,
      lineItemId: lineItem.lineItemId,
      eventType: "proof_approved",
      actorUserId: args.actorUserId,
      payload: {
        manualApprovalOverrideId: manualApprovalOverride.id,
        proofVersionId: proofVersion.id,
        previousProofStatus: proofVersion.status,
        newProofStatus: manualOverrideProofStatus,
        approvalSource: "manual_override",
        reason: overrideReason,
        internalNote: trimNullable(args.internalNote),
        customerAction: false,
        workflowToState: workflowTransition.toState,
        previousNormalResponseId: existingResponse?.id ?? null,
      },
    });

    return {
      manualApprovalOverride,
      workflowTransition,
      proofVersionId: proofVersion.id,
    };
  } catch (error: any) {
    normalizeProofingWriteError(error);
  }
}

export async function markLineItemProofNotRequired(tx: any, args: {
  organizationId: string;
  lineItemId: string;
  actorUserId: string;
  reason: string;
  internalNote?: string | null;
}) {
  const reason = trimNullable(args.reason);
  if (!reason) {
    throwProofingBadRequest("Reason is required to mark proof not required");
  }

  const lineItem = await loadProofLineItem(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
  });
  assertProofOrderNotCancelled(lineItem);

  const proofGate = await resolveLineItemProofReleaseGate(tx, {
    organizationId: args.organizationId,
    lineItemId: lineItem.lineItemId,
  });

  if (!lineItem.requiresProofApproval && lineItem.workflowState !== "awaiting_proof_approval" && proofGate.allowed) {
    throwProofingConflict("Proof approval is not blocking this line item");
  }

  await cancelActionableProofVersions(tx, {
    organizationId: args.organizationId,
    orderId: lineItem.orderId,
    lineItemId: lineItem.lineItemId,
    actorUserId: args.actorUserId,
    reason: "proof_not_required",
  });

  await tx
    .update(orderLineItems)
    .set({
      requiresProofApproval: false,
      approvedProofVersionId: null,
      updatedAt: new Date(),
    })
    .where(eq(orderLineItems.id, lineItem.lineItemId));

  const workflowTransition = await transitionLineItemWorkflowState(tx, {
    organizationId: args.organizationId,
    lineItemId: lineItem.lineItemId,
    toState: lineItem.requiresPrepress ? "ready_for_prepress" : "ready_for_production",
    actorUserId: args.actorUserId,
    metadata: {
      source: "proofing_mark_not_required",
      reason,
      internalNote: trimNullable(args.internalNote),
    },
  });

  await appendProofingEvent(tx, {
    organizationId: args.organizationId,
    orderId: lineItem.orderId,
    lineItemId: lineItem.lineItemId,
    eventType: "proof_not_required",
    actorUserId: args.actorUserId,
    payload: {
      previousRequiresProofApproval: lineItem.requiresProofApproval,
      newRequiresProofApproval: false,
      reason,
      internalNote: trimNullable(args.internalNote),
      workflowToState: workflowTransition.toState,
    },
  });

  return {
    lineItemId: lineItem.lineItemId,
    workflowTransition,
  };
}

export async function resolveLineItemProofingTruth(tx: any, args: {
  organizationId: string;
  lineItemId: string;
}): Promise<ProofingReadModel> {
  const lineItem = await loadProofLineItem(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
  });

  const truthMap = await resolveProofingTruthMap(tx, {
    organizationId: args.organizationId,
    lineItems: [lineItem],
  });

  const truth = truthMap.get(args.lineItemId);
  if (!truth) {
    throw Object.assign(new Error("Failed to resolve proofing truth"), { statusCode: 500 });
  }

  const currentProofInputSnapshot = await buildProofInputSnapshot(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
  });

  const currentDisplayedVersion = truth.currentActionableProofVersion ?? truth.approvedProofVersion ?? truth.proofVersionHistory[0] ?? null;
  const currentDisplayedProofArtifact = currentDisplayedVersion
    ? buildProofArtifactSummary({
        attachment: await loadProofAttachment(tx, {
          organizationId: args.organizationId,
          attachmentId: currentDisplayedVersion.proofFileId,
        }),
        snapshot: currentProofInputSnapshot,
      })
    : null;

  return {
    ...truth,
    currentProofInputSnapshot,
    currentDisplayedProofArtifact,
  };
}
