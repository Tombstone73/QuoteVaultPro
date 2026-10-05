import { createDecipheriv, createHash } from "node:crypto";
import type { Pool } from "pg";
import { matchQuickBooksPayment, quickBooksPaymentReconciliationRequired, type QuickBooksPaymentRead, type QuickBooksPaymentRecoveryContext } from "./quickBooksPaymentRecovery.js";
import { publicationMatches, type PublicationIntent, type ConfirmedPublication } from "./quickBooksProviderPublication.js";

export type QuickBooksPaymentConnection = Readonly<{ organizationId: string; realmId: string; environment: "sandbox" | "production" }>;
export interface QuickBooksPaymentReadPort {
  connection(organizationId: string): Promise<QuickBooksPaymentConnection>;
  payments(connection: QuickBooksPaymentConnection, reference: string, externalId?: string): Promise<QuickBooksPaymentRead>;
  assertCreationReferences?(connection: QuickBooksPaymentConnection, context: Omit<QuickBooksPaymentRecoveryContext,"reference">): Promise<void>;
  createPayment?(connection: QuickBooksPaymentConnection, context: QuickBooksPaymentRecoveryContext, occurredAt: string): Promise<{ qbPaymentId: string }>;
  publishEntity?(intent:PublicationIntent,attempted:boolean,beforeMutation:()=>Promise<void>,existingId?:string,prior?:PublicationIntent):Promise<ConfirmedPublication>;
}
type ConnectionRow = { id: string; company_id: string; access_token: string; token_expires_at: Date | null; metadata: { qbConnection?: { state?: string; authoritative?: boolean }; qbCredential?: { state?: string }; qbAuth?: { state?: string } } | null };

/** Scoped V2 accounting transport. Payment and its narrow Customer/Invoice
 * publication prerequisites; no OAuth refresh, credential writes or Refund mutations. */
export class PostgresQuickBooksPaymentReadTransport implements QuickBooksPaymentReadPort {
  constructor(private readonly pool: Pick<Pool, "query">, private readonly request: typeof fetch = fetch, private readonly environment = process.env) {}

  private async credentials(organizationId: string) {
    if (!organizationId.trim()) throw quickBooksPaymentReconciliationRequired("tenant context is missing");
    const result = await this.pool.query<ConnectionRow>("SELECT id,company_id,access_token,token_expires_at,metadata FROM oauth_connections WHERE organization_id=$1 AND provider='quickbooks' ORDER BY updated_at DESC,created_at DESC,id DESC", [organizationId]);
    const usable = result.rows.filter(row => !["disconnected", "superseded"].includes(row.metadata?.qbConnection?.state ?? row.metadata?.qbCredential?.state ?? ""));
    const authoritative = usable.filter(row => row.metadata?.qbConnection?.authoritative === true);
    const candidates = authoritative.length ? authoritative : usable;
    if (candidates.length !== 1) throw quickBooksPaymentReconciliationRequired("connection is missing or ambiguous");
    const row = candidates[0]!;
    if (!/^\d{1,64}$/.test(row.company_id) || [row.metadata?.qbAuth?.state,row.metadata?.qbCredential?.state].includes("needs_reauth") || !row.token_expires_at || !Number.isFinite(row.token_expires_at.getTime()) || row.token_expires_at.getTime() <= Date.now() + 30_000) throw quickBooksPaymentReconciliationRequired("connection requires operator reauthorization");
    const environment = this.environment.QUICKBOOKS_ENVIRONMENT === "production" ? "production" as const : "sandbox" as const;
    return { row, connection: { organizationId, realmId: row.company_id, environment } };
  }

  async connection(organizationId: string): Promise<QuickBooksPaymentConnection> { return (await this.credentials(organizationId)).connection; }

  private async send(connection: QuickBooksPaymentConnection, method: "GET" | "POST", endpoint: string, body?: unknown): Promise<Record<string, unknown>> {
    const current = await this.credentials(connection.organizationId);
    if (current.connection.realmId !== connection.realmId || current.connection.environment !== connection.environment) throw quickBooksPaymentReconciliationRequired("provider realm changed");
    let token = current.row.access_token;
    try {
      if (token.startsWith("qbtoken:v1:")) {
        const secret = (this.environment.QUICKBOOKS_TOKEN_ENCRYPTION_KEY || this.environment.QB_TOKEN_ENCRYPTION_KEY || "").trim();
        const parts = token.split(":");
        if (!secret || parts.length !== 6) throw new Error("Invalid credential envelope");
        const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), Buffer.from(parts[3]!, "base64url"));
        decipher.setAuthTag(Buffer.from(parts[4]!, "base64url"));
        token = Buffer.concat([decipher.update(Buffer.from(parts[5]!, "base64url")), decipher.final()]).toString("utf8");
      }
      if (!token) throw new Error("Missing credential");
    } catch { throw quickBooksPaymentReconciliationRequired("read credential is unavailable"); }
    const host = connection.environment === "production" ? "quickbooks.api.intuit.com" : "sandbox-quickbooks.api.intuit.com";
    try {
      // URL and credential come from the validated pinned realm, never a second
      // organization-only lookup inside a legacy write bridge. No HTTP replay.
      const response = await this.request(`https://${host}/v3/company/${connection.realmId}${endpoint}`, { method, redirect: "error", headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(method === "POST" ? { "Content-Type": "application/json" } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error("Provider response failed");
      const value: unknown = await response.json();
      if (!value || typeof value !== "object" || Array.isArray(value) || "Fault" in value) throw new Error("Provider response is malformed");
      return value as Record<string, unknown>;
    } catch { throw quickBooksPaymentReconciliationRequired(`provider ${method === "GET" ? "read" : "create"} outcome is unavailable`); }
  }

  async payments(connection: QuickBooksPaymentConnection, reference: string, externalId?: string): Promise<QuickBooksPaymentRead> {
    if (!/^PMT-[1-9]\d{0,16}$/.test(reference) || (externalId !== undefined && !/^\d{1,64}$/.test(externalId))) throw quickBooksPaymentReconciliationRequired("provider lookup identity is invalid");
    const query = `SELECT * FROM Payment WHERE PaymentRefNum = '${reference}' STARTPOSITION 1 MAXRESULTS 1000`;
    const body = await this.send(connection, "GET", externalId ? `/payment/${externalId}` : `/query?query=${encodeURIComponent(query)}`);
    if (externalId) {
      if (!body.Payment || typeof body.Payment !== "object" || Array.isArray(body.Payment)) throw quickBooksPaymentReconciliationRequired("external Payment read is incomplete");
      return { ...connection, complete: true, payments: [body.Payment] };
    }
    const value = body.QueryResponse;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw quickBooksPaymentReconciliationRequired("provider read outcome is unavailable");
    const page = value as Record<string, unknown>;
    const countPayments = async (): Promise<number> => {
      const counted = await this.send(connection, "GET", `/query?query=${encodeURIComponent(`SELECT COUNT(*) FROM Payment WHERE PaymentRefNum = '${reference}'`)}`);
      const aggregate = counted.QueryResponse;
      if (!aggregate || typeof aggregate !== "object" || Array.isArray(aggregate)) throw quickBooksPaymentReconciliationRequired("provider absence count is unavailable");
      const count = aggregate as Record<string, unknown>;
      if (!Number.isSafeInteger(count.totalCount) || Number(count.totalCount) < 0
        || Object.keys(count).some(key => !["totalCount","startPosition","maxResults"].includes(key))
        || (Object.hasOwn(count,"startPosition") && count.startPosition !== 1)
        || (Object.hasOwn(count,"maxResults") && count.maxResults !== 0)) throw quickBooksPaymentReconciliationRequired("provider absence count is malformed");
      return Number(count.totalCount);
    };
    if (Object.keys(page).length === 0) {
      // QBO may omit the entity collection for zero rows. Do not infer zero:
      // require an explicit filtered COUNT(*) result from the same pinned realm.
      return { ...connection, complete: await countPayments() === 0, payments: [] };
    }
    if (Object.keys(page).some(key => !["Payment","startPosition","maxResults","totalCount"].includes(key))) throw quickBooksPaymentReconciliationRequired("provider query entity provenance is unavailable");
    const hasPayments = Object.hasOwn(page, "Payment");
    if (hasPayments && !Array.isArray(page.Payment)) throw quickBooksPaymentReconciliationRequired("provider Payment collection is malformed");
    const payments = hasPayments ? page.Payment as unknown[] : [];
    const { startPosition, maxResults, totalCount } = page;
    if (!Number.isSafeInteger(startPosition) || Number(startPosition) < 1 || !Number.isSafeInteger(maxResults) || Number(maxResults) !== payments.length
      || (Object.hasOwn(page, "totalCount") && (!Number.isSafeInteger(totalCount) || Number(totalCount) < payments.length))) throw quickBooksPaymentReconciliationRequired("provider pagination provenance is unavailable");
    // An omitted collection alone (including QueryResponse:{}) proves nothing.
    // Absence requires explicit first-page zero counts; explicit null is never empty.
    const cardinality = totalCount === undefined && startPosition === 1 && payments.length < 1000 ? await countPayments() : totalCount;
    const complete = startPosition === 1 && payments.length < 1000 && cardinality === payments.length;
    return { ...connection, complete, payments };
  }

  async assertCreationReferences(connection: QuickBooksPaymentConnection, context: Omit<QuickBooksPaymentRecoveryContext,"reference">): Promise<void> {
    if (context.organizationId !== connection.organizationId || context.realmId !== connection.realmId || context.environment !== connection.environment
      || !context.paymentId || !context.customerId || !Array.isArray(context.allocations) || !context.allocations.length) throw quickBooksPaymentReconciliationRequired("Payment reference scope is invalid");
    const links = await this.pool.query<{entity_kind:"customer"|"invoice";entity_id:string;provider_id:string;provider_identity:unknown}>(`
      SELECT 'customer' entity_kind,i.customer_id entity_id,l.provider_id,l.projection_json->'providerIdentity' provider_identity
      FROM v2_billing_payment_allocations a
      JOIN v2_billing_invoices i ON i.organization_id=a.organization_id AND i.id=a.invoice_id
      JOIN v2_quickbooks_sync_links l ON l.organization_id=i.organization_id AND l.entity_kind='customer' AND l.entity_id=i.customer_id
      WHERE a.organization_id=$1 AND a.payment_id=$2 AND i.invoice_state<>'void'
      UNION
      SELECT 'invoice' entity_kind,i.id entity_id,l.provider_id,l.projection_json->'providerIdentity' provider_identity
      FROM v2_billing_payment_allocations a
      JOIN v2_billing_invoices i ON i.organization_id=a.organization_id AND i.id=a.invoice_id
      JOIN v2_quickbooks_sync_links l ON l.organization_id=i.organization_id AND l.entity_kind='invoice' AND l.entity_id=i.id AND l.projection_version=i.synchronization_version
      WHERE a.organization_id=$1 AND a.payment_id=$2 AND i.invoice_state<>'void'`,[context.organizationId,context.paymentId]);
    const expectedIds = new Set([`customer:${context.customerId}`,...context.allocations.map(allocation=>`invoice:${allocation.invoiceId}`)]);
    if (links.rows.length !== expectedIds.size) throw quickBooksPaymentReconciliationRequired("Customer and Invoice reference bindings are unavailable");
    for (const row of links.rows) {
      const key = `${row.entity_kind}:${row.provider_id}`;
      const value = row.provider_identity;
      if (!expectedIds.delete(key) || !value || typeof value !== "object" || Array.isArray(value)) throw quickBooksPaymentReconciliationRequired("Customer or Invoice reference has no trusted realm/identity binding");
      const identity = value as Record<string,unknown>;
      if (identity.organizationId !== context.organizationId || identity.entityKind !== row.entity_kind || identity.entityId !== row.entity_id
        || identity.providerId !== row.provider_id || identity.realmId !== context.realmId || identity.environment !== context.environment) throw quickBooksPaymentReconciliationRequired("Customer or Invoice reference belongs to a different realm or canonical identity");
    }
    if (expectedIds.size) throw quickBooksPaymentReconciliationRequired("Customer or Invoice reference identity is incomplete");
    // Current link numbers, CRM names and commercial amounts cannot establish
    // historical realm provenance. This reader never stamps or repairs bindings.
  }

  async createPayment(connection: QuickBooksPaymentConnection, context: QuickBooksPaymentRecoveryContext, occurredAt: string): Promise<{ qbPaymentId: string }> {
    if (!Number.isFinite(Date.parse(occurredAt)) || matchQuickBooksPayment(context, { ...connection, complete: true, payments: [] }).state !== "missing") throw quickBooksPaymentReconciliationRequired("Payment creation identity is invalid");
    await this.assertCreationReferences(connection,context);
    if (context.jobId.length > 50) throw quickBooksPaymentReconciliationRequired("provider request identity exceeds the QBO request-id limit");
    const payload = {
      CustomerRef: { value: context.customerId }, TotalAmt: context.amountCents / 100, CurrencyRef: { value: context.currency },
      TxnDate: occurredAt.slice(0, 10), PaymentRefNum: context.reference, PrivateNote: `PrintersHero V2 payment ${context.paymentId}`,
      Line: context.allocations.map(allocation => ({ Amount: allocation.amountCents / 100, LinkedTxn: [{ TxnId: allocation.invoiceId, TxnType: "Invoice" }] })),
    };
    // Decimal serialization must preserve exact canonical cents before POST.
    if (matchQuickBooksPayment(context,{...connection,complete:true,payments:[{...payload,Id:"prospective",UnappliedAmt:0}]}).state !== "matched") throw quickBooksPaymentReconciliationRequired("Payment amounts cannot be represented exactly by the provider payload");
    const body = await this.send(connection, "POST", `/payment?requestid=${encodeURIComponent(context.jobId)}`, payload);
    const id = body.Payment && typeof body.Payment === "object" && !Array.isArray(body.Payment) ? (body.Payment as Record<string, unknown>).Id : undefined;
    if (typeof id !== "string" || !/^\d{1,64}$/.test(id)) throw quickBooksPaymentReconciliationRequired("Payment creation identity was not confirmed");
    return { qbPaymentId: id };
  }

  private async publicationCandidates(intent:PublicationIntent):Promise<unknown[]> {
    const entity=intent.entityKind==="customer"?"Customer":"Invoice",field=entity==="Customer"?"DisplayName":"DocNumber";
    const value=String(intent.payload[field]??"").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
    const predicate=`${field} = '${value}'`;
    const body=await this.send(intent.connection,"GET",`/query?query=${encodeURIComponent(`SELECT * FROM ${entity} WHERE ${predicate} STARTPOSITION 1 MAXRESULTS 1000`)}`);
    const page=body.QueryResponse as Record<string,unknown>|undefined;
    if(!page||typeof page!=="object"||Array.isArray(page)||Object.keys(page).some(key=>![entity,"startPosition","maxResults","totalCount"].includes(key))||(Object.hasOwn(page,entity)&&!Array.isArray(page[entity])))throw quickBooksPaymentReconciliationRequired("publication candidate response is malformed");
    const rows=Array.isArray(page[entity])?page[entity] as unknown[]:[];
    if(Object.keys(page).length && (page.startPosition!==1||page.maxResults!==rows.length||rows.length>=1000))throw quickBooksPaymentReconciliationRequired("publication candidates are partial");
    let count=page.totalCount;
    if(count===undefined){const counted=await this.send(intent.connection,"GET",`/query?query=${encodeURIComponent(`SELECT COUNT(*) FROM ${entity} WHERE ${predicate}`)}`);const aggregate=counted.QueryResponse as Record<string,unknown>|undefined;if(!aggregate||typeof aggregate!=="object"||Array.isArray(aggregate)||Object.keys(aggregate).some(key=>!["totalCount","startPosition","maxResults"].includes(key))||(Object.hasOwn(aggregate,"startPosition")&&aggregate.startPosition!==1)||(Object.hasOwn(aggregate,"maxResults")&&aggregate.maxResults!==0))throw quickBooksPaymentReconciliationRequired("publication count is unavailable");count=aggregate.totalCount;}
    if(!Number.isSafeInteger(count)||count!==rows.length)throw quickBooksPaymentReconciliationRequired("publication candidate count is inconsistent");
    return rows;
  }

  async publishEntity(intent:PublicationIntent,attempted:boolean,beforeMutation:()=>Promise<void>,existingId?:string,prior?:PublicationIntent):Promise<ConfirmedPublication> {
    const entity=intent.entityKind==="customer"?"Customer":"Invoice",path=entity.toLowerCase();
    const read=async()=>{
      if(existingId){if(!/^\d{1,64}$/.test(existingId))throw quickBooksPaymentReconciliationRequired("publication provider ID is invalid");const body=await this.send(intent.connection,"GET",`/${path}/${existingId}`);const value=body[entity] as Record<string,unknown>|undefined;if(!value||value.Id!==existingId)throw quickBooksPaymentReconciliationRequired("publication ID read is unavailable");return [value];}
      return this.publicationCandidates(intent);
    };
    const confirmed=(value:unknown):ConfirmedPublication=>({providerIdentity:{...intent.connection,entityKind:intent.entityKind,entityId:intent.entityId,providerId:String((value as Record<string,unknown>).Id)},providerRequestId:intent.requestId});
    let rows=await read();
    if(rows.length>1)throw quickBooksPaymentReconciliationRequired("ambiguous canonical publication candidates");
    if(rows.length===1&&publicationMatches(intent,rows[0],intent.entityKind==="customer"&&Boolean(existingId)))return confirmed(rows[0]);
    if(attempted)throw quickBooksPaymentReconciliationRequired("the original publication attempt is unresolved; no mutation replay");
    let payload=intent.payload;
    if(rows.length){
      if(intent.entityKind!=="invoice"||!existingId||!prior||!publicationMatches(prior,rows[0]))throw quickBooksPaymentReconciliationRequired("existing provider entity lacks the exact canonical request identity");
      const token=(rows[0] as Record<string,unknown>).SyncToken;
      if(typeof token!=="string"||!/^\d+$/.test(token))throw quickBooksPaymentReconciliationRequired("Invoice concurrency token is unavailable");
      payload={...payload,Id:existingId,SyncToken:token};
    }else if(existingId)throw quickBooksPaymentReconciliationRequired("bound provider entity is missing");
    await beforeMutation();
    let returnedId:string|undefined;
    try{const body=await this.send(intent.connection,"POST",`/${path}?requestid=${encodeURIComponent(intent.requestId)}`,payload);const value=body[entity] as Record<string,unknown>|undefined;if(typeof value?.Id==="string")returnedId=value.Id;}catch{ /* Reconcile only; never repeat POST. */ }
    rows=await read();
    if(rows.length!==1||!publicationMatches(intent,rows[0])||(returnedId!==undefined&&(rows[0] as Record<string,unknown>).Id!==returnedId))throw quickBooksPaymentReconciliationRequired("publication outcome is not uniquely confirmed");
    return confirmed(rows[0]);
  }
}
