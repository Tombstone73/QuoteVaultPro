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
    },
    createdAt: input.sentAt,
  };
}
