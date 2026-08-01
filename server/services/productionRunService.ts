import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLogs, customers, lineItemFiles, localFileCopyJobs, orderLineItems, orders, prepressSessions, productionEvents, productionJobs, productionRunMembers, productionRuns, users } from "@shared/schema";
import { transitionLineItemWorkflowState } from "./lineItemWorkflowService";
import { findActiveJobForLineItem, isPrepressOwnershipJob } from "./productionOwnership";
import { resolveDerivativeFileAccess } from "../lib/supabaseObjectHelpers";
import { downloadLineItemFile, enqueueFinalProductionFileCopy, queueLineItemFilePreviewRepair, uploadLineItemFile } from "../prepressFileService";
import {
  buildCombinedRunSheetPlanRecommendation,
  snapshotCombinedRunSheetPlan,
  type CombinedRunSheetPlanSubmission,
} from "@shared/combinedRunSheetPlan";
import { resolveProductionSides } from "@shared/productionHydration";
import { buildArtworkAllocationStatus, summarizeArtworkAllocationIssue } from "@shared/artworkAllocation";
import type { Response } from "express";

type MemberInput = { productionJobId: string; allocatedQuantity?: number };
type PrepressMemberInput = { lineItemId: string; allocatedQuantity?: number };
type RunStatus = "draft" | "ready_for_production" | "in_production" | "partially_completed" | "completed" | "completed_with_exceptions" | "canceled";
type MemberOutcomeStatus = "pending" | "completed" | "partially_completed" | "failed" | "requires_reprint" | "return_to_prepress" | "cancelled" | "hold_for_review";
type RecoveryDisposition = "none" | "return_to_prepress" | "return_to_production_queue" | "requires_reprint" | "hold_for_review" | "cancel_remaining";
type SheetPlanPersistence = {
  plannedSheetCount: number | null;
  nominalPiecesPerSheet: number | null;
  sheetWidth: number | null;
  sheetHeight: number | null;
  sheetPlanInputSnapshot: Record<string, unknown> | null;
  calculatedSheetPlanSnapshot: Record<string, unknown> | null;
  effectiveSheetPlanSnapshot: Record<string, unknown> | null;
  sheetPlanOverrideReason: string | null;
  sheetPlanOverrideByUserId: string | null;
  sheetPlanOverrideAt: Date | null;
  sheetPlanCalculatorVersion: string | null;
};
type MemberOutcomeInput = {
  memberId: string;
  successfulQuantity: number;
  damagedQuantity?: number;
  remainingQuantity?: number;
  outcomeStatus?: MemberOutcomeStatus;
  recoveryDisposition?: RecoveryDisposition | null;
  operatorNote?: string | null;
  segments?: Array<Record<string, unknown>>;
};

export class ProductionRunError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 400) { super(message); }
}

const activeStatuses: RunStatus[] = ["draft", "ready_for_production", "in_production", "partially_completed"];
const terminalJobStatuses = new Set(["done", "void", "canceled", "cancelled"]);

const finitePositiveInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const finitePositiveNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const sameNumber = (left: unknown, right: unknown) => {
  const a = left == null ? null : Number(left);
  const b = right == null ? null : Number(right);
  if (a == null || b == null) return a == null && b == null;
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.0001;
};

const sameCalculatedPlan = (submitted: CombinedRunSheetPlanSubmission["calculated"] | undefined, canonical: ReturnType<typeof buildCombinedRunSheetPlanRecommendation>) => {
  if (!submitted) return false;
  return submitted.calculatorVersion === canonical.calculatorVersion
    && submitted.inputKey === canonical.inputKey
    && submitted.canAutoPlan === canonical.canAutoPlan
    && submitted.reasonCode === canonical.reasonCode
    && sameNumber(submitted.totalQuantity, canonical.totalQuantity)
    && sameNumber(submitted.plannedSheetCount, canonical.plannedSheetCount)
    && sameNumber(submitted.nominalPiecesPerSheet, canonical.nominalPiecesPerSheet)
    && sameNumber(submitted.sheetWidth, canonical.sheetWidth)
    && sameNumber(submitted.sheetHeight, canonical.sheetHeight)
    && sameNumber(submitted.printPasses, canonical.printPasses)
    && sameNumber(submitted.fullSheets, canonical.fullSheets)
    && sameNumber(submitted.partialSheetPieces, canonical.partialSheetPieces);
};

function buildSheetPlanPersistence(input: {
  stationKey: string;
  actorUserId: string;
  sheetPlan?: CombinedRunSheetPlanSubmission | null;
  rows: Array<{ line: typeof orderLineItems.$inferSelect }>;
  requestedMembers: PrepressMemberInput[];
}): SheetPlanPersistence | null {
  if (input.stationKey !== "flatbed" && !input.sheetPlan) return null;
  if (!input.sheetPlan) {
    throw new ProductionRunError("PRODUCTION_RUN_SHEET_PLAN_REQUIRED", "Create the combined run with a current server-validated sheet plan.", 409);
  }

  const items = input.rows.map(({ line }) => {
    const requested = input.requestedMembers.find((member) => member.lineItemId === line.id)?.allocatedQuantity ?? Number(line.quantity);
    return {
      lineItemId: line.id,
      quantity: requested,
      width: line.width == null ? null : Number(line.width),
      height: line.height == null ? null : Number(line.height),
      productionLayout: {
        sheetWidthIn: input.sheetPlan?.inputs?.sheetWidth ?? null,
        sheetHeightIn: input.sheetPlan?.inputs?.sheetHeight ?? null,
        allowRotation: input.sheetPlan?.inputs?.allowRotation ?? false,
        sideCount: resolveProductionSides(line) === "Double-sided" ? 2 : 1,
      },
    };
  });
  const canonical = buildCombinedRunSheetPlanRecommendation(items, input.sheetPlan.inputs);
  const calculated = snapshotCombinedRunSheetPlan(canonical);
  if (!sameCalculatedPlan(input.sheetPlan.calculated, canonical)) {
    throw new ProductionRunError("PRODUCTION_RUN_SHEET_PLAN_STALE", "The submitted sheet plan is stale. Recalculate the run plan before creating the combined run.", 409);
  }
  if (canonical.reasonCode === "item_too_large") {
    throw new ProductionRunError("PRODUCTION_RUN_SHEET_PLAN_IMPOSSIBLE", canonical.reason || "The selected item does not fit the sheet plan.", 409);
  }

  const manualOverride = input.sheetPlan.manualOverride?.enabled === true ? input.sheetPlan.manualOverride : null;
  if (!canonical.canAutoPlan && !manualOverride) {
    throw new ProductionRunError("PRODUCTION_RUN_SHEET_PLAN_REQUIRED", canonical.reason || "Automatic layout is unavailable; provide an authorized manual plan.", 409);
  }
  if (manualOverride && manualOverride.inputKey !== canonical.inputKey) {
    throw new ProductionRunError("PRODUCTION_RUN_SHEET_PLAN_OVERRIDE_STALE", "Sheet inputs changed after the manual override. Reconfirm the authorized plan before creating the run.", 409);
  }

  const overrideSheets = finitePositiveInteger(manualOverride?.plannedSheetCount);
  const overridePieces = finitePositiveInteger(manualOverride?.nominalPiecesPerSheet);
  const overrideReason = String(manualOverride?.reason || "").trim();
  if (manualOverride && (!overrideSheets || !overridePieces || !overrideReason)) {
    throw new ProductionRunError("PRODUCTION_RUN_SHEET_PLAN_OVERRIDE_REASON_REQUIRED", "Authorized manual sheet-plan overrides require sheets, pieces per sheet, and a reason.", 409);
  }

  const plannedSheetCount = manualOverride ? overrideSheets : canonical.plannedSheetCount;
  const nominalPiecesPerSheet = manualOverride ? overridePieces : canonical.nominalPiecesPerSheet;
  const sheetWidth = finitePositiveNumber(canonical.sheetWidth);
  const sheetHeight = finitePositiveNumber(canonical.sheetHeight);
  const effective = {
    ...calculated,
    manuallyOverridden: Boolean(manualOverride),
    plannedSheetCount,
    nominalPiecesPerSheet,
    sheetWidth,
    sheetHeight,
    overrideReason: manualOverride ? overrideReason : null,
  };

  return {
    plannedSheetCount: plannedSheetCount ?? null,
    nominalPiecesPerSheet: nominalPiecesPerSheet ?? null,
    sheetWidth,
    sheetHeight,
    sheetPlanInputSnapshot: canonical.inputs as unknown as Record<string, unknown>,
    calculatedSheetPlanSnapshot: calculated as unknown as Record<string, unknown>,
    effectiveSheetPlanSnapshot: effective as unknown as Record<string, unknown>,
    sheetPlanOverrideReason: manualOverride ? overrideReason : null,
    sheetPlanOverrideByUserId: manualOverride ? input.actorUserId : null,
    sheetPlanOverrideAt: manualOverride ? new Date() : null,
    sheetPlanCalculatorVersion: canonical.calculatorVersion,
  };
}

export type ProductionRunListItem = {
  kind: "production_run";
  id: string;
  runId: string;
  runNumber: number;
  displayNumber: string;
  orderId: string | null;
  orderNumber: string;
  customerId: string | null;
  customerName: string;
  stationKey: string;
  status: "queued" | "in_progress" | "done";
  runStatus: RunStatus;
  plannedSheetCount: number | null;
  nominalPiecesPerSheet: number | null;
  sheetWidth: string | null;
  sheetHeight: string | null;
  sheetPlanInputSnapshot: Record<string, unknown> | null;
  calculatedSheetPlanSnapshot: Record<string, unknown> | null;
  effectiveSheetPlanSnapshot: Record<string, unknown> | null;
  sheetPlanOverrideReason: string | null;
  sheetPlanOverrideByUserId: string | null;
  sheetPlanOverrideAt: Date | null;
  sheetPlanCalculatorVersion: string | null;
  notes: string | null;
  memberCount: number;
  totalAllocatedQuantity: number;
  fileCount: number;
  replacementRequired: boolean;
  files: ProductionRunFileSummary[];
  members: Array<{
    id: string;
    productionJobId: string;
    orderLineItemId: string;
    orderId: string;
    orderNumber: string;
    customerId: string | null;
    customerName: string;
    lineNumber: number | null;
    description: string;
    orderedQuantity: number;
    allocatedQuantity: number;
    completedQuantity: number;
    successfulQuantity: number;
    damagedQuantity: number;
    remainingQuantity: number;
    outcomeStatus: MemberOutcomeStatus;
    recoveryDisposition: RecoveryDisposition | null;
    operatorNote: string | null;
    outcomeSegments: Array<Record<string, unknown>>;
    previouslyCompletedQuantity: number;
    remainingAfterRun: number;
  }>;
  createdAt: Date;
  updatedAt: Date;
};

export type ProductionRunFileSummary = {
  id: string;
  productionRunId: string;
  lineItemId: string;
  fileRecordId: string | null;
  fileName: string;
  originalFilename: string;
  role: "final";
  status: "active" | "superseded" | "retired";
  tag: string | null;
  productionQuantity: number | null;
  productionGroupId: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  previewAvailabilityStatus: "available" | "pending" | "missing" | "failed" | null;
  downloadUrl: string;
  openUrl: string;
  uploadedByUserId: string | null;
  uploadedByName: string | null;
  createdAt: Date;
  localBridge: {
    status: "none" | "pending" | "claimed" | "succeeded" | "failed" | "canceled";
    unsafeToRetire: boolean;
    jobCount: number;
    lastError: string | null;
    updatedAt: Date | null;
  };
  supersedesFileId: string | null;
};

function toBoardStatus(status: RunStatus): "queued" | "in_progress" | "done" {
  if (status === "completed" || status === "completed_with_exceptions" || status === "canceled") return "done";
  if (status === "in_production" || status === "partially_completed") return "in_progress";
  return "queued";
}

function actorDisplayName(user: { firstName?: string | null; lastName?: string | null; email?: string | null } | null | undefined) {
  const name = `${user?.firstName || ""} ${user?.lastName || ""}`.trim();
  return name || user?.email || null;
}

function localBridgeStatusForJobs(jobs: Array<{ status: string; lastError: string | null; updatedAt: Date }>): ProductionRunFileSummary["localBridge"] {
  if (!jobs.length) return { status: "none", unsafeToRetire: false, jobCount: 0, lastError: null, updatedAt: null };
  const priority = ["claimed", "pending", "failed", "succeeded", "canceled"];
  const status = priority.find((candidate) => jobs.some((job) => job.status === candidate)) as ProductionRunFileSummary["localBridge"]["status"] | undefined;
  const newest = jobs.reduce((latest, job) => (!latest || job.updatedAt > latest.updatedAt ? job : latest), jobs[0]);
  const failure = jobs.find((job) => job.lastError);
  return {
    status: status ?? "none",
    unsafeToRetire: jobs.some((job) => job.status === "claimed"),
    jobCount: jobs.length,
    lastError: failure?.lastError ?? null,
    updatedAt: newest?.updatedAt ?? null,
  };
}

async function buildProductionRunFileSummaries(
  files: Array<typeof lineItemFiles.$inferSelect & { uploaderFirstName?: string | null; uploaderLastName?: string | null; uploaderEmail?: string | null }>,
): Promise<ProductionRunFileSummary[]> {
  if (!files.length) return [];
  const fileIds = files.map((file) => file.id);
  const bridgeRows = await db
    .select({
      sourceFileId: localFileCopyJobs.sourceFileId,
      status: localFileCopyJobs.status,
      lastError: localFileCopyJobs.lastError,
      updatedAt: localFileCopyJobs.updatedAt,
    })
    .from(localFileCopyJobs)
    .where(inArray(localFileCopyJobs.sourceFileId, fileIds));
  const bridgeByFileId = new Map<string, Array<{ status: string; lastError: string | null; updatedAt: Date }>>();
  for (const job of bridgeRows) {
    const key = job.sourceFileId;
    const list = bridgeByFileId.get(key) ?? [];
    list.push({ status: String(job.status), lastError: job.lastError ?? null, updatedAt: job.updatedAt });
    bridgeByFileId.set(key, list);
  }

  return Promise.all(files.map(async (file) => {
    const [thumbnail, preview] = file.fileRecordId
      ? await Promise.all([
          resolveDerivativeFileAccess({ id: file.id, fileRecordId: file.fileRecordId }, "thumbnail"),
          resolveDerivativeFileAccess({ id: file.id, fileRecordId: file.fileRecordId }, "preview"),
        ])
      : [{ url: null, availabilityStatus: "missing" as const }, { url: null, availabilityStatus: "missing" as const }];
    return {
      id: file.id,
      productionRunId: file.productionRunId!,
      lineItemId: file.lineItemId,
      fileRecordId: file.fileRecordId ?? null,
      fileName: file.originalFilename,
      originalFilename: file.originalFilename,
      role: "final",
      status: file.status as ProductionRunFileSummary["status"],
      tag: file.tag ?? null,
      productionQuantity: file.productionQuantity ?? null,
      productionGroupId: file.productionGroupId ?? null,
      mimeType: file.mimeType ?? null,
      sizeBytes: file.sizeBytes ?? null,
      thumbnailUrl: thumbnail.url ?? null,
      previewUrl: preview.url ?? null,
      previewAvailabilityStatus: preview.availabilityStatus ?? "missing",
      downloadUrl: `/api/production/runs/${file.productionRunId}/files/${file.id}/download`,
      openUrl: `/api/production/runs/${file.productionRunId}/files/${file.id}/download?inline=1`,
      uploadedByUserId: file.createdByUserId ?? null,
      uploadedByName: actorDisplayName({ firstName: file.uploaderFirstName, lastName: file.uploaderLastName, email: file.uploaderEmail }),
      createdAt: file.createdAt,
      localBridge: localBridgeStatusForJobs(bridgeByFileId.get(file.id) ?? []),
      supersedesFileId: file.supersedesFileId ?? null,
    };
  }));
}

async function getScopedProductionRun(input: { organizationId: string; runId: string }, tx: any = db) {
  const [run] = await tx
    .select()
    .from(productionRuns)
    .where(and(eq(productionRuns.id, input.runId), eq(productionRuns.organizationId, input.organizationId)))
    .limit(1);
  if (!run) throw new ProductionRunError("PRODUCTION_RUN_NOT_FOUND", "Production run was not found.", 404);
  return run;
}

async function getRepresentativeRunMember(input: { organizationId: string; runId: string }, tx: any = db) {
  const [member] = await tx
    .select()
    .from(productionRunMembers)
    .where(and(eq(productionRunMembers.organizationId, input.organizationId), eq(productionRunMembers.productionRunId, input.runId)))
    .orderBy(asc(productionRunMembers.createdAt))
    .limit(1);
  if (!member) throw new ProductionRunError("PRODUCTION_RUN_MEMBERS_REQUIRED", "A production run must have members before files can be attached.", 409);
  return member;
}

async function countActiveProductionRunFiles(tx: any, input: { organizationId: string; runId: string }): Promise<number> {
  const [activeFiles] = await tx.select({ count: sql<number>`count(*)::int` }).from(lineItemFiles).where(and(
    eq(lineItemFiles.organizationId, input.organizationId),
    eq(lineItemFiles.productionRunId, input.runId),
    eq(lineItemFiles.role, "final"),
    eq(lineItemFiles.status, "active"),
  ));
  return Number(activeFiles?.count ?? 0);
}

async function insertRunAudit(input: {
  organizationId: string;
  actorUserId: string | null;
  runId: string;
  runNumber: number;
  description: string;
  actionType?: string;
  oldValues?: unknown;
  newValues?: unknown;
}) {
  await db.insert(auditLogs).values({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    actionType: input.actionType ?? "UPDATE",
    entityType: "production_run",
    entityId: input.runId,
    entityName: `PR-${String(input.runNumber).padStart(4, "0")}`,
    description: input.description,
    oldValues: input.oldValues ?? undefined,
    newValues: input.newValues ?? undefined,
  } as any);
}

/**
 * Serializes allocation checks per job. A run never takes ownership of a line
 * item; it only reserves an explicit quantity against its existing job.
 */
export async function createProductionRun(input: {
  organizationId: string; actorUserId: string; orderId?: string | null; stationKey: string;
  members: MemberInput[]; plannedSheetCount?: number | null; nominalPiecesPerSheet?: number | null;
  sheetWidth?: number | null; sheetHeight?: number | null; notes?: string | null;
  compatibilityOverrideReason?: string | null;
  productionFileStrategy?: "rip_managed" | "staff_prepared";
}) {
  return db.transaction(async (tx) => createProductionRunInTransaction(tx, input));
}

async function createProductionRunInTransaction(tx: any, input: {
  organizationId: string; actorUserId: string; orderId?: string | null; stationKey: string;
  members: MemberInput[]; plannedSheetCount?: number | null; nominalPiecesPerSheet?: number | null;
  sheetWidth?: number | null; sheetHeight?: number | null; notes?: string | null;
  compatibilityOverrideReason?: string | null;
  productionFileStrategy?: "rip_managed" | "staff_prepared";
  sheetPlanPersistence?: SheetPlanPersistence | null;
}) {
  if (!input.members.length) throw new ProductionRunError("PRODUCTION_RUN_MEMBERS_REQUIRED", "Select at least one eligible production job.");
  const uniqueIds = Array.from(new Set(input.members.map((member) => member.productionJobId).filter(Boolean)));
  if (uniqueIds.length !== input.members.length) throw new ProductionRunError("PRODUCTION_RUN_DUPLICATE_MEMBER", "A production job may only appear once in a run.");

  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`production-run:${input.organizationId}:${uniqueIds.slice().sort().join(",")}`}))`);
  const jobs = await tx.select({ job: productionJobs, line: orderLineItems }).from(productionJobs)
    .innerJoin(orderLineItems, eq(orderLineItems.id, productionJobs.lineItemId))
    .innerJoin(orders, and(eq(orderLineItems.orderId, orders.id), eq(orders.organizationId, input.organizationId)))
    .where(and(eq(productionJobs.organizationId, input.organizationId), inArray(productionJobs.id, uniqueIds)));
  if (jobs.length !== uniqueIds.length) throw new ProductionRunError("PRODUCTION_RUN_MEMBER_NOT_FOUND", "One or more selected production jobs are unavailable.", 404);
  if (input.orderId && jobs.some(({ job }: any) => job.orderId !== input.orderId)) {
    throw new ProductionRunError("PRODUCTION_RUN_MEMBER_NOT_FOUND", "One or more selected production jobs are unavailable for this order.", 404);
  }
  if (jobs.some(({ job, line }: any) => !job.lineItemId || terminalJobStatuses.has(String(job.status || "").toLowerCase()) || line.productionBypassed || line.lineItemRole === "parent")) {
    throw new ProductionRunError("PRODUCTION_RUN_MEMBER_INELIGIBLE", "Selected jobs must be active physical production line items.");
  }
  const stationKeys = new Set(jobs.map(({ job }: any) => String(job.stationKey || "").trim()).filter(Boolean));
  if (stationKeys.size > 0 && !stationKeys.has(input.stationKey)) {
    throw new ProductionRunError("PRODUCTION_RUN_INCOMPATIBLE", "Production run station must match the selected jobs.");
  }
  const hasStationConflict = stationKeys.size > 1;
  const materialKeys = new Set(jobs.map(({ line }: any) => String(line.materialId || "").trim()).filter(Boolean));
  const hasMaterialConflict = materialKeys.size > 1;
  if ((hasStationConflict || hasMaterialConflict) && !input.compatibilityOverrideReason?.trim()) {
    throw new ProductionRunError("PRODUCTION_RUN_INCOMPATIBLE", "Selected jobs use different production routing or material. Supply an authorized compatibility override reason.");
  }
  const allocations = [] as Array<{ productionJobId: string; orderLineItemId: string; allocatedQuantity: number; remainingQuantity: number }>;
  const orderIds = Array.from(new Set(jobs.map(({ job }: any) => String(job.orderId || "")).filter(Boolean)));
  const runOrderId = orderIds.length === 1 ? orderIds[0] : null;
  for (const { job, line } of jobs) {
    const [totals] = await tx.select({
      reserved: sql<number>`coalesce(sum(case when ${productionRuns.status} in ('draft','ready_for_production','in_production') then ${productionRunMembers.allocatedQuantity} else 0 end), 0)`,
      completed: sql<number>`coalesce(sum(case when ${productionRuns.status} in ('completed','completed_with_exceptions') then ${productionRunMembers.completedQuantity} else 0 end), 0)`,
    }).from(productionRunMembers).innerJoin(productionRuns, eq(productionRuns.id, productionRunMembers.productionRunId))
      .where(and(eq(productionRunMembers.organizationId, input.organizationId), eq(productionRunMembers.productionJobId, job.id)));
    const remaining = Math.max(0, Number(line.quantity) - Number(totals?.reserved ?? 0) - Number(totals?.completed ?? 0));
    const requested = input.members.find((member) => member.productionJobId === job.id)?.allocatedQuantity ?? remaining;
    if (!Number.isInteger(requested) || requested <= 0 || requested > remaining) throw new ProductionRunError("PRODUCTION_RUN_ALLOCATION_INVALID", `Allocation for ${line.description} must be between 1 and ${remaining}.`);
    allocations.push({ productionJobId: job.id, orderLineItemId: line.id, allocatedQuantity: requested, remainingQuantity: requested });
  }
  const [numberRow] = await tx.select({ next: sql<number>`coalesce(max(${productionRuns.runNumber}), 0) + 1` }).from(productionRuns).where(eq(productionRuns.organizationId, input.organizationId));
  const sheetPlan = input.sheetPlanPersistence ?? null;
  const [run] = await tx.insert(productionRuns).values({
    organizationId: input.organizationId,
    orderId: runOrderId,
    runNumber: Number(numberRow?.next ?? 1),
    stationKey: input.stationKey,
    productionFileStrategy: input.productionFileStrategy ?? "staff_prepared",
    plannedSheetCount: sheetPlan?.plannedSheetCount ?? input.plannedSheetCount ?? null,
    nominalPiecesPerSheet: sheetPlan?.nominalPiecesPerSheet ?? input.nominalPiecesPerSheet ?? null,
    sheetWidth: (sheetPlan?.sheetWidth ?? input.sheetWidth)?.toString() ?? null,
    sheetHeight: (sheetPlan?.sheetHeight ?? input.sheetHeight)?.toString() ?? null,
    sheetPlanInputSnapshot: sheetPlan?.sheetPlanInputSnapshot ?? null,
    calculatedSheetPlanSnapshot: sheetPlan?.calculatedSheetPlanSnapshot ?? null,
    effectiveSheetPlanSnapshot: sheetPlan?.effectiveSheetPlanSnapshot ?? null,
    sheetPlanOverrideReason: sheetPlan?.sheetPlanOverrideReason ?? null,
    sheetPlanOverrideByUserId: sheetPlan?.sheetPlanOverrideByUserId ?? null,
    sheetPlanOverrideAt: sheetPlan?.sheetPlanOverrideAt ?? null,
    sheetPlanCalculatorVersion: sheetPlan?.sheetPlanCalculatorVersion ?? null,
    notes: input.notes ?? null,
    compatibilityOverrideReason: input.compatibilityOverrideReason ?? null,
    createdByUserId: input.actorUserId,
  }).returning();
  const members = await tx.insert(productionRunMembers).values(allocations.map((member) => ({ ...member, organizationId: input.organizationId, productionRunId: run.id }))).returning();
  await tx.insert(auditLogs).values({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    actionType: "CREATE",
    entityType: "production_run",
    entityId: run.id,
    entityName: `PR-${String(run.runNumber).padStart(4, "0")}`,
    description: "Combined production run created",
    newValues: { orderId: runOrderId, orderIds, stationKey: input.stationKey, productionFileStrategy: input.productionFileStrategy ?? "staff_prepared", members: allocations },
  } as any);
  return { run, members };
}

export async function createPrepressProductionRun(input: {
  organizationId: string; actorUserId: string; orderId?: string | null; stationKey: string;
  members: PrepressMemberInput[]; plannedSheetCount?: number | null; nominalPiecesPerSheet?: number | null;
  sheetWidth?: number | null; sheetHeight?: number | null; notes?: string | null;
  compatibilityOverrideReason?: string | null;
  productionFileStrategy?: "rip_managed" | "staff_prepared";
  sheetPlan?: CombinedRunSheetPlanSubmission | null;
}) {
  if (!input.members.length) throw new ProductionRunError("PRODUCTION_RUN_MEMBERS_REQUIRED", "Select at least one eligible prepress item.");
  const uniqueLineItemIds = Array.from(new Set(input.members.map((member) => member.lineItemId).filter(Boolean)));
  if (uniqueLineItemIds.length !== input.members.length) throw new ProductionRunError("PRODUCTION_RUN_DUPLICATE_MEMBER", "A line item may only appear once in a run.");

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`production-run:${input.organizationId}:${uniqueLineItemIds.slice().sort().join(",")}`}))`);

    const selectedRows = await tx
      .select({ line: orderLineItems })
      .from(orderLineItems)
      .innerJoin(orders, and(eq(orderLineItems.orderId, orders.id), eq(orders.organizationId, input.organizationId)))
      .where(and(
        inArray(orderLineItems.id, uniqueLineItemIds),
        input.orderId ? eq(orderLineItems.orderId, input.orderId) : undefined,
      ));

    if (selectedRows.length !== uniqueLineItemIds.length) {
      throw new ProductionRunError("PRODUCTION_RUN_MEMBER_NOT_FOUND", "One or more selected prepress items are unavailable for this order.", 404);
    }

    const terminalLineStatuses = new Set(["done", "complete", "completed", "void", "canceled", "cancelled"]);
    if (selectedRows.some(({ line }) => terminalLineStatuses.has(String(line.status || "").toLowerCase()) || terminalLineStatuses.has(String(line.workflowState || "").toLowerCase()) || line.productionBypassed || line.lineItemRole === "parent")) {
      throw new ProductionRunError("PRODUCTION_RUN_MEMBER_INELIGIBLE", "Selected items must be active physical production line items.");
    }

    const finalRows = await tx
      .select({
        id: lineItemFiles.id,
        lineItemId: lineItemFiles.lineItemId,
        side: lineItemFiles.sourceArtworkSide,
        productionQuantity: lineItemFiles.productionQuantity,
        productionGroupId: lineItemFiles.productionGroupId,
      })
      .from(lineItemFiles)
      .where(and(
        eq(lineItemFiles.organizationId, input.organizationId),
        inArray(lineItemFiles.lineItemId, uniqueLineItemIds),
        eq(lineItemFiles.role, "final"),
        eq(lineItemFiles.status, "active"),
      ));
    const finalLineItemIds = new Set(finalRows.map((row) => row.lineItemId));
    const missingFinal = selectedRows.find(({ line }) => !finalLineItemIds.has(line.id));
    if (missingFinal) {
      throw new ProductionRunError("PRODUCTION_RUN_FINAL_FILE_REQUIRED", `Assign production artwork before creating a run for ${missingFinal.line.description || "the selected line item"}.`, 409);
    }
    const finalRowsByLineItemId = new Map<string, typeof finalRows>();
    for (const row of finalRows) {
      const list = finalRowsByLineItemId.get(row.lineItemId) ?? [];
      list.push(row);
      finalRowsByLineItemId.set(row.lineItemId, list);
    }
    for (const { line } of selectedRows) {
      const allocation = buildArtworkAllocationStatus({
        lineQuantity: line.quantity,
        members: (finalRowsByLineItemId.get(line.id) ?? []).map((file) => ({
          id: file.id,
          role: "final",
          side: file.side,
          productionQuantity: file.productionQuantity,
          productionGroupId: file.productionGroupId,
          active: true,
        })),
      });
      if (!allocation.valid) {
        throw new ProductionRunError(
          "PRODUCTION_RUN_ARTWORK_ALLOCATION_INVALID",
          `Resolve production artwork allocation for ${line.description || "the selected line item"}: ${summarizeArtworkAllocationIssue(allocation)}`,
          409,
        );
      }
    }
    const sheetPlanPersistence = buildSheetPlanPersistence({
      stationKey: input.stationKey,
      actorUserId: input.actorUserId,
      sheetPlan: input.sheetPlan ?? null,
      rows: selectedRows,
      requestedMembers: input.members,
    });

    const downstreamMembers: MemberInput[] = [];
    for (const { line } of selectedRows) {
      const activeJob = await findActiveJobForLineItem(tx, { organizationId: input.organizationId, lineItemId: line.id });
      if (!activeJob || !isPrepressOwnershipJob(activeJob) || terminalJobStatuses.has(String(activeJob.status || "").toLowerCase())) {
        throw new ProductionRunError("PRODUCTION_RUN_MEMBER_INELIGIBLE", "Selected items must be actively owned by Prepress before creating a combined run.");
      }

      const transition = await transitionLineItemWorkflowState(tx, {
        organizationId: input.organizationId,
        lineItemId: line.id,
        toState: "ready_for_production",
        actorUserId: input.actorUserId,
        metadata: { source: "prepress_combined_production_run", requestedRunStationKey: input.stationKey },
      });

      if (!transition.activeOwnerJobId) {
        throw new ProductionRunError("PRODUCTION_RUN_MEMBER_INELIGIBLE", "Prepress handoff did not create downstream production ownership.");
      }

      await tx
        .update(prepressSessions)
        .set({ status: "complete", completedAt: new Date(), completedByUserId: input.actorUserId })
        .where(and(
          eq(prepressSessions.organizationId, input.organizationId),
          eq(prepressSessions.lineItemId, line.id),
          eq(prepressSessions.status, "active"),
        ));

      const requested = input.members.find((member) => member.lineItemId === line.id)?.allocatedQuantity;
      downstreamMembers.push({ productionJobId: transition.activeOwnerJobId, allocatedQuantity: requested });
    }

    return createProductionRunInTransaction(tx, { ...input, members: downstreamMembers, sheetPlanPersistence });
  });
}

export async function listProductionRuns(input: {
  organizationId: string;
  orderId?: string | null;
  stationKey?: string | null;
  status?: "queued" | "in_progress" | "done" | null;
}): Promise<ProductionRunListItem[]> {
  const runRows = await db
    .select({
      run: productionRuns,
      orderNumber: orders.orderNumber,
      orderDisplayNumber: orders.displayNumber,
      orderNumberCore: orders.numberCore,
      customerId: customers.id,
      customerName: customers.companyName,
    })
    .from(productionRuns)
    .leftJoin(orders, and(eq(productionRuns.orderId, orders.id), eq(orders.organizationId, input.organizationId)))
    .leftJoin(customers, and(eq(orders.customerId, customers.id), eq(customers.organizationId, input.organizationId)))
    .where(and(
      eq(productionRuns.organizationId, input.organizationId),
      input.orderId ? sql`(${productionRuns.orderId} = ${input.orderId} or exists (
        select 1 from ${productionRunMembers} prm
        join ${orderLineItems} oli on oli.id = prm.order_line_item_id
        where prm.production_run_id = ${productionRuns.id}
          and prm.organization_id = ${input.organizationId}
          and oli.order_id = ${input.orderId}
      ))` : undefined,
      input.stationKey ? eq(productionRuns.stationKey, input.stationKey) : undefined,
    ))
    .orderBy(desc(productionRuns.createdAt), desc(productionRuns.runNumber));

  if (runRows.length === 0) return [];

  const runIds = runRows.map(({ run }) => run.id);
  const memberRows = await db
    .select({
      member: productionRunMembers,
      lineDescription: orderLineItems.description,
      lineQuantity: orderLineItems.quantity,
      lineSortOrder: orderLineItems.sortOrder,
      lineCreatedAt: orderLineItems.createdAt,
      memberOrderId: orderLineItems.orderId,
      memberOrderNumber: orders.orderNumber,
      memberOrderDisplayNumber: orders.displayNumber,
      memberOrderNumberCore: orders.numberCore,
      memberCustomerId: customers.id,
      memberCustomerName: customers.companyName,
    })
    .from(productionRunMembers)
    .innerJoin(orderLineItems, eq(orderLineItems.id, productionRunMembers.orderLineItemId))
    .innerJoin(orders, and(eq(orderLineItems.orderId, orders.id), eq(orders.organizationId, input.organizationId)))
    .leftJoin(customers, and(eq(orders.customerId, customers.id), eq(customers.organizationId, input.organizationId)))
    .where(and(eq(productionRunMembers.organizationId, input.organizationId), inArray(productionRunMembers.productionRunId, runIds)))
    .orderBy(asc(orders.orderNumber), asc(orderLineItems.sortOrder), asc(orderLineItems.createdAt));

  const completedByJob = new Map<string, number>();
  const memberJobIds = Array.from(new Set(memberRows.map(({ member }) => member.productionJobId)));
  if (memberJobIds.length > 0) {
    const completedRows = await db
      .select({
        productionJobId: productionRunMembers.productionJobId,
        quantity: sql<number>`coalesce(sum(${productionRunMembers.completedQuantity}), 0)::int`,
      })
      .from(productionRunMembers)
      .innerJoin(productionRuns, and(eq(productionRuns.id, productionRunMembers.productionRunId), eq(productionRuns.organizationId, input.organizationId)))
      .where(and(
        eq(productionRunMembers.organizationId, input.organizationId),
        inArray(productionRunMembers.productionJobId, memberJobIds),
        sql`${productionRuns.status} in ('completed','completed_with_exceptions')`,
      ))
      .groupBy(productionRunMembers.productionJobId);
    for (const row of completedRows) completedByJob.set(row.productionJobId, Number(row.quantity) || 0);
  }

  const fileRows = await db
    .select({
      id: lineItemFiles.id,
      organizationId: lineItemFiles.organizationId,
      orderId: lineItemFiles.orderId,
      lineItemId: lineItemFiles.lineItemId,
      productionRunId: lineItemFiles.productionRunId,
      prepressSessionId: lineItemFiles.prepressSessionId,
      fileRecordId: lineItemFiles.fileRecordId,
      role: lineItemFiles.role,
      status: lineItemFiles.status,
      tag: lineItemFiles.tag,
      productionQuantity: lineItemFiles.productionQuantity,
      productionGroupId: lineItemFiles.productionGroupId,
      storageBucket: lineItemFiles.storageBucket,
      storagePath: lineItemFiles.storagePath,
      storageKey: lineItemFiles.storageKey,
      originalFilename: lineItemFiles.originalFilename,
      mimeType: lineItemFiles.mimeType,
      sizeBytes: lineItemFiles.sizeBytes,
      supersedesFileId: lineItemFiles.supersedesFileId,
      createdByUserId: lineItemFiles.createdByUserId,
      createdAt: lineItemFiles.createdAt,
      uploaderFirstName: users.firstName,
      uploaderLastName: users.lastName,
      uploaderEmail: users.email,
    })
    .from(lineItemFiles)
    .leftJoin(users, eq(users.id, lineItemFiles.createdByUserId))
    .where(and(
      eq(lineItemFiles.organizationId, input.organizationId),
      inArray(lineItemFiles.productionRunId, runIds),
      eq(lineItemFiles.role, "final"),
    ))
    .orderBy(desc(lineItemFiles.createdAt));
  const runFileSummaries = await buildProductionRunFileSummaries(fileRows as any);
  const filesByRunId = new Map<string, ProductionRunFileSummary[]>();
  for (const file of runFileSummaries) {
    const list = filesByRunId.get(file.productionRunId) ?? [];
    list.push(file);
    filesByRunId.set(file.productionRunId, list);
  }

  const lineNumbersByOrder = new Map<string, Map<string, number>>();
  for (const row of memberRows) {
    let orderMap = lineNumbersByOrder.get(row.memberOrderId);
    if (!orderMap) {
      orderMap = new Map();
      lineNumbersByOrder.set(row.memberOrderId, orderMap);
    }
    if (!orderMap.has(row.member.orderLineItemId)) orderMap.set(row.member.orderLineItemId, orderMap.size + 1);
  }

  const membersByRunId = new Map<string, ProductionRunListItem["members"]>();
  for (const row of memberRows) {
    const previouslyCompletedQuantity = Math.max(0, (completedByJob.get(row.member.productionJobId) ?? 0) - Number(row.member.completedQuantity || 0));
    const remainingAfterRun = Math.max(0, Number(row.lineQuantity || 0) - previouslyCompletedQuantity - Number(row.member.allocatedQuantity || 0));
    const list = membersByRunId.get(row.member.productionRunId) ?? [];
    const memberOrderNumber = String(row.memberOrderDisplayNumber ?? row.memberOrderNumberCore ?? row.memberOrderNumber ?? "");
    list.push({
      id: row.member.id,
      productionJobId: row.member.productionJobId,
      orderLineItemId: row.member.orderLineItemId,
      orderId: row.memberOrderId,
      orderNumber: memberOrderNumber,
      customerId: row.memberCustomerId ?? null,
      customerName: row.memberCustomerName ?? "Unassigned customer",
      lineNumber: lineNumbersByOrder.get(row.memberOrderId)?.get(row.member.orderLineItemId) ?? null,
      description: String(row.lineDescription || `Line item ${row.member.orderLineItemId.slice(-6)}`),
      orderedQuantity: Number(row.lineQuantity) || 0,
      allocatedQuantity: Number(row.member.allocatedQuantity) || 0,
      completedQuantity: Number(row.member.completedQuantity) || 0,
      successfulQuantity: Number(row.member.successfulQuantity ?? row.member.completedQuantity) || 0,
      damagedQuantity: Number(row.member.damagedQuantity) || 0,
      remainingQuantity: Number(row.member.remainingQuantity) || 0,
      outcomeStatus: (row.member.outcomeStatus || "pending") as MemberOutcomeStatus,
      recoveryDisposition: (row.member.recoveryDisposition || null) as RecoveryDisposition | null,
      operatorNote: row.member.operatorNote ?? null,
      outcomeSegments: Array.isArray(row.member.outcomeSegments) ? row.member.outcomeSegments as Array<Record<string, unknown>> : [],
      previouslyCompletedQuantity,
      remainingAfterRun,
    });
    membersByRunId.set(row.member.productionRunId, list);
  }

  return runRows
    .map(({ run, orderNumber, orderDisplayNumber, orderNumberCore, customerId, customerName }) => {
      const boardStatus = toBoardStatus(run.status as RunStatus);
      const members = membersByRunId.get(run.id) ?? [];
      const files = filesByRunId.get(run.id) ?? [];
      const activeFileCount = files.filter((file) => file.status === "active").length;
      const memberOrderNumbers = Array.from(new Set(members.map((member) => member.orderNumber).filter(Boolean)));
      const memberCustomers = Array.from(new Set(members.map((member) => member.customerName).filter(Boolean)));
      const representativeOrderNumber = String(orderDisplayNumber ?? orderNumberCore ?? orderNumber ?? "");
      return {
        kind: "production_run" as const,
        id: run.id,
        runId: run.id,
        runNumber: Number(run.runNumber),
        displayNumber: `PR-${String(run.runNumber).padStart(4, "0")}`,
        orderId: run.orderId ?? null,
        orderNumber: representativeOrderNumber || (memberOrderNumbers.length === 1 ? memberOrderNumbers[0] : memberOrderNumbers.length > 1 ? "Multiple orders" : ""),
        customerId: customerId ?? null,
        customerName: customerName ?? (memberCustomers.length === 1 ? memberCustomers[0] : memberCustomers.length > 1 ? "Multiple customers" : "Unassigned customer"),
        stationKey: run.stationKey,
        productionFileStrategy: run.productionFileStrategy ?? "staff_prepared",
        status: boardStatus,
        runStatus: run.status as RunStatus,
        plannedSheetCount: run.plannedSheetCount ?? null,
        nominalPiecesPerSheet: run.nominalPiecesPerSheet ?? null,
        sheetWidth: run.sheetWidth ? String(run.sheetWidth) : null,
        sheetHeight: run.sheetHeight ? String(run.sheetHeight) : null,
        sheetPlanInputSnapshot: run.sheetPlanInputSnapshot ?? null,
        calculatedSheetPlanSnapshot: run.calculatedSheetPlanSnapshot ?? null,
        effectiveSheetPlanSnapshot: run.effectiveSheetPlanSnapshot ?? null,
        sheetPlanOverrideReason: run.sheetPlanOverrideReason ?? null,
        sheetPlanOverrideByUserId: run.sheetPlanOverrideByUserId ?? null,
        sheetPlanOverrideAt: run.sheetPlanOverrideAt ?? null,
        sheetPlanCalculatorVersion: run.sheetPlanCalculatorVersion ?? null,
        notes: run.notes ?? null,
        memberCount: members.length,
        totalAllocatedQuantity: members.reduce((sum, member) => sum + member.allocatedQuantity, 0),
        fileCount: activeFileCount,
        replacementRequired: (run.productionFileStrategy ?? "staff_prepared") === "staff_prepared" && activeFileCount === 0,
        files,
        members,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      };
    })
    .filter((run) => !input.status || run.status === input.status);
}

export async function listProductionRunFiles(input: {
  organizationId: string;
  runId: string;
  includeHistory?: boolean;
}) {
  const run = await getScopedProductionRun(input);
  const rows = await db
    .select({
      id: lineItemFiles.id,
      organizationId: lineItemFiles.organizationId,
      orderId: lineItemFiles.orderId,
      lineItemId: lineItemFiles.lineItemId,
      productionRunId: lineItemFiles.productionRunId,
      prepressSessionId: lineItemFiles.prepressSessionId,
      fileRecordId: lineItemFiles.fileRecordId,
      role: lineItemFiles.role,
      status: lineItemFiles.status,
      tag: lineItemFiles.tag,
      productionQuantity: lineItemFiles.productionQuantity,
      productionGroupId: lineItemFiles.productionGroupId,
      storageBucket: lineItemFiles.storageBucket,
      storagePath: lineItemFiles.storagePath,
      storageKey: lineItemFiles.storageKey,
      originalFilename: lineItemFiles.originalFilename,
      mimeType: lineItemFiles.mimeType,
      sizeBytes: lineItemFiles.sizeBytes,
      supersedesFileId: lineItemFiles.supersedesFileId,
      createdByUserId: lineItemFiles.createdByUserId,
      createdAt: lineItemFiles.createdAt,
      uploaderFirstName: users.firstName,
      uploaderLastName: users.lastName,
      uploaderEmail: users.email,
    })
    .from(lineItemFiles)
    .leftJoin(users, eq(users.id, lineItemFiles.createdByUserId))
    .where(and(
      eq(lineItemFiles.organizationId, input.organizationId),
      eq(lineItemFiles.productionRunId, input.runId),
      eq(lineItemFiles.role, "final"),
      input.includeHistory ? undefined : eq(lineItemFiles.status, "active"),
    ))
    .orderBy(desc(lineItemFiles.createdAt));
  const files = await buildProductionRunFileSummaries(rows as any);
  const activeCount = files.filter((file) => file.status === "active").length;
  return { files, activeCount, replacementRequired: (run.productionFileStrategy ?? "staff_prepared") === "staff_prepared" && activeCount === 0 };
}

export async function uploadProductionRunFile(input: {
  organizationId: string;
  actorUserId: string;
  runId: string;
  buffer: Buffer;
  originalFilename: string;
  mimeType: string;
}) {
  const run = await getScopedProductionRun(input);
  if (run.status === "completed" || run.status === "completed_with_exceptions" || run.status === "canceled") {
    throw new ProductionRunError("PRODUCTION_RUN_TERMINAL", "Completed or canceled production runs cannot receive new shared files.", 409);
  }
  const representative = await getRepresentativeRunMember(input);
  const [representativeLine] = await db
    .select({ orderId: orderLineItems.orderId })
    .from(orderLineItems)
    .innerJoin(orders, and(eq(orderLineItems.orderId, orders.id), eq(orders.organizationId, input.organizationId)))
    .where(eq(orderLineItems.id, representative.orderLineItemId))
    .limit(1);
  if (!representativeLine) throw new ProductionRunError("PRODUCTION_RUN_MEMBER_NOT_FOUND", "Representative production run member was not found.", 404);
  const uploaded = await uploadLineItemFile({
    organizationId: input.organizationId,
    orderId: representativeLine.orderId,
    lineItemId: representative.orderLineItemId,
    productionRunId: run.id,
    role: "final",
    tag: "nested_run",
    buffer: input.buffer,
    originalFilename: input.originalFilename,
    mimeType: input.mimeType,
    createdByUserId: input.actorUserId,
  });
  queueLineItemFilePreviewRepair({ fileId: uploaded.id, organizationId: input.organizationId, actorUserId: input.actorUserId });
  const bridge = await enqueueFinalProductionFileCopy({ organizationId: input.organizationId, file: uploaded });
  await insertRunAudit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    runId: run.id,
    runNumber: Number(run.runNumber),
    description: "Shared production run file uploaded",
    newValues: { fileId: uploaded.id, filename: uploaded.originalFilename, sizeBytes: uploaded.sizeBytes, localBridgeCopyJobId: bridge.copyJobId, localBridgeEnqueued: bridge.enqueued },
  });
  if (bridge.copyJobId) {
    await insertRunAudit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      runId: run.id,
      runNumber: Number(run.runNumber),
      description: bridge.enqueued ? "Local Bridge copy enqueued for shared run file" : "Local Bridge copy already existed for shared run file",
      newValues: { fileId: uploaded.id, copyJobId: bridge.copyJobId, enqueued: bridge.enqueued },
    });
  }
  return { file: uploaded, localBridge: bridge };
}

async function ensureRunFileSafety(input: {
  organizationId: string;
  runId: string;
  fileId: string;
  actorUserId: string;
  actorRole: string;
  isAdmin: boolean;
  reason?: string | null;
  action: "replace" | "retire";
}) {
  return db.transaction(async (tx) => {
    const run = await getScopedProductionRun(input, tx);
    const [file] = await tx.select().from(lineItemFiles).where(and(
      eq(lineItemFiles.id, input.fileId),
      eq(lineItemFiles.organizationId, input.organizationId),
      eq(lineItemFiles.productionRunId, input.runId),
      eq(lineItemFiles.role, "final"),
    )).limit(1);
    if (!file) throw new ProductionRunError("PRODUCTION_RUN_FILE_NOT_FOUND", "Shared production run file was not found.", 404);
    if (file.status !== "active") throw new ProductionRunError("PRODUCTION_RUN_FILE_NOT_ACTIVE", "Shared production run file is no longer active.", 409);
    if (run.status === "in_production") throw new ProductionRunError("PRODUCTION_RUN_FILE_IN_ACTIVE_USE", "This shared production file is in active use by production.", 409);
    if ((run.status === "completed" || run.status === "completed_with_exceptions") && !input.isAdmin) throw new ProductionRunError("COMPLETED_FILE_DELETE_PERMISSION_REQUIRED", "Administrator permission is required to change files on a completed production run.", 403);
    if ((run.status === "completed" || run.status === "completed_with_exceptions") && input.action === "retire" && !input.reason?.trim()) throw new ProductionRunError("DELETION_REASON_REQUIRED", "A reason is required when retiring a completed production run file.", 400);
    const canRemoveBeforeCompletion = input.isAdmin || input.actorRole === "owner" || input.actorRole === "admin" || input.actorRole === "manager";
    if (run.status !== "completed" && !canRemoveBeforeCompletion) throw new ProductionRunError("PRODUCTION_FILE_DELETE_FORBIDDEN", "You do not have permission to change production files.", 403);
    const bridgeJobs = await tx.select({ id: localFileCopyJobs.id, status: localFileCopyJobs.status }).from(localFileCopyJobs).where(and(eq(localFileCopyJobs.organizationId, input.organizationId), eq(localFileCopyJobs.sourceFileId, file.id)));
    if (bridgeJobs.some((job) => job.status === "claimed")) throw new ProductionRunError("LOCAL_BRIDGE_COPY_IN_PROGRESS", "A Local Bridge copy is in progress for this production file.", 409);
    const pendingIds = bridgeJobs.filter((job) => job.status === "pending").map((job) => job.id);
    if (pendingIds.length) {
      await tx.update(localFileCopyJobs).set({
        status: "canceled",
        lastError: input.action === "replace" ? "Canceled because the shared production run file was replaced." : "Canceled because the shared production run file was retired.",
        updatedAt: new Date(),
      }).where(and(eq(localFileCopyJobs.organizationId, input.organizationId), eq(localFileCopyJobs.sourceFileId, file.id), eq(localFileCopyJobs.status, "pending")));
    }
    return { run, file, pendingIds };
  });
}

export async function replaceProductionRunFile(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: string;
  isAdmin: boolean;
  runId: string;
  fileId: string;
  buffer: Buffer;
  originalFilename: string;
  mimeType: string;
}) {
  const { run, file, pendingIds } = await ensureRunFileSafety({ ...input, action: "replace" });
  const replacement = await uploadLineItemFile({
    organizationId: input.organizationId,
    orderId: file.orderId,
    lineItemId: file.lineItemId,
    productionRunId: run.id,
    prepressSessionId: file.prepressSessionId ?? undefined,
    role: "final",
    tag: file.tag ?? "nested_run",
    productionQuantity: file.productionQuantity,
    productionGroupId: file.productionGroupId,
    buffer: input.buffer,
    originalFilename: input.originalFilename,
    mimeType: input.mimeType,
    createdByUserId: input.actorUserId,
  });
  await db.update(lineItemFiles).set({ status: "superseded" }).where(and(eq(lineItemFiles.id, file.id), eq(lineItemFiles.organizationId, input.organizationId)));
  await db.update(lineItemFiles).set({ supersedesFileId: file.id }).where(and(eq(lineItemFiles.id, replacement.id), eq(lineItemFiles.organizationId, input.organizationId)));
  queueLineItemFilePreviewRepair({ fileId: replacement.id, organizationId: input.organizationId, actorUserId: input.actorUserId });
  const bridge = await enqueueFinalProductionFileCopy({ organizationId: input.organizationId, file: replacement });
  await insertRunAudit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    runId: run.id,
    runNumber: Number(run.runNumber),
    description: "Shared production run file replaced",
    oldValues: { fileId: file.id, filename: file.originalFilename, status: "active" },
    newValues: { fileId: replacement.id, filename: replacement.originalFilename, supersedesFileId: file.id, pendingBridgeJobsCanceled: pendingIds.length, localBridgeCopyJobId: bridge.copyJobId },
  });
  return { file: replacement, supersededFileId: file.id, pendingBridgeJobsCanceled: pendingIds.length, localBridge: bridge };
}

export async function retireProductionRunFile(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: string;
  isAdmin: boolean;
  runId: string;
  fileId: string;
  reason?: string | null;
}) {
  const { run, file, pendingIds } = await ensureRunFileSafety({ ...input, action: "retire" });
  await db.update(lineItemFiles).set({ status: "retired" }).where(and(eq(lineItemFiles.id, file.id), eq(lineItemFiles.organizationId, input.organizationId), eq(lineItemFiles.status, "active")));
  const [remaining] = await db.select({ count: sql<number>`count(*)::int` }).from(lineItemFiles).where(and(
    eq(lineItemFiles.organizationId, input.organizationId),
    eq(lineItemFiles.productionRunId, run.id),
    eq(lineItemFiles.role, "final"),
    eq(lineItemFiles.status, "active"),
  ));
  const replacementRequired = Number(remaining?.count ?? 0) === 0;
  await insertRunAudit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    runId: run.id,
    runNumber: Number(run.runNumber),
    description: replacementRequired ? "Shared production run file retired; replacement required" : "Shared production run file retired",
    oldValues: { fileId: file.id, filename: file.originalFilename, status: "active" },
    newValues: { fileId: file.id, status: "retired", reason: input.reason ?? null, pendingBridgeJobsCanceled: pendingIds.length, replacementRequired },
  });
  return { fileId: file.id, replacementRequired, pendingBridgeJobsCanceled: pendingIds.length };
}

export async function downloadProductionRunFile(input: {
  organizationId: string;
  actorUserId: string | null;
  runId: string;
  fileId: string;
  inline?: boolean;
  res: Response;
}) {
  const [row] = await db
    .select({ run: productionRuns, file: lineItemFiles })
    .from(productionRuns)
    .innerJoin(lineItemFiles, and(eq(lineItemFiles.productionRunId, productionRuns.id), eq(lineItemFiles.organizationId, productionRuns.organizationId)))
    .where(and(
      eq(productionRuns.id, input.runId),
      eq(productionRuns.organizationId, input.organizationId),
      eq(lineItemFiles.id, input.fileId),
      eq(lineItemFiles.role, "final"),
      eq(lineItemFiles.status, "active"),
    ))
    .limit(1);
  if (!row) {
    await db.insert(auditLogs).values({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      actionType: "READ",
      entityType: "production_run",
      entityId: input.runId,
      description: "Shared production run file download authorization failed",
      newValues: { fileId: input.fileId, reason: "not_found_or_not_active" },
    } as any).catch(() => undefined);
    throw new ProductionRunError("PRODUCTION_RUN_FILE_NOT_FOUND", "Shared production run file was not found.", 404);
  }
  await downloadLineItemFile(input.fileId, input.organizationId, input.res, { inline: input.inline });
}

function deriveMemberOutcomeStatus(input: {
  allocatedQuantity: number;
  successfulQuantity: number;
  damagedQuantity: number;
  remainingQuantity: number;
  outcomeStatus?: MemberOutcomeStatus;
  recoveryDisposition?: RecoveryDisposition | null;
}): MemberOutcomeStatus {
  if (input.outcomeStatus) return input.outcomeStatus;
  if (input.remainingQuantity <= 0 && input.successfulQuantity >= input.allocatedQuantity && input.damagedQuantity <= 0) return "completed";
  if (input.remainingQuantity <= 0 && input.recoveryDisposition === "cancel_remaining") return input.successfulQuantity > 0 ? "partially_completed" : "cancelled";
  if (input.recoveryDisposition === "return_to_prepress") return "return_to_prepress";
  if (input.recoveryDisposition === "requires_reprint" || input.recoveryDisposition === "return_to_production_queue") return "requires_reprint";
  if (input.recoveryDisposition === "hold_for_review") return "hold_for_review";
  if (input.successfulQuantity > 0 || input.damagedQuantity > 0) return "partially_completed";
  return "failed";
}

function deriveRunStatusFromMembers(members: Array<{
  allocatedQuantity: number;
  successfulQuantity: number;
  damagedQuantity: number;
  remainingQuantity: number;
  outcomeStatus: string | null;
  recoveryDisposition: string | null;
}>): RunStatus {
  if (!members.length) return "in_production";
  const allCompleted = members.every((member) => Number(member.remainingQuantity) <= 0 && String(member.outcomeStatus) === "completed");
  if (allCompleted) return "completed";
  const resolvedStatuses = new Set(["completed", "failed", "requires_reprint", "return_to_prepress", "cancelled", "hold_for_review"]);
  const resolvedDispositions = new Set(["return_to_prepress", "return_to_production_queue", "requires_reprint", "hold_for_review", "cancel_remaining"]);
  const allResolved = members.every((member) => (
    Number(member.remainingQuantity) <= 0
    || resolvedStatuses.has(String(member.outcomeStatus || ""))
    || resolvedDispositions.has(String(member.recoveryDisposition || ""))
  ));
  if (allResolved) return "completed_with_exceptions";
  const anyReported = members.some((member) => (
    Number(member.successfulQuantity) > 0
    || Number(member.damagedQuantity) > 0
    || String(member.outcomeStatus || "pending") !== "pending"
  ));
  return anyReported ? "partially_completed" : "in_production";
}

async function recordProductionRunOutcomeInTransaction(tx: any, input: {
  organizationId: string;
  runId: string;
  actorUserId: string;
  idempotencyKey?: string | null;
  members: MemberOutcomeInput[];
}) {
  if (!input.members.length) throw new ProductionRunError("PRODUCTION_RUN_MEMBERS_REQUIRED", "Select at least one run member outcome.");
  const [run] = await tx.select().from(productionRuns).where(and(eq(productionRuns.id, input.runId), eq(productionRuns.organizationId, input.organizationId))).limit(1);
  if (!run) throw new ProductionRunError("PRODUCTION_RUN_NOT_FOUND", "Production run was not found.", 404);
  if (run.status === "canceled" || run.status === "completed" || run.status === "completed_with_exceptions") {
    const idempotencyKey = input.idempotencyKey?.trim();
    if (!idempotencyKey) throw new ProductionRunError("PRODUCTION_RUN_TERMINAL", "Completed or canceled production runs cannot receive new outcomes.", 409);
    const existing = await tx.select().from(productionRunMembers).where(and(
      eq(productionRunMembers.productionRunId, run.id),
      eq(productionRunMembers.organizationId, input.organizationId),
      inArray(productionRunMembers.id, input.members.map((member) => member.memberId)),
    ));
    if (existing.length === input.members.length && existing.every((member: any) => member.lastOutcomeIdempotencyKey === idempotencyKey)) return run;
    throw new ProductionRunError("PRODUCTION_RUN_TERMINAL", "Completed or canceled production runs cannot receive new outcomes.", 409);
  }
  const memberIds = Array.from(new Set(input.members.map((member) => member.memberId).filter(Boolean)));
  if (memberIds.length !== input.members.length) throw new ProductionRunError("PRODUCTION_RUN_DUPLICATE_MEMBER", "A run member may only appear once in an outcome submission.");
  const idempotencyKey = input.idempotencyKey?.trim() || null;
  const memberRows = await tx
    .select({ member: productionRunMembers, line: orderLineItems })
    .from(productionRunMembers)
    .innerJoin(orderLineItems, eq(orderLineItems.id, productionRunMembers.orderLineItemId))
    .where(and(eq(productionRunMembers.organizationId, input.organizationId), eq(productionRunMembers.productionRunId, run.id), inArray(productionRunMembers.id, memberIds)));
  if (memberRows.length !== memberIds.length) throw new ProductionRunError("PRODUCTION_RUN_MEMBER_NOT_FOUND", "One or more production run members were not found.", 404);
  if (idempotencyKey && memberRows.every(({ member }: any) => member.lastOutcomeIdempotencyKey === idempotencyKey)) return run;

  const now = new Date();
  for (const { member, line } of memberRows) {
    const outcome = input.members.find((candidate) => candidate.memberId === member.id)!;
    const allocatedQuantity = Number(member.allocatedQuantity) || 0;
    const successfulQuantity = Number(outcome.successfulQuantity);
    const damagedQuantity = Number(outcome.damagedQuantity ?? 0);
    const remainingQuantity = outcome.remainingQuantity == null
      ? Math.max(0, allocatedQuantity - successfulQuantity - damagedQuantity)
      : Number(outcome.remainingQuantity);
    if (![successfulQuantity, damagedQuantity, remainingQuantity].every((value) => Number.isInteger(value) && value >= 0)) {
      throw new ProductionRunError("PRODUCTION_RUN_OUTCOME_INVALID", "Outcome quantities must be whole numbers at or above zero.", 400);
    }
    if (successfulQuantity + damagedQuantity + remainingQuantity > allocatedQuantity) {
      throw new ProductionRunError("PRODUCTION_RUN_OUTCOME_INVALID", "Successful, damaged, and remaining quantities cannot exceed the allocated quantity.", 400);
    }
    if (successfulQuantity < Number(member.successfulQuantity ?? member.completedQuantity ?? 0) || damagedQuantity < Number(member.damagedQuantity ?? 0)) {
      throw new ProductionRunError("PRODUCTION_RUN_OUTCOME_CONFIRMED", "Confirmed successful or damaged quantities cannot be reduced by a later outcome.", 409);
    }
    const recoveryDisposition = outcome.recoveryDisposition ?? null;
    const outcomeStatus = deriveMemberOutcomeStatus({ allocatedQuantity, successfulQuantity, damagedQuantity, remainingQuantity, outcomeStatus: outcome.outcomeStatus, recoveryDisposition });
    const outcomeSegments = Array.isArray(outcome.segments) ? outcome.segments : [];
    await tx.update(productionRunMembers).set({
      successfulQuantity,
      damagedQuantity,
      remainingQuantity,
      completedQuantity: successfulQuantity,
      outcomeStatus,
      recoveryDisposition,
      operatorNote: outcome.operatorNote?.trim() || null,
      outcomeSegments,
      lastOutcomeIdempotencyKey: idempotencyKey,
      lastOutcomeAt: now,
      updatedAt: now,
    }).where(and(eq(productionRunMembers.id, member.id), eq(productionRunMembers.organizationId, input.organizationId)));

    const [previouslyCompleted] = await tx.select({ quantity: sql<number>`coalesce(sum(${productionRunMembers.completedQuantity}), 0)::int` })
      .from(productionRunMembers)
      .innerJoin(productionRuns, and(eq(productionRuns.id, productionRunMembers.productionRunId), eq(productionRuns.organizationId, input.organizationId)))
      .where(and(
        eq(productionRunMembers.organizationId, input.organizationId),
        eq(productionRunMembers.productionJobId, member.productionJobId),
        sql`${productionRuns.status} in ('completed','completed_with_exceptions')`,
        sql`${productionRuns.id} <> ${run.id}`,
      ));
    const totalSuccessfulQuantity = Number(previouslyCompleted?.quantity ?? 0) + successfulQuantity;
    if (remainingQuantity <= 0 && outcomeStatus === "completed" && totalSuccessfulQuantity >= Number(line.quantity ?? 0)) {
      await tx.update(productionJobs).set({ status: "done", completedAt: now, completedByUserId: input.actorUserId, updatedAt: now }).where(and(eq(productionJobs.id, member.productionJobId), eq(productionJobs.organizationId, input.organizationId)));
    } else if (successfulQuantity > 0 || damagedQuantity > 0 || remainingQuantity > 0) {
      await tx.update(productionJobs).set({ status: "in_progress", updatedAt: now }).where(and(eq(productionJobs.id, member.productionJobId), eq(productionJobs.organizationId, input.organizationId)));
    }

    await tx.insert(productionEvents).values({
      organizationId: input.organizationId,
      productionJobId: member.productionJobId,
      orderLineItemId: member.orderLineItemId,
      orderId: line.orderId,
      actorUserId: input.actorUserId,
      type: "note",
      payload: {
        eventType: "production_run_member_outcome_recorded",
        productionRunId: run.id,
        runNumber: run.runNumber,
        productionRunMemberId: member.id,
        allocatedQuantity,
        successfulQuantity,
        damagedQuantity,
        remainingQuantity,
        outcomeStatus,
        recoveryDisposition,
        operatorNote: outcome.operatorNote ?? null,
        segments: outcomeSegments,
        idempotencyKey,
      },
    });
  }

  const updatedMembers = await tx.select().from(productionRunMembers).where(and(eq(productionRunMembers.productionRunId, run.id), eq(productionRunMembers.organizationId, input.organizationId)));
  const nextStatus = deriveRunStatusFromMembers(updatedMembers as any);
  const [updatedRun] = await tx.update(productionRuns).set({
    status: nextStatus,
    completedAt: nextStatus === "completed" || nextStatus === "completed_with_exceptions" ? now : run.completedAt,
    updatedAt: now,
  }).where(and(eq(productionRuns.id, run.id), eq(productionRuns.organizationId, input.organizationId))).returning();
  await tx.insert(auditLogs).values({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    actionType: "UPDATE",
    entityType: "production_run",
    entityId: run.id,
    entityName: `PR-${String(run.runNumber).padStart(4, "0")}`,
    description: "Production run member outcomes recorded",
    oldValues: { status: run.status },
    newValues: { status: nextStatus, memberCount: input.members.length, idempotencyKey },
  } as any);
  return updatedRun;
}

export async function recordProductionRunOutcome(input: {
  organizationId: string;
  runId: string;
  actorUserId: string;
  idempotencyKey?: string | null;
  members: MemberOutcomeInput[];
}) {
  return db.transaction(async (tx) => recordProductionRunOutcomeInTransaction(tx, input));
}

export async function transitionProductionRun(input: { organizationId: string; runId: string; actorUserId: string; action: "release" | "start" | "complete" | "cancel"; reason?: string | null }) {
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(productionRuns).where(and(eq(productionRuns.id, input.runId), eq(productionRuns.organizationId, input.organizationId))).limit(1);
    if (!run) throw new ProductionRunError("PRODUCTION_RUN_NOT_FOUND", "Production run was not found.", 404);
    if (input.action === "complete" && (run.status === "completed" || run.status === "completed_with_exceptions")) return run;
    if (run.status === "completed" || run.status === "completed_with_exceptions" || run.status === "canceled") throw new ProductionRunError("PRODUCTION_RUN_TERMINAL", "Completed or canceled production runs cannot be changed.", 409);
    const now = new Date();
    const next: Partial<typeof productionRuns.$inferInsert> = input.action === "release" ? { status: "ready_for_production", releasedAt: now } : input.action === "start" ? { status: "in_production", startedAt: now } : input.action === "cancel" ? { status: "canceled", canceledAt: now, canceledByUserId: input.actorUserId, cancelReason: input.reason?.trim() || null } : { status: "completed", completedAt: now };
    if (input.action === "release") {
      if (run.status !== "draft") throw new ProductionRunError("PRODUCTION_RUN_NOT_RELEASABLE", "Only draft production runs can be released.", 409);
      const activeFileCount = await countActiveProductionRunFiles(tx, { organizationId: input.organizationId, runId: run.id });
      if (run.productionFileStrategy !== "rip_managed" && activeFileCount <= 0) {
        throw new ProductionRunError("PRODUCTION_RUN_FILE_REQUIRED", "Nested production file required before release.", 409);
      }
    }
    if (input.action === "complete") {
      if (run.status !== "ready_for_production" && run.status !== "in_production") throw new ProductionRunError("PRODUCTION_RUN_NOT_RELEASABLE", "Release the production run before completing it.", 409);
      const activeFileCount = await countActiveProductionRunFiles(tx, { organizationId: input.organizationId, runId: run.id });
      if (run.productionFileStrategy !== "rip_managed" && activeFileCount <= 0) {
        throw new ProductionRunError("PRODUCTION_RUN_FILE_REQUIRED", "Upload or replace the nested final production file before completing this run.", 409);
      }
      const members = await tx.select().from(productionRunMembers).where(and(eq(productionRunMembers.productionRunId, run.id), eq(productionRunMembers.organizationId, input.organizationId)));
      if (!members.length) throw new ProductionRunError("PRODUCTION_RUN_MEMBERS_REQUIRED", "A production run must have members.");
      return recordProductionRunOutcomeInTransaction(tx, {
        organizationId: input.organizationId,
        runId: run.id,
        actorUserId: input.actorUserId,
        idempotencyKey: `complete:${run.id}`,
        members: members.map((member: any) => ({
          memberId: member.id,
          successfulQuantity: Number(member.allocatedQuantity) || 0,
          damagedQuantity: 0,
          remainingQuantity: 0,
          outcomeStatus: "completed" as const,
          recoveryDisposition: "none" as const,
          operatorNote: input.reason ?? null,
        })),
      });
    }
    const [updated] = await tx.update(productionRuns).set({ ...next, updatedAt: now }).where(and(eq(productionRuns.id, run.id), eq(productionRuns.organizationId, input.organizationId))).returning();
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      actionType: "UPDATE",
      entityType: "production_run",
      entityId: run.id,
      entityName: `PR-${String(run.runNumber).padStart(4, "0")}`,
      description: `Production run ${input.action}`,
      oldValues: { status: run.status },
      newValues: { status: updated.status, reason: input.reason ?? null },
    } as any);
    return updated;
  });
}
