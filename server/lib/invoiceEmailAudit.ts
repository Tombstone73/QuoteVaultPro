export type InvoiceEmailSentAuditInput = {
  organizationId: string;
  invoiceId: string;
  invoiceNumber: string | number | null | undefined;
  actorUserId?: string | null;
  actorName?: string | null;
  recipientEmail: string;
  invoiceVersion: number;
  messageId: string | null;
  sentAt: Date;
  sentWithUnapprovedOverride?: boolean;
  subject?: string;
  customizedSubject?: boolean;
  customizedMessage?: boolean;
};

/** A durable, operator-readable audit record created only after email delivery succeeds. */
export function buildInvoiceEmailSentAudit(input: InvoiceEmailSentAuditInput) {
  return {
    organizationId: input.organizationId,
    userId: input.actorUserId || null,
    userName: input.actorName || null,
    actionType: 'invoice.sent',
    entityType: 'invoice',
    entityId: input.invoiceId,
    entityName: String(input.invoiceNumber ?? input.invoiceId),
    description: `Invoice sent via email to ${input.recipientEmail}`,
    newValues: {
      via: 'email',
      invoiceVersion: input.invoiceVersion,
      recipientEmail: input.recipientEmail,
      messageId: input.messageId,
      sentWithUnapprovedOverride: Boolean(input.sentWithUnapprovedOverride),
      subject: input.subject || null,
      customizedSubject: Boolean(input.customizedSubject),
      customizedMessage: Boolean(input.customizedMessage),
    },
    createdAt: input.sentAt,
  };
}
