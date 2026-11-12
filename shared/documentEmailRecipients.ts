import { z } from "zod";

export const documentEmailAddressSchema = z.string().trim().max(254).email();
export const MAX_DOCUMENT_EMAIL_RECIPIENTS = 50;
export const MAX_DOCUMENT_EMAIL_RECIPIENT_TEXT = 13_000;
export const documentEmailRecipientFields = ["to", "cc", "bcc"] as const;
export type DocumentEmailRecipientField = typeof documentEmailRecipientFields[number];
export type DocumentEmailRecipients = Record<DocumentEmailRecipientField, string[]>;
export type DocumentEmailRecipientInput = Partial<Record<DocumentEmailRecipientField, string | string[]>>;

const recipientList = z.union([z.string().max(MAX_DOCUMENT_EMAIL_RECIPIENT_TEXT), z.array(z.string().max(254)).max(100)]);
export const documentEmailRecipientInputSchema = z.object({
  to: recipientList.optional(), cc: recipientList.optional(), bcc: recipientList.optional(),
}).strict();

/** Parse plain addresses only. Preserve original spelling and the first header for duplicate addresses. */
export function parseDocumentEmailRecipients(input: DocumentEmailRecipientInput) {
  const recipients: DocumentEmailRecipients = { to: [], cc: [], bcc: [] };
  const errors: Partial<Record<DocumentEmailRecipientField, string>> = {};
  const seen = new Set<string>();
  for (const field of documentEmailRecipientFields) {
    const value = input[field];
    if (typeof value === "string" && value.length > MAX_DOCUMENT_EMAIL_RECIPIENT_TEXT) {
      errors[field] = `${field.toUpperCase()} exceeds the address list length limit.`;
      continue;
    }
    const addresses = typeof value === "string" ? value.split(/[,;\s]+/u).filter(Boolean) : value ?? [];
    for (const address of addresses) {
      const parsed = documentEmailAddressSchema.safeParse(address);
      if (!parsed.success) {
        errors[field] ??= `Invalid address in ${field.toUpperCase()}: ${address.trim().slice(0, 254) || "(blank)"}`;
        continue;
      }
      const key = parsed.data.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      recipients[field].push(parsed.data);
    }
  }
  return {
    recipients,
    errors,
    limitError: seen.size > MAX_DOCUMENT_EMAIL_RECIPIENTS ? `Enter at most ${MAX_DOCUMENT_EMAIL_RECIPIENTS} unique recipients.` : null,
  };
}

export type QuoteEmailRequest = {
  recipientEmail?: string;
  recipients?: DocumentEmailRecipientInput;
  recipientName?: string;
  subject?: string;
  body?: string;
  saveToCustomerContact?: boolean;
  contactId?: string | null;
  attachPdf?: boolean;
};

export type QuoteEmailResult = {
  success: boolean;
  message: string;
  providerMessageId?: string;
  code?: "EMAIL_DELIVERY_UNCONFIRMED";
  contactSave?: {
    success: boolean;
    mode: "use_once" | "existing_contact" | "new_contact";
    contactId?: string | null;
    error?: string;
  };
};
