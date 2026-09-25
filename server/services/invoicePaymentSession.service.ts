import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { invoices, payments, stripePaymentAttempts, customerPaymentBatches, invoiceGuestPaymentTokens } from '../../shared/schema';
import { getStripeClient } from '../lib/stripe';
import { canCancelUnfundedStripeIntent, hasAppliedInvoicePayment } from '../lib/invoicePaymentEvidence';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class InvoicePaymentContextError extends Error {
  readonly statusCode = 409;
  readonly code = 'INVOICE_PAYMENT_CONTEXT_CHANGED';
}

/** Shared by intent creation and invoice changes. Advisory locks allow the
 * existing payment services to retain their independent ledger transactions. */
export async function lockInvoicePaymentContext(tx: Transaction, organizationId: string, invoiceIds: string[]) {
  for (const id of Array.from(new Set(invoiceIds)).sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice-payment-context:${organizationId}:${id}`}))`);
  }
}

export function withInvoicePaymentContext<T>(organizationId: string, invoiceIds: string[], work: () => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await lockInvoicePaymentContext(tx, organizationId, invoiceIds);
    return work();
  });
}

/** Cancel at Stripe BEFORE retiring local attempts or committing new invoice
 * context. Cancellation races/failures abort the edit; captured money is never
 * undone. A DB rollback may leave a safely canceled intent, which checkout
 * already reconciles before creating another attempt. */
export async function retireInvoicePaymentSessions(tx: Transaction, input: {
  organizationId: string; invoiceId: string; expectedVersion: number; ownerChange?: boolean;
}) {
  await lockInvoicePaymentContext(tx, input.organizationId, [input.invoiceId]);
  const [current] = await tx.select().from(invoices).where(and(eq(invoices.id, input.invoiceId), eq(invoices.organizationId, input.organizationId))).limit(1);
  if (!current || Number(current.invoiceVersion || 1) !== input.expectedVersion) {
    throw new InvoicePaymentContextError('Invoice changed while saving. Reload and try again.');
  }
  const rows = await tx.select().from(payments).where(and(eq(payments.invoiceId, input.invoiceId), eq(payments.organizationId, input.organizationId)));
  const attempts = await tx.select().from(stripePaymentAttempts).where(and(eq(stripePaymentAttempts.invoiceId, input.invoiceId), eq(stripePaymentAttempts.organizationId, input.organizationId), inArray(stripePaymentAttempts.status, ['reserved', 'pending'])));
  const batches = await tx.select().from(customerPaymentBatches).where(and(
    eq(customerPaymentBatches.organizationId, input.organizationId), eq(customerPaymentBatches.provider, 'stripe'), eq(customerPaymentBatches.status, 'pending'),
    sql`${customerPaymentBatches.providerEvidence}->'allocations' @> ${JSON.stringify([{ invoiceId: input.invoiceId }])}::jsonb`,
  ));
  const intents = new Map<string, string>();
  for (const row of rows) {
    if (hasAppliedInvoicePayment(row)) {
      if (input.ownerChange) throw new InvoicePaymentContextError('This Invoice has a payment applied or refunded.');
      continue;
    }
    if (row.provider !== 'stripe') {
      if (!['failed', 'canceled', 'voided'].includes(row.status)) throw new InvoicePaymentContextError('This Invoice has an unresolved payment. Resolve it before changing billing details.');
      continue;
    }
    if (row.stripePaymentIntentId) {
      const account = String(row.metadata?.stripeAccountId || attempts.find(a => a.stripePaymentIntentId === row.stripePaymentIntentId)?.stripeAccountId || '');
      intents.set(row.stripePaymentIntentId, account);
    } else if (row.status === 'pending') throw new InvoicePaymentContextError('A Stripe payment is still being initialized. Retry after it resolves.');
  }
  for (const row of [...attempts, ...batches]) {
    if (!row.stripePaymentIntentId) throw new InvoicePaymentContextError('A Stripe payment is still being initialized. Retry after it resolves.');
    intents.set(row.stripePaymentIntentId, String(row.stripeAccountId || ''));
  }
  for (const [intentId, account] of Array.from(intents.entries())) {
    if (!account) throw new InvoicePaymentContextError('Stripe account identity is missing. Review the payment before changing billing details.');
    try {
      const stripe = getStripeClient();
      const intent = await stripe.paymentIntents.retrieve(intentId, { expand: ['latest_charge'] }, { stripeAccount: account, timeout: 10000, maxNetworkRetries: 0 });
      const matchesInvoice = intent.metadata.invoiceId === input.invoiceId;
      const matchesBatch = batches.some(batch => batch.id === intent.metadata.customerPaymentBatchId && batch.stripePaymentIntentId === intentId);
      if (intent.metadata.organizationId !== input.organizationId || (!matchesInvoice && !matchesBatch)) {
        throw new InvoicePaymentContextError('Stripe payment identity does not match this invoice. Review the payment before changing billing details.');
      }
      const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
      if (intent.status === 'succeeded' || intent.amount_received > 0 || (charge?.paid && charge.captured)) {
        throw new InvoicePaymentContextError('Stripe has received a payment. Reconcile it before changing billing details.');
      }
      if (intent.status !== 'canceled') {
        if (!canCancelUnfundedStripeIntent(intent)) throw new InvoicePaymentContextError('Stripe payment is processing or authorized. Resolve it before changing billing details.');
        const canceled = await stripe.paymentIntents.cancel(intentId, {}, { stripeAccount: account, idempotencyKey: `invoice-context-cancel:${intentId}`, timeout: 10000, maxNetworkRetries: 0 });
        if (canceled.status !== 'canceled') throw new InvoicePaymentContextError('Stripe payment could not be safely canceled. Retry after it resolves.');
      }
    } catch (error) {
      if (error instanceof InvoicePaymentContextError) throw error;
      throw new InvoicePaymentContextError('Unable to verify or cancel the incomplete Stripe payment. Billing details were not changed; retry after checking the payment.');
    }
    await tx.update(payments).set({ status: 'canceled', canceledAt: new Date(), updatedAt: new Date() }).where(and(eq(payments.organizationId, input.organizationId), eq(payments.stripePaymentIntentId, intentId), inArray(payments.status, ['pending', 'failed', 'canceled'])));
    await tx.update(stripePaymentAttempts).set({ status: 'canceled', updatedAt: new Date() }).where(and(eq(stripePaymentAttempts.organizationId, input.organizationId), eq(stripePaymentAttempts.stripePaymentIntentId, intentId), inArray(stripePaymentAttempts.status, ['reserved', 'pending'])));
    await tx.update(customerPaymentBatches).set({ status: 'canceled', updatedAt: new Date() }).where(and(eq(customerPaymentBatches.organizationId, input.organizationId), eq(customerPaymentBatches.stripePaymentIntentId, intentId), eq(customerPaymentBatches.status, 'pending')));
  }
  if (input.ownerChange) await tx.update(invoiceGuestPaymentTokens).set({ revokedAt: new Date() }).where(and(eq(invoiceGuestPaymentTokens.organizationId, input.organizationId), eq(invoiceGuestPaymentTokens.invoiceId, input.invoiceId)));
}
