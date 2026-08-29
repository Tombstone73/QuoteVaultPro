import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { principalSubject, staffActorId, type Principal } from "../../src/authorization/principals.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";

export type CustomerAddressInput = Readonly<{ street1?: string; street2?: string; city?: string; state?: string; postalCode?: string; country?: string }>;
export type UpdateCustomerInput = Readonly<{ businessRequestId: string; expectedRevision: string; companyName: string; displayName?: string; email?: string; phone?: string; billingAddress?: CustomerAddressInput; shippingAddress?: CustomerAddressInput }>;
export type CreateContactInput = Readonly<{ businessRequestId: string; expectedCustomerRevision: string; customerId: string; firstName: string; lastName: string; email?: string; phone?: string; title?: string }>;
export type UpdateContactInput = Readonly<{ businessRequestId: string; expectedCustomerRevision: string; expectedContactRevision: string; customerId: string; firstName: string; lastName: string; email?: string; phone?: string; title?: string; active: boolean }>;
export type SetPrimaryContactInput = Readonly<{ businessRequestId: string; expectedCustomerRevision: string; customerId: string; contactId: string }>;

type CustomerRow = Readonly<{ id: string; crm_revision: string }>;
type ContactRow = Readonly<{ id: string; status: "active" | "archived"; crm_revision: string }>;
const revision = (row: Readonly<{ crm_revision: string }>) => row.crm_revision;
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const operationNames = {
  updateCustomer: "customers.customer.update.v1",
  createContact: "customers.contact.create.v1",
  updateContact: "customers.contact.update.v1",
  setPrimary: "customers.contact.primary.set.v1",
} as const;

/** The V2 command boundary for CRM master facts.  Sales reads these identities
 * but never owns them; primary state lives solely on customer_contact_links. */
export class PostgresCustomerContactAdministration {
  private readonly requests = new PostgresOperationRequestRepository();
  constructor(private readonly pool: Pool) {}

  async updateCustomer(organizationId: string, principal: Principal, customerId: string, input: UpdateCustomerInput): Promise<void> {
    await this.command(organizationId, principal, operationNames.updateCustomer, input.businessRequestId, input, customerId, "customer", async (client) => {
      const customer = await this.customer(client, organizationId, customerId);
      this.assertRevision(customer, input.expectedRevision, "Customer");
      const billing = input.billingAddress ?? {};
      const shipping = input.shippingAddress ?? {};
      await client.query(
        `UPDATE customers SET company_name=$3, display_name=$4, email=$5, phone=$6,
          billing_street1=$7,billing_street2=$8,billing_city=$9,billing_state=$10,billing_postal_code=$11,billing_country=$12,
          shipping_street1=$13,shipping_street2=$14,shipping_city=$15,shipping_state=$16,shipping_postal_code=$17,shipping_country=$18,
          crm_revision=crm_revision+1,updated_at=now() WHERE organization_id=$1 AND id=$2`,
        [organizationId, customerId, input.companyName, input.displayName ?? null, input.email ?? null, input.phone ?? null,
          billing.street1 ?? null, billing.street2 ?? null, billing.city ?? null, billing.state ?? null, billing.postalCode ?? null, billing.country ?? null,
          shipping.street1 ?? null, shipping.street2 ?? null, shipping.city ?? null, shipping.state ?? null, shipping.postalCode ?? null, shipping.country ?? null],
      );
      return { eventType: "customer_master_updated", changes: { before: { revision: input.expectedRevision }, after: { companyName: input.companyName } } };
    });
  }

  async createContact(organizationId: string, principal: Principal, input: CreateContactInput): Promise<string> {
    return this.command(organizationId, principal, operationNames.createContact, input.businessRequestId, input, input.customerId, "customer", async (client) => {
      const customer = await this.customer(client, organizationId, input.customerId);
      this.assertRevision(customer, input.expectedCustomerRevision, "Customer");
      if (input.email) {
        const duplicate = await client.query<{ id: string }>(
          `SELECT ct.id FROM customer_contact_links l JOIN customer_contacts ct ON ct.organization_id=l.organization_id AND ct.id=l.contact_id
           WHERE l.organization_id=$1 AND l.customer_id=$2 AND l.status='active' AND ct.status='active' AND lower(ct.email)=lower($3) LIMIT 1 FOR UPDATE`,
          [organizationId, input.customerId, input.email],
        );
        if (duplicate.rows[0]) throw new V2ApplicationError("CONFLICT", "An active Contact with this email already belongs to the Customer.");
      }
      const contactId = randomUUID();
      await client.query(
        `INSERT INTO customer_contacts(id,organization_id,customer_id,first_name,last_name,title,email,phone,is_primary,status,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,false,'active',now(),now())`,
        [contactId, organizationId, input.customerId, input.firstName, input.lastName, input.title ?? null, input.email ?? null, input.phone ?? null],
      );
      await client.query(
        `INSERT INTO customer_contact_links(id,organization_id,customer_id,contact_id,status,is_primary,created_at,updated_at)
         VALUES($1,$2,$3,$4,'active',false,now(),now())`,
        [randomUUID(), organizationId, input.customerId, contactId],
      );
      await client.query("UPDATE customers SET crm_revision=crm_revision+1,updated_at=now() WHERE organization_id=$1 AND id=$2", [organizationId, input.customerId]);
      return { resourceId: contactId, resourceType: "customer_contact", eventType: "customer_contact_created", changes: { contactId, customerId: input.customerId } };
    });
  }

  async updateContact(organizationId: string, principal: Principal, contactId: string, input: UpdateContactInput): Promise<void> {
    await this.command(organizationId, principal, operationNames.updateContact, input.businessRequestId, input, contactId, "customer_contact", async (client) => {
      const customer = await this.customer(client, organizationId, input.customerId);
      this.assertRevision(customer, input.expectedCustomerRevision, "Customer");
      const contact = await this.contact(client, organizationId, contactId);
      this.assertRevision(contact, input.expectedContactRevision, "Contact");
      const linked = await client.query<{ is_primary: boolean }>(
        `SELECT l.is_primary FROM customer_contact_links l WHERE l.organization_id=$1 AND l.customer_id=$2 AND l.contact_id=$3 AND l.status='active' FOR UPDATE`,
        [organizationId, input.customerId, contactId],
      );
      if (!linked.rows[0]) throw new V2ApplicationError("NOT_FOUND", "Contact is unavailable for this Customer.");
      const linkedCustomers = await client.query<{ customer_id: string }>(
        "SELECT customer_id FROM customer_contact_links WHERE organization_id=$1 AND contact_id=$2 AND status='active' FOR UPDATE",
        [organizationId, contactId],
      );
      if (!input.active && linked.rows[0].is_primary) throw new V2ApplicationError("CONFLICT", "Select another Primary Contact before deactivating this Contact.");
      if (!input.active) {
        const portal = await client.query<{ id: string }>(
          `SELECT id FROM customer_portal_access WHERE organization_id=$1 AND customer_id=$2 AND contact_id=$3 AND status IN ('ACTIVE','PENDING_INVITE','SUSPENDED') LIMIT 1 FOR UPDATE`,
          [organizationId, input.customerId, contactId],
        );
        if (portal.rows[0]) throw new V2ApplicationError("CONFLICT", "This Contact has Portal access. Resolve that access before deactivating the Contact.");
      }
      await client.query(
        `UPDATE customer_contacts SET first_name=$3,last_name=$4,title=$5,email=$6,phone=$7,status=$8,crm_revision=crm_revision+1,updated_at=now()
         WHERE organization_id=$1 AND id=$2`,
        [organizationId, contactId, input.firstName, input.lastName, input.title ?? null, input.email ?? null, input.phone ?? null, input.active ? "active" : "archived"],
      );
      await client.query("UPDATE customers SET crm_revision=crm_revision+1,updated_at=now() WHERE organization_id=$1 AND id = ANY($2::varchar[])", [organizationId, linkedCustomers.rows.map((row) => row.customer_id)]);
      return { eventType: input.active ? "customer_contact_updated" : "customer_contact_archived", changes: { contactId, active: input.active } };
    });
  }

  async setPrimaryContact(organizationId: string, principal: Principal, input: SetPrimaryContactInput): Promise<void> {
    await this.command(organizationId, principal, operationNames.setPrimary, input.businessRequestId, input, input.customerId, "customer", async (client) => {
      const customer = await this.customer(client, organizationId, input.customerId);
      this.assertRevision(customer, input.expectedCustomerRevision, "Customer");
      const target = await client.query<{ id: string }>(
        `SELECT l.id FROM customer_contact_links l JOIN customer_contacts ct ON ct.organization_id=l.organization_id AND ct.id=l.contact_id
         WHERE l.organization_id=$1 AND l.customer_id=$2 AND l.contact_id=$3 AND l.status='active' AND ct.status='active' FOR UPDATE`,
        [organizationId, input.customerId, input.contactId],
      );
      if (!target.rows[0]) throw new V2ApplicationError("NOT_FOUND", "An active Contact for this Customer is required.");
      await client.query("UPDATE customer_contact_links SET is_primary=false,updated_at=now() WHERE organization_id=$1 AND customer_id=$2 AND status='active' AND is_primary=true", [organizationId, input.customerId]);
      await client.query("UPDATE customer_contact_links SET is_primary=true,updated_at=now() WHERE organization_id=$1 AND id=$2", [organizationId, target.rows[0].id]);
      await client.query("UPDATE customers SET crm_revision=crm_revision+1,updated_at=now() WHERE organization_id=$1 AND id=$2", [organizationId, input.customerId]);
      return { eventType: "customer_primary_contact_set", changes: { customerId: input.customerId, contactId: input.contactId } };
    });
  }

  private async command<T extends { resourceId?: string; resourceType?: string; eventType: string; changes: unknown }>(organizationId: string, principal: Principal, operation: string, businessRequestId: string, input: unknown, defaultResourceId: string, defaultResourceType: string, work: (client: PoolClient) => Promise<T>): Promise<T extends { resourceId: string } ? string : void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const reservation = await this.requests.reserve(client, { organizationId, operation, businessRequestId, payloadFingerprint: fingerprint(input), principalKind: principal.kind, principalSubject: principalSubject(principal), staffActorUserId: staffActorId(principal) });
      if (reservation.kind === "replay") { await client.query("COMMIT"); return (reservation.request.resultResourceId ?? undefined) as T extends { resourceId: string } ? string : void; }
      const result = await work(client);
      const resourceId = result.resourceId ?? defaultResourceId;
      const resourceType = result.resourceType ?? defaultResourceType;
      await this.requests.recordAttribution(client, { organizationId, operationRequestId: reservation.request.id, operation, resourceType, resourceId, principalKind: principal.kind, principalSubject: principalSubject(principal), staffActorUserId: staffActorId(principal) });
      await client.query("INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)", [organizationId, reservation.request.id, operation, result.eventType, resourceType, resourceId, principal.kind, principalSubject(principal), staffActorId(principal) ?? null, JSON.stringify(result.changes)]);
      await this.requests.succeed(client, organizationId, reservation.request.id, { resourceType, resourceId, resultJson: { resourceId } });
      await client.query("COMMIT");
      return (result.resourceId ?? undefined) as T extends { resourceId: string } ? string : void;
    } catch (cause) { await client.query("ROLLBACK"); throw cause; } finally { client.release(); }
  }

  private async customer(client: PoolClient, organizationId: string, customerId: string): Promise<CustomerRow> {
    const result = await client.query<CustomerRow>("SELECT id,crm_revision::text FROM customers WHERE organization_id=$1 AND id=$2 AND is_active IS NOT FALSE AND COALESCE(status,'active') NOT IN ('archived','superseded','deleted') AND merged_into_customer_id IS NULL FOR UPDATE", [organizationId, customerId]);
    if (!result.rows[0]) throw new V2ApplicationError("NOT_FOUND", "Customer is unavailable in this organization.");
    return result.rows[0];
  }
  private async contact(client: PoolClient, organizationId: string, contactId: string): Promise<ContactRow> {
    const result = await client.query<ContactRow>("SELECT id,status,crm_revision::text FROM customer_contacts WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId, contactId]);
    if (!result.rows[0]) throw new V2ApplicationError("NOT_FOUND", "Contact is unavailable in this organization.");
    return result.rows[0];
  }
  private assertRevision(row: Readonly<{ crm_revision: string }>, expected: string, label: string) { if (revision(row) !== expected) throw new V2ApplicationError("STALE_STATE", `${label} was changed by another request. Reload and try again.`); }
}
