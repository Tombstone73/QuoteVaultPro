import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { assertStripeServerConfig, getStripeClient, stripeRuntimeReadiness } from "../../../server/lib/stripe.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { Principal } from "../../src/authorization/principals.js";

export type StripeConnectState = "not_connected" | "onboarding" | "requirements_due" | "ready" | "reconnect_required" | "disconnected" | "error";
export type StripeConnectReadiness = Readonly<{
  mode: "test" | "live" | "unknown";
  status: StripeConnectState | "platform_not_ready";
  connected: boolean;
  connectedAccountName: string | null;
  cardPayments: "active" | "pending" | "inactive" | "unknown";
  payouts: "active" | "pending" | "inactive" | "unknown";
  requirementsDue: number;
  actionRequired: string | null;
  connectionModel: "accounts_v2_direct";
}>;
export type StripeConnectedAccountContext = Readonly<{ accountId: string; mode: "test" | "live" }>;
type Row = Readonly<{ stripe_account_id:string|null; mode:"test"|"live"|"unknown"; state:StripeConnectState; account_display_name:string|null; card_payments_status:string|null; payouts_status:string|null; requirements_due_count:number }>;
const safe = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const mode = (): "test" | "live" | "unknown" => assertStripeServerConfig().mode;
const publicState = (row: Row | undefined, platformReady: boolean): StripeConnectReadiness => {
  if (!platformReady) return { mode: mode(), status:"platform_not_ready", connected:false, connectedAccountName:null, cardPayments:"unknown", payouts:"unknown", requirementsDue:0, connectionModel:"accounts_v2_direct", actionRequired:"Platform Stripe credentials are not ready." };
  if (!row || !row.stripe_account_id || row.state === "not_connected" || row.state === "disconnected") return { mode:mode(), status:"not_connected", connected:false, connectedAccountName:null, cardPayments:"unknown", payouts:"unknown", requirementsDue:0, connectionModel:"accounts_v2_direct", actionRequired:"Connect this print shop’s Stripe account to accept card payments." };
  const card = row.card_payments_status === "active" ? "active" : row.card_payments_status ? "pending" : "unknown";
  const payouts = row.payouts_status === "active" ? "active" : row.payouts_status ? "pending" : "unknown";
  const ready = row.state === "ready" && card === "active";
  return { mode:row.mode, status: ready ? "ready" : row.state, connected:true, connectedAccountName:row.account_display_name, cardPayments:card, payouts, requirementsDue:row.requirements_due_count, connectionModel:"accounts_v2_direct", actionRequired:ready ? null : row.state === "reconnect_required" ? "Reconnect this print shop’s Stripe account." : "Complete Stripe onboarding before accepting card payments." };
};

/** Tenant-owned Stripe Accounts v2 connection and direct-charge authority.
 * The platform credential only creates/retrieves accounts; it never becomes
 * the merchant identity for a tenant sale. */
export class PostgresStripeConnectAccounts {
  constructor(private readonly pool: Pool, private readonly publicWebOrigin?: string) {}
  private async row(organizationId: string): Promise<Row | undefined> { return (await this.pool.query<Row>("SELECT stripe_account_id,mode,state,account_display_name,card_payments_status,payouts_status,requirements_due_count FROM v2_stripe_connect_accounts WHERE organization_id=$1",[organizationId])).rows[0]; }
  async readiness(organizationId: string): Promise<StripeConnectReadiness> { return publicState(await this.row(organizationId), stripeRuntimeReadiness().status === "ready"); }
  async requireReadyAccount(organizationId: string): Promise<StripeConnectedAccountContext> {
    const ready = await this.readiness(organizationId); const row=await this.row(organizationId);
    if (ready.status !== "ready" || !row?.stripe_account_id || (row.mode !== "test" && row.mode !== "live")) throw new V2ApplicationError("CONFLICT", ready.actionRequired ?? "Stripe merchant onboarding is required.");
    return { accountId: row.stripe_account_id, mode: row.mode };
  }
  async assertOperationAccount(organizationId: string, operationId: string, accountId: string): Promise<void> {
    const found=await this.pool.query<{stripe_account_id:string|null}>("SELECT stripe_account_id FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND id=$2",[organizationId,operationId]);
    if (!found.rows[0]?.stripe_account_id || found.rows[0].stripe_account_id !== accountId) throw new V2ApplicationError("FORBIDDEN", "Stripe event account does not match this tenant’s payment operation.");
  }
  async beginOnboarding(organizationId: string, principal: Principal): Promise<Readonly<{ onboardingUrl:string }>> {
    const origin=this.publicWebOrigin?.replace(/\/$/u,""); if (!origin) throw new V2ApplicationError("RETRYABLE_FAILURE","Stripe onboarding return URL is unavailable.");
    if (stripeRuntimeReadiness().status !== "ready") throw new V2ApplicationError("CONFLICT","Platform Stripe configuration is not ready.");
    const company=await this.pool.query<{name:string;email:string|null}>("SELECT COALESCE(NULLIF(btrim(cs.company_display_name),''),NULLIF(btrim(cs.company_name),''),o.name) name,cs.email FROM organizations o LEFT JOIN company_settings cs ON cs.organization_id=o.id WHERE o.id=$1",[organizationId]);
    const identity=company.rows[0]; if (!identity?.email || !safe(identity.email)) throw new V2ApplicationError("CONFLICT","Add this organization’s company email before connecting Stripe.");
    const prior=await this.row(organizationId); const stripe:any=getStripeClient();
    let accountId=prior?.stripe_account_id ?? null;
    if (!accountId) {
      try {
        // A DB interruption after Stripe accepts creation must return the same
        // provider account on retry rather than orphan another merchant.
        const account=await stripe.v2.core.accounts.create({ contact_email:identity.email, display_name:identity.name, dashboard:"full", defaults:{responsibilities:{fees_collector:"stripe",losses_collector:"stripe"}}, configuration:{merchant:{capabilities:{card_payments:{requested:true}}}}, metadata:{v2OrganizationId:organizationId} },{idempotencyKey:`v2:stripe-connect-account:${organizationId}`});
        accountId=String(account.id);
      } catch (cause) { throw this.providerFailure("account_creation",cause); }
    }
    // Persist before issuing the short-lived Account Link. A retry after link
    // failure then resumes this exact tenant account rather than creating one.
    await this.pool.query(`INSERT INTO v2_stripe_connect_accounts(organization_id,stripe_account_id,mode,state,account_display_name,connected_at,updated_at) VALUES($1,$2,$3,'onboarding',$4,now(),now()) ON CONFLICT(organization_id) DO UPDATE SET stripe_account_id=EXCLUDED.stripe_account_id,mode=EXCLUDED.mode,state='onboarding',account_display_name=EXCLUDED.account_display_name,disconnected_at=NULL,updated_at=now()`,[organizationId,accountId,mode(),identity.name]);
    let link:any;
    try { link=await stripe.v2.core.accountLinks.create({account:accountId,use_case:{type:"account_onboarding",account_onboarding:{configurations:["merchant"],collection_options:{fields:"eventually_due",future_requirements:"include"},refresh_url:`${origin}/settings?stripe=refresh`,return_url:`${origin}/settings?stripe=returned`}}}); }
    catch (cause) { throw this.providerFailure("account_link",cause); }
    await this.audit(organizationId,accountId,"onboarding_started",principal); return { onboardingUrl:String(link.url) };
  }
  async refresh(organizationId: string): Promise<StripeConnectReadiness> {
    const row=await this.row(organizationId); if (!row?.stripe_account_id) return this.readiness(organizationId);
    try { const account:any=await (getStripeClient() as any).v2.core.accounts.retrieve(row.stripe_account_id); const merchant=account.configuration?.merchant ?? {}; const card=safe(merchant.capabilities?.card_payments?.status) ?? "inactive"; const payouts=safe(merchant.capabilities?.stripe_balance?.payouts?.status) ?? "inactive"; const due=[...(merchant.requirements?.currently_due ?? []),...(merchant.requirements?.eventually_due ?? [])].length; const state:StripeConnectState=card==="active"?"ready":due?"requirements_due":"onboarding"; await this.pool.query("UPDATE v2_stripe_connect_accounts SET state=$2,card_payments_status=$3,payouts_status=$4,requirements_due_count=$5,updated_at=now() WHERE organization_id=$1",[organizationId,state,card,payouts,due]); } catch { await this.pool.query("UPDATE v2_stripe_connect_accounts SET state='reconnect_required',updated_at=now() WHERE organization_id=$1",[organizationId]); }
    return this.readiness(organizationId);
  }
  async disconnect(organizationId: string, principal: Principal): Promise<StripeConnectReadiness> { const row=await this.row(organizationId); await this.pool.query("UPDATE v2_stripe_connect_accounts SET state='disconnected',disconnected_at=now(),updated_at=now() WHERE organization_id=$1",[organizationId]); await this.audit(organizationId,row?.stripe_account_id??null,"disconnected",principal); return this.readiness(organizationId); }
  private async audit(organizationId:string, accountId:string|null, event:string, principal:Principal) { await this.pool.query("INSERT INTO v2_stripe_connect_audit_events(id,organization_id,stripe_account_id,event_type,principal_kind,principal_subject) VALUES($1,$2,$3,$4,$5,$6)",[randomUUID(),organizationId,accountId,event,principal.kind,principal.kind === "staff" ? principal.userId : principal.kind]); }
  private providerFailure(stage:"account_creation"|"account_link", cause:unknown): V2ApplicationError {
    const provider=cause as { code?:unknown; type?:unknown; requestId?:unknown };
    // Safe operational telemetry: no token, payload, or customer data enters logs.
    console.error("v2.stripe_connect.provider_failure",{stage,code:typeof provider.code==="string"?provider.code:undefined,type:typeof provider.type==="string"?provider.type:undefined,requestId:typeof provider.requestId==="string"?provider.requestId:undefined});
    return new V2ApplicationError("RETRYABLE_FAILURE",stage==="account_creation"?"Stripe could not create this shop’s connected account. Retry Connect Stripe or contact support.":"Stripe account was created, but its onboarding link could not be opened. Retry Connect Stripe.");
  }
}
