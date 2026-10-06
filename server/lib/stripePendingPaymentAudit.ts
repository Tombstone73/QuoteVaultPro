/** Pure historical classifier. This module never changes Stripe or local data. */
export type PendingStripeAuditEvidence = {
  organizationId: string;
  payment: { id: string; organization_id: string; invoice_id: string; provider: string; status: string; amount_cents: number; currency: string;
    updated_at: string; metadata?: Record<string, any>; external_accounting_id?: string | null; quickbooks_payment_reference?: string | null;
    paid_at?: unknown; succeeded_at?: unknown; refunded_at?: unknown; synced_at?: unknown; qb_reconciled_at?: unknown; customer_payment_batch_id?: string | null; stripe_payment_intent_id?: string | null };
  invoiceOrganizationId: string | null;
  accountVerified: boolean;
  attempt?: { id: string; organization_id: string; invoice_id: string; stripe_account_id: string; stripe_payment_intent_id: string | null; amount_cents: number; currency: string; status: string } | null;
  hasRefundOrSuccessfulEvidence: boolean;
  hasAccountingEvidence: boolean;
  lookup: 'found' | 'not_found' | 'unavailable';
  // Only independently verified, exhaustive processor absence may authorize D.
  orphanAbsenceVerified?: boolean;
  stripe?: { id: string; status: string; amount: number; amount_received: number; amount_capturable: number; currency: string; latest_charge: unknown; metadata: Record<string, string> };
};
export function classifyPendingStripePayment(e: PendingStripeAuditEvidence) {
  const p = e.payment, pi = e.stripe, a = e.attempt;
  const result = (classification: string, reason: string, retire = false) => ({ classification, reason, automaticMutation: false,
    proposedMutation: retire ? { paymentId: p.id, organizationId: e.organizationId, expectedStatus: 'pending', expectedUpdatedAt: p.updated_at,
      set: { status: 'canceled', syncStatus: 'skipped' }, preserveExistingMetadata: true,
      requiredAuditMetadata: ['oldStatus', 'oldSyncStatus', 'processorEvidence', 'accountId', 'auditId', 'approvedBy', 'repairedAt'],
      processorPrerequisite: classification.startsWith('B.') ? 'Retrieve exact account; cancel unfunded intent; re-retrieve canceled with zero funds before local transaction' : 'Re-verify terminal/absence evidence immediately before local transaction',
    } : null });
  if (p.organization_id !== e.organizationId || e.invoiceOrganizationId !== e.organizationId || p.provider !== 'stripe' || p.status !== 'pending' ||
    !p.metadata?.stripeAccountId || !e.accountVerified || p.customer_payment_batch_id ||
    (a && (a.organization_id !== e.organizationId || a.invoice_id !== p.invoice_id || a.stripe_account_id !== p.metadata.stripeAccountId ||
      a.stripe_payment_intent_id !== p.stripe_payment_intent_id || Number(a.amount_cents) !== Number(p.amount_cents) || a.currency.toUpperCase() !== p.currency.toUpperCase())) ||
    (p.metadata?.stripePaymentAttemptId && (!a || a.id !== p.metadata.stripePaymentAttemptId))) {
    return result('E.MANUAL_REVIEW', 'Missing or inconsistent tenant, account, attempt, or batch lineage');
  }
  if (e.hasAccountingEvidence || p.external_accounting_id || p.quickbooks_payment_reference || p.synced_at || p.qb_reconciled_at ||
    e.hasRefundOrSuccessfulEvidence || p.paid_at || p.succeeded_at || p.refunded_at || a?.status === 'succeeded') {
    return result('E.MANUAL_REVIEW', 'Financial, refund, or accounting evidence must be reconciled first');
  }
  if (e.lookup !== 'found' || !pi) {
    return e.lookup === 'not_found' && e.orphanAbsenceVerified
      ? result('D.ORPHANED_LOCAL_PAYMENT', 'Exact account and exhaustive absence checks verified', true)
      : result('E.MANUAL_REVIEW', 'Processor unavailable/not found is not proof of nonpayment');
  }
  if (pi.id !== p.stripe_payment_intent_id || pi.metadata.organizationId !== e.organizationId || pi.metadata.invoiceId !== p.invoice_id ||
    pi.metadata.stripeAccountId !== p.metadata.stripeAccountId || (a && pi.metadata.stripePaymentAttemptId !== a.id) ||
    pi.amount !== Number(p.amount_cents) || pi.currency.toUpperCase() !== p.currency.toUpperCase()) {
    return result('E.MANUAL_REVIEW', 'Processor identity, currency, or amount mismatch');
  }
  if (pi.status === 'succeeded' && pi.amount_received === pi.amount && pi.amount_received > 0) {
    return result('A.CONFIRMED_SUCCEEDED', 'Propose canonical settlement reconciliation; never cancel or delete');
  }
  if (pi.amount_received !== 0 || pi.amount_capturable !== 0 || pi.latest_charge || ['processing', 'requires_capture'].includes(pi.status)) {
    return result('E.MANUAL_REVIEW', 'Money, charge, processing, or capture evidence requires review');
  }
  if (pi.status === 'canceled') return result('C.TERMINAL_FAILED_OR_CANCELED', 'Stripe proves terminal cancellation with no funds', true);
  if (['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(pi.status)) {
    return result('B.UNFUNDED_ACTIVE_OR_ABANDONED', 'Stripe proves an unfunded retryable intent; processor cancellation must precede local retirement', true);
  }
  return result('E.MANUAL_REVIEW', 'Unrecognized processor state');
}
