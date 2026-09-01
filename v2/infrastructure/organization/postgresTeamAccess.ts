import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { Capability } from "../../src/authorization/capabilities.js";
import type { StaffPrincipal } from "../../src/authorization/principals.js";
import { principalSubject } from "../../src/authorization/principals.js";
import { parseCapabilities, teamCapabilityGroups } from "../../src/modules/organization/teamAccess.js";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";
import { PostgresEmailIntegrationService } from "../communications/postgresEmailIntegration.js";

type Context = Readonly<{ businessRequestId: string; expectedAuthorityRevision: string }>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalized = (name: string) => name.trim().toLocaleLowerCase();

export type TeamAccessSnapshot = Readonly<{ authorityRevision: string; staff: readonly unknown[]; invitations: readonly unknown[]; permissionSets: readonly unknown[]; portalAccess: readonly unknown[]; portalCandidates: readonly unknown[]; audit: readonly unknown[]; readiness: Readonly<{ status: "ready" | "needs_attention"; reasons: readonly string[]; activeStaffCount: number; viableAdministratorCount: number; pendingInvitationCount: number }>; capabilityGroups: typeof teamCapabilityGroups }>;

/** Canonical V2 tenant operator adapter. It manages tenant memberships only,
 * never global user identity, and makes every authority mutation durable. */
export class PostgresTeamAccess {
  private readonly requests = new PostgresOperationRequestRepository();
  constructor(private readonly pool: Pool, private readonly communications = new PostgresEmailIntegrationService(pool)) {}

  async read(organizationId: string, includePortalCandidates = false): Promise<TeamAccessSnapshot> {
    const [state, staff, invitations, permissionSets, portalAccess, portalCandidates, audit] = await Promise.all([
      this.pool.query<{ authority_revision: string }>("SELECT authority_revision FROM v2_permission_organization_state WHERE organization_id=$1", [organizationId]),
      this.pool.query(`SELECT uo.user_id,COALESCE(NULLIF(trim(concat_ws(' ',u.first_name,u.last_name)),''),u.email) display_name,u.email,uo.is_active,
        COALESCE(array_agg(DISTINCT ps.name) FILTER (WHERE a.active AND ps.active),'{}') permission_sets,
        bool_or(a.active AND ps.active AND p.capability_id='permissions.manageSets') AND bool_or(a.active AND ps.active AND p.capability_id='permissions.assignStaff') administrator_capable
        FROM user_organizations uo JOIN users u ON u.id=uo.user_id
        LEFT JOIN v2_staff_permission_set_assignments a ON a.organization_id=uo.organization_id AND a.user_id=uo.user_id
        LEFT JOIN v2_permission_sets ps ON ps.id=a.permission_set_id AND ps.organization_id=a.organization_id
        LEFT JOIN v2_permission_set_capabilities p ON p.organization_id=ps.organization_id AND p.permission_set_id=ps.id
        WHERE uo.organization_id=$1 GROUP BY uo.user_id,u.id,u.email,uo.is_active ORDER BY lower(u.email)`, [organizationId]),
      this.pool.query("SELECT i.id,i.email,i.role,i.expires_at,i.accepted_at,i.created_at,d.delivery_state FROM org_invites i LEFT JOIN v2_team_invitation_delivery_attempts d ON d.organization_id=i.org_id AND d.invite_id=i.id WHERE i.org_id=$1 ORDER BY i.created_at DESC", [organizationId]),
      this.sets(organizationId),
      this.pool.query(`SELECT cpa.id,cpa.customer_id,cpa.contact_id,cpa.status,cpa.password_set_at,c.company_name,COALESCE(NULLIF(trim(concat_ws(' ',cc.first_name,cc.last_name)),''),cc.email) contact_name,cc.email,
        (SELECT d.delivery_state FROM v2_portal_invitation_delivery_attempts d WHERE d.organization_id=cpa.organization_id AND d.portal_access_id=cpa.id ORDER BY d.created_at DESC LIMIT 1) delivery_state,
        COALESCE(array_agg(DISTINCT ps.name) FILTER (WHERE a.active AND ps.active),'{}') permission_sets
        FROM customer_portal_access cpa LEFT JOIN v2_portal_permission_set_assignments a ON a.organization_id=cpa.organization_id AND a.portal_access_id=cpa.id
        LEFT JOIN v2_permission_sets ps ON ps.id=a.permission_set_id AND ps.organization_id=a.organization_id
        LEFT JOIN customers c ON c.id=cpa.customer_id AND c.organization_id=cpa.organization_id
        LEFT JOIN customer_contacts cc ON cc.id=cpa.contact_id AND cc.organization_id=cpa.organization_id
        WHERE cpa.organization_id=$1 GROUP BY cpa.id,cpa.customer_id,cpa.contact_id,cpa.status,cpa.password_set_at,c.company_name,cc.first_name,cc.last_name,cc.email ORDER BY cpa.id`, [organizationId]),
      includePortalCandidates ? this.pool.query(`SELECT c.id customer_id,c.company_name,cc.id contact_id,COALESCE(NULLIF(trim(concat_ws(' ',cc.first_name,cc.last_name)),''),cc.email) contact_name,cc.email,
        cpa.id portal_access_id,cpa.status portal_status,
        CASE WHEN cc.email IS NULL OR btrim(cc.email)='' THEN 'missing_email'
             WHEN cc.status <> 'active' OR l.status <> 'active' THEN 'not_eligible'
             WHEN c.is_active IS FALSE OR COALESCE(c.status,'active') IN ('archived','deleted','superseded') OR c.merged_into_customer_id IS NOT NULL THEN 'not_eligible'
             WHEN cpa.id IS NOT NULL THEN lower(cpa.status::text)
             ELSE 'eligible' END eligibility
        FROM customer_contact_links l JOIN customers c ON c.id=l.customer_id AND c.organization_id=l.organization_id
        JOIN customer_contacts cc ON cc.id=l.contact_id AND cc.organization_id=l.organization_id
        LEFT JOIN customer_portal_access cpa ON cpa.organization_id=l.organization_id AND cpa.contact_id=l.contact_id
        WHERE l.organization_id=$1 ORDER BY lower(c.company_name),lower(cc.email),cc.id`, [organizationId]) : Promise.resolve({ rows: [] as any[] }),
      this.pool.query("SELECT event_type,actor_principal_kind,actor_principal_subject,permission_set_id,target_user_id,portal_access_id,customer_id,created_at FROM v2_permission_audit_events WHERE organization_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100", [organizationId]),
    ]);
    const active = staff.rows.filter((row: any) => row.is_active);
    const admins = active.filter((row: any) => row.administrator_capable);
    const pending = invitations.rows.filter((row: any) => !row.accepted_at && new Date(row.expires_at).getTime() >= Date.now());
    const reasons = admins.length ? [] : ["no_viable_administrator"];
    return { authorityRevision: state.rows[0]?.authority_revision ?? "0", staff: staff.rows.map((row: any) => ({ memberId: row.user_id, displayName: row.display_name, email: row.email, status: row.is_active ? "active" : "disabled", permissionSets: row.permission_sets, administratorCapable: Boolean(row.administrator_capable), allowedActions: row.is_active ? ["disable", "assign_permission_sets"] : ["enable"] })), invitations: invitations.rows.map((row: any) => ({ invitationId: row.id, email: row.email, requestedLegacyRole: row.role, status: row.accepted_at ? "accepted" : new Date(row.expires_at).getTime() < Date.now() ? "expired" : "pending", deliveryState: row.delivery_state ?? "legacy_unknown", expiresAt: row.expires_at, createdAt: row.created_at })), permissionSets, portalAccess: portalAccess.rows.map((row: any) => ({ portalAccessId: row.id, customerId: row.customer_id, contactId: row.contact_id, customerName: row.company_name ?? row.customer_id, contactName: row.contact_name ?? row.email, email: row.email, status: row.status, setupCompleted: Boolean(row.password_set_at), deliveryState: row.delivery_state ?? "legacy_unknown", permissionSets: row.permission_sets })), portalCandidates: portalCandidates.rows.map((row: any) => ({ customerId: row.customer_id, customerName: row.company_name ?? row.customer_id, contactId: row.contact_id, contactName: row.contact_name ?? row.email, email: row.email ?? undefined, eligibility: row.eligibility, portalAccessId: row.portal_access_id ?? undefined, portalStatus: row.portal_status ?? undefined })), audit: audit.rows, readiness: { status: reasons.length ? "needs_attention" : "ready", reasons, activeStaffCount: active.length, viableAdministratorCount: admins.length, pendingInvitationCount: pending.length }, capabilityGroups: teamCapabilityGroups };
  }

  /** Existing org_invites remains the sole invitation/acceptance authority;
   * Communications owns provider delivery and no token is ever projected. */
  async createInvitation(actor: StaffPrincipal, organizationId: string, input: { email: string; legacyRole?: "admin" | "manager" | "member" }, context: Context): Promise<{ invitationId: string; status: "pending" }> {
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new V2ApplicationError("VALIDATION_ERROR", "A valid staff email is required.");
    if (actor.organizationId !== organizationId || actor.authority.source !== "permission_set" || !actor.authority.capabilities.includes("permissions.assignStaff")) throw new V2ApplicationError("FORBIDDEN", "You do not have permission to invite Staff.");
    if (!context.businessRequestId.trim() || !context.expectedAuthorityRevision.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "businessRequestId and expectedAuthorityRevision are required.");
    await this.communications.requireReady(organizationId);
    const client=await this.pool.connect(); const operation="team_access.staff_invitation_created.v1"; const detail={email,role:input.legacyRole??"member"}; let invitationId=""; let token=""; let requestId="";
    try { await client.query("BEGIN"); const reservation=await this.requests.reserve(client,{organizationId,operation,businessRequestId:context.businessRequestId,payloadFingerprint:hash(detail),principalKind:actor.kind,principalSubject:principalSubject(actor),staffActorUserId:actor.userId}); if(reservation.kind==="replay"){await client.query("COMMIT");return reservation.request.resultJson as {invitationId:string;status:"pending"};}
      const state=await client.query<{authority_revision:string}>("SELECT authority_revision FROM v2_permission_organization_state WHERE organization_id=$1 FOR UPDATE",[organizationId]);if(!state.rows[0]||String(state.rows[0].authority_revision)!==context.expectedAuthorityRevision||actor.authority.authorityRevision!==context.expectedAuthorityRevision)throw new V2ApplicationError("STALE_STATE","Team authority changed elsewhere. Reload and try again.");
      const existing=await client.query<{id:string}>("SELECT id FROM org_invites WHERE org_id=$1 AND email=$2 AND accepted_at IS NULL AND expires_at>=now() FOR UPDATE",[organizationId,email]);if(existing.rows[0]){await this.requests.succeed(client,organizationId,reservation.request.id,{resourceType:"staff_invitation",resourceId:existing.rows[0].id,resultJson:{invitationId:existing.rows[0].id,status:"pending"}});await client.query("COMMIT");return{invitationId:existing.rows[0].id,status:"pending"};}
      invitationId=randomBytes(18).toString("base64url");token=randomBytes(32).toString("hex");requestId=reservation.request.id;await client.query("INSERT INTO org_invites(id,org_id,email,role,token_hash,expires_at,created_by_user_id) VALUES($1,$2,$3,$4,$5,now()+interval '7 days',$6)",[invitationId,organizationId,email,input.legacyRole??"member",createHash("sha256").update(token).digest("hex"),actor.userId]);await client.query("INSERT INTO v2_team_invitation_delivery_attempts(organization_id,invite_id,operation_request_id,delivery_state) VALUES($1,$2,$3,'pending')",[organizationId,invitationId,requestId]);await client.query("COMMIT");
    } catch(error){await client.query("ROLLBACK");throw error;} finally {client.release();}
    try { const origin=(process.env.APP_PUBLIC_WEB_ORIGIN??process.env.APP_URL??"").replace(/\/$/u,"");if(!origin)throw new V2ApplicationError("RETRYABLE_FAILURE","The invitation public origin is unavailable.");const providerMessageId=await this.communications.sendStaffInvitation(organizationId,email,`${origin}/invite?token=${encodeURIComponent(token)}`);const done=await this.pool.connect();try{await done.query("BEGIN");await done.query("UPDATE v2_team_invitation_delivery_attempts SET delivery_state='succeeded',provider_message_id=$3,completed_at=now(),updated_at=now() WHERE organization_id=$1 AND invite_id=$2 AND delivery_state='pending'",[organizationId,invitationId,providerMessageId]);await done.query("INSERT INTO v2_permission_audit_events(organization_id,event_type,actor_principal_kind,actor_principal_subject,staff_actor_user_id,detail) VALUES($1,'staff_invitation_delivered','staff',$2,$2,$3::jsonb)",[organizationId,actor.userId,JSON.stringify({invitationId,businessRequestId:context.businessRequestId})]);await this.requests.succeed(done,organizationId,requestId,{resourceType:"staff_invitation",resourceId:invitationId,resultJson:{invitationId,status:"pending"}});await done.query("COMMIT");}catch(error){await done.query("ROLLBACK");throw error;}finally{done.release();}return{invitationId,status:"pending"};
    } catch(error) { const failed=await this.pool.connect();try{await failed.query("BEGIN");await failed.query("UPDATE v2_team_invitation_delivery_attempts SET delivery_state='uncertain',completed_at=now(),updated_at=now() WHERE organization_id=$1 AND invite_id=$2 AND delivery_state='pending'",[organizationId,invitationId]);await this.requests.markPermanentFailure(failed,organizationId,requestId);await failed.query("COMMIT");}catch{await failed.query("ROLLBACK");}finally{failed.release();}throw error; }
  }

  /** Creates Portal access from the canonical active Customer Contact link.
   * The contact/token tables remain the onboarding authority; this adapter
   * only binds the resulting access to V2 Portal permission sets. */
  async bootstrapPortalAccess(actor: StaffPrincipal, organizationId: string, input: { customerId: string; contactId: string; permissionSetId: string }, context: Context): Promise<{ portalAccessId: string; status: "pending" | "active"; deliveryState: "not_sent" | "pending" | "succeeded" | "uncertain" }> {
    if (actor.organizationId !== organizationId || actor.authority.source !== "permission_set" || !actor.authority.capabilities.includes("permissions.assignPortal")) throw new V2ApplicationError("FORBIDDEN", "You do not have permission to grant Customer Portal access.");
    if (!context.businessRequestId.trim() || !context.expectedAuthorityRevision.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "businessRequestId and expectedAuthorityRevision are required.");
    await this.communications.requireReady(organizationId);
    const operation="team_access.portal_access_bootstrapped.v1", detail={customerId:input.customerId,contactId:input.contactId,permissionSetId:input.permissionSetId}; let portalAccessId="", email="", token="", requestId="", needsDelivery=false;
    const client=await this.pool.connect();
    try { await client.query("BEGIN"); const reservation=await this.requests.reserve(client,{organizationId,operation,businessRequestId:context.businessRequestId,payloadFingerprint:hash(detail),principalKind:actor.kind,principalSubject:principalSubject(actor),staffActorUserId:actor.userId});
      if(reservation.kind==="replay") { await client.query("COMMIT"); const result=reservation.request.resultJson as {portalAccessId:string;status:"pending"|"active";deliveryState:"not_sent"|"pending"|"succeeded"|"uncertain"}|null; if(result)return result; throw new V2ApplicationError("CONFLICT","Portal invitation delivery is already being confirmed. Reload before trying again."); }
      const state=await client.query<{authority_revision:string}>("SELECT authority_revision FROM v2_permission_organization_state WHERE organization_id=$1 FOR UPDATE",[organizationId]); if(!state.rows[0]||String(state.rows[0].authority_revision)!==context.expectedAuthorityRevision||actor.authority.authorityRevision!==context.expectedAuthorityRevision)throw new V2ApplicationError("STALE_STATE","Team authority changed elsewhere. Reload and try again.");
      const contact=await client.query<{email:string|null;display_name:string|null}>(`SELECT cc.email,COALESCE(NULLIF(trim(concat_ws(' ',cc.first_name,cc.last_name)),''),cc.email) display_name
        FROM customer_contact_links l JOIN customer_contacts cc ON cc.id=l.contact_id AND cc.organization_id=l.organization_id
        JOIN customers c ON c.id=l.customer_id AND c.organization_id=l.organization_id
        WHERE l.organization_id=$1 AND l.customer_id=$2 AND l.contact_id=$3 AND l.status='active' AND cc.status='active'
          AND c.is_active IS DISTINCT FROM false AND COALESCE(c.status,'active') NOT IN ('archived','deleted','superseded') AND c.merged_into_customer_id IS NULL FOR UPDATE`,[organizationId,input.customerId,input.contactId]);
      if(!contact.rows[0])throw new V2ApplicationError("NOT_FOUND","An active Customer Contact relationship was not found."); email=(contact.rows[0].email??"").trim().toLowerCase(); if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))throw new V2ApplicationError("VALIDATION_ERROR","The Customer Contact needs a valid email address before Portal access can be granted."); await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`${organizationId}:portal:${email}`]);
      const user=await client.query<{id:string;account_type:string}>("SELECT id,account_type::text FROM users WHERE lower(email)=lower($1) FOR UPDATE",[email]); if(user.rows[0]&&user.rows[0].account_type!=="PORTAL_CUSTOMER")throw new V2ApplicationError("CONFLICT","This Contact email already belongs to a Staff identity.");
      const emailAccess=await client.query<{organization_id:string;contact_id:string|null}>("SELECT organization_id,contact_id FROM customer_portal_access WHERE lower(email)=lower($1) FOR UPDATE",[email]); if(emailAccess.rows[0]&&(emailAccess.rows[0].organization_id!==organizationId||emailAccess.rows[0].contact_id!==input.contactId))throw new V2ApplicationError("CONFLICT","This email already belongs to another Customer Portal identity.");
      const found=await client.query<{id:string;customer_id:string;status:string;user_id:string|null}>("SELECT id,customer_id,status::text,user_id FROM customer_portal_access WHERE organization_id=$1 AND contact_id=$2 FOR UPDATE",[organizationId,input.contactId]); let status:"pending"|"active"="pending"; let changed=false;
      if(found.rows[0]) { const access=found.rows[0]; if(access.customer_id!==input.customerId)throw new V2ApplicationError("CONFLICT","This Contact already has Portal access for another Customer."); portalAccessId=access.id; if(access.status==="SUSPENDED"||access.status==="DISABLED")throw new V2ApplicationError("CONFLICT","Disabled or suspended Portal access must be reviewed before it can be granted again."); status=access.status==="ACTIVE"?"active":"pending"; }
      else { portalAccessId=randomBytes(18).toString("base64url"); await client.query("INSERT INTO customer_portal_access(id,organization_id,customer_id,contact_id,status,email,display_name,access_role,created_by_user_id,updated_by_user_id) VALUES($1,$2,$3,$4,'PENDING_INVITE',$5,$6,'VIEWER',$7,$7)",[portalAccessId,organizationId,input.customerId,input.contactId,email,contact.rows[0].display_name??email,actor.userId]); token=randomBytes(32).toString("hex"); await client.query("INSERT INTO customer_portal_invite_tokens(organization_id,access_id,token_hash,expires_at,created_by_user_id) VALUES($1,$2,$3,now()+interval '72 hours',$4)",[organizationId,portalAccessId,createHash("sha256").update(token).digest("hex"),actor.userId]); needsDelivery=true; changed=true; }
      const set=await client.query<{id:string;capability_id:Capability|null}>("SELECT s.id,c.capability_id FROM v2_permission_sets s LEFT JOIN v2_permission_set_capabilities c ON c.organization_id=s.organization_id AND c.permission_set_id=s.id WHERE s.organization_id=$1 AND s.id=$2 AND s.active AND s.principal_kind='portal' FOR UPDATE",[organizationId,input.permissionSetId]); if(!set.rows.length)throw new V2ApplicationError("VALIDATION_ERROR","Choose an active Portal permission set in this organization."); this.ceiling(actor,set.rows.flatMap((row)=>row.capability_id?[row.capability_id]:[]));
      const prior=await client.query<{permission_set_id:string}>("SELECT permission_set_id FROM v2_portal_permission_set_assignments WHERE organization_id=$1 AND portal_access_id=$2 AND active FOR UPDATE",[organizationId,portalAccessId]); if(prior.rows.length!==1||prior.rows[0].permission_set_id!==input.permissionSetId){await client.query("UPDATE v2_portal_permission_set_assignments SET active=false,updated_at=now() WHERE organization_id=$1 AND portal_access_id=$2 AND active",[organizationId,portalAccessId]);await client.query("INSERT INTO v2_portal_permission_set_assignments(organization_id,portal_access_id,permission_set_id,active) VALUES($1,$2,$3,true) ON CONFLICT(organization_id,portal_access_id,permission_set_id) DO UPDATE SET active=true,updated_at=now()",[organizationId,portalAccessId,input.permissionSetId]);changed=true;}
      requestId=reservation.request.id; if(needsDelivery)await client.query("INSERT INTO v2_portal_invitation_delivery_attempts(organization_id,portal_access_id,operation_request_id,delivery_state) VALUES($1,$2,$3,'pending')",[organizationId,portalAccessId,requestId]);
      if(changed){await client.query("INSERT INTO v2_permission_audit_events(organization_id,event_type,actor_principal_kind,actor_principal_subject,staff_actor_user_id,permission_set_id,portal_access_id,customer_id,detail) VALUES($1,'portal_access_bootstrapped','staff',$2,$2,$3,$4,$5,$6::jsonb)",[organizationId,actor.userId,input.permissionSetId,portalAccessId,input.customerId,JSON.stringify({contactId:input.contactId,businessRequestId:context.businessRequestId,invitationCreated:needsDelivery})]);await client.query("UPDATE v2_permission_organization_state SET authority_revision=authority_revision+1,updated_at=now() WHERE organization_id=$1",[organizationId]);}
      await this.requests.recordAttribution(client,{organizationId,operationRequestId:requestId,operation,resourceType:"portal_access",resourceId:portalAccessId,principalKind:actor.kind,principalSubject:principalSubject(actor),staffActorUserId:actor.userId});
      if(!needsDelivery)await this.requests.succeed(client,organizationId,requestId,{resourceType:"portal_access",resourceId:portalAccessId,resultJson:{portalAccessId,status,deliveryState:status==="active"?"not_sent":"pending"}});
      await client.query("COMMIT"); if(!needsDelivery)return{portalAccessId,status,deliveryState:status==="active"?"not_sent":"pending"};
    } catch(error){await client.query("ROLLBACK");throw error;} finally{client.release();}
    try { const origin=(process.env.APP_PUBLIC_WEB_ORIGIN??process.env.APP_URL??"").replace(/\/$/u,""); if(!origin)throw new V2ApplicationError("RETRYABLE_FAILURE","The portal public origin is unavailable."); const providerMessageId=await this.communications.sendPortalInvitation(organizationId,email,`${origin}/portal/setup?token=${encodeURIComponent(token)}`); const done=await this.pool.connect();try{await done.query("BEGIN");await done.query("UPDATE v2_portal_invitation_delivery_attempts SET delivery_state='succeeded',provider_message_id=$3,completed_at=now(),updated_at=now() WHERE organization_id=$1 AND portal_access_id=$2 AND operation_request_id=$4 AND delivery_state='pending'",[organizationId,portalAccessId,providerMessageId,requestId]);await done.query("UPDATE customer_portal_access SET invite_sent_at=now(),updated_at=now(),updated_by_user_id=$3 WHERE organization_id=$1 AND id=$2",[organizationId,portalAccessId,actor.userId]);await done.query("UPDATE customer_portal_invite_tokens SET sent_at=now() WHERE organization_id=$1 AND access_id=$2 AND used_at IS NULL AND revoked_at IS NULL AND sent_at IS NULL",[organizationId,portalAccessId]);await done.query("INSERT INTO v2_permission_audit_events(organization_id,event_type,actor_principal_kind,actor_principal_subject,staff_actor_user_id,portal_access_id,detail) VALUES($1,'portal_invitation_delivered','staff',$2,$2,$3,$4::jsonb)",[organizationId,actor.userId,portalAccessId,JSON.stringify({businessRequestId:context.businessRequestId})]);await this.requests.succeed(done,organizationId,requestId,{resourceType:"portal_access",resourceId:portalAccessId,resultJson:{portalAccessId,status:"pending",deliveryState:"succeeded"}});await done.query("COMMIT");}catch(error){await done.query("ROLLBACK");throw error;}finally{done.release();}return{portalAccessId,status:"pending",deliveryState:"succeeded"};
    }catch(error){const failed=await this.pool.connect();try{await failed.query("BEGIN");await failed.query("UPDATE v2_portal_invitation_delivery_attempts SET delivery_state='uncertain',completed_at=now(),updated_at=now() WHERE organization_id=$1 AND portal_access_id=$2 AND operation_request_id=$3 AND delivery_state='pending'",[organizationId,portalAccessId,requestId]);await this.requests.markPermanentFailure(failed,organizationId,requestId);await failed.query("COMMIT");}catch{await failed.query("ROLLBACK");}finally{failed.release();}throw error;}
  }

  async setMembershipActive(actor: StaffPrincipal, organizationId: string, userId: string, active: boolean, context: Context): Promise<void> {
    await this.mutate(actor, organizationId, "permissions.assignStaff", active ? "staff_membership_enabled" : "staff_membership_disabled", { userId, active }, context, async (client) => {
      const updated = await client.query("UPDATE user_organizations SET is_active=$3,updated_at=now() WHERE organization_id=$1 AND user_id=$2 AND is_active IS DISTINCT FROM $3", [organizationId, userId, active]);
      if (updated.rowCount) return { changed: true, result: { userId, status: active ? "active" : "disabled" } };
      const exists = await client.query("SELECT 1 FROM user_organizations WHERE organization_id=$1 AND user_id=$2", [organizationId, userId]);
      if (!exists.rowCount) throw new V2ApplicationError("NOT_FOUND", "Staff membership was not found.");
      return { changed: false, result: { userId, status: active ? "active" : "disabled" } };
    });
  }

  /** Replaces a pending setup link rather than exposing it. This is an
   * explicit staff action, scoped to the existing portal/customer identity. */
  async resendPortalSetup(actor: StaffPrincipal, organizationId: string, portalAccessId: string, context: Context): Promise<{ portalAccessId: string; status: "pending" }> {
    await this.communications.requireReady(organizationId);
    let recipient = ""; let token = "";
    const result = await this.mutate(actor, organizationId, "permissions.assignPortal", "portal_setup_resent", { portalAccessId }, context, async (client) => {
      const access = await client.query<{ email:string; status:string; customer_id:string; contact_id:string|null }>(
        `SELECT a.email,a.status::text,a.customer_id,a.contact_id FROM customer_portal_access a
         JOIN customers c ON c.id=a.customer_id AND c.organization_id=a.organization_id
         LEFT JOIN customer_contacts cc ON cc.id=a.contact_id AND cc.organization_id=a.organization_id
         LEFT JOIN customer_contact_links l ON l.organization_id=a.organization_id AND l.customer_id=a.customer_id AND l.contact_id=a.contact_id
         WHERE a.organization_id=$1 AND a.id=$2 AND c.is_active IS DISTINCT FROM false
           AND COALESCE(c.status,'active') NOT IN ('archived','deleted','superseded') AND c.merged_into_customer_id IS NULL
           AND (a.contact_id IS NULL OR (cc.status='active' AND l.status='active')) FOR UPDATE`, [organizationId, portalAccessId]);
      const row=access.rows[0];
      if(!row) throw new V2ApplicationError("NOT_FOUND","Customer Portal access was not found.");
      if(row.status === "ACTIVE") throw new V2ApplicationError("CONFLICT","This contact has already completed setup. Use password reset instead.");
      recipient=row.email.trim().toLowerCase(); if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(recipient)) throw new V2ApplicationError("VALIDATION_ERROR","The Customer Contact needs a valid email address.");
      token=randomBytes(32).toString("hex");
      await client.query("UPDATE customer_portal_invite_tokens SET revoked_at=now() WHERE organization_id=$1 AND access_id=$2 AND used_at IS NULL AND revoked_at IS NULL",[organizationId,portalAccessId]);
      await client.query("INSERT INTO customer_portal_invite_tokens(organization_id,access_id,token_hash,expires_at,created_by_user_id) VALUES($1,$2,$3,now()+interval '72 hours',$4)",[organizationId,portalAccessId,createHash("sha256").update(token).digest("hex"),actor.userId]);
      await client.query("UPDATE customer_portal_access SET status='PENDING_INVITE',suspended_at=NULL,disabled_at=NULL,updated_by_user_id=$3,updated_at=now() WHERE organization_id=$1 AND id=$2",[organizationId,portalAccessId,actor.userId]);
      return { changed:true, result:{portalAccessId,status:"pending" as const} };
    });
    if (!token) return result;
    try {
      const origin=(process.env.APP_PUBLIC_WEB_ORIGIN??process.env.APP_URL??"").replace(/\/$/u,"");
      if(!origin)throw new V2ApplicationError("RETRYABLE_FAILURE","The portal public origin is unavailable.");
      await this.communications.sendPortalInvitation(organizationId,recipient,`${origin}/portal/setup?token=${encodeURIComponent(token)}`);
      await this.pool.query("UPDATE customer_portal_access SET invite_sent_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2",[organizationId,portalAccessId]);
      await this.pool.query("UPDATE customer_portal_invite_tokens SET sent_at=now() WHERE organization_id=$1 AND access_id=$2 AND token_hash=$3",[organizationId,portalAccessId,createHash("sha256").update(token).digest("hex")]);
      return result;
    } catch (error) {
      throw error;
    }
  }

  async setPortalAccessStatus(actor: StaffPrincipal, organizationId: string, portalAccessId: string, status: "suspended" | "disabled", context: Context): Promise<void> {
    await this.mutate(actor, organizationId, "permissions.assignPortal", `portal_access_${status}`, { portalAccessId, status }, context, async (client) => {
      const access=await client.query<{status:string}>("SELECT status::text FROM customer_portal_access WHERE organization_id=$1 AND id=$2 FOR UPDATE",[organizationId,portalAccessId]);
      if(!access.rows[0])throw new V2ApplicationError("NOT_FOUND","Customer Portal access was not found.");
      const next=status === "suspended" ? "SUSPENDED" : "DISABLED";
      await client.query(`UPDATE customer_portal_access SET status='${next}',${status === "suspended" ? "suspended_at" : "disabled_at"}=now(),updated_by_user_id=$3,updated_at=now() WHERE organization_id=$1 AND id=$2`,[organizationId,portalAccessId,actor.userId]);
      await client.query("UPDATE customer_portal_invite_tokens SET revoked_at=now() WHERE organization_id=$1 AND access_id=$2 AND used_at IS NULL AND revoked_at IS NULL",[organizationId,portalAccessId]);
      await client.query("UPDATE v2_portal_password_reset_tokens SET revoked_at=now() WHERE organization_id=$1 AND access_id=$2 AND used_at IS NULL AND revoked_at IS NULL",[organizationId,portalAccessId]);
      return {changed:access.rows[0].status!==next,result:{portalAccessId,status}};
    });
  }

  async createCustomSet(actor: StaffPrincipal, organizationId: string, input: { name: string; description?: string; principalKind?: "staff" | "portal"; capabilities: readonly Capability[] }, context: Context): Promise<{ permissionSetId: string }> {
    const id = randomBytes(18).toString("base64url"); const capabilities = parseCapabilities(input.capabilities);
    return this.mutate(actor, organizationId, "permissions.manageSets", "permission_set_created", { permissionSetId: id, name: input.name, capabilities }, context, async (client) => {
      this.ceiling(actor, capabilities); if (!input.name.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "Permission-set name is required.");
      await client.query("INSERT INTO v2_permission_sets(id,organization_id,name,normalized_name,description,principal_kind) VALUES($1,$2,$3,$4,$5,$6)", [id, organizationId, input.name.trim(), normalized(input.name), input.description?.trim() || null, input.principalKind ?? "staff"]);
      for (const capability of capabilities) await client.query("INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id) VALUES($1,$2,$3)", [organizationId, id, capability]);
      return { changed: true, result: { permissionSetId: id } };
    });
  }

  async updateCustomSet(actor: StaffPrincipal, organizationId: string, permissionSetId: string, input: { name: string; description?: string; capabilities: readonly Capability[]; active: boolean }, context: Context): Promise<void> {
    const capabilities = parseCapabilities(input.capabilities);
    await this.mutate(actor, organizationId, "permissions.manageSets", "permission_set_updated", { permissionSetId, name: input.name, capabilities, active: input.active }, context, async (client) => {
      this.ceiling(actor, capabilities); await this.customSet(client, organizationId, permissionSetId);
      await client.query("DELETE FROM v2_permission_set_capabilities WHERE organization_id=$1 AND permission_set_id=$2", [organizationId, permissionSetId]);
      for (const capability of capabilities) await client.query("INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id) VALUES($1,$2,$3)", [organizationId, permissionSetId, capability]);
      await client.query("UPDATE v2_permission_sets SET name=$3,normalized_name=$4,description=$5,active=$6,revision=revision+1,updated_at=now() WHERE organization_id=$1 AND id=$2", [organizationId, permissionSetId, input.name.trim(), normalized(input.name), input.description?.trim() || null, input.active]);
      return { changed: true, result: { permissionSetId } };
    });
  }

  async replaceStaffAssignments(actor: StaffPrincipal, organizationId: string, userId: string, permissionSetIds: readonly string[], context: Context): Promise<void> {
    await this.mutate(actor, organizationId, "permissions.assignStaff", "staff_permission_sets_replaced", { userId, permissionSetIds }, context, async (client) => {
      const member = await client.query("SELECT 1 FROM user_organizations WHERE organization_id=$1 AND user_id=$2 AND is_active=true FOR UPDATE", [organizationId, userId]); if (!member.rowCount) throw new V2ApplicationError("NOT_FOUND", "Active Staff membership was not found.");
      const ids = [...new Set(permissionSetIds)]; if (!ids.length) throw new V2ApplicationError("VALIDATION_ERROR", "At least one Staff permission set is required.");
      const found = await client.query<{ id: string; active: boolean; principal_kind: string; capability_id: Capability | null }>("SELECT s.id,s.active,s.principal_kind,c.capability_id FROM v2_permission_sets s LEFT JOIN v2_permission_set_capabilities c ON c.organization_id=s.organization_id AND c.permission_set_id=s.id WHERE s.organization_id=$1 AND s.id=ANY($2::varchar[]) FOR UPDATE", [organizationId, ids]);
      const setIds = [...new Set(found.rows.map((row) => row.id))]; if (setIds.length !== ids.length || found.rows.some((row) => !row.active || row.principal_kind !== "staff")) throw new V2ApplicationError("VALIDATION_ERROR", "Choose active Staff permission sets in this organization.");
      this.ceiling(actor, found.rows.flatMap((row) => row.capability_id ? [row.capability_id] : []));
      await client.query("UPDATE v2_staff_permission_set_assignments SET active=false,updated_at=now() WHERE organization_id=$1 AND user_id=$2 AND active=true", [organizationId, userId]);
      for (const id of ids) await client.query("INSERT INTO v2_staff_permission_set_assignments(organization_id,user_id,permission_set_id,active,assignment_source) VALUES($1,$2,$3,true,'manual') ON CONFLICT(organization_id,user_id,permission_set_id) DO UPDATE SET active=true,updated_at=now(),assignment_source='manual'", [organizationId, userId, id]);
      return { changed: true, result: { userId, permissionSetIds: ids } };
    });
  }

  async replacePortalAssignments(actor: StaffPrincipal, organizationId: string, portalAccessId: string, permissionSetIds: readonly string[], context: Context): Promise<void> {
    await this.mutate(actor, organizationId, "permissions.assignPortal", "portal_permission_sets_replaced", { portalAccessId, permissionSetIds }, context, async (client) => {
      const access = await client.query("SELECT 1 FROM customer_portal_access WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId, portalAccessId]); if (!access.rowCount) throw new V2ApplicationError("NOT_FOUND", "Customer Portal access was not found.");
      const ids = [...new Set(permissionSetIds)]; if (!ids.length) throw new V2ApplicationError("VALIDATION_ERROR", "At least one Portal permission set is required.");
      const found = await client.query<{ id: string; active: boolean; principal_kind: string; capability_id: Capability | null }>("SELECT s.id,s.active,s.principal_kind,c.capability_id FROM v2_permission_sets s LEFT JOIN v2_permission_set_capabilities c ON c.organization_id=s.organization_id AND c.permission_set_id=s.id WHERE s.organization_id=$1 AND s.id=ANY($2::varchar[]) FOR UPDATE", [organizationId, ids]);
      const setIds = [...new Set(found.rows.map((row) => row.id))]; if (setIds.length !== ids.length || found.rows.some((row) => !row.active || row.principal_kind !== "portal")) throw new V2ApplicationError("VALIDATION_ERROR", "Choose active Portal permission sets in this organization.");
      this.ceiling(actor, found.rows.flatMap((row) => row.capability_id ? [row.capability_id] : []));
      await client.query("UPDATE v2_portal_permission_set_assignments SET active=false,updated_at=now() WHERE organization_id=$1 AND portal_access_id=$2 AND active=true", [organizationId, portalAccessId]);
      for (const id of ids) await client.query("INSERT INTO v2_portal_permission_set_assignments(organization_id,portal_access_id,permission_set_id,active) VALUES($1,$2,$3,true) ON CONFLICT(organization_id,portal_access_id,permission_set_id) DO UPDATE SET active=true,updated_at=now()", [organizationId, portalAccessId, id]);
      return { changed: true, result: { portalAccessId, permissionSetIds: ids } };
    });
  }

  private async sets(organizationId: string) {
    const result = await this.pool.query<any>(`SELECT s.id,s.name,s.description,s.active,s.revision,s.principal_kind,s.source_template_key,c.capability_id,
      (SELECT count(*) FROM v2_staff_permission_set_assignments a WHERE a.organization_id=s.organization_id AND a.permission_set_id=s.id AND a.active)+(SELECT count(*) FROM v2_portal_permission_set_assignments a WHERE a.organization_id=s.organization_id AND a.permission_set_id=s.id AND a.active) assignment_count
      FROM v2_permission_sets s LEFT JOIN v2_permission_set_capabilities c ON c.organization_id=s.organization_id AND c.permission_set_id=s.id WHERE s.organization_id=$1 ORDER BY s.principal_kind,s.source_template_key NULLS LAST,lower(s.name),s.id`, [organizationId]);
    const values = new Map<string, any>(); for (const row of result.rows) { const prior = values.get(row.id) ?? { permissionSetId: row.id, name: row.name, description: row.description ?? undefined, active: row.active, revision: String(row.revision), principalKind: row.principal_kind, systemManaged: row.source_template_key !== null, sourceTemplateKey: row.source_template_key ?? undefined, capabilities: [], assignmentCount: Number(row.assignment_count) }; if (row.capability_id) prior.capabilities.push(row.capability_id); values.set(row.id, prior); }
    return [...values.values()].map((set) => ({ ...set, capabilities: set.capabilities.sort() }));
  }
  private ceiling(actor: StaffPrincipal, capabilities: readonly Capability[]) { for (const capability of capabilities) if (!actor.authority.capabilities.includes(capability)) throw new V2ApplicationError("FORBIDDEN", "Permission administrators cannot grant a capability they do not currently hold."); }
  private async customSet(client: PoolClient, organizationId: string, id: string) { const result = await client.query<{ source_template_key: string | null }>("SELECT source_template_key FROM v2_permission_sets WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId, id]); const row = result.rows[0]; if (!row) throw new V2ApplicationError("NOT_FOUND", "Permission set was not found."); if (row.source_template_key !== null) throw new V2ApplicationError("FORBIDDEN", "System permission sets are managed templates and cannot be edited."); }
  private async mutate<T>(actor: StaffPrincipal, organizationId: string, required: Capability, event: string, detail: Record<string, unknown>, context: Context, action: (client: PoolClient) => Promise<{ changed: boolean; result: T }>): Promise<T> {
    if (actor.organizationId !== organizationId) throw new V2ApplicationError("WRONG_TENANT", "Team access is organization scoped."); if (actor.authority.source !== "permission_set" || !actor.authority.capabilities.includes(required)) throw new V2ApplicationError("FORBIDDEN", "You do not have permission to manage Team & Access."); if (!context.businessRequestId.trim() || !context.expectedAuthorityRevision.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "businessRequestId and expectedAuthorityRevision are required.");
    const client = await this.pool.connect(); try { await client.query("BEGIN"); const operation = `team_access.${event}.v1`; const reservation = await this.requests.reserve(client, { organizationId, operation, businessRequestId: context.businessRequestId, payloadFingerprint: hash(detail), principalKind: actor.kind, principalSubject: principalSubject(actor), staffActorUserId: actor.userId }); if (reservation.kind === "replay") { await client.query("COMMIT"); return reservation.request.resultJson as T; }
      const state = await client.query<{ authority_revision: string }>("SELECT authority_revision FROM v2_permission_organization_state WHERE organization_id=$1 FOR UPDATE", [organizationId]); if (!state.rows[0]) throw new V2ApplicationError("NOT_FOUND", "Organization permission state was not found."); if (String(state.rows[0].authority_revision) !== context.expectedAuthorityRevision || actor.authority.authorityRevision !== context.expectedAuthorityRevision) throw new V2ApplicationError("STALE_STATE", "Team authority changed elsewhere. Reload and try again.");
      const output = await action(client); if (output.changed) { await this.floor(client, organizationId); await client.query("INSERT INTO v2_permission_audit_events(organization_id,event_type,actor_principal_kind,actor_principal_subject,staff_actor_user_id,permission_set_id,target_user_id,detail) VALUES($1,$2,'staff',$3,$3,$4,$5,$6::jsonb)", [organizationId,event,actor.userId,typeof detail.permissionSetId === "string" ? detail.permissionSetId : null,typeof detail.userId === "string" ? detail.userId : null,JSON.stringify({ ...detail, businessRequestId: context.businessRequestId })]); await client.query("UPDATE v2_permission_organization_state SET authority_revision=authority_revision+1,updated_at=now() WHERE organization_id=$1", [organizationId]); }
      await this.requests.recordAttribution(client, { organizationId, operationRequestId: reservation.request.id, operation, resourceType: "team_access", resourceId: organizationId, principalKind: actor.kind, principalSubject: principalSubject(actor), staffActorUserId: actor.userId }); await this.requests.succeed(client, organizationId, reservation.request.id, { resourceType: "team_access", resourceId: organizationId, resultJson: output.result }); await client.query("COMMIT"); return output.result;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  private async floor(client: PoolClient, organizationId: string) { const admins = await client.query("SELECT a.user_id FROM v2_staff_permission_set_assignments a JOIN user_organizations m ON m.organization_id=a.organization_id AND m.user_id=a.user_id AND m.is_active JOIN v2_permission_sets s ON s.id=a.permission_set_id AND s.organization_id=a.organization_id AND s.active JOIN v2_permission_set_capabilities c ON c.organization_id=s.organization_id AND c.permission_set_id=s.id JOIN v2_permission_capabilities catalog ON catalog.id=c.capability_id AND catalog.active WHERE a.organization_id=$1 AND a.active AND c.capability_id IN ('permissions.manageSets','permissions.assignStaff') GROUP BY a.user_id HAVING count(DISTINCT c.capability_id)=2 LIMIT 1", [organizationId]); if (!admins.rowCount) throw new V2ApplicationError("CONFLICT", "The final permission administrator cannot be removed, disabled, or weakened."); }
}
