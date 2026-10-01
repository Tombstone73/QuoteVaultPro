import type { TransactionalClient } from "../persistence/types.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { SalesContactChoice, SalesContactSelectionQuery, SalesContactSelectionReadPort, SalesContactSelectionResult } from "../../src/modules/customers/salesContactSelection.js";
import { brandedId, type OrganizationId } from "../../src/modules/shared/commercialValues.js";

type ContactRow = { id: string; label: string };
const choice = (row: ContactRow): SalesContactChoice => ({ id: brandedId<"ContactId">(row.id), label: row.label });

/** Customers-owned selection read using canonical active-link semantics. Takes
 * the caller's scoped query client; no authorization, transaction or SQL mutation. */
export class PostgresSalesContactSelection implements SalesContactSelectionReadPort {
  constructor(private readonly client: TransactionalClient) {}

  async lookupActiveContacts(organizationId: OrganizationId, input: SalesContactSelectionQuery): Promise<SalesContactSelectionResult> {
    for (const id of [organizationId, input.customerId, input.selectedContactId]) {
      if (id !== undefined && (typeof id !== "string" || !id.trim() || id.length > 255)) {
        throw new V2ApplicationError("VALIDATION_ERROR", "Contact selection scope is invalid.");
      }
    }
    if (typeof organizationId !== "string" || !organizationId.trim()
      || (input.search !== undefined && (typeof input.search !== "string" || input.search.length > 120))
      || (input.limit !== undefined && !Number.isSafeInteger(input.limit))) {
      throw new V2ApplicationError("VALIDATION_ERROR", "Contact selection query is invalid.");
    }
    const search = input.search?.trim() ?? "";
    const limit = Math.max(1, Math.min(input.limit ?? 25, 50));
    const result = await this.client.query<ContactRow>(
      `SELECT ct.id, btrim(ct.first_name || ' ' || ct.last_name) AS label
       FROM customer_contacts ct
       WHERE ct.organization_id=$1 AND ct.status='active'
         AND ($2::varchar IS NULL OR EXISTS (
           SELECT 1 FROM customer_contact_links l
           JOIN customers c ON c.organization_id=ct.organization_id AND c.id=l.customer_id
           WHERE l.organization_id=ct.organization_id AND l.contact_id=ct.id AND l.customer_id=$2 AND l.status='active'
             AND c.is_active IS NOT FALSE AND COALESCE(c.status,'active') NOT IN ('archived','superseded','deleted')
             AND c.merged_into_customer_id IS NULL))
         AND strpos(lower(btrim(ct.first_name || ' ' || ct.last_name)),lower($3::text)) > 0
       ORDER BY lower(btrim(ct.first_name || ' ' || ct.last_name)) COLLATE "C", ct.id COLLATE "C"
       LIMIT $4`,
      [organizationId, input.customerId ?? null, search, limit],
    );
    let selectedContact: SalesContactChoice | null = null;
    if (input.selectedContactId) {
      // Never hydrate from another page/tenant/account or from a stale link.
      const selected = await this.client.query<ContactRow>(
        `SELECT ct.id, btrim(ct.first_name || ' ' || ct.last_name) AS label
         FROM customer_contacts ct
         WHERE ct.organization_id=$1 AND ct.status='active' AND ct.id=$3
           AND ($2::varchar IS NULL OR EXISTS (
             SELECT 1 FROM customer_contact_links l
             JOIN customers c ON c.organization_id=ct.organization_id AND c.id=l.customer_id
             WHERE l.organization_id=ct.organization_id AND l.contact_id=ct.id AND l.customer_id=$2 AND l.status='active'
               AND c.is_active IS NOT FALSE AND COALESCE(c.status,'active') NOT IN ('archived','superseded','deleted')
               AND c.merged_into_customer_id IS NULL))`,
        [organizationId, input.customerId ?? null, input.selectedContactId],
      );
      if (selected.rows[0]) selectedContact = choice(selected.rows[0]);
    }
    return { items: result.rows.map(choice), selectedContact };
  }
}
