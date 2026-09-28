import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { invoiceEmailCampaigns, invoiceEmailDeliveryJobs, invoiceEmailLogs } from "../../shared/schema";
import { CANCELABLE_EMAIL_QUEUE_STATUSES, invoiceEmailSupersessionEvidence } from "../../shared/emailQueueLifecycle";

type QueueDb = Pick<typeof db, "select" | "update">;

export async function updateCampaignCompletion(campaignId: string): Promise<void> {
  const result: any = await db.execute(sql`
    SELECT count(*) FILTER (WHERE status IN ('queued', 'retrying', 'processing'))::int AS active,
           count(*) FILTER (WHERE status IN ('failed', 'needs_review'))::int AS failed
    FROM invoice_email_delivery_jobs WHERE campaign_id = ${campaignId}
  `);
  const row = (result.rows || result)[0] || {};
  if (Number(row.active || 0) > 0) return;
  await db.update(invoiceEmailCampaigns).set({ status: Number(row.failed || 0) > 0 ? "completed_with_errors" : "completed",
    completedAt: new Date(), updatedAt: new Date() }).where(eq(invoiceEmailCampaigns.id, campaignId));
}

export async function cancelEmailQueueJobs(input: {
  organizationId: string; jobIds: string[]; userId: string; userName?: string | null; reason?: string;
}) {
  const ids = Array.from(new Set(input.jobIds.filter(Boolean)));
  if (ids.length > 100) throw Object.assign(new Error("Select no more than 100 email jobs"), { statusCode: 400 });
  if (!ids.length) return { canceled: [], alreadyCanceled: [], skipped: [] };
  const audit = { canceledAt: new Date().toISOString(), canceledByUserId: input.userId,
    canceledByUserName: input.userName || null, reason: input.reason?.trim().slice(0, 500) || null };
  const result = await db.transaction(async tx => {
    // Conditional UPDATE serializes against the worker's FOR UPDATE claim.
    const canceled = await tx.update(invoiceEmailDeliveryJobs).set({
      status: "canceled", claimExpiresAt: null, updatedAt: new Date(),
      metadata: sql`coalesce(${invoiceEmailDeliveryJobs.metadata}, '{}'::jsonb) || ${JSON.stringify({ cancellation: audit })}::jsonb`,
    }).where(and(eq(invoiceEmailDeliveryJobs.organizationId, input.organizationId), inArray(invoiceEmailDeliveryJobs.id, ids),
      inArray(invoiceEmailDeliveryJobs.status, [...CANCELABLE_EMAIL_QUEUE_STATUSES])))
      .returning({ id: invoiceEmailDeliveryJobs.id, campaignId: invoiceEmailDeliveryJobs.campaignId });
    const changed = new Set(canceled.map(row => row.id));
    const remaining = ids.filter(id => !changed.has(id));
    const rows = remaining.length ? await tx.select({ id: invoiceEmailDeliveryJobs.id, status: invoiceEmailDeliveryJobs.status })
      .from(invoiceEmailDeliveryJobs).where(and(eq(invoiceEmailDeliveryJobs.organizationId, input.organizationId), inArray(invoiceEmailDeliveryJobs.id, remaining))) : [];
    return { canceled, alreadyCanceled: rows.filter(row => row.status === "canceled").map(row => row.id),
      skipped: remaining.filter(id => !rows.some(row => row.id === id && row.status === "canceled")).map(id => ({ id,
        status: rows.find(row => row.id === id)?.status || "not_found",
        reason: rows.find(row => row.id === id)?.status === "processing" ? "Processing — cannot safely cancel" : "Job is no longer cancelable or was not found",
      })) };
  });
  await Promise.all(Array.from(new Set(result.canceled.map(row => row.campaignId))).map(updateCampaignCompletion));
  return { ...result, canceled: result.canceled.map(row => row.id) };
}

export async function findSuccessfulInvoiceReplacement(connection: QueueDb, older: typeof invoiceEmailDeliveryJobs.$inferSelect) {
  if (older.deliveryType !== "invoice" || !older.invoiceId) return null;
  const later = await connection.select().from(invoiceEmailDeliveryJobs).where(and(
    eq(invoiceEmailDeliveryJobs.organizationId, older.organizationId), eq(invoiceEmailDeliveryJobs.invoiceId, older.invoiceId),
    eq(invoiceEmailDeliveryJobs.status, "sent"), gt(invoiceEmailDeliveryJobs.createdAt, older.createdAt),
    eq(invoiceEmailDeliveryJobs.recipientKey, older.recipientKey), eq(invoiceEmailDeliveryJobs.invoiceVersion, older.invoiceVersion),
  )).orderBy(asc(invoiceEmailDeliveryJobs.createdAt));
  for (const job of later) {
    const evidence = invoiceEmailSupersessionEvidence(older, job);
    if (evidence) return { job, evidence };
  }
  return null;
}

export async function supersedePendingInvoiceJob(connection: QueueDb, older: typeof invoiceEmailDeliveryJobs.$inferSelect) {
  const replacement = await findSuccessfulInvoiceReplacement(connection, older);
  if (!replacement) return null;
  const [updated] = await connection.update(invoiceEmailDeliveryJobs).set({ status: "superseded", claimExpiresAt: null, updatedAt: new Date(),
    metadata: sql`coalesce(${invoiceEmailDeliveryJobs.metadata}, '{}'::jsonb) || ${JSON.stringify({ supersession: {
      supersededAt: new Date().toISOString(), replacementJobId: replacement.job.id, successfulSentAt: replacement.job.sentAt,
      providerMessageId: replacement.job.providerMessageId, evidence: replacement.evidence,
    } })}::jsonb`,
  }).where(and(eq(invoiceEmailDeliveryJobs.organizationId, older.organizationId), eq(invoiceEmailDeliveryJobs.id, older.id),
    inArray(invoiceEmailDeliveryJobs.status, ["queued", "retrying"]))).returning({ id: invoiceEmailDeliveryJobs.id });
  return updated || null;
}

/** Called after durable success; never supersede an in-flight or uncertain send. */
export async function reconcilePendingInvoiceSiblings(organizationId: string, invoiceId: string) {
  const campaigns = await db.transaction(async tx => {
    const pending = await tx.select().from(invoiceEmailDeliveryJobs).where(and(eq(invoiceEmailDeliveryJobs.organizationId, organizationId),
      eq(invoiceEmailDeliveryJobs.invoiceId, invoiceId), inArray(invoiceEmailDeliveryJobs.status, ["queued", "retrying"])))
      .orderBy(asc(invoiceEmailDeliveryJobs.id)).for("update");
    const changed: string[] = [];
    for (const row of pending) if (await supersedePendingInvoiceJob(tx, row)) changed.push(row.campaignId);
    return Array.from(new Set(changed));
  });
  await Promise.all(campaigns.map(updateCampaignCompletion));
}

/** Read-only, scoped historical inspection. No apply mode or broad repair endpoint. */
export async function inspectInvoiceQueueSupersession(organizationId: string, invoiceId: string) {
  const pending = await db.select().from(invoiceEmailDeliveryJobs).where(and(eq(invoiceEmailDeliveryJobs.organizationId, organizationId),
    eq(invoiceEmailDeliveryJobs.invoiceId, invoiceId), inArray(invoiceEmailDeliveryJobs.status, ["queued", "retrying"])));
  return Promise.all(pending.map(async row => {
    const replacement = await findSuccessfulInvoiceReplacement(db, row);
    const laterLogs = await db.select({ id: invoiceEmailLogs.id, recipientEmail: invoiceEmailLogs.recipientEmail,
      sentAt: invoiceEmailLogs.sentAt, messageId: invoiceEmailLogs.messageId }).from(invoiceEmailLogs).where(and(
      eq(invoiceEmailLogs.organizationId, organizationId), eq(invoiceEmailLogs.invoiceId, invoiceId),
      eq(invoiceEmailLogs.type, "invoice_send"), eq(invoiceEmailLogs.status, "sent"), gt(invoiceEmailLogs.sentAt, row.createdAt),
    )).orderBy(desc(invoiceEmailLogs.sentAt));
    return { oldJobId: row.id, status: row.status, documentType: row.deliveryType, invoiceId, recipientEmail: row.recipientEmail,
      queuedAt: row.createdAt, invoiceVersion: row.invoiceVersion, campaignId: row.campaignId,
      subject: row.metadata.subject ?? null, message: row.metadata.message ?? null,
      retryOfNeedsReviewJobId: row.metadata.retryOfNeedsReviewJobId ?? null,
      laterSuccessfulJob: replacement?.job.id || null, successfulSentAt: replacement?.job.sentAt || null,
      evidence: replacement?.evidence || "No proven same-intent replacement. Invoice/recipient/time alone is insufficient.",
      proposedStatus: replacement ? "superseded" : null, laterSuccessfulLogs: laterLogs };
  }));
}
