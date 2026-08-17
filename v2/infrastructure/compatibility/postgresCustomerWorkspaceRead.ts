import type { Pool } from "pg";
import type { CustomerPresentationIdentity } from "../../src/modules/customers/contracts.js";
import { brandedId, type ContactId, type CustomerId, type OrganizationId } from "../../src/modules/shared/commercialValues.js";
import { PostgresCustomersCompatibilityReader } from "./postgresCustomersRead.js";

export type CustomerWorkspaceRead = Readonly<{
  customerId: CustomerId;
  displayName: string;
  presentation: CustomerPresentationIdentity;
  contacts: readonly CustomerWorkspaceContact[];
}>;
export type CustomerWorkspaceContact = Readonly<{
  contactId: ContactId;
  displayName: string;
  email?: string;
  phone?: string;
}>;
export type CustomerCatalogItem = Readonly<{
  customerId: CustomerId;
  displayName: string;
  companyName: string;
  email?: string;
  phone?: string;
  primaryContact?: CustomerWorkspaceContact;
}>;

type CustomerCatalogRow = Readonly<{
  customer_id: string;
  display_name: string | null;
  company_name: string;
  email: string | null;
  phone: string | null;
  contact_id: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
}>;
type CustomerContactRow = Readonly<{
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
}>;

const contact = (row: CustomerContactRow): CustomerWorkspaceContact => ({
  contactId: brandedId<"ContactId">(row.id),
  displayName: `${row.first_name} ${row.last_name}`.trim(),
  ...(row.email ? { email: row.email } : {}),
  ...(row.phone ? { phone: row.phone } : {}),
});
const catalogContact = (row: CustomerCatalogRow): CustomerWorkspaceContact | undefined =>
  row.contact_id && row.contact_first_name !== null && row.contact_last_name !== null
    ? {
        contactId: brandedId<"ContactId">(row.contact_id),
        displayName: `${row.contact_first_name} ${row.contact_last_name}`.trim(),
        ...(row.contact_email ? { email: row.contact_email } : {}),
        ...(row.contact_phone ? { phone: row.contact_phone } : {}),
      }
    : undefined;

/** Read-only Customer workspace projection; CRM remains the source of these facts. */
export class PostgresCustomerWorkspaceReader {
  constructor(private readonly pool: Pool) {}

  /** Bounded Customer-owned catalog. Contacts are relationship-scoped in SQL, never filtered only in the browser. */
  async list(organizationId: OrganizationId, query = ""): Promise<readonly CustomerCatalogItem[]> {
    const pattern = `%${query.trim().slice(0, 120)}%`;
    const result = await this.pool.query<CustomerCatalogRow>(
      `SELECT c.id AS customer_id, c.display_name, c.company_name, c.email, c.phone,
        primary_contact.id AS contact_id, primary_contact.first_name AS contact_first_name, primary_contact.last_name AS contact_last_name,
        primary_contact.email AS contact_email, primary_contact.phone AS contact_phone
      FROM customers c
      LEFT JOIN LATERAL (
        SELECT ct.id, ct.first_name, ct.last_name, ct.email, ct.phone
        FROM customer_contact_links l
        JOIN customer_contacts ct ON ct.organization_id = l.organization_id AND ct.id = l.contact_id AND ct.status = 'active'
        WHERE l.organization_id = c.organization_id AND l.customer_id = c.id AND l.status = 'active'
        ORDER BY lower(ct.last_name), lower(ct.first_name), ct.id
        LIMIT 1
      ) primary_contact ON TRUE
      WHERE c.organization_id = $1 AND c.is_active IS NOT FALSE
        AND COALESCE(c.status, 'active') NOT IN ('archived', 'superseded', 'deleted') AND c.merged_into_customer_id IS NULL
        AND (c.display_name ILIKE $2 OR c.company_name ILIKE $2 OR c.email ILIKE $2 OR c.phone ILIKE $2
          OR EXISTS (
            SELECT 1 FROM customer_contact_links l
            JOIN customer_contacts ct ON ct.organization_id = l.organization_id AND ct.id = l.contact_id AND ct.status = 'active'
            WHERE l.organization_id = c.organization_id AND l.customer_id = c.id AND l.status = 'active'
              AND (ct.first_name ILIKE $2 OR ct.last_name ILIKE $2 OR ct.email ILIKE $2 OR ct.phone ILIKE $2)
          ))
      ORDER BY lower(COALESCE(NULLIF(c.display_name, ''), c.company_name)), c.id
      LIMIT 100`,
      [organizationId, pattern],
    );
    return result.rows.map((row) => ({
      customerId: brandedId<"CustomerId">(row.customer_id),
      displayName: row.display_name?.trim() || row.company_name,
      companyName: row.company_name,
      ...(row.email ? { email: row.email } : {}),
      ...(row.phone ? { phone: row.phone } : {}),
      ...(catalogContact(row) ? { primaryContact: catalogContact(row)! } : {}),
    }));
  }

  async read(organizationId: OrganizationId, customerId: CustomerId): Promise<CustomerWorkspaceRead | null> {
    const reader = new PostgresCustomersCompatibilityReader(this.pool);
    const customer = await reader.getCustomer(organizationId, customerId);
    if (!customer) return null;
    return {
      customerId: brandedId<"CustomerId">(customer.id),
      displayName: customer.displayName,
      presentation: await reader.getPresentationIdentity({ organizationId, customerId }),
      contacts: await this.contacts(organizationId, customerId),
    };
  }

  private async contacts(organizationId: OrganizationId, customerId: CustomerId): Promise<readonly CustomerWorkspaceContact[]> {
    const result = await this.pool.query<CustomerContactRow>(
      `SELECT ct.id, ct.first_name, ct.last_name, ct.email, ct.phone
      FROM customer_contact_links l
      JOIN customer_contacts ct ON ct.organization_id = l.organization_id AND ct.id = l.contact_id AND ct.status = 'active'
      JOIN customers c ON c.organization_id = l.organization_id AND c.id = l.customer_id
      WHERE l.organization_id = $1 AND l.customer_id = $2 AND l.status = 'active'
        AND c.is_active IS NOT FALSE AND COALESCE(c.status, 'active') NOT IN ('archived', 'superseded', 'deleted')
        AND c.merged_into_customer_id IS NULL
      ORDER BY lower(ct.last_name), lower(ct.first_name), ct.id`,
      [organizationId, customerId],
    );
    return result.rows.map(contact);
  }
}
