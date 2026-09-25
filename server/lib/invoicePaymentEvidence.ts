import type { Payment } from '../../shared/schema';

type PaymentEvidence = Pick<Payment, 'status' | 'succeededAt' | 'paidAt' | 'refundedAt' | 'customerPaymentBatchId' | 'customerAccountCreditApplicationId' | 'externalAccountingId' | 'syncedAt' | 'qbReconciledAt'>;

export function hasAppliedInvoicePayment(payment: PaymentEvidence): boolean {
  // appliedAt is populated even for pending Stripe rows. It is NOT evidence
  // of an allocation. Batch/credit foreign keys represent actual allocations.
  return ['succeeded', 'captured', 'refunded', 'partially_refunded'].includes(payment.status.toLowerCase()) ||
    Boolean(payment.succeededAt || payment.paidAt || payment.refundedAt || payment.customerPaymentBatchId ||
      payment.customerAccountCreditApplicationId || payment.externalAccountingId || payment.syncedAt || payment.qbReconciledAt);
}

export function canCancelUnfundedStripeIntent(intent: { status: string; amount_received: number }): boolean {
  return intent.amount_received === 0 && ['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(intent.status);
}
