import { and, eq } from 'drizzle-orm';
import { auditLogs, invoices } from '@shared/schema';
import { db } from '../db';
import { getInvoiceCustomerReleaseEligibility } from '../lib/invoiceCustomerRelease';
import { lockInvoicePaymentContext } from './invoicePaymentSession.service';
import { getBillingOwnershipReview } from './billingOwnershipReview.service';
import { BILLING_OWNERSHIP_REVIEW_MESSAGE } from '@shared/billingOwnershipReview';

/** One release-only transaction for every staff surface. The shared payment
 * context lock serializes release against ownership/commercial changes. */
export async function releaseInvoiceToCustomer(input: {
  organizationId: string;
  invoiceId: string;
  actorUserId: string;
  actorUserName?: string | null;
}) {
  return db.transaction(async (tx) => {
    await lockInvoicePaymentContext(tx, input.organizationId, [input.invoiceId]);
    const [invoice] = await tx.select().from(invoices).where(and(
      eq(invoices.id, input.invoiceId), eq(invoices.organizationId, input.organizationId),
    )).limit(1);
    if (!invoice) throw Object.assign(new Error('Invoice not found.'), { statusCode: 404 });
    if (invoice.customerReleasedAt) return { releasedAt: invoice.customerReleasedAt, alreadyReleased: true };
    const eligibility = getInvoiceCustomerReleaseEligibility(invoice);
    if (!eligibility.eligible) throw Object.assign(new Error(eligibility.reason!), { statusCode: 409 });
    if (await getBillingOwnershipReview(input.organizationId, invoice.id, tx)) {
      throw Object.assign(new Error(BILLING_OWNERSHIP_REVIEW_MESSAGE), { statusCode: 409 });
    }
    const now = new Date();
    // Deliberately leave status, commercial version, terms, approval and QB
    // checkpoints unchanged. No email or provider work occurs here.
    await tx.update(invoices).set({ customerReleasedAt: now, customerReleasedByUserId: input.actorUserId, updatedAt: now })
      .where(and(eq(invoices.id, invoice.id), eq(invoices.organizationId, input.organizationId)));
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId, userId: input.actorUserId, userName: input.actorUserName || null,
      actionType: 'invoice_customer_released', entityType: 'invoice', entityId: invoice.id,
      entityName: String(invoice.displayNumber || invoice.invoiceNumber),
      description: 'Invoice released to customer without accounting approval or email delivery.',
      newValues: { customerReleasedAt: now.toISOString(), source: 'staff_manual', invoiceVersion: invoice.invoiceVersion },
    });
    return { releasedAt: now, alreadyReleased: false };
  });
}
