import type { PoolClient } from "pg";
import type { ProofRecipientAccess, ProofRecipientAccessInput, ProofRecipientAccessResult } from "../../src/authorization/proofRecipientAccess.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";

type AccessRow = { id: string; status: string };

/** Uses the caller's existing transaction; Proofing retains authorization and replay coordination. */
export class PostgresProofRecipientAccess implements ProofRecipientAccess {
  constructor(private readonly client: PoolClient) {}

  async ensureForProofIssue(input: ProofRecipientAccessInput): Promise<ProofRecipientAccessResult> {
    if (!input.recipientContactId?.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "Choose a customer contact before issuing this Proof.");
    await this.client.query("SELECT v2_assert_authority_entry($1)",[input.organizationId]);
    const recipient = await this.client.query<{ contact_id: string; customer_id: string; email: string; display_name: string }>(`SELECT c.id contact_id,d.customer_id,lower(btrim(c.email)) email,COALESCE(NULLIF(btrim(concat_ws(' ',c.first_name,c.last_name)),''),c.email) display_name
      FROM v2_proof_versions v JOIN v2_proof_works w ON w.organization_id=v.organization_id AND w.id=v.proof_work_id
      JOIN v2_sales_documents d ON d.organization_id=w.organization_id AND d.id=w.order_document_id
      JOIN customer_contacts c ON c.organization_id=d.organization_id AND c.id=$3 AND c.status='active'
      WHERE v.organization_id=$1 AND v.id=$2 AND d.customer_id IS NOT NULL
        AND (d.contact_id=c.id OR c.customer_id=d.customer_id OR EXISTS(SELECT 1 FROM customer_contact_links l WHERE l.organization_id=d.organization_id AND l.customer_id=d.customer_id AND l.contact_id=c.id AND l.status='active'))
        AND btrim(COALESCE(c.email,'')) ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'`, [input.organizationId, input.proofVersionId, input.recipientContactId]);
    const contact = recipient.rows[0];
    if (!contact) throw new V2ApplicationError("VALIDATION_ERROR", "Choose an active customer contact with a valid email address for this Order.");
    let access = await this.client.query<AccessRow>("SELECT id,status::text FROM customer_portal_access WHERE organization_id=$1 AND contact_id=$2 FOR UPDATE", [input.organizationId, contact.contact_id]);
    if (access.rows[0] && access.rows[0].status !== "ACTIVE" && access.rows[0].status !== "PENDING_INVITE") throw new V2ApplicationError("CONFLICT", "That contact's portal access is suspended or disabled. Restore access before issuing the Proof.");
    if (!access.rows[0]) access = await this.client.query<AccessRow>("INSERT INTO customer_portal_access(organization_id,customer_id,contact_id,status,email,display_name,access_role,created_by_user_id,updated_by_user_id) VALUES($1,$2,$3,'PENDING_INVITE',$4,$5,'VIEWER',$6,$6) RETURNING id,status::text", [input.organizationId, contact.customer_id, contact.contact_id, contact.email, contact.display_name, input.staffActorUserId ?? null]);
    else await this.client.query("UPDATE customer_portal_access SET email=$3,display_name=$4,updated_by_user_id=COALESCE($5,updated_by_user_id),updated_at=now() WHERE organization_id=$1 AND id=$2", [input.organizationId, access.rows[0].id, contact.email, contact.display_name, input.staffActorUserId ?? null]);
    const permission = await this.client.query<{ id: string }>("SELECT id FROM v2_permission_sets WHERE organization_id=$1 AND source_template_key='customer_full_portal' AND active LIMIT 1", [input.organizationId]);
    if (!permission.rows[0]) throw new V2ApplicationError("CONFLICT", "Customer Portal permissions are not configured for this organization.");
    await this.client.query("INSERT INTO v2_portal_permission_set_assignments(organization_id,portal_access_id,permission_set_id,active) VALUES($1,$2,$3,true) ON CONFLICT(organization_id,portal_access_id,permission_set_id) DO UPDATE SET active=true,updated_at=now()", [input.organizationId, access.rows[0]!.id, permission.rows[0].id]);
    await this.client.query("SELECT v2_authority_changed($1)", [input.organizationId]);
    return { portalAccessId: access.rows[0]!.id, contactId: contact.contact_id, customerId: contact.customer_id, email: contact.email, displayName: contact.display_name };
  }
}
