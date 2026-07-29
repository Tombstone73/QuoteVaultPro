import { and, eq, sql } from "drizzle-orm";
import {
  auditLogs,
  customerContactLinks,
  customerContacts,
  customers,
  orders,
  type Customer,
  type CustomerContact,
  type Order,
} from "../../shared/schema";

export type BillingCustomerPromotionResolution =
  | "existing_order_customer"
  | "linked_customer"
  | "existing_individual_source_contact"
  | "existing_individual_email"
  | "created_individual_customer";

export class ContactAccountingPromotionError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode = 409) {
    super(`${code}: ${message}`);
    this.name = "ContactAccountingPromotionError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

type Tx = any;

function clean(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function normalizeEmail(value: unknown): string | null {
  return clean(value)?.toLowerCase() ?? null;
}

export function contactDisplayName(contact: Pick<CustomerContact, "firstName" | "lastName" | "email">): string {
  return clean(`${clean(contact.firstName) ?? ""} ${clean(contact.lastName) ?? ""}`) ?? clean(contact.email) ?? "Individual customer";
}

function contactBillingAddress(contact: Pick<CustomerContact, "street1" | "street2" | "city" | "state" | "postalCode" | "country">): string | null {
  const parts = [
    contact.street1,
    contact.street2,
    [contact.city, contact.state, contact.postalCode].map(clean).filter(Boolean).join(", "),
    contact.country,
  ].map(clean).filter(Boolean);
  return parts.length ? parts.join("\n") : null;
}

function activeCustomerCondition() {
  return sql`coalesce(${customers.status}, 'active') not in ('archived', 'superseded', 'deleted')`;
}

async function selectActiveLinkedCustomers(tx: Tx, organizationId: string, contact: CustomerContact): Promise<Customer[]> {
  const linkRows = await tx
    .select({ customer: customers })
    .from(customerContactLinks)
    .innerJoin(customers, and(
      eq(customers.id, customerContactLinks.customerId),
      eq(customers.organizationId, organizationId),
    ))
    .where(and(
      eq(customerContactLinks.organizationId, organizationId),
      eq(customerContactLinks.contactId, contact.id),
      eq(customerContactLinks.status, "active"),
      activeCustomerCondition(),
    ));

  const byId = new Map<string, Customer>();
  for (const row of linkRows) byId.set(row.customer.id, row.customer);

  if (contact.customerId && !byId.has(contact.customerId)) {
    const [legacyCustomer] = await tx
      .select()
      .from(customers)
      .where(and(
        eq(customers.organizationId, organizationId),
        eq(customers.id, contact.customerId),
        activeCustomerCondition(),
      ))
      .limit(1);
    if (legacyCustomer) byId.set(legacyCustomer.id, legacyCustomer);
  }

  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}

async function ensurePrimaryBillingLink(tx: Tx, organizationId: string, customerId: string, contact: CustomerContact): Promise<void> {
  await tx
    .update(customerContactLinks)
    .set({ isPrimary: false, updatedAt: new Date() })
    .where(and(
      eq(customerContactLinks.organizationId, organizationId),
      eq(customerContactLinks.customerId, customerId),
      eq(customerContactLinks.status, "active"),
      sql`${customerContactLinks.contactId} <> ${contact.id}`,
    ));

  const [existingLink] = await tx
    .select()
    .from(customerContactLinks)
    .where(and(
      eq(customerContactLinks.organizationId, organizationId),
      eq(customerContactLinks.customerId, customerId),
      eq(customerContactLinks.contactId, contact.id),
      sql`${customerContactLinks.status} <> 'removed'`,
    ))
    .limit(1);

  const linkValues = {
    organizationId,
    customerId,
    contactId: contact.id,
    status: "active" as const,
    isPrimary: true,
    isBilling: true,
    sourceSystem: "accounting_promotion",
    updatedAt: new Date(),
  };

  if (existingLink) {
    await tx
      .update(customerContactLinks)
      .set(linkValues)
      .where(eq(customerContactLinks.id, existingLink.id));
  } else {
    await tx
      .insert(customerContactLinks)
      .values(linkValues);
  }

  if (!contact.customerId || contact.customerId === customerId) {
    await tx
      .update(customerContacts)
      .set({ customerId, isPrimary: true, updatedAt: new Date() })
      .where(and(eq(customerContacts.organizationId, organizationId), eq(customerContacts.id, contact.id)));
  }
}

async function selectIndividualBySourceContact(tx: Tx, organizationId: string, contactId: string): Promise<Customer[]> {
  return tx
    .select()
    .from(customers)
    .where(and(
      eq(customers.organizationId, organizationId),
      eq(customers.customerType, "individual"),
      eq(customers.sourceContactId, contactId),
      activeCustomerCondition(),
    ))
    .orderBy(customers.createdAt, customers.id);
}

async function selectIndividualByEmail(tx: Tx, organizationId: string, email: string): Promise<Customer[]> {
  return tx
    .select()
    .from(customers)
    .where(and(
      eq(customers.organizationId, organizationId),
      eq(customers.customerType, "individual"),
      sql`lower(${customers.email}) = ${email}`,
      activeCustomerCondition(),
    ))
    .orderBy(customers.createdAt, customers.id);
}

export async function resolveBillingCustomerForOrder(tx: Tx, input: {
  organizationId: string;
  order: Order;
  actorUserId?: string | null;
}): Promise<{
  customerId: string;
  contactId: string | null;
  resolution: BillingCustomerPromotionResolution;
  createdCustomerId: string | null;
  sourceContactId: string | null;
  message: string | null;
}> {
  const { organizationId, order } = input;

  if (order.customerId) {
    const [customer] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.organizationId, organizationId), eq(customers.id, order.customerId), activeCustomerCondition()))
      .limit(1);
    if (!customer) {
      throw new ContactAccountingPromotionError("CUSTOMER_NOT_FOUND", "The order customer is unavailable for billing.");
    }
    return {
      customerId: order.customerId,
      contactId: order.contactId ?? null,
      resolution: "existing_order_customer",
      createdCustomerId: null,
      sourceContactId: order.contactId ?? null,
      message: null,
    };
  }

  if (!order.contactId) {
    throw new ContactAccountingPromotionError(
      "ORDER_CUSTOMER_REQUIRED_FOR_INVOICE",
      "Select a customer or contact before creating an invoice.",
    );
  }

  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`contact-accounting-promotion:${organizationId}:${order.contactId}`}))`);

  const [contact] = await tx
    .select()
    .from(customerContacts)
    .where(and(
      eq(customerContacts.organizationId, organizationId),
      eq(customerContacts.id, order.contactId),
      eq(customerContacts.status, "active"),
    ))
    .limit(1);
  if (!contact) {
    throw new ContactAccountingPromotionError("CONTACT_NOT_FOUND", "The selected order contact is unavailable for billing.");
  }

  const linkedCustomers = await selectActiveLinkedCustomers(tx, organizationId, contact);
  if (linkedCustomers.length > 1) {
    throw new ContactAccountingPromotionError(
      "CONTACT_BILLING_CUSTOMER_REVIEW_REQUIRED",
      "This contact is linked to multiple active customers. Review the billing customer before invoicing.",
    );
  }
  if (linkedCustomers.length === 1) {
    await ensurePrimaryBillingLink(tx, organizationId, linkedCustomers[0].id, contact);
    await tx
      .update(orders)
      .set({ customerId: linkedCustomers[0].id, updatedAt: new Date() })
      .where(and(eq(orders.organizationId, organizationId), eq(orders.id, order.id)));
    return {
      customerId: linkedCustomers[0].id,
      contactId: contact.id,
      resolution: "linked_customer",
      createdCustomerId: null,
      sourceContactId: contact.id,
      message: null,
    };
  }

  const sourceMatches = await selectIndividualBySourceContact(tx, organizationId, contact.id);
  if (sourceMatches.length > 1) {
    throw new ContactAccountingPromotionError(
      "CONTACT_BILLING_CUSTOMER_REVIEW_REQUIRED",
      "Multiple individual customer accounts are linked to this contact. Review the billing customer before invoicing.",
    );
  }
  if (sourceMatches.length === 1) {
    await ensurePrimaryBillingLink(tx, organizationId, sourceMatches[0].id, contact);
    await tx.update(orders).set({ customerId: sourceMatches[0].id, updatedAt: new Date() }).where(and(eq(orders.organizationId, organizationId), eq(orders.id, order.id)));
    return {
      customerId: sourceMatches[0].id,
      contactId: contact.id,
      resolution: "existing_individual_source_contact",
      createdCustomerId: null,
      sourceContactId: contact.id,
      message: null,
    };
  }

  const email = normalizeEmail(contact.email);
  if (email) {
    const emailMatches = await selectIndividualByEmail(tx, organizationId, email);
    if (emailMatches.length > 1) {
      throw new ContactAccountingPromotionError(
        "CONTACT_BILLING_CUSTOMER_REVIEW_REQUIRED",
        "Multiple individual customer accounts use this contact email. Review the billing customer before invoicing.",
      );
    }
    if (emailMatches.length === 1) {
      await tx
        .update(customers)
        .set({ sourceContactId: contact.id, updatedAt: new Date() })
        .where(and(eq(customers.organizationId, organizationId), eq(customers.id, emailMatches[0].id), sql`${customers.sourceContactId} IS NULL`));
      await ensurePrimaryBillingLink(tx, organizationId, emailMatches[0].id, contact);
      await tx.update(orders).set({ customerId: emailMatches[0].id, updatedAt: new Date() }).where(and(eq(orders.organizationId, organizationId), eq(orders.id, order.id)));
      return {
        customerId: emailMatches[0].id,
        contactId: contact.id,
        resolution: "existing_individual_email",
        createdCustomerId: null,
        sourceContactId: contact.id,
        message: null,
      };
    }
  }

  const displayName = contactDisplayName(contact);
  if (!displayName || displayName === "Individual customer") {
    throw new ContactAccountingPromotionError(
      "CONTACT_BILLING_IDENTITY_REQUIRED",
      "The selected contact is missing the name or email required to create an individual billing customer.",
    );
  }

  const customerValues = {
    organizationId,
    companyName: displayName,
    customerType: "individual",
    displayName,
    individualFirstName: clean(contact.firstName),
    individualLastName: clean(contact.lastName),
    email: clean(contact.email),
    phone: clean(contact.phone) ?? clean(contact.mobile),
    billingAddress: contactBillingAddress(contact),
    billingStreet1: clean(contact.street1),
    billingStreet2: clean(contact.street2),
    billingCity: clean(contact.city),
    billingState: clean(contact.state),
    billingPostalCode: clean(contact.postalCode),
    billingCountry: clean(contact.country),
    sourceContactId: contact.id,
    accountCreationSource: "accounting_promotion",
    status: "active",
    isActive: true,
    syncStatus: "pending",
    updatedAt: new Date(),
  };

  let createdCustomer: Customer | null = null;
  try {
    const [created] = await tx.insert(customers).values(customerValues as any).returning();
    createdCustomer = created ?? null;
  } catch (error: any) {
    if (error?.code !== "23505") throw error;
    const retryMatches = await selectIndividualBySourceContact(tx, organizationId, contact.id);
    if (retryMatches.length !== 1) throw error;
    createdCustomer = retryMatches[0];
  }

  if (!createdCustomer) {
    throw new ContactAccountingPromotionError("CONTACT_BILLING_PROMOTION_FAILED", "Unable to create an individual customer for billing.");
  }

  await ensurePrimaryBillingLink(tx, organizationId, createdCustomer.id, contact);
  await tx.update(orders).set({ customerId: createdCustomer.id, updatedAt: new Date() }).where(and(eq(orders.organizationId, organizationId), eq(orders.id, order.id)));

  return {
    customerId: createdCustomer.id,
    contactId: contact.id,
    resolution: "created_individual_customer",
    createdCustomerId: createdCustomer.id,
    sourceContactId: contact.id,
    message: `An individual customer account was created for ${displayName} so this order can be invoiced.`,
  };
}

export async function writeContactAccountingPromotionAudit(tx: Tx, input: {
  organizationId: string;
  actorUserId?: string | null;
  orderId: string;
  invoiceId?: string | null;
  customerId: string;
  contactId: string | null;
  resolution: BillingCustomerPromotionResolution;
  createdCustomerId: string | null;
}): Promise<void> {
  if (input.resolution === "existing_order_customer") return;

  await tx.insert(auditLogs).values({
    organizationId: input.organizationId,
    userId: input.actorUserId ?? null,
    actionType: "order_contact_accounting_promotion",
    entityType: "order",
    entityId: input.orderId,
    description: "Contact-only order resolved to a customer account for accounting.",
    newValues: {
      reason: "accounting_promotion",
      sourceContactId: input.contactId,
      createdIndividualCustomerId: input.createdCustomerId,
      billingCustomerId: input.customerId,
      orderId: input.orderId,
      invoiceId: input.invoiceId ?? null,
      resolution: input.resolution,
      quickBooksCustomerResult: "pending_customer_sync",
    } as any,
  } as any);
}
