import { and, asc, desc, eq } from "drizzle-orm";

import { customerContactLinks, customerContacts, customers } from "@shared/schema";
import { resolveOrderCustomerIdForContact } from "@shared/orderCustomerResolution";
import { db } from "../db";

export async function resolveOrderCustomerContactIds(input: {
  organizationId: string;
  customerId?: string | null;
  contactId?: string | null;
}): Promise<{ customerId: string | null; contactId: string | null }> {
  const customerId = input.customerId?.trim() || null;
  const contactId = input.contactId?.trim() || null;
  if (!contactId) return { customerId, contactId: null };

  const [contact] = await db
    .select({ id: customerContacts.id, customerId: customerContacts.customerId })
    .from(customerContacts)
    .where(and(eq(customerContacts.id, contactId), eq(customerContacts.organizationId, input.organizationId)))
    .limit(1);

  // Preserve the repository's existing typed not-found error for invalid contacts.
  if (!contact) return { customerId, contactId };

  const links = await db
    .select({ id: customers.id, isPrimary: customerContactLinks.isPrimary })
    .from(customerContactLinks)
    .innerJoin(customers, and(
      eq(customers.id, customerContactLinks.customerId),
      eq(customers.organizationId, input.organizationId),
    ))
    .where(and(
      eq(customerContactLinks.organizationId, input.organizationId),
      eq(customerContactLinks.contactId, contact.id),
      eq(customerContactLinks.status, "active"),
    ))
    .orderBy(desc(customerContactLinks.isPrimary), asc(customers.companyName), asc(customers.id));

  if (contact.customerId && !links.some((link) => link.id === contact.customerId)) {
    const [legacyCustomer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, contact.customerId), eq(customers.organizationId, input.organizationId)))
      .limit(1);
    if (legacyCustomer) links.push({ id: legacyCustomer.id, isPrimary: false });
  }

  return {
    customerId: resolveOrderCustomerIdForContact({
      currentCustomerId: customerId,
      legacyCustomerId: contact.customerId,
      linkedCustomers: links,
    }),
    contactId,
  };
}
