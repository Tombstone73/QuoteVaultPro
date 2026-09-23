import { and, eq, sql } from "drizzle-orm";
import { customerContacts, customers, invoices, orders } from "../../shared/schema";
import { resolveCanonicalInvoiceCustomerOwnership } from "../../shared/invoiceCustomerOwnership";
import { resolveInvoiceBillingParty } from "../../shared/invoiceBillingParty";
import { db } from "../db";

/**
 * The customer shown to an operator is live order context for native invoices.
 * Imported QuickBooks invoices intentionally retain their imported customer
 * identity, and standalone invoices have no order context to resolve.
 */
export const canonicalInvoiceCustomerId = sql<string | null>`case
  when ${orders.id} is not null
    and ${orders.customerId} is not null
    and ${invoices.contactId} is null
    and lower(coalesce(${invoices.importSource}, '')) <> 'quickbooks'
  then ${orders.customerId}
  else ${invoices.customerId}
end`;

export type CanonicalInvoiceCustomerContext = {
  invoice: any;
  customer: any | null;
  contact: any | null;
  billingParty: ReturnType<typeof resolveInvoiceBillingParty>;
  resolvedCustomerId: string | null;
  storedCustomerId: string | null;
  resolvedContactId: string | null;
  source: "order" | "invoice" | "contact";
};

/**
 * Resolves the one customer identity used by invoice-facing reads.  This is a
 * read projection only: it never copies an Order customer back into invoices.
 */
export async function getCanonicalInvoiceCustomerContext(input: {
  organizationId: string;
  invoiceId: string;
}): Promise<CanonicalInvoiceCustomerContext | null> {
  const [row] = await db
    .select({
      invoice: invoices,
      orderId: orders.id,
      orderCustomerId: orders.customerId,
      orderContactId: orders.contactId,
      customer: customers,
      contact: customerContacts,
    })
    .from(invoices)
    .leftJoin(orders, and(
      eq(orders.id, invoices.orderId),
      eq(orders.organizationId, input.organizationId),
    ))
    .leftJoin(customers, and(
      eq(customers.id, canonicalInvoiceCustomerId),
      eq(customers.organizationId, input.organizationId),
    ))
    .leftJoin(customerContacts, and(
      eq(customerContacts.id, invoices.contactId),
      eq(customerContacts.organizationId, input.organizationId),
    ))
    .where(and(
      eq(invoices.id, input.invoiceId),
      eq(invoices.organizationId, input.organizationId),
    ))
    .limit(1);

  if (!row) return null;
  const ownership = resolveCanonicalInvoiceCustomerOwnership({
    invoiceCustomerId: row.invoice.customerId,
    invoiceContactId: row.invoice.contactId,
    invoiceImportSource: row.invoice.importSource,
    linkedOrderId: row.orderId,
    linkedOrderCustomerId: row.orderCustomerId,
    linkedOrderContactId: row.orderContactId,
  });

  return {
    invoice: { ...row.invoice, customerId: ownership.customerId },
    customer: row.customer ?? null,
    contact: row.contact ?? null,
    billingParty: resolveInvoiceBillingParty({ customer: row.customer, contact: row.contact }),
    resolvedCustomerId: ownership.customerId,
    storedCustomerId: row.invoice.customerId,
    resolvedContactId: ownership.contactId,
    source: ownership.source,
  };
}
