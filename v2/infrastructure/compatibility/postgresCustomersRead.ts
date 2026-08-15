import type { TransactionalClient } from "../persistence/types.js";
import type { CustomerContactReference, CustomerPresentationIdentity, CustomersReadPort } from "../../src/modules/customers/contracts.js";
import { brandedId, type ContactId, type CustomerId, type OrganizationId } from "../../src/modules/shared/commercialValues.js";

type CustomerRow = {
  id: string; display_name: string | null; company_name: string; email: string | null; phone: string | null;
  billing_street1: string | null; billing_street2: string | null; billing_city: string | null; billing_state: string | null; billing_postal_code: string | null; billing_country: string | null;
  shipping_street1: string | null; shipping_street2: string | null; shipping_city: string | null; shipping_state: string | null; shipping_postal_code: string | null; shipping_country: string | null;
};
type ContactRow = { id: string; first_name: string; last_name: string; email: string | null; phone: string | null };

const display = (row: CustomerRow): string => row.display_name?.trim() || row.company_name;
const contactDisplay = (row: ContactRow): string => `${row.first_name} ${row.last_name}`.trim();
const address = (row: CustomerRow, prefix: "billing" | "shipping"): CustomerPresentationIdentity["billingAddress"] => {
  const fields = row as unknown as Record<string, string | null>;
  const values = [fields[`${prefix}_street1`], fields[`${prefix}_street2`]].filter((value): value is string => Boolean(value?.trim()));
  if (!values.length && !fields[`${prefix}_city`] && !fields[`${prefix}_state`] && !fields[`${prefix}_postal_code`] && !fields[`${prefix}_country`]) return undefined;
  return { lines: values, ...(fields[`${prefix}_city`] ? { city: fields[`${prefix}_city`]! } : {}), ...(fields[`${prefix}_state`] ? { region: fields[`${prefix}_state`]! } : {}), ...(fields[`${prefix}_postal_code`] ? { postalCode: fields[`${prefix}_postal_code`]! } : {}), ...(fields[`${prefix}_country`] ? { countryCode: fields[`${prefix}_country`]! } : {}) };
};

/** Read-only CRM anti-corruption adapter. Every query binds organization scope. */
export class PostgresCustomersCompatibilityReader implements CustomersReadPort {
  constructor(private readonly client: TransactionalClient) {}

  async getCustomer(organizationId: OrganizationId, customerId: CustomerId): Promise<Readonly<{ id: CustomerId; displayName: string }> | null> {
    const result = await this.client.query<CustomerRow>(`SELECT id, display_name, company_name, email, phone,
      billing_street1, billing_street2, billing_city, billing_state, billing_postal_code, billing_country,
      shipping_street1, shipping_street2, shipping_city, shipping_state, shipping_postal_code, shipping_country
      FROM customers WHERE organization_id = $1 AND id = $2 AND is_active IS NOT FALSE
      AND COALESCE(status, 'active') NOT IN ('archived', 'superseded', 'deleted') AND merged_into_customer_id IS NULL`, [organizationId, customerId]);
    const row = result.rows[0];
    return row ? { id: brandedId<"CustomerId">(row.id), displayName: display(row) } : null;
  }

  async getContact(organizationId: OrganizationId, contactId: ContactId): Promise<Readonly<{ id: ContactId; customerId?: CustomerId; displayName: string }> | null> {
    const result = await this.client.query<ContactRow>(`SELECT id, first_name, last_name, email, phone
      FROM customer_contacts WHERE organization_id = $1 AND id = $2 AND status = 'active'`, [organizationId, contactId]);
    const row = result.rows[0];
    return row ? { id: brandedId<"ContactId">(row.id), displayName: contactDisplay(row) } : null;
  }

  async validateContactReference(reference: CustomerContactReference): Promise<boolean> {
    if (!reference.customerId) return Boolean(await this.getContact(reference.organizationId, reference.contactId!));
    if (!reference.contactId) return Boolean(await this.getCustomer(reference.organizationId, reference.customerId));
    const result = await this.client.query<{ id: string }>(`SELECT c.id
      FROM customers c
      JOIN customer_contact_links l ON l.organization_id = c.organization_id AND l.customer_id = c.id AND l.status = 'active'
      JOIN customer_contacts ct ON ct.organization_id = c.organization_id AND ct.id = l.contact_id AND ct.status = 'active'
      WHERE c.organization_id = $1 AND c.id = $2 AND ct.id = $3 AND c.is_active IS NOT FALSE
        AND COALESCE(c.status, 'active') NOT IN ('archived', 'superseded', 'deleted') AND c.merged_into_customer_id IS NULL`, [reference.organizationId, reference.customerId, reference.contactId]);
    return result.rows.length === 1;
  }

  async getPresentationIdentity(reference: CustomerContactReference): Promise<CustomerPresentationIdentity> {
    const customer = reference.customerId ? await this.customerRow(reference.organizationId, reference.customerId) : null;
    const contact = reference.contactId ? await this.contactRow(reference.organizationId, reference.contactId!, reference.customerId) : null;
    if (reference.customerId && !customer) return {};
    if (reference.contactId && !contact) return {};
    return {
      ...(customer ? { customerDisplayName: display(customer), companyName: customer.company_name, email: contact?.email ?? customer.email ?? undefined, phone: contact?.phone ?? customer.phone ?? undefined, billingAddress: address(customer, "billing"), shippingAddress: address(customer, "shipping") } : {}),
      ...(contact ? { contactDisplayName: contactDisplay(contact), ...(customer ? {} : { email: contact.email ?? undefined, phone: contact.phone ?? undefined }) } : {}),
    };
  }

  private async customerRow(organizationId: OrganizationId, customerId: CustomerId): Promise<CustomerRow | null> {
    const result = await this.client.query<CustomerRow>(`SELECT id, display_name, company_name, email, phone,
      billing_street1, billing_street2, billing_city, billing_state, billing_postal_code, billing_country,
      shipping_street1, shipping_street2, shipping_city, shipping_state, shipping_postal_code, shipping_country
      FROM customers WHERE organization_id = $1 AND id = $2 AND is_active IS NOT FALSE
      AND COALESCE(status, 'active') NOT IN ('archived', 'superseded', 'deleted') AND merged_into_customer_id IS NULL`, [organizationId, customerId]);
    return result.rows[0] ?? null;
  }

  private async contactRow(organizationId: OrganizationId, contactId: ContactId, customerId?: CustomerId): Promise<ContactRow | null> {
    if (!customerId) {
      const result = await this.client.query<ContactRow>(`SELECT id, first_name, last_name, email, phone FROM customer_contacts
        WHERE organization_id = $1 AND id = $2 AND status = 'active'`, [organizationId, contactId]);
      return result.rows[0] ?? null;
    }
    const result = await this.client.query<ContactRow>(`SELECT ct.id, ct.first_name, ct.last_name, ct.email, ct.phone
      FROM customer_contacts ct JOIN customer_contact_links l ON l.organization_id = ct.organization_id AND l.contact_id = ct.id AND l.status = 'active'
      JOIN customers c ON c.organization_id = ct.organization_id AND c.id = l.customer_id
      WHERE ct.organization_id = $1 AND ct.id = $2 AND c.id = $3 AND ct.status = 'active' AND c.is_active IS NOT FALSE
        AND COALESCE(c.status, 'active') NOT IN ('archived', 'superseded', 'deleted') AND c.merged_into_customer_id IS NULL`, [organizationId, contactId, customerId]);
    return result.rows[0] ?? null;
  }
}
