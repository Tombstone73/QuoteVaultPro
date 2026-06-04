export type OrderRecipientContactLike = {
  id?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
};

export type OrderRecipientFallbackValues = {
  recipientEmail: string;
  recipientName?: string;
  saveToCustomerContact: boolean;
  contactChoice: string;
  attachPdf: boolean;
};

export const CREATE_NEW_ORDER_CONTACT_CHOICE = "__create_new_order_contact__";

export function isValidOrderRecipientEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function getOrderContactDisplayName(contact: OrderRecipientContactLike): string {
  const name = `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim();
  return name || contact.email || "Unnamed contact";
}

export function getInitialOrderRecipientContactChoice(
  contacts: OrderRecipientContactLike[],
  selectedContactId?: string | null,
): string {
  if (selectedContactId && contacts.some((contact) => contact.id === selectedContactId)) {
    return selectedContactId;
  }
  return contacts[0]?.id ?? CREATE_NEW_ORDER_CONTACT_CHOICE;
}

export function buildOrderRecipientFallbackPayload(values: OrderRecipientFallbackValues) {
  const recipientEmail = values.recipientEmail.trim();
  const recipientName = values.recipientName?.trim() || undefined;
  const saveToCustomerContact = values.saveToCustomerContact;
  const contactId =
    saveToCustomerContact && values.contactChoice !== CREATE_NEW_ORDER_CONTACT_CHOICE
      ? values.contactChoice
      : null;

  return {
    recipientEmail,
    recipientName,
    saveToCustomerContact,
    contactId,
    attachPdf: values.attachPdf,
  };
}

export function resolveSelectedOrderContactEmail(
  contacts: OrderRecipientContactLike[],
  selectedContactId?: string | null,
): string | null {
  const selected = contacts.find((contact) => contact.id === selectedContactId);
  const email = selected?.email?.trim();
  return email && isValidOrderRecipientEmail(email) ? email : null;
}

export function resolveAttachOrderPdfDefault(preferences: { basic?: { attachOrderPdfByDefault?: boolean } } | null | undefined): boolean {
  return preferences?.basic?.attachOrderPdfByDefault ?? true;
}
