export type QuoteRecipientContactLike = {
  id?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
};

export type QuoteRecipientFallbackValues = {
  recipientEmail: string;
  recipientName?: string;
  saveToCustomerContact: boolean;
  contactChoice: string;
};

export const CREATE_NEW_CONTACT_CHOICE = "__create_new_contact__";

export function isValidRecipientEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function getContactDisplayName(contact: QuoteRecipientContactLike): string {
  const name = `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim();
  return name || contact.email || "Unnamed contact";
}

export function getInitialRecipientContactChoice(
  contacts: QuoteRecipientContactLike[],
  selectedContactId?: string | null,
): string {
  if (selectedContactId && contacts.some((contact) => contact.id === selectedContactId)) {
    return selectedContactId;
  }
  return contacts[0]?.id ?? CREATE_NEW_CONTACT_CHOICE;
}

export function buildQuoteRecipientFallbackPayload(values: QuoteRecipientFallbackValues) {
  const recipientEmail = values.recipientEmail.trim();
  const recipientName = values.recipientName?.trim() || undefined;
  const saveToCustomerContact = values.saveToCustomerContact;
  const contactId =
    saveToCustomerContact && values.contactChoice !== CREATE_NEW_CONTACT_CHOICE
      ? values.contactChoice
      : null;

  return {
    recipientEmail,
    recipientName,
    saveToCustomerContact,
    contactId,
  };
}

export function resolveSelectedContactEmail(
  contacts: QuoteRecipientContactLike[],
  selectedContactId?: string | null,
): string | null {
  const selected = contacts.find((contact) => contact.id === selectedContactId);
  const email = selected?.email?.trim();
  return email && isValidRecipientEmail(email) ? email : null;
}
