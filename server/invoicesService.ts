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

function calculateDueDate(issueDate: Date, terms: string, customProvided?: Date | null): Date | null {
  if (terms === 'custom') return customProvided || null;
  const offset = TERM_OFFSETS[terms] ?? 0;
  const d = new Date(issueDate.getTime());
  d.setDate(d.getDate() + offset);
  return d;
}

export async function createInvoiceFromOrder(orderId: string, userId: string, opts: { terms: string; customDueDate?: Date | null } ) {
  return db.transaction(async (tx) => {
    // Fetch order & its line items
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
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
    // TODO: Add tax calculation from order if needed; use order.tax for now
    const tax = Number(order.tax || '0');
    const total = subtotal + tax;

    const invoiceInsert: InsertInvoice = {
      invoiceNumber,
      orderId: order.id,
      customerId: order.customerId,
      status: 'draft',
      terms: opts.terms as any,
      customTerms: undefined,
      issueDate,
      dueDate: dueDate || undefined,
      subtotal,
      tax,
      total,
      notesPublic: undefined,
      notesInternal: undefined,
      createdByUserId: userId,
      syncStatus: 'pending',
    } as any; // cast due to extended schema types differences

    const [invoice] = await tx.insert(invoices).values(invoiceInsert as any).returning();

    // Snapshot line items
    if (lineItems.length) {
      const snapshotRows: InsertInvoiceLineItem[] = lineItems.map(li => ({
        invoiceId: invoice.id,
        orderLineItemId: li.id,
        productId: li.productId,
        productVariantId: li.productVariantId,
        productType: li.productType,
        description: li.description,
        width: li.width ? Number(li.width) : null,
        height: li.height ? Number(li.height) : null,
        quantity: li.quantity,
        sqft: li.sqft ? Number(li.sqft) : null,
        unitPrice: Number(li.unitPrice),
        totalPrice: Number(li.totalPrice),
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
    const amountPaidAlready = Number(invoice.amountPaid);
    const balance = Number(invoice.balanceDue || invoice.total) - amountPaidAlready;
    if (data.amount > balance) throw new Error('Overpayment not allowed');

    const paymentInsert: InsertPayment = {
      invoiceId,
      amount: data.amount,
      method: data.method as any,
      notes: data.notes,
      createdByUserId: userId,
      syncStatus: 'pending',
    } as any;
    const [payment] = await tx.insert(payments).values(paymentInsert as any).returning();

    // Recalculate totals
    const paymentRows = await tx.select().from(payments).where(eq(payments.invoiceId, invoiceId));
    const totalPaid = paymentRows.reduce((s, p) => s + Number(p.amount), 0);
    const balanceDue = Number(invoice.total) - totalPaid;
    let newStatus = invoice.status;
    if (balanceDue <= 0) newStatus = 'paid';
    else if (totalPaid > 0) newStatus = 'partially_paid';
    // Overdue check
    if (newStatus !== 'paid' && invoice.dueDate && new Date(invoice.dueDate) < new Date()) {
      newStatus = 'overdue';
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
