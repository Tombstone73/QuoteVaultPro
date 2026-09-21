import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  invoiceEmailCampaigns,
  invoiceEmailDeliveryJobs,
  invoiceEmailLogs,
  customerStatementEmailLogs,
  customerStatementSnapshots,
  invoices,
  customers,
} from "../../shared/schema";
import {
  getInvoiceEmailDeliveryFailureKind,
  markInvoiceEmailDeliveryFailure,
  type InvoiceEmailDeliveryFailureKind,
} from "./invoiceEmailDeliveryFailure";
import {
  resolveCurrentInvoiceEmailDeliveryState,
  type InvoiceEmailDeliveryState,
  type InvoiceEmailDeliveryStatus,
} from "./invoiceEmailDeliveryPresentation";
import { getNextBulkInvoiceEmailSlot } from "./invoiceBulkEmailScheduling";

export {
  resolveCurrentInvoiceEmailDeliveryState,
  type InvoiceEmailDeliveryState,
  type InvoiceEmailDeliveryStatus,
} from "./invoiceEmailDeliveryPresentation";
export { getNextBulkInvoiceEmailSlot } from "./invoiceBulkEmailScheduling";

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
  allowUnapproved?: boolean;
  subject?: string | null;
  message?: string | null;
}) => Promise<{ messageId?: string | null }>;

type CanonicalCustomerStatementEmailSender = (input: {
  organizationId: string;
  statementSnapshotId: string;
  userId?: string | null;
  userName?: string | null;
  toEmail: string;
  deliveryJobId: string;
}) => Promise<{ messageId?: string | null }>;

export type BulkInvoiceEmailCandidate = {
  invoiceId: string;
  invoiceVersion: number;
  recipientEmail: string;
  allowUnapproved?: boolean;
  /** Operator-authored content is persisted with the delivery request so a retry does not silently change it. */
  subject?: string | null;
  message?: string | null;
};

export type BulkInvoiceEmailSkip = { invoiceId: string; reason: string };

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
      deliveryType: invoiceEmailDeliveryJobs.deliveryType,
      invoiceId: invoiceEmailDeliveryJobs.invoiceId,
      invoiceNumber: invoices.displayNumber,
      legacyInvoiceNumber: invoices.invoiceNumber,
      customerName: customers.companyName,
      statementSnapshotId: invoiceEmailDeliveryJobs.customerStatementSnapshotId,
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
      .leftJoin(invoices, and(eq(invoices.id, invoiceEmailDeliveryJobs.invoiceId), eq(invoices.organizationId, input.organizationId)))
      .leftJoin(customerStatementSnapshots, and(eq(customerStatementSnapshots.id, invoiceEmailDeliveryJobs.customerStatementSnapshotId), eq(customerStatementSnapshots.organizationId, input.organizationId)))
      .leftJoin(customers, and(eq(customers.organizationId, input.organizationId), sql`${customers.id} = coalesce(${invoices.customerId}, ${customerStatementSnapshots.customerId})`))
      .where(where).orderBy(
        ...(input.view === "active"
          ? [asc(invoiceEmailDeliveryJobs.availableAt), asc(invoiceEmailDeliveryJobs.createdAt)]
          : [desc(invoiceEmailDeliveryJobs.createdAt), desc(invoiceEmailDeliveryJobs.id)]),
      ).limit(pageSize).offset((page - 1) * pageSize),
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
let canonicalCustomerStatementEmailSender: CanonicalCustomerStatementEmailSender | null = null;
let workerRunning = false;

const DEFAULT_MAX_BATCH_SIZE = 200;
const HARD_MAX_BATCH_SIZE = 500;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_SPACING_SECONDS = 60;
const DEFAULT_RETRY_BASE_SECONDS = 60;
const DEFAULT_CLAIM_SECONDS = 60;

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function getBulkInvoiceEmailQueueConfig() {
  return {
    maxBatchSize: boundedInteger(process.env.BULK_INVOICE_EMAIL_MAX_BATCH_SIZE, DEFAULT_MAX_BATCH_SIZE, 1, HARD_MAX_BATCH_SIZE),
    // One job per worker tick is deliberate: this is a FIFO mail queue, not
    // a bulk burst sender.
    tickLimit: 1,
    maxAttempts: boundedInteger(process.env.BULK_INVOICE_EMAIL_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS, 1, 5),
    spacingSeconds: boundedInteger(process.env.BULK_INVOICE_EMAIL_SPACING_SECONDS, DEFAULT_SPACING_SECONDS, 60, 3600),
    retryBaseSeconds: boundedInteger(process.env.BULK_INVOICE_EMAIL_RETRY_BASE_SECONDS, DEFAULT_RETRY_BASE_SECONDS, 60, 900),
    claimSeconds: boundedInteger(process.env.BULK_INVOICE_EMAIL_CLAIM_SECONDS, DEFAULT_CLAIM_SECONDS, 45, 120),
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

/** Statement delivery shares the durable claim/retry/lease worker. */
export function registerCanonicalCustomerStatementEmailSender(sender: CanonicalCustomerStatementEmailSender): void {
  canonicalCustomerStatementEmailSender = sender;
}

/**
 * Returns the most recently-updated canonical delivery job for each supplied
 * invoice. The Invoice List compares this timestamp with the successful email
 * log so queue history cannot override a newer successful direct send.
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
      createdAt: invoiceEmailDeliveryJobs.createdAt,
    })
    .from(invoiceEmailDeliveryJobs)
    .where(and(
      eq(invoiceEmailDeliveryJobs.organizationId, input.organizationId),
      inArray(invoiceEmailDeliveryJobs.invoiceId, invoiceIds),
    ))
    .orderBy(invoiceEmailDeliveryJobs.invoiceId, desc(invoiceEmailDeliveryJobs.updatedAt), desc(invoiceEmailDeliveryJobs.createdAt));

  for (const row of rows) {
    if (result.has(row.invoiceId)) continue;
    result.set(row.invoiceId, {
      id: row.id,
      status: row.status as InvoiceEmailDeliveryStatus,
      failureReason: row.failureReason ?? null,
      updatedAt: row.updatedAt ?? row.createdAt ?? null,
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

type InvoiceEmailDeliveryMetadata = {
  deliveryMode?: "individual_invoice_messages" | "individual_invoice_message" | "interactive_invoice_message";
  createdByUserId?: string | null;
  createdByUserName?: string | null;
  allowUnapproved?: boolean;
  subject?: string | null;
  message?: string | null;
  retryOfNeedsReviewJobId?: string;
  queueStage?: "preparing" | "provider_submitting";
  providerSubmissionStartedAt?: string;
  /** Last concrete canonical-sender stage. This is diagnostic evidence only;
   * queueStage remains the durable provider-boundary authority. */
  lastStage?: string;
  lastStageAt?: string;
  deliveryReview?: Partial<InvoiceEmailDeliveryReviewMetadata>;
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
        deliveryMode: originalMetadata.deliveryMode === "interactive_invoice_message"
          ? "interactive_invoice_message"
          : "individual_invoice_messages",
        createdByUserId: input.reviewedByUserId || null,
        createdByUserName: input.reviewedByUserName || null,
        retryOfNeedsReviewJobId: original.id,
        allowUnapproved: originalMetadata.allowUnapproved === true,
        subject: typeof originalMetadata.subject === "string" ? originalMetadata.subject : null,
        message: typeof originalMetadata.message === "string" ? originalMetadata.message : null,
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
  createdByUserName?: string | null;
  invoiceIds: string[];
  candidates: BulkInvoiceEmailCandidate[];
  skipped: BulkInvoiceEmailSkip[];
  idempotencyKey: string;
}) {
  return enqueueInvoiceEmailCampaign({ ...input, deliveryMode: "bulk" });
}

/**
 * Queues a one-invoice operator action through the same durable delivery path
 * as bulk sending. This deliberately returns a queue result, not a fake
 * "sent" result: provider acceptance remains the only sent authority.
 */
export async function enqueueInteractiveInvoiceEmailCampaign(input: {
  organizationId: string;
  createdByUserId?: string | null;
  createdByUserName?: string | null;
  invoiceId: string;
  candidates: BulkInvoiceEmailCandidate[];
  idempotencyKey: string;
}) {
  return enqueueInvoiceEmailCampaign({
    organizationId: input.organizationId,
    createdByUserId: input.createdByUserId,
    createdByUserName: input.createdByUserName,
    invoiceIds: [input.invoiceId],
    candidates: input.candidates,
    skipped: [],
    // The database key is bounded. The route scopes the request key to an
    // invoice; retain enough entropy while preventing a malformed header from
    // violating the persistence constraint.
    idempotencyKey: `interactive:${input.idempotencyKey.slice(0, 220)}`,
    deliveryMode: "interactive",
  });
}

async function enqueueInvoiceEmailCampaign(input: {
  organizationId: string;
  createdByUserId?: string | null;
  createdByUserName?: string | null;
  invoiceIds: string[];
  candidates: BulkInvoiceEmailCandidate[];
  skipped: BulkInvoiceEmailSkip[];
  idempotencyKey: string;
  deliveryMode: "bulk" | "interactive";
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
      metadata: {
        deliveryMode: input.deliveryMode === "interactive" ? "interactive_invoice_message" : "individual_invoice_messages",
        createdByUserName: input.createdByUserName || null,
      },
    } as any).onConflictDoNothing().returning();

    if (!created) {
      const [existing] = await tx.select().from(invoiceEmailCampaigns).where(and(
        eq(invoiceEmailCampaigns.organizationId, input.organizationId),
        eq(invoiceEmailCampaigns.idempotencyKey, input.idempotencyKey),
      )).limit(1);
      return { campaign: existing, queued: 0, alreadyQueued: input.candidates.length, blocked: [], replayed: true };
    }

    // Every invoice email uses the same per-organization FIFO schedule. This
    // prevents simultaneous interactive clicks or multiple app replicas from
    // turning a one-per-minute queue into a delivery burst.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`bulk-invoice-email-schedule:${input.organizationId}`}))`);
    const scheduledResult: any = await tx.execute(sql`
      SELECT max(available_at) AS "latestScheduledAt"
      FROM invoice_email_delivery_jobs
      WHERE organization_id = ${input.organizationId}
        AND status IN ('queued', 'retrying', 'processing')
    `);
    const latestScheduledAt = (scheduledResult.rows || scheduledResult)[0]?.latestScheduledAt ?? null;
    let nextAvailableAt = getNextBulkInvoiceEmailSlot({
      now: new Date(),
      latestScheduledAt,
      spacingSeconds: config.spacingSeconds,
    });

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
        availableAt: nextAvailableAt,
        metadata: {
          deliveryMode: input.deliveryMode === "interactive" ? "interactive_invoice_message" : "individual_invoice_message",
          createdByUserId: input.createdByUserId || null,
          createdByUserName: input.createdByUserName || null,
          allowUnapproved: Boolean(candidate.allowUnapproved),
          subject: candidate.subject?.trim() || null,
          message: candidate.message?.trim() || null,
        },
      } as any).onConflictDoNothing().returning({ id: invoiceEmailDeliveryJobs.id });
      if (job) {
        queued += 1;
        nextAvailableAt = new Date(nextAvailableAt.getTime() + config.spacingSeconds * 1000);
      }
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
        deliveryMode: input.deliveryMode === "interactive" ? "interactive_invoice_message" : "individual_invoice_messages",
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

/**
 * Statement delivery intentionally reuses the invoice delivery job table and
 * worker. The target is a frozen statement snapshot, not a mutable invoice.
 */
export async function enqueueCustomerStatementEmailDelivery(input: {
  organizationId: string;
  statementSnapshotId: string;
  createdByUserId?: string | null;
  createdByUserName?: string | null;
  recipientEmails: string[];
  idempotencyKey: string;
}) {
  const recipients = Array.from(new Set(input.recipientEmails.map(normalizeRecipient).filter(Boolean)));
  if (!recipients.length) throw Object.assign(new Error("No statement email recipient is available. Print or download the statement instead."), { statusCode: 400, code: "STATEMENT_RECIPIENT_REQUIRED" });
  const config = getBulkInvoiceEmailQueueConfig();
  return db.transaction(async (tx) => {
    const campaignKey = `statement:${input.idempotencyKey.slice(0, 220)}`;
    const [campaign] = await tx.insert(invoiceEmailCampaigns).values({ organizationId: input.organizationId, createdByUserId: input.createdByUserId || null, idempotencyKey: campaignKey, requestedInvoiceIds: [], selectedInvoiceCount: 0, skippedInvoiceCount: 0, recipientGroupCount: recipients.length, resultSummary: {}, metadata: { deliveryMode: "customer_statement", statementSnapshotId: input.statementSnapshotId, createdByUserName: input.createdByUserName || null } } as any).onConflictDoNothing().returning();
    if (!campaign) return { queued: 0, alreadyQueued: recipients.length, replayed: true };
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`bulk-invoice-email-schedule:${input.organizationId}`}))`);
    const scheduled: any = await tx.execute(sql`SELECT max(available_at) AS "latestScheduledAt" FROM invoice_email_delivery_jobs WHERE organization_id = ${input.organizationId} AND status IN ('queued', 'retrying', 'processing')`);
    let availableAt = getNextBulkInvoiceEmailSlot({ now: new Date(), latestScheduledAt: (scheduled.rows || scheduled)[0]?.latestScheduledAt ?? null, spacingSeconds: config.spacingSeconds });
    let queued = 0;
    for (const recipientEmail of recipients) {
      const [job] = await tx.insert(invoiceEmailDeliveryJobs).values({ organizationId: input.organizationId, campaignId: campaign.id, invoiceId: null, invoiceVersion: 1, deliveryType: "customer_statement", customerStatementSnapshotId: input.statementSnapshotId, recipientEmail, recipientKey: recipientEmail, idempotencyKey: `statement:${input.statementSnapshotId}:${recipientEmail}`, maxAttempts: config.maxAttempts, availableAt, metadata: { deliveryMode: "customer_statement", createdByUserId: input.createdByUserId || null, createdByUserName: input.createdByUserName || null } } as any).onConflictDoNothing().returning({ id: invoiceEmailDeliveryJobs.id });
      if (job) { queued += 1; availableAt = new Date(availableAt.getTime() + config.spacingSeconds * 1000); }
    }
    await tx.update(invoiceEmailCampaigns).set({ queuedInvoiceCount: queued, skippedInvoiceCount: recipients.length - queued, status: queued ? "queued" : "completed", completedAt: queued ? null : new Date(), resultSummary: { queued, deliveryMode: "customer_statement", statementSnapshotId: input.statementSnapshotId }, updatedAt: new Date() } as any).where(eq(invoiceEmailCampaigns.id, campaign.id));
    return { queued, alreadyQueued: recipients.length - queued, replayed: false };
  });
}

export type ClaimedBulkInvoiceEmailJob = {
  id: string;
  organizationId: string;
  invoiceId: string | null;
  deliveryType?: "invoice" | "customer_statement";
  customerStatementSnapshotId?: string | null;
  recipientEmail: string;
  attemptCount: number;
  maxAttempts: number;
  /**
   * Jobs are claimed through a raw SQL query.  Depending on the PostgreSQL
   * driver/runtime, that query can return a timestamp as either a Date or an
   * ISO string even though Drizzle selects normally hydrate Date objects.
   */
  createdAt: Date | string;
  campaignId: string;
  claimedByWorkerId?: string;
  metadata?: InvoiceEmailDeliveryMetadata;
};

/**
 * Convert a raw queue timestamp before using it in a Drizzle timestamp
 * predicate. Passing a raw string to a timestamp column makes Drizzle call
 * `value.toISOString()`, which prevents the worker from reaching the sender.
 */
export function normalizeInvoiceEmailQueueTimestamp(value: Date | string, field = "queue timestamp"): Date {
  const normalized = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(normalized.getTime())) {
    throw Object.assign(new Error(`Invalid ${field} on invoice email delivery job`), {
      code: "INVALID_INVOICE_EMAIL_QUEUE_TIMESTAMP",
    });
  }
  return normalized;
}

function logDeliveryStage(job: ClaimedBulkInvoiceEmailJob, stage: string, detail: Record<string, unknown> = {}): void {
  console.log("[InvoiceEmailQueue]", {
    stage,
    jobId: job.id,
    organizationId: job.organizationId,
    invoiceId: job.invoiceId,
    attempt: job.attemptCount,
    ...detail,
  });
}

/**
 * Persist the canonical sender's most recent stage without changing queue
 * state. Console logs are useful in Railway, but a failed job must retain
 * enough evidence for staff and support even when runtime logs are gone.
 */
export async function recordInvoiceEmailDeliveryStage(input: {
  organizationId: string;
  deliveryJobId: string | null | undefined;
  stage: string;
}): Promise<void> {
  if (!input.deliveryJobId) return;
  const stage = String(input.stage || "unknown").slice(0, 120);
  // jsonb_build_object is polymorphic. PostgreSQL cannot infer an untyped
  // prepared parameter in this position, so the SQL below explicitly casts
  // the stage to text before the provider boundary is recorded.
  await db.execute(sql`
    UPDATE invoice_email_delivery_jobs
    SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'lastStage', ${stage}::text,
          'lastStageAt', now()::text
        ),
        updated_at = now()
    WHERE id = ${input.deliveryJobId}
      AND organization_id = ${input.organizationId}
      AND status = 'processing'
  `);
}

/**
 * Called immediately before the provider boundary. A stale claim before this
 * marker is safe to retry; after it, provider acceptance is uncertain and the
 * job must stop for review rather than risk a duplicate email.
 */
export async function markInvoiceEmailDeliveryProviderSubmissionStarted(input: {
  organizationId: string;
  deliveryJobId: string | null | undefined;
}): Promise<void> {
  if (!input.deliveryJobId) return;
  await db.execute(sql`
    UPDATE invoice_email_delivery_jobs
    SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'queueStage', 'provider_submitting',
          'providerSubmissionStartedAt', now()::text
        ),
        updated_at = now()
    WHERE id = ${input.deliveryJobId}
      AND organization_id = ${input.organizationId}
      AND status = 'processing'
  `);
}

async function hasInvoiceEmailReachedProviderBoundary(job: ClaimedBulkInvoiceEmailJob): Promise<boolean> {
  const metadata = await getInvoiceEmailDeliveryMetadata(job);
  return metadata.queueStage === "provider_submitting";
}

async function getInvoiceEmailDeliveryMetadata(job: ClaimedBulkInvoiceEmailJob): Promise<InvoiceEmailDeliveryMetadata> {
  const result: any = await db.execute(sql`
    SELECT metadata
    FROM invoice_email_delivery_jobs
    WHERE id = ${job.id}
      AND organization_id = ${job.organizationId}
    LIMIT 1
  `);
  const row = (Array.isArray(result) ? result : result?.rows || [])[0] as { metadata?: unknown } | undefined;
  return asMetadata(row?.metadata) as InvoiceEmailDeliveryMetadata;
}

async function claimOneBulkInvoiceEmailJob(): Promise<ClaimedBulkInvoiceEmailJob | null> {
  const config = getBulkInvoiceEmailQueueConfig();
  const claimed = await db.transaction(async (tx) => {
    // A stale claim is reviewable only when its durable boundary marker proves
    // the provider request began. Every other stale job is known to be
    // pre-provider (or lacks any evidence of submission) and can retry.
    const expiredResult: any = await tx.execute(sql`
      UPDATE invoice_email_delivery_jobs
      SET status = CASE
            WHEN metadata ? 'queueStage' AND metadata->>'queueStage' = 'provider_submitting' THEN 'needs_review'
            ELSE 'retrying'
          END,
          available_at = CASE
            WHEN metadata ? 'queueStage' AND metadata->>'queueStage' = 'provider_submitting' THEN available_at
            ELSE now() + (${config.retryBaseSeconds} * interval '1 second')
          END,
          claim_expires_at = null,
          failure_reason = coalesce(failure_reason, CASE
            WHEN metadata ? 'queueStage' AND metadata->>'queueStage' = 'provider_submitting'
              THEN 'Delivery outcome is uncertain because the worker stopped after provider submission began. The message was not resent to avoid a duplicate email.'
            ELSE concat(
              'Email preparation stopped before provider submission at ',
              coalesce(nullif(metadata->>'lastStage', ''), 'an unknown pre-provider stage'),
              '. The message was not submitted to the provider and will retry.'
            )
          END),
          updated_at = now()
      WHERE status = 'processing' AND claim_expires_at <= now()
      RETURNING campaign_id AS "campaignId", status
    `);
    const expiredRows = (Array.isArray(expiredResult) ? expiredResult : expiredResult?.rows || []) as Array<{ campaignId?: string }>;
    const expiredCampaignIds = Array.from(new Set(expiredRows.map((row) => String(row.campaignId || "")).filter(Boolean)));
    const result: any = await tx.execute(sql`
      SELECT id, organization_id AS "organizationId", invoice_id AS "invoiceId",
             recipient_email AS "recipientEmail", attempt_count AS "attemptCount",
             max_attempts AS "maxAttempts", created_at AS "createdAt", campaign_id AS "campaignId",
             metadata AS "metadata", delivery_type AS "deliveryType",
             customer_statement_snapshot_id AS "customerStatementSnapshotId"
      FROM invoice_email_delivery_jobs
      WHERE status IN ('queued', 'retrying')
        AND available_at <= now()
        AND attempt_count < max_attempts
      ORDER BY available_at ASC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    const row = (result.rows || result)[0] as ClaimedBulkInvoiceEmailJob | undefined;
    if (!row) return { job: null, expiredCampaignIds };

    const workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;
    const claimResult: any = await tx.execute(sql`
      UPDATE invoice_email_delivery_jobs
      SET status = 'processing', attempt_count = attempt_count + 1, claimed_at = now(),
          claim_expires_at = now() + (${config.claimSeconds} * interval '1 second'),
          claimed_by_worker_id = ${workerId},
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('queueStage', 'preparing'),
          updated_at = now()
      WHERE id = ${row.id} AND status IN ('queued', 'retrying') AND attempt_count < max_attempts
    `);
    if (Number(claimResult.rowCount ?? 1) === 0) return { job: null, expiredCampaignIds };
    return {
      job: {
        ...row,
        attemptCount: Number(row.attemptCount || 0) + 1,
        claimedByWorkerId: workerId,
        metadata: asMetadata(row.metadata) as InvoiceEmailDeliveryMetadata,
      },
      expiredCampaignIds,
    };
  });
  // Stale provider-boundary claims remain visible for review. Claims which
  // expired before that boundary return to the regular bounded retry flow.
  await Promise.all(claimed.expiredCampaignIds.map((campaignId) => updateCampaignCompletion(campaignId)));
  return claimed.job;
}

/** Keep the atomic claim alive only while this process is actively awaiting
 * its one serial send. A crashed process stops renewing and is recovered on a
 * later minute tick; staff never need to reason about leases. */
function beginClaimHeartbeat(job: ClaimedBulkInvoiceEmailJob): () => void {
  if (!job.claimedByWorkerId) return () => undefined;
  const interval = setInterval(() => {
    void db.execute(sql`
      UPDATE invoice_email_delivery_jobs
      SET claim_expires_at = now() + (${getBulkInvoiceEmailQueueConfig().claimSeconds} * interval '1 second'), updated_at = now()
      WHERE id = ${job.id}
        AND organization_id = ${job.organizationId}
        AND status = 'processing'
        AND claimed_by_worker_id = ${job.claimedByWorkerId}
    `).catch((error) => console.warn("[InvoiceEmailQueue] claim heartbeat failed", { jobId: job.id, message: error instanceof Error ? error.message : String(error) }));
  }, 15_000);
  interval.unref?.();
  return () => clearInterval(interval);
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

/** The bulk worker's only delivery operation: invoke the registered canonical sender. */
export async function processClaimedBulkInvoiceEmailJob(job: ClaimedBulkInvoiceEmailJob): Promise<"sent" | "failed"> {
  logDeliveryStage(job, "job_claimed");
  const stopHeartbeat = beginClaimHeartbeat(job);
  try {
  // The claim query is intentionally raw SQL for SKIP LOCKED. Normalize its
  // timestamp result at this boundary before handing it to Drizzle below.
  const queuedAt = normalizeInvoiceEmailQueueTimestamp(job.createdAt, "createdAt");
  const isStatement = job.deliveryType === "customer_statement";
  const senderAvailable = isStatement ? Boolean(canonicalCustomerStatementEmailSender) : Boolean(canonicalInvoiceEmailSender);
  if (!senderAvailable) {
    const terminal = job.attemptCount >= job.maxAttempts;
    await db.update(invoiceEmailDeliveryJobs).set({
      status: terminal ? "failed" : "retrying",
      availableAt: terminal ? new Date() : new Date(Date.now() + 60_000),
      claimExpiresAt: null,
      failureReason: isStatement ? "Canonical customer statement email sender is not registered" : "Canonical invoice email sender is not registered",
      updatedAt: new Date(),
    } as any).where(eq(invoiceEmailDeliveryJobs.id, job.id));
    logDeliveryStage(job, "sender_unavailable", { terminal });
    if (terminal) await updateCampaignCompletion(job.campaignId);
    return "failed";
  }

  let alreadySent: { id: string; messageId: string | null } | undefined;
  if (isStatement) {
    [alreadySent] = await db.select({ id: customerStatementEmailLogs.id, messageId: customerStatementEmailLogs.messageId })
      .from(customerStatementEmailLogs).where(and(
        eq(customerStatementEmailLogs.organizationId, job.organizationId),
        eq(customerStatementEmailLogs.statementSnapshotId, job.customerStatementSnapshotId || ""),
        eq(customerStatementEmailLogs.status, "sent"), gte(customerStatementEmailLogs.sentAt, queuedAt),
        sql`lower(${customerStatementEmailLogs.recipientEmail}) = ${normalizeRecipient(job.recipientEmail)}`,
      )).limit(1);
  } else {
    [alreadySent] = await db.select({ id: invoiceEmailLogs.id, messageId: invoiceEmailLogs.messageId })
      .from(invoiceEmailLogs).where(and(
        eq(invoiceEmailLogs.organizationId, job.organizationId), eq(invoiceEmailLogs.invoiceId, job.invoiceId || ""),
        eq(invoiceEmailLogs.status, "sent"), eq(invoiceEmailLogs.type, "invoice_send"), gte(invoiceEmailLogs.sentAt, queuedAt),
        sql`lower(${invoiceEmailLogs.recipientEmail}) = ${normalizeRecipient(job.recipientEmail)}`,
      )).limit(1);
  }

    logDeliveryStage(job, "canonical_sender_started", { alreadySent: Boolean(alreadySent) });
    // Do not construct the sender promise before checking durable success
    // evidence: constructing it would submit a duplicate email even though
    // `alreadySent` later short-circuits the await.
    let outcome: { messageId?: string | null } | undefined = alreadySent;
    if (!outcome && isStatement) {
      outcome = await canonicalCustomerStatementEmailSender!({ organizationId: job.organizationId, statementSnapshotId: job.customerStatementSnapshotId || "", userId: job.metadata?.createdByUserId || null, userName: job.metadata?.createdByUserName || null, toEmail: job.recipientEmail, deliveryJobId: job.id });
    } else if (!outcome) {
      outcome = await canonicalInvoiceEmailSender!({ organizationId: job.organizationId, invoiceId: job.invoiceId || "", userId: job.metadata?.createdByUserId || null, userName: job.metadata?.createdByUserName || null, toEmail: job.recipientEmail, deliveryJobId: job.id, allowUnapproved: job.metadata?.allowUnapproved === true, subject: job.metadata?.subject || undefined, message: job.metadata?.message || undefined });
    }
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
    const rawMessage = String((error as any)?.message || error || "Invoice email delivery failed").slice(0, 1000);
    // Needs Review is reserved for a genuinely ambiguous *provider* outcome.
    // Everything before the durable provider boundary is known not to have
    // sent and therefore remains safely retryable.
    const deliveryMetadata = await getInvoiceEmailDeliveryMetadata(job).catch(() => null);
    const providerStarted = deliveryMetadata?.queueStage === "provider_submitting";
    const lastStage = String(deliveryMetadata?.lastStage || "").trim();
    const message = lastStage ? `${lastStage}: ${rawMessage}`.slice(0, 1000) : rawMessage;
    const failureKind = getInvoiceEmailDeliveryFailureKind(error);
    const needsReview = providerStarted && (failureKind === "needs_review" || (!failureKind && isAmbiguousProviderFailure(error)));
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
  } finally {
    stopHeartbeat();
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
      if (await processClaimedBulkInvoiceEmailJob(job) === "sent") sent += 1;
      else failed += 1;
    }
    return { processed, sent, failed };
  } finally {
    workerRunning = false;
  }
}
