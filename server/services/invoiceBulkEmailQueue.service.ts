import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  invoiceEmailCampaigns,
  invoiceEmailDeliveryJobs,
  invoiceEmailLogs,
  invoices,
  customers,
} from "../../shared/schema";
import {
  getInvoiceEmailDeliveryFailureKind,
  type InvoiceEmailDeliveryFailureKind,
} from "./invoiceEmailDeliveryFailure";

export {
  getInvoiceEmailDeliveryFailureKind,
  markInvoiceEmailDeliveryFailure,
  type InvoiceEmailDeliveryFailureKind,
} from "./invoiceEmailDeliveryFailure";

type CanonicalInvoiceEmailSender = (input: {
  organizationId: string;
  invoiceId: string;
  userId?: string | null;
  userName?: string | null;
  toEmail?: string | null;
  deliveryJobId?: string | null;
}) => Promise<{ messageId?: string | null }>;

export type BulkInvoiceEmailCandidate = {
  invoiceId: string;
  invoiceVersion: number;
  recipientEmail: string;
};

export type BulkInvoiceEmailSkip = { invoiceId: string; reason: string };

/**
 * Durable delivery state.  This deliberately describes the queue job, not
 * successful delivery.  `invoice_email_logs` remains the only source for an
 * invoice's Last Sent value.
 */
export type InvoiceEmailDeliveryStatus = "queued" | "processing" | "retrying" | "sent" | "failed" | "needs_review" | "canceled";

export type InvoiceEmailDeliveryState = {
  id: string;
  status: InvoiceEmailDeliveryStatus;
  failureReason: string | null;
  updatedAt: Date | null;
};

export type InvoiceEmailQueueView = "active" | "failed" | "sent" | "all";

/**
 * A sender marks failures after the provider-submission boundary explicitly.
 * This is deliberately a property rather than message matching: retries must
 * never depend on a provider's human-readable error text.
 */
export async function listInvoiceEmailDeliveryJobs(input: {
  organizationId: string;
  view: InvoiceEmailQueueView;
  page: number;
  pageSize: number;
}) {
  const page = Math.max(1, input.page);
  const pageSize = Math.max(1, Math.min(100, input.pageSize));
  const statuses = input.view === "active" ? ["queued", "processing", "retrying"]
    : input.view === "failed" ? ["failed", "needs_review"]
      : input.view === "sent" ? ["sent"] : null;
  const where = statuses
    ? and(eq(invoiceEmailDeliveryJobs.organizationId, input.organizationId), inArray(invoiceEmailDeliveryJobs.status, statuses))
    : eq(invoiceEmailDeliveryJobs.organizationId, input.organizationId);
  const [rows, totals] = await Promise.all([
    db.select({
      id: invoiceEmailDeliveryJobs.id,
      invoiceId: invoiceEmailDeliveryJobs.invoiceId,
      invoiceNumber: invoices.displayNumber,
      legacyInvoiceNumber: invoices.invoiceNumber,
      customerName: customers.companyName,
      recipientEmail: invoiceEmailDeliveryJobs.recipientEmail,
      status: invoiceEmailDeliveryJobs.status,
      attemptCount: invoiceEmailDeliveryJobs.attemptCount,
      maxAttempts: invoiceEmailDeliveryJobs.maxAttempts,
      queuedAt: invoiceEmailDeliveryJobs.createdAt,
      claimedAt: invoiceEmailDeliveryJobs.claimedAt,
      claimExpiresAt: invoiceEmailDeliveryJobs.claimExpiresAt,
      updatedAt: invoiceEmailDeliveryJobs.updatedAt,
      availableAt: invoiceEmailDeliveryJobs.availableAt,
      sentAt: invoiceEmailDeliveryJobs.sentAt,
      failureReason: invoiceEmailDeliveryJobs.failureReason,
      providerMessageId: invoiceEmailDeliveryJobs.providerMessageId,
      metadata: invoiceEmailDeliveryJobs.metadata,
    }).from(invoiceEmailDeliveryJobs)
      .innerJoin(invoices, and(eq(invoices.id, invoiceEmailDeliveryJobs.invoiceId), eq(invoices.organizationId, input.organizationId)))
      .leftJoin(customers, and(eq(customers.id, invoices.customerId), eq(customers.organizationId, input.organizationId)))
      .where(where).orderBy(desc(invoiceEmailDeliveryJobs.createdAt), desc(invoiceEmailDeliveryJobs.id)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ totalCount: sql<number>`count(*)::int` }).from(invoiceEmailDeliveryJobs).where(where),
  ]);
  const [active, failed, needsReview] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(invoiceEmailDeliveryJobs).where(and(eq(invoiceEmailDeliveryJobs.organizationId, input.organizationId), inArray(invoiceEmailDeliveryJobs.status, ["queued", "processing", "retrying"]))),
    db.select({ count: sql<number>`count(*)::int` }).from(invoiceEmailDeliveryJobs).where(and(eq(invoiceEmailDeliveryJobs.organizationId, input.organizationId), eq(invoiceEmailDeliveryJobs.status, "failed"))),
    db.select({ count: sql<number>`count(*)::int` }).from(invoiceEmailDeliveryJobs).where(and(eq(invoiceEmailDeliveryJobs.organizationId, input.organizationId), eq(invoiceEmailDeliveryJobs.status, "needs_review"))),
  ]);
  const totalCount = Number(totals[0]?.totalCount || 0);
  return { items: rows, pagination: { page, pageSize, totalCount, totalPages: Math.max(1, Math.ceil(totalCount / pageSize)) }, counts: { active: Number(active[0]?.count || 0), failed: Number(failed[0]?.count || 0), needsReview: Number(needsReview[0]?.count || 0) }, claimSeconds: getBulkInvoiceEmailQueueConfig().claimSeconds };
}

let canonicalInvoiceEmailSender: CanonicalInvoiceEmailSender | null = null;
let workerRunning = false;

const DEFAULT_MAX_BATCH_SIZE = 200;
const HARD_MAX_BATCH_SIZE = 500;
const DEFAULT_TICK_LIMIT = 10;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RATE_LIMIT = 20;
const DEFAULT_RATE_WINDOW_SECONDS = 60;

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function getBulkInvoiceEmailQueueConfig() {
  return {
    maxBatchSize: boundedInteger(process.env.BULK_INVOICE_EMAIL_MAX_BATCH_SIZE, DEFAULT_MAX_BATCH_SIZE, 1, HARD_MAX_BATCH_SIZE),
    tickLimit: boundedInteger(process.env.BULK_INVOICE_EMAIL_TICK_LIMIT, DEFAULT_TICK_LIMIT, 1, 50),
    maxAttempts: boundedInteger(process.env.BULK_INVOICE_EMAIL_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS, 1, 5),
    rateLimit: boundedInteger(process.env.BULK_INVOICE_EMAIL_RATE_LIMIT, DEFAULT_RATE_LIMIT, 1, 200),
    rateWindowSeconds: boundedInteger(process.env.BULK_INVOICE_EMAIL_RATE_WINDOW_SECONDS, DEFAULT_RATE_WINDOW_SECONDS, 10, 3600),
    retryBaseSeconds: boundedInteger(process.env.BULK_INVOICE_EMAIL_RETRY_BASE_SECONDS, 300, 30, 3600),
    claimSeconds: boundedInteger(process.env.BULK_INVOICE_EMAIL_CLAIM_SECONDS, 300, 60, 1800),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeRecipient(email: string): string {
  return email.trim().toLowerCase();
}

export function buildBulkInvoiceEmailJobKey(input: BulkInvoiceEmailCandidate): string {
  return sha256(`invoice-email:v1:${input.invoiceId}:${input.invoiceVersion}:${normalizeRecipient(input.recipientEmail)}`);
}

export function buildBulkInvoiceEmailRequestKey(input: { organizationId: string; invoiceIds: string[]; suppliedKey?: string | null }): string {
  const supplied = String(input.suppliedKey || "").trim();
  if (supplied) return `request:${supplied.slice(0, 200)}`;
  return `selection:${sha256(`${input.organizationId}:${[...input.invoiceIds].sort().join(",")}`)}`;
}

export function registerCanonicalInvoiceEmailSender(sender: CanonicalInvoiceEmailSender): void {
  canonicalInvoiceEmailSender = sender;
}

/**
 * Returns the most recently-created canonical delivery job for each supplied
 * invoice. This is display/diagnostic data only; it must never be used as a
 * substitute for the successful-delivery email log or Last Sent projection.
 */
export async function getInvoiceEmailDeliveryStates(input: {
  organizationId: string;
  invoiceIds: string[];
}): Promise<Map<string, InvoiceEmailDeliveryState>> {
  const result = new Map<string, InvoiceEmailDeliveryState>();
  const invoiceIds = Array.from(new Set(input.invoiceIds.filter(Boolean)));
  if (invoiceIds.length === 0) return result;

  const rows = await db
    .select({
      id: invoiceEmailDeliveryJobs.id,
      invoiceId: invoiceEmailDeliveryJobs.invoiceId,
      status: invoiceEmailDeliveryJobs.status,
      failureReason: invoiceEmailDeliveryJobs.failureReason,
      updatedAt: invoiceEmailDeliveryJobs.updatedAt,
    })
    .from(invoiceEmailDeliveryJobs)
    .where(and(
      eq(invoiceEmailDeliveryJobs.organizationId, input.organizationId),
      inArray(invoiceEmailDeliveryJobs.invoiceId, invoiceIds),
    ))
    .orderBy(invoiceEmailDeliveryJobs.invoiceId, desc(invoiceEmailDeliveryJobs.createdAt));

  for (const row of rows) {
    if (result.has(row.invoiceId)) continue;
    result.set(row.invoiceId, {
      id: row.id,
      status: row.status as InvoiceEmailDeliveryStatus,
      failureReason: row.failureReason ?? null,
      updatedAt: row.updatedAt ?? null,
    });
  }
  return result;
}

type InvoiceEmailDeliveryReviewMetadata = {
  resolution: "verified_not_sent";
  reviewedAt: string;
  reviewedByUserId: string | null;
  reviewedByUserName: string | null;
  originalNeedsReviewJobId: string;
  replacementJobId: string | null;
};

function asMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Resolves an ambiguous provider outcome only after an authorized operator
 * explicitly verifies that no email was sent. Resolution only clears the
 * safety block. A queue retry is a separate, explicit operator choice.
 */
export async function resolveInvoiceEmailDeliveryNeedsReview(input: {
  organizationId: string;
  jobId: string;
  reviewedByUserId?: string | null;
  reviewedByUserName?: string | null;
  retryThroughQueue?: boolean;
}) {
  return db.transaction(async (tx) => {
    const locked: any = await tx.execute(sql`
      SELECT id, organization_id AS "organizationId", campaign_id AS "campaignId",
             invoice_id AS "invoiceId", invoice_version AS "invoiceVersion",
             recipient_email AS "recipientEmail", recipient_key AS "recipientKey",
             status,
             attempt_count AS "attemptCount", max_attempts AS "maxAttempts",
             failure_reason AS "failureReason", metadata
      FROM invoice_email_delivery_jobs
      WHERE id = ${input.jobId} AND organization_id = ${input.organizationId}
      FOR UPDATE
    `);
    const original = (locked.rows || locked)[0] as any;
    if (!original) throw Object.assign(new Error("Invoice delivery job was not found"), { statusCode: 404 });

    const originalMetadata = asMetadata(original.metadata);
    const priorReview = originalMetadata.deliveryReview as Partial<InvoiceEmailDeliveryReviewMetadata> | undefined;
    if (priorReview?.resolution === "verified_not_sent" && priorReview.replacementJobId) {
      const replacementResult: any = await tx.execute(sql`
        SELECT id, status, attempt_count AS "attemptCount", max_attempts AS "maxAttempts"
        FROM invoice_email_delivery_jobs
        WHERE id = ${priorReview.replacementJobId} AND organization_id = ${input.organizationId}
        LIMIT 1
      `);
      const replacement = (replacementResult.rows || replacementResult)[0];
      if (replacement) return { originalJobId: original.id, replacementJob: replacement, replayed: true };
    }
    const alreadyReviewed = priorReview?.resolution === "verified_not_sent";
    if (!alreadyReviewed && original.status !== "needs_review") {
      throw Object.assign(new Error("This delivery is no longer awaiting operator review"), { statusCode: 409 });
    }

    const reviewedAt = new Date();
    const retainedReason = String(original.failureReason || "Delivery outcome was uncertain.").trim();
    const reviewer = input.reviewedByUserName || "an authorized operator";
    const review: InvoiceEmailDeliveryReviewMetadata = {
      resolution: "verified_not_sent",
      reviewedAt: alreadyReviewed && priorReview?.reviewedAt ? priorReview.reviewedAt : reviewedAt.toISOString(),
      reviewedByUserId: alreadyReviewed ? priorReview?.reviewedByUserId || null : input.reviewedByUserId || null,
      reviewedByUserName: alreadyReviewed ? priorReview?.reviewedByUserName || null : input.reviewedByUserName || null,
      originalNeedsReviewJobId: original.id,
      replacementJobId: null,
    };

    if (!alreadyReviewed) {
      // Mark the original terminally failed and preserve its audit history.
      // This releases only the reviewed record from the active-job guard;
      // direct sending remains a separately requested synchronous operation.
      await tx.update(invoiceEmailDeliveryJobs).set({
        status: "failed",
        claimExpiresAt: null,
        availableAt: reviewedAt,
        failureReason: `${retainedReason}\n\nReviewed ${reviewedAt.toISOString()} by ${reviewer}. Operator verified email was not sent; no replacement was queued.`,
        metadata: { ...originalMetadata, deliveryReview: review },
        updatedAt: reviewedAt,
      } as any).where(and(
        eq(invoiceEmailDeliveryJobs.id, original.id),
        eq(invoiceEmailDeliveryJobs.organizationId, input.organizationId),
        eq(invoiceEmailDeliveryJobs.status, "needs_review"),
      ));
    }

    if (!input.retryThroughQueue) {
      return { originalJobId: original.id, replacementJob: null, replayed: alreadyReviewed };
    }

    const [campaign] = await tx.insert(invoiceEmailCampaigns).values({
      organizationId: input.organizationId,
      createdByUserId: input.reviewedByUserId || null,
      idempotencyKey: `needs-review-resolution:${original.id}`,
      requestedInvoiceIds: [original.invoiceId],
      selectedInvoiceCount: 1,
      queuedInvoiceCount: 1,
      skippedInvoiceCount: 0,
      recipientGroupCount: 1,
      status: "queued",
      resultSummary: { queued: 1, deliveryMode: "individual_invoice_messages", replacesNeedsReviewJobId: original.id },
      metadata: { deliveryMode: "individual_invoice_messages", replacesNeedsReviewJobId: original.id },
    } as any).returning({ id: invoiceEmailCampaigns.id });

    const [replacement] = await tx.insert(invoiceEmailDeliveryJobs).values({
      organizationId: input.organizationId,
      campaignId: campaign.id,
      invoiceId: original.invoiceId,
      invoiceVersion: Number(original.invoiceVersion),
      recipientEmail: original.recipientEmail,
      recipientKey: original.recipientKey,
      idempotencyKey: `needs-review-retry:${original.id}`,
      status: "queued",
      attemptCount: 0,
      maxAttempts: Number(original.maxAttempts) || getBulkInvoiceEmailQueueConfig().maxAttempts,
      metadata: {
        deliveryMode: "individual_invoice_messages",
        createdByUserId: input.reviewedByUserId || null,
        retryOfNeedsReviewJobId: original.id,
      },
    } as any).returning({
      id: invoiceEmailDeliveryJobs.id,
      status: invoiceEmailDeliveryJobs.status,
      attemptCount: invoiceEmailDeliveryJobs.attemptCount,
      maxAttempts: invoiceEmailDeliveryJobs.maxAttempts,
    });
    if (!replacement) throw Object.assign(new Error("A delivery for this invoice is already active"), { statusCode: 409 });

    review.replacementJobId = replacement.id;
    await tx.update(invoiceEmailDeliveryJobs).set({
      status: "failed",
      claimExpiresAt: null,
      availableAt: reviewedAt,
      failureReason: `${retainedReason}\n\nReviewed ${review.reviewedAt} by ${review.reviewedByUserName || reviewer}. Operator explicitly queued replacement delivery job ${replacement.id}.`,
      metadata: { ...originalMetadata, deliveryReview: review },
      updatedAt: reviewedAt,
    } as any).where(and(
      eq(invoiceEmailDeliveryJobs.id, original.id),
      eq(invoiceEmailDeliveryJobs.organizationId, input.organizationId),
    ));

    return { originalJobId: original.id, replacementJob: replacement, replayed: false };
  });
}

export async function enqueueBulkInvoiceEmailCampaign(input: {
  organizationId: string;
  createdByUserId?: string | null;
  invoiceIds: string[];
  candidates: BulkInvoiceEmailCandidate[];
  skipped: BulkInvoiceEmailSkip[];
  idempotencyKey: string;
}) {
  const config = getBulkInvoiceEmailQueueConfig();
  if (input.invoiceIds.length > config.maxBatchSize) {
    throw Object.assign(new Error(`Select no more than ${config.maxBatchSize} invoices at a time`), { statusCode: 400 });
  }

  const campaign = await db.transaction(async (tx) => {
    const [created] = await tx.insert(invoiceEmailCampaigns).values({
      organizationId: input.organizationId,
      createdByUserId: input.createdByUserId || null,
      idempotencyKey: input.idempotencyKey,
      requestedInvoiceIds: input.invoiceIds,
      selectedInvoiceCount: input.invoiceIds.length,
      skippedInvoiceCount: input.skipped.length,
      recipientGroupCount: new Set(input.candidates.map((candidate) => normalizeRecipient(candidate.recipientEmail))).size,
      resultSummary: { skipped: input.skipped },
      metadata: { deliveryMode: "individual_invoice_messages" },
    } as any).onConflictDoNothing().returning();

    if (!created) {
      const [existing] = await tx.select().from(invoiceEmailCampaigns).where(and(
        eq(invoiceEmailCampaigns.organizationId, input.organizationId),
        eq(invoiceEmailCampaigns.idempotencyKey, input.idempotencyKey),
      )).limit(1);
      return { campaign: existing, queued: 0, alreadyQueued: input.candidates.length, blocked: [], replayed: true };
    }

    let queued = 0;
    let alreadyQueued = 0;
    const blocked: Array<{ invoiceId: string; recipientEmail: string; status: "queued" | "processing" | "retrying" | "needs_review" }> = [];
    for (const candidate of input.candidates) {
      const recipientKey = normalizeRecipient(candidate.recipientEmail);
      const [job] = await tx.insert(invoiceEmailDeliveryJobs).values({
        organizationId: input.organizationId,
        campaignId: created.id,
        invoiceId: candidate.invoiceId,
        invoiceVersion: candidate.invoiceVersion,
        recipientEmail: candidate.recipientEmail,
        recipientKey,
        idempotencyKey: buildBulkInvoiceEmailJobKey(candidate),
        maxAttempts: config.maxAttempts,
        metadata: {
          deliveryMode: "individual_invoice_message",
          createdByUserId: input.createdByUserId || null,
        },
      } as any).onConflictDoNothing().returning({ id: invoiceEmailDeliveryJobs.id });
      if (job) queued += 1;
      else {
        alreadyQueued += 1;
        const [existing] = await tx.select({ status: invoiceEmailDeliveryJobs.status })
          .from(invoiceEmailDeliveryJobs)
          .where(and(
            eq(invoiceEmailDeliveryJobs.organizationId, input.organizationId),
            eq(invoiceEmailDeliveryJobs.invoiceId, candidate.invoiceId),
            eq(invoiceEmailDeliveryJobs.recipientKey, recipientKey),
            eq(invoiceEmailDeliveryJobs.invoiceVersion, candidate.invoiceVersion),
            inArray(invoiceEmailDeliveryJobs.status, ["queued", "processing", "retrying", "needs_review"]),
          ))
          .orderBy(desc(invoiceEmailDeliveryJobs.createdAt))
          .limit(1);
        if (existing?.status && ["queued", "processing", "retrying", "needs_review"].includes(existing.status)) {
          blocked.push({ invoiceId: candidate.invoiceId, recipientEmail: candidate.recipientEmail, status: existing.status as "queued" | "processing" | "retrying" | "needs_review" });
        }
      }
    }

    const completed = queued === 0;
    const [updated] = await tx.update(invoiceEmailCampaigns).set({
      queuedInvoiceCount: queued,
      skippedInvoiceCount: input.skipped.length + alreadyQueued,
      status: completed ? "completed" : "queued",
      completedAt: completed ? new Date() : null,
      resultSummary: {
        queued,
        alreadyQueued,
        blocked,
        skipped: input.skipped,
        deliveryMode: "individual_invoice_messages",
      },
      updatedAt: new Date(),
    } as any).where(eq(invoiceEmailCampaigns.id, created.id)).returning();
    return { campaign: updated, queued, alreadyQueued, blocked, replayed: false };
  });

  return {
    campaignId: campaign.campaign?.id || null,
    selected: input.invoiceIds.length,
    queued: campaign.queued,
    alreadyQueued: campaign.alreadyQueued,
    blocked: campaign.blocked,
    skipped: input.skipped,
    recipientGroups: new Set(input.candidates.map((candidate) => normalizeRecipient(candidate.recipientEmail))).size,
    replayed: campaign.replayed,
  };
}

type ClaimedJob = {
  id: string;
  organizationId: string;
  invoiceId: string;
  recipientEmail: string;
  attemptCount: number;
  maxAttempts: number;
  createdAt: Date;
  campaignId: string;
  metadata?: { createdByUserId?: string | null };
};

function logDeliveryStage(job: ClaimedJob, stage: string, detail: Record<string, unknown> = {}): void {
  console.log("[InvoiceEmailQueue]", {
    stage,
    jobId: job.id,
    organizationId: job.organizationId,
    invoiceId: job.invoiceId,
    attempt: job.attemptCount,
    ...detail,
  });
}

async function claimOneBulkInvoiceEmailJob(): Promise<ClaimedJob | null> {
  const config = getBulkInvoiceEmailQueueConfig();
  return db.transaction(async (tx) => {
    // A lost worker can leave a provider submission ambiguous. Never reclaim
    // that work: Gmail may have accepted it after the process lost its
    // response. Surface it for review instead of turning each poll into an
    // unbounded resend attempt.
    await tx.execute(sql`
      UPDATE invoice_email_delivery_jobs
      SET status = 'needs_review', claim_expires_at = null,
          failure_reason = coalesce(failure_reason, 'Delivery outcome is uncertain because the worker claim expired before it recorded an outcome. The message was not resent to avoid a duplicate email.'),
          updated_at = now()
      WHERE status = 'processing' AND claim_expires_at <= now()
    `);
    const result: any = await tx.execute(sql`
      SELECT id, organization_id AS "organizationId", invoice_id AS "invoiceId",
             recipient_email AS "recipientEmail", attempt_count AS "attemptCount",
             max_attempts AS "maxAttempts", created_at AS "createdAt", campaign_id AS "campaignId",
             metadata AS "metadata"
      FROM invoice_email_delivery_jobs
      WHERE status IN ('queued', 'retrying')
        AND available_at <= now()
        AND attempt_count < max_attempts
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    const row = (result.rows || result)[0] as ClaimedJob | undefined;
    if (!row) return null;

    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`bulk-invoice-email-rate:${row.organizationId}`}))`);
    const sentResult: any = await tx.execute(sql`
      SELECT count(*)::int AS count
      FROM invoice_email_delivery_jobs
      WHERE organization_id = ${row.organizationId}
        AND (
          (status = 'sent' AND sent_at >= now() - (${config.rateWindowSeconds} * interval '1 second'))
          OR (status = 'processing' AND claimed_at >= now() - (${config.rateWindowSeconds} * interval '1 second'))
        )
    `);
    const sentCount = Number((sentResult.rows || sentResult)[0]?.count || 0);
    if (sentCount >= config.rateLimit) {
      await tx.execute(sql`
        UPDATE invoice_email_delivery_jobs
        SET available_at = now() + (${config.rateWindowSeconds} * interval '1 second'), updated_at = now()
        WHERE id = ${row.id}
      `);
      return null;
    }

    const workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;
    const claimResult: any = await tx.execute(sql`
      UPDATE invoice_email_delivery_jobs
      SET status = 'processing', attempt_count = attempt_count + 1, claimed_at = now(),
          claim_expires_at = now() + (${config.claimSeconds} * interval '1 second'),
          claimed_by_worker_id = ${workerId}, updated_at = now()
      WHERE id = ${row.id} AND status IN ('queued', 'retrying') AND attempt_count < max_attempts
    `);
    if (Number(claimResult.rowCount ?? 1) === 0) return null;
    return { ...row, attemptCount: Number(row.attemptCount || 0) + 1 };
  });
}

function isAmbiguousProviderFailure(error: unknown): boolean {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return /timeout|timed out|econn|socket|connection reset|network|fetch failed/.test(message);
}

async function updateCampaignCompletion(campaignId: string): Promise<void> {
  const result: any = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE status IN ('queued', 'retrying', 'processing'))::int AS active,
      count(*) FILTER (WHERE status IN ('failed', 'needs_review'))::int AS failed
    FROM invoice_email_delivery_jobs WHERE campaign_id = ${campaignId}
  `);
  const row = (result.rows || result)[0] || {};
  if (Number(row.active || 0) > 0) return;
  await db.update(invoiceEmailCampaigns).set({
    status: Number(row.failed || 0) > 0 ? "completed_with_errors" : "completed",
    completedAt: new Date(),
    updatedAt: new Date(),
  } as any).where(eq(invoiceEmailCampaigns.id, campaignId));
}

async function processClaimedJob(job: ClaimedJob): Promise<"sent" | "failed"> {
  logDeliveryStage(job, "job_claimed");
  if (!canonicalInvoiceEmailSender) {
    const terminal = job.attemptCount >= job.maxAttempts;
    await db.update(invoiceEmailDeliveryJobs).set({
      status: terminal ? "failed" : "retrying",
      availableAt: terminal ? new Date() : new Date(Date.now() + 60_000),
      claimExpiresAt: null,
      failureReason: "Canonical invoice email sender is not registered",
      updatedAt: new Date(),
    } as any).where(eq(invoiceEmailDeliveryJobs.id, job.id));
    logDeliveryStage(job, "sender_unavailable", { terminal });
    if (terminal) await updateCampaignCompletion(job.campaignId);
    return "failed";
  }

  const [alreadySent] = await db.select({ id: invoiceEmailLogs.id, messageId: invoiceEmailLogs.messageId })
    .from(invoiceEmailLogs)
    .where(and(
      eq(invoiceEmailLogs.organizationId, job.organizationId),
      eq(invoiceEmailLogs.invoiceId, job.invoiceId),
      eq(invoiceEmailLogs.status, "sent"),
      eq(invoiceEmailLogs.type, "invoice_send"),
      gte(invoiceEmailLogs.sentAt, job.createdAt),
      sql`lower(${invoiceEmailLogs.recipientEmail}) = ${normalizeRecipient(job.recipientEmail)}`,
    )).limit(1);

  try {
    logDeliveryStage(job, "canonical_sender_started", { alreadySent: Boolean(alreadySent) });
    const outcome = alreadySent || await canonicalInvoiceEmailSender({
      organizationId: job.organizationId,
      invoiceId: job.invoiceId,
      userId: job.metadata?.createdByUserId || null,
      toEmail: job.recipientEmail,
      deliveryJobId: job.id,
    });
    await db.update(invoiceEmailDeliveryJobs).set({
      status: "sent",
      sentAt: new Date(),
      providerMessageId: outcome?.messageId || null,
      failureReason: null,
      claimExpiresAt: null,
      updatedAt: new Date(),
    } as any).where(eq(invoiceEmailDeliveryJobs.id, job.id));
    logDeliveryStage(job, "job_marked_sent", { providerMessageIdPresent: Boolean(outcome?.messageId) });
    await updateCampaignCompletion(job.campaignId);
    return "sent";
  } catch (error) {
    const message = String((error as any)?.message || error || "Invoice email delivery failed").slice(0, 1000);
    const failureKind = getInvoiceEmailDeliveryFailureKind(error);
    // Old providers that have not been annotated yet remain conservative for
    // transport uncertainty. Explicit sender annotations always win.
    const needsReview = failureKind ? failureKind === "needs_review" : isAmbiguousProviderFailure(error);
    const terminal = needsReview || job.attemptCount >= job.maxAttempts;
    await db.update(invoiceEmailDeliveryJobs).set({
      status: needsReview ? "needs_review" : terminal ? "failed" : "retrying",
      availableAt: terminal ? new Date() : new Date(Date.now() + getBulkInvoiceEmailQueueConfig().retryBaseSeconds * 1000 * Math.max(1, job.attemptCount)),
      claimExpiresAt: null,
      failureReason: needsReview
        ? `Delivery outcome is uncertain. Review before retrying to avoid a duplicate email: ${message}`
        : message,
      updatedAt: new Date(),
    } as any).where(eq(invoiceEmailDeliveryJobs.id, job.id));
    logDeliveryStage(job, needsReview ? "job_marked_needs_review" : terminal ? "job_marked_failed" : "job_scheduled_retry", {
      failureKind: failureKind || "unclassified",
      terminal,
    });
    if (terminal) await updateCampaignCompletion(job.campaignId);
    return "failed";
  }
}

/** Runs a bounded worker tick. No network send occurs unless a job has been durably claimed. */
export async function runBulkInvoiceEmailQueueWorker(): Promise<{ processed: number; sent: number; failed: number }> {
  if (workerRunning) return { processed: 0, sent: 0, failed: 0 };
  workerRunning = true;
  try {
    const { tickLimit } = getBulkInvoiceEmailQueueConfig();
    let processed = 0;
    let sent = 0;
    let failed = 0;
    for (let index = 0; index < tickLimit; index += 1) {
      const job = await claimOneBulkInvoiceEmailJob();
      if (!job) break;
      processed += 1;
      if (await processClaimedJob(job) === "sent") sent += 1;
      else failed += 1;
    }
    return { processed, sent, failed };
  } finally {
    workerRunning = false;
  }
}
