import type { Pool } from "pg";
import type { PortalPrincipal } from "../../src/authorization/principals.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { portalCustomerContact, type PortalOrderIdentityRead } from "../../src/modules/portal/portalOrderCreation.js";

/** Freshly resolves a portal session to its active CRM access/link for creation. */
export class PostgresPortalOrderIdentityRead implements PortalOrderIdentityRead {
  constructor(private readonly pool:Pool) {}
  async customerContact(principal:PortalPrincipal) {
    const result=await this.pool.query<{contact_id:string}>(`SELECT access.contact_id FROM customer_portal_access access JOIN customer_contacts contact ON contact.organization_id=access.organization_id AND contact.id=access.contact_id AND contact.status='active' JOIN customer_contact_links link ON link.organization_id=access.organization_id AND link.customer_id=access.customer_id AND link.contact_id=access.contact_id AND link.status='active' WHERE access.organization_id=$1 AND access.customer_id=$2 AND access.user_id=$3 AND access.status='ACTIVE' LIMIT 1`,[principal.organizationId,principal.customerId,principal.subjectId]);
    const contactId=result.rows[0]?.contact_id;
    if(!contactId)throw new V2ApplicationError("FORBIDDEN","An active customer contact is required to create an Order.");
    return portalCustomerContact(principal.organizationId,principal.customerId,contactId);
  }
}
