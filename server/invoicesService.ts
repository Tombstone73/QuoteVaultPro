import { db } from './db';
import { invoices, invoiceLineItems, payments, orders, orderLineItems, globalVariables } from '../shared/schema';
import { eq, and, sql } from 'drizzle-orm';
import { InsertInvoice, InsertInvoiceLineItem, InsertPayment } from '../shared/schema';

// Map payment terms to days offset
const TERM_OFFSETS: Record<string, number> = {
  due_on_receipt: 0,
  net_15: 15,
  net_30: 30,
  net_45: 45,
  custom: 0,
};

export async function generateNextInvoiceNumber(tx?: any): Promise<number> {
  const dbConn = tx || db;
  const result = await dbConn.execute(sql`SELECT * FROM ${globalVariables} WHERE ${globalVariables.name} = 'next_invoice_number' FOR UPDATE`);
  const varRow: any = result.rows[0];
  if (!varRow) throw new Error('Invoice numbering system not initialized');
  const current = Math.floor(Number(varRow.value));
  await dbConn.update(globalVariables).set({ value: (current + 1).toString(), updatedAt: new Date() }).where(eq(globalVariables.id, varRow.id));
  return current;
}

function toCents(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 100));
}

function centsToDecimalString(cents: number): string {
  const safe = Number.isFinite(cents) ? cents : 0;
  return (safe / 100).toFixed(2);
}

function calculateDueDate(issueDate: Date, terms: string, customProvided?: Date | null): Date | null {
  if (terms === 'custom') return customProvided || null;
  const offset = TERM_OFFSETS[terms] ?? 0;
  const d = new Date(issueDate.getTime());
  d.setDate(d.getDate() + offset);
  return d;
}

async function createInvoiceFromOrderImpl(
  organizationId: string,
  orderId: string,
  userId: string,
  opts: { terms: string; customDueDate?: Date | null }
) {
  return db.transaction(async (tx) => {
    // Fetch order & its line items
    const [order] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)));
    if (!order) throw new Error('Order not found');
    const lineItems = await tx.select().from(orderLineItems).where(eq(orderLineItems.orderId, orderId));

    // Prevent duplicate invoice unless multi allowed (basic check: one existing invoice per order in draft/sent)
    const existing = await tx.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.orderId, orderId)));
    if (existing.length > 0) {
      // For now disallow another invoice; future: allow multiple with a flag
      throw new Error('Invoice already exists for this order');
    }

    const invoiceNumber = await generateNextInvoiceNumber(tx);
    const issueDate = new Date();
    const dueDate = calculateDueDate(issueDate, opts.terms, opts.customDueDate || null);

    const subtotal = lineItems.reduce((s, li) => s + Number(li.totalPrice), 0);
    const tax = Number(order.tax || '0');
    const shippingCents = Number((order as any).shippingCents ?? 0) || 0;
    const shipping = shippingCents / 100;
    const total = subtotal + tax + shipping;

    const subtotalCents = toCents(subtotal);
    const taxCents = toCents(tax);
    const totalCents = Math.max(0, subtotalCents + taxCents + shippingCents);

    const invoiceInsert: InsertInvoice = {
      organizationId,
      invoiceNumber,
      orderId: order.id,
      customerId: order.customerId,
      status: 'draft',
      terms: opts.terms as any,
      customTerms: undefined,
      issueDate,
      issuedAt: undefined,
      dueDate: dueDate || undefined,
      subtotal: subtotal.toFixed(2) as any,
      tax: tax.toFixed(2) as any,
      total: total.toFixed(2) as any,
      subtotalCents,
      taxCents,
      shippingCents,
      totalCents,
      currency: ((order as any)?.currency as any) || 'USD',
      notesPublic: undefined,
      notesInternal: undefined,
      createdByUserId: userId,
      syncStatus: 'pending',
      qbSyncStatus: 'pending' as any,
      modifiedAfterBilling: false as any,
    } as any; // cast due to extended schema types differences

    const [invoice] = await tx.insert(invoices).values(invoiceInsert as any).returning();

    // Snapshot line items
    if (lineItems.length) {
      const snapshotRows: InsertInvoiceLineItem[] = lineItems.map((li, idx) => ({
        invoiceId: invoice.id,
        orderLineItemId: li.id,
        productId: li.productId,
        productVariantId: li.productVariantId,
        productType: li.productType,
        name: (li as any).name ?? null,
        sku: (li as any).sku ?? null,
        description: li.description,
        width: li.width ? Number(li.width) : null,
        height: li.height ? Number(li.height) : null,
        quantity: li.quantity,
        sqft: li.sqft ? Number(li.sqft) : null,
        unitPrice: Number(li.unitPrice),
        totalPrice: Number(li.totalPrice),
        unitPriceCents: toCents(li.unitPrice),
        lineTotalCents: toCents(li.totalPrice),
        sortOrder: typeof (li as any).sortOrder === 'number' ? (li as any).sortOrder : idx,
        specsJson: li.specsJson as any,
        selectedOptions: li.selectedOptions as any,
      } as any));
      if (snapshotRows.length) {
        await tx.insert(invoiceLineItems).values(snapshotRows as any);
      }
    }

    return invoice;
  });
}

export async function createInvoiceFromOrder(
  orderId: string,
  userId: string,
  opts: { terms: string; customDueDate?: Date | null }
): Promise<any>;
export async function createInvoiceFromOrder(
  organizationId: string,
  orderId: string,
  userId: string,
  opts: { terms: string; customDueDate?: Date | null }
): Promise<any>;
export async function createInvoiceFromOrder(
  a: string,
  b: string,
  c: string | { terms: string; customDueDate?: Date | null },
  d?: { terms: string; customDueDate?: Date | null }
): Promise<any> {
  // Back-compat for legacy call sites: createInvoiceFromOrder(orderId, userId, opts)
  if (d === undefined) {
    const orderId = a;
    const userId = b;
    const opts = c as { terms: string; customDueDate?: Date | null };

    const [order] = await db.select({ organizationId: orders.organizationId }).from(orders).where(eq(orders.id, orderId));
    if (!order) throw new Error('Order not found');
    return createInvoiceFromOrderImpl(order.organizationId, orderId, userId, opts);
  }

  const organizationId = a;
  const orderId = b;
  const userId = c as string;
  const opts = d;
  return createInvoiceFromOrderImpl(organizationId, orderId, userId, opts);
}

export async function getInvoiceWithRelations(id: string) {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (!invoice) return null;
  const lineItems = await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, id));
  const paymentRows = await db.select().from(payments).where(eq(payments.invoiceId, id));
  return { invoice, lineItems, payments: paymentRows };
}

export async function applyPayment(invoiceId: string, userId: string, data: { amount: number; method: string; notes?: string }) {
  return db.transaction(async (tx) => {
    const rel = await getInvoiceWithRelations(invoiceId);
    if (!rel) throw new Error('Invoice not found');
    const { invoice } = rel;
    const existingStatus = String(invoice.status || '').toLowerCase();
    if (existingStatus === 'void') throw new Error('Cannot record payment on a void invoice');

    const amountPaidAlready = Number(invoice.amountPaid);
    const balance = Number(invoice.balanceDue || invoice.total) - amountPaidAlready;
    if (data.amount > balance) throw new Error('Overpayment not allowed');

    const paymentInsert: InsertPayment = {
      invoiceId,
      amount: data.amount,
      amountCents: toCents(data.amount),
      method: data.method as any,
      notes: data.notes,
      note: data.notes,
      paidAt: new Date() as any,
      createdByUserId: userId,
      syncStatus: 'pending',
    } as any;
    const [payment] = await tx.insert(payments).values(paymentInsert as any).returning();

    // Recalculate totals
    const paymentRows = await tx.select().from(payments).where(eq(payments.invoiceId, invoiceId));
    const totalPaid = paymentRows.reduce((s, p) => s + Number(p.amount), 0);
    const balanceDue = Number(invoice.total) - totalPaid;
    let newStatus = invoice.status;
    if (balanceDue <= 0) newStatus = 'paid' as any;
    else {
      // Keep billed status if already billed; otherwise leave as-is (legacy statuses supported)
      if (String(invoice.status || '').toLowerCase() === 'billed') newStatus = 'billed' as any;
    }

    await tx.update(invoices).set({
      amountPaid: totalPaid.toString(),
      balanceDue: balanceDue.toString(),
      status: newStatus,
      updatedAt: new Date(),
    }).where(eq(invoices.id, invoiceId));

    return payment;
  });
}

export async function markInvoiceSent(id: string) {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (!inv) throw new Error('Invoice not found');
  if (inv.status !== 'draft') return inv; // only transition from draft
  const [updated] = await db.update(invoices).set({ status: 'sent', updatedAt: new Date() }).where(eq(invoices.id, id)).returning();
  return updated;
}

export async function refreshInvoiceStatus(id: string) {
  const rel = await getInvoiceWithRelations(id);
  if (!rel) return null;
  const { invoice, payments: paymentRows } = rel;
  const totalPaid = paymentRows.reduce((s, p) => s + Number(p.amount), 0);
  const balanceDue = Number(invoice.total) - totalPaid;
  let status = invoice.status;
  if (balanceDue <= 0) status = 'paid';
  else if (totalPaid > 0) status = 'partially_paid';
  if (status !== 'paid' && invoice.dueDate && new Date(invoice.dueDate) < new Date()) {
    status = 'overdue';
  }
  const [updated] = await db.update(invoices).set({ amountPaid: totalPaid.toString(), balanceDue: balanceDue.toString(), status, updatedAt: new Date() }).where(eq(invoices.id, id)).returning();
  return updated;
}

// Placeholder QuickBooks sync queueing
export async function queueInvoiceForSync(id: string) {
  await db.update(invoices).set({ syncStatus: 'pending', updatedAt: new Date() }).where(eq(invoices.id, id));
}
export async function queuePaymentForSync(id: string) {
  await db.update(payments).set({ syncStatus: 'pending', updatedAt: new Date() }).where(eq(payments.id, id));
}
