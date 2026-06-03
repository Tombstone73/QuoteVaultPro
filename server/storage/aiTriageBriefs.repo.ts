import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  auditLogs,
  bugReports,
  feedbackAiTriageBriefs,
  type FeedbackAiTriageBrief,
} from "@shared/schema";
import {
  getIncludedTriageFeedbackStatuses,
  type AiTriageBriefDto,
  type AiTriageBriefResult,
} from "@shared/aiTriageBriefContracts";

export interface TriageBriefFilters {
  status?: string;
  severity?: string;
  type?: "bug" | "feature" | "all";
  limit?: number;
}

export interface TriageBriefReportRow {
  id: string;
  referenceNumber: string;
  type: "bug" | "feature";
  title: string;
  description: string;
  severity: string;
  status: string;
  url: string;
  createdAt: Date | null;
  createdByEmail: string;
  metadata: Record<string, unknown>;
}

export interface CreatePendingTriageBriefInput {
  orgId: string;
  requestedByUserId: string | null;
  requestedByEmail: string;
  promptVersion: string;
  filtersSnapshot: Record<string, unknown>;
  reportSnapshot: unknown;
}

export interface CompleteTriageBriefInput {
  orgId: string;
  briefId: string;
  provider: string;
  model: string;
  mode: string;
  result: AiTriageBriefResult;
  providerMetadata: Record<string, unknown>;
  usageMetadata: Record<string, unknown>;
}

export interface FailTriageBriefInput {
  orgId: string;
  briefId: string;
  provider?: string | null;
  model?: string | null;
  mode?: string | null;
  errorCode: string;
  errorMessage: string;
  validationErrors?: unknown;
}

export interface AuditTriageBriefInput {
  orgId: string;
  userId: string | null;
  userEmail: string;
  actionType: "CREATE" | "UPDATE";
  entityId: string;
  entityName: string;
  description: string;
  newValues?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AiTriageBriefsRepository {
  listReportsForBrief(orgId: string, filters: TriageBriefFilters): Promise<TriageBriefReportRow[]>;
  listBriefs(orgId: string, limit: number): Promise<FeedbackAiTriageBrief[]>;
  getBriefById(orgId: string, briefId: string): Promise<FeedbackAiTriageBrief | null>;
  createPendingBrief(input: CreatePendingTriageBriefInput): Promise<FeedbackAiTriageBrief>;
  markProcessing(orgId: string, briefId: string, provider: string, model: string, mode: string): Promise<FeedbackAiTriageBrief | null>;
  completeBrief(input: CompleteTriageBriefInput): Promise<FeedbackAiTriageBrief | null>;
  failBrief(input: FailTriageBriefInput): Promise<FeedbackAiTriageBrief | null>;
  recoverStaleActiveBriefs(orgId: string, staleBefore: Date, reason: string): Promise<FeedbackAiTriageBrief[]>;
  createAuditLog(input: AuditTriageBriefInput): Promise<void>;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function confidenceToNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function toAiTriageBriefDto(row: FeedbackAiTriageBrief): AiTriageBriefDto {
  return {
    id: row.id,
    orgId: row.orgId,
    status: row.status as AiTriageBriefDto["status"],
    requestedByEmail: row.requestedByEmail,
    filtersSnapshot: row.filtersSnapshot,
    reportSnapshot: row.reportSnapshot,
    provider: row.provider,
    model: row.model,
    mode: row.mode,
    promptVersion: row.promptVersion,
    result: row.result ?? null,
    summary: row.summary,
    topRisks: row.topRisks ?? null,
    topFeatures: row.topFeatures ?? null,
    recommendedPriorities: row.recommendedPriorities ?? null,
    duplicateSignals: row.duplicateSignals ?? null,
    workflowRisks: row.workflowRisks ?? null,
    revenueRisks: row.revenueRisks ?? null,
    unknowns: row.unknowns ?? null,
    confidence: confidenceToNumber(row.confidence),
    providerMetadata: row.providerMetadata ?? null,
    usageMetadata: row.usageMetadata ?? null,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: toIso(row.createdAt) ?? new Date().toISOString(),
    startedAt: toIso(row.startedAt),
    completedAt: toIso(row.completedAt),
  };
}

export class DrizzleAiTriageBriefsRepository implements AiTriageBriefsRepository {
  async listReportsForBrief(orgId: string, filters: TriageBriefFilters): Promise<TriageBriefReportRow[]> {
    // Normal triage briefs are active-planning artifacts only:
    // open = active, in_review = active/evaluating. resolved/closed require a
    // future explicit historical mode and are intentionally excluded here.
    const includedStatuses = getIncludedTriageFeedbackStatuses(filters.status);
    const conditions = [
      eq(bugReports.orgId, orgId),
      includedStatuses.length === 0
        ? sql`false`
        : includedStatuses.length === 1
        ? eq(bugReports.status, includedStatuses[0])
        : inArray(bugReports.status, includedStatuses),
    ];
    if (filters.severity && filters.severity !== "all") {
      conditions.push(eq(bugReports.severity, filters.severity));
    }
    if (filters.type && filters.type !== "all") {
      conditions.push(eq(bugReports.type, filters.type));
    }

    const rows = await db
      .select({
        id: bugReports.id,
        referenceNumber: bugReports.referenceNumber,
        type: bugReports.type,
        title: bugReports.title,
        description: bugReports.description,
        severity: bugReports.severity,
        status: bugReports.status,
        url: bugReports.url,
        createdAt: bugReports.createdAt,
        createdByEmail: bugReports.createdByEmail,
        metadata: bugReports.metadata,
      })
      .from(bugReports)
      .where(and(...conditions))
      .orderBy(desc(bugReports.createdAt))
      .limit(Math.min(Math.max(filters.limit ?? 100, 1), 200));

    return rows.map((row) => ({
      ...row,
      type: row.type as "bug" | "feature",
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
    }));
  }

  async listBriefs(orgId: string, limit: number): Promise<FeedbackAiTriageBrief[]> {
    return db
      .select()
      .from(feedbackAiTriageBriefs)
      .where(eq(feedbackAiTriageBriefs.orgId, orgId))
      .orderBy(desc(feedbackAiTriageBriefs.createdAt))
      .limit(Math.min(Math.max(limit, 1), 50));
  }

  async getBriefById(orgId: string, briefId: string): Promise<FeedbackAiTriageBrief | null> {
    const [row] = await db
      .select()
      .from(feedbackAiTriageBriefs)
      .where(and(eq(feedbackAiTriageBriefs.orgId, orgId), eq(feedbackAiTriageBriefs.id, briefId)))
      .limit(1);
    return row ?? null;
  }

  async createPendingBrief(input: CreatePendingTriageBriefInput): Promise<FeedbackAiTriageBrief> {
    const [row] = await db
      .insert(feedbackAiTriageBriefs)
      .values({
        orgId: input.orgId,
        status: "pending",
        requestedByUserId: input.requestedByUserId,
        requestedByEmail: input.requestedByEmail,
        promptVersion: input.promptVersion,
        filtersSnapshot: input.filtersSnapshot,
        reportSnapshot: input.reportSnapshot,
      })
      .returning();
    return row;
  }

  async markProcessing(orgId: string, briefId: string, provider: string, model: string, mode: string): Promise<FeedbackAiTriageBrief | null> {
    const [updated] = await db
      .update(feedbackAiTriageBriefs)
      .set({
        status: "processing",
        provider,
        model,
        mode,
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(feedbackAiTriageBriefs.orgId, orgId),
        eq(feedbackAiTriageBriefs.id, briefId),
        eq(feedbackAiTriageBriefs.status, "pending"),
      ))
      .returning();
    return updated ?? null;
  }

  async completeBrief(input: CompleteTriageBriefInput): Promise<FeedbackAiTriageBrief | null> {
    const topRisks = [
      ...input.result.topOperationalRisks,
      ...input.result.topWorkflowRisks,
      ...input.result.topRevenueRisks,
    ];
    const [updated] = await db
      .update(feedbackAiTriageBriefs)
      .set({
        status: "completed",
        provider: input.provider,
        model: input.model,
        mode: input.mode,
        providerMetadata: input.providerMetadata,
        usageMetadata: input.usageMetadata,
        result: input.result,
        summary: input.result.executiveSummary,
        topRisks,
        topFeatures: input.result.topFeatureRequests,
        recommendedPriorities: input.result.suggestedPriorityOrder,
        duplicateSignals: input.result.duplicateSignals,
        workflowRisks: input.result.topWorkflowRisks,
        revenueRisks: input.result.topRevenueRisks,
        unknowns: input.result.unknowns,
        confidence: input.result.confidence.toFixed(3),
        errorCode: null,
        errorMessage: null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(feedbackAiTriageBriefs.orgId, input.orgId), eq(feedbackAiTriageBriefs.id, input.briefId)))
      .returning();
    return updated ?? null;
  }

  async failBrief(input: FailTriageBriefInput): Promise<FeedbackAiTriageBrief | null> {
    const [updated] = await db
      .update(feedbackAiTriageBriefs)
      .set({
        status: "failed",
        provider: input.provider ?? undefined,
        model: input.model ?? undefined,
        mode: input.mode ?? undefined,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        usageMetadata: input.validationErrors == null ? undefined : { validationErrors: input.validationErrors },
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(feedbackAiTriageBriefs.orgId, input.orgId),
        eq(feedbackAiTriageBriefs.id, input.briefId),
        inArray(feedbackAiTriageBriefs.status, ["pending", "processing"]),
      ))
      .returning();
    return updated ?? null;
  }

  async recoverStaleActiveBriefs(orgId: string, staleBefore: Date, reason: string): Promise<FeedbackAiTriageBrief[]> {
    return db
      .update(feedbackAiTriageBriefs)
      .set({
        status: "failed",
        errorCode: "stale_triage_brief_recovered",
        errorMessage: reason,
        usageMetadata: {
          recoveredAt: new Date().toISOString(),
          staleBefore: staleBefore.toISOString(),
          reason,
        },
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(feedbackAiTriageBriefs.orgId, orgId),
        or(
          and(
            eq(feedbackAiTriageBriefs.status, "pending"),
            sql`${feedbackAiTriageBriefs.createdAt} < ${staleBefore}`,
          ),
          and(
            eq(feedbackAiTriageBriefs.status, "processing"),
            sql`coalesce(${feedbackAiTriageBriefs.startedAt}, ${feedbackAiTriageBriefs.updatedAt}, ${feedbackAiTriageBriefs.createdAt}) < ${staleBefore}`,
          ),
        ),
      ))
      .returning();
  }

  async createAuditLog(input: AuditTriageBriefInput): Promise<void> {
    await db.insert(auditLogs).values({
      organizationId: input.orgId,
      userId: input.userId ?? undefined,
      userName: input.userEmail,
      actionType: input.actionType,
      entityType: "feedback_ai_triage_brief",
      entityId: input.entityId,
      entityName: input.entityName,
      description: input.description,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      newValues: input.newValues,
    });
  }
}
