import { renderEmailSubject, renderEmailTemplate } from "@shared/emailTemplateVariables";
import { documentEmailAddressSchema } from "@shared/documentEmailRecipients";

export type QuoteRecipientContactLike = {
  id?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
};

export const CREATE_NEW_CONTACT_CHOICE = "__create_new_contact__";

export function isValidRecipientEmail(value: string): boolean {
  return documentEmailAddressSchema.safeParse(value).success;
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

export function buildQuoteEmailDraftDefaults(input: {
  quoteReference: string;
  companyName: string;
  recipientName?: string | null;
  customerName?: string | null;
  jobLabel?: string | null;
  subjectTemplate?: string | null;
  bodyTemplate?: string | null;
}): { subject: string; body: string } {
  const recipientName = input.recipientName?.trim() || input.customerName?.trim() || "there";
  const variables = {
    quoteNumber: input.quoteReference,
    companyName: input.companyName,
    customerName: input.customerName?.trim() || recipientName,
    recipientName,
    jobLabel: input.jobLabel,
  };
  const subjectTemplate = input.subjectTemplate?.trim()
    || `Quote ${input.quoteReference} from ${input.companyName}`;
  const bodyTemplate = input.bodyTemplate?.trim()
    || `Hello ${recipientName},\n\nPlease review quote ${input.quoteReference} below.\n\nThank you for your business!`;

  return {
    subject: renderEmailSubject(subjectTemplate, "quote", variables),
    body: renderEmailTemplate(bodyTemplate, "quote", variables),
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

export function resolveAttachQuotePdfDefault(preferences: { basic?: { attachQuotePdfByDefault?: boolean } } | null | undefined): boolean {
  return preferences?.basic?.attachQuotePdfByDefault ?? true;
}
