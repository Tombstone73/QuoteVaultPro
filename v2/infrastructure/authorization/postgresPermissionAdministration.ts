import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { isCapability, type Capability } from "../../src/authorization/capabilities.js";
import type { StaffPrincipal } from "../../src/authorization/principals.js";
import type { TransactionalClient } from "../persistence/types.js";

type AuditTarget = Readonly<{ permissionSetId?: string; userId?: string; portalAccessId?: string; customerId?: string }>;
export type PermissionAdministrationOperationContext = Readonly<{
  correlationId: string;
  businessRequestId: string;
}>;
/** Test-only integration seam; production composition never supplies it. */
export type PermissionAdministrationTestHook = Readonly<{
  beforeOrganizationLock?: (eventType: string) => Promise<void> | void;
  afterMutation?: (eventType: string) => Promise<void> | void;
  afterAudit?: (eventType: string) => Promise<void> | void;
  afterRevision?: (eventType: string) => Promise<void> | void;
}>;
const normalized = (name: string) => name.trim().toLocaleLowerCase();
const sameValues = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

/**
 * Transactional permission administration. This class owns one transaction per
 * public operation, locks the tenant before every mutable authority
 * change, writes one semantic audit event, and bumps the authority revision.
 */
export class PostgresPermissionAdministration {
  constructor(private readonly client: TransactionalClient, private readonly testHook?: PermissionAdministrationTestHook) {}
  private require(actor: StaffPrincipal, capability: Capability): void {
    if (actor.authority.source !== "permission_set") throw new V2ApplicationError("FORBIDDEN", "Temporary authority cannot administer final permission sets.");
    if (!actor.authority.capabilities.includes(capability)) throw new V2ApplicationError("FORBIDDEN", `Missing ${capability}.`);
  }
  private ensureGrantCeiling(actor: StaffPrincipal, capabilities: readonly string[]): Capability[] {
    const result: Capability[] = [];
    for (const value of capabilities) {
      if (!isCapability(value)) throw new V2ApplicationError("VALIDATION_ERROR", "Unknown capability.");
      if (!actor.authority.capabilities.includes(value)) throw new V2ApplicationError("FORBIDDEN", "Permission administrators cannot grant a capability they do not currently hold.");
      result.push(value);
    }
    return [...new Set(result)].sort();
  }
  /** A set is grantable only when every current capability in it is already held by the administrator. */
  private async assertSetGrantCeiling(actor: StaffPrincipal, organizationId: string, permissionSetId: string, kind?: "staff" | "portal"): Promise<Capability[]> {
    const set = await this.client.query<{ capability_id: string | null; capability_active: boolean | null }>(`SELECT c.capability_id,catalog.active AS capability_active FROM v2_permission_sets s
      LEFT JOIN v2_permission_set_capabilities c ON c.organization_id=s.organization_id AND c.permission_set_id=s.id
      LEFT JOIN v2_permission_capabilities catalog ON catalog.id=c.capability_id AND catalog.active=true
      WHERE s.id=$1 AND s.organization_id=$2${kind ? ` AND s.principal_kind='${kind}'` : ""} FOR UPDATE OF s`, [permissionSetId, organizationId]);
    if (set.rowCount === 0) throw new V2ApplicationError("NOT_FOUND", "Scoped permission set was not found.");
    this.ensureGrantCeiling(actor, set.rows.flatMap((row) => row.capability_id && row.capability_active ? [row.capability_id] : []));
    return [...new Set(set.rows.flatMap((row) => row.capability_id ? [row.capability_id] : []))].sort() as Capability[];
  }
  /** Tenant copies of system templates remain assignable but are never a
   * mutable second authority. Only custom sets may be edited/deactivated. */
  private async assertCustomSet(organizationId: string, permissionSetId: string): Promise<void> {
    const result = await this.client.query<{ source_template_key: string | null }>("SELECT source_template_key FROM v2_permission_sets WHERE id=$1 AND organization_id=$2 FOR UPDATE", [permissionSetId, organizationId]);
    if (!result.rows[0]) throw new V2ApplicationError("NOT_FOUND", "Permission set was not found.");
    if (result.rows[0].source_template_key !== null) throw new V2ApplicationError("FORBIDDEN", "System permission sets are managed templates and cannot be edited.");
  }
  private async lock(organizationId: string): Promise<string> {
    const result = await this.client.query("SELECT id FROM organizations WHERE id = $1 FOR UPDATE", [organizationId]);
    if (result.rowCount !== 1) throw new V2ApplicationError("NOT_FOUND", "Organization was not found.");
    await this.client.query("INSERT INTO v2_permission_organization_state(organization_id) VALUES ($1) ON CONFLICT DO NOTHING", [organizationId]);
    const state=await this.client.query<{authority_revision:string}>("SELECT authority_revision FROM v2_permission_organization_state WHERE organization_id=$1 FOR UPDATE",[organizationId]);
    return state.rows[0].authority_revision;
  }
  private async floor(organizationId: string): Promise<void> {
    const result = await this.client.query<{ user_id: string }>(`SELECT a.user_id FROM v2_staff_permission_set_assignments a
      JOIN user_organizations m ON m.user_id=a.user_id AND m.organization_id=a.organization_id AND m.is_active=true
      JOIN v2_permission_sets s ON s.id=a.permission_set_id AND s.organization_id=a.organization_id AND s.active=true
      JOIN v2_permission_set_capabilities c ON c.permission_set_id=s.id AND c.organization_id=s.organization_id
      JOIN v2_permission_capabilities catalog ON catalog.id=c.capability_id AND catalog.active=true
      WHERE a.organization_id=$1 AND a.active=true AND c.capability_id IN ('permissions.manageSets','permissions.assignStaff')
      GROUP BY a.user_id HAVING count(DISTINCT c.capability_id)=2 LIMIT 1`, [organizationId]);
    if (result.rowCount === 0) throw new V2ApplicationError("CONFLICT", "The final permission administrator cannot be removed or weakened.");
  }
  private async audit(actor: StaffPrincipal, organizationId: string, eventType: string, target: AuditTarget, detail: Record<string, unknown>, context: PermissionAdministrationOperationContext): Promise<void> {
    await this.client.query(`INSERT INTO v2_permission_audit_events(organization_id,event_type,actor_principal_kind,actor_principal_subject,staff_actor_user_id,permission_set_id,target_user_id,portal_access_id,customer_id,correlation_id,detail)
      VALUES($1,$2,'staff',$3,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [organizationId,eventType,actor.userId,target.permissionSetId ?? null,target.userId ?? null,target.portalAccessId ?? null,target.customerId ?? null,context.correlationId,JSON.stringify({...detail,businessRequestId:context.businessRequestId})]);
  }
  private async advanceRevision(organizationId: string): Promise<void> {
    await this.client.query("UPDATE v2_permission_organization_state SET authority_revision=authority_revision+1, updated_at=now() WHERE organization_id=$1", [organizationId]);
  }
  private async mutate(actor: StaffPrincipal, organizationId: string, required: Capability, eventType: string, target: AuditTarget, detail: Record<string, unknown>, context: PermissionAdministrationOperationContext, action: () => Promise<boolean>, needsFloor = true): Promise<void> {
    if (actor.organizationId !== organizationId) throw new V2ApplicationError("WRONG_TENANT", "Permission administration is organization scoped.");
    if (!context.correlationId.trim() || !context.businessRequestId.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "Permission administration requires correlation and business request identity.");
    this.require(actor, required); await this.client.query("BEGIN");
    try { await this.testHook?.beforeOrganizationLock?.(eventType); const currentRevision=await this.lock(organizationId); if (actor.authority.authorityRevision !== currentRevision) throw new V2ApplicationError("STALE_STATE","Permission authority must be re-issued before administration."); const changed=await action(); if (!changed) { await this.client.query("COMMIT"); return; } await this.testHook?.afterMutation?.(eventType); if (needsFloor) await this.floor(organizationId); await this.audit(actor,organizationId,eventType,target,detail,context); await this.testHook?.afterAudit?.(eventType); await this.advanceRevision(organizationId); await this.testHook?.afterRevision?.(eventType); await this.client.query("COMMIT"); }
    catch (error) { try { await this.client.query("ROLLBACK"); } catch { /* preserve the original error */ } throw error; }
  }
  async createSet(actor: StaffPrincipal, input: { organizationId: string; name: string; description?: string; principalKind?: "staff" | "portal"; capabilities: readonly string[] }, context: PermissionAdministrationOperationContext): Promise<string> {
    const capabilities = this.ensureGrantCeiling(actor,input.capabilities); const id = crypto.randomUUID();
    await this.mutate(actor,input.organizationId,"permissions.manageSets","permission_set_created",{permissionSetId:id},{name:input.name,capabilities},context,async()=>{
      if (!input.name.trim()) throw new V2ApplicationError("VALIDATION_ERROR","Permission-set name is required.");
      await this.client.query("INSERT INTO v2_permission_sets(id,organization_id,name,normalized_name,description,principal_kind) VALUES($1,$2,$3,$4,$5,$6)",[id,input.organizationId,input.name.trim(),normalized(input.name),input.description ?? null,input.principalKind ?? "staff"]);
      for (const capability of capabilities) await this.client.query("INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id) VALUES($1,$2,$3)",[input.organizationId,id,capability]); return true;
    }); return id;
  }
  async setCapabilities(actor: StaffPrincipal, organizationId: string, permissionSetId: string, requested: readonly string[], context: PermissionAdministrationOperationContext): Promise<void> {
    const capabilities=this.ensureGrantCeiling(actor,requested); const detail: Record<string,unknown>={capabilities}; await this.mutate(actor,organizationId,"permissions.manageSets","permission_set_capabilities_changed",{permissionSetId},detail,context,async()=>{await this.assertCustomSet(organizationId,permissionSetId);const current=await this.assertSetGrantCeiling(actor,organizationId,permissionSetId); if(sameValues(current,capabilities)) return false; detail.added=capabilities.filter((value)=>!current.includes(value)); detail.removed=current.filter((value)=>!capabilities.includes(value));
      await this.client.query("DELETE FROM v2_permission_set_capabilities WHERE organization_id=$1 AND permission_set_id=$2",[organizationId,permissionSetId]);
      for (const capability of capabilities) await this.client.query("INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id) VALUES($1,$2,$3)",[organizationId,permissionSetId,capability]);
      const updated=await this.client.query("UPDATE v2_permission_sets SET revision=revision+1,updated_at=now() WHERE id=$1 AND organization_id=$2",[permissionSetId,organizationId]); if(updated.rowCount!==1) throw new V2ApplicationError("NOT_FOUND","Permission set was not found."); return true;
    });
  }
  async setActive(actor: StaffPrincipal, organizationId: string, permissionSetId: string, active: boolean, context: PermissionAdministrationOperationContext): Promise<void> {
    await this.mutate(actor,organizationId,"permissions.manageSets","permission_set_activation_changed",{permissionSetId},{active},context,async()=>{await this.assertCustomSet(organizationId,permissionSetId);await this.assertSetGrantCeiling(actor,organizationId,permissionSetId);const updated=await this.client.query("UPDATE v2_permission_sets SET active=$3,revision=revision+1,updated_at=now() WHERE id=$1 AND organization_id=$2 AND active IS DISTINCT FROM $3",[permissionSetId,organizationId,active]);if(updated.rowCount===1)return true;const found=await this.client.query("SELECT 1 FROM v2_permission_sets WHERE id=$1 AND organization_id=$2",[permissionSetId,organizationId]);if(found.rowCount!==1)throw new V2ApplicationError("NOT_FOUND","Permission set was not found.");return false;});
  }
  async assignStaff(actor: StaffPrincipal, organizationId: string, userId: string, permissionSetId: string, context: PermissionAdministrationOperationContext): Promise<void> {
    await this.mutate(actor,organizationId,"permissions.assignStaff","staff_permission_set_assigned",{userId,permissionSetId},{},context,async()=>{await this.assertSetGrantCeiling(actor,organizationId,permissionSetId,"staff");const inserted=await this.client.query(`INSERT INTO v2_staff_permission_set_assignments(organization_id,user_id,permission_set_id)
      SELECT $1::varchar,$2::varchar,$3::varchar WHERE EXISTS(SELECT 1 FROM user_organizations WHERE user_id=$2::varchar AND organization_id=$1::varchar AND is_active) AND EXISTS(SELECT 1 FROM v2_permission_sets WHERE id=$3::varchar AND organization_id=$1::varchar AND principal_kind='staff')
      ON CONFLICT(organization_id,user_id,permission_set_id) DO UPDATE SET active=true,updated_at=now() WHERE v2_staff_permission_set_assignments.active=false`,[organizationId,userId,permissionSetId]);if(inserted.rowCount===1)return true;const membership=await this.client.query("SELECT 1 FROM user_organizations WHERE user_id=$1 AND organization_id=$2 AND is_active",[userId,organizationId]);if(membership.rowCount!==1)throw new V2ApplicationError("NOT_FOUND","Scoped Staff membership or Staff permission set was not found.");return false;});
  }
  async removeStaff(actor: StaffPrincipal, organizationId: string, userId: string, permissionSetId: string, context: PermissionAdministrationOperationContext): Promise<void> {
    await this.mutate(actor,organizationId,"permissions.assignStaff","staff_permission_set_removed",{userId,permissionSetId},{},context,async()=>{await this.assertSetGrantCeiling(actor,organizationId,permissionSetId,"staff");const updated=await this.client.query("UPDATE v2_staff_permission_set_assignments SET active=false,updated_at=now() WHERE organization_id=$1 AND user_id=$2 AND permission_set_id=$3 AND active=true",[organizationId,userId,permissionSetId]);if(updated.rowCount===1)return true;const found=await this.client.query("SELECT 1 FROM v2_staff_permission_set_assignments WHERE organization_id=$1 AND user_id=$2 AND permission_set_id=$3",[organizationId,userId,permissionSetId]);if(found.rowCount!==1)throw new V2ApplicationError("NOT_FOUND","Scoped Staff assignment was not found.");return false;});
  }
  async assignPortal(actor: StaffPrincipal, organizationId: string, portalAccessId: string, permissionSetId: string, context: PermissionAdministrationOperationContext): Promise<void> {
    await this.mutate(actor,organizationId,"permissions.assignPortal","portal_permission_set_assigned",{portalAccessId,permissionSetId},{},context,async()=>{await this.assertSetGrantCeiling(actor,organizationId,permissionSetId,"portal");const inserted=await this.client.query(`INSERT INTO v2_portal_permission_set_assignments(organization_id,portal_access_id,permission_set_id)
      SELECT $1::varchar,$2::varchar,$3::varchar WHERE EXISTS(SELECT 1 FROM customer_portal_access WHERE id=$2::varchar AND organization_id=$1::varchar) AND EXISTS(SELECT 1 FROM v2_permission_sets WHERE id=$3::varchar AND organization_id=$1::varchar AND principal_kind='portal')
      ON CONFLICT(organization_id,portal_access_id,permission_set_id) DO UPDATE SET active=true,updated_at=now() WHERE v2_portal_permission_set_assignments.active=false`,[organizationId,portalAccessId,permissionSetId]);if(inserted.rowCount===1)return true;const access=await this.client.query("SELECT 1 FROM customer_portal_access WHERE id=$1 AND organization_id=$2",[portalAccessId,organizationId]);if(access.rowCount!==1)throw new V2ApplicationError("NOT_FOUND","Scoped Portal access or Portal permission set was not found.");return false;},false);
  }
  async removePortal(actor: StaffPrincipal, organizationId: string, portalAccessId: string, permissionSetId: string, context: PermissionAdministrationOperationContext): Promise<void> {
    await this.mutate(actor,organizationId,"permissions.assignPortal","portal_permission_set_removed",{portalAccessId,permissionSetId},{},context,async()=>{await this.assertSetGrantCeiling(actor,organizationId,permissionSetId,"portal");const updated=await this.client.query("UPDATE v2_portal_permission_set_assignments SET active=false,updated_at=now() WHERE organization_id=$1 AND portal_access_id=$2 AND permission_set_id=$3 AND active=true",[organizationId,portalAccessId,permissionSetId]);if(updated.rowCount===1)return true;const found=await this.client.query("SELECT 1 FROM v2_portal_permission_set_assignments WHERE organization_id=$1 AND portal_access_id=$2 AND permission_set_id=$3",[organizationId,portalAccessId,permissionSetId]);if(found.rowCount!==1)throw new V2ApplicationError("NOT_FOUND","Scoped Portal assignment was not found.");return false;},false);
  }
  async updateSet(actor: StaffPrincipal, organizationId: string, permissionSetId: string, input: { name: string; description?: string }, context: PermissionAdministrationOperationContext): Promise<void> {
    const detail: Record<string,unknown>={name:input.name.trim()}; await this.mutate(actor,organizationId,"permissions.manageSets","permission_set_updated",{permissionSetId},detail,context,async()=>{if(!input.name.trim())throw new V2ApplicationError("VALIDATION_ERROR","Permission-set name is required.");await this.assertCustomSet(organizationId,permissionSetId);const description=input.description ?? null;const current=await this.client.query<{name:string;description:string|null}>("SELECT name,description FROM v2_permission_sets WHERE id=$1 AND organization_id=$2 FOR UPDATE",[permissionSetId,organizationId]);if(current.rowCount!==1)throw new V2ApplicationError("NOT_FOUND","Permission set was not found.");if(current.rows[0].name===input.name.trim() && current.rows[0].description===description)return false;detail.previousName=current.rows[0].name;detail.descriptionChanged=current.rows[0].description!==description;await this.client.query("UPDATE v2_permission_sets SET name=$3,normalized_name=$4,description=$5,revision=revision+1,updated_at=now() WHERE id=$1 AND organization_id=$2",[permissionSetId,organizationId,input.name.trim(),normalized(input.name),description]);return true;});
  }
  async setCustomerPortalCeiling(actor: StaffPrincipal, organizationId: string, customerId: string, requested: readonly string[], context: PermissionAdministrationOperationContext): Promise<void> {
    const capabilities=this.ensureGrantCeiling(actor,requested); const detail: Record<string,unknown>={capabilities}; await this.mutate(actor,organizationId,"permissions.assignPortal","customer_portal_ceiling_changed",{customerId},detail,context,async()=>{const policy=await this.client.query("SELECT 1 FROM v2_customer_portal_ceiling_policies WHERE organization_id=$1 AND customer_id=$2 FOR UPDATE",[organizationId,customerId]);const currentResult=policy.rowCount===1
      ? await this.client.query<{capability_id:string}>("SELECT capability_id FROM v2_customer_portal_ceiling_capabilities WHERE organization_id=$1 AND customer_id=$2 ORDER BY capability_id",[organizationId,customerId])
      : await this.client.query<{capability_id:string}>("SELECT capability_id FROM v2_organization_portal_capability_defaults WHERE organization_id=$1 ORDER BY capability_id",[organizationId]);const current=this.ensureGrantCeiling(actor,currentResult.rows.map((row)=>row.capability_id));if(policy.rowCount===1 && sameValues(current,capabilities))return false;detail.previousCapabilities=current;detail.previousSource=policy.rowCount===1?"explicit":"organization_default";detail.added=capabilities.filter((value)=>!current.includes(value));detail.removed=current.filter((value)=>!capabilities.includes(value));const customer=await this.client.query("SELECT 1 FROM customers WHERE id=$1 AND organization_id=$2",[customerId,organizationId]);if(customer.rowCount!==1)throw new V2ApplicationError("NOT_FOUND","Scoped customer was not found.");await this.client.query("INSERT INTO v2_customer_portal_ceiling_policies(organization_id,customer_id) VALUES($1,$2) ON CONFLICT(organization_id,customer_id) DO UPDATE SET revision=v2_customer_portal_ceiling_policies.revision+1,updated_at=now()",[organizationId,customerId]);await this.client.query("DELETE FROM v2_customer_portal_ceiling_capabilities WHERE organization_id=$1 AND customer_id=$2",[organizationId,customerId]);for(const capability of capabilities)await this.client.query("INSERT INTO v2_customer_portal_ceiling_capabilities(organization_id,customer_id,capability_id) VALUES($1,$2,$3)",[organizationId,customerId,capability]);return true;},false);
  }
}
