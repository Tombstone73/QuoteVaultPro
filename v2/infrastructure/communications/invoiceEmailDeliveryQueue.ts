import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { Pool } from "pg";
import { google } from "googleapis";
import { AuthorityPolicy } from "../../src/authorization/authorityPolicy.js";
import { principalSubject, staffActorId, type Principal } from "../../src/authorization/principals.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { PostgresInvoiceDocumentService } from "../billing/postgresInvoiceDocuments.js";
import { PostgresEmailIntegrationService, type ReadyGmailIntegration } from "./postgresEmailIntegration.js";

export const invoiceEmailSelectionLimit = 100;
export const invoiceEmailMessageInvoiceLimit = 20;
export const invoiceEmailProviderTimeoutMs = 30_000;
export type InvoiceEmailState = "queued" | "processing" | "retry_wait" | "sent" | "failed" | "ambiguous";
export type InvoiceEmailAdmission = Readonly<{ batchId:string; selected:number; queuedInvoices:number; queuedMessages:number; skipped:number; replayed:boolean }>;
type RecipientInvoice = Readonly<{ invoiceId:string; customerId:string|null; email:string|null }>;
type Job = Readonly<{ id:string; organizationId:string; recipient:string; attemptCount:number }>;
type MailInvoice = Readonly<{ invoiceId:string; number:string; currency:string; totalCents:number; balanceCents:number; pdf:Uint8Array; filename:string }>;
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const normalize=(value:string)=>value.trim().toLowerCase();
const html=(value:string)=>value.replace(/[&<>"']/gu,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[character] ?? character));
const hash=(value:string)=>`sha256:${createHash("sha256").update(value).digest("hex")}`;
const concise=(cause:unknown)=>String((cause as {message?:unknown})?.message ?? cause ?? "Invoice email delivery failed").replace(/\s+/gu," ").replace(/\0/gu,"").trim().slice(0,900)||"Invoice email delivery failed";
const money=(currency:string,cents:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency}).format(cents/100);
const origin=()=>((process.env.APP_PUBLIC_WEB_ORIGIN ?? process.env.APP_URL ?? "").trim().replace(/\/$/u,""));
export const customerPortalUrl=(invoiceIds:readonly string[])=>{
  const path=invoiceIds.length===1?`/portal/invoices/${encodeURIComponent(invoiceIds[0]!)}`:"/portal/invoices";
  return origin()?`${origin()}${path}`:path;
};

/** A grouped message has one recipient and one immutable admission identity.
 * Invoice content remains deliberately live: the worker reads canonical V2
 * Billing/PDF facts immediately before handing the message to Gmail. */
export class PostgresInvoiceEmailDeliveryQueue {
  constructor(private readonly pool:Pool,private readonly documents=new PostgresInvoiceDocumentService(pool),private readonly email=new PostgresEmailIntegrationService(pool),private readonly authority=new AuthorityPolicy()) {}

  async admit(input:Readonly<{organizationId:string;principal:Principal;businessRequestId:string;invoiceIds:readonly string[]}>):Promise<InvoiceEmailAdmission>{
    if(input.principal.kind!=="staff"&&input.principal.kind!=="delegated_ai")throw new V2ApplicationError("FORBIDDEN","Only an authorized Invoice operator may send customer email.");
    if(!this.authority.decide(input.principal,{capability:"invoice.send",resource:{organizationId:input.organizationId}}).allowed)throw new V2ApplicationError("FORBIDDEN","The principal cannot send Invoice email.");
    const ids=[...new Set(input.invoiceIds.map((value)=>String(value).trim()).filter(Boolean))];
    if(!input.businessRequestId.trim())throw new V2ApplicationError("VALIDATION_ERROR","A business request identity is required.");
    if(!ids.length||ids.length>invoiceEmailSelectionLimit)throw new V2ApplicationError("VALIDATION_ERROR",`Select between 1 and ${invoiceEmailSelectionLimit} V2 Invoices.`);
    const client=await this.pool.connect();
    try{await client.query("BEGIN");
      const previous=await client.query<{id:string;requested_invoice_count:number;queued_invoice_count:number;queued_message_count:number;skipped_invoice_count:number}>("SELECT id,requested_invoice_count,queued_invoice_count,queued_message_count,skipped_invoice_count FROM v2_invoice_email_delivery_batches WHERE organization_id=$1 AND business_request_id=$2 FOR UPDATE",[input.organizationId,input.businessRequestId]);
      if(previous.rows[0]){await client.query("COMMIT");const row=previous.rows[0];return {batchId:row.id,selected:row.requested_invoice_count,queuedInvoices:row.queued_invoice_count,queuedMessages:row.queued_message_count,skipped:row.skipped_invoice_count,replayed:true};}
      const allowed=await this.resolve(client,input.organizationId,input.principal,ids);
      const grouped=new Map<string,RecipientInvoice[]>();
      for(const row of allowed){const recipient=row.email?normalize(row.email):"";if(!emailPattern.test(recipient))continue;const members=grouped.get(recipient)??[];members.push(row);grouped.set(recipient,members);}
      const batchId=randomUUID();let queuedInvoices=0,queuedMessages=0;
      await client.query("INSERT INTO v2_invoice_email_delivery_batches(id,organization_id,business_request_id,requested_invoice_count,principal_kind,principal_subject,staff_actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7)",[batchId,input.organizationId,input.businessRequestId,ids.length,input.principal.kind,principalSubject(input.principal),staffActorId(input.principal)??null]);
      for(const [recipient,members] of grouped){
        for(let start=0;start<members.length;start+=invoiceEmailMessageInvoiceLimit){
          const slice=members.slice(start,start+invoiceEmailMessageInvoiceLimit);const jobId=randomUUID();const key=hash(`${input.businessRequestId}:${recipient}:${slice.map((item)=>item.invoiceId).sort().join(",")}`);
          await client.query("INSERT INTO v2_invoice_email_delivery_jobs(id,organization_id,batch_id,recipient_email,recipient_normalized,logical_send_key) VALUES($1,$2,$3,$4,$4,$5)",[jobId,input.organizationId,batchId,recipient,key]);
          for(const item of slice)await client.query("INSERT INTO v2_invoice_email_delivery_items(organization_id,job_id,invoice_id) VALUES($1,$2,$3)",[input.organizationId,jobId,item.invoiceId]);
          queuedInvoices+=slice.length;queuedMessages+=1;
        }
      }
      const skipped=ids.length-queuedInvoices;
      const result={batchId,selected:ids.length,queuedInvoices,queuedMessages,skipped,replayed:false};
      await client.query("UPDATE v2_invoice_email_delivery_batches SET queued_invoice_count=$3,queued_message_count=$4,skipped_invoice_count=$5,result_json=$6::jsonb WHERE organization_id=$1 AND id=$2",[input.organizationId,batchId,queuedInvoices,queuedMessages,skipped,JSON.stringify(result)]);
      await client.query("INSERT INTO v2_audit_events(organization_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,'billing.invoice.email.admit.v1','invoice_email_batch_admitted','invoice_email_batch',$2,$3,$4,$5,$6::jsonb)",[input.organizationId,batchId,input.principal.kind,principalSubject(input.principal),staffActorId(input.principal)??null,JSON.stringify([{selected:ids.length,queuedInvoices,queuedMessages,skipped}])]);
      await client.query("COMMIT");return result;
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }

  async preview(input:Readonly<{organizationId:string;principal:Principal;invoiceIds:readonly string[]}>):Promise<Readonly<{selected:number;deliverableInvoices:number;recipientCount:number;skipped:number}>>{
    if(input.principal.kind!=="staff"&&input.principal.kind!=="delegated_ai")throw new V2ApplicationError("FORBIDDEN","Only an authorized Invoice operator may send customer email.");
    if(!this.authority.decide(input.principal,{capability:"invoice.send",resource:{organizationId:input.organizationId}}).allowed)throw new V2ApplicationError("FORBIDDEN","The principal cannot send Invoice email.");
    const ids=[...new Set(input.invoiceIds.map((value)=>String(value).trim()).filter(Boolean))];if(!ids.length||ids.length>invoiceEmailSelectionLimit)throw new V2ApplicationError("VALIDATION_ERROR",`Select between 1 and ${invoiceEmailSelectionLimit} V2 Invoices.`);
    const client=await this.pool.connect();try{const rows=await this.resolve(client,input.organizationId,input.principal,ids);const recipients=new Set(rows.flatMap((row)=>row.email&&emailPattern.test(normalize(row.email))?[normalize(row.email)]:[]));const deliverable=rows.filter((row)=>row.email&&emailPattern.test(normalize(row.email))).length;return {selected:ids.length,deliverableInvoices:deliverable,recipientCount:recipients.size,skipped:ids.length-deliverable};}finally{client.release();}
  }

  /** External delivery cannot be exactly-once. An ambiguous message is held
   * until an operator intentionally requeues it after checking provider mail. */
  async retry(input:Readonly<{organizationId:string;principal:Principal;jobId:string}>):Promise<Readonly<{state:"queued";attemptCount:number}>>{
    if(input.principal.kind!=="staff"&&input.principal.kind!=="delegated_ai")throw new V2ApplicationError("FORBIDDEN","Only an authorized Invoice operator may retry customer email.");
    if(!this.authority.decide(input.principal,{capability:"invoice.send",resource:{organizationId:input.organizationId}}).allowed)throw new V2ApplicationError("FORBIDDEN","The principal cannot send Invoice email.");
    const result=await this.pool.query<{attempt_count:number}>("UPDATE v2_invoice_email_delivery_jobs SET state='queued',available_at=now(),claimed_by=NULL,lease_expires_at=NULL,completed_at=NULL,last_error=NULL,provider_attempted_at=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2 AND state IN ('failed','ambiguous') RETURNING attempt_count",[input.organizationId,input.jobId]);
    if(!result.rows[0])throw new V2ApplicationError("CONFLICT","This Invoice email is not eligible for intentional retry.");
    return {state:"queued",attemptCount:result.rows[0].attempt_count};
  }

  private async resolve(client:Pick<Pool,"query">,organizationId:string,principal:Principal,ids:readonly string[]):Promise<RecipientInvoice[]>{
    const candidates=await client.query<RecipientInvoice>(`SELECT i.id AS "invoiceId",i.customer_id AS "customerId",COALESCE(NULLIF(btrim(invoice_contact.email),''),NULLIF(btrim(billing_contact.email),''),NULLIF(btrim(primary_contact.email),''),NULLIF(btrim(c.email),'')) AS email FROM v2_billing_invoices i LEFT JOIN customers c ON c.organization_id=i.organization_id AND c.id=i.customer_id LEFT JOIN customer_contacts invoice_contact ON invoice_contact.organization_id=i.organization_id AND invoice_contact.id=i.contact_id AND invoice_contact.status='active' LEFT JOIN LATERAL (SELECT ct.email FROM customer_contact_links l JOIN customer_contacts ct ON ct.organization_id=l.organization_id AND ct.id=l.contact_id WHERE l.organization_id=i.organization_id AND l.customer_id=i.customer_id AND l.status='active' AND l.is_billing=true AND ct.status='active' ORDER BY l.updated_at DESC,l.id DESC LIMIT 1) billing_contact ON true LEFT JOIN LATERAL (SELECT ct.email FROM customer_contact_links l JOIN customer_contacts ct ON ct.organization_id=l.organization_id AND ct.id=l.contact_id WHERE l.organization_id=i.organization_id AND l.customer_id=i.customer_id AND l.status='active' AND l.is_primary=true AND ct.status='active' ORDER BY l.updated_at DESC,l.id DESC LIMIT 1) primary_contact ON true WHERE i.organization_id=$1 AND i.id=ANY($2::varchar[]) AND i.invoice_state <> 'void'`,[organizationId,ids]);
    return candidates.rows.filter((row)=>this.authority.decide(principal,{capability:"invoice.send",resource:{organizationId,customerId:row.customerId}}).allowed);
  }

  async claim(workerId:string,leaseSeconds:number,spacingMs:number):Promise<Job|null>{
    const client=await this.pool.connect();try{await client.query("BEGIN");const result=await client.query<{id:string;organization_id:string;recipient_email:string;attempt_count:number}>(`
      WITH uncertain AS (UPDATE v2_invoice_email_delivery_jobs SET state='ambiguous',last_error=COALESCE(last_error,'Provider outcome is uncertain after an interrupted delivery attempt. Verify delivery before intentional retry.'),claimed_by=NULL,lease_expires_at=NULL,completed_at=now(),updated_at=now() WHERE state='processing' AND lease_expires_at<=now() AND provider_attempted_at IS NOT NULL),
      candidate AS (SELECT id,organization_id FROM v2_invoice_email_delivery_jobs WHERE (state IN ('queued','retry_wait') AND available_at<=now()) OR (state='processing' AND lease_expires_at<=now() AND provider_attempted_at IS NULL) ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1),
      pace AS (INSERT INTO v2_invoice_email_delivery_rate_limits(organization_id,next_available_at) SELECT organization_id,now()+($2::text||' milliseconds')::interval FROM candidate ON CONFLICT(organization_id) DO UPDATE SET next_available_at=now()+($2::text||' milliseconds')::interval WHERE v2_invoice_email_delivery_rate_limits.next_available_at<=now() RETURNING organization_id)
      UPDATE v2_invoice_email_delivery_jobs j SET state='processing',claimed_by=$1,lease_expires_at=now()+($3::text||' seconds')::interval,attempt_count=j.attempt_count+1,updated_at=now() FROM candidate,pace WHERE j.id=candidate.id AND j.organization_id=pace.organization_id RETURNING j.id,j.organization_id,j.recipient_email,j.attempt_count`,[workerId,Math.max(0,spacingMs),leaseSeconds]);await client.query("COMMIT");const row=result.rows[0];return row?{id:row.id,organizationId:row.organization_id,recipient:row.recipient_email,attemptCount:row.attempt_count}:null;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}

  async process(job:Job,workerId:string,maxAttempts:number):Promise<InvoiceEmailState>{
    let providerAttempted=false;
    try{const integration=await this.email.requireReady(job.organizationId);const invoices=await this.invoices(job);if(!invoices.length)throw new V2ApplicationError("VALIDATION_ERROR","No deliverable Invoice remains in this email job.");await this.markProviderAttempt(job,workerId);providerAttempted=true;const providerMessageId=await this.deliver(integration,job.recipient,invoices);await this.finish(job,workerId,"sent",undefined,providerMessageId);await this.auditSent(job,providerMessageId);return "sent";}
    catch(error){const message=concise(error);const requested=providerAttempted?this.providerState(error):this.preProviderState(error);const state=requested==='retry_wait'&&job.attemptCount>=maxAttempts?'failed':requested;await this.finish(job,workerId,state,message);return state;}
  }
  private async invoices(job:Job):Promise<MailInvoice[]>{
    const rows=await this.pool.query<{invoice_id:string;display_number:string;currency:string;total_cents:string;paid:string;refunded:string}>(`SELECT item.invoice_id,COALESCE(i.invoice_display_number,d.display_number) display_number,i.currency,i.total_cents::text,COALESCE((SELECT sum(amount_cents) FROM v2_billing_payment_allocations p WHERE p.organization_id=i.organization_id AND p.invoice_id=i.id),0)::text paid,COALESCE((SELECT sum(amount_cents) FROM v2_billing_refunds r WHERE r.organization_id=i.organization_id AND r.invoice_id=i.id),0)::text refunded FROM v2_invoice_email_delivery_items item JOIN v2_billing_invoices i ON i.organization_id=item.organization_id AND i.id=item.invoice_id AND i.invoice_state<>'void' JOIN v2_sales_documents d ON d.organization_id=i.organization_id AND d.id=i.sales_order_document_id WHERE item.organization_id=$1 AND item.job_id=$2 ORDER BY item.created_at,item.invoice_id`,[job.organizationId,job.id]);
    if(!rows.rows.length) return [];
    return Promise.all(rows.rows.map(async(row)=>({invoiceId:row.invoice_id,number:row.display_number,currency:row.currency,totalCents:Number(row.total_cents),balanceCents:Number(row.total_cents)-Number(row.paid)+Number(row.refunded),pdf:await this.documents.pdf(job.organizationId as never,row.invoice_id as never),filename:await this.documents.filename(job.organizationId as never,row.invoice_id as never)})));
  }
  private async markProviderAttempt(job:Job,workerId:string):Promise<void>{
    const marked=await this.pool.query<{id:string}>("UPDATE v2_invoice_email_delivery_jobs SET provider_attempted_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2 AND state='processing' AND claimed_by=$3 AND provider_attempted_at IS NULL RETURNING id",[job.organizationId,job.id,workerId]);
    if(!marked.rows[0])throw new V2ApplicationError("CONFLICT","Invoice email delivery ownership changed before the provider attempt.");
  }
  private async deliver(integration:ReadyGmailIntegration,recipient:string,invoices:readonly MailInvoice[]):Promise<string>{
    const clientId=process.env.GOOGLE_CLIENT_ID,clientSecret=process.env.GOOGLE_CLIENT_SECRET;if(!clientId||!clientSecret)throw new V2ApplicationError("RETRYABLE_FAILURE","The platform Gmail delivery connection is unavailable.");
    const oauth=new google.auth.OAuth2(clientId,clientSecret);oauth.setCredentials({refresh_token:integration.refreshToken});const portal=customerPortalUrl(invoices.map((invoice)=>invoice.invoiceId));
    const summary=invoices.map((invoice)=>`<li><strong>${html(invoice.number)}</strong> · balance ${html(money(invoice.currency,invoice.balanceCents))}</li>`).join("");
    const single=invoices.length===1;const subject=single?`Invoice ${invoices[0]!.number} from ${integration.displayName}`:`${invoices.length} Invoices from ${integration.displayName}`;
    const label=single?"View & Pay Invoice":"View & Pay Invoices";
    const raw=rawMime({from:`\"${integration.displayName}\" <${integration.sendingAddress}>`,to:recipient,subject,html:`<p>Please find your ${single?"Invoice":"Invoices"} attached.</p><ul>${summary}</ul><p><a href="${html(portal)}">${label}</a></p><p>The customer portal requires normal sign-in and always displays current Invoice balances.</p>`,attachments:invoices.map((invoice)=>({filename:invoice.filename,content:invoice.pdf}))});
    const response=await google.gmail({version:"v1",auth:oauth}).users.messages.send({userId:"me",requestBody:{raw}},{timeout:invoiceEmailProviderTimeoutMs});if(!response.data.id)throw new Error("Provider did not return a message identity.");return response.data.id;
  }
  private providerState(error:unknown):InvoiceEmailState{const status=Number((error as {code?:unknown;response?:{status?:unknown}})?.code??(error as {response?:{status?:unknown}})?.response?.status);if(Number.isFinite(status)){if(status===429||status>=500)return "retry_wait";if(status>=400&&status<500)return "failed";}return "ambiguous";}
  private preProviderState(error:unknown):InvoiceEmailState{return error instanceof V2ApplicationError&&error.code==="VALIDATION_ERROR"?"failed":"retry_wait";}
  private async finish(job:Job,workerId:string,state:InvoiceEmailState,error?:string,providerMessageId?:string):Promise<void>{const backoff=Math.min(30*60_000,15_000*2**Math.min(Math.max(0,job.attemptCount-1),7));await this.pool.query("UPDATE v2_invoice_email_delivery_jobs SET state=$3::varchar,last_error=$4,provider_message_id=COALESCE($5,provider_message_id),sent_at=CASE WHEN $3::varchar='sent' THEN now() ELSE sent_at END,completed_at=CASE WHEN $3::varchar IN ('sent','failed','ambiguous') THEN now() ELSE NULL END,available_at=CASE WHEN $3::varchar='retry_wait' THEN now()+($6::text||' milliseconds')::interval ELSE available_at END,claimed_by=NULL,lease_expires_at=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2 AND state='processing' AND claimed_by=$7",[job.organizationId,job.id,state,error??null,providerMessageId??null,backoff,workerId]);}
  private async auditSent(job:Job,providerMessageId:string):Promise<void>{const items=await this.pool.query<{invoice_id:string}>("SELECT invoice_id FROM v2_invoice_email_delivery_items WHERE organization_id=$1 AND job_id=$2",[job.organizationId,job.id]);for(const item of items.rows)await this.pool.query("INSERT INTO v2_audit_events(organization_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,changes) VALUES($1,'billing.invoice.email.delivery.v1','invoice_email_sent','invoice',$2,'service','invoice-email-worker',$3::jsonb)",[job.organizationId,item.invoice_id,JSON.stringify([{jobId:job.id,recipient:job.recipient,providerMessageId}])]);}
}

export class V2InvoiceEmailDeliveryWorker {
  constructor(private readonly queue:PostgresInvoiceEmailDeliveryQueue,private readonly workerId=`v2-invoice-email:${process.env.RAILWAY_REPLICA_ID||hostname()}:${process.pid}:${randomUUID().slice(0,8)}`) {}
  async run(input:Readonly<{limit:number;leaseSeconds:number;spacingMs:number;maxAttempts:number}>):Promise<Readonly<Record<InvoiceEmailState|"claimed",number>>>{const result:Record<InvoiceEmailState|"claimed",number>={claimed:0,queued:0,processing:0,retry_wait:0,sent:0,failed:0,ambiguous:0};for(let i=0;i<Math.max(1,input.limit);i+=1){const job=await this.queue.claim(this.workerId,input.leaseSeconds,input.spacingMs);if(!job)break;result.claimed+=1;result[await this.queue.process(job,this.workerId,input.maxAttempts)]+=1;}return result;}
}
const number=(value:string|undefined,fallback:number,min:number,max:number)=>{const parsed=Number(value);return Number.isFinite(parsed)?Math.min(max,Math.max(min,Math.floor(parsed))):fallback;};
export const startV2InvoiceEmailDeliveryWorker=(pool:Pool,log:(event:string,data?:Record<string,unknown>)=>void):(()=>void)|null=>{
  if(process.env.V2_INVOICE_EMAIL_DELIVERY_ENABLED?.toLowerCase()==="false"){log("v2.invoice_email.worker.disabled",{reason:"disabled_by_configuration"});return null;}
  const worker=new V2InvoiceEmailDeliveryWorker(new PostgresInvoiceEmailDeliveryQueue(pool));const interval=number(process.env.V2_INVOICE_EMAIL_DELIVERY_INTERVAL_MS,20_000,1_000,300_000),limit=number(process.env.V2_INVOICE_EMAIL_DELIVERY_CONCURRENCY,1,1,4),leaseSeconds=number(process.env.V2_INVOICE_EMAIL_DELIVERY_LEASE_SECONDS,300,30,3600),spacingMs=number(process.env.V2_INVOICE_EMAIL_DELIVERY_MIN_SPACING_MS,2_000,0,60_000),maxAttempts=number(process.env.V2_INVOICE_EMAIL_DELIVERY_MAX_ATTEMPTS,5,1,20);let running=false;const tick=async()=>{if(running)return;running=true;try{const result=await worker.run({limit,leaseSeconds,spacingMs,maxAttempts});if(result.claimed)log("v2.invoice_email.worker.run",result);}catch(error){log("v2.invoice_email.worker.error",{message:concise(error)});}finally{running=false;}};const timer=setInterval(()=>void tick(),interval);timer.unref();void tick();log("v2.invoice_email.worker.started",{interval,limit,leaseSeconds,spacingMs,maxAttempts});return()=>clearInterval(timer);
};

const rawMime=(input:Readonly<{from:string;to:string;subject:string;html:string;attachments:readonly Readonly<{filename:string;content:Uint8Array}>[]}>):string=>{const boundary=`v2-invoice-${randomUUID()}`;const lines=[`From: ${input.from}`,`To: ${input.to}`,`Subject: ${input.subject}`,"MIME-Version: 1.0",`Content-Type: multipart/mixed; boundary=\"${boundary}\"`,"",`--${boundary}`,"Content-Type: text/html; charset=utf-8","Content-Transfer-Encoding: 8bit","",input.html];for(const attachment of input.attachments){const filename=attachment.filename.replaceAll("\"","").replaceAll("\\\\","");lines.push(`--${boundary}`,"Content-Type: application/pdf",`Content-Disposition: attachment; filename=\"${filename}\"`,"Content-Transfer-Encoding: base64","",Buffer.from(attachment.content).toString("base64"));}lines.push(`--${boundary}--`,"");return Buffer.from(lines.join("\r\n")).toString("base64url");};
