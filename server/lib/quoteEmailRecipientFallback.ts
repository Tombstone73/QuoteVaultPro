import { z } from "zod";
import { documentEmailRecipientInputSchema, MAX_DOCUMENT_EMAIL_RECIPIENT_TEXT, parseDocumentEmailRecipients, type QuoteEmailResult } from "@shared/documentEmailRecipients";
import { generateQuotePdfBytes } from "./quotePdf";
import { getInvoiceEmailDeliveryFailureKind } from "../services/invoiceEmailDeliveryFailure";

export const quoteEmailRecipientPayloadSchema = z.object({
  recipientEmail: z.string().max(MAX_DOCUMENT_EMAIL_RECIPIENT_TEXT).optional(),
  recipients: documentEmailRecipientInputSchema.optional(),
  recipientName: z.string().trim().max(200).optional().or(z.literal("")),
  subject: z.string().trim().max(500).regex(/^[^\r\n]*$/).optional(),
  body: z.string().trim().max(20_000).optional().or(z.literal("")),
  saveToCustomerContact: z.boolean().optional().default(false),
  contactId: z.string().trim().nullable().optional(),
  attachPdf: z.boolean().optional().default(true),
});

export type QuoteEmailRecipientPayload = z.infer<typeof quoteEmailRecipientPayloadSchema>;

export type QuoteEmailRecipientResult = QuoteEmailResult;

export class QuoteEmailRecipientError extends Error {
  statusCode: number;
  result?: QuoteEmailRecipientResult;

  constructor(message: string, statusCode = 400, result?: QuoteEmailRecipientResult) {
    super(message);
    this.statusCode = statusCode;
    this.result = result;
  }
}

type ContactLike = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
};

type AuditLogEntryWithoutRequestContext = {
  actionType: string;
  entityType: string;
  entityId?: string | null;
  entityName?: string | null;
  description: string;
  oldValues?: unknown;
  newValues?: unknown;
};

export type QuoteEmailDocument = {
  id: string;
  customerId?: string | null;
  quoteNumber?: number | string | null;
  displayNumber?: string | null;
  revision?: number | null;
  customerName?: string | null;
  label?: string | null;
  lineItems?: unknown[] | null;
};

type OrganizationLike = {
  id?: string | null;
  name?: string | null;
  settings?: { currency?: string | null } | null;
};

type CompanySettingsLike = Record<string, unknown> | undefined | null;

export type QuoteEmailRecipientDeps = {
  getQuoteById: (organizationId: string, quoteId: string, userId?: string) => Promise<QuoteEmailDocument | undefined | null>;
  getCustomerContacts: (customerId: string) => Promise<ContactLike[]>;
  updateCustomerContactForOrganization: (organizationId: string, contactId: string, data: Record<string, unknown>) => Promise<ContactLike>;
  createCustomerContactForOrganization: (organizationId: string, customerId: string, data: Record<string, unknown>) => Promise<ContactLike>;
  getOrganizationById: (organizationId: string) => Promise<OrganizationLike | undefined | null>;
  getCompanySettings?: (organizationId: string) => Promise<CompanySettingsLike>;
  sendQuoteEmail: (
    organizationId: string,
    quoteId: string,
    recipientEmail: string | string[],
    userId?: string,
    options?: {
      subject?: string;
      body?: string;
      cc?: string[];
      bcc?: string[];
      quoteSnapshot?: QuoteEmailDocument;
      attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
    },
  ) => Promise<string>;
  createAuditLog: (entry: {
    organizationId: string;
    userId?: string | null;
    userName?: string | null;
    actionType: string;
    entityType: string;
    entityId?: string | null;
    entityName?: string | null;
    description: string;
    oldValues?: unknown;
    newValues?: unknown;
    ipAddress?: string | null;
    userAgent?: string | null;
  }) => Promise<void>;
};

export type QuoteEmailRecipientInput = {
  organizationId: string;
  quoteId: string;
  userId?: string;
  userName?: string | null;
  isInternalUser: boolean;
  payload: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
};

function splitRecipientName(name: string | undefined, email: string): { firstName: string; lastName: string } {
  const trimmed = (name ?? "").trim();
  if (!trimmed) {
    return { firstName: email.split("@")[0] || "Contact", lastName: "" };
  }
  const [firstName, ...rest] = trimmed.split(/\s+/);
  return { firstName: firstName || trimmed, lastName: rest.join(" ") };
}

function quotePdfFilename(quote: QuoteEmailDocument): string {
  const display = quote.displayNumber || (quote.quoteNumber ? `QT-${quote.quoteNumber}` : "document");
  const safe = String(display).replace(/[^a-z0-9._-]+/gi, "-");
  return `Quote_${safe}.pdf`;
}

async function audit(deps: QuoteEmailRecipientDeps, input: QuoteEmailRecipientInput, entry: AuditLogEntryWithoutRequestContext) {
  try {
    await deps.createAuditLog({
      ...entry,
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      userName: input.userName ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    });
  } catch (error) {
    console.error("[QUOTE_EMAIL] Failed to write recipient audit log:", error);
  }
}

export async function sendQuoteEmailWithRecipientFallback(
  deps: QuoteEmailRecipientDeps,
  input: QuoteEmailRecipientInput,
): Promise<QuoteEmailRecipientResult> {
  const parsed = quoteEmailRecipientPayloadSchema.safeParse(input.payload);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join(".");
    throw new QuoteEmailRecipientError(field ? `Check the ${field} field and its length.` : "Invalid quote email request.");
  }

  const payload = parsed.data;
  if (payload.recipients && payload.recipientEmail !== undefined) {
    throw new QuoteEmailRecipientError("Supply either the recipient list or the legacy recipient field.");
  }
  const { recipients, errors, limitError } = parseDocumentEmailRecipients(payload.recipients ?? { to: payload.recipientEmail });
  const recipientError = Object.values(errors)[0] ?? limitError;
  if (recipientError) throw new QuoteEmailRecipientError(recipientError);
  const [contactEmail] = recipients.to;
  if (!contactEmail) throw new QuoteEmailRecipientError("Enter at least one To email address.");
  if (payload.saveToCustomerContact && recipients.to.length !== 1) {
    throw new QuoteEmailRecipientError("Choose one To address to save to a contact, or send without saving.");
  }
  if (payload.saveToCustomerContact && !input.isInternalUser) {
    throw new QuoteEmailRecipientError("Only staff can save quote recipients to customer contacts.", 403);
  }
  const quote = await deps.getQuoteById(input.organizationId, input.quoteId, input.isInternalUser ? undefined : input.userId);
  if (!quote) {
    throw new QuoteEmailRecipientError("Quote not found", 404);
  }

  const mode = payload.saveToCustomerContact
    ? payload.contactId
      ? "existing_contact"
      : "new_contact"
    : "use_once";
  const recipientMode = mode === "existing_contact" ? "saved_contact" : mode;

  let attachments: Array<{ filename: string; content: Buffer; contentType: string }> | undefined;
  if (payload.attachPdf) {
    try {
      const organization = await deps.getOrganizationById(input.organizationId);
      const companySettings = deps.getCompanySettings ? await deps.getCompanySettings(input.organizationId) : null;
      const pdfBytes = await generateQuotePdfBytes({ quote: quote as any, organization, companySettings: companySettings as any });
      attachments = [{
        filename: quotePdfFilename(quote),
        content: Buffer.from(pdfBytes),
        contentType: "application/pdf",
      }];
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate quote PDF.";
      throw new QuoteEmailRecipientError(`Quote PDF attachment failed: ${message}`, 500);
    }
  }

  let contactSave:
    | { success: true; mode: "existing_contact" | "new_contact"; contactId: string }
    | { success: false; mode: "existing_contact" | "new_contact"; error: string }
    | undefined;

  if (payload.saveToCustomerContact) {
    const saveMode = payload.contactId ? "existing_contact" : "new_contact";
    if (!quote.customerId) {
      contactSave = { success: false, mode: saveMode, error: "Quote customer is required before saving a recipient contact." };
    } else if (payload.contactId) {
      try {
        const contacts = await deps.getCustomerContacts(quote.customerId);
        const existing = contacts.find((contact) => contact.id === payload.contactId);
        if (!existing) {
          throw new Error("Selected contact is not linked to this quote customer.");
        }
        if (contacts.some(contact => contact.id !== existing.id && contact.email?.trim().toLowerCase() === contactEmail.toLowerCase())) {
          throw new Error("Another contact for this customer already has that address.");
        }
        const nameParts = splitRecipientName(payload.recipientName, contactEmail);
        const updateData: Record<string, unknown> = { email: contactEmail };
        if ((payload.recipientName ?? "").trim()) {
          updateData.firstName = nameParts.firstName;
          updateData.lastName = nameParts.lastName;
        }
        const contact = await deps.updateCustomerContactForOrganization(input.organizationId, payload.contactId, updateData);
        contactSave = { success: true, mode: "existing_contact", contactId: contact.id };
        await audit(deps, input, {
          actionType: "UPDATE",
          entityType: "contact",
          entityId: contact.id,
          entityName: `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || contactEmail,
          description: `Saved quote email recipient to existing contact for quote ${quote.displayNumber ?? quote.quoteNumber ?? quote.id}.`,
          newValues: { quoteId: quote.id, recipientEmail: contactEmail, mode: "existing_contact" },
        });
      } catch (error) {
        contactSave = { success: false, mode: "existing_contact", error: error instanceof Error ? error.message : "Failed to update contact." };
      }
    } else {
      try {
        const contacts = await deps.getCustomerContacts(quote.customerId);
        const existing = contacts.find(contact => contact.email?.trim().toLowerCase() === contactEmail.toLowerCase());
        if (existing) throw new Error("A contact with that address already exists. Choose it to update the contact.");
        const nameParts = splitRecipientName(payload.recipientName, contactEmail);
        const contact = await deps.createCustomerContactForOrganization(input.organizationId, quote.customerId, {
          firstName: nameParts.firstName,
          lastName: nameParts.lastName,
          email: contactEmail,
          isPrimary: false,
        });
        contactSave = { success: true, mode: "new_contact", contactId: contact.id };
        await audit(deps, input, {
          actionType: "CREATE",
          entityType: "contact",
          entityId: contact.id,
          entityName: `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || contactEmail,
          description: `Created contact from quote email recipient for quote ${quote.displayNumber ?? quote.quoteNumber ?? quote.id}.`,
          newValues: { quoteId: quote.id, recipientEmail: contactEmail, mode: "new_contact" },
        });
      } catch (error) {
        contactSave = { success: false, mode: "new_contact", error: error instanceof Error ? error.message : "Failed to create contact." };
      }
    }
  }

  const auditRecipients = { recipientEmail: recipients.to.length === 1 ? contactEmail : null, recipients, quoteRevision: quote.revision ?? null };
  const summary = `${recipients.to.length} To, ${recipients.cc.length} CC, ${recipients.bcc.length} BCC`;
  await audit(deps, input, {
    actionType: "QUOTE_EMAIL_RECIPIENT",
    entityType: "quote",
    entityId: quote.id,
    entityName: String(quote.displayNumber ?? quote.quoteNumber ?? quote.id),
    description:
      mode === "use_once"
        ? `Used one-time quote email recipients (${summary}).`
        : `Overrode quote email recipient with ${contactEmail}.`,
    newValues: {
      ...auditRecipients,
      recipientName: payload.recipientName || null,
      saveToCustomerContact: payload.saveToCustomerContact,
      contactId: payload.contactId ?? (contactSave?.success ? contactSave.contactId : null),
      mode: recipientMode,
      attachPdf: payload.attachPdf,
      subject: payload.subject || null,
      body: payload.body || null,
    },
  });

  let providerMessageId: string;
  try {
    providerMessageId = await deps.sendQuoteEmail(
      input.organizationId,
      quote.id,
      recipients.to.length === 1 ? contactEmail : recipients.to,
      input.isInternalUser ? undefined : input.userId,
      {
        ...(payload.subject ? { subject: payload.subject } : {}),
        ...(payload.body ? { body: payload.body } : {}),
        ...(recipients.cc.length ? { cc: recipients.cc } : {}),
        ...(recipients.bcc.length ? { bcc: recipients.bcc } : {}),
        quoteSnapshot: quote,
        attachments,
      },
    );
  } catch (error) {
    const uncertain = getInvoiceEmailDeliveryFailureKind(error) === "needs_review";
    const sendError = uncertain ? "Gmail did not confirm submission. Check Gmail Sent before trying again." :
      error instanceof Error ? error.message : "Failed to submit quote email.";
    const message = contactSave?.success
      ? `Contact was saved, but quote email failed: ${sendError}`
      : sendError;
    throw new QuoteEmailRecipientError(message, 500, {
      success: false,
      message,
      contactSave,
      ...(uncertain ? { code: "EMAIL_DELIVERY_UNCONFIRMED" as const } : {}),
    });
  }

  await audit(deps, input, {
    actionType: "quote_email_sent",
    entityType: "quote",
    entityId: quote.id,
    entityName: String(quote.displayNumber ?? quote.quoteNumber ?? quote.id),
    description: `Gmail accepted the quote email (${summary}).`,
    newValues: {
      ...auditRecipients,
      providerMessageId,
      recipientMode,
      attachPdf: payload.attachPdf,
      pdfAttached: payload.attachPdf,
      subject: payload.subject || null,
      body: payload.body || null,
    },
  });

  return {
    success: true,
    message: contactSave && !contactSave.success
      ? `Gmail accepted the quote email, but the contact was not saved: ${contactSave.error}`
      : "Gmail accepted the quote email for sending.",
    providerMessageId,
    contactSave: contactSave ?? { success: true, mode: "use_once", contactId: null },
  };
}
