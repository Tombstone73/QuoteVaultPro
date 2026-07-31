export function buildInboundQuoteCreatedAuditLogValues(input: {
  organizationId: string;
  actorUserId: string;
  inboundRecordId: string;
  quote: { id: string; displayNumber?: string | null; quoteNumber?: number | null };
  record: { sourceType: string; externalReference?: string | null };
  snapshotId: string;
  snapshotVersion: number;
  createdLineItemCount: number;
  skippedLineItemCount: number;
}) {
  return {
    organizationId: input.organizationId,
    userId: input.actorUserId,
    userName: null,
    actionType: "quote_created_from_inbound",
    entityType: "quote",
    entityId: input.quote.id,
    entityName: input.quote.displayNumber ?? String(input.quote.quoteNumber ?? input.quote.id),
    description: "Quote draft created from inbound review.",
    newValues: {
      inboundRecordId: input.inboundRecordId,
      inboundDraftId: input.inboundRecordId,
      sourceType: input.record.sourceType,
      sourceReference: input.record.externalReference ?? null,
      resultingQuoteId: input.quote.id,
      resultingQuoteNumber: input.quote.quoteNumber ?? null,
      snapshotId: input.snapshotId,
      snapshotVersion: input.snapshotVersion,
      convertedLineItemCount: input.createdLineItemCount,
      skippedLineItemCount: input.skippedLineItemCount,
    },
  };
}
