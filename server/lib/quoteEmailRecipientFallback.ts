import { z } from "zod";
import { generateQuotePdfBytes } from "./quotePdf";

const emailSchema = z.string().trim().email();

export const quoteEmailRecipientPayloadSchema = z.object({
  recipientEmail: emailSchema,
  recipientName: z.string().trim().max(200).optional().or(z.literal("")),
  saveToCustomerContact: z.boolean().optional().default(false),
  contactId: z.string().trim().nullable().optional(),
  attachPdf: z.boolean().optional().default(true),
});

export type QuoteEmailRecipientPayload = z.infer<typeof quoteEmailRecipientPayloadSchema>;

export type QuoteEmailRecipientResult = {
  success: boolean;
  message: string;
  contactSave?: {
    success: boolean;
    mode: "use_once" | "existing_contact" | "new_contact";
    contactId?: string | null;
    error?: string;
  };
};

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

type QuoteLike = {
  id: string;
  customerId?: string | null;
  quoteNumber?: number | string | null;
  displayNumber?: string | null;
  lineItems?: unknown[] | null;
};

type OrganizationLike = {
  id?: string | null;
  name?: string | null;
  settings?: { currency?: string | null } | null;
};

export type QuoteEmailRecipientDeps = {
  getQuoteById: (organizationId: string, quoteId: string, userId?: string) => Promise<QuoteLike | undefined | null>;
  getCustomerContacts: (customerId: string) => Promise<ContactLike[]>;
  updateCustomerContactForOrganization: (organizationId: string, contactId: string, data: Record<string, unknown>) => Promise<ContactLike>;
  createCustomerContactForOrganization: (organizationId: string, customerId: string, data: Record<string, unknown>) => Promise<ContactLike>;
  getOrganizationById: (organizationId: string) => Promise<OrganizationLike | undefined | null>;
  sendQuoteEmail: (
    organizationId: string,
    quoteId: string,
    recipientEmail: string,
    userId?: string,
    options?: { attachments?: Array<{ filename: string; content: Buffer; contentType: string }> },
  ) => Promise<void>;
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

function quotePdfFilename(quote: QuoteLike): string {
  const display = quote.displayNumber || (quote.quoteNumber ? `QT-${quote.quoteNumber}` : quote.id);
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
    throw new QuoteEmailRecipientError("A valid recipient email is required.", 400);
  }

  const payload = parsed.data;
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
      const pdfBytes = await generateQuotePdfBytes({ quote: quote as any, organization });
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

  if (payload.saveToCustomerContact && !input.isInternalUser) {
    throw new QuoteEmailRecipientError("Only staff can save quote recipients to customer contacts.", 403);
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
        const nameParts = splitRecipientName(payload.recipientName, payload.recipientEmail);
        const updateData: Record<string, unknown> = { email: payload.recipientEmail };
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
          entityName: `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || payload.recipientEmail,
          description: `Saved quote email recipient to existing contact for quote ${quote.displayNumber ?? quote.quoteNumber ?? quote.id}.`,
          newValues: { quoteId: quote.id, recipientEmail: payload.recipientEmail, mode: "existing_contact" },
        });
      } catch (error) {
        contactSave = { success: false, mode: "existing_contact", error: error instanceof Error ? error.message : "Failed to update contact." };
      }
    } else {
      try {
        const nameParts = splitRecipientName(payload.recipientName, payload.recipientEmail);
        const contact = await deps.createCustomerContactForOrganization(input.organizationId, quote.customerId, {
          firstName: nameParts.firstName,
          lastName: nameParts.lastName,
          email: payload.recipientEmail,
          isPrimary: false,
        });
        contactSave = { success: true, mode: "new_contact", contactId: contact.id };
        await audit(deps, input, {
          actionType: "CREATE",
          entityType: "contact",
          entityId: contact.id,
          entityName: `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || payload.recipientEmail,
          description: `Created contact from quote email recipient for quote ${quote.displayNumber ?? quote.quoteNumber ?? quote.id}.`,
          newValues: { quoteId: quote.id, recipientEmail: payload.recipientEmail, mode: "new_contact" },
        });
      } catch (error) {
        contactSave = { success: false, mode: "new_contact", error: error instanceof Error ? error.message : "Failed to create contact." };
      }
    }
  }

  await audit(deps, input, {
    actionType: "QUOTE_EMAIL_RECIPIENT",
    entityType: "quote",
    entityId: quote.id,
    entityName: String(quote.displayNumber ?? quote.quoteNumber ?? quote.id),
    description:
      mode === "use_once"
        ? `Used one-time quote email recipient ${payload.recipientEmail}.`
        : `Overrode quote email recipient with ${payload.recipientEmail}.`,
    newValues: {
      recipientEmail: payload.recipientEmail,
      recipientName: payload.recipientName || null,
      saveToCustomerContact: payload.saveToCustomerContact,
      contactId: payload.contactId ?? (contactSave?.success ? contactSave.contactId : null),
      mode: recipientMode,
      attachPdf: payload.attachPdf,
    },
  });

  let sendError: string | null = null;
  try {
    await deps.sendQuoteEmail(
      input.organizationId,
      quote.id,
      payload.recipientEmail,
      input.isInternalUser ? undefined : input.userId,
      { attachments },
    );
  } catch (error) {
    sendError = error instanceof Error ? error.message : "Failed to send quote email.";
  }

  if (sendError) {
    const message = contactSave?.success
      ? `Contact was saved, but quote email failed: ${sendError}`
      : sendError;
    throw new QuoteEmailRecipientError(message, 500, {
      success: false,
      message,
      contactSave,
    });
  }

  if (contactSave && !contactSave.success) {
    await audit(deps, input, {
      actionType: "quote_email_sent",
      entityType: "quote",
      entityId: quote.id,
      entityName: String(quote.displayNumber ?? quote.quoteNumber ?? quote.id),
      description: `Quote email sent to ${payload.recipientEmail}.`,
      newValues: { recipientMode, attachPdf: payload.attachPdf, pdfAttached: payload.attachPdf },
    });
    return {
      success: true,
      message: `Quote email sent, but contact was not saved: ${contactSave.error}`,
      contactSave,
    };
  }

  await audit(deps, input, {
    actionType: "quote_email_sent",
    entityType: "quote",
    entityId: quote.id,
    entityName: String(quote.displayNumber ?? quote.quoteNumber ?? quote.id),
    description: `Quote email sent to ${payload.recipientEmail}.`,
    newValues: { recipientMode, attachPdf: payload.attachPdf, pdfAttached: payload.attachPdf },
  });

  return {
    success: true,
    message: "Quote email sent successfully",
    contactSave: contactSave ?? { success: true, mode: "use_once", contactId: null },
  };
}
