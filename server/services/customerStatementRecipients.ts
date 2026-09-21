import { buildInvoiceEmailRecipients, type InvoiceEmailRecipientSource } from "../../shared/invoiceEmailRecipients";

export type CustomerStatementRecipientContact = {
  id?: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  isBilling: boolean;
  isPrimary: boolean;
};

export type CustomerStatementRecipient = {
  email: string;
  label: string;
  source: InvoiceEmailRecipientSource;
  /** Saved contacts are retained for audit metadata; account email has none. */
  contactId: string | null;
  /** Billing/"Receives Invoices" contacts are defaults, never a restriction. */
  isDefault: boolean;
};

/**
 * Every active contact with a usable address is available to a statement
 * composer. Billing ("Receives Invoices") contacts are merely preselected.
 */
export function buildCustomerStatementRecipients(input: {
  customerEmail: string | null;
  customerName: string | null;
  contacts: CustomerStatementRecipientContact[];
}): CustomerStatementRecipient[] {
  const contactName = (contact: CustomerStatementRecipientContact) =>
    `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "Contact";
  const candidates = [
    ...input.contacts.filter((contact) => contact.isBilling).map((contact) => ({ contact, email: contact.email, name: contactName(contact), source: "billing_contact" as const })),
    ...input.contacts.filter((contact) => !contact.isBilling && contact.isPrimary).map((contact) => ({ contact, email: contact.email, name: contactName(contact), source: "customer_primary_contact" as const })),
    { contact: null, email: input.customerEmail, name: input.customerName || "Customer account", source: "customer_account" as const },
    ...input.contacts.filter((contact) => !contact.isBilling && !contact.isPrimary).map((contact) => ({ contact, email: contact.email, name: contactName(contact), source: "customer_contact" as const })),
  ];
  const resolved = buildInvoiceEmailRecipients(candidates);
  return resolved.map((recipient) => {
    const original = candidates.find((candidate) => candidate.email?.trim().toLowerCase() === recipient.email.toLowerCase());
    return { email: recipient.email, label: recipient.name, source: recipient.source, contactId: original?.contact?.id || null, isDefault: original?.contact?.isBilling === true };
  });
}
