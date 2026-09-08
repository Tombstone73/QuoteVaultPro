import type { Pool } from "pg";
import type { CustomerPresentationIdentity } from "../../src/modules/customers/contracts.js";
import { brandedId, type ContactId, type CustomerId, type OrganizationId } from "../../src/modules/shared/commercialValues.js";
import { PostgresCustomersCompatibilityReader } from "./postgresCustomersRead.js";

export type CustomerWorkspaceRead = Readonly<{
  customerId: CustomerId;
  displayName: string;
  revision: string;
  editable: Readonly<{ companyName: string; displayName?: string; email?: string; phone?: string; billingAddress?: CustomerAddress; shippingAddress?: CustomerAddress }>;
  presentation: CustomerPresentationIdentity;
  contacts: readonly CustomerWorkspaceContact[];
  contactReadiness: Readonly<{ status: "ready" | "needs_attention"; reasons: readonly ("no_contacts" | "no_active_contacts" | "no_primary_contact")[] }>;
}>;
export type CustomerAddress = Readonly<{ street1?: string; street2?: string; city?: string; state?: string; postalCode?: string; country?: string }>;
export type CustomerWorkspaceContact = Readonly<{
  contactId: ContactId;
  displayName: string;
  email?: string;
  phone?: string;
  primary: boolean;
  title?: string;
  status: "active" | "archived";
  revision: string;
  portalAccessStatus?: string;
}>;
export type CustomerPrimaryContact = Readonly<{ contactId: ContactId; displayName: string; email?: string; phone?: string; primary: boolean }>;
export type CustomerCatalogItem = Readonly<{
  customerId: CustomerId;
  displayName: string;
  companyName: string;
  email?: string;
  phone?: string;
  primaryContact?: CustomerPrimaryContact;
}>;
export type CustomerCatalogPageRequest = Readonly<{ query?: string; limit?: number; cursor?: string }>;
export type CustomerCatalogPage = Readonly<{
  items: readonly CustomerCatalogItem[];
  totalMatching: number;
  nextCursor?: string;
}>;
/**
 * A read-only, customer-keyed operational timeline.  It intentionally points
 * back to the owning V2 domains rather than copying their mutable state into
 * CRM.  Provider operations and internal worker diagnostics are excluded.
 */
export type CustomerActivityKind = "quote" | "order" | "invoice" | "payment" | "refund" | "proof" | "fulfillment";
export type CustomerActivityItem = Readonly<{
  kind: CustomerActivityKind;
  entityId: string;
  occurredAt: string;
  title: string;
  detail: string;
}>;
export type CustomerActivityPageRequest = Readonly<{ limit?: number; cursor?: string }>;
export type CustomerActivityPage = Readonly<{
  items: readonly CustomerActivityItem[];
  totalMatching: number;
  nextCursor?: string;
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
  contact_is_primary: boolean | null;
  sort_name: string;
}>;
type CustomerCatalogCursor = Readonly<{ sortName: string; customerId: string }>;
type CustomerContactRow = Readonly<{
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  is_primary: boolean | null;
  title: string | null;
  status: "active" | "archived";
  crm_revision: string;
  portal_access_status: string | null;
}>;
type CustomerDetailRow = Readonly<{ id: string; company_name: string; display_name: string | null; email: string | null; phone: string | null; crm_revision: string; billing_street1: string | null; billing_street2: string | null; billing_city: string | null; billing_state: string | null; billing_postal_code: string | null; billing_country: string | null; shipping_street1: string | null; shipping_street2: string | null; shipping_city: string | null; shipping_state: string | null; shipping_postal_code: string | null; shipping_country: string | null }>;
type CustomerActivityRow = Readonly<{ kind: CustomerActivityKind; entity_id: string; occurred_at: Date; title: string; detail: string }>;
type CustomerActivityCursor = Readonly<{ occurredAt: string; kind: CustomerActivityKind; entityId: string }>;

const contact = (row: CustomerContactRow): CustomerWorkspaceContact => ({
  contactId: brandedId<"ContactId">(row.id),
  displayName: `${row.first_name} ${row.last_name}`.trim(),
  ...(row.email ? { email: row.email } : {}),
  ...(row.phone ? { phone: row.phone } : {}),
  primary: row.is_primary === true,
  ...(row.title ? { title: row.title } : {}),
  status: row.status,
  revision: row.crm_revision,
  ...(row.portal_access_status ? { portalAccessStatus: row.portal_access_status } : {}),
});
const catalogContact = (row: CustomerCatalogRow): CustomerPrimaryContact | undefined =>
  row.contact_id && row.contact_first_name !== null && row.contact_last_name !== null
    ? {
        contactId: brandedId<"ContactId">(row.contact_id),
        displayName: `${row.contact_first_name} ${row.contact_last_name}`.trim(),
        ...(row.contact_email ? { email: row.contact_email } : {}),
        ...(row.contact_phone ? { phone: row.contact_phone } : {}),
        primary: row.contact_is_primary === true,
      }
    : undefined;
const customerCatalogLimit = (value: number | undefined) =>
  Number.isInteger(value) ? Math.max(1, Math.min(value!, 50)) : 25;
const customerActivityLimit = (value: number | undefined) =>
  Number.isInteger(value) ? Math.max(1, Math.min(value!, 50)) : 20;
const encodeCustomerCursor = (cursor: CustomerCatalogCursor) =>
  Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
const decodeCustomerCursor = (value?: string): CustomerCatalogCursor | undefined => {
  if (!value) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    return typeof decoded.sortName === "string" && typeof decoded.customerId === "string"
      ? { sortName: decoded.sortName, customerId: decoded.customerId }
      : undefined;
  } catch {
    return undefined;
  }
};
const encodeCustomerActivityCursor = (cursor: CustomerActivityCursor) =>
  Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
const decodeCustomerActivityCursor = (value?: string): CustomerActivityCursor | undefined => {
  if (!value) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    const kinds: readonly CustomerActivityKind[] = ["quote", "order", "invoice", "payment", "refund", "proof", "fulfillment"];
    return typeof decoded.occurredAt === "string" && typeof decoded.entityId === "string" && typeof decoded.kind === "string" && kinds.includes(decoded.kind as CustomerActivityKind)
      ? { occurredAt: decoded.occurredAt, entityId: decoded.entityId, kind: decoded.kind as CustomerActivityKind }
      : undefined;
  } catch {
    return undefined;
  }
};

const customerActivityEvents = `
  SELECT d.document_kind::text AS kind,d.id AS entity_id,d.updated_at AS occurred_at,
    CASE WHEN d.document_kind='quote' THEN 'Quote ' ELSE 'Order ' END || d.display_number AS title,
    CASE WHEN d.document_kind='quote' THEN COALESCE(q.acceptance_state,'not_accepted') ELSE COALESCE(o.commercial_state,'open') END AS detail
  FROM v2_sales_documents d
  LEFT JOIN v2_sales_quote_details q ON q.organization_id=d.organization_id AND q.document_id=d.id
  LEFT JOIN v2_sales_order_details o ON o.organization_id=d.organization_id AND o.document_id=d.id
  WHERE d.organization_id=$1 AND d.customer_id=$2
  UNION ALL
  SELECT 'invoice'::text,i.id,i.updated_at,
    'Invoice ' || COALESCE(i.invoice_display_number,d.display_number),i.invoice_state
  FROM v2_billing_invoices i
  JOIN v2_sales_documents d ON d.organization_id=i.organization_id AND d.id=i.sales_order_document_id
  WHERE i.organization_id=$1 AND i.customer_id=$2
  UNION ALL
  SELECT 'payment'::text,p.id,p.recorded_at,'Payment',p.source || ' · ' || p.currency || ' ' || (p.amount_cents::text)
  FROM v2_billing_payments p
  WHERE p.organization_id=$1 AND EXISTS (
    SELECT 1
    FROM v2_billing_payment_allocations a
    JOIN v2_billing_invoices i ON i.organization_id=a.organization_id AND i.id=a.invoice_id
    WHERE a.organization_id=p.organization_id AND a.payment_id=p.id AND i.customer_id=$2
  )
  UNION ALL
  SELECT 'refund'::text,r.id,r.recorded_at,'Refund',r.source || ' · ' || r.currency || ' ' || (r.amount_cents::text)
  FROM v2_billing_refunds r
  WHERE r.organization_id=$1 AND EXISTS (
    SELECT 1 FROM v2_billing_refund_allocations a
    JOIN v2_billing_refund_allocation_evidence e ON e.organization_id=a.organization_id AND e.refund_allocation_id=a.id
    JOIN v2_billing_invoices i ON i.organization_id=e.organization_id AND i.id=e.invoice_id
    WHERE a.organization_id=r.organization_id AND a.refund_id=r.id AND i.customer_id=$2
  )
  UNION ALL
  SELECT 'proof'::text,pv.id,COALESCE(pv.issued_at,pv.created_at),'Proof v' || pv.sequence::text,
    CASE WHEN pv.issued_at IS NULL THEN 'prepared' ELSE 'issued' END
  FROM v2_proof_versions pv
  JOIN v2_proof_works pw ON pw.organization_id=pv.organization_id AND pw.id=pv.proof_work_id
  JOIN v2_sales_documents d ON d.organization_id=pw.organization_id AND d.id=pw.order_document_id
  WHERE pv.organization_id=$1 AND d.customer_id=$2
  UNION ALL
  SELECT 'fulfillment'::text,h.id,h.completed_at,
    CASE WHEN h.handoff_method='shipment' THEN 'Shipment' ELSE 'Pickup' END,h.handoff_method
  FROM v2_fulfillment_handoffs h
  WHERE h.organization_id=$1 AND h.customer_id=$2`;

/** Read-only Customer workspace projection; CRM remains the source of these facts. */
export class PostgresCustomerWorkspaceReader {
  constructor(private readonly pool: Pool) {}

  /** Keyset-paged Customer-owned catalog. Contacts are relationship-scoped in SQL, never filtered only in the browser. */
  async list(organizationId: OrganizationId, request: CustomerCatalogPageRequest = {}): Promise<CustomerCatalogPage> {
    const query = request.query?.trim().slice(0, 120) ?? "";
    const pattern = query ? `%${query}%` : null;
    const limit = customerCatalogLimit(request.limit);
    const cursor = decodeCustomerCursor(request.cursor);
    const values = [organizationId, pattern, cursor?.sortName ?? null, cursor?.customerId ?? null, limit + 1];
    const [result, count] = await Promise.all([
      this.pool.query<CustomerCatalogRow>(
      `WITH candidates AS (
        SELECT c.id,
          lower(COALESCE(NULLIF(c.display_name, ''), c.company_name)) AS sort_name
        FROM customers c
        WHERE c.organization_id = $1 AND c.is_active IS NOT FALSE
          AND COALESCE(c.status, 'active') NOT IN ('archived', 'superseded', 'deleted') AND c.merged_into_customer_id IS NULL
          AND ($2::text IS NULL OR c.display_name ILIKE $2 OR c.company_name ILIKE $2 OR c.email ILIKE $2 OR c.phone ILIKE $2
            OR EXISTS (
              SELECT 1 FROM customer_contact_links l
              JOIN customer_contacts ct ON ct.organization_id = l.organization_id AND ct.id = l.contact_id AND ct.status = 'active'
              WHERE l.organization_id = c.organization_id AND l.customer_id = c.id AND l.status = 'active'
                AND (ct.first_name ILIKE $2 OR ct.last_name ILIKE $2 OR ct.email ILIKE $2 OR ct.phone ILIKE $2)
            ))
          AND ($3::text IS NULL OR (lower(COALESCE(NULLIF(c.display_name, ''), c.company_name)), c.id::text) > ($3::text, $4::text))
        ORDER BY sort_name, c.id
        LIMIT $5
      )
      SELECT c.id AS customer_id, c.display_name, c.company_name, c.email, c.phone, candidates.sort_name,
        primary_contact.id AS contact_id, primary_contact.first_name AS contact_first_name, primary_contact.last_name AS contact_last_name,
        primary_contact.email AS contact_email, primary_contact.phone AS contact_phone, primary_contact.is_primary AS contact_is_primary
      FROM candidates
      JOIN customers c ON c.organization_id = $1 AND c.id = candidates.id
      LEFT JOIN LATERAL (
        SELECT ct.id, ct.first_name, ct.last_name, ct.email, ct.phone, l.is_primary
        FROM customer_contact_links l
        JOIN customer_contacts ct ON ct.organization_id = l.organization_id AND ct.id = l.contact_id AND ct.status = 'active'
        WHERE l.organization_id = c.organization_id AND l.customer_id = c.id AND l.status = 'active'
        ORDER BY l.is_primary DESC, lower(ct.last_name), lower(ct.first_name), ct.id
        LIMIT 1
      ) primary_contact ON TRUE
      ORDER BY candidates.sort_name, c.id`,
      values,
    ),
      this.pool.query<{ total_matching: string }>(
        `SELECT count(*)::text AS total_matching
        FROM customers c
        WHERE c.organization_id = $1 AND c.is_active IS NOT FALSE
          AND COALESCE(c.status, 'active') NOT IN ('archived', 'superseded', 'deleted') AND c.merged_into_customer_id IS NULL
          AND ($2::text IS NULL OR c.display_name ILIKE $2 OR c.company_name ILIKE $2 OR c.email ILIKE $2 OR c.phone ILIKE $2
          OR EXISTS (
            SELECT 1 FROM customer_contact_links l
            JOIN customer_contacts ct ON ct.organization_id = l.organization_id AND ct.id = l.contact_id AND ct.status = 'active'
            WHERE l.organization_id = c.organization_id AND l.customer_id = c.id AND l.status = 'active'
              AND (ct.first_name ILIKE $2 OR ct.last_name ILIKE $2 OR ct.email ILIKE $2 OR ct.phone ILIKE $2)
          ))`,
        [organizationId, pattern],
      ),
    ]);
    const visible = result.rows.slice(0, limit);
    const last = visible.at(-1);
    return { items: visible.map((row) => ({
      customerId: brandedId<"CustomerId">(row.customer_id),
      displayName: row.display_name?.trim() || row.company_name,
      companyName: row.company_name,
      ...(row.email ? { email: row.email } : {}),
      ...(row.phone ? { phone: row.phone } : {}),
      ...(catalogContact(row) ? { primaryContact: catalogContact(row)! } : {}),
    })), totalMatching: Number(count.rows[0]?.total_matching ?? 0),
      ...(result.rows.length > limit && last ? { nextCursor: encodeCustomerCursor({ sortName: last.sort_name, customerId: last.customer_id }) } : {}) };
  }

  async read(organizationId: OrganizationId, customerId: CustomerId): Promise<CustomerWorkspaceRead | null> {
    const reader = new PostgresCustomersCompatibilityReader(this.pool);
    const customer = await reader.getCustomer(organizationId, customerId);
    if (!customer) return null;
    const raw = await this.pool.query<CustomerDetailRow>(
      `SELECT id,company_name,display_name,email,phone,crm_revision::text,billing_street1,billing_street2,billing_city,billing_state,billing_postal_code,billing_country,shipping_street1,shipping_street2,shipping_city,shipping_state,shipping_postal_code,shipping_country
       FROM customers WHERE organization_id=$1 AND id=$2`, [organizationId, customerId],
    );
    const row = raw.rows[0];
    if (!row) return null;
    const contacts = await this.contacts(organizationId, customerId);
    const reasons: ("no_contacts" | "no_active_contacts" | "no_primary_contact")[] = [];
    if (!contacts.length) reasons.push("no_contacts", "no_active_contacts");
    else if (!contacts.some((entry) => entry.status === "active")) reasons.push("no_active_contacts");
    if (contacts.length && !contacts.some((entry) => entry.primary && entry.status === "active")) reasons.push("no_primary_contact");
    const toAddress = (prefix: "billing" | "shipping"): CustomerAddress | undefined => {
      const values = prefix === "billing" ? [row.billing_street1,row.billing_street2,row.billing_city,row.billing_state,row.billing_postal_code,row.billing_country] : [row.shipping_street1,row.shipping_street2,row.shipping_city,row.shipping_state,row.shipping_postal_code,row.shipping_country];
      return values.some(Boolean) ? { ...(values[0] ? { street1: values[0] } : {}), ...(values[1] ? { street2: values[1] } : {}), ...(values[2] ? { city: values[2] } : {}), ...(values[3] ? { state: values[3] } : {}), ...(values[4] ? { postalCode: values[4] } : {}), ...(values[5] ? { country: values[5] } : {}) } : undefined;
    };
    return {
      customerId: brandedId<"CustomerId">(customer.id),
      displayName: customer.displayName,
      revision: row.crm_revision,
      editable: { companyName: row.company_name, ...(row.display_name ? { displayName: row.display_name } : {}), ...(row.email ? { email: row.email } : {}), ...(row.phone ? { phone: row.phone } : {}), ...(toAddress("billing") ? { billingAddress: toAddress("billing") } : {}), ...(toAddress("shipping") ? { shippingAddress: toAddress("shipping") } : {}) },
      presentation: await reader.getPresentationIdentity({ organizationId, customerId }),
      contacts,
      contactReadiness: { status: reasons.length ? "needs_attention" : "ready", reasons },
    };
  }

  /**
   * Keyset-paged, tenant/customer-scoped activity.  Every branch binds both
   * organization and customer at the database boundary, so the UI never gets
   * a cross-account activity stream to filter itself.
   */
  async activity(organizationId: OrganizationId, customerId: CustomerId, request: CustomerActivityPageRequest = {}): Promise<CustomerActivityPage> {
    const limit = customerActivityLimit(request.limit);
    const cursor = decodeCustomerActivityCursor(request.cursor);
    const baseValues = [organizationId, customerId];
    const cursorValues = [cursor?.occurredAt ?? null, cursor?.kind ?? null, cursor?.entityId ?? null];
    const [result, count] = await Promise.all([
      this.pool.query<CustomerActivityRow>(
        `WITH events AS (${customerActivityEvents})
         SELECT kind,entity_id,occurred_at,title,detail FROM events
         WHERE ($3::timestamptz IS NULL OR (occurred_at,kind,entity_id) < ($3::timestamptz,$4::text,$5::text))
         ORDER BY occurred_at DESC,kind DESC,entity_id DESC
         LIMIT $6`,
        [...baseValues, ...cursorValues, limit + 1],
      ),
      this.pool.query<{ total_matching: string }>(
        `WITH events AS (${customerActivityEvents}) SELECT count(*)::text AS total_matching FROM events`,
        baseValues,
      ),
    ]);
    const visible = result.rows.slice(0, limit);
    const last = visible.at(-1);
    return {
      items: visible.map((row) => ({ kind: row.kind, entityId: row.entity_id, occurredAt: row.occurred_at.toISOString(), title: row.title, detail: row.detail })),
      totalMatching: Number(count.rows[0]?.total_matching ?? 0),
      ...(result.rows.length > limit && last ? { nextCursor: encodeCustomerActivityCursor({ occurredAt: last.occurred_at.toISOString(), kind: last.kind, entityId: last.entity_id }) } : {}),
    };
  }

  private async contacts(organizationId: OrganizationId, customerId: CustomerId): Promise<readonly CustomerWorkspaceContact[]> {
    const result = await this.pool.query<CustomerContactRow>(
      `SELECT ct.id, ct.first_name, ct.last_name, ct.email, ct.phone, ct.title, ct.status, ct.crm_revision::text, l.is_primary,
        portal.status AS portal_access_status
      FROM customer_contact_links l
      JOIN customer_contacts ct ON ct.organization_id = l.organization_id AND ct.id = l.contact_id
      JOIN customers c ON c.organization_id = l.organization_id AND c.id = l.customer_id
      LEFT JOIN LATERAL (SELECT status FROM customer_portal_access p WHERE p.organization_id=l.organization_id AND p.customer_id=l.customer_id AND p.contact_id=l.contact_id ORDER BY p.created_at DESC LIMIT 1) portal ON TRUE
      WHERE l.organization_id = $1 AND l.customer_id = $2 AND l.status = 'active'
        AND c.is_active IS NOT FALSE AND COALESCE(c.status, 'active') NOT IN ('archived', 'superseded', 'deleted')
        AND c.merged_into_customer_id IS NULL
      ORDER BY l.is_primary DESC, ct.status = 'active' DESC, lower(ct.last_name), lower(ct.first_name), ct.id`,
      [organizationId, customerId],
    );
    return result.rows.map(contact);
  }
}
