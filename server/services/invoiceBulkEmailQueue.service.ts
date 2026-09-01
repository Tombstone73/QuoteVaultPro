import { createHash, randomUUID } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import {
  invoiceEmailCampaigns,
  invoiceEmailDeliveryJobs,
  invoiceEmailLogs,
} from "../../shared/schema";

type CanonicalInvoiceEmailSender = (input: {
  organizationId: string;
  invoiceId: string;
  userId?: string | null;
  userName?: string | null;
  toEmail?: string | null;
}) => Promise<{ messageId?: string | null }>;

export type BulkInvoiceEmailCandidate = {
  invoiceId: string;
  invoiceVersion: number;
  recipientEmail: string;
};

export type BulkInvoiceEmailSkip = { invoiceId: string; reason: string };

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
      return { campaign: existing, queued: 0, alreadyQueued: input.candidates.length, replayed: true };
    }

    let queued = 0;
    let alreadyQueued = 0;
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
      else alreadyQueued += 1;
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
        skipped: input.skipped,
        deliveryMode: "individual_invoice_messages",
      },
      updatedAt: new Date(),
    } as any).where(eq(invoiceEmailCampaigns.id, created.id)).returning();
    return { campaign: updated, queued, alreadyQueued, replayed: false };
  });

  return {
    campaignId: campaign.campaign?.id || null,
    selected: input.invoiceIds.length,
    queued: campaign.queued,
    alreadyQueued: campaign.alreadyQueued,
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

async function claimOneBulkInvoiceEmailJob(): Promise<ClaimedJob | null> {
  const config = getBulkInvoiceEmailQueueConfig();
  return db.transaction(async (tx) => {
    const result: any = await tx.execute(sql`
      SELECT id, organization_id AS "organizationId", invoice_id AS "invoiceId",
             recipient_email AS "recipientEmail", attempt_count AS "attemptCount",
             max_attempts AS "maxAttempts", created_at AS "createdAt", campaign_id AS "campaignId",
             metadata AS "metadata"
      FROM invoice_email_delivery_jobs
      WHERE (status IN ('queued', 'retrying') AND available_at <= now())
         OR (status = 'processing' AND claim_expires_at <= now())
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
    await tx.execute(sql`
      UPDATE invoice_email_delivery_jobs
      SET status = 'processing', attempt_count = attempt_count + 1, claimed_at = now(),
          claim_expires_at = now() + (${config.claimSeconds} * interval '1 second'),
          claimed_by_worker_id = ${workerId}, updated_at = now()
      WHERE id = ${row.id}
    `);
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
      count(*) FILTER (WHERE status = 'failed')::int AS failed
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
  if (!canonicalInvoiceEmailSender) {
    await db.update(invoiceEmailDeliveryJobs).set({
      status: "retrying",
      availableAt: new Date(Date.now() + 60_000),
      failureReason: "Canonical invoice email sender is not registered",
      updatedAt: new Date(),
    } as any).where(eq(invoiceEmailDeliveryJobs.id, job.id));
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
    const outcome = alreadySent || await canonicalInvoiceEmailSender({
      organizationId: job.organizationId,
      invoiceId: job.invoiceId,
      userId: job.metadata?.createdByUserId || null,
      toEmail: job.recipientEmail,
    });
    await db.update(invoiceEmailDeliveryJobs).set({
      status: "sent",
      sentAt: new Date(),
      providerMessageId: outcome?.messageId || null,
      failureReason: null,
      claimExpiresAt: null,
      updatedAt: new Date(),
    } as any).where(eq(invoiceEmailDeliveryJobs.id, job.id));
    await updateCampaignCompletion(job.campaignId);
    return "sent";
  } catch (error) {
    const message = String((error as any)?.message || error || "Invoice email delivery failed").slice(0, 1000);
    const terminal = isAmbiguousProviderFailure(error) || job.attemptCount >= job.maxAttempts;
    await db.update(invoiceEmailDeliveryJobs).set({
      status: terminal ? "failed" : "retrying",
      availableAt: terminal ? new Date() : new Date(Date.now() + getBulkInvoiceEmailQueueConfig().retryBaseSeconds * 1000 * Math.max(1, job.attemptCount)),
      claimExpiresAt: null,
      failureReason: terminal && isAmbiguousProviderFailure(error)
        ? `Outcome requires review before retry to avoid a duplicate email: ${message}`
        : message,
      updatedAt: new Date(),
    } as any).where(eq(invoiceEmailDeliveryJobs.id, job.id));
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
