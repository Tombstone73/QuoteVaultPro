import { describe, expect, test } from '@jest/globals';
import { planInvoiceOwnershipReconciliation, type InvoiceOwnershipEvidence } from '../services/invoiceOwnershipReconciliation';

function fixture(): InvoiceOwnershipEvidence {
  const invoice = { id: 'invoice', organization_id: 'org', order_id: 'order', customer_id: 'old', contact_id: null,
    import_source: null, total_cents: 8500, balance_due: '0.00', amount_paid: '85.00', status: 'paid', qb_invoice_id: null, external_accounting_id: null };
  const order = { id: 'order', organization_id: 'org', customer_id: 'new', contact_id: null };
  return { organizationId: 'org', invoiceId: 'invoice', actor: 'reviewer', reason: 'Correct stale local owner', invoice, order,
    batch: { id: 'batch', organization_id: 'org', customer_id: 'new', amount_cents: 8500, status: 'succeeded',
      created_at: '2026-09-29T15:11:38Z', created_by_user_id: 'portal-user', stripe_payment_intent_id: 'pi_test',
      provider_evidence: { portal: true, initiatedByCustomerId: 'new', allocations: [{ invoiceId: 'invoice', amountCents: 8500 }],
        stripeSuccess: { paymentIntentId: 'pi_test', amountCents: 8500, occurredAt: '2026-09-29T15:12:05Z' } } },
    allocations: [{ invoice, order, payment: { id: 'payment', organization_id: 'org', invoice_id: 'invoice', customer_payment_batch_id: 'batch',
      amount_cents: 8500, status: 'succeeded', paid_at: '2026-09-29T15:12:05Z', created_at: '2026-09-29T15:12:06Z',
      external_accounting_id: null, sync_status: 'skipped', synced_at: null } }],
    ownerAudit: [{ id: 'owner-change', created_at: '2026-08-28T16:51:18Z', entity_id: 'order',
      old_values: { customerId: 'old' }, new_values: { customerId: 'new' } }] };
}
describe('read-only historical identity proposal', () => {
  test('proposes only the stale owner, preserves the ledger, and records review evidence', () => {
    const e = fixture(); const before = structuredClone(e); const result = planInvoiceOwnershipReconciliation(e);
    expect(result.eligible).toBe(true);
    expect(result.proposedChanges).toEqual([{ table: 'invoices', id: 'invoice', field: 'customer_id', from: 'old', to: 'new' }]);
    expect(result.audit).toMatchObject({ actor: 'reviewer', ownershipAuditId: 'owner-change', previousCustomerId: 'old', newCustomerId: 'new', paymentIds: ['payment'] });
    expect(result.preserved).toMatchObject({ invoiceTotalCents: 8500, invoiceBalance: '0.00', batchAmountCents: 8500,
      allocations: [{ paymentId: 'payment', amountCents: 8500, status: 'succeeded', paidAt: '2026-09-29T15:12:05Z' }] });
    expect(e).toEqual(before);
  });
  test.each(['missing', 'after-payment', 'wrong-owner'])('fails closed for %s chronology', scenario => {
    const e = fixture();
    if (scenario === 'missing') e.ownerAudit = [];
    if (scenario === 'after-payment') e.ownerAudit[0].created_at = '2026-09-30T00:00:00Z';
    if (scenario === 'wrong-owner') e.ownerAudit[0].new_values.customerId = 'other';
    expect(planInvoiceOwnershipReconciliation(e).blockers).toContain('PRE_PAYMENT_OWNERSHIP_CHRONOLOGY_NOT_PROVEN');
    expect(planInvoiceOwnershipReconciliation(e).proposedChanges).toEqual([]);
  });
  test('previous Invoice export is separate from payment export, but requires external review', () => {
    const e = fixture(); e.invoice.qb_invoice_id = '26614';
    const result = planInvoiceOwnershipReconciliation(e);
    expect(result.blockers).toEqual(['EXTERNAL_INVOICE_CUSTOMER_REF_REVIEW_REQUIRED']);
  });
  test.each(['external_accounting_id', 'sync_status', 'synced_at'])('exported old-owner payment blocks using %s evidence', key => {
    const e = fixture(); Object.assign(e.allocations[0].payment, { [key]: key === 'sync_status' ? 'synced' : 'external-evidence' });
    expect(planInvoiceOwnershipReconciliation(e).blockers).toContain('STALE_OWNER_PAYMENT_ALREADY_EXPORTED');
  });
  test('cross-customer allocation fails', () => {
    const e = fixture(); e.allocations[0].order = { ...e.order!, customer_id: 'other' };
    expect(planInvoiceOwnershipReconciliation(e).blockers).toContain('CROSS_CUSTOMER_OR_TENANT_ALLOCATION');
  });
  test('cross-tenant allocation fails', () => {
    const e = fixture(); e.allocations[0].payment.organization_id = 'foreign';
    expect(planInvoiceOwnershipReconciliation(e).blockers).toContain('CROSS_CUSTOMER_OR_TENANT_ALLOCATION');
  });
  test('mismatched amount or allocation membership cannot be repaired as identity', () => {
    const e = fixture(); e.allocations[0].payment.amount_cents = 9000;
    expect(planInvoiceOwnershipReconciliation(e).blockers).toContain('ALLOCATION_FINANCIAL_EVIDENCE_MISMATCH');
    e.allocations = [];
    expect(planInvoiceOwnershipReconciliation(e).blockers).toContain('ALLOCATION_TOTAL_OR_MEMBERSHIP_MISMATCH');
  });
  test('current owner alone is not proof of authorized portal initiation', () => {
    const e = fixture(); delete e.batch!.provider_evidence.initiatedByCustomerId;
    expect(planInvoiceOwnershipReconciliation(e).blockers).toContain('AUTHORIZED_PORTAL_PAYER_NOT_PROVEN');
  });
});
