import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  auditLogs,
  bugReports,
  feedbackAiReviews,
  type BugReport,
  type FeedbackAiReview,
} from "@shared/schema";
import type { AiReviewDto, BugAiReviewResult } from "@shared/aiReviewContracts";

export interface CreatePendingAiReviewInput {
  orgId: string;
  bugReportId: string;
  requestedByUserId: string | null;
  requestedByEmail: string;
  promptVersion: string;
  inputSnapshot: Record<string, unknown>;
}

export interface CompleteAiReviewInput {
  orgId: string;
  reviewId: string;
  provider: string;
  model: string;
  result: BugAiReviewResult;
  requestMetadata: Record<string, unknown>;
}

export interface FailAiReviewInput {
  orgId: string;
  reviewId: string;
  provider?: string | null;
  model?: string | null;
  validationErrors?: unknown;
  errorCode: string;
  errorMessage: string;
}

export interface AuditAiReviewInput {
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

export interface AiReviewsRepository {
  getBugReportForReview(orgId: string, bugReportId: string): Promise<Pick<BugReport, "id" | "orgId" | "type" | "title" | "description" | "severity" | "url" | "screenWidth" | "screenHeight" | "metadata" | "createdAt"> | null>;
  getCurrentReviewForBugReport(orgId: string, bugReportId: string): Promise<FeedbackAiReview | null>;
  getReviewById(orgId: string, reviewId: string): Promise<FeedbackAiReview | null>;
  createPendingReview(input: CreatePendingAiReviewInput): Promise<FeedbackAiReview>;
  markProcessing(orgId: string, reviewId: string, provider: string, model: string): Promise<FeedbackAiReview | null>;
  completeReview(input: CompleteAiReviewInput): Promise<FeedbackAiReview | null>;
  failReview(input: FailAiReviewInput): Promise<FeedbackAiReview | null>;
  recoverStaleActiveReviewsForBugReport(orgId: string, bugReportId: string, staleBefore: Date, reason: string): Promise<FeedbackAiReview[]>;
  createAuditLog(input: AuditAiReviewInput): Promise<void>;
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

export function toAiReviewDto(row: FeedbackAiReview): AiReviewDto {
  return {
    id: row.id,
    orgId: row.orgId,
    bugReportId: row.bugReportId,
    reviewKind: row.reviewKind,
    status: row.status,
    isCurrent: row.isCurrent,
    requestedByEmail: row.requestedByEmail,
    provider: row.provider,
    model: row.model,
    providerMetadata: row.providerMetadata ?? null,
    promptVersion: row.promptVersion,
    result: row.result ?? null,
    summary: row.summary,
    severityAssessment: row.severityAssessment ?? null,
    businessImpact: row.businessImpact ?? null,
    urgency: row.urgency ?? null,
    implementationPriority: row.implementationPriority ?? null,
    workflowImpact: row.workflowImpact ?? null,
    revenueRisk: row.revenueRisk ?? null,
    suggestedOwner: row.suggestedOwner ?? null,
    confidence: confidenceToNumber(row.confidence),
    validationErrors: row.validationErrors ?? null,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    startedAt: toIso(row.startedAt),
    completedAt: toIso(row.completedAt),
    createdAt: toIso(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(row.updatedAt) ?? new Date().toISOString(),
  };
}

export class DrizzleAiReviewsRepository implements AiReviewsRepository {
  async getBugReportForReview(orgId: string, bugReportId: string) {
    const [row] = await db
      .select({
        id: bugReports.id,
        orgId: bugReports.orgId,
        type: bugReports.type,
        title: bugReports.title,
        description: bugReports.description,
        severity: bugReports.severity,
        url: bugReports.url,
        screenWidth: bugReports.screenWidth,
        screenHeight: bugReports.screenHeight,
        metadata: bugReports.metadata,
        createdAt: bugReports.createdAt,
      })
      .from(bugReports)
      .where(and(eq(bugReports.orgId, orgId), eq(bugReports.id, bugReportId)))
      .limit(1);

    return row ?? null;
  }

  async getCurrentReviewForBugReport(orgId: string, bugReportId: string): Promise<FeedbackAiReview | null> {
    const [row] = await db
      .select()
      .from(feedbackAiReviews)
      .where(and(
        eq(feedbackAiReviews.orgId, orgId),
        eq(feedbackAiReviews.bugReportId, bugReportId),
        eq(feedbackAiReviews.reviewKind, "bug_review"),
        eq(feedbackAiReviews.isCurrent, true),
      ))
      .orderBy(desc(feedbackAiReviews.createdAt))
      .limit(1);
    return row ?? null;
  }

  async getReviewById(orgId: string, reviewId: string): Promise<FeedbackAiReview | null> {
    const [row] = await db
      .select()
      .from(feedbackAiReviews)
      .where(and(eq(feedbackAiReviews.orgId, orgId), eq(feedbackAiReviews.id, reviewId)))
      .limit(1);
    return row ?? null;
  }

  async createPendingReview(input: CreatePendingAiReviewInput): Promise<FeedbackAiReview> {
    const [created] = await db.transaction(async (tx) => {
      await tx
        .update(feedbackAiReviews)
        .set({ isCurrent: false, updatedAt: new Date() })
        .where(and(
          eq(feedbackAiReviews.orgId, input.orgId),
          eq(feedbackAiReviews.bugReportId, input.bugReportId),
          eq(feedbackAiReviews.reviewKind, "bug_review"),
          eq(feedbackAiReviews.isCurrent, true),
          sql`${feedbackAiReviews.status} NOT IN ('pending', 'processing')`,
        ));

      return tx
        .insert(feedbackAiReviews)
        .values({
          orgId: input.orgId,
          bugReportId: input.bugReportId,
          reviewKind: "bug_review",
          status: "pending",
          isCurrent: true,
          requestedByUserId: input.requestedByUserId,
          requestedByEmail: input.requestedByEmail,
          promptVersion: input.promptVersion,
          inputSnapshot: input.inputSnapshot,
        })
        .returning();
    });

    return created;
  }

  async markProcessing(orgId: string, reviewId: string, provider: string, model: string): Promise<FeedbackAiReview | null> {
    const [updated] = await db
      .update(feedbackAiReviews)
      .set({
        status: "processing",
        provider,
        model,
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(feedbackAiReviews.orgId, orgId),
        eq(feedbackAiReviews.id, reviewId),
        eq(feedbackAiReviews.status, "pending"),
      ))
      .returning();
    return updated ?? null;
  }

  async completeReview(input: CompleteAiReviewInput): Promise<FeedbackAiReview | null> {
    const [updated] = await db
      .update(feedbackAiReviews)
      .set({
        status: "completed",
        provider: input.provider,
        model: input.model,
        providerMetadata: input.requestMetadata,
        result: input.result,
        summary: input.result.summary,
        severityAssessment: input.result.severityAssessment,
        businessImpact: input.result.businessImpact,
        urgency: input.result.urgency,
        implementationPriority: input.result.implementationPriority,
        workflowImpact: input.result.workflowImpact,
        revenueRisk: input.result.revenueRisk,
        suggestedOwner: input.result.suggestedOwner,
        confidence: input.result.confidence.toFixed(3),
        errorCode: null,
        errorMessage: null,
        validationErrors: null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(feedbackAiReviews.orgId, input.orgId), eq(feedbackAiReviews.id, input.reviewId)))
      .returning();
    return updated ?? null;
  }

  async failReview(input: FailAiReviewInput): Promise<FeedbackAiReview | null> {
    const [updated] = await db
      .update(feedbackAiReviews)
      .set({
        status: "failed",
        provider: input.provider ?? undefined,
        model: input.model ?? undefined,
        validationErrors: input.validationErrors ?? null,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(feedbackAiReviews.orgId, input.orgId),
        eq(feedbackAiReviews.id, input.reviewId),
        inArray(feedbackAiReviews.status, ["pending", "processing"]),
      ))
      .returning();
    return updated ?? null;
  }

  async recoverStaleActiveReviewsForBugReport(
    orgId: string,
    bugReportId: string,
    staleBefore: Date,
    reason: string,
  ): Promise<FeedbackAiReview[]> {
    const rows = await db
      .update(feedbackAiReviews)
      .set({
        status: "failed",
        errorCode: "stale_review_recovered",
        errorMessage: reason,
        validationErrors: {
          recoveredAt: new Date().toISOString(),
          staleBefore: staleBefore.toISOString(),
          reason,
        },
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(feedbackAiReviews.orgId, orgId),
        eq(feedbackAiReviews.bugReportId, bugReportId),
        eq(feedbackAiReviews.reviewKind, "bug_review"),
        eq(feedbackAiReviews.isCurrent, true),
        or(
          and(
            eq(feedbackAiReviews.status, "pending"),
            sql`${feedbackAiReviews.createdAt} < ${staleBefore}`,
          ),
          and(
            eq(feedbackAiReviews.status, "processing"),
            sql`coalesce(${feedbackAiReviews.startedAt}, ${feedbackAiReviews.updatedAt}, ${feedbackAiReviews.createdAt}) < ${staleBefore}`,
          ),
        ),
      ))
      .returning();

    return rows;
  }

  async createAuditLog(input: AuditAiReviewInput): Promise<void> {
    await db.insert(auditLogs).values({
      organizationId: input.orgId,
      userId: input.userId ?? undefined,
      userName: input.userEmail,
      actionType: input.actionType,
      entityType: "feedback_ai_review",
      entityId: input.entityId,
      entityName: input.entityName,
      description: input.description,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      newValues: input.newValues,
    });
  }
}
