import type { Pool } from "pg";
import type { PortalPrincipal } from "../../src/authorization/principals.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { PortalArtworkOwnershipRead } from "../../src/modules/portal/portalArtwork.js";

/**
 * Confirms both the current portal identity and the owned open Order line in
 * one server-side predicate.  It deliberately returns no existence detail to
 * a Customer who supplies another Customer's opaque IDs.
 */
export class PostgresPortalArtworkOwnershipRead implements PortalArtworkOwnershipRead {
  constructor(private readonly pool: Pool) {}

  async assertActiveOwnedOrderLine(principal: PortalPrincipal, orderId: string, orderLineId: string): Promise<void> {
    const found = await this.pool.query<{ allowed: boolean }>(
      `SELECT EXISTS(
        SELECT 1
        FROM customer_portal_access access
        JOIN customer_contacts contact
          ON contact.organization_id=access.organization_id
         AND contact.id=access.contact_id
         AND contact.status='active'
        JOIN customer_contact_links link
          ON link.organization_id=access.organization_id
         AND link.customer_id=access.customer_id
         AND link.contact_id=access.contact_id
         AND link.status='active'
        JOIN v2_sales_documents document
          ON document.organization_id=access.organization_id
         AND document.customer_id=access.customer_id
         AND document.id=$4
         AND document.document_kind='order'
        JOIN v2_sales_order_details order_detail
          ON order_detail.organization_id=document.organization_id
         AND order_detail.document_id=document.id
         AND order_detail.commercial_state='open'
        JOIN v2_sales_document_lines line
          ON line.organization_id=document.organization_id
         AND line.document_id=document.id
         AND line.id=$5
        WHERE access.organization_id=$1
          AND access.customer_id=$2
          AND access.user_id=$3
          AND access.status='ACTIVE'
      ) AS allowed`,
      [principal.organizationId, principal.customerId, principal.subjectId, orderId, orderLineId],
    );
    if (!found.rows[0]?.allowed)
      throw new V2ApplicationError("FORBIDDEN", "Artwork upload is unavailable for this Order line.");
  }
}
