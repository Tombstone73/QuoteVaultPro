import { buildInvoiceEmailRecipients, type InvoiceEmailRecipientSource } from "../../shared/invoiceEmailRecipients";

export type CustomerStatementRecipientContact = {
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
};

/**
 * Statements intentionally follow the invoice-recipient policy: active billing
 * contacts win; otherwise use the primary contact, account email, then other
 * active contacts. The database query supplying these contacts is tenant- and
 * relationship-scoped by the caller.
 */
export function buildCustomerStatementRecipients(input: {
  customerEmail: string | null;
  customerName: string | null;
  contacts: CustomerStatementRecipientContact[];
}): CustomerStatementRecipient[] {
  const contactName = (contact: CustomerStatementRecipientContact) =>
    `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "Contact";
  const billingContacts = input.contacts.filter((contact) => contact.isBilling);
  const primaryContacts = input.contacts.filter((contact) => contact.isPrimary);
  const otherContacts = input.contacts.filter((contact) => !contact.isPrimary);
  const candidates = billingContacts.length > 0
    ? billingContacts.map((contact) => ({
      email: contact.email,
      name: contactName(contact),
      source: "billing_contact" as const,
    }))
    : [
      ...primaryContacts.map((contact) => ({
        email: contact.email,
        name: contactName(contact),
        source: "customer_primary_contact" as const,
      })),
      {
        email: input.customerEmail,
        name: input.customerName || "Customer account",
        source: "customer_account" as const,
      },
      ...otherContacts.map((contact) => ({
        email: contact.email,
        name: contactName(contact),
        source: "customer_contact" as const,
      })),
    ];

  return buildInvoiceEmailRecipients(candidates).map((recipient) => ({
    email: recipient.email,
    label: recipient.name,
    source: recipient.source,
  }));
}
