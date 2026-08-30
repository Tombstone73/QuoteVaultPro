import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { Pool, PoolClient } from "pg";
import {
  syncV2InvoiceToQuickBooks,
  syncV2PaymentToQuickBooks,
  type V2QuickBooksCustomer,
} from "../../../server/quickbooksService.js";
import { quickBooksQueueFailureState, v2QuickBooksQueueWorkerEnabled } from "./quickBooksQueuePolicy.js";
export { quickBooksQueueFailureState, v2QuickBooksQueueWorkerEnabled } from "./quickBooksQueuePolicy.js";

export type QuickBooksSyncSubject = "invoice" | "payment";
type JobState = "queued" | "processing" | "retry" | "succeeded" | "uncertain" | "blocked";
type Job = Readonly<{ id: string; organizationId: string; subjectKind: QuickBooksSyncSubject; subjectId: string; attemptCount: number }>;
export type QuickBooksQueueRunResult = Readonly<{ claimed: number; succeeded: number; retry: number; uncertain: number; blocked: number }>;

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
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const invoice = await client.query<{ id: string }>("SELECT id FROM v2_billing_invoices WHERE organization_id=$1 AND id=$2 AND invoice_state='issued'", [organizationId, invoiceId]);
      if (!invoice.rows[0]) throw new Error("Only issued V2 Invoices may be synchronized to QuickBooks.");
      await enqueueV2QuickBooksSync(client, organizationId, "invoice", invoiceId);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
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
    return this.processPayment(job);
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

  private async link(organizationId: string, kind: "customer" | "invoice" | "payment", entityId: string): Promise<string | null> { const result = await this.pool.query<{provider_id:string}>("SELECT provider_id FROM v2_quickbooks_sync_links WHERE organization_id=$1 AND entity_kind=$2 AND entity_id=$3", [organizationId, kind, entityId]); return result.rows[0]?.provider_id ?? null; }
  private async upsertLink(organizationId: string, kind: "customer" | "invoice" | "payment", entityId: string, providerId: string): Promise<void> { await this.pool.query("INSERT INTO v2_quickbooks_sync_links(organization_id,entity_kind,entity_id,provider_id) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,entity_kind,entity_id) DO UPDATE SET provider_id=EXCLUDED.provider_id,updated_at=now()", [organizationId, kind, entityId, providerId]); }
  private async finish(job: Job, state: JobState, error?: string): Promise<void> { const delay = state === "retry" ? retryDelayMs(job.attemptCount) : 0; await this.pool.query("UPDATE v2_quickbooks_sync_jobs SET state=$2,last_error=$3,lease_expires_at=NULL,claimed_by=NULL,available_at=CASE WHEN $2='retry' THEN now()+($4::text||' milliseconds')::interval ELSE available_at END,completed_at=CASE WHEN $2='succeeded' THEN now() ELSE NULL END,updated_at=now() WHERE id=$1 AND state='processing' AND claimed_by=$5", [job.id,state,error ?? null,delay,this.workerId]); }
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
