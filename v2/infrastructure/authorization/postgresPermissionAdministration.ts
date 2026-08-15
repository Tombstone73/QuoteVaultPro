import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { isCapability, type Capability } from "../../src/authorization/capabilities.js";
import type { StaffPrincipal } from "../../src/authorization/principals.js";
import type { TransactionalClient } from "../persistence/types.js";

type AuditTarget = Readonly<{ permissionSetId?: string; userId?: string; portalAccessId?: string; customerId?: string }>;
const normalized = (name: string) => name.trim().toLocaleLowerCase();

/**
 * Transactional permission administration. This class owns one transaction per
 * public operation, locks the tenant before every mutable authority
 * change, writes one semantic audit event, and bumps the authority revision.
 */
export class PostgresPermissionAdministration {
  constructor(private readonly client: TransactionalClient) {}
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
  private async lock(organizationId: string): Promise<void> {
    const result = await this.client.query("SELECT id FROM organizations WHERE id = $1 FOR UPDATE", [organizationId]);
    if (result.rowCount !== 1) throw new V2ApplicationError("NOT_FOUND", "Organization was not found.");
    await this.client.query("INSERT INTO v2_permission_organization_state(organization_id) VALUES ($1) ON CONFLICT DO NOTHING", [organizationId]);
  }
  private async floor(organizationId: string): Promise<void> {
    const result = await this.client.query<{ user_id: string }>(`SELECT a.user_id FROM v2_staff_permission_set_assignments a
      JOIN user_organizations m ON m.user_id=a.user_id AND m.organization_id=a.organization_id AND m.is_active=true
      JOIN v2_permission_sets s ON s.id=a.permission_set_id AND s.organization_id=a.organization_id AND s.active=true
      JOIN v2_permission_set_capabilities c ON c.permission_set_id=s.id AND c.organization_id=s.organization_id
      WHERE a.organization_id=$1 AND a.active=true AND c.capability_id IN ('permissions.manageSets','permissions.assignStaff')
      GROUP BY a.user_id HAVING count(DISTINCT c.capability_id)=2 LIMIT 1`, [organizationId]);
    if (result.rowCount === 0) throw new V2ApplicationError("CONFLICT", "The final permission administrator cannot be removed or weakened.");
  }
  private async audit(actor: StaffPrincipal, organizationId: string, eventType: string, target: AuditTarget, detail: Record<string, unknown>): Promise<void> {
    await this.client.query(`INSERT INTO v2_permission_audit_events(organization_id,event_type,actor_principal_kind,actor_principal_subject,staff_actor_user_id,permission_set_id,target_user_id,portal_access_id,customer_id,detail)
      VALUES($1,$2,'staff',$3,$3,$4,$5,$6,$7,$8::jsonb)`, [organizationId,eventType,actor.userId,target.permissionSetId ?? null,target.userId ?? null,target.portalAccessId ?? null,target.customerId ?? null,JSON.stringify(detail)]);
    await this.client.query("UPDATE v2_permission_organization_state SET authority_revision=authority_revision+1, updated_at=now() WHERE organization_id=$1", [organizationId]);
  }
  private async mutate(actor: StaffPrincipal, organizationId: string, required: Capability, eventType: string, target: AuditTarget, detail: Record<string, unknown>, action: () => Promise<void>, needsFloor = true): Promise<void> {
    if (actor.organizationId !== organizationId) throw new V2ApplicationError("WRONG_TENANT", "Permission administration is organization scoped.");
    this.require(actor, required); await this.client.query("BEGIN");
    try { await this.lock(organizationId); await action(); if (needsFloor) await this.floor(organizationId); await this.audit(actor,organizationId,eventType,target,detail); await this.client.query("COMMIT"); }
    catch (error) { try { await this.client.query("ROLLBACK"); } catch { /* preserve the original error */ } throw error; }
  }
  async createSet(actor: StaffPrincipal, input: { organizationId: string; name: string; description?: string; principalKind?: "staff" | "portal"; capabilities: readonly string[] }): Promise<string> {
    const capabilities = this.ensureGrantCeiling(actor,input.capabilities); const id = crypto.randomUUID();
    await this.mutate(actor,input.organizationId,"permissions.manageSets","permission_set_created",{permissionSetId:id},{name:input.name,capabilities},async()=>{
      if (!input.name.trim()) throw new V2ApplicationError("VALIDATION_ERROR","Permission-set name is required.");
      await this.client.query("INSERT INTO v2_permission_sets(id,organization_id,name,normalized_name,description,principal_kind) VALUES($1,$2,$3,$4,$5,$6)",[id,input.organizationId,input.name.trim(),normalized(input.name),input.description ?? null,input.principalKind ?? "staff"]);
      for (const capability of capabilities) await this.client.query("INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id) VALUES($1,$2,$3)",[input.organizationId,id,capability]);
    }); return id;
  }
  async setCapabilities(actor: StaffPrincipal, organizationId: string, permissionSetId: string, requested: readonly string[]): Promise<void> {
    const capabilities=this.ensureGrantCeiling(actor,requested); await this.mutate(actor,organizationId,"permissions.manageSets","permission_set_capabilities_changed",{permissionSetId},{capabilities},async()=>{
      const found=await this.client.query("SELECT id FROM v2_permission_sets WHERE id=$1 AND organization_id=$2 FOR UPDATE",[permissionSetId,organizationId]); if(found.rowCount!==1) throw new V2ApplicationError("NOT_FOUND","Permission set was not found.");
      await this.client.query("DELETE FROM v2_permission_set_capabilities WHERE organization_id=$1 AND permission_set_id=$2",[organizationId,permissionSetId]);
      for (const capability of capabilities) await this.client.query("INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id) VALUES($1,$2,$3)",[organizationId,permissionSetId,capability]);
      const updated=await this.client.query("UPDATE v2_permission_sets SET revision=revision+1,updated_at=now() WHERE id=$1 AND organization_id=$2",[permissionSetId,organizationId]); if(updated.rowCount!==1) throw new V2ApplicationError("NOT_FOUND","Permission set was not found.");
    });
  }
  async setActive(actor: StaffPrincipal, organizationId: string, permissionSetId: string, active: boolean): Promise<void> {
    await this.mutate(actor,organizationId,"permissions.manageSets","permission_set_activation_changed",{permissionSetId},{active},async()=>{const updated=await this.client.query("UPDATE v2_permission_sets SET active=$3,revision=revision+1,updated_at=now() WHERE id=$1 AND organization_id=$2",[permissionSetId,organizationId,active]);if(updated.rowCount!==1)throw new V2ApplicationError("NOT_FOUND","Permission set was not found.");});
  }
  async assignStaff(actor: StaffPrincipal, organizationId: string, userId: string, permissionSetId: string): Promise<void> {
    await this.mutate(actor,organizationId,"permissions.assignStaff","staff_permission_set_assigned",{userId,permissionSetId},{},async()=>{const inserted=await this.client.query(`INSERT INTO v2_staff_permission_set_assignments(organization_id,user_id,permission_set_id)
      SELECT $1,$2,$3 WHERE EXISTS(SELECT 1 FROM user_organizations WHERE user_id=$2 AND organization_id=$1 AND is_active) AND EXISTS(SELECT 1 FROM v2_permission_sets WHERE id=$3 AND organization_id=$1 AND principal_kind='staff')
      ON CONFLICT(organization_id,user_id,permission_set_id) DO UPDATE SET active=true,updated_at=now()`,[organizationId,userId,permissionSetId]);if(inserted.rowCount!==1)throw new V2ApplicationError("NOT_FOUND","Scoped Staff membership or Staff permission set was not found.");});
  }
  async removeStaff(actor: StaffPrincipal, organizationId: string, userId: string, permissionSetId: string): Promise<void> {
    await this.mutate(actor,organizationId,"permissions.assignStaff","staff_permission_set_removed",{userId,permissionSetId},{},async()=>{const updated=await this.client.query("UPDATE v2_staff_permission_set_assignments SET active=false,updated_at=now() WHERE organization_id=$1 AND user_id=$2 AND permission_set_id=$3 AND active=true",[organizationId,userId,permissionSetId]);if(updated.rowCount!==1)throw new V2ApplicationError("NOT_FOUND","Active scoped Staff assignment was not found.");});
  }
  async assignPortal(actor: StaffPrincipal, organizationId: string, portalAccessId: string, permissionSetId: string): Promise<void> {
    await this.mutate(actor,organizationId,"permissions.assignPortal","portal_permission_set_assigned",{portalAccessId,permissionSetId},{},async()=>{const inserted=await this.client.query(`INSERT INTO v2_portal_permission_set_assignments(organization_id,portal_access_id,permission_set_id)
      SELECT $1,$2,$3 WHERE EXISTS(SELECT 1 FROM customer_portal_access WHERE id=$2 AND organization_id=$1) AND EXISTS(SELECT 1 FROM v2_permission_sets WHERE id=$3 AND organization_id=$1 AND principal_kind='portal')
      ON CONFLICT(organization_id,portal_access_id,permission_set_id) DO UPDATE SET active=true,updated_at=now()`,[organizationId,portalAccessId,permissionSetId]);if(inserted.rowCount!==1)throw new V2ApplicationError("NOT_FOUND","Scoped Portal access or Portal permission set was not found.");},false);
  }
  async removePortal(actor: StaffPrincipal, organizationId: string, portalAccessId: string, permissionSetId: string): Promise<void> {
    await this.mutate(actor,organizationId,"permissions.assignPortal","portal_permission_set_removed",{portalAccessId,permissionSetId},{},async()=>{const updated=await this.client.query("UPDATE v2_portal_permission_set_assignments SET active=false,updated_at=now() WHERE organization_id=$1 AND portal_access_id=$2 AND permission_set_id=$3 AND active=true",[organizationId,portalAccessId,permissionSetId]);if(updated.rowCount!==1)throw new V2ApplicationError("NOT_FOUND","Active scoped Portal assignment was not found.");},false);
  }
  async updateSet(actor: StaffPrincipal, organizationId: string, permissionSetId: string, input: { name: string; description?: string }): Promise<void> {
    await this.mutate(actor,organizationId,"permissions.manageSets","permission_set_updated",{permissionSetId},{name:input.name},async()=>{if(!input.name.trim())throw new V2ApplicationError("VALIDATION_ERROR","Permission-set name is required.");const updated=await this.client.query("UPDATE v2_permission_sets SET name=$3,normalized_name=$4,description=$5,revision=revision+1,updated_at=now() WHERE id=$1 AND organization_id=$2",[permissionSetId,organizationId,input.name.trim(),normalized(input.name),input.description ?? null]);if(updated.rowCount!==1)throw new V2ApplicationError("NOT_FOUND","Permission set was not found.");});
  }
  async setCustomerPortalCeiling(actor: StaffPrincipal, organizationId: string, customerId: string, requested: readonly string[]): Promise<void> {
    const capabilities=this.ensureGrantCeiling(actor,requested); await this.mutate(actor,organizationId,"permissions.assignPortal","customer_portal_ceiling_changed",{customerId},{capabilities},async()=>{await this.client.query("INSERT INTO v2_customer_portal_ceiling_policies(organization_id,customer_id) VALUES($1,$2) ON CONFLICT(organization_id,customer_id) DO UPDATE SET revision=v2_customer_portal_ceiling_policies.revision+1,updated_at=now()",[organizationId,customerId]);await this.client.query("DELETE FROM v2_customer_portal_ceiling_capabilities WHERE organization_id=$1 AND customer_id=$2",[organizationId,customerId]);for(const capability of capabilities)await this.client.query("INSERT INTO v2_customer_portal_ceiling_capabilities(organization_id,customer_id,capability_id) VALUES($1,$2,$3)",[organizationId,customerId,capability]);},false);
  }
}
