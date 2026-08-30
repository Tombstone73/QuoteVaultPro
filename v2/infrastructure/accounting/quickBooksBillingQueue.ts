import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { Pool, PoolClient } from "pg";
import {
  syncV2InvoiceToQuickBooks,
  syncV2PaymentToQuickBooks,
  syncV2RefundCreditMemoToQuickBooks,
  syncV2RefundDisbursementToQuickBooks,
  fetchQBCustomersForPreview,
  fetchQBInvoicePreviewPage,
  importQBInvoicesByIds,
  type QBInvoicePreviewScope,
  type V2QuickBooksCustomer,
} from "../../../server/quickbooksService.js";
import { quickBooksQueueFailureState, v2QuickBooksQueueWorkerEnabled } from "./quickBooksQueuePolicy.js";
export { quickBooksQueueFailureState, v2QuickBooksQueueWorkerEnabled } from "./quickBooksQueuePolicy.js";

export type QuickBooksSyncSubject = "invoice" | "payment" | "refund";
type QuickBooksLinkKind = "customer" | "invoice" | "payment" | "refund_credit_memo" | "refund_disbursement";
type JobState = "queued" | "processing" | "retry" | "succeeded" | "uncertain" | "blocked";
type Job = Readonly<{ id: string; organizationId: string; subjectKind: QuickBooksSyncSubject; subjectId: string; attemptCount: number }>;
export type QuickBooksQueueRunResult = Readonly<{ claimed: number; succeeded: number; retry: number; uncertain: number; blocked: number }>;
export type QuickBooksOperationsRead = Readonly<{
  eligibleInvoices: ReadonlyArray<Readonly<{ invoiceId: string; displayNumber: string; customerName: string; totalCents: number; currency: string }>>;
  activity: ReadonlyArray<Readonly<{ jobId: string; subjectKind: QuickBooksSyncSubject; subjectId: string; displayNumber: string; amountCents: number | null; currency: string | null; state: JobState; attemptCount: number; lastError: string | null; updatedAt: string; completedAt: string | null; providerId: string | null; retryEligible: boolean }>>;
}>;

const retryDelayMs = (attempt: number) => Math.min(30 * 60_000, 15_000 * 2 ** Math.min(Math.max(0, attempt - 1), 7));
const concise = (cause: unknown) => String((cause as { message?: unknown })?.message ?? cause ?? "QuickBooks sync failed").replace(/\s+/g, " ").replace(/\0/g, "").trim().slice(0, 500) || "QuickBooks sync failed";

/** Enqueue is idempotent by V2 entity identity and intentionally carries no financial payload. */
export const enqueueV2QuickBooksSync = async (client: PoolClient, organizationId: string, subjectKind: QuickBooksSyncSubject, subjectId: string): Promise<void> => {
  await client.query(
    `INSERT INTO v2_quickbooks_sync_jobs(organization_id,subject_kind,subject_id,state,available_at)
     VALUES($1,$2,$3,'queued',now())
     ON CONFLICT(organization_id,subject_kind,subject_id) DO UPDATE
       SET state=CASE WHEN v2_quickbooks_sync_jobs.state IN ('succeeded','uncertain','blocked') THEN v2_quickbooks_sync_jobs.state ELSE 'queued' END,
           available_at=CASE WHEN v2_quickbooks_sync_jobs.state IN ('succeeded','uncertain','blocked') THEN v2_quickbooks_sync_jobs.available_at ELSE LEAST(v2_quickbooks_sync_jobs.available_at,now()) END,
           updated_at=now()`,
    [organizationId, subjectKind, subjectId],
  );
};

export class PostgresQuickBooksSyncNow {
  constructor(private readonly pool: Pool) {}
  async enqueueInvoice(organizationId: string, invoiceId: string): Promise<void> {
    await this.enqueueInvoices(organizationId, [invoiceId]);
  }
  /** Explicit operator selection uses the same durable queue as Sync Now. */
  async enqueueInvoices(organizationId: string, invoiceIds: readonly string[]): Promise<string[]> {
    const unique = [...new Set(invoiceIds.map((value) => String(value).trim()).filter(Boolean))];
    if (!unique.length || unique.length > 100) throw new Error("Select between 1 and 100 issued V2 Invoices.");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // V2 Billing IDs are durable varchar identities (even when their current
      // generated values happen to look like UUIDs).  Keep the queue boundary
      // typed to the canonical schema rather than coercing them to uuid[].
      const invoice = await client.query<{ id: string }>("SELECT id FROM v2_billing_invoices WHERE organization_id=$1 AND id = ANY($2::varchar[]) AND invoice_state='issued'", [organizationId, unique]);
      if (invoice.rows.length !== unique.length) throw new Error("Only issued V2 Invoices may be synchronized to QuickBooks.");
      for (const item of unique) await enqueueV2QuickBooksSync(client, organizationId, "invoice", item);
      await client.query("COMMIT");
      return unique;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  /** An explicit operator recovery keeps one logical Payment job and never replays uncertainty blindly. */
  async retryPayment(organizationId: string, invoiceId: string, paymentId: string): Promise<{ state: "queued"; attemptCount: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const payment = await client.query<{ id: string }>("SELECT p.id FROM v2_billing_payments p JOIN v2_billing_invoices i ON i.organization_id=p.organization_id AND i.id=p.invoice_id WHERE p.organization_id=$1 AND p.id=$2 AND p.invoice_id=$3 AND i.invoice_state='issued'", [organizationId, paymentId, invoiceId]);
      if (!payment.rows[0]) throw new Error("The V2 Payment is unavailable for QuickBooks recovery.");
      const recovered = await client.query<{ attempt_count: number }>("UPDATE v2_quickbooks_sync_jobs SET state='queued',available_at=now(),lease_expires_at=NULL,claimed_by=NULL,updated_at=now() WHERE organization_id=$1 AND subject_kind='payment' AND subject_id=$2 AND state IN ('blocked','retry') RETURNING attempt_count", [organizationId, paymentId]);
      if (recovered.rows[0]) { await client.query("COMMIT"); return { state: "queued", attemptCount: recovered.rows[0].attempt_count }; }
      const job = await client.query<{ state: JobState }>("SELECT state FROM v2_quickbooks_sync_jobs WHERE organization_id=$1 AND subject_kind='payment' AND subject_id=$2 FOR UPDATE", [organizationId, paymentId]);
      const state = job.rows[0]?.state;
      if (state === "succeeded") throw new Error("This QuickBooks Payment is already synchronized.");
      if (state === "uncertain") throw new Error("This QuickBooks Payment requires provider reconciliation before it can be retried.");
      if (state === "processing") throw new Error("This QuickBooks Payment is currently being processed.");
      throw new Error("This QuickBooks Payment is not eligible for recovery.");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  /** Accounting Settings is the sole operator console. It reads only V2 facts
   * plus durable integration metadata; no legacy financial table is consulted. */
  async operations(organizationId: string): Promise<QuickBooksOperationsRead> {
    const [eligible, activity] = await Promise.all([
      this.pool.query<{ id:string; invoice_display_number:string; customer_name:string; total_cents:string; currency:string }>(
        `SELECT i.id,i.invoice_display_number,COALESCE(c.display_name,c.company_name,'Customer unavailable') customer_name,i.total_cents::text,i.currency
           FROM v2_billing_invoices i LEFT JOIN customers c ON c.organization_id=i.organization_id AND c.id=i.customer_id
          WHERE i.organization_id=$1 AND i.invoice_state='issued'
            AND NOT EXISTS (SELECT 1 FROM v2_quickbooks_sync_links l WHERE l.organization_id=i.organization_id AND l.entity_kind='invoice' AND l.entity_id=i.id)
          ORDER BY i.issued_at DESC NULLS LAST LIMIT 100`, [organizationId]),
      this.pool.query<{ id:string; subject_kind:QuickBooksSyncSubject; subject_id:string; state:JobState; attempt_count:number; last_error:string|null; updated_at:Date; completed_at:Date|null; display_number:string|null; amount_cents:string|null; currency:string|null; provider_id:string|null }>(
        `SELECT j.id,j.subject_kind,j.subject_id,j.state,j.attempt_count,j.last_error,j.updated_at,j.completed_at,
                COALESCE(i.invoice_display_number,'Invoice') display_number,
                CASE WHEN j.subject_kind='payment' THEN p.amount_cents WHEN j.subject_kind='refund' THEN r.amount_cents ELSE i.total_cents END::text amount_cents,
                COALESCE(p.currency,r.currency,i.currency) currency,
                l.provider_id
           FROM v2_quickbooks_sync_jobs j
           LEFT JOIN v2_billing_payments p ON p.organization_id=j.organization_id AND j.subject_kind='payment' AND p.id=j.subject_id
           LEFT JOIN v2_billing_refunds r ON r.organization_id=j.organization_id AND j.subject_kind='refund' AND r.id=j.subject_id
           LEFT JOIN v2_billing_invoices i ON i.organization_id=j.organization_id AND ((j.subject_kind='invoice' AND i.id=j.subject_id) OR (j.subject_kind='payment' AND i.id=p.invoice_id) OR (j.subject_kind='refund' AND i.id=r.invoice_id))
           LEFT JOIN v2_quickbooks_sync_links l ON l.organization_id=j.organization_id AND l.entity_id=j.subject_id AND ((j.subject_kind IN ('invoice','payment') AND l.entity_kind=j.subject_kind) OR (j.subject_kind='refund' AND l.entity_kind='refund_disbursement'))
          WHERE j.organization_id=$1 ORDER BY CASE WHEN j.state IN ('blocked','uncertain') THEN 0 ELSE 1 END,j.updated_at DESC LIMIT 100`, [organizationId]),
    ]);
    return {
      eligibleInvoices: eligible.rows.map((row) => ({ invoiceId:row.id, displayNumber:row.invoice_display_number, customerName:row.customer_name, totalCents:Number(row.total_cents), currency:row.currency })),
      activity: activity.rows.map((row) => ({ jobId:row.id, subjectKind:row.subject_kind, subjectId:row.subject_id, displayNumber:row.display_number ?? "Invoice", amountCents:row.amount_cents === null ? null : Number(row.amount_cents), currency:row.currency, state:row.state, attemptCount:row.attempt_count, lastError:row.last_error, updatedAt:row.updated_at.toISOString(), completedAt:row.completed_at?.toISOString() ?? null, providerId:row.provider_id, retryEligible:row.state === "blocked" || row.state === "retry" })),
    };
  }
  /** Recovery deliberately preserves the one existing queue identity. */
  async retry(organizationId: string, subjectKind: QuickBooksSyncSubject, subjectId: string): Promise<{ state: "queued"; attemptCount: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const valid = await client.query<{ id:string }>(subjectKind === "invoice"
        ? "SELECT id FROM v2_billing_invoices WHERE organization_id=$1 AND id=$2 AND invoice_state='issued'"
        : subjectKind === "payment"
          ? "SELECT p.id FROM v2_billing_payments p JOIN v2_billing_invoices i ON i.organization_id=p.organization_id AND i.id=p.invoice_id WHERE p.organization_id=$1 AND p.id=$2 AND i.invoice_state='issued'"
          : "SELECT r.id FROM v2_billing_refunds r JOIN v2_billing_invoices i ON i.organization_id=r.organization_id AND i.id=r.invoice_id WHERE r.organization_id=$1 AND r.id=$2 AND i.invoice_state='issued'", [organizationId, subjectId]);
      if (!valid.rows[0]) throw new Error(`The V2 ${subjectKind} is unavailable for QuickBooks recovery.`);
      const recovered = await client.query<{ attempt_count:number }>("UPDATE v2_quickbooks_sync_jobs SET state='queued',available_at=now(),lease_expires_at=NULL,claimed_by=NULL,updated_at=now() WHERE organization_id=$1 AND subject_kind=$2 AND subject_id=$3 AND state IN ('blocked','retry') RETURNING attempt_count", [organizationId,subjectKind,subjectId]);
      if (recovered.rows[0]) { await client.query("COMMIT"); return { state:"queued",attemptCount:recovered.rows[0].attempt_count }; }
      const job = await client.query<{ state:JobState }>("SELECT state FROM v2_quickbooks_sync_jobs WHERE organization_id=$1 AND subject_kind=$2 AND subject_id=$3 FOR UPDATE", [organizationId,subjectKind,subjectId]);
      const state=job.rows[0]?.state;
      if (state === "succeeded") throw new Error(`This QuickBooks ${subjectKind} is already synchronized.`);
      if (state === "uncertain") throw new Error(`This QuickBooks ${subjectKind} requires provider reconciliation before it can be retried.`);
      if (state === "processing") throw new Error(`This QuickBooks ${subjectKind} is currently being processed.`);
      throw new Error(`This QuickBooks ${subjectKind} is not eligible for recovery.`);
    } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async importPreview(organizationId:string, scope:QBInvoicePreviewScope, page:number, pageSize:number) { return fetchQBInvoicePreviewPage({organizationId,scope,page,pageSize}); }
  async customerImportPreview(organizationId:string) { return fetchQBCustomersForPreview(organizationId); }
  async importInvoices(organizationId:string, userId:string, invoices:readonly Readonly<{qbId:string;classification:"open_ar"|"historical"|"skip"}>[]) {
    const selected=[...new Map(invoices.map(row=>[row.qbId.trim(),row])).values()].filter(row=>row.qbId);
    if (!selected.length || selected.length>100) throw new Error("Select between 1 and 100 QuickBooks invoices to import.");
    const ids=selected.filter(row=>row.classification!=="skip").map(row=>row.qbId);
    if (!ids.length) return {created:0,updated:0,skipped:selected.length,excluded:0,failed:0,importedOpenAr:0,importedHistorical:0,numberingConflicts:0,errors:[]};
    return importQBInvoicesByIds(organizationId,ids,"auto",userId,Object.fromEntries(selected.map(row=>[row.qbId,row.classification])));
  }
}

export class V2QuickBooksBillingWorker {
  constructor(private readonly pool: Pool, private readonly workerId = `v2-qb:${process.env.RAILWAY_REPLICA_ID || hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`) {}

  async run(limit = 8): Promise<QuickBooksQueueRunResult> {
    const result = { claimed: 0, succeeded: 0, retry: 0, uncertain: 0, blocked: 0 };
    for (let index = 0; index < Math.max(0, limit); index += 1) {
      const job = await this.claim();
      if (!job) break;
      result.claimed += 1;
      try {
        await this.process(job);
        await this.finish(job, "succeeded");
        result.succeeded += 1;
      } catch (error) {
        const state: JobState = quickBooksQueueFailureState(error);
        if (state === "uncertain") result.uncertain += 1; else if (state === "blocked") result.blocked += 1; else result.retry += 1;
        if (job.subjectKind === "refund") await this.workflow(job.organizationId, job.subjectId, state, concise(error));
        await this.finish(job, state, concise(error));
      }
    }
    return result;
  }

  private async claim(): Promise<Job | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const claimed = await client.query<{ id:string; organization_id:string; subject_kind:QuickBooksSyncSubject; subject_id:string; attempt_count:number }>(
        `WITH candidate AS (
           SELECT id FROM v2_quickbooks_sync_jobs
           WHERE (state IN ('queued','retry') AND available_at <= now())
              OR (state='uncertain' AND subject_kind='refund' AND available_at <= now())
              OR (state='processing' AND lease_expires_at < now())
           ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1
         )
         UPDATE v2_quickbooks_sync_jobs j
         SET state='processing', claimed_by=$1, lease_expires_at=now()+interval '5 minutes',
             attempt_count=j.attempt_count+1, updated_at=now()
         FROM candidate WHERE j.id=candidate.id
         RETURNING j.id,j.organization_id,j.subject_kind,j.subject_id,j.attempt_count`,
        [this.workerId],
      );
      await client.query("COMMIT");
      const row = claimed.rows[0];
      return row ? { id: row.id, organizationId: row.organization_id, subjectKind: row.subject_kind, subjectId: row.subject_id, attemptCount: row.attempt_count } : null;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  private async process(job: Job): Promise<void> {
    if (job.subjectKind === "invoice") return this.processInvoice(job);
    if (job.subjectKind === "payment") return this.processPayment(job);
    return this.processRefund(job);
  }

  private async processInvoice(job: Job): Promise<void> {
    const client = await this.pool.connect();
    try {
      const invoice = await client.query<{ customer_id:string|null; invoice_display_number:string; currency:string; issued_at:Date; checkpoint_json:unknown }>(
        `SELECT i.customer_id,i.invoice_display_number,i.currency,i.issued_at,c.checkpoint_json
         FROM v2_billing_invoices i JOIN v2_billing_invoice_checkpoints c ON c.organization_id=i.organization_id AND c.invoice_id=i.id
         WHERE i.organization_id=$1 AND i.id=$2 AND i.invoice_state='issued'`, [job.organizationId, job.subjectId]);
      const row = invoice.rows[0];
      if (!row?.customer_id || !row.invoice_display_number || !row.issued_at) throw new Error("V2 issued Invoice lacks required QuickBooks projection facts.");
      const customer = await client.query<{ id:string; display_name:string|null; company_name:string|null; email:string|null; phone:string|null; customer_type:string|null }>(
        "SELECT id,display_name,company_name,email,phone,customer_type FROM customers WHERE organization_id=$1 AND id=$2", [job.organizationId, row.customer_id]);
      const customerRow = customer.rows[0];
      if (!customerRow) throw new Error("V2 Invoice customer is unavailable for QuickBooks sync.");
      const lines = checkpointLines(row.checkpoint_json);
      if (!lines.length) throw new Error("V2 issued Invoice checkpoint has no billable lines.");
      const customerProjection: V2QuickBooksCustomer = { id: customerRow.id, displayName: customerRow.display_name || customerRow.company_name || "", companyName: customerRow.company_name || undefined, email: customerRow.email || undefined, phone: customerRow.phone || undefined, kind: customerRow.customer_type === "individual" ? "individual" : "business" };
      const existingInvoice = await this.link(job.organizationId, "invoice", job.subjectId);
      const existingCustomer = await this.link(job.organizationId, "customer", customerRow.id);
      const provider = await syncV2InvoiceToQuickBooks({ organizationId: job.organizationId, invoiceId: job.subjectId, displayNumber: row.invoice_display_number, currency: row.currency, issuedAt: row.issued_at.toISOString(), customer: customerProjection, customerQuickBooksId: existingCustomer ?? undefined, quickBooksInvoiceId: existingInvoice ?? undefined, lines });
      await this.upsertLink(job.organizationId, "customer", customerRow.id, provider.qbCustomerId);
      await this.upsertLink(job.organizationId, "invoice", job.subjectId, provider.qbInvoiceId);
    } finally { client.release(); }
  }

  private async processPayment(job: Job): Promise<void> {
    const client = await this.pool.connect();
    try {
      const payment = await client.query<{ invoice_id:string; amount_cents:string; currency:string; occurred_at:Date; customer_id:string|null }>(
        `SELECT p.invoice_id,p.amount_cents,p.currency,p.occurred_at,i.customer_id
         FROM v2_billing_payments p JOIN v2_billing_invoices i ON i.organization_id=p.organization_id AND i.id=p.invoice_id
         WHERE p.organization_id=$1 AND p.id=$2 AND i.invoice_state='issued'`, [job.organizationId, job.subjectId]);
      const row = payment.rows[0];
      if (!row?.customer_id) throw new Error("V2 Payment lacks an issued Invoice customer for QuickBooks sync.");
      const invoiceQuickBooksId = await this.link(job.organizationId, "invoice", row.invoice_id);
      if (!invoiceQuickBooksId) throw new Error("V2 Payment waits for its Invoice QuickBooks projection.");
      const customerQuickBooksId = await this.link(job.organizationId, "customer", row.customer_id);
      if (!customerQuickBooksId) throw new Error("V2 Payment waits for its Customer QuickBooks projection.");
      const existingPayment = await this.link(job.organizationId, "payment", job.subjectId);
      const provider = await syncV2PaymentToQuickBooks({ organizationId: job.organizationId, paymentId: job.subjectId, quickBooksPaymentId: existingPayment ?? undefined, quickBooksInvoiceId: invoiceQuickBooksId, quickBooksCustomerId: customerQuickBooksId, amountCents: Number(row.amount_cents), currency: row.currency, occurredAt: row.occurred_at.toISOString() });
      await this.upsertLink(job.organizationId, "payment", job.subjectId, provider.qbPaymentId);
    } finally { client.release(); }
  }

  /**
   * The V2 Refund is immutable Billing evidence.  QuickBooks receives a
   * separate, resumable accounting representation: CreditMemo -> Check/A-R
   * disbursement.  Links are written after every remote success so a retry
   * never needs to guess whether a prior provider mutation completed.
   */
  private async processRefund(job: Job): Promise<void> {
    const client = await this.pool.connect();
    try {
      const refund = await client.query<{ invoice_id:string; payment_id:string; amount_cents:string; currency:string; occurred_at:Date; customer_id:string|null; invoice_display_number:string; checkpoint_json:unknown }>(
        `SELECT r.invoice_id,a.payment_id,r.amount_cents,r.currency,r.occurred_at,i.customer_id,i.invoice_display_number,c.checkpoint_json
           FROM v2_billing_refunds r
           JOIN v2_billing_refund_allocations a ON a.organization_id=r.organization_id AND a.refund_id=r.id
           JOIN v2_billing_invoices i ON i.organization_id=r.organization_id AND i.id=r.invoice_id
           JOIN v2_billing_invoice_checkpoints c ON c.organization_id=i.organization_id AND c.invoice_id=i.id
          WHERE r.organization_id=$1 AND r.id=$2 AND i.invoice_state='issued'`, [job.organizationId, job.subjectId]);
      const row = refund.rows[0];
      if (!row?.customer_id || !row.payment_id) throw new Error("V2 Refund lacks its issued Invoice or original Payment projection facts.");
      const customerQuickBooksId = await this.link(job.organizationId, "customer", row.customer_id);
      const invoiceQuickBooksId = await this.link(job.organizationId, "invoice", row.invoice_id);
      const paymentQuickBooksId = await this.link(job.organizationId, "payment", row.payment_id);
      if (!customerQuickBooksId || !invoiceQuickBooksId || !paymentQuickBooksId) throw new Error("V2 Refund waits for its Customer, Invoice, and original Payment QuickBooks projections.");
      const lines = checkpointLines(row.checkpoint_json);
      if (!lines.length) throw new Error("V2 Refund cannot project an issued Invoice with no immutable billable lines.");
      await this.startRefundWorkflow(job.organizationId, job.subjectId);
      const existingCreditMemo = await this.link(job.organizationId, "refund_credit_memo", job.subjectId);
      const credit = await syncV2RefundCreditMemoToQuickBooks({
        organizationId: job.organizationId, refundId: job.subjectId, quickBooksCreditMemoId: existingCreditMemo ?? undefined,
        quickBooksInvoiceId: invoiceQuickBooksId, quickBooksCustomerId: customerQuickBooksId, amountCents: Number(row.amount_cents), currency: row.currency,
        occurredAt: row.occurred_at.toISOString(), invoiceDisplayNumber: row.invoice_display_number, originalInvoiceLines: lines,
      });
      await this.upsertLink(job.organizationId, "refund_credit_memo", job.subjectId, credit.qbCreditMemoId);
      await this.workflow(job.organizationId, job.subjectId, "credit_created");
      const existingDisbursement = await this.link(job.organizationId, "refund_disbursement", job.subjectId);
      const disbursement = await syncV2RefundDisbursementToQuickBooks({
        organizationId: job.organizationId, refundId: job.subjectId, quickBooksDisbursementId: existingDisbursement ?? undefined,
        quickBooksCreditMemoId: credit.qbCreditMemoId, quickBooksInvoiceId: invoiceQuickBooksId, quickBooksPaymentId: paymentQuickBooksId,
        quickBooksCustomerId: customerQuickBooksId, amountCents: Number(row.amount_cents), currency: row.currency, occurredAt: row.occurred_at.toISOString(),
      });
      await this.upsertLink(job.organizationId, "refund_disbursement", job.subjectId, disbursement.qbDisbursementId);
      await this.workflow(job.organizationId, job.subjectId, "linked");
      await this.workflow(job.organizationId, job.subjectId, "succeeded");
    } finally { client.release(); }
  }

  private async link(organizationId: string, kind: QuickBooksLinkKind, entityId: string): Promise<string | null> { const result = await this.pool.query<{provider_id:string}>("SELECT provider_id FROM v2_quickbooks_sync_links WHERE organization_id=$1 AND entity_kind=$2 AND entity_id=$3", [organizationId, kind, entityId]); return result.rows[0]?.provider_id ?? null; }
  private async upsertLink(organizationId: string, kind: QuickBooksLinkKind, entityId: string, providerId: string): Promise<void> { await this.pool.query("INSERT INTO v2_quickbooks_sync_links(organization_id,entity_kind,entity_id,provider_id) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,entity_kind,entity_id) DO UPDATE SET provider_id=EXCLUDED.provider_id,updated_at=now()", [organizationId, kind, entityId, providerId]); }
  private async startRefundWorkflow(organizationId: string, refundId: string): Promise<void> { await this.pool.query("INSERT INTO v2_quickbooks_refund_sync_workflows(organization_id,refund_id,state) VALUES($1,$2,'queued') ON CONFLICT(organization_id,refund_id) DO NOTHING", [organizationId, refundId]); }
  private async workflow(organizationId: string, refundId: string, state: "queued" | "credit_created" | "disbursement_created" | "linked" | "succeeded" | "uncertain" | "retry" | "blocked", error?: string): Promise<void> { await this.pool.query("INSERT INTO v2_quickbooks_refund_sync_workflows(organization_id,refund_id,state,last_error,completed_at) VALUES($1,$2,$3,$4,CASE WHEN $3='succeeded' THEN now() ELSE NULL END) ON CONFLICT(organization_id,refund_id) DO UPDATE SET state=EXCLUDED.state,last_error=EXCLUDED.last_error,completed_at=EXCLUDED.completed_at,updated_at=now()", [organizationId, refundId, state, error ?? null]); }
  private async finish(job: Job, state: JobState, error?: string): Promise<void> { const delay = state === "retry" || (state === "uncertain" && job.subjectKind === "refund") ? retryDelayMs(job.attemptCount) : 0; await this.pool.query("UPDATE v2_quickbooks_sync_jobs SET state=$2::varchar,last_error=$3,lease_expires_at=NULL,claimed_by=NULL,available_at=CASE WHEN $2::varchar='retry' OR ($2::varchar='uncertain' AND subject_kind='refund') THEN now()+($4::text||' milliseconds')::interval ELSE available_at END,completed_at=CASE WHEN $2::varchar='succeeded' THEN now() ELSE NULL END,updated_at=now() WHERE id=$1 AND state='processing' AND claimed_by=$5", [job.id,state,error ?? null,delay,this.workerId]); }
}

const checkpointLines = (checkpoint: unknown): Array<{ description: string; quantity: number; unitAmountCents: number; lineAmountCents: number }> => {
  const lines = checkpoint && typeof checkpoint === "object" && Array.isArray((checkpoint as { lines?: unknown }).lines) ? (checkpoint as { lines: unknown[] }).lines : [];
  return lines.map((line) => { const value = line as { description?:unknown; quantity?:unknown; unitAmount?:{cents?:unknown}; lineAmount?:{cents?:unknown} }; return { description: String(value.description ?? ""), quantity: Number(value.quantity ?? 0), unitAmountCents: Number(value.unitAmount?.cents ?? 0), lineAmountCents: Number(value.lineAmount?.cents ?? 0) }; }).filter((line) => line.description.trim().length > 0 && Number.isSafeInteger(line.quantity) && line.quantity > 0 && Number.isSafeInteger(line.lineAmountCents));
};

export const startV2QuickBooksBillingWorker = (pool: Pool, log: (event: string, data?: Record<string, unknown>) => void): (() => void) | null => {
  if (!v2QuickBooksQueueWorkerEnabled()) { log("v2.quickbooks.worker.disabled", { reason: "owner_not_queue" }); return null; }
  const worker = new V2QuickBooksBillingWorker(pool);
  let running = false;
  const tick = async () => { if (running) return; running = true; try { const outcome = await worker.run(); if (outcome.claimed) log("v2.quickbooks.worker.run", outcome); } catch (error) { log("v2.quickbooks.worker.error", { message: concise(error) }); } finally { running = false; } };
  const timer = setInterval(() => void tick(), 15_000);
  timer.unref();
  void tick();
  log("v2.quickbooks.worker.started", { owner: "queue", worker: "v2_billing_queue" });
  return () => clearInterval(timer);
};
