import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { TransactionalClient } from "../persistence/types.js";

type LegacyRole = "owner" | "admin" | "manager" | "member";
const templateFor: Record<LegacyRole,string>={owner:"owner",admin:"administrator",manager:"manager",member:"staff_basic"};

/** One-time/new-organization bootstrap support, never used during principal issuance. */
export class PostgresPermissionBootstrap {
  constructor(private readonly client: TransactionalClient) {}
  async bootstrapLegacyMembership(input: { organizationId: string; userId: string; correlationId: string; businessRequestId: string }): Promise<void> {
    if (!input.correlationId.trim() || !input.businessRequestId.trim()) throw new V2ApplicationError("VALIDATION_ERROR","Permission bootstrap requires correlation and business request identity.");
    await this.client.query("BEGIN");
    try {
      const org=await this.client.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE",[input.organizationId]); if(org.rowCount!==1)throw new V2ApplicationError("NOT_FOUND","Organization was not found.");
      const membership=await this.client.query<{role:LegacyRole}>("SELECT role FROM user_organizations WHERE user_id=$1 AND organization_id=$2 AND is_active=true FOR UPDATE",[input.userId,input.organizationId]); if(membership.rowCount!==1)throw new V2ApplicationError("NOT_FOUND","Active scoped Staff membership was not found.");
      const role=membership.rows[0].role; if (!(role in templateFor)) throw new V2ApplicationError("FORBIDDEN","Unsupported legacy membership role cannot be bootstrapped.");
      const initialized=await this.client.query("INSERT INTO v2_permission_organization_state(organization_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING organization_id",[input.organizationId]);
      if(initialized.rowCount){
        await this.client.query(`INSERT INTO v2_permission_sets(organization_id,name,normalized_name,source_template_key,principal_kind)
          SELECT $1,t.name,lower(t.name),t.template_key,t.principal_kind FROM v2_permission_set_templates t ON CONFLICT(organization_id,normalized_name) DO NOTHING`,[input.organizationId]);
        await this.client.query(`INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id)
          SELECT ps.organization_id,ps.id,c.capability_id FROM v2_permission_sets ps JOIN v2_permission_set_templates t ON t.template_key=ps.source_template_key JOIN v2_permission_set_template_capabilities c ON c.template_id=t.id WHERE ps.organization_id=$1 ON CONFLICT DO NOTHING`,[input.organizationId]);
        await this.client.query("INSERT INTO v2_organization_portal_capability_defaults(organization_id,capability_id) SELECT $1,c.capability_id FROM (VALUES('quote.view'),('order.view'),('invoice.view'),('proof.respond'),('payment.view'),('payment.record')) c(capability_id) ON CONFLICT DO NOTHING",[input.organizationId]);
      }
      const alreadyBootstrapped=await this.client.query("SELECT 1 FROM v2_staff_permission_set_assignments WHERE organization_id=$1 AND user_id=$2 AND assignment_source='legacy_role_bootstrap' LIMIT 1",[input.organizationId,input.userId]);
      const assigned=alreadyBootstrapped.rowCount ? {rowCount:0,rows:[] as {permission_set_id:string}[]} : await this.client.query<{permission_set_id:string}>(`INSERT INTO v2_staff_permission_set_assignments(organization_id,user_id,permission_set_id,assignment_source,bootstrap_legacy_role)
        SELECT $1::varchar,$2::varchar,ps.id,'legacy_role_bootstrap',$3::varchar FROM v2_permission_sets ps WHERE ps.organization_id=$1::varchar AND ps.source_template_key=$4::varchar
        ON CONFLICT(organization_id,user_id,permission_set_id) DO NOTHING RETURNING permission_set_id`,[input.organizationId,input.userId,role,templateFor[role]]);
      if(assigned.rowCount){await this.client.query("INSERT INTO v2_permission_audit_events(organization_id,event_type,actor_principal_kind,actor_principal_subject,permission_set_id,target_user_id,correlation_id,detail) VALUES($1,'staff_assignment_bootstrapped','service','m1.5-bootstrap',$2,$3,$4,$5::jsonb)",[input.organizationId,assigned.rows[0].permission_set_id,input.userId,input.correlationId,JSON.stringify({source:"legacy_role_bootstrap",legacyRole:role,businessRequestId:input.businessRequestId})]);}
      const admins=await this.client.query(`SELECT 1 FROM v2_staff_permission_set_assignments a JOIN user_organizations m ON m.user_id=a.user_id AND m.organization_id=a.organization_id AND m.is_active JOIN v2_permission_sets s ON s.id=a.permission_set_id AND s.organization_id=a.organization_id AND s.active JOIN v2_permission_set_capabilities c ON c.permission_set_id=s.id AND c.organization_id=s.organization_id JOIN v2_permission_capabilities catalog ON catalog.id=c.capability_id AND catalog.active WHERE a.organization_id=$1 AND a.active AND c.capability_id IN ('permissions.manageSets','permissions.assignStaff') GROUP BY a.user_id HAVING count(DISTINCT c.capability_id)=2 LIMIT 1`,[input.organizationId]);
      if(assigned.rowCount) await this.client.query("UPDATE v2_permission_organization_state SET admin_floor_enforced=$2,authority_revision=authority_revision+1,updated_at=now() WHERE organization_id=$1",[input.organizationId,admins.rowCount===1]); await this.client.query("COMMIT");
    } catch(error) {try{await this.client.query("ROLLBACK");}catch{}throw error;}
  }
}
