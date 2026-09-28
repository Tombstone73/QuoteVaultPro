import { and, eq, sql } from 'drizzle-orm';
import { auditLogs, invoices } from '@shared/schema';
import { hasAdminOrOwnerOperationalRole } from '@shared/roleAccess';
import { BILLING_OWNERSHIP_REVIEW_MESSAGE, type BillingOwnershipReview } from '@shared/billingOwnershipReview';
import { db } from '../db';
import { lockInvoicePaymentContext } from './invoicePaymentSession.service';

export class BillingOwnershipReviewError extends Error {
  constructor(message: string, readonly statusCode = 409, readonly code = 'BILLING_OWNERSHIP_REVIEW_REQUIRED') { super(message); }
}
export function requireBillingOwnershipReviewer(role: string | null | undefined) {
  if (!hasAdminOrOwnerOperationalRole(role)) throw new BillingOwnershipReviewError('Organization Admin or Owner role required.', 403);
}

/** The audit event is the durable hold. Queue/error/status writes cannot erase it.
 * A resolution acknowledges a specific event, never every future override. */
export async function getBillingOwnershipReview(organizationId: string, invoiceId: string, handle: any = db): Promise<BillingOwnershipReview | null> {
  const result = await handle.execute(sql`
    select a.id, a.entity_id as "invoiceId", a.new_values->>'reason' as reason, a.created_at as "createdAt"
    from audit_logs a
    where a.organization_id = ${organizationId} and a.entity_type = 'invoice' and a.entity_id = ${invoiceId}
      and a.action_type = 'invoice_billing_ownership_override'
      and not exists (select 1 from audit_logs r where r.organization_id = a.organization_id
        and r.entity_type = 'invoice' and r.entity_id = a.entity_id
        and r.action_type = 'invoice_billing_ownership_reconciled' and r.new_values->>'overrideId' = a.id)
    order by a.created_at desc, a.id desc limit 1`);
  return (result.rows ?? result)[0] ?? null;
}
export async function assertBillingOwnershipReconciled(organizationId: string, invoiceId: string, handle: any = db) {
  if (await getBillingOwnershipReview(organizationId, invoiceId, handle)) throw new BillingOwnershipReviewError(BILLING_OWNERSHIP_REVIEW_MESSAGE);
}

/** Serialize provider transmission with the canonical ownership transaction. */
export function withBillingOwnershipSyncGuard<T>(organizationId: string, invoiceId: string, work: () => Promise<T>): Promise<T> {
  return db.transaction(async tx => {
    await lockInvoicePaymentContext(tx, organizationId, [invoiceId]);
    await assertBillingOwnershipReconciled(organizationId, invoiceId, tx);
    return work();
  });
}

export async function acknowledgeBillingOwnershipReview(input: { organizationId: string; invoiceId: string; overrideId: string; actorUserId: string; actorOrgRole: string; reason: string; confirmed: boolean }) {
  requireBillingOwnershipReviewer(input.actorOrgRole);
  if (input.confirmed !== true || !input.reason?.trim()) throw new BillingOwnershipReviewError('Confirm QuickBooks was manually corrected and provide a reconciliation note.', 400);
  return db.transaction(async tx => {
    await lockInvoicePaymentContext(tx, input.organizationId, [input.invoiceId]);
    const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.organizationId, input.organizationId), eq(invoices.id, input.invoiceId))).for('update');
    if (!invoice) throw new BillingOwnershipReviewError('Invoice not found.', 404);
    const hold = await getBillingOwnershipReview(input.organizationId, invoice.id, tx);
    if (!hold || hold.id !== input.overrideId) throw new BillingOwnershipReviewError('Accounting review changed. Reload before acknowledging it.');
    await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId,
      entityType: 'invoice', entityId: invoice.id, entityName: String(invoice.displayNumber || invoice.invoiceNumber),
      actionType: 'invoice_billing_ownership_reconciled', description: 'Staff acknowledged that QuickBooks billing ownership was manually corrected. Accounting approval is still required.',
      newValues: { overrideId: hold.id, reason: input.reason.trim(), customerId: invoice.customerId, contactId: invoice.contactId, acknowledgedAt: new Date().toISOString() } });
    // Keep approval revoked and provider evidence intact. This never queues a send.
    await tx.update(invoices).set({ qbSyncStatus: 'needs_resync', qbLastError: null, syncError: null, updatedAt: new Date() })
      .where(and(eq(invoices.organizationId, input.organizationId), eq(invoices.id, invoice.id)));
  });
}
