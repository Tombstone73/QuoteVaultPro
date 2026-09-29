import { resolveCanonicalInvoiceCustomerOwnership } from '../../shared/invoiceCustomerOwnership';

type InvoiceEvidence = {
  id: string; organization_id: string; order_id: string | null; customer_id: string | null;
  contact_id: string | null; import_source: string | null; total_cents: number;
  balance_due: string; amount_paid: string; status: string; qb_invoice_id: string | null;
  external_accounting_id: string | null;
};
type OrderEvidence = { id: string; organization_id: string; customer_id: string | null; contact_id: string | null };
type PaymentEvidence = {
  id: string; organization_id: string; invoice_id: string; customer_payment_batch_id: string;
  amount_cents: number; status: string; paid_at: string; created_at: string;
  external_accounting_id: string | null; sync_status: string; synced_at: string | null;
};
type BatchEvidence = {
  id: string; organization_id: string; customer_id: string; amount_cents: number; status: string;
  created_at: string; created_by_user_id: string; stripe_payment_intent_id: string;
  provider_evidence: { portal?: boolean; initiatedByCustomerId?: string;
    allocations?: { invoiceId: string; amountCents: number }[];
    stripeSuccess?: { paymentIntentId: string; amountCents: number; occurredAt: string } };
};
type AuditEvidence = { id: string; created_at: string; entity_id: string; old_values: any; new_values: any };
export type InvoiceOwnershipEvidence = {
  organizationId: string; invoiceId: string; actor: string; reason: string;
  invoice: InvoiceEvidence; order: OrderEvidence | null; batch: BatchEvidence | null;
  allocations: { payment: PaymentEvidence; invoice: InvoiceEvidence; order: OrderEvidence | null }[];
  ownerAudit: AuditEvidence[];
};

/** Pure, fail-closed proposal. This deliberately has no apply mode: a reviewer
 * must resolve missing chronology/external accounting evidence before any repair.
 * No ledger value or historical provider evidence is ever proposed for rewriting. */
export function planInvoiceOwnershipReconciliation(e: InvoiceOwnershipEvidence, reviewedAt = new Date()) {
  const blockers: string[] = [];
  const { invoice, order, batch } = e;
  const customerId = order?.customer_id ?? null;
  if (!e.actor.trim() || !e.reason.trim()) blockers.push('ACTOR_AND_REASON_REQUIRED');
  if (!order || invoice.id !== e.invoiceId || invoice.order_id !== order.id || !customerId
    || invoice.organization_id !== e.organizationId || order.organization_id !== e.organizationId) blockers.push('ORDER_INVOICE_SCOPE_INVALID');
  if (invoice.import_source || invoice.contact_id) blockers.push('NATIVE_CUSTOMER_INVOICE_REQUIRED');
  if (invoice.customer_id === customerId) blockers.push('NO_STALE_INVOICE_OWNER');
  if (!batch || batch.organization_id !== e.organizationId || batch.customer_id !== customerId
    || batch.provider_evidence?.portal !== true || batch.provider_evidence.initiatedByCustomerId !== customerId
    || !batch.created_by_user_id) blockers.push('AUTHORIZED_PORTAL_PAYER_NOT_PROVEN');

  const chronology = e.ownerAudit.find(a => a.entity_id === order?.id
    && a.old_values?.customerId === invoice.customer_id && a.new_values?.customerId === customerId
    && Number.isFinite(Date.parse(a.created_at)) && Date.parse(a.created_at) < Date.parse(batch?.created_at ?? ''));
  if (!chronology) blockers.push('PRE_PAYMENT_OWNERSHIP_CHRONOLOGY_NOT_PROVEN');
  const intended = batch?.provider_evidence?.allocations ?? [];
  const success = batch?.provider_evidence?.stripeSuccess;
  if (!batch || batch.status !== 'succeeded' || !success || !batch.stripe_payment_intent_id
    || success.paymentIntentId !== batch.stripe_payment_intent_id || success.amountCents !== batch.amount_cents
    || !Number.isFinite(Date.parse(success.occurredAt))) blockers.push('PROVIDER_SUCCESS_NOT_PROVEN');
  if (!intended.length || new Set(intended.map(a => a.invoiceId)).size !== intended.length
    || e.allocations.length !== intended.length || new Set(e.allocations.map(a => a.invoice.id)).size !== e.allocations.length
    || !e.allocations.some(a => a.invoice.id === invoice.id)
    || e.allocations.reduce((sum, a) => sum + a.payment.amount_cents, 0) !== batch?.amount_cents) blockers.push('ALLOCATION_TOTAL_OR_MEMBERSHIP_MISMATCH');
  for (const a of e.allocations) {
    const owner = resolveCanonicalInvoiceCustomerOwnership({ invoiceCustomerId: a.invoice.customer_id,
      invoiceContactId: a.invoice.contact_id, invoiceImportSource: a.invoice.import_source,
      linkedOrderId: a.invoice.order_id, linkedOrderCustomerId: a.order?.customer_id, linkedOrderContactId: a.order?.contact_id });
    if (a.payment.organization_id !== e.organizationId || a.invoice.organization_id !== e.organizationId
      || (a.order && a.order.organization_id !== e.organizationId) || a.payment.invoice_id !== a.invoice.id
      || a.payment.customer_payment_batch_id !== batch?.id || (a.invoice.order_id && a.invoice.order_id !== a.order?.id)
      || owner.customerId !== customerId) blockers.push('CROSS_CUSTOMER_OR_TENANT_ALLOCATION');
    if (!Number.isInteger(a.payment.amount_cents) || a.payment.amount_cents <= 0
      || !['succeeded', 'captured'].includes(a.payment.status)
      || intended.find(i => i.invoiceId === a.invoice.id)?.amountCents !== a.payment.amount_cents) blockers.push('ALLOCATION_FINANCIAL_EVIDENCE_MISMATCH');
    // Siblings already exported under the correct owner remain untouched.
    if (a.invoice.customer_id !== customerId && (a.payment.external_accounting_id
      || a.payment.synced_at || a.payment.sync_status === 'synced')) blockers.push('STALE_OWNER_PAYMENT_ALREADY_EXPORTED');
  }
  // An Invoice export is distinct from a payment export. It does not prove the
  // payer wrong, but external CustomerRef must be inspected before local repair.
  if (invoice.qb_invoice_id || invoice.external_accounting_id) blockers.push('EXTERNAL_INVOICE_CUSTOMER_REF_REVIEW_REQUIRED');
  const uniqueBlockers = Array.from(new Set(blockers));
  return {
    mode: 'dry-run' as const, eligible: uniqueBlockers.length === 0, blockers: uniqueBlockers,
    audit: { actionType: 'invoice_billing_identity_reconciliation', organizationId: e.organizationId,
      orderId: order?.id ?? null, invoiceId: invoice.id, paymentBatchId: batch?.id ?? null,
      paymentIds: e.allocations.map(a => a.payment.id), previousCustomerId: invoice.customer_id, newCustomerId: customerId,
      actor: e.actor, reviewedAt: reviewedAt.toISOString(), reason: e.reason, ownershipAuditId: chronology?.id ?? null },
    proposedChanges: uniqueBlockers.length ? [] : [{ table: 'invoices', id: invoice.id, field: 'customer_id', from: invoice.customer_id, to: customerId }],
    preserved: { invoiceTotalCents: invoice.total_cents, invoiceBalance: invoice.balance_due, invoiceAmountPaid: invoice.amount_paid,
      invoiceStatus: invoice.status, batchAmountCents: batch?.amount_cents,
      allocations: e.allocations.map(a => ({ paymentId: a.payment.id, invoiceId: a.invoice.id, amountCents: a.payment.amount_cents,
        status: a.payment.status, paidAt: a.payment.paid_at, createdAt: a.payment.created_at,
        externalAccountingId: a.payment.external_accounting_id })) },
  };
}
