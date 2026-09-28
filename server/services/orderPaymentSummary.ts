import { and, eq, inArray } from 'drizzle-orm';
import { payments } from '@shared/schema';
import type { InvoiceAccountingDisplayInput, InvoiceAccountingPaymentInput } from '@shared/invoiceAccountingDisplay';
import { deriveOrderPaymentSummary, type OrderPaymentSummary } from '@shared/orderPaymentSummary';
import type { db } from '../db';

type OrderInvoice = InvoiceAccountingDisplayInput & { id: string; orderId: string | null };

/** Batch payment evidence for already tenant-scoped Order Invoice rows. No writes. */
export async function loadOrderInvoicePaymentEvidence(
  connection: Pick<typeof db, 'select'>,
  organizationId: string,
  invoiceRows: readonly OrderInvoice[],
): Promise<OrderInvoice[]> {
  const byInvoice = new Map<string, InvoiceAccountingPaymentInput[]>();
  for (let offset = 0; offset < invoiceRows.length; offset += 500) {
    const ids = invoiceRows.slice(offset, offset + 500).map((invoice) => invoice.id);
    const rows = await connection.select({
      id: payments.id, invoiceId: payments.invoiceId, status: payments.status,
      amountCents: payments.amountCents, syncStatus: payments.syncStatus,
      externalAccountingId: payments.externalAccountingId, qbReconciledAt: payments.qbReconciledAt,
    }).from(payments).where(and(eq(payments.organizationId, organizationId), inArray(payments.invoiceId, ids)));
    for (const payment of rows) {
      const bucket = byInvoice.get(payment.invoiceId) ?? [];
      bucket.push(payment);
      byInvoice.set(payment.invoiceId, bucket);
    }
  }
  return invoiceRows.map((invoice) => ({ ...invoice, payments: byInvoice.get(invoice.id) ?? [] }));
}

export async function loadOrderPaymentSummaries(
  connection: Pick<typeof db, 'select'>,
  organizationId: string,
  invoiceRows: readonly OrderInvoice[],
): Promise<Map<string, OrderPaymentSummary>> {
  const evidence = await loadOrderInvoicePaymentEvidence(connection, organizationId, invoiceRows);
  const byOrder = new Map<string, InvoiceAccountingDisplayInput[]>();
  for (const invoice of evidence) {
    if (!invoice.orderId) continue;
    const bucket = byOrder.get(invoice.orderId) ?? [];
    bucket.push(invoice);
    byOrder.set(invoice.orderId, bucket);
  }
  const result = new Map<string, OrderPaymentSummary>();
  byOrder.forEach((invoices, orderId) => result.set(orderId, deriveOrderPaymentSummary(invoices)));
  return result;
}
