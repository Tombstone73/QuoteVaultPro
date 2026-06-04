import { z } from "zod";
import { generateOrderPdfBytes, orderPdfFilename } from "./orderPdf";

const emailSchema = z.string().trim().email();

export const orderEmailRecipientPayloadSchema = z.object({
  recipientEmail: emailSchema,
  recipientName: z.string().trim().max(200).optional().or(z.literal("")),
  saveToCustomerContact: z.boolean().optional().default(false),
  contactId: z.string().trim().nullable().optional(),
  attachPdf: z.boolean().optional().default(true),
});

export type OrderEmailRecipientPayload = z.infer<typeof orderEmailRecipientPayloadSchema>;

export type OrderEmailRecipientResult = {
  success: boolean;
  message: string;
  contactSave?: {
    success: boolean;
    mode: "use_once" | "existing_contact" | "new_contact";
    contactId?: string | null;
    error?: string;
  };
};

export class OrderEmailRecipientError extends Error {
  statusCode: number;
  result?: OrderEmailRecipientResult;

  constructor(message: string, statusCode = 400, result?: OrderEmailRecipientResult) {
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

type OrderLike = {
  id: string;
  customerId?: string | null;
  orderNumber?: number | string | null;
  displayNumber?: string | null;
  lineItems?: unknown[] | null;
};

type OrganizationLike = {
  id?: string | null;
  name?: string | null;
  settings?: { currency?: string | null } | null;
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

export type OrderEmailRecipientDeps = {
  getOrderById: (organizationId: string, orderId: string) => Promise<OrderLike | undefined | null>;
  getCustomerContacts: (customerId: string) => Promise<ContactLike[]>;
  updateCustomerContactForOrganization: (organizationId: string, contactId: string, data: Record<string, unknown>) => Promise<ContactLike>;
  createCustomerContactForOrganization: (organizationId: string, customerId: string, data: Record<string, unknown>) => Promise<ContactLike>;
  getOrganizationById: (organizationId: string) => Promise<OrganizationLike | undefined | null>;
  sendOrderEmail: (
    organizationId: string,
    orderId: string,
    recipientEmail: string,
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

export type OrderEmailRecipientInput = {
  organizationId: string;
  orderId: string;
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

async function audit(deps: OrderEmailRecipientDeps, input: OrderEmailRecipientInput, entry: AuditLogEntryWithoutRequestContext) {
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
    console.error("[ORDER_EMAIL] Failed to write recipient audit log:", error);
  }
}

export async function sendOrderEmailWithRecipientFallback(
  deps: OrderEmailRecipientDeps,
  input: OrderEmailRecipientInput,
): Promise<OrderEmailRecipientResult> {
  if (!input.isInternalUser) {
    throw new OrderEmailRecipientError("Order email is available to staff only.", 403);
  }

  const parsed = orderEmailRecipientPayloadSchema.safeParse(input.payload);
  if (!parsed.success) {
    throw new OrderEmailRecipientError("A valid recipient email is required.", 400);
  }

  const payload = parsed.data;
  const order = await deps.getOrderById(input.organizationId, input.orderId);
  if (!order) {
    throw new OrderEmailRecipientError("Order not found", 404);
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
      const pdfBytes = await generateOrderPdfBytes({ order: order as any, organization });
      attachments = [{
        filename: orderPdfFilename(order),
        content: Buffer.from(pdfBytes),
        contentType: "application/pdf",
      }];
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate order PDF.";
      throw new OrderEmailRecipientError(`Order PDF attachment failed: ${message}`, 500);
    }
  }

  let contactSave:
    | { success: true; mode: "existing_contact" | "new_contact"; contactId: string }
    | { success: false; mode: "existing_contact" | "new_contact"; error: string }
    | undefined;

  if (payload.saveToCustomerContact) {
    const saveMode = payload.contactId ? "existing_contact" : "new_contact";
    if (!order.customerId) {
      contactSave = { success: false, mode: saveMode, error: "Order customer is required before saving a recipient contact." };
    } else if (payload.contactId) {
      try {
        const contacts = await deps.getCustomerContacts(order.customerId);
        const existing = contacts.find((contact) => contact.id === payload.contactId);
        if (!existing) {
          throw new Error("Selected contact is not linked to this order customer.");
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
          description: `Saved order email recipient to existing contact for order ${order.displayNumber ?? order.orderNumber ?? order.id}.`,
          newValues: { orderId: order.id, recipientEmail: payload.recipientEmail, mode: "existing_contact" },
        });
      } catch (error) {
        contactSave = { success: false, mode: "existing_contact", error: error instanceof Error ? error.message : "Failed to update contact." };
      }
    } else {
      try {
        const nameParts = splitRecipientName(payload.recipientName, payload.recipientEmail);
        const contact = await deps.createCustomerContactForOrganization(input.organizationId, order.customerId, {
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
          description: `Created contact from order email recipient for order ${order.displayNumber ?? order.orderNumber ?? order.id}.`,
          newValues: { orderId: order.id, recipientEmail: payload.recipientEmail, mode: "new_contact" },
        });
      } catch (error) {
        contactSave = { success: false, mode: "new_contact", error: error instanceof Error ? error.message : "Failed to create contact." };
      }
    }
  }

  let sendError: string | null = null;
  try {
    await deps.sendOrderEmail(input.organizationId, order.id, payload.recipientEmail, { attachments });
  } catch (error) {
    sendError = error instanceof Error ? error.message : "Failed to send order email.";
  }

  if (sendError) {
    const message = contactSave?.success
      ? `Contact was saved, but order email failed: ${sendError}`
      : sendError;
    throw new OrderEmailRecipientError(message, 500, {
      success: false,
      message,
      contactSave,
    });
  }

  await audit(deps, input, {
    actionType: "order_email_sent",
    entityType: "order",
    entityId: order.id,
    entityName: String(order.displayNumber ?? order.orderNumber ?? order.id),
    description: `Order email sent to ${payload.recipientEmail}.`,
    newValues: {
      recipientEmail: payload.recipientEmail,
      recipientName: payload.recipientName || null,
      saveToCustomerContact: payload.saveToCustomerContact,
      contactId: payload.contactId ?? (contactSave?.success ? contactSave.contactId : null),
      recipientMode,
      attachPdf: payload.attachPdf,
      pdfAttached: payload.attachPdf,
    },
  });

  if (contactSave && !contactSave.success) {
    return {
      success: true,
      message: `Order email sent, but contact was not saved: ${contactSave.error}`,
      contactSave,
    };
  }

  return {
    success: true,
    message: "Order email sent successfully",
    contactSave: contactSave ?? { success: true, mode: "use_once", contactId: null },
  };
}
