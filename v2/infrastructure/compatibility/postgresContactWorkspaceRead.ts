import type { Pool } from "pg";
import { brandedId, type ContactId, type CustomerId, type OrganizationId } from "../../src/modules/shared/commercialValues.js";
import type { CustomerPresentationIdentity } from "../../src/modules/customers/contracts.js";

export type ContactCatalogItem = Readonly<{
  contactId: ContactId;
  displayName: string;
  email?: string;
  phone?: string;
  customerId: CustomerId;
  customerName: string;
  primary: boolean;
}>;
export type ContactCatalogRead = Readonly<{ items: readonly ContactCatalogItem[]; total: number; accounts: number }>;
export type ContactWorkspaceRead = Readonly<{
  contactId: ContactId;
  displayName: string;
  email?: string;
  phone?: string;
  customerId: CustomerId;
  customerName: string;
  primary: boolean;
  customerPresentation: CustomerPresentationIdentity;
  relatedContacts: readonly ContactCatalogItem[];
}>;

type ContactRow = Readonly<{
  contact_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  customer_id: string;
  customer_name: string;
  is_primary: boolean;
}>;
type ContactDetailRow = ContactRow & Readonly<{
  display_name: string | null;
  company_name: string;
  billing_street1: string | null;
  billing_street2: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_postal_code: string | null;
  billing_country: string | null;
  shipping_street1: string | null;
  shipping_street2: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_postal_code: string | null;
  shipping_country: string | null;
}>;

const contact = (row: ContactRow): ContactCatalogItem => ({
  contactId: brandedId<"ContactId">(row.contact_id),
  displayName: `${row.first_name} ${row.last_name}`.trim(),
  ...(row.email ? { email: row.email } : {}),
  ...(row.phone ? { phone: row.phone } : {}),
  customerId: brandedId<"CustomerId">(row.customer_id),
  customerName: row.customer_name,
  primary: row.is_primary,
});

const address = (lines: readonly (string | null)[], city: string | null, region: string | null, postalCode: string | null, countryCode: string | null) => {
  const normalizedLines = lines.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim());
  const cityLine = [city, region, postalCode].filter((value): value is string => Boolean(value?.trim())).join(" ");
  return normalizedLines.length || cityLine || countryCode
    ? { lines: normalizedLines, ...(city ? { city } : {}), ...(region ? { region } : {}), ...(postalCode ? { postalCode } : {}), ...(countryCode ? { countryCode } : {}) }
    : undefined;
};

const presentation = (row: ContactDetailRow): CustomerPresentationIdentity => ({
  customerDisplayName: row.display_name?.trim() || row.company_name,
  companyName: row.company_name,
  ...(address([row.billing_street1, row.billing_street2], row.billing_city, row.billing_state, row.billing_postal_code, row.billing_country) ? { billingAddress: address([row.billing_street1, row.billing_street2], row.billing_city, row.billing_state, row.billing_postal_code, row.billing_country) } : {}),
  ...(address([row.shipping_street1, row.shipping_street2], row.shipping_city, row.shipping_state, row.shipping_postal_code, row.shipping_country) ? { shippingAddress: address([row.shipping_street1, row.shipping_street2], row.shipping_city, row.shipping_state, row.shipping_postal_code, row.shipping_country) } : {}),
});

/** Read-only, tenant-scoped Contacts projection. Relationship rows carry the Customer context. */
export class PostgresContactWorkspaceReader {
  constructor(private readonly pool: Pool) {}

  async list(organizationId: OrganizationId, query = ""): Promise<ContactCatalogRead> {
    const pattern = `%${query.trim().slice(0, 120)}%`;
    const [rows, count] = await Promise.all([
      this.pool.query<ContactRow>(
        `SELECT ct.id AS contact_id, ct.first_name, ct.last_name, ct.email, ct.phone,
          c.id AS customer_id, COALESCE(NULLIF(c.display_name, ''), c.company_name) AS customer_name, l.is_primary AS is_primary
        FROM customer_contact_links l
        JOIN customer_contacts ct ON ct.organization_id = l.organization_id AND ct.id = l.contact_id AND ct.status = 'active'
        JOIN customers c ON c.organization_id = l.organization_id AND c.id = l.customer_id
        WHERE l.organization_id = $1 AND l.status = 'active' AND c.is_active IS NOT FALSE
          AND COALESCE(c.status, 'active') NOT IN ('archived', 'superseded', 'deleted') AND c.merged_into_customer_id IS NULL
          AND (ct.first_name ILIKE $2 OR ct.last_name ILIKE $2 OR ct.email ILIKE $2 OR ct.phone ILIKE $2
            OR c.display_name ILIKE $2 OR c.company_name ILIKE $2)
        ORDER BY lower(ct.last_name), lower(ct.first_name), ct.id
        LIMIT 500`,
        [organizationId, pattern],
      ),
      this.pool.query<{ total: string; accounts: string }>(
        `SELECT count(*)::text AS total, count(DISTINCT c.id)::text AS accounts
        FROM customer_contact_links l
        JOIN customer_contacts ct ON ct.organization_id = l.organization_id AND ct.id = l.contact_id AND ct.status = 'active'
        JOIN customers c ON c.organization_id = l.organization_id AND c.id = l.customer_id
        WHERE l.organization_id = $1 AND l.status = 'active' AND c.is_active IS NOT FALSE
          AND COALESCE(c.status, 'active') NOT IN ('archived', 'superseded', 'deleted') AND c.merged_into_customer_id IS NULL
          AND (ct.first_name ILIKE $2 OR ct.last_name ILIKE $2 OR ct.email ILIKE $2 OR ct.phone ILIKE $2
            OR c.display_name ILIKE $2 OR c.company_name ILIKE $2)`,
        [organizationId, pattern],
      ),
    ]);
    return { items: rows.rows.map(contact), total: Number(count.rows[0]?.total ?? 0), accounts: Number(count.rows[0]?.accounts ?? 0) };
  }

  async read(organizationId: OrganizationId, contactId: ContactId): Promise<ContactWorkspaceRead | null> {
    const selected = await this.pool.query<ContactDetailRow>(
      `SELECT ct.id AS contact_id, ct.first_name, ct.last_name, ct.email, ct.phone,
        c.id AS customer_id, COALESCE(NULLIF(c.display_name, ''), c.company_name) AS customer_name, l.is_primary AS is_primary,
        c.display_name, c.company_name, c.billing_street1, c.billing_street2, c.billing_city, c.billing_state, c.billing_postal_code, c.billing_country,
        c.shipping_street1, c.shipping_street2, c.shipping_city, c.shipping_state, c.shipping_postal_code, c.shipping_country
      FROM customer_contact_links l
      JOIN customer_contacts ct ON ct.organization_id = l.organization_id AND ct.id = l.contact_id AND ct.status = 'active'
      JOIN customers c ON c.organization_id = l.organization_id AND c.id = l.customer_id
      WHERE l.organization_id = $1 AND ct.id = $2 AND l.status = 'active' AND c.is_active IS NOT FALSE
        AND COALESCE(c.status, 'active') NOT IN ('archived', 'superseded', 'deleted') AND c.merged_into_customer_id IS NULL
      ORDER BY l.is_primary DESC, lower(COALESCE(NULLIF(c.display_name, ''), c.company_name)), c.id
      LIMIT 1`,
      [organizationId, contactId],
    );
    const row = selected.rows[0];
    if (!row) return null;
    const related = await this.pool.query<ContactRow>(
      `SELECT ct.id AS contact_id, ct.first_name, ct.last_name, ct.email, ct.phone,
        c.id AS customer_id, COALESCE(NULLIF(c.display_name, ''), c.company_name) AS customer_name, l.is_primary AS is_primary
      FROM customer_contact_links l
      JOIN customer_contacts ct ON ct.organization_id = l.organization_id AND ct.id = l.contact_id AND ct.status = 'active'
      JOIN customers c ON c.organization_id = l.organization_id AND c.id = l.customer_id
      WHERE l.organization_id = $1 AND l.customer_id = $2 AND l.status = 'active' AND c.is_active IS NOT FALSE
        AND COALESCE(c.status, 'active') NOT IN ('archived', 'superseded', 'deleted') AND c.merged_into_customer_id IS NULL
      ORDER BY l.is_primary DESC, lower(ct.last_name), lower(ct.first_name), ct.id
      LIMIT 500`,
      [organizationId, row.customer_id],
    );
    const value = contact(row);
    return { ...value, customerPresentation: presentation(row), relatedContacts: related.rows.map(contact) };
  }
}
