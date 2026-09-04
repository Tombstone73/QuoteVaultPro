import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { google } from "googleapis";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { PostgresInvoiceDocumentService } from "../billing/postgresInvoiceDocuments.js";
import { PostgresEmailIntegrationService, type ReadyGmailIntegration } from "./postgresEmailIntegration.js";

export type InvoiceEmailDeliveryPlan = Readonly<{ recipient:string; invoiceIds:readonly string[] }>;
type Candidate = Readonly<{ invoiceId:string; email:string|null }>;
type MailInvoice = Readonly<{ invoiceId:string; number:string; currency:string; balanceCents:number; pdf:Uint8Array; filename:string }>;
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const normalize=(value:string)=>value.trim().toLowerCase();
const escapeHtml=(value:string)=>value.replace(/[&<>"']/gu,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[character] ?? character));
const money=(currency:string,cents:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency}).format(cents/100);
const origin=()=>((process.env.APP_PUBLIC_WEB_ORIGIN ?? process.env.APP_URL ?? "").trim().replace(/\/$/u,""));
export const customerPortalInvoiceUrl=(invoiceIds:readonly string[])=>{
  const path=invoiceIds.length===1?`/portal/invoices/${encodeURIComponent(invoiceIds[0]!)}`:"/portal/invoices";
  return origin()?`${origin()}${path}`:path;
};

/** The sole V2 Invoice email sender.  It owns recipient planning, immutable
 * Billing documents, customer portal links, MIME construction, Gmail, and
 * the per-Invoice delivery audit.  Schedulers may call it, but may not
 * rebuild any delivery content or call Gmail themselves. */
export class PostgresInvoiceEmailSender {
  constructor(private readonly pool:Pool,private readonly documents=new PostgresInvoiceDocumentService(pool),private readonly email=new PostgresEmailIntegrationService(pool)) {}

  async plan(organizationId:string,invoiceIds:readonly string[]):Promise<readonly InvoiceEmailDeliveryPlan[]> {
    const ids=[...new Set(invoiceIds.map((value)=>String(value).trim()).filter(Boolean))];
    if(!ids.length)return [];
    const rows=await this.pool.query<Candidate>(`WITH candidate AS (
      SELECT i.id invoice_id, NULLIF(btrim(invoice_contact.email),'') email FROM v2_billing_invoices i
      LEFT JOIN customer_contacts invoice_contact ON invoice_contact.organization_id=i.organization_id AND invoice_contact.id=i.contact_id AND invoice_contact.status='active'
      WHERE i.organization_id=$1 AND i.id=ANY($2::varchar[]) AND i.invoice_state<>'void'
      UNION ALL
      SELECT i.id, NULLIF(btrim(ct.email),'') FROM v2_billing_invoices i JOIN customer_contact_links l ON l.organization_id=i.organization_id AND l.customer_id=i.customer_id AND l.status='active' AND l.is_billing=true JOIN customer_contacts ct ON ct.organization_id=l.organization_id AND ct.id=l.contact_id AND ct.status='active'
      WHERE i.organization_id=$1 AND i.id=ANY($2::varchar[]) AND i.invoice_state<>'void'
      UNION ALL
      SELECT i.id, NULLIF(btrim(ct.email),'') FROM v2_billing_invoices i JOIN customer_contact_links l ON l.organization_id=i.organization_id AND l.customer_id=i.customer_id AND l.status='active' AND l.is_primary=true JOIN customer_contacts ct ON ct.organization_id=l.organization_id AND ct.id=l.contact_id AND ct.status='active'
      WHERE i.organization_id=$1 AND i.id=ANY($2::varchar[]) AND i.invoice_state<>'void'
      UNION ALL
      SELECT i.id, NULLIF(btrim(c.email),'') FROM v2_billing_invoices i JOIN customers c ON c.organization_id=i.organization_id AND c.id=i.customer_id
      WHERE i.organization_id=$1 AND i.id=ANY($2::varchar[]) AND i.invoice_state<>'void'
    ) SELECT invoice_id AS "invoiceId",email FROM candidate`,[organizationId,ids]);
    const groups=new Map<string,string[]>();
    for(const row of rows.rows){const recipient=row.email?normalize(row.email):"";if(!emailPattern.test(recipient))continue;const group=groups.get(recipient)??[];if(!group.includes(row.invoiceId))group.push(row.invoiceId);groups.set(recipient,group);}
    // The scheduler receives one immutable Invoice delivery action at a time.
    // Recipient expansion happens here, not in the scheduler, so an Invoice
    // with multiple configured billing recipients remains explicit and safe.
    return [...groups.entries()].sort(([left],[right])=>left.localeCompare(right)).flatMap(([recipient,planned])=>planned.sort().map((invoiceId)=>({recipient,invoiceIds:[invoiceId]})));
  }

  async send(input:Readonly<{organizationId:string;recipient:string;invoiceIds:readonly string[];beforeProviderAttempt:()=>Promise<void>;audit:Readonly<{jobId?:string;operation:string;principalKind:string;principalSubject:string}>}>):Promise<string>{
    const recipient=normalize(input.recipient);if(!emailPattern.test(recipient))throw new V2ApplicationError("VALIDATION_ERROR","A valid Invoice email recipient is required.");
    const [integration,invoices]=await Promise.all([this.email.requireReady(input.organizationId),this.invoices(input.organizationId,input.invoiceIds)]);
    if(!invoices.length)throw new V2ApplicationError("VALIDATION_ERROR","No deliverable Invoice remains in this email job.");
    await input.beforeProviderAttempt();
    const providerMessageId=await this.deliver(integration,recipient,invoices);
    await this.auditSent(input.organizationId,invoices,recipient,providerMessageId,input.audit);
    return providerMessageId;
  }

  private async invoices(organizationId:string,invoiceIds:readonly string[]):Promise<readonly MailInvoice[]>{
    const ids=[...new Set(invoiceIds.map((value)=>String(value).trim()).filter(Boolean))];if(!ids.length)return [];
    const rows=await this.pool.query<{invoice_id:string;display_number:string;currency:string;total_cents:string;paid:string;refunded:string}>(`SELECT i.id invoice_id,COALESCE(i.invoice_display_number,d.display_number) display_number,i.currency,i.total_cents::text,COALESCE((SELECT sum(amount_cents) FROM v2_billing_payment_allocations p WHERE p.organization_id=i.organization_id AND p.invoice_id=i.id),0)::text paid,COALESCE((SELECT sum(amount_cents) FROM v2_billing_refunds r WHERE r.organization_id=i.organization_id AND r.invoice_id=i.id),0)::text refunded FROM v2_billing_invoices i JOIN v2_sales_documents d ON d.organization_id=i.organization_id AND d.id=i.sales_order_document_id WHERE i.organization_id=$1 AND i.id=ANY($2::varchar[]) AND i.invoice_state<>'void' ORDER BY array_position($2::varchar[],i.id)`,[organizationId,ids]);
    return Promise.all(rows.rows.map(async(row)=>({invoiceId:row.invoice_id,number:row.display_number,currency:row.currency,balanceCents:Number(row.total_cents)-Number(row.paid)+Number(row.refunded),pdf:await this.documents.pdf(organizationId as never,row.invoice_id as never),filename:await this.documents.filename(organizationId as never,row.invoice_id as never)})));
  }

  private async deliver(integration:ReadyGmailIntegration,recipient:string,invoices:readonly MailInvoice[]):Promise<string>{
    const clientId=process.env.GOOGLE_CLIENT_ID,clientSecret=process.env.GOOGLE_CLIENT_SECRET;if(!clientId||!clientSecret)throw new V2ApplicationError("RETRYABLE_FAILURE","The platform Gmail delivery connection is unavailable.");
    const oauth=new google.auth.OAuth2(clientId,clientSecret);oauth.setCredentials({refresh_token:integration.refreshToken});const portal=customerPortalInvoiceUrl(invoices.map((invoice)=>invoice.invoiceId));const summary=invoices.map((invoice)=>`<li><strong>${escapeHtml(invoice.number)}</strong> · balance ${escapeHtml(money(invoice.currency,invoice.balanceCents))}</li>`).join("");const single=invoices.length===1;const subject=single?`Invoice ${invoices[0]!.number} from ${integration.displayName}`:`${invoices.length} Invoices from ${integration.displayName}`;const label=single?"View & Pay Invoice":"View & Pay Invoices";
    const raw=rawMime({from:`\"${integration.displayName}\" <${integration.sendingAddress}>`,to:recipient,subject,html:`<p>Please find your ${single?"Invoice":"Invoices"} attached.</p><ul>${summary}</ul><p><a href="${escapeHtml(portal)}">${label}</a></p><p>Sign in to the customer portal to view current Invoice balances and pay eligible Invoices securely.</p>`,attachments:invoices.map((invoice)=>({filename:invoice.filename,content:invoice.pdf}))});
    const response=await google.gmail({version:"v1",auth:oauth}).users.messages.send({userId:"me",requestBody:{raw}},{timeout:30_000});if(!response.data.id)throw new Error("Provider did not return a message identity.");return response.data.id;
  }

  private async auditSent(organizationId:string,invoices:readonly MailInvoice[],recipient:string,providerMessageId:string,audit:Readonly<{jobId?:string;operation:string;principalKind:string;principalSubject:string}>):Promise<void>{
    for(const invoice of invoices)await this.pool.query("INSERT INTO v2_audit_events(organization_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,changes) VALUES($1,$2,'invoice_email_sent','invoice',$3,$4,$5,$6::jsonb)",[organizationId,audit.operation,invoice.invoiceId,audit.principalKind,audit.principalSubject,JSON.stringify([{jobId:audit.jobId??null,recipient,providerMessageId}])]);
  }
}

const rawMime=(input:Readonly<{from:string;to:string;subject:string;html:string;attachments:readonly Readonly<{filename:string;content:Uint8Array}>[]}>):string=>{const boundary=`v2-invoice-${randomUUID()}`;const lines=[`From: ${input.from}`,`To: ${input.to}`,`Subject: ${input.subject}`,"MIME-Version: 1.0",`Content-Type: multipart/mixed; boundary=\"${boundary}\"`,"",`--${boundary}`,"Content-Type: text/html; charset=utf-8","Content-Transfer-Encoding: 8bit","",input.html];for(const attachment of input.attachments){const filename=attachment.filename.replaceAll("\"","").replaceAll("\\\\","");lines.push(`--${boundary}`,"Content-Type: application/pdf",`Content-Disposition: attachment; filename=\"${filename}\"`,`Content-Transfer-Encoding: base64`,"",Buffer.from(attachment.content).toString("base64"));}lines.push(`--${boundary}--`,"");return Buffer.from(lines.join("\r\n")).toString("base64url");};
