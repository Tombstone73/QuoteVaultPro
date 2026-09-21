export type LegacyCloseJobOverrideEvidence = {
  event?: { eventType?: string | null; payloadJson?: unknown } | null;
  audit?: { actionType?: string | null; entityType?: string | null } | null;
};

/** A legacy Close Job Override wrote both of these durable records before the
 * 0212 administrative allocation ledger existed. Requiring both avoids
 * treating an ordinary terminal parent or a manually-created audit row as
 * proof that staff intentionally closed fulfillment. */
export function isProvenLegacyCloseJobOverrideEvidence(input: LegacyCloseJobOverrideEvidence): boolean {
  const payload = input.event?.payloadJson as Record<string, unknown> | null | undefined;
  return input.event?.eventType === 'FULFILLMENT_HISTORICAL_RECONCILED'
    && payload?.source === 'administrative_historical_reconciliation'
    && payload?.shipmentOrPickupEvidenceCreated === false
    && payload?.billingAutomationSuppressed === true
    && input.audit?.actionType === 'ORDER_HISTORICAL_FULFILLMENT_RECONCILED'
    && input.audit?.entityType === 'order';
}
