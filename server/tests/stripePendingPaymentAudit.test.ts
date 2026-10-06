import { expect, test } from '@jest/globals';
import { classifyPendingStripePayment, type PendingStripeAuditEvidence } from '../lib/stripePendingPaymentAudit';

function evidence(): PendingStripeAuditEvidence {
  return { organizationId: 'org', invoiceOrganizationId: 'org', accountVerified: true,
    payment: { id: 'payment', organization_id: 'org', invoice_id: 'invoice', provider: 'stripe', status: 'pending', amount_cents: 1000,
      currency: 'USD', updated_at: '2026-10-06T00:00:00Z', stripe_payment_intent_id: 'pi', metadata: { stripeAccountId: 'acct', stripePaymentAttemptId: 'attempt' } },
    attempt: { id: 'attempt', organization_id: 'org', invoice_id: 'invoice', stripe_account_id: 'acct', stripe_payment_intent_id: 'pi', amount_cents: 1000, currency: 'USD', status: 'pending' },
    hasRefundOrSuccessfulEvidence: false, hasAccountingEvidence: false, lookup: 'found',
    stripe: { id: 'pi', status: 'requires_payment_method', amount: 1000, amount_received: 0, amount_capturable: 0, currency: 'usd', latest_charge: null,
      metadata: { organizationId: 'org', invoiceId: 'invoice', stripeAccountId: 'acct', stripePaymentAttemptId: 'attempt' } } };
}
test('unfunded intent proposes guarded retirement without automatic mutation', () => {
  const e = evidence(); const before = JSON.stringify(e); const r = classifyPendingStripePayment(e);
  expect(r.classification).toBe('B.UNFUNDED_ACTIVE_OR_ABANDONED'); expect(r.automaticMutation).toBe(false);
  expect(r.proposedMutation).toMatchObject({ expectedStatus: 'pending', expectedUpdatedAt: e.payment.updated_at, set: { status: 'canceled', syncStatus: 'skipped' } });
  expect(r.proposedMutation?.processorPrerequisite).toContain('cancel unfunded intent'); expect(JSON.stringify(e)).toBe(before);
});
test('proven success requires canonical reconciliation and has no retirement proposal', () => {
  const e = evidence(); Object.assign(e.stripe!, { status: 'succeeded', amount_received: 1000, latest_charge: 'ch' });
  expect(classifyPendingStripePayment(e)).toMatchObject({ classification: 'A.CONFIRMED_SUCCEEDED', proposedMutation: null, automaticMutation: false });
});
test('proven canceled and unfunded intent is terminal', () => {
  const e = evidence(); e.stripe!.status = 'canceled'; expect(classifyPendingStripePayment(e).classification).toBe('C.TERMINAL_FAILED_OR_CANCELED');
});
test.each(['not_found', 'unavailable'] as const)('a %s lookup never proves unpaid', lookup => {
  const e = evidence(); e.lookup = lookup; delete e.stripe;
  expect(classifyPendingStripePayment(e)).toMatchObject({ classification: 'E.MANUAL_REVIEW', proposedMutation: null });
});
test('orphan requires explicit exhaustive absence evidence on the verified exact account', () => {
  const e = evidence(); e.lookup = 'not_found'; delete e.stripe; e.orphanAbsenceVerified = true;
  expect(classifyPendingStripePayment(e).classification).toBe('D.ORPHANED_LOCAL_PAYMENT');
  e.accountVerified = false; expect(classifyPendingStripePayment(e).classification).toBe('E.MANUAL_REVIEW');
});
test.each([
  (e: PendingStripeAuditEvidence) => { e.invoiceOrganizationId = 'other'; },
  (e: PendingStripeAuditEvidence) => { e.attempt!.stripe_account_id = 'other'; },
  (e: PendingStripeAuditEvidence) => { e.stripe!.amount = 999; },
  (e: PendingStripeAuditEvidence) => { e.stripe!.currency = 'eur'; },
  (e: PendingStripeAuditEvidence) => { e.stripe!.status = 'processing'; },
  (e: PendingStripeAuditEvidence) => { e.stripe!.status = 'requires_capture'; },
  (e: PendingStripeAuditEvidence) => { e.stripe!.amount_received = 500; },
  (e: PendingStripeAuditEvidence) => { e.stripe!.latest_charge = 'ch'; },
  (e: PendingStripeAuditEvidence) => { e.hasAccountingEvidence = true; },
  (e: PendingStripeAuditEvidence) => { e.hasRefundOrSuccessfulEvidence = true; },
  (e: PendingStripeAuditEvidence) => { e.payment.external_accounting_id = 'qb'; },
  (e: PendingStripeAuditEvidence) => { e.payment.customer_payment_batch_id = 'batch'; },
])('ambiguous evidence fails closed %#', change => {
  const e = evidence(); change(e); expect(classifyPendingStripePayment(e)).toMatchObject({ classification: 'E.MANUAL_REVIEW', proposedMutation: null, automaticMutation: false });
});
