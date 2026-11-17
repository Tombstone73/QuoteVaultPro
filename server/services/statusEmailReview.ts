import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { auditLogs, invoiceEmailCampaigns, invoiceEmailDeliveryJobs as jobs, userOrganizations, users } from "@shared/schema";
import type { StatusEmailReviewCommand, StatusEmailReviewEntry, StatusEmailReviewHistory, StatusEmailReviewResult } from "@shared/statusEmailReview";
import { db } from "../db";
import { eligibleStatusDeliveryPayload, lockStatusDeliveryTarget, type StatusDeliveryTransaction } from "./orderStatusNotifications";

type Job = typeof jobs.$inferSelect;
type Reviewer = { userId: string; userName: string | null };
type Command = StatusEmailReviewCommand;

export class StatusEmailReviewError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message); }
}

const activeOrSent = ["queued", "processing", "retrying", "needs_review", "sent"] as const;
const scope = (organizationId: string, jobId: string) =>
  and(eq(jobs.organizationId, organizationId), eq(jobs.id, jobId), eq(jobs.deliveryType, "order_status"));

export async function reviewStatusEmail(input: { organizationId: string; jobId: string; reviewer: Reviewer; command: Command }): Promise<StatusEmailReviewResult> {
  const { organizationId, jobId, reviewer, command } = input;
  return db.transaction(async tx => {
    const [member] = await tx.select({ id: users.id }).from(userOrganizations)
      .innerJoin(users, eq(users.id, userOrganizations.userId)).where(and(
        eq(userOrganizations.organizationId, organizationId), eq(userOrganizations.userId, reviewer.userId),
        inArray(userOrganizations.role, ["owner", "admin"]), eq(users.accountType, "INTERNAL_USER"), ne(users.role, "customer"),
      )).for("share").limit(1);
    if (!member) throw new StatusEmailReviewError(403, "Organization Owner or Admin access is required.");

    // Resend uses the same order -> pill -> job lock order as dispatch and cancellation.
    const where = scope(organizationId, jobId);
    const [candidate] = command.action === "resend" ? await tx.select({ orderId: jobs.statusOrderId }).from(jobs).where(where) : [];
    const target = candidate?.orderId ? await lockStatusDeliveryTarget(tx, organizationId, candidate.orderId) : null;
    const [job] = await tx.select().from(jobs).where(where).for("update");
    if (!job?.statusOrderId || !job.recipientEmail || !["customer_email", "staff_email"].includes(String(job.metadata.kind)))
      throw new StatusEmailReviewError(404, "Order status email delivery was not found.");

    const history = (job.metadata.statusDeliveryReview ?? { entries: [] }) as StatusEmailReviewHistory;
    return command.action === "record"
      ? recordReview(tx, job, reviewer, history, command)
      : queueReviewedReplacement(tx, job, reviewer, history, target);
  });
}

async function recordReview(tx: StatusDeliveryTransaction, job: Job, reviewer: Reviewer, review: StatusEmailReviewHistory,
  command: Extract<Command, { action: "record" }>): Promise<StatusEmailReviewResult> {
  const previous = review.entries.find(entry => entry.requestId === command.requestId);
  if (previous) {
    if (previous.outcome !== command.outcome || previous.evidence !== command.evidence ||
        previous.gmailMessageId !== (command.gmailMessageId ?? null) || previous.reviewerId !== reviewer.userId)
      throw new StatusEmailReviewError(409, "This review request was already used for a different submission.");
    return { jobId: job.id, status: job.status, review, replayed: true };
  }
  if (job.status !== "needs_review" || review.entries.some(entry => entry.outcome !== "unresolved"))
    throw new StatusEmailReviewError(409, "This delivery is no longer awaiting review. Refresh the queue for its current outcome.");
  if (command.outcome === "confirmed_not_sent" && (job.providerMessageId || job.sentAt))
    throw new StatusEmailReviewError(409, "This attempt already has a Gmail receipt or a recorded sent time. Review that evidence before resolving.");
  const now = new Date();
  const entry: StatusEmailReviewEntry = { requestId: command.requestId, outcome: command.outcome, evidence: command.evidence,
    gmailMessageId: command.gmailMessageId ?? null, reviewerId: reviewer.userId, reviewerName: reviewer.userName, reviewedAt: now.toISOString() };
  const history = { ...review, attemptUpdatedAt: review.attemptUpdatedAt ?? job.updatedAt.toISOString(),
    entries: [...review.entries, entry] };
  const status = command.outcome === "confirmed_sent" ? "sent" : command.outcome === "confirmed_not_sent" ? "failed" : "needs_review";
  // Keep the original provider receipt, attempts, timestamps and failure reason as recorded.
  await tx.update(jobs).set({ status, updatedAt: now, metadata: { ...job.metadata, statusDeliveryReview: history } })
    .where(scope(job.organizationId, job.id));
  await writeAudit(tx, job, reviewer, "status_email_delivery_reviewed", { requestId: entry.requestId, outcome: entry.outcome });
  return { jobId: job.id, status, review: history, replayed: false };
}

async function queueReviewedReplacement(tx: StatusDeliveryTransaction, job: Job, reviewer: Reviewer, review: StatusEmailReviewHistory,
  target: Awaited<ReturnType<typeof lockStatusDeliveryTarget>> | null): Promise<StatusEmailReviewResult> {
  if (review.replacement) return { jobId: job.id, status: job.status, review, replayed: true };
  if (job.status !== "failed" || review.entries.at(-1)?.outcome !== "confirmed_not_sent")
    throw new StatusEmailReviewError(409, "A separate Confirmed Not Sent review is required before requesting a new send.");
  if (job.providerMessageId || job.sentAt)
    throw new StatusEmailReviewError(409, "This attempt has a Gmail receipt or a recorded sent time. A new send is blocked.");
  const payload = target && await eligibleStatusDeliveryPayload(tx, job, target);
  if (!payload || payload.kind === "customer_portal" || !job.statusEventId)
    throw new StatusEmailReviewError(409, "The order status, notification rule, or recipient is no longer eligible for a new send.");

  const [other] = await tx.select({ id: jobs.id }).from(jobs).where(and(
    eq(jobs.organizationId, job.organizationId), eq(jobs.deliveryType, "order_status"), ne(jobs.id, job.id),
    eq(jobs.statusEventId, job.statusEventId), eq(jobs.statusOrderId, job.statusOrderId!),
    sql`lower(trim(${jobs.recipientEmail})) = lower(trim(${job.recipientEmail}::text))`,
    or(inArray(jobs.status, [...activeOrSent]), sql`${jobs.providerMessageId} is not null or ${jobs.sentAt} is not null`,
      sql`(${jobs.metadata}->>'queueStage' = 'provider_submitting' and
        coalesce(${jobs.metadata}#>>'{statusDeliveryReview,entries,-1,outcome}', '') <> 'confirmed_not_sent')`),
  )).limit(1);
  if (other) throw new StatusEmailReviewError(409, "Another successful, active, or uncertain delivery exists for this status event and recipient.");

  const now = new Date();
  const key = `order-status-review-resend:${job.id}`;
  const [campaign] = await tx.insert(invoiceEmailCampaigns).values({
    organizationId: job.organizationId, createdByUserId: reviewer.userId, idempotencyKey: key,
    requestedInvoiceIds: [], selectedInvoiceCount: 0, skippedInvoiceCount: 0, recipientGroupCount: 1,
    metadata: { source: "order_status", replacesStatusEmailJobId: job.id },
  }).returning({ id: invoiceEmailCampaigns.id });
  const [replacement] = await tx.insert(jobs).values({
    organizationId: job.organizationId, campaignId: campaign.id, invoiceVersion: job.invoiceVersion,
    deliveryType: "order_status", statusOrderId: job.statusOrderId, statusPillId: job.statusPillId, statusEventId: job.statusEventId,
    recipientEmail: job.recipientEmail, recipientKey: job.recipientKey, idempotencyKey: key,
    sendAfter: now, availableAt: now, maxAttempts: job.maxAttempts,
    metadata: { ...payload, orderNumber: job.metadata.orderNumber, statusLabel: job.metadata.statusLabel, replacesStatusEmailJobId: job.id },
  }).returning({ id: jobs.id });
  const history: StatusEmailReviewHistory = { ...review, replacement: { jobId: replacement.id,
    requestedAt: now.toISOString(), reviewerId: reviewer.userId, reviewerName: reviewer.userName } };
  await tx.update(jobs).set({ updatedAt: now, metadata: { ...job.metadata, statusDeliveryReview: history } })
    .where(scope(job.organizationId, job.id));
  await writeAudit(tx, job, reviewer, "status_email_replacement_queued", { replacementJobId: replacement.id });
  return { jobId: job.id, status: job.status, review: history, replayed: false };
}

async function writeAudit(tx: StatusDeliveryTransaction, job: Job, reviewer: Reviewer, actionType: string, values: Record<string, string>) {
  await tx.insert(auditLogs).values({
    organizationId: job.organizationId, userId: reviewer.userId, userName: reviewer.userName, actionType,
    entityType: "invoice_email_delivery_job", entityId: job.id, entityName: "Order status email",
    description: actionType === "status_email_delivery_reviewed" ? "Recorded a manual review of the order status email."
      : "Explicitly requested a new order status email after a Confirmed Not Sent review.",
    newValues: values,
  });
}
