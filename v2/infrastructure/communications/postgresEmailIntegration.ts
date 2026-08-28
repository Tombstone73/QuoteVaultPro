import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { google } from "googleapis";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { Principal } from "../../src/authorization/principals.js";
import { principalSubject, staffActorId } from "../../src/authorization/principals.js";
import { decryptEmailCredential, emailCredentialEncryptionConfigured, encryptEmailCredential } from "./emailCredentialCrypto.js";

export type EmailReadinessState = "not_configured" | "ready" | "reauth_required" | "error";
export type EmailReadiness = Readonly<{ provider: "gmail"; status: EmailReadinessState; sendingAddress?: string; displayName?: string; lastValidatedAt?: string; actionRequired?: string; legacyAvailable?: boolean }>;
export type ReadyGmailIntegration = Readonly<{ provider: "gmail"; sendingAddress: string; displayName: string; refreshToken: string }>;
type Canonical = { provider:"gmail"; readiness_state:EmailReadinessState; sending_address:string|null; display_name:string|null; encrypted_refresh_token:string|null; last_validated_at:Date|null; last_error_code:string|null };
type Legacy = { provider:string; from_address:string|null; from_name:string|null; refresh_token:string|null; connection_status:string|null };
type OAuthState = { id:string; organization_id:string; principal_subject:string; session_hash:string; state_hash:string; expires_at:Date; consumed_at:Date|null };
const hash = (value:string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const validAddress = (value:string|null|undefined): value is string => Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value));
const secret = () => process.env.SESSION_SECRET?.trim() || "";
const redirectUri = () => process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || `${(process.env.APP_PUBLIC_WEB_ORIGIN?.trim() || process.env.APP_URL?.trim() || "").replace(/\/$/u, "")}/api/email/google/callback`;
const platformReady = () => Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim() && redirectUri().startsWith("http"));
const statePayload = (value: Record<string,string>) => Buffer.from(JSON.stringify(value)).toString("base64url");
const signed = (payload:string) => `${payload}.${createHmac("sha256", secret()).update(payload).digest("base64url")}`;
const parseState = (value:string) => {
  const [payload, signature] = value.split(".");
  if (!payload || !signature || !secret()) return null;
  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
  if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  try { const parsed=JSON.parse(Buffer.from(payload,"base64url").toString("utf8")); return parsed && typeof parsed.id === "string" && typeof parsed.organizationId === "string" && typeof parsed.principalSubject === "string" && typeof parsed.sessionHash === "string" && typeof parsed.nonce === "string" && typeof parsed.at === "string" ? parsed as Record<string,string> : null; } catch { return null; }
};

/** Canonical V2 owner for tenant sending authorization.  It reads no token from
 * the legacy row after explicit adoption and never projects credentials. */
export class PostgresEmailIntegrationService {
  constructor(private readonly pool: Pool) {}
  private project(row: Canonical | undefined): EmailReadiness {
    if (!row) return { provider:"gmail", status:"not_configured", actionRequired:"Connect a Gmail sending account." };
    const actionRequired = row.readiness_state === "reauth_required" ? "Reconnect the Gmail sending account." : row.readiness_state === "error" ? "Email integration needs attention." : undefined;
    return { provider:"gmail", status:row.readiness_state, ...(validAddress(row.sending_address)?{sendingAddress:row.sending_address}:{}), ...(row.display_name?.trim()?{displayName:row.display_name.trim()}:{}), ...(row.last_validated_at?{lastValidatedAt:row.last_validated_at.toISOString()}:{}), ...(actionRequired?{actionRequired}:{}) };
  }
  async readiness(organizationId:string): Promise<EmailReadiness> {
    const row=(await this.pool.query<Canonical>("SELECT provider,readiness_state,sending_address,display_name,encrypted_refresh_token,last_validated_at,last_error_code FROM v2_email_integrations WHERE organization_id=$1",[organizationId])).rows[0];
    if (row) return this.project(row);
    const legacy=(await this.pool.query<Legacy>("SELECT provider,from_address,from_name,refresh_token,connection_status FROM email_settings WHERE organization_id=$1 AND is_active=true AND is_default=true ORDER BY updated_at DESC NULLS LAST,id DESC LIMIT 1",[organizationId])).rows[0];
    if (legacy?.provider === "gmail" && legacy.connection_status === "connected" && validAddress(legacy.from_address) && legacy.refresh_token)
      return { provider:"gmail",status:"not_configured",sendingAddress:legacy.from_address,...(legacy.from_name?.trim()?{displayName:legacy.from_name.trim()}:{}),legacyAvailable:true,actionRequired:"Adopt the existing Gmail connection into V2." };
    return this.project(undefined);
  }
  async requireReady(organizationId:string): Promise<ReadyGmailIntegration> {
    const row=(await this.pool.query<Canonical>("SELECT provider,readiness_state,sending_address,display_name,encrypted_refresh_token,last_validated_at,last_error_code FROM v2_email_integrations WHERE organization_id=$1",[organizationId])).rows[0];
    if (!row || row.readiness_state === "not_configured") throw new V2ApplicationError("VALIDATION_ERROR","Email sending is not configured for this organization.");
    if (row.readiness_state === "reauth_required") throw new V2ApplicationError("VALIDATION_ERROR","The organization Gmail connection requires reconnecting.");
    if (row.readiness_state !== "ready" || !validAddress(row.sending_address) || !row.encrypted_refresh_token) throw new V2ApplicationError("RETRYABLE_FAILURE","The organization email provider is not ready.");
    if (!platformReady()) throw new V2ApplicationError("RETRYABLE_FAILURE","The platform Gmail delivery connection is unavailable.");
    try { return { provider:"gmail",sendingAddress:row.sending_address,displayName:row.display_name?.trim() || row.sending_address,refreshToken:decryptEmailCredential(row.encrypted_refresh_token) }; }
    catch { await this.markReauth(organizationId,"credential_unavailable"); throw new V2ApplicationError("VALIDATION_ERROR","The organization Gmail connection requires reconnecting."); }
  }
  /** Communications-owned provider operation for the existing organization
   * invitation token flow. It accepts only already-authorized recipient/link
   * facts and never returns credential material. */
  async sendStaffInvitation(organizationId:string, recipient:string, invitationUrl:string): Promise<string> {
    const integration=await this.requireReady(organizationId);
    const clientId=process.env.GOOGLE_CLIENT_ID,clientSecret=process.env.GOOGLE_CLIENT_SECRET;
    if(!clientId||!clientSecret)throw new V2ApplicationError("RETRYABLE_FAILURE","The platform Gmail delivery connection is unavailable.");
    const oauth=new google.auth.OAuth2(clientId,clientSecret);oauth.setCredentials({refresh_token:integration.refreshToken});
    const raw=Buffer.from([`From: \"${integration.displayName}\" <${integration.sendingAddress}>`,`To: ${recipient}`,"Subject: You are invited to PrintersHero","MIME-Version: 1.0","Content-Type: text/plain; charset=utf-8","",`You have been invited to PrintersHero. Accept your invitation: ${invitationUrl}`].join("\r\n")).toString("base64url");
    const response=await google.gmail({version:"v1",auth:oauth}).users.messages.send({userId:"me",requestBody:{raw}});
    if(!response.data.id)throw new V2ApplicationError("RETRYABLE_FAILURE","The email provider did not confirm invitation delivery.");
    return response.data.id;
  }
  async adoptLegacy(organizationId:string, principal:Principal): Promise<EmailReadiness> {
    if (!emailCredentialEncryptionConfigured()) throw new V2ApplicationError("RETRYABLE_FAILURE","Provider credential encryption is unavailable.");
    const client=await this.pool.connect(); try { await client.query("BEGIN");
      const existing=(await client.query<Canonical>("SELECT provider,readiness_state,sending_address,display_name,encrypted_refresh_token,last_validated_at,last_error_code FROM v2_email_integrations WHERE organization_id=$1 FOR UPDATE",[organizationId])).rows[0];
      if (existing) { await client.query("COMMIT"); return this.project(existing); }
      const legacy=(await client.query<Legacy>("SELECT provider,from_address,from_name,refresh_token,connection_status FROM email_settings WHERE organization_id=$1 AND is_active=true AND is_default=true ORDER BY updated_at DESC NULLS LAST,id DESC LIMIT 1 FOR UPDATE",[organizationId])).rows[0];
      if (!legacy || legacy.provider!=="gmail" || legacy.connection_status!=="connected" || !legacy.refresh_token || !validAddress(legacy.from_address)) throw new V2ApplicationError("NOT_FOUND","No connected legacy Gmail integration is available to adopt.");
      // Legacy token presence alone is not V2 readiness. Validate the token
      // with the platform-owned OAuth client before cutover; a failure rolls
      // back and leaves the old record entirely intact for recovery.
      const sender = await this.validateRefreshToken(legacy.refresh_token);
      const credential=encryptEmailCredential(legacy.refresh_token);
      await client.query("INSERT INTO v2_email_integrations(organization_id,provider,readiness_state,sending_address,display_name,encrypted_refresh_token,encryption_key_id,last_validated_at,legacy_adopted_at,connected_at) VALUES($1,'gmail','ready',$2,$3,$4,$5,now(),now(),now())",[organizationId,sender,legacy.from_name?.trim()||sender,credential.encrypted,credential.keyId]);
      // The only plaintext source is cleared after the canonical encrypted row
      // has been inserted in the same transaction.  The legacy row remains as
      // credential-free compatibility history, never a second live authority.
      await client.query("UPDATE email_settings SET refresh_token=NULL,is_active=false,connection_status='migrated_to_v2',updated_at=now() WHERE organization_id=$1 AND is_active=true AND is_default=true",[organizationId]);
      await this.audit(client,organizationId,"legacy_adopted",principal,sender,{source:"email_settings"}); await client.query("COMMIT");
      return {provider:"gmail",status:"ready",sendingAddress:sender,displayName:legacy.from_name?.trim()||sender,lastValidatedAt:new Date().toISOString()};
    } catch (cause) { await client.query("ROLLBACK"); throw cause; } finally { client.release(); }
  }
  async beginConnect(organizationId:string, principal:Principal, sessionId:string): Promise<{authorizeUrl:string}> {
    if (!platformReady() || !secret()) throw new V2ApplicationError("RETRYABLE_FAILURE","The platform Gmail connection is unavailable.");
    const id=randomBytes(18).toString("base64url"), nonce=randomBytes(24).toString("base64url"), sessionHash=hash(sessionId), at=String(Date.now());
    const state=signed(statePayload({id,organizationId,principalSubject:principalSubject(principal),sessionHash,nonce,at}));
    await this.pool.query("INSERT INTO v2_email_oauth_states(id,organization_id,principal_subject,session_hash,state_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '30 minutes')",[id,organizationId,principalSubject(principal),sessionHash,hash(state)]);
    const oauth=new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID,process.env.GOOGLE_CLIENT_SECRET,redirectUri());
    return {authorizeUrl:oauth.generateAuthUrl({access_type:"offline",prompt:"consent",scope:["https://www.googleapis.com/auth/gmail.send","https://www.googleapis.com/auth/userinfo.email"],state})};
  }
  async finishConnect(input:Readonly<{state:string;code:string; principal:Principal; sessionId:string}>): Promise<EmailReadiness> {
    const parsed=parseState(input.state); if (!parsed || Date.now()-Number(parsed.at)>30*60*1000 || Date.now()<Number(parsed.at)) throw new V2ApplicationError("FORBIDDEN","Email connection state is invalid or expired.");
    if (parsed.principalSubject!==principalSubject(input.principal) || parsed.sessionHash!==hash(input.sessionId)) throw new V2ApplicationError("FORBIDDEN","Email connection state does not belong to this session.");
    const client=await this.pool.connect(); let organizationId=""; try { await client.query("BEGIN"); const state=(await client.query<OAuthState>("SELECT id,organization_id,principal_subject,session_hash,state_hash,expires_at,consumed_at FROM v2_email_oauth_states WHERE id=$1 FOR UPDATE",[parsed.id])).rows[0];
      if(!state || state.consumed_at || state.organization_id!==parsed.organizationId || state.principal_subject!==principalSubject(input.principal) || state.session_hash!==hash(input.sessionId) || state.state_hash!==hash(input.state) || state.expires_at.getTime()<Date.now()) throw new V2ApplicationError("FORBIDDEN","Email connection state is invalid or expired.");
      await client.query("UPDATE v2_email_oauth_states SET consumed_at=now() WHERE id=$1",[state.id]); organizationId=state.organization_id; await client.query("COMMIT");
    } catch(cause) { await client.query("ROLLBACK"); throw cause; } finally { client.release(); }
    try { const oauth=new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID,process.env.GOOGLE_CLIENT_SECRET,redirectUri()); const token=(await oauth.getToken(input.code)).tokens; if(!token.refresh_token) throw new Error("missing_refresh_token"); oauth.setCredentials(token); const profile=await google.oauth2({version:"v2",auth:oauth}).userinfo.get(); if(!validAddress(profile.data.email)) throw new Error("missing_sender_address"); const encrypted=encryptEmailCredential(token.refresh_token);
      const c=await this.pool.connect(); try { await c.query("BEGIN"); const prior=(await c.query<{connected_at:Date|null}>("SELECT connected_at FROM v2_email_integrations WHERE organization_id=$1 FOR UPDATE",[organizationId])).rows[0]; await c.query("INSERT INTO v2_email_integrations(organization_id,provider,readiness_state,sending_address,display_name,encrypted_refresh_token,encryption_key_id,last_validated_at,connected_at,disconnected_at,last_error_code,updated_at) VALUES($1,'gmail','ready',$2,$3,$4,$5,now(),now(),NULL,NULL,now()) ON CONFLICT(organization_id) DO UPDATE SET readiness_state='ready',sending_address=EXCLUDED.sending_address,display_name=EXCLUDED.display_name,encrypted_refresh_token=EXCLUDED.encrypted_refresh_token,encryption_key_id=EXCLUDED.encryption_key_id,last_validated_at=now(),connected_at=now(),disconnected_at=NULL,last_error_code=NULL,updated_at=now()",[organizationId,profile.data.email,profile.data.email,encrypted.encrypted,encrypted.keyId]); await c.query("UPDATE email_settings SET refresh_token=NULL,is_active=false,connection_status='migrated_to_v2',updated_at=now() WHERE organization_id=$1 AND refresh_token IS NOT NULL",[organizationId]); await this.audit(c,organizationId,prior?.connected_at?"reconnected":"connected",input.principal,profile.data.email,{}); await c.query("COMMIT"); } catch(cause) { await c.query("ROLLBACK"); throw cause; } finally { c.release(); }
      return {provider:"gmail",status:"ready",sendingAddress:profile.data.email,displayName:profile.data.email,lastValidatedAt:new Date().toISOString()};
    } catch { await this.markReauth(organizationId,"oauth_exchange_failed",input.principal); throw new V2ApplicationError("VALIDATION_ERROR","Gmail connection could not be completed. Reconnect and try again."); }
  }
  async disconnect(organizationId:string, principal:Principal): Promise<EmailReadiness> { const client=await this.pool.connect(); try { await client.query("BEGIN"); const row=(await client.query<{sending_address:string|null}>("SELECT sending_address FROM v2_email_integrations WHERE organization_id=$1 FOR UPDATE",[organizationId])).rows[0]; if(row) await client.query("UPDATE v2_email_integrations SET readiness_state='not_configured',encrypted_refresh_token=NULL,encryption_key_id=NULL,disconnected_at=now(),updated_at=now() WHERE organization_id=$1",[organizationId]); await this.audit(client,organizationId,"disconnected",principal,row?.sending_address??null,{}); await client.query("COMMIT"); return {provider:"gmail",status:"not_configured",actionRequired:"Connect a Gmail sending account."}; } catch(cause) {await client.query("ROLLBACK");throw cause;} finally {client.release();} }
  async markReauth(organizationId:string, code:string, principal?:Principal): Promise<void> { await this.pool.query("UPDATE v2_email_integrations SET readiness_state='reauth_required',last_error_code=$2,updated_at=now() WHERE organization_id=$1 AND readiness_state='ready'",[organizationId,code]); if(principal) await this.audit(this.pool,organizationId,"reauth_required",principal,null,{reason:code}); }
  private async validateRefreshToken(refreshToken:string):Promise<string>{
    if(!platformReady()) throw new V2ApplicationError("RETRYABLE_FAILURE","The platform Gmail delivery connection is unavailable.");
    try { const oauth=new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID,process.env.GOOGLE_CLIENT_SECRET,redirectUri()); oauth.setCredentials({refresh_token:refreshToken}); await oauth.getAccessToken(); const profile=await google.oauth2({version:"v2",auth:oauth}).userinfo.get(); if(!validAddress(profile.data.email)) throw new Error("missing_sender_address"); return profile.data.email; }
    catch { throw new V2ApplicationError("VALIDATION_ERROR","The existing Gmail connection requires reconnecting before it can be adopted."); }
  }
  private async audit(client:Pool|PoolClient, organizationId:string, event:string, principal:Principal, sendingAddress:string|null, detail:Record<string,string>):Promise<void>{ await client.query("INSERT INTO v2_email_integration_audit_events(organization_id,event_type,provider,sending_address,principal_kind,principal_subject,staff_actor_user_id,detail) VALUES($1,$2,'gmail',$3,$4,$5,$6,$7::jsonb)",[organizationId,event,sendingAddress,principal.kind,principalSubject(principal),staffActorId(principal)??null,JSON.stringify(detail)]); }
}
