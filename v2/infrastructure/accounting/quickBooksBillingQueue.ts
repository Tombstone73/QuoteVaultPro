import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { Pool, PoolClient } from "pg";
import {
  syncV2RefundCreditMemoToQuickBooks,
  syncV2RefundDisbursementToQuickBooks,
  fetchQBCustomersForPreview,
  fetchQBInvoicePreviewPage,
  importQBInvoicesByIds,
  type QBInvoicePreviewScope,
} from "../../../server/quickbooksService.js";
import { quickBooksQueueFailureState, v2QuickBooksQueueWorkerEnabled } from "./quickBooksQueuePolicy.js";
import {
  quickBooksInvoiceProjectionFingerprint,
  quickBooksProjectionLines as projectionLines,
  storedQuickBooksProjectionLines as storedProjectionLines,
  type QuickBooksInvoiceProjection as InvoiceProjection,
} from "./quickBooksLiveInvoiceProjection.js";
import { quickBooksPaymentReference } from "./quickBooksPaymentReference.js";
import { PostgresQuickBooksPaymentReadTransport, type QuickBooksPaymentReadPort } from "./quickBooksPaymentReadTransport.js";
import { quickBooksPaymentReconciliationRequired, type QuickBooksPaymentRecoveryContext } from "./quickBooksPaymentRecovery.js";
import { exportOrRecoverQuickBooksPayment } from "./quickBooksPaymentExport.js";
import { publicationIntent, invoicePublicationIntent, assertInvoicePublicationAmounts, assertPublicationLink, publicationEquals, type PublicationIntent, type ConfirmedPublication, type PublicationLink } from "./quickBooksProviderPublication.js";
export { quickBooksQueueFailureState, v2QuickBooksQueueWorkerEnabled } from "./quickBooksQueuePolicy.js";

export type QuickBooksSyncSubject = "invoice" | "payment" | "refund";
type QuickBooksLinkKind = "customer" | "invoice" | "payment" | "refund_credit_memo" | "refund_disbursement";
type JobState = "queued" | "processing" | "retry" | "succeeded" | "uncertain" | "blocked";
type QuickBooksQueueClient = Pick<PoolClient, "query">;
type Job = Readonly<{ id: string; organizationId: string; subjectKind: QuickBooksSyncSubject; subjectId: string; attemptCount: number; recoveryState?: "uncertain" | "blocked"; recoveryGeneration?: string;publicationVersion?:string }>;
export type QuickBooksQueueRunResult = Readonly<{ claimed: number; succeeded: number; retry: number; uncertain: number; blocked: number }>;
export type QuickBooksOperationsRead = Readonly<{
  eligibleInvoiceCount: number;
  awaitingApprovalInvoiceCount: number;
  queueSummary: Readonly<{ queued: number; processing: number; succeeded: number; actionRequired: number }>;
}>;
export type QuickBooksEligibleInvoice = Readonly<{ invoiceId: string; displayNumber: string; customerName: string; totalCents: number; currency: string; issuedAt: string | null; syncStatus: "never_synced" | "out_of_sync"; accountingApproval: "approved" | "required" }>;
export type QuickBooksEligibleFinancialFact = Readonly<{ subjectKind: "payment" | "refund"; subjectId: string; displayNumber: string; customerName: string; amountCents: number; currency: string; occurredAt: string }>;
export type QuickBooksQueueActivity = Readonly<{ jobId: string; subjectKind: QuickBooksSyncSubject; subjectId: string; displayNumber: string; customerName: string; amountCents: number | null; currency: string | null; state: JobState; attemptCount: number; lastError: string | null; updatedAt: string; completedAt: string | null; providerId: string | null; retryEligible: boolean; recoveryEligible: boolean }>;
export type QuickBooksQueuePage = Readonly<{ items: readonly QuickBooksQueueActivity[]; total: number; page: number; pageSize: number; hasNextPage: boolean }>;

const retryDelayMs = (attempt: number) => Math.min(30 * 60_000, 15_000 * 2 ** Math.min(Math.max(0, attempt - 1), 7));
const concise = (cause: unknown) => String((cause as { message?: unknown })?.message ?? cause ?? "QuickBooks sync failed").replace(/\s+/g, " ").replace(/\0/g, "").trim().slice(0, 500) || "QuickBooks sync failed";
type InvoiceLink = Readonly<{ providerId: string; projectionFingerprint: string | null; projectionVersion: string | null; projectionJson: unknown }>;
/** A token lookup fails before makeQBRequest can send a provider mutation. */
export const quickBooksCredentialInterruptedRecoveryEligible = (state: JobState, lastError: string | null): boolean => state === "uncertain" && /failed to get valid access token/i.test(lastError ?? "");

/** Enqueue is idempotent by V2 entity identity and intentionally carries no financial payload. */
export const enqueueV2QuickBooksSync = async (client: QuickBooksQueueClient, organizationId: string, subjectKind: QuickBooksSyncSubject, subjectId: string): Promise<void> => {
  await client.query(
    `INSERT INTO v2_quickbooks_sync_jobs(organization_id,subject_kind,subject_id,state,available_at)
     VALUES($1,$2,$3,'queued',now())
     ON CONFLICT(organization_id,subject_kind,subject_id) DO UPDATE
       SET state=CASE
             WHEN v2_quickbooks_sync_jobs.state IN ('uncertain','blocked') THEN v2_quickbooks_sync_jobs.state
             WHEN v2_quickbooks_sync_jobs.state='processing' THEN 'processing'
             ELSE 'queued'
            END,
           available_at=CASE
             WHEN v2_quickbooks_sync_jobs.state IN ('uncertain','blocked','processing') THEN v2_quickbooks_sync_jobs.available_at
             ELSE LEAST(v2_quickbooks_sync_jobs.available_at,now())
           END,
           updated_at=now()`,
    [organizationId, subjectKind, subjectId],
  );
};
/** Auto Sync governs only creation of new queue work.  It never stops the
 * worker, replays a historical backlog, or changes the manual queue path. */
export const enqueueV2QuickBooksAutoSync = async (client: QuickBooksQueueClient, organizationId: string, subjectKind: QuickBooksSyncSubject, subjectId: string): Promise<void> => {
  const policy = await client.query<{ enabled:boolean }>("SELECT COALESCE(settings #>> '{preferences,quickBooks,autoSync}','false')='true' enabled FROM organizations WHERE id=$1", [organizationId]);
  if (!policy.rows[0]?.enabled) return;
  // Payments and Refunds retain their canonical dependency ordering.  Invoice
  // export additionally requires explicit approval of the current live
  // projection so Auto Sync cannot bypass the accounting review gate.
  if (subjectKind === "invoice") {
    const approved = await client.query<{ id:string }>(`SELECT i.id FROM v2_billing_invoices i JOIN v2_quickbooks_invoice_approvals a ON a.organization_id=i.organization_id AND a.invoice_id=i.id AND a.synchronization_version=i.synchronization_version WHERE i.organization_id=$1 AND i.id=$2 AND i.invoice_state <> 'void'`, [organizationId, subjectId]);
    if (!approved.rows[0]) return;
  }
  await enqueueV2QuickBooksSync(client, organizationId, subjectKind, subjectId);
};

export class PostgresQuickBooksSyncNow {
  constructor(private readonly pool: Pool, private readonly paymentReader: QuickBooksPaymentReadPort = new PostgresQuickBooksPaymentReadTransport(pool)) {}
  async policy(organizationId:string):Promise<{autoSync:boolean}> { const result=await this.pool.query<{ enabled:boolean }>("SELECT COALESCE(settings #>> '{preferences,quickBooks,autoSync}','false')='true' enabled FROM organizations WHERE id=$1",[organizationId]); return {autoSync:result.rows[0]?.enabled===true}; }
  async setPolicy(organizationId:string,autoSync:boolean):Promise<{autoSync:boolean}> { const result=await this.pool.query<{ enabled:boolean }>("UPDATE organizations SET settings=jsonb_set(COALESCE(settings,'{}'::jsonb),'{preferences,quickBooks,autoSync}',to_jsonb($2::boolean),true),updated_at=now() WHERE id=$1 RETURNING COALESCE(settings #>> '{preferences,quickBooks,autoSync}','false')='true' enabled",[organizationId,autoSync]); if(!result.rows[0])throw new Error("Organization is unavailable for QuickBooks configuration."); return {autoSync:result.rows[0].enabled}; }
  /** Explicit operator selection uses the same durable queue as Sync Now. */
  async enqueueInvoices(organizationId: string, invoiceIds: readonly string[]): Promise<string[]> {
    const unique = [...new Set(invoiceIds.map((value) => String(value).trim()).filter(Boolean))];
    if (!unique.length || unique.length > 100) throw new Error("Select between 1 and 100 eligible V2 Order-backed Invoices.");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // V2 Billing IDs are durable varchar identities (even when their current
      // generated values happen to look like UUIDs).  Keep the queue boundary
      // typed to the canonical schema rather than coercing them to uuid[].
      const invoice = await client.query<{ id: string }>(`SELECT i.id FROM v2_billing_invoices i JOIN v2_quickbooks_invoice_approvals a ON a.organization_id=i.organization_id AND a.invoice_id=i.id AND a.synchronization_version=i.synchronization_version WHERE i.organization_id=$1 AND i.id = ANY($2::varchar[]) AND i.invoice_state <> 'void'`, [organizationId, unique]);
      if (invoice.rows.length !== unique.length) throw new Error("Approve the current V2 Invoice version for accounting before forcing QuickBooks sync.");
      for (const item of unique) await enqueueV2QuickBooksSync(client, organizationId, "invoice", item);
      await client.query("COMMIT");
      return unique;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  /** Approval belongs to the tenant QuickBooks integration, never to Billing.
   * The immutable version key revokes eligibility automatically on revision. */
  async approveInvoice(organizationId:string, invoiceId:string, principal:Readonly<{kind:string;subject:string;staffActorUserId:string|null}>):Promise<{invoiceId:string;synchronizationVersion:string;alreadyApproved:boolean}> {
    const client=await this.pool.connect();
    try {
      await client.query("BEGIN");
      const invoice=await client.query<{synchronization_version:string}>("SELECT synchronization_version::text synchronization_version FROM v2_billing_invoices WHERE organization_id=$1 AND id=$2 AND invoice_state <> 'void' FOR SHARE",[organizationId,invoiceId]);
      const version=invoice.rows[0]?.synchronization_version;
      if(!version) throw new Error("Only non-void V2 Order-backed Invoices can be approved for QuickBooks.");
      const inserted=await client.query<{id:string}>(`INSERT INTO v2_quickbooks_invoice_approvals(organization_id,invoice_id,synchronization_version,principal_kind,principal_subject,staff_actor_user_id) VALUES($1,$2,$3::bigint,$4,$5,$6) ON CONFLICT(organization_id,invoice_id,synchronization_version) DO NOTHING RETURNING id`,[organizationId,invoiceId,version,principal.kind,principal.subject,principal.staffActorUserId]);
      if(inserted.rows[0]) await client.query("INSERT INTO v2_audit_events(organization_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,'quickbooks.invoice.approve.v1','quickbooks_invoice_approved','invoice',$2,$3,$4,$5,$6::jsonb)",[organizationId,invoiceId,principal.kind,principal.subject,principal.staffActorUserId,JSON.stringify([{synchronizationVersion:version}])]);
      await enqueueV2QuickBooksAutoSync(client,organizationId,"invoice",invoiceId);
      await client.query("COMMIT");
      return {invoiceId,synchronizationVersion:version,alreadyApproved:!inserted.rows[0]};
    } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  /** Manual payment/refund selection is deliberately bounded and only exposes
   * facts whose prerequisite Invoice/Payment projections already exist. */
  async enqueueFinancialFacts(organizationId: string, facts: readonly Readonly<{ subjectKind: "payment" | "refund"; subjectId: string }>[]): Promise<readonly Readonly<{ subjectKind: "payment" | "refund"; subjectId: string }>[]> {
    const unique = [...new Map(facts.map((fact) => [`${fact.subjectKind}:${String(fact.subjectId).trim()}`, { subjectKind: fact.subjectKind, subjectId: String(fact.subjectId).trim() }])).values()].filter((fact) => Boolean(fact.subjectId));
    if (!unique.length || unique.length > 100) throw new Error("Select between 1 and 100 eligible V2 Payments or Refunds.");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const fact of unique) {
        const valid = await client.query<{ id:string }>(fact.subjectKind === "payment"
          ? `SELECT p.id FROM v2_billing_payments p WHERE p.organization_id=$1 AND p.id=$2 AND EXISTS (SELECT 1 FROM v2_billing_payment_allocations a WHERE a.organization_id=p.organization_id AND a.payment_id=p.id) AND NOT EXISTS (SELECT 1 FROM v2_billing_payment_allocations a JOIN v2_billing_invoices i ON i.organization_id=a.organization_id AND i.id=a.invoice_id LEFT JOIN v2_quickbooks_sync_links l ON l.organization_id=i.organization_id AND l.entity_kind='invoice' AND l.entity_id=i.id AND l.projection_version=i.synchronization_version::varchar WHERE a.organization_id=p.organization_id AND a.payment_id=p.id AND (i.invoice_state='void' OR l.provider_id IS NULL))`
          : `SELECT r.id FROM v2_billing_refunds r WHERE r.organization_id=$1 AND r.id=$2 AND EXISTS (SELECT 1 FROM v2_billing_refund_allocations a JOIN v2_billing_refund_allocation_evidence e ON e.organization_id=a.organization_id AND e.refund_allocation_id=a.id JOIN v2_billing_invoices i ON i.organization_id=e.organization_id AND i.id=e.invoice_id JOIN v2_quickbooks_sync_links l ON l.organization_id=i.organization_id AND l.entity_kind='invoice' AND l.entity_id=i.id AND l.projection_version=i.synchronization_version::varchar JOIN v2_quickbooks_sync_links payment_link ON payment_link.organization_id=a.organization_id AND payment_link.entity_kind='payment' AND payment_link.entity_id=a.payment_id WHERE a.organization_id=r.organization_id AND a.refund_id=r.id AND i.invoice_state <> 'void')`, [organizationId, fact.subjectId]);
        if (!valid.rows[0]) throw new Error(`The V2 ${fact.subjectKind} is not eligible for manual QuickBooks sync.`);
        await enqueueV2QuickBooksSync(client, organizationId, fact.subjectKind, fact.subjectId);
      }
      await client.query("COMMIT");
      return unique;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  /** Accounting Settings is the sole operator console. It reads only V2 facts
   * plus durable integration metadata; no legacy financial table is consulted.
   * Link projection_version is deliberately varchar so historical projection
   * identities remain serialized text; compare Billing's bigint version as text. */
  async operations(organizationId: string): Promise<QuickBooksOperationsRead> {
    const [eligible, queue] = await Promise.all([
      this.pool.query<{ eligible_count:string; approval_count:string }>(`SELECT count(*) FILTER (WHERE a.id IS NOT NULL)::text eligible_count,count(*) FILTER (WHERE a.id IS NULL)::text approval_count FROM v2_billing_invoices i LEFT JOIN v2_quickbooks_sync_links l ON l.organization_id=i.organization_id AND l.entity_kind='invoice' AND l.entity_id=i.id LEFT JOIN v2_quickbooks_invoice_approvals a ON a.organization_id=i.organization_id AND a.invoice_id=i.id AND a.synchronization_version=i.synchronization_version WHERE i.organization_id=$1 AND i.invoice_state <> 'void' AND (l.provider_id IS NULL OR l.projection_version IS DISTINCT FROM i.synchronization_version::varchar)`, [organizationId]),
      this.pool.query<{ queued:string; processing:string; succeeded:string; action_required:string }>(`SELECT count(*) FILTER (WHERE state IN ('queued','retry'))::text queued,count(*) FILTER (WHERE state='processing')::text processing,count(*) FILTER (WHERE state='succeeded')::text succeeded,count(*) FILTER (WHERE state IN ('blocked','retry','uncertain'))::text action_required FROM v2_quickbooks_sync_jobs WHERE organization_id=$1`, [organizationId]),
    ]);
    const counts=queue.rows[0];
    return {
      eligibleInvoiceCount:Number(eligible.rows[0]?.eligible_count??0),
      awaitingApprovalInvoiceCount:Number(eligible.rows[0]?.approval_count??0),
      queueSummary:{queued:Number(counts?.queued??0),processing:Number(counts?.processing??0),succeeded:Number(counts?.succeeded??0),actionRequired:Number(counts?.action_required??0)},
    };
  }
  async unsyncedInvoices(organizationId:string,input:Readonly<{page:number;pageSize:number;search:string}>):Promise<{items:readonly QuickBooksEligibleInvoice[];total:number;page:number;pageSize:number;hasNextPage:boolean}> {
    const page=Math.max(1,Math.floor(input.page)),pageSize=Math.min(100,Math.max(10,Math.floor(input.pageSize))),search=input.search.trim(); const offset=(page-1)*pageSize;
    const [rows,count]=await Promise.all([
      this.pool.query<{ id:string; display_number:string; customer_name:string; total_cents:string; currency:string; posted_at:Date; provider_id:string|null; projection_version:string|null; synchronization_version:string; approval_id:string|null }>(`SELECT i.id,COALESCE(i.invoice_display_number,d.display_number) display_number,COALESCE(c.display_name,c.company_name,'Customer unavailable') customer_name,i.total_cents::text,i.currency,COALESCE(i.issued_at,i.created_at) posted_at,l.provider_id,l.projection_version,i.synchronization_version,a.id approval_id FROM v2_billing_invoices i JOIN v2_sales_documents d ON d.organization_id=i.organization_id AND d.id=i.sales_order_document_id LEFT JOIN customers c ON c.organization_id=i.organization_id AND c.id=i.customer_id LEFT JOIN v2_quickbooks_sync_links l ON l.organization_id=i.organization_id AND l.entity_kind='invoice' AND l.entity_id=i.id LEFT JOIN v2_quickbooks_invoice_approvals a ON a.organization_id=i.organization_id AND a.invoice_id=i.id AND a.synchronization_version=i.synchronization_version WHERE i.organization_id=$1 AND i.invoice_state <> 'void' AND (l.provider_id IS NULL OR l.projection_version IS DISTINCT FROM i.synchronization_version::varchar) AND ($2='' OR COALESCE(i.invoice_display_number,d.display_number) ILIKE '%'||$2||'%' OR COALESCE(c.display_name,c.company_name,'') ILIKE '%'||$2||'%') ORDER BY i.updated_at DESC,i.id DESC LIMIT $3 OFFSET $4`,[organizationId,search,pageSize,offset]),
      this.pool.query<{ count:string }>(`SELECT count(*)::text count FROM v2_billing_invoices i JOIN v2_sales_documents d ON d.organization_id=i.organization_id AND d.id=i.sales_order_document_id LEFT JOIN customers c ON c.organization_id=i.organization_id AND c.id=i.customer_id LEFT JOIN v2_quickbooks_sync_links l ON l.organization_id=i.organization_id AND l.entity_kind='invoice' AND l.entity_id=i.id WHERE i.organization_id=$1 AND i.invoice_state <> 'void' AND (l.provider_id IS NULL OR l.projection_version IS DISTINCT FROM i.synchronization_version::varchar) AND ($2='' OR COALESCE(i.invoice_display_number,d.display_number) ILIKE '%'||$2||'%' OR COALESCE(c.display_name,c.company_name,'') ILIKE '%'||$2||'%')`,[organizationId,search]),
    ]); const total=Number(count.rows[0]?.count??0); return {items:rows.rows.map(row=>({invoiceId:row.id,displayNumber:row.display_number,customerName:row.customer_name,totalCents:Number(row.total_cents),currency:row.currency,issuedAt:row.posted_at?.toISOString()??null,syncStatus:(row.provider_id ? "out_of_sync" : "never_synced") as "never_synced" | "out_of_sync",accountingApproval:row.approval_id ? "approved" : "required"})),total,page,pageSize,hasNextPage:offset+rows.rows.length<total};
  }
  async unsyncedFinancialFacts(organizationId:string,input:Readonly<{page:number;pageSize:number;search:string}>):Promise<{items:readonly QuickBooksEligibleFinancialFact[];total:number;page:number;pageSize:number;hasNextPage:boolean}> {
    const page=Math.max(1,Math.floor(input.page)),pageSize=Math.min(100,Math.max(10,Math.floor(input.pageSize))),search=input.search.trim(),offset=(page-1)*pageSize;
    const candidates=`SELECT 'payment'::varchar subject_kind,p.id subject_id,COALESCE(i.invoice_display_number,d.display_number) invoice_display_number,COALESCE(c.display_name,c.company_name,'Customer unavailable') customer_name,p.amount_cents::text amount_cents,p.currency,p.occurred_at FROM v2_billing_payments p JOIN v2_billing_invoices i ON i.organization_id=p.organization_id AND i.id=p.invoice_id JOIN v2_sales_documents d ON d.organization_id=i.organization_id AND d.id=i.sales_order_document_id JOIN v2_quickbooks_sync_links invoice_link ON invoice_link.organization_id=i.organization_id AND invoice_link.entity_kind='invoice' AND invoice_link.entity_id=i.id AND invoice_link.projection_version=i.synchronization_version::varchar LEFT JOIN customers c ON c.organization_id=i.organization_id AND c.id=i.customer_id WHERE p.organization_id=$1 AND i.invoice_state <> 'void' AND NOT EXISTS (SELECT 1 FROM v2_quickbooks_sync_links l WHERE l.organization_id=p.organization_id AND l.entity_kind='payment' AND l.entity_id=p.id) AND NOT EXISTS (SELECT 1 FROM v2_quickbooks_sync_jobs j WHERE j.organization_id=p.organization_id AND j.subject_kind='payment' AND j.subject_id=p.id) UNION ALL SELECT 'refund'::varchar subject_kind,r.id subject_id,COALESCE(i.invoice_display_number,d.display_number) invoice_display_number,COALESCE(c.display_name,c.company_name,'Customer unavailable') customer_name,r.amount_cents::text amount_cents,r.currency,r.occurred_at FROM v2_billing_refunds r JOIN v2_billing_refund_allocations a ON a.organization_id=r.organization_id AND a.refund_id=r.id JOIN v2_billing_invoices i ON i.organization_id=r.organization_id AND i.id=r.invoice_id JOIN v2_sales_documents d ON d.organization_id=i.organization_id AND d.id=i.sales_order_document_id JOIN v2_quickbooks_sync_links invoice_link ON invoice_link.organization_id=i.organization_id AND invoice_link.entity_kind='invoice' AND invoice_link.entity_id=i.id AND invoice_link.projection_version=i.synchronization_version::varchar LEFT JOIN customers c ON c.organization_id=i.organization_id AND c.id=i.customer_id WHERE r.organization_id=$1 AND i.invoice_state <> 'void' AND EXISTS (SELECT 1 FROM v2_quickbooks_sync_links l WHERE l.organization_id=a.organization_id AND l.entity_kind='payment' AND l.entity_id=a.payment_id) AND NOT EXISTS (SELECT 1 FROM v2_quickbooks_sync_links l WHERE l.organization_id=r.organization_id AND l.entity_kind='refund_disbursement' AND l.entity_id=r.id) AND NOT EXISTS (SELECT 1 FROM v2_quickbooks_sync_jobs j WHERE j.organization_id=r.organization_id AND j.subject_kind='refund' AND j.subject_id=r.id)`;
    const [rows,count]=await Promise.all([
      this.pool.query<{subject_kind:"payment"|"refund";subject_id:string;invoice_display_number:string;customer_name:string;amount_cents:string;currency:string;occurred_at:Date}>(`SELECT * FROM (${candidates}) candidates WHERE ($2='' OR invoice_display_number ILIKE '%'||$2||'%' OR customer_name ILIKE '%'||$2||'%' OR subject_kind ILIKE '%'||$2||'%') ORDER BY occurred_at DESC LIMIT $3 OFFSET $4`,[organizationId,search,pageSize,offset]),
      this.pool.query<{count:string}>(`SELECT count(*)::text count FROM (${candidates}) candidates WHERE ($2='' OR invoice_display_number ILIKE '%'||$2||'%' OR customer_name ILIKE '%'||$2||'%' OR subject_kind ILIKE '%'||$2||'%')`,[organizationId,search]),
    ]); const total=Number(count.rows[0]?.count??0); return {items:rows.rows.map((row)=>({subjectKind:row.subject_kind,subjectId:row.subject_id,displayNumber:row.invoice_display_number,customerName:row.customer_name,amountCents:Number(row.amount_cents),currency:row.currency,occurredAt:row.occurred_at.toISOString()})),total,page,pageSize,hasNextPage:offset+rows.rows.length<total};
  }
  async queueActivity(organizationId:string,input:Readonly<{page:number;pageSize:number;search:string;actionRequiredOnly:boolean}>):Promise<QuickBooksQueuePage> {
    const page=Math.max(1,Math.floor(input.page)),pageSize=Math.min(100,Math.max(10,Math.floor(input.pageSize))),search=input.search.trim(),offset=(page-1)*pageSize;
    const where=`j.organization_id=$1 AND ($2='' OR COALESCE(i.invoice_display_number,'') ILIKE '%'||$2||'%' OR COALESCE(c.display_name,c.company_name,'') ILIKE '%'||$2||'%' OR j.subject_kind ILIKE '%'||$2||'%') AND (NOT $3::boolean OR j.state IN ('blocked','retry','uncertain'))`;
    const joins=`FROM v2_quickbooks_sync_jobs j LEFT JOIN v2_billing_payments p ON p.organization_id=j.organization_id AND j.subject_kind='payment' AND p.id=j.subject_id LEFT JOIN v2_billing_refunds r ON r.organization_id=j.organization_id AND j.subject_kind='refund' AND r.id=j.subject_id LEFT JOIN v2_billing_invoices i ON i.organization_id=j.organization_id AND ((j.subject_kind='invoice' AND i.id=j.subject_id) OR (j.subject_kind='payment' AND i.id=p.invoice_id) OR (j.subject_kind='refund' AND i.id=r.invoice_id)) LEFT JOIN customers c ON c.organization_id=j.organization_id AND c.id=i.customer_id LEFT JOIN v2_quickbooks_sync_links l ON l.organization_id=j.organization_id AND l.entity_id=j.subject_id AND ((j.subject_kind IN ('invoice','payment') AND l.entity_kind=j.subject_kind) OR (j.subject_kind='refund' AND l.entity_kind='refund_disbursement'))`;
    const [rows,count]=await Promise.all([
      this.pool.query<{id:string;subject_kind:QuickBooksSyncSubject;subject_id:string;state:JobState;attempt_count:number;last_error:string|null;updated_at:Date;completed_at:Date|null;display_number:string|null;customer_name:string;amount_cents:string|null;currency:string|null;provider_id:string|null;payment_unattempted:boolean}>(`SELECT j.id,j.subject_kind,j.subject_id,j.state,j.attempt_count,j.last_error,j.updated_at,j.completed_at,COALESCE(i.invoice_display_number,'Invoice') display_number,COALESCE(c.display_name,c.company_name,'Customer unavailable') customer_name,CASE WHEN j.subject_kind='payment' THEN p.amount_cents WHEN j.subject_kind='refund' THEN r.amount_cents ELSE i.total_cents END::text amount_cents,COALESCE(p.currency,r.currency,i.currency) currency,l.provider_id,(j.subject_kind='payment' AND NOT EXISTS (SELECT 1 FROM v2_quickbooks_sync_links known WHERE known.organization_id=j.organization_id AND known.entity_kind='payment' AND known.entity_id=j.subject_id) AND (NOT EXISTS (SELECT 1 FROM v2_quickbooks_payment_references ref WHERE ref.organization_id=j.organization_id AND ref.payment_id=j.subject_id) OR EXISTS (SELECT 1 FROM v2_quickbooks_payment_references ref WHERE ref.organization_id=j.organization_id AND ref.payment_id=j.subject_id AND ref.recovery_context IS NOT NULL AND ref.recovery_context->>'jobId'=j.id AND ref.provider_attempt_started_at IS NULL))) payment_unattempted ${joins} WHERE ${where} ORDER BY CASE WHEN j.state IN ('blocked','retry','uncertain') THEN 0 ELSE 1 END,j.updated_at DESC LIMIT $4 OFFSET $5`,[organizationId,search,input.actionRequiredOnly,pageSize,offset]),
      this.pool.query<{count:string}>(`SELECT count(*)::text count ${joins} WHERE ${where}`,[organizationId,search,input.actionRequiredOnly]),
    ]); const total=Number(count.rows[0]?.count??0); return {items:rows.rows.map(row=>({jobId:row.id,subjectKind:row.subject_kind,subjectId:row.subject_id,displayNumber:row.display_number??"Invoice",customerName:row.customer_name,amountCents:row.amount_cents===null?null:Number(row.amount_cents),currency:row.currency,state:row.state,attemptCount:row.attempt_count,lastError:row.last_error,updatedAt:row.updated_at.toISOString(),completedAt:row.completed_at?.toISOString()??null,providerId:row.provider_id,retryEligible:(row.state==="blocked"||row.state==="retry")&&(row.subject_kind==="payment"?row.payment_unattempted:!row.last_error?.includes("QUICKBOOKS_PAYMENT_RECONCILIATION_REQUIRED")),recoveryEligible:row.subject_kind==="payment"?((row.state==="uncertain"||row.state==="blocked")&&!row.payment_unattempted):quickBooksCredentialInterruptedRecoveryEligible(row.state,row.last_error)})),total,page,pageSize,hasNextPage:offset+rows.rows.length<total};
  }
  /** Recovery deliberately preserves the one existing queue identity. */
  async retry(organizationId: string, subjectKind: QuickBooksSyncSubject, subjectId: string): Promise<{ state: "queued"; attemptCount: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const valid = await client.query<{ id:string }>(subjectKind === "invoice"
        ? "SELECT i.id FROM v2_billing_invoices i JOIN v2_quickbooks_invoice_approvals a ON a.organization_id=i.organization_id AND a.invoice_id=i.id AND a.synchronization_version=i.synchronization_version WHERE i.organization_id=$1 AND i.id=$2 AND i.invoice_state <> 'void'"
        : subjectKind === "payment"
          ? "SELECT p.id FROM v2_billing_payments p WHERE p.organization_id=$1 AND p.id=$2 AND EXISTS (SELECT 1 FROM v2_billing_payment_allocations a JOIN v2_billing_invoices i ON i.organization_id=a.organization_id AND i.id=a.invoice_id WHERE a.organization_id=p.organization_id AND a.payment_id=p.id AND i.invoice_state <> 'void')"
          : "SELECT r.id FROM v2_billing_refunds r WHERE r.organization_id=$1 AND r.id=$2 AND EXISTS (SELECT 1 FROM v2_billing_refund_allocations a JOIN v2_billing_refund_allocation_evidence e ON e.organization_id=a.organization_id AND e.refund_allocation_id=a.id JOIN v2_billing_invoices i ON i.organization_id=e.organization_id AND i.id=e.invoice_id WHERE a.organization_id=r.organization_id AND a.refund_id=r.id AND i.invoice_state <> 'void')", [organizationId, subjectId]);
      if (!valid.rows[0]) throw new Error(`The V2 ${subjectKind} is unavailable for QuickBooks recovery.`);
      if(subjectKind==="payment"){
        // Every invocation first crosses the protected append-only reference
        // barrier. Missing reference/link or a valid unstarted context proves
        // no authorized attempt; historical NULL context does not.
        const job=await client.query<{id:string;state:JobState;attempt_count:number}>("SELECT id,state,attempt_count FROM v2_quickbooks_sync_jobs WHERE organization_id=$1 AND subject_kind='payment' AND subject_id=$2 FOR UPDATE",[organizationId,subjectId]);
        const current=job.rows[0];
        if(!current||!['blocked','retry'].includes(current.state))throw quickBooksPaymentReconciliationRequired("Payment is not available for explicit retry");
        const eligible=await client.query<{unattempted:boolean}>("SELECT (NOT EXISTS (SELECT 1 FROM v2_quickbooks_sync_links known WHERE known.organization_id=$1 AND known.entity_kind='payment' AND known.entity_id=$2) AND (NOT EXISTS (SELECT 1 FROM v2_quickbooks_payment_references ref WHERE ref.organization_id=$1 AND ref.payment_id=$2) OR EXISTS (SELECT 1 FROM v2_quickbooks_payment_references ref WHERE ref.organization_id=$1 AND ref.payment_id=$2 AND ref.recovery_context IS NOT NULL AND ref.recovery_context->>'jobId'=$3 AND ref.provider_attempt_started_at IS NULL))) unattempted",[organizationId,subjectId,current.id]);
        if(eligible.rows[0]?.unattempted!==true)throw quickBooksPaymentReconciliationRequired("original Payment attempt is unknown or started; use read-only reconciliation");
        await client.query("UPDATE v2_quickbooks_sync_jobs SET state='queued',available_at=now(),lease_expires_at=NULL,claimed_by=NULL,updated_at=now() WHERE organization_id=$1 AND subject_kind='payment' AND subject_id=$2",[organizationId,subjectId]);
        await client.query("COMMIT");return {state:"queued",attemptCount:current.attempt_count};
      }
      const recovered = await client.query<{ attempt_count:number }>("UPDATE v2_quickbooks_sync_jobs SET state='queued',available_at=now(),lease_expires_at=NULL,claimed_by=NULL,updated_at=now() WHERE organization_id=$1 AND subject_kind=$2 AND subject_id=$3 AND state IN ('blocked','retry') AND COALESCE(last_error,'') NOT LIKE '%QUICKBOOKS_PAYMENT_RECONCILIATION_REQUIRED%' RETURNING attempt_count", [organizationId,subjectKind,subjectId]);
      if (recovered.rows[0]) { await client.query("COMMIT"); return { state:"queued",attemptCount:recovered.rows[0].attempt_count }; }
      const job = await client.query<{ state:JobState }>("SELECT state FROM v2_quickbooks_sync_jobs WHERE organization_id=$1 AND subject_kind=$2 AND subject_id=$3 FOR UPDATE", [organizationId,subjectKind,subjectId]);
      const state=job.rows[0]?.state;
      if (state === "succeeded") throw new Error(`This QuickBooks ${subjectKind} is already synchronized.`);
      if (state === "uncertain") throw new Error(`This QuickBooks ${subjectKind} requires provider reconciliation before it can be retried.`);
      if (state === "processing") throw new Error(`This QuickBooks ${subjectKind} is currently being processed.`);
      throw new Error(`This QuickBooks ${subjectKind} is not eligible for recovery.`);
    } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  /** Only a pre-provider credential interruption can be resumed here. Other
   * uncertain outcomes stay held for explicit provider reconciliation. */
  async resumeAfterCredentialReauth(organizationId: string, subjectKind: QuickBooksSyncSubject, subjectId: string): Promise<{ state: "queued"; attemptCount: number }> {
    if (subjectKind === "payment") throw quickBooksPaymentReconciliationRequired("Payment recovery requires its durable attempt state, not credential-error text");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const recovered = await client.query<{ attempt_count:number }>("UPDATE v2_quickbooks_sync_jobs SET state='queued',available_at=now(),lease_expires_at=NULL,claimed_by=NULL,updated_at=now() WHERE organization_id=$1 AND subject_kind=$2 AND subject_id=$3 AND state='uncertain' AND lower(COALESCE(last_error,'')) LIKE '%failed to get valid access token%' RETURNING attempt_count", [organizationId,subjectKind,subjectId]);
      if (!recovered.rows[0]) throw new Error("This QuickBooks job is not eligible for credential-interruption recovery.");
      await client.query("COMMIT");
      return { state:"queued",attemptCount:recovered.rows[0].attempt_count };
    } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async reconcilePayment(organizationId: string, paymentId: string, authorizeCurrentOperator: () => Promise<void>): Promise<{ state: "succeeded"; providerId: string }> {
    const job = await this.pool.query<{id:string;attempt_count:number;state:"uncertain"|"blocked";generation:string}>("SELECT id,attempt_count,state,updated_at::text generation FROM v2_quickbooks_sync_jobs WHERE organization_id=$1 AND subject_kind='payment' AND subject_id=$2 AND state IN ('uncertain','blocked')", [organizationId,paymentId]);
    if (!job.rows[0]) throw quickBooksPaymentReconciliationRequired("Payment is not held for reconciliation");
    const current = job.rows[0];
    const providerId = await new V2QuickBooksBillingWorker(this.pool,"v2-qb:read-reconciliation",this.paymentReader).recoverPayment({id:current.id,organizationId,subjectKind:"payment",subjectId:paymentId,attemptCount:current.attempt_count,recoveryState:current.state,recoveryGeneration:current.generation},authorizeCurrentOperator);
    return {state:"succeeded",providerId};
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
  constructor(private readonly pool: Pool, private readonly workerId = `v2-qb:${process.env.RAILWAY_REPLICA_ID || hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`, private readonly paymentReader: QuickBooksPaymentReadPort = new PostgresQuickBooksPaymentReadTransport(pool)) {}

  async run(limit = 8): Promise<QuickBooksQueueRunResult> {
    const result = { claimed: 0, succeeded: 0, retry: 0, uncertain: 0, blocked: 0 };
    for (let index = 0; index < Math.max(0, limit); index += 1) {
      const job = await this.claim();
      if (!job) break;
      result.claimed += 1;
      try {
        if (job.subjectKind === "payment") {
          const providerId = await this.processPayment(job);
          await this.completePayment(job, providerId);
          result.succeeded += 1;
        } else if (job.subjectKind === "invoice") {
          await this.processInvoice(job);
          result.succeeded += 1;
        } else {
          await this.process(job);
          if (await this.finish(job, "succeeded")) result.succeeded += 1;
          else result.uncertain += 1;
        }
      } catch (error) {
        if(job.subjectKind==="invoice"&&["42P01","42703"].includes((error as {code?:string}).code??""))error=quickBooksPaymentReconciliationRequired("protected canonical publication schema is unavailable");
        const state: JobState = quickBooksQueueFailureState(error);
        if (job.subjectKind === "refund") await this.workflow(job.organizationId, job.subjectId, state, concise(error));
        const finished = job.subjectKind === "payment" ? await this.finishPaymentFailure(job,state,concise(error)) : job.subjectKind === "invoice" ? await this.finishInvoiceFailure(job,state,concise(error)) : await this.finish(job, state, concise(error));
        if (!finished || state === "uncertain") result.uncertain += 1; else if (state === "blocked") result.blocked += 1; else result.retry += 1;
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
    if (job.subjectKind === "payment") throw quickBooksPaymentReconciliationRequired("Payment processing requires guarded atomic completion");
    return this.processRefund(job);
  }

  private async processInvoice(job: Job): Promise<void> {
    const client = await this.pool.connect();
    let released=false;
    try {
      const invoice = await client.query<{ customer_id:string|null; display_number:string; currency:string; posted_at:Date; synchronization_version:string;total_cents:string;tax_cents:string }>(
        `SELECT i.customer_id,COALESCE(i.invoice_display_number,d.display_number) display_number,i.currency,COALESCE(i.issued_at,i.created_at) posted_at,i.synchronization_version,i.total_cents::text total_cents,i.tax_total_cents::text tax_cents
         FROM v2_billing_invoices i JOIN v2_sales_documents d ON d.organization_id=i.organization_id AND d.id=i.sales_order_document_id
         WHERE i.organization_id=$1 AND i.id=$2 AND i.invoice_state <> 'void' AND EXISTS (SELECT 1 FROM v2_quickbooks_invoice_approvals approval WHERE approval.organization_id=i.organization_id AND approval.invoice_id=i.id AND approval.synchronization_version=i.synchronization_version)`, [job.organizationId, job.subjectId]);
      const row = invoice.rows[0];
      if (!row?.customer_id || !row.display_number) throw Object.assign(new Error("The current V2 Invoice version requires accounting approval before QuickBooks sync."), { statusCode: 409 });
      const customer = await client.query<{ id:string; display_name:string|null; company_name:string|null; email:string|null; phone:string|null; customer_type:string|null }>(
        "SELECT id,display_name,company_name,email,phone,customer_type FROM customers WHERE organization_id=$1 AND id=$2", [job.organizationId, row.customer_id]);
      const customerRow = customer.rows[0];
      if (!customerRow) throw new Error("V2 Invoice customer is unavailable for QuickBooks sync.");
      // Shipping is a canonical Invoice additional charge, not a manufactured
      // Product line.  It still travels in the current approved QB projection.
      const lineRows = await client.query<{ description:string; quantity:number; selling_unit_cents:string; selling_line_cents:string }>(`SELECT description,quantity,selling_unit_cents,selling_line_cents FROM (
        SELECT position AS ordering,description,quantity,selling_unit_cents::text,selling_line_cents::text FROM v2_billing_invoice_lines WHERE organization_id=$1 AND invoice_id=$2
        UNION ALL
        SELECT 1000000 + row_number() OVER (ORDER BY created_at,id),COALESCE(customer_note,'Shipping'),1,customer_charge_cents::text,customer_charge_cents::text FROM v2_billing_invoice_additional_charges WHERE organization_id=$1 AND invoice_id=$2
      ) current_projection ORDER BY ordering`, [job.organizationId, job.subjectId]);
      const lines = projectionLines(lineRows.rows);
      if (!lines.length) throw new Error("V2 Order-backed Invoice has no billable lines for QuickBooks sync.");
      if(Number(row.tax_cents)!==0||lines.some(line=>line.lineAmountCents<0||line.unitAmountCents<0)||lines.reduce((sum,line)=>sum+line.lineAmountCents,0)!==Number(row.total_cents))throw quickBooksPaymentReconciliationRequired("approved Invoice tax or adjustment is not representable by the existing sales-line export shape");
      const projection: InvoiceProjection = { displayNumber: row.display_number, currency: row.currency, postedAt: row.posted_at.toISOString(), customerId: customerRow.id, lines };
      assertInvoicePublicationAmounts(projection);
      const fingerprint = quickBooksInvoiceProjectionFingerprint(projection);
      const publicationJob={...job,publicationVersion:row.synchronization_version};
      const existingInvoice = await this.invoiceLink(job.organizationId, job.subjectId);
      const customerLink=await this.pool.query<{provider_id:string;projection_json:unknown}>("SELECT provider_id,projection_json FROM v2_quickbooks_sync_links WHERE organization_id=$1 AND entity_kind='customer' AND entity_id=$2",[job.organizationId,customerRow.id]);
      const connection=await this.paymentReader.connection(job.organizationId);
      let unchangedIntent:PublicationIntent|undefined;
      if(existingInvoice){const key=assertPublicationLink(connection,"invoice",job.subjectId,{providerId:existingInvoice.providerId,projectionJson:existingInvoice.projectionJson});const evidence=await this.pool.query<{intent_json:PublicationIntent}>("SELECT intent_json FROM v2_quickbooks_provider_requests WHERE request_id=$1 AND organization_id=$2 AND entity_kind='invoice' AND entity_id=$3 AND realm_id=$4 AND environment=$5 AND confirmed_provider_id=$6",[key,job.organizationId,job.subjectId,connection.realmId,connection.environment,existingInvoice.providerId]);if(!evidence.rows[0])throw quickBooksPaymentReconciliationRequired("Invoice binding has no confirmed canonical request evidence");if(existingInvoice.projectionFingerprint===fingerprint)unchangedIntent=evidence.rows[0].intent_json;}
      const displayName=(customerRow.display_name||customerRow.company_name||"").trim();
      if(!displayName)throw quickBooksPaymentReconciliationRequired("Customer display name is unavailable");
      const customerIntent=publicationIntent(connection,"customer",customerRow.id,{DisplayName:displayName,...(customerRow.company_name?{CompanyName:customerRow.company_name}:{}),...(customerRow.email?{PrimaryEmailAddr:{Address:customerRow.email}}:{}),...(customerRow.phone?{PrimaryPhone:{FreeFormNumber:customerRow.phone}}:{})});
      // The newest approved Billing projection is the source. Durable request
      // keys preserve unchanged exports without redundant provider mutations.
      client.release();released=true;
      const customerPublication=await this.publishPrerequisite(publicationJob,customerIntent,customerLink.rows[0]?{providerId:customerLink.rows[0].provider_id,projectionJson:customerLink.rows[0].projection_json}:undefined);
      await this.commitPublication(publicationJob,customerPublication);
      const intent=unchangedIntent??invoicePublicationIntent(connection,job.subjectId,customerPublication.providerIdentity.providerId,projection,row.synchronization_version);
      const invoicePublication=await this.publishPrerequisite(publicationJob,intent,existingInvoice?{providerId:existingInvoice.providerId,projectionJson:existingInvoice.projectionJson}:undefined);
      await this.commitPublication(publicationJob,invoicePublication,{projection,fingerprint,version:row.synchronization_version});
    } finally { if(!released) client.release(); }
  }

  private async lockPublicationJob(client:QuickBooksQueueClient,job:Job):Promise<void>{
    const rows=await client.query("SELECT id FROM v2_quickbooks_sync_jobs WHERE organization_id=$1 AND id=$2 AND subject_kind='invoice' AND subject_id=$3 AND state='processing' AND claimed_by=$4 AND attempt_count=$5 AND lease_expires_at>now() FOR UPDATE",[job.organizationId,job.id,job.subjectId,this.workerId,job.attemptCount]);
    if(!rows.rows[0])throw quickBooksPaymentReconciliationRequired("publication job generation changed or lease expired");
    if(job.publicationVersion){const current=await client.query("SELECT id FROM v2_billing_invoices WHERE organization_id=$1 AND id=$2 AND synchronization_version=$3 AND invoice_state<>'void' AND EXISTS (SELECT 1 FROM v2_quickbooks_invoice_approvals a WHERE a.organization_id=$1 AND a.invoice_id=$2 AND a.synchronization_version=$3)",[job.organizationId,job.subjectId,job.publicationVersion]);if(!current.rows[0])throw quickBooksPaymentReconciliationRequired("approved publication version changed");}
  }

  private async publishPrerequisite(job:Job,wanted:PublicationIntent,link?:PublicationLink):Promise<ConfirmedPublication>{
    if(!this.paymentReader.publishEntity)throw quickBooksPaymentReconciliationRequired("pinned canonical publisher is unavailable");
    const priorKey=link?assertPublicationLink(wanted.connection,wanted.entityKind,wanted.entityId,link):undefined;
    const foreignScope=await this.pool.query("SELECT request_id FROM v2_quickbooks_provider_requests WHERE organization_id=$1 AND entity_kind=$2 AND entity_id=$3 AND (realm_id<>$4 OR environment<>$5) LIMIT 1",[job.organizationId,wanted.entityKind,wanted.entityId,wanted.connection.realmId,wanted.connection.environment]);
    if(foreignScope.rows[0])throw quickBooksPaymentReconciliationRequired("canonical publication already has a different realm/environment intent");
    const pending=await this.pool.query<{intent_json:PublicationIntent}>("SELECT intent_json FROM v2_quickbooks_provider_requests WHERE organization_id=$1 AND entity_kind=$2 AND entity_id=$3 AND realm_id=$4 AND environment=$5 AND provider_attempt_started_at IS NOT NULL AND confirmed_provider_id IS NULL AND request_id<>$6 ORDER BY created_at",[job.organizationId,wanted.entityKind,wanted.entityId,wanted.connection.realmId,wanted.connection.environment,wanted.requestId]);
    for(const row of pending.rows){const recovered=await this.paymentReader.publishEntity(row.intent_json,true,async()=>{throw quickBooksPaymentReconciliationRequired("unknown publication cannot replay");},link?.providerId);await this.confirmPublicationRequest(job,recovered);}
    const previous=await this.pool.query<{intent_json:PublicationIntent;confirmed_provider_id:string}>("SELECT intent_json,confirmed_provider_id FROM v2_quickbooks_provider_requests WHERE organization_id=$1 AND entity_kind=$2 AND entity_id=$3 AND realm_id=$4 AND environment=$5 AND confirmed_provider_id IS NOT NULL ORDER BY confirmed_at DESC LIMIT 1",[job.organizationId,wanted.entityKind,wanted.entityId,wanted.connection.realmId,wanted.connection.environment]);
    const prior=previous.rows[0];
    if(priorKey&&(!prior||prior.confirmed_provider_id!==link!.providerId))throw quickBooksPaymentReconciliationRequired("bound publication has no matching confirmed request");
    const client=await this.pool.connect();let intent=wanted,attempted=false;
    try{await client.query("BEGIN");await this.lockPublicationJob(client,job);
      await client.query("INSERT INTO v2_quickbooks_provider_requests(request_id,organization_id,entity_kind,entity_id,realm_id,environment,intent_json) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(request_id) DO NOTHING",[wanted.requestId,job.organizationId,wanted.entityKind,wanted.entityId,wanted.connection.realmId,wanted.connection.environment,JSON.stringify(wanted)]);
      const saved=await client.query<{intent_json:PublicationIntent;provider_attempt_started_at:Date|null}>("SELECT intent_json,provider_attempt_started_at FROM v2_quickbooks_provider_requests WHERE request_id=$1 AND organization_id=$2 FOR UPDATE",[wanted.requestId,job.organizationId]);
      const row=saved.rows[0];if(!row)throw quickBooksPaymentReconciliationRequired("publication intent is unavailable");
      if(!publicationEquals(row.intent_json,wanted)){
        if(wanted.entityKind!=="customer"||row.provider_attempt_started_at===null||row.intent_json.entityId!==wanted.entityId||!publicationEquals(row.intent_json.connection,wanted.connection))throw quickBooksPaymentReconciliationRequired("prepared publication payload changed");
        intent=row.intent_json;
      }
      attempted=row.provider_attempt_started_at!==null;await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");if((error as {code?:string}).code==="42703"||(error as {code?:string}).code==="42P01")throw quickBooksPaymentReconciliationRequired("protected publication request schema is unavailable");throw error;}finally{client.release();}
    return this.paymentReader.publishEntity(intent,attempted,async()=>{
      const mutation=await this.pool.connect();try{await mutation.query("BEGIN");await this.lockPublicationJob(mutation,job);
        const started=await mutation.query("UPDATE v2_quickbooks_provider_requests SET provider_attempt_started_at=now() WHERE request_id=$1 AND organization_id=$2 AND intent_json=$3::jsonb AND provider_attempt_started_at IS NULL RETURNING request_id",[intent.requestId,job.organizationId,JSON.stringify(intent)]);
        if(!started.rows[0])throw quickBooksPaymentReconciliationRequired("publication already attempted; no replay");await mutation.query("COMMIT");
      }catch(error){await mutation.query("ROLLBACK");throw error;}finally{mutation.release();}
    },link?.providerId??prior?.confirmed_provider_id,prior?.intent_json);
  }

  private async confirmPublicationRequest(job:Job,result:ConfirmedPublication):Promise<void>{
    const client=await this.pool.connect();try{await client.query("BEGIN");await this.lockPublicationJob(client,job);await this.recordPublicationConfirmation(client,job,result);await client.query("COMMIT");}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }

  private async recordPublicationConfirmation(client:QuickBooksQueueClient,job:Job,result:ConfirmedPublication):Promise<void>{
    const identity=result.providerIdentity;
    const confirmed=await client.query("UPDATE v2_quickbooks_provider_requests SET confirmed_provider_id=$3,confirmed_at=COALESCE(confirmed_at,now()) WHERE request_id=$1 AND organization_id=$2 AND entity_kind=$4 AND entity_id=$5 AND realm_id=$6 AND environment=$7 AND provider_attempt_started_at IS NOT NULL AND (confirmed_provider_id IS NULL OR confirmed_provider_id=$3) RETURNING request_id",[result.providerRequestId,job.organizationId,identity.providerId,identity.entityKind,identity.entityId,identity.realmId,identity.environment]);
    if(!confirmed.rows[0])throw quickBooksPaymentReconciliationRequired("publication confirmation has no durable attempt identity");
  }

  private async commitPublication(job:Job,result:ConfirmedPublication,invoice?:{projection:InvoiceProjection;fingerprint:string;version:string}):Promise<void>{
    const client=await this.pool.connect();try{await client.query("BEGIN");await this.lockPublicationJob(client,job);
      const identity=result.providerIdentity;
      if(identity.organizationId!==job.organizationId||(invoice&&(identity.entityKind!=="invoice"||identity.entityId!==job.subjectId)))throw quickBooksPaymentReconciliationRequired("publication identity scope changed");
      if(invoice){const current=await client.query("SELECT id FROM v2_billing_invoices WHERE organization_id=$1 AND id=$2 AND synchronization_version=$3 AND invoice_state<>'void' AND EXISTS (SELECT 1 FROM v2_quickbooks_invoice_approvals a WHERE a.organization_id=$1 AND a.invoice_id=$2 AND a.synchronization_version=$3)",[job.organizationId,job.subjectId,invoice.version]);if(!current.rows[0])throw quickBooksPaymentReconciliationRequired("approved Invoice projection changed before publication");}
      const previous=await client.query<{provider_id:string;projection_json:unknown}>("SELECT provider_id,projection_json FROM v2_quickbooks_sync_links WHERE organization_id=$1 AND entity_kind=$2 AND entity_id=$3 FOR UPDATE",[job.organizationId,identity.entityKind,identity.entityId]);
      if(previous.rows[0]){assertPublicationLink({organizationId:job.organizationId,realmId:identity.realmId,environment:identity.environment},identity.entityKind,identity.entityId,{providerId:previous.rows[0].provider_id,projectionJson:previous.rows[0].projection_json});if(previous.rows[0].provider_id!==identity.providerId)throw quickBooksPaymentReconciliationRequired("publication cannot overwrite a different provider identity");}
      const json={...(invoice?.projection??{}),providerIdentity:identity,providerRequestId:result.providerRequestId};
      const adopted=await client.query("INSERT INTO v2_quickbooks_sync_links(organization_id,entity_kind,entity_id,provider_id,projection_version,projection_fingerprint,projection_json,projection_synced_at) VALUES($1,$2::varchar,$3,$4,$5,$6,$7::jsonb,CASE WHEN $2::varchar='invoice' THEN now() ELSE NULL END) ON CONFLICT(organization_id,entity_kind,entity_id) DO UPDATE SET projection_version=EXCLUDED.projection_version,projection_fingerprint=EXCLUDED.projection_fingerprint,projection_json=EXCLUDED.projection_json,projection_synced_at=EXCLUDED.projection_synced_at,updated_at=now() WHERE v2_quickbooks_sync_links.provider_id=EXCLUDED.provider_id AND v2_quickbooks_sync_links.projection_json->'providerIdentity'=EXCLUDED.projection_json->'providerIdentity' RETURNING provider_id",[job.organizationId,identity.entityKind,identity.entityId,identity.providerId,invoice?.version??null,invoice?.fingerprint??null,JSON.stringify(json)]);
      if(adopted.rows.length!==1)throw quickBooksPaymentReconciliationRequired("publication adoption identity raced or differs");
      await this.recordPublicationConfirmation(client,job,result);
      if(invoice){const completed=await client.query("UPDATE v2_quickbooks_sync_jobs SET state='succeeded',last_error=NULL,lease_expires_at=NULL,claimed_by=NULL,completed_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2 AND subject_kind='invoice' AND attempt_count=$3 RETURNING id",[job.organizationId,job.id,job.attemptCount]);if(!completed.rows[0])throw quickBooksPaymentReconciliationRequired("Invoice publication completion changed");}
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");if((error as {code?:string}).code==="23505")throw quickBooksPaymentReconciliationRequired("publication identity is already bound to another record");throw error;}finally{client.release();}
  }

  private async finishInvoiceFailure(job:Job,state:JobState,error:string):Promise<boolean>{
    const result=await this.pool.query("UPDATE v2_quickbooks_sync_jobs SET state=$2::varchar,last_error=$3,lease_expires_at=NULL,claimed_by=NULL,available_at=CASE WHEN $2::varchar='retry' THEN now()+($4::text||' milliseconds')::interval ELSE available_at END,updated_at=now() WHERE id=$1 AND organization_id=$5 AND subject_kind='invoice' AND state='processing' AND claimed_by=$6 AND attempt_count=$7 AND lease_expires_at>now() RETURNING id",[job.id,state,error,retryDelayMs(job.attemptCount),job.organizationId,this.workerId,job.attemptCount]);return result.rows.length===1;
  }

  async recoverPayment(job: Job, authorizeCurrentOperator: () => Promise<void>): Promise<string> {
    if (!job.recoveryState || !job.recoveryGeneration || typeof authorizeCurrentOperator !== "function") throw quickBooksPaymentReconciliationRequired("current operator recovery authority is unavailable");
    const providerId = await this.processPayment(job, true);
    await this.completePayment(job, providerId, authorizeCurrentOperator);
    return providerId;
  }

  private async processPayment(job: Job, recoveryOnly = false): Promise<string> {
    const client = await this.pool.connect();
    let released = false;
    try {
      const payment = await client.query<{ invoice_id:string; allocated_cents:string; payment_cents:string; currency:string; occurred_at:Date; customer_id:string|null; synchronization_version:string }>(
        `SELECT a.invoice_id,a.amount_cents::text allocated_cents,p.amount_cents::text payment_cents,p.currency,p.occurred_at,i.customer_id,i.synchronization_version
         FROM v2_billing_payments p
         JOIN v2_billing_payment_allocations a ON a.organization_id=p.organization_id AND a.payment_id=p.id
         JOIN v2_billing_invoices i ON i.organization_id=a.organization_id AND i.id=a.invoice_id
         WHERE p.organization_id=$1 AND p.id=$2 AND i.invoice_state <> 'void'
         ORDER BY a.invoice_id`, [job.organizationId, job.subjectId]);
      const rows = payment.rows;
      const row = rows[0];
      if (!row?.customer_id || rows.some((allocation) => allocation.customer_id !== row.customer_id || allocation.currency !== row.currency)) throw quickBooksPaymentReconciliationRequired("V2 Payment allocations must belong to one QuickBooks Customer and currency");
      const allocationTotal = rows.reduce((total, allocation) => total + Number(allocation.allocated_cents), 0);
      if (allocationTotal !== Number(row.payment_cents)) throw quickBooksPaymentReconciliationRequired("V2 Payment allocation total does not equal its immutable Payment amount");
      const allocationLinks = await Promise.all(rows.map(async (allocation) => ({ allocation, invoiceLink: await this.invoiceLink(job.organizationId, allocation.invoice_id) })));
      if (allocationLinks.some(({ allocation, invoiceLink }) => !invoiceLink || invoiceLink.projectionVersion !== allocation.synchronization_version)) throw new Error("V2 Payment waits for every allocated Invoice QuickBooks projection.");
      const customerQuickBooksId = await this.link(job.organizationId, "customer", row.customer_id);
      if (!customerQuickBooksId) throw new Error("V2 Payment waits for its Customer QuickBooks projection.");
      const existingPayment = await this.link(job.organizationId, "payment", job.subjectId);
      const connection = await this.paymentReader.connection(job.organizationId);
      const identity = { schemaVersion: 1 as const, ...connection, jobId: job.id, paymentId: job.subjectId, customerId: customerQuickBooksId, amountCents: Number(row.payment_cents), currency: row.currency, allocations: allocationLinks.map(({ allocation, invoiceLink }) => ({ invoiceId: invoiceLink!.providerId, amountCents: Number(allocation.allocated_cents) })) };
      const prepared = await this.paymentReference(client, job, identity, !recoveryOnly && !existingPayment);
      client.release(); released = true;
      return await exportOrRecoverQuickBooksPayment(this.paymentReader, prepared.context, { externalId: existingPayment ?? undefined, allowCreate: !recoveryOnly && !prepared.providerAttemptStarted, occurredAt: row.occurred_at.toISOString(), beforeCreate: () => this.startPaymentProviderAttempt(job, prepared.context) });
    } finally { if (!released) client.release(); }
  }

  /** Exactly one persisted PMT sequence belongs to one V2 Payment. It is
   * integration evidence, allowing a lost provider response to be reconciled
   * by the same PaymentRefNum instead of creating another Payment. */
  private async paymentReference(client: QuickBooksQueueClient, job: Job, identity: Omit<QuickBooksPaymentRecoveryContext,"reference">, allowPrepare: boolean): Promise<{context:QuickBooksPaymentRecoveryContext;providerAttemptStarted:boolean}> {
    const organizationId = job.organizationId, paymentId = job.subjectId;
    await client.query("BEGIN");
    try {
      await this.lockPaymentJob(client,job);
      const existing = await client.query<{ payment_ref_num: string; recovery_context: QuickBooksPaymentRecoveryContext | null; provider_attempt_started_at: Date | null }>("SELECT payment_ref_num,recovery_context,provider_attempt_started_at FROM v2_quickbooks_payment_references WHERE organization_id=$1 AND payment_id=$2 FOR UPDATE", [organizationId, paymentId]);
      if (existing.rows[0]) {
        const row = existing.rows[0], expected = { ...identity, reference: row.payment_ref_num };
        // JSONB key order is not stable; compare values, never serialized objects.
        const stored = row.recovery_context;
        if (!stored || Object.entries(identity).some(([key,value]) => key !== "allocations" && stored[key as keyof QuickBooksPaymentRecoveryContext] !== value)
          || stored.reference !== expected.reference || !Array.isArray(stored.allocations) || stored.allocations.length !== expected.allocations.length
          || expected.allocations.some((allocation,index) => stored.allocations[index]?.invoiceId !== allocation.invoiceId || stored.allocations[index]?.amountCents !== allocation.amountCents)) throw quickBooksPaymentReconciliationRequired("historical request context is missing or differs from current allocation/realm evidence");
        await client.query("COMMIT"); return {context:expected,providerAttemptStarted:row.provider_attempt_started_at !== null};
      }
      if (!allowPrepare) throw quickBooksPaymentReconciliationRequired("an earlier attempt has no durable provider request context");
      if (!this.paymentReader.assertCreationReferences) throw quickBooksPaymentReconciliationRequired("trusted Customer and Invoice realm bindings are unavailable");
      await this.paymentReader.assertCreationReferences({organizationId,realmId:identity.realmId,environment:identity.environment},identity);
      const allocated = await client.query<{ sequence_number: string }>(`INSERT INTO v2_quickbooks_payment_reference_counters(organization_id,next_sequence) VALUES($1,2)
        ON CONFLICT(organization_id) DO UPDATE SET next_sequence=v2_quickbooks_payment_reference_counters.next_sequence+1
        WHERE v2_quickbooks_payment_reference_counters.next_sequence <= 99999999999999999
        RETURNING (next_sequence-1)::text sequence_number`, [organizationId]);
      const sequence = allocated.rows[0]?.sequence_number;
      if (!sequence) throw new Error("QuickBooks Payment reference sequence is exhausted.");
      const reference = quickBooksPaymentReference(sequence);
      const context = { ...identity, reference };
      await client.query(`INSERT INTO v2_quickbooks_payment_references(organization_id,payment_id,sequence_number,payment_ref_num,recovery_context)
        VALUES($1,$2,$3::bigint,$4,$5::jsonb)`, [organizationId, paymentId, sequence, reference, JSON.stringify(context)]);
      await client.query("COMMIT");
      return {context,providerAttemptStarted:false};
    } catch (error) { await client.query("ROLLBACK"); if ((error as {code?:string}).code === "42703") throw quickBooksPaymentReconciliationRequired("V2 recovery schema is unavailable"); throw error; }
  }

  private async lockPaymentJob(client: QuickBooksQueueClient, job: Job): Promise<void> {
    const current = job.recoveryState && job.recoveryGeneration
      ? await client.query("SELECT id FROM v2_quickbooks_sync_jobs WHERE organization_id=$1 AND id=$2 AND subject_kind='payment' AND subject_id=$3 AND state=$4 AND attempt_count=$5 AND updated_at=$6::timestamptz AND claimed_by IS NULL AND lease_expires_at IS NULL FOR UPDATE", [job.organizationId,job.id,job.subjectId,job.recoveryState,job.attemptCount,job.recoveryGeneration])
      : await client.query("SELECT id FROM v2_quickbooks_sync_jobs WHERE organization_id=$1 AND id=$2 AND subject_kind='payment' AND subject_id=$3 AND state='processing' AND claimed_by=$4 AND attempt_count=$5 AND lease_expires_at>now() FOR UPDATE", [job.organizationId,job.id,job.subjectId,this.workerId,job.attemptCount]);
    if (!current.rows[0]) throw quickBooksPaymentReconciliationRequired("Payment queue generation changed or its lease expired");
  }

  private async startPaymentProviderAttempt(job: Job, context: QuickBooksPaymentRecoveryContext): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockPaymentJob(client,job);
      const started = await client.query("UPDATE v2_quickbooks_payment_references SET provider_attempt_started_at=now() WHERE organization_id=$1 AND payment_id=$2 AND recovery_context=$3::jsonb AND provider_attempt_started_at IS NULL RETURNING payment_id", [job.organizationId,job.subjectId,JSON.stringify(context)]);
      if (!started.rows[0]) throw quickBooksPaymentReconciliationRequired("the original provider attempt has already started or its identity is unavailable");
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  private async completePayment(job: Job, providerId: string, authorizeCurrentOperator?: () => Promise<void>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockPaymentJob(client,job);
      if (job.recoveryState) {
        if (!authorizeCurrentOperator) throw quickBooksPaymentReconciliationRequired("current operator recovery authority is unavailable");
        await authorizeCurrentOperator();
      }
      // Never overwrite a different identity. The existing provider/entity
      // unique constraints also prevent one QBO Payment being adopted twice.
      const linked = await client.query<{provider_id:string}>("SELECT provider_id FROM v2_quickbooks_sync_links WHERE organization_id=$1 AND entity_kind='payment' AND entity_id=$2 FOR UPDATE", [job.organizationId,job.subjectId]);
      if (linked.rows[0] && linked.rows[0].provider_id !== providerId) throw quickBooksPaymentReconciliationRequired("the local Payment already has a different provider identity");
      if (!linked.rows[0]) await client.query("INSERT INTO v2_quickbooks_sync_links(organization_id,entity_kind,entity_id,provider_id) VALUES($1,'payment',$2,$3) ON CONFLICT(organization_id,entity_kind,entity_id) DO NOTHING", [job.organizationId,job.subjectId,providerId]);
      const adopted = await client.query<{provider_id:string}>("SELECT provider_id FROM v2_quickbooks_sync_links WHERE organization_id=$1 AND entity_kind='payment' AND entity_id=$2 FOR UPDATE", [job.organizationId,job.subjectId]);
      if (adopted.rows[0]?.provider_id !== providerId) throw quickBooksPaymentReconciliationRequired("provider adoption identity changed");
      const completed = await client.query("UPDATE v2_quickbooks_sync_jobs SET state='succeeded',last_error=NULL,lease_expires_at=NULL,claimed_by=NULL,completed_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2 AND subject_kind='payment' AND subject_id=$3 AND attempt_count=$4 RETURNING id", [job.organizationId,job.id,job.subjectId,job.attemptCount]);
      if (!completed.rows[0]) throw quickBooksPaymentReconciliationRequired("Payment completion could not be confirmed");
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); if ((error as {code?:string}).code === "23505") throw quickBooksPaymentReconciliationRequired("provider identity is already bound to another local record"); throw error; } finally { client.release(); }
  }

  private async finishPaymentFailure(job: Job, state: JobState, error: string): Promise<boolean> {
    const result = await this.pool.query("UPDATE v2_quickbooks_sync_jobs SET state=$2::varchar,last_error=$3,lease_expires_at=NULL,claimed_by=NULL,available_at=CASE WHEN $2::varchar='retry' THEN now()+($4::text||' milliseconds')::interval ELSE available_at END,updated_at=now() WHERE id=$1 AND organization_id=$5 AND subject_kind='payment' AND subject_id=$6 AND state='processing' AND claimed_by=$7 AND attempt_count=$8 AND lease_expires_at>now() RETURNING id", [job.id,state,error,retryDelayMs(job.attemptCount),job.organizationId,job.subjectId,this.workerId,job.attemptCount]);
    return result.rows.length === 1;
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
      const refund = await client.query<{ invoice_id:string; payment_id:string; amount_cents:string; currency:string; occurred_at:Date; customer_id:string|null; display_number:string; synchronization_version:string }>(
        `SELECT e.invoice_id,e.payment_id,e.amount_cents,r.currency,r.occurred_at,i.customer_id,COALESCE(i.invoice_display_number,d.display_number) display_number,i.synchronization_version
           FROM v2_billing_refunds r
           JOIN v2_billing_refund_allocations a ON a.organization_id=r.organization_id AND a.refund_id=r.id
           JOIN v2_billing_refund_allocation_evidence e ON e.organization_id=a.organization_id AND e.refund_allocation_id=a.id
           JOIN v2_billing_invoices i ON i.organization_id=e.organization_id AND i.id=e.invoice_id
           JOIN v2_sales_documents d ON d.organization_id=i.organization_id AND d.id=i.sales_order_document_id
          WHERE r.organization_id=$1 AND r.id=$2 AND i.invoice_state <> 'void'`, [job.organizationId, job.subjectId]);
      // The existing QuickBooks CreditMemo -> Disbursement projection can only
      // represent one Invoice allocation.  Multi-allocation refunds are held
      // before any provider call until their dedicated QBO projection exists.
      if (refund.rows.length !== 1) throw new Error("QUICKBOOKS_REFUND_ALLOCATION_EXPORT_UNSUPPORTED: multi-invoice Refund export requires an allocation-aware CreditMemo/disbursement projection.");
      const row = refund.rows[0];
      if (!row?.customer_id || !row.payment_id) throw new Error("V2 Refund lacks its Order-backed Invoice or original Payment projection facts.");
      const customerQuickBooksId = await this.link(job.organizationId, "customer", row.customer_id);
      const invoiceLink = await this.invoiceLink(job.organizationId, row.invoice_id);
      const paymentQuickBooksId = await this.link(job.organizationId, "payment", row.payment_id);
      if (!customerQuickBooksId || !invoiceLink || invoiceLink.projectionVersion !== row.synchronization_version || !paymentQuickBooksId) throw new Error("V2 Refund waits for the current Customer, Invoice, and original Payment QuickBooks projections.");
      const snapshotLines = storedProjectionLines(invoiceLink.projectionJson);
      // Links created before live-revision metadata existed can still represent
      // an immutable historical issued invoice. Its persisted V2 lines are a
      // safe compatibility fallback; new live postings always use the export
      // snapshot above.
      const fallbackLines = snapshotLines.length ? [] : projectionLines((await client.query<{ description:string; quantity:number; selling_unit_cents:string; selling_line_cents:string }>(`SELECT description,quantity,selling_unit_cents,selling_line_cents FROM (
        SELECT position AS ordering,description,quantity,selling_unit_cents::text,selling_line_cents::text FROM v2_billing_invoice_lines WHERE organization_id=$1 AND invoice_id=$2
        UNION ALL
        SELECT 1000000 + row_number() OVER (ORDER BY created_at,id),COALESCE(customer_note,'Shipping'),1,customer_charge_cents::text,customer_charge_cents::text FROM v2_billing_invoice_additional_charges WHERE organization_id=$1 AND invoice_id=$2
      ) current_projection ORDER BY ordering`, [job.organizationId, row.invoice_id])).rows);
      const lines = snapshotLines.length ? snapshotLines : fallbackLines;
      if (!lines.length) throw new Error("V2 Refund cannot project an Invoice without its exported accounting lines.");
      await this.startRefundWorkflow(job.organizationId, job.subjectId);
      const existingCreditMemo = await this.link(job.organizationId, "refund_credit_memo", job.subjectId);
      const credit = await syncV2RefundCreditMemoToQuickBooks({
        organizationId: job.organizationId, refundId: job.subjectId, quickBooksCreditMemoId: existingCreditMemo ?? undefined,
        quickBooksInvoiceId: invoiceLink.providerId, quickBooksCustomerId: customerQuickBooksId, amountCents: Number(row.amount_cents), currency: row.currency,
        occurredAt: row.occurred_at.toISOString(), invoiceDisplayNumber: row.display_number, originalInvoiceLines: lines,
      });
      await this.upsertLink(job.organizationId, "refund_credit_memo", job.subjectId, credit.qbCreditMemoId);
      await this.workflow(job.organizationId, job.subjectId, "credit_created");
      const existingDisbursement = await this.link(job.organizationId, "refund_disbursement", job.subjectId);
      const disbursement = await syncV2RefundDisbursementToQuickBooks({
        organizationId: job.organizationId, refundId: job.subjectId, quickBooksDisbursementId: existingDisbursement ?? undefined,
        quickBooksCreditMemoId: credit.qbCreditMemoId, quickBooksInvoiceId: invoiceLink.providerId, quickBooksPaymentId: paymentQuickBooksId,
        quickBooksCustomerId: customerQuickBooksId, amountCents: Number(row.amount_cents), currency: row.currency, occurredAt: row.occurred_at.toISOString(),
      });
      await this.upsertLink(job.organizationId, "refund_disbursement", job.subjectId, disbursement.qbDisbursementId);
      await this.workflow(job.organizationId, job.subjectId, "linked");
      await this.workflow(job.organizationId, job.subjectId, "succeeded");
    } finally { client.release(); }
  }

  private async link(organizationId: string, kind: QuickBooksLinkKind, entityId: string): Promise<string | null> { const result = await this.pool.query<{provider_id:string}>("SELECT provider_id FROM v2_quickbooks_sync_links WHERE organization_id=$1 AND entity_kind=$2 AND entity_id=$3", [organizationId, kind, entityId]); return result.rows[0]?.provider_id ?? null; }
  private async invoiceLink(organizationId: string, invoiceId: string): Promise<InvoiceLink | null> { const result = await this.pool.query<{provider_id:string;projection_fingerprint:string|null;projection_version:string|null;projection_json:unknown}>("SELECT provider_id,projection_fingerprint,projection_version,projection_json FROM v2_quickbooks_sync_links WHERE organization_id=$1 AND entity_kind='invoice' AND entity_id=$2", [organizationId, invoiceId]); const row=result.rows[0]; return row ? {providerId:row.provider_id,projectionFingerprint:row.projection_fingerprint,projectionVersion:row.projection_version,projectionJson:row.projection_json} : null; }
  private async upsertLink(organizationId: string, kind: QuickBooksLinkKind, entityId: string, providerId: string): Promise<void> { await this.pool.query("INSERT INTO v2_quickbooks_sync_links(organization_id,entity_kind,entity_id,provider_id) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,entity_kind,entity_id) DO UPDATE SET provider_id=EXCLUDED.provider_id,updated_at=now()", [organizationId, kind, entityId, providerId]); }
  private async upsertInvoiceLink(organizationId: string, invoiceId: string, providerId: string, projection: InvoiceProjection, fingerprint: string, version: string): Promise<void> { await this.pool.query("INSERT INTO v2_quickbooks_sync_links(organization_id,entity_kind,entity_id,provider_id,projection_fingerprint,projection_version,projection_json,projection_synced_at) VALUES($1,'invoice',$2,$3,$4,$5,$6::jsonb,now()) ON CONFLICT(organization_id,entity_kind,entity_id) DO UPDATE SET provider_id=EXCLUDED.provider_id,projection_fingerprint=EXCLUDED.projection_fingerprint,projection_version=EXCLUDED.projection_version,projection_json=EXCLUDED.projection_json,projection_synced_at=EXCLUDED.projection_synced_at,updated_at=now()", [organizationId, invoiceId, providerId, fingerprint, version, JSON.stringify(projection)]); }
  private async startRefundWorkflow(organizationId: string, refundId: string): Promise<void> { await this.pool.query("INSERT INTO v2_quickbooks_refund_sync_workflows(organization_id,refund_id,state) VALUES($1,$2,'queued') ON CONFLICT(organization_id,refund_id) DO NOTHING", [organizationId, refundId]); }
  private async workflow(organizationId: string, refundId: string, state: "queued" | "credit_created" | "disbursement_created" | "linked" | "succeeded" | "uncertain" | "retry" | "blocked", error?: string): Promise<void> { await this.pool.query("INSERT INTO v2_quickbooks_refund_sync_workflows(organization_id,refund_id,state,last_error,completed_at) VALUES($1,$2,$3::varchar,$4::varchar,CASE WHEN $5::boolean THEN now() ELSE NULL END) ON CONFLICT(organization_id,refund_id) DO UPDATE SET state=EXCLUDED.state,last_error=EXCLUDED.last_error,completed_at=EXCLUDED.completed_at,updated_at=now()", [organizationId, refundId, state, error ?? null, state === "succeeded"]); }
  private async finish(job: Job, state: JobState, error?: string): Promise<boolean> { const delay = state === "retry" || (state === "uncertain" && job.subjectKind === "refund") ? retryDelayMs(job.attemptCount) : 0; const result = await this.pool.query("UPDATE v2_quickbooks_sync_jobs SET state=$2::varchar,last_error=$3,lease_expires_at=NULL,claimed_by=NULL,available_at=CASE WHEN $2::varchar='retry' OR ($2::varchar='uncertain' AND subject_kind='refund') THEN now()+($4::text||' milliseconds')::interval ELSE available_at END,completed_at=CASE WHEN $2::varchar='succeeded' THEN now() ELSE NULL END,updated_at=now() WHERE id=$1 AND state='processing' AND claimed_by=$5 AND attempt_count=$6 RETURNING id", [job.id,state,error ?? null,delay,this.workerId,job.attemptCount]); return result.rows.length === 1; }
}


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
