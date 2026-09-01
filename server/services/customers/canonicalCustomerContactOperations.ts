import { and, eq, ilike, sql } from "drizzle-orm";
import { auditLogs, customerContactLinks, customers, insertCustomerContactSchema, insertCustomerSchema, updateCustomerContactSchema, updateCustomerSchema } from "@shared/schema";
import { db } from "../../db";
import { CustomersRepository } from "../../storage/customers.repo";
import { hasUsableInvoiceRecipientEmail } from "@shared/invoiceRecipientContact";

export class CanonicalCustomerContactError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 409) { super(message); }
}

type PrimaryContactInput = { firstName: string; lastName: string; email: string; phone?: string; title?: string; isPrimary?: boolean };

/** Shared tenant/actor/audit boundary for reviewed Customer and Contact operations. */
export class CanonicalCustomerContactOperations {
  async createCustomer(input: { organizationId: string; actorUserId: string; customer: Record<string, unknown>; primaryContact?: PrimaryContactInput | null; rejectExactDuplicate?: boolean; auditReference?: string }) {
    const customer = insertCustomerSchema.parse(input.customer) as any;
    return db.transaction(async (tx) => {
      if (input.rejectExactDuplicate) {
        const normalizedName = String(customer.companyName || "").trim().toLowerCase();
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.organizationId}:customer:${normalizedName}`}))`);
        const [duplicate] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.organizationId, input.organizationId), ilike(customers.companyName, String(customer.companyName).trim()))).limit(1);
        if (duplicate) throw new CanonicalCustomerContactError("CUSTOMER_DUPLICATE", "A customer with that company name already exists.");
      }
      const repository = new CustomersRepository(tx as any);
      const result = await repository.createCustomerWithPrimaryContact(input.organizationId, { customer, primaryContact: input.primaryContact ?? null });
      await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, actionType: "customer_created", entityType: "customer", entityId: result.customer.id, entityName: result.customer.companyName, description: "Created customer through canonical Customer operation.", newValues: { auditReference: input.auditReference ?? null, primaryContactId: result.contact?.id ?? null } as any } as any);
      return result;
    });
  }

  async updateCustomer(input: { organizationId: string; actorUserId: string; customerId: string; patch: Record<string, unknown>; auditReference?: string }) {
    const patch = updateCustomerSchema.parse(input.patch) as any;
    if (!Object.keys(patch).length) throw new CanonicalCustomerContactError("CUSTOMER_PATCH_EMPTY", "Provide at least one customer field to update.", 400);
    return db.transaction(async (tx) => {
      const repository = new CustomersRepository(tx as any);
      const previous = await repository.getCustomerById(input.organizationId, input.customerId);
      if (!previous) throw new CanonicalCustomerContactError("CUSTOMER_NOT_FOUND", "Customer not found.", 404);
      const updated = await repository.updateCustomer(input.organizationId, input.customerId, patch);
      await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, actionType: "customer_updated", entityType: "customer", entityId: updated.id, entityName: updated.companyName, description: "Updated customer through canonical Customer operation.", oldValues: previous as any, newValues: { patch, auditReference: input.auditReference ?? null } as any } as any);
      return updated;
    });
  }

  async createContact(input: { organizationId: string; actorUserId: string; customerId?: string | null; contact: Record<string, unknown>; role?: string | null; isBilling?: boolean; auditReference?: string }) {
    const parsed = insertCustomerContactSchema.parse({ ...input.contact, organizationId: input.organizationId, customerId: input.customerId ?? null }) as any;
    const { organizationId: _org, customerId: _customer, ...fields } = parsed;
    if (input.isBilling === true && !hasUsableInvoiceRecipientEmail(fields.email)) {
      throw new CanonicalCustomerContactError("CONTACT_EMAIL_REQUIRED", "Add a valid email address before enabling Receives Invoices.", 400);
    }
    return db.transaction(async (tx) => {
      const repository = new CustomersRepository(tx as any);
      const created = input.customerId ? await repository.createCustomerContactForOrganization(input.organizationId, input.customerId, fields) : await repository.createContactForOrganization(input.organizationId, fields);
      if (input.customerId && input.role !== undefined) await tx.update(customerContactLinks).set({ role: input.role, updatedAt: new Date() }).where(and(eq(customerContactLinks.organizationId, input.organizationId), eq(customerContactLinks.customerId, input.customerId), eq(customerContactLinks.contactId, created.id), eq(customerContactLinks.status, "active")));
      if (input.customerId && input.isBilling !== undefined) await tx.update(customerContactLinks).set({ isBilling: input.isBilling, updatedAt: new Date() }).where(and(eq(customerContactLinks.organizationId, input.organizationId), eq(customerContactLinks.customerId, input.customerId), eq(customerContactLinks.contactId, created.id), eq(customerContactLinks.status, "active")));
      await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, actionType: "customer_contact_created", entityType: "customer_contact", entityId: created.id, entityName: `${created.firstName} ${created.lastName}`.trim(), description: "Created contact through canonical Contact operation.", newValues: { customerId: input.customerId ?? null, role: input.role ?? null, isBilling: input.isBilling, auditReference: input.auditReference ?? null } as any } as any);
      return created;
    });
  }

  async updateContact(input: { organizationId: string; actorUserId: string; contactId: string; patch: Record<string, unknown>; customerId?: string | null; role?: string | null; isBilling?: boolean; auditReference?: string }) {
    const parsedPatch = updateCustomerContactSchema.parse(input.patch) as any;
    const { isPrimary, customerId: _legacyCustomerId, organizationId: _organizationId, ...patch } = parsedPatch;
    if (!Object.keys(patch).length && input.role === undefined && input.isBilling === undefined && isPrimary === undefined) throw new CanonicalCustomerContactError("CONTACT_PATCH_EMPTY", "Provide at least one contact field to update.", 400);
    return db.transaction(async (tx) => {
      const repository = new CustomersRepository(tx as any);
      const previous = await repository.getContactWithRelations(input.contactId, input.organizationId);
      if (!previous) throw new CanonicalCustomerContactError("CONTACT_NOT_FOUND", "Contact not found.", 404);
      const effectiveEmail = patch.email === undefined ? previous.email : patch.email;
      if (input.isBilling === true && !hasUsableInvoiceRecipientEmail(effectiveEmail)) {
        throw new CanonicalCustomerContactError("CONTACT_EMAIL_REQUIRED", "Add a valid email address before enabling Receives Invoices.", 400);
      }
      const updated = Object.keys(patch).length ? await repository.updateCustomerContactForOrganization(input.organizationId, input.contactId, patch) : previous;
      const links = await tx.select().from(customerContactLinks).where(and(eq(customerContactLinks.organizationId, input.organizationId), eq(customerContactLinks.contactId, input.contactId), eq(customerContactLinks.status, "active")));
      const relationshipCustomerId = input.customerId ?? (links.length === 1 ? links[0].customerId : null);
      if ((input.role !== undefined || input.isBilling !== undefined || isPrimary !== undefined) && !relationshipCustomerId) throw new CanonicalCustomerContactError("CONTACT_RELATIONSHIP_AMBIGUOUS", "Select the customer relationship to update.", 409);
      if (relationshipCustomerId && (input.role !== undefined || input.isBilling !== undefined || isPrimary !== undefined)) {
        const relationship = links.find((link) => link.customerId === relationshipCustomerId);
        if (!relationship) throw new CanonicalCustomerContactError("CONTACT_RELATIONSHIP_NOT_FOUND", "Contact relationship not found.", 404);
        if (isPrimary === true) await tx.update(customerContactLinks).set({ isPrimary: false, updatedAt: new Date() }).where(and(eq(customerContactLinks.organizationId, input.organizationId), eq(customerContactLinks.customerId, relationshipCustomerId), eq(customerContactLinks.status, "active")));
        await tx.update(customerContactLinks).set({ ...(input.role === undefined ? {} : { role: input.role }), ...(input.isBilling === undefined ? {} : { isBilling: input.isBilling }), ...(isPrimary === undefined ? {} : { isPrimary }), updatedAt: new Date() }).where(eq(customerContactLinks.id, relationship.id));
      }
      await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, actionType: "customer_contact_updated", entityType: "customer_contact", entityId: input.contactId, entityName: `${updated.firstName} ${updated.lastName}`.trim(), description: "Updated contact through canonical Contact operation.", oldValues: previous as any, newValues: { patch, role: input.role, isBilling: input.isBilling, auditReference: input.auditReference ?? null } as any } as any);
      return updated;
    });
  }
}

export const canonicalCustomerContactOperations = new CanonicalCustomerContactOperations();
