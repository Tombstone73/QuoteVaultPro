import { db } from './db';
import { invoices, invoiceEmailLogs, invoiceLineItems, payments, orders, orderLineItems, globalVariables } from '../shared/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { InsertInvoice, InsertInvoiceEmailLog, InsertInvoiceLineItem, InsertPayment } from '../shared/schema';
import { computeInvoicePaymentRollup } from '../shared/rollups/invoicePaymentRollup';

// Map payment terms to days offset
const TERM_OFFSETS: Record<string, number> = {
  due_on_receipt: 0,
  net_15: 15,
  net_30: 30,
  net_45: 45,
  custom: 0,
};

export type InvoiceEmailStatus = 'not_sent' | 'sent' | 'outdated';

export function deriveInvoiceEmailStatus(updatedAt: Date | string | null | undefined, lastSentAt: Date | string | null | undefined): InvoiceEmailStatus {
  if (!lastSentAt) {
    return 'not_sent';
  }

  const updatedAtMs = updatedAt ? new Date(updatedAt).getTime() : 0;
  const lastSentAtMs = new Date(lastSentAt).getTime();
  return updatedAtMs > lastSentAtMs ? 'outdated' : 'sent';
}

export async function createInvoiceEmailLog(input: InsertInvoiceEmailLog): Promise<void> {
  await db.insert(invoiceEmailLogs).values(input as any);
}

export async function getInvoiceEmailStatus(invoiceId: string): Promise<{ lastSentAt: Date | null; emailStatus: InvoiceEmailStatus }> {
  const [invoice] = await db
    .select({ updatedAt: invoices.updatedAt })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  const [latestSent] = await db
    .select({ lastSentAt: sql<Date>`MAX(${invoiceEmailLogs.sentAt})` })
    .from(invoiceEmailLogs)
    .where(and(eq(invoiceEmailLogs.invoiceId, invoiceId), eq(invoiceEmailLogs.status, 'sent')));

  const lastSentAt = latestSent?.lastSentAt ? new Date(latestSent.lastSentAt) : null;
  return {
    lastSentAt,
    emailStatus: deriveInvoiceEmailStatus(invoice.updatedAt, lastSentAt),
  };
}

export async function getInvoiceEmailStatuses(
  invoiceRows: Array<{ id: string; updatedAt: Date | string | null | undefined }>,
  organizationId?: string,
): Promise<Map<string, { lastSentAt: Date | null; emailStatus: InvoiceEmailStatus }>> {
  const result = new Map<string, { lastSentAt: Date | null; emailStatus: InvoiceEmailStatus }>();
  if (invoiceRows.length === 0) {
    return result;
  }

  const invoiceIds = invoiceRows.map((row) => row.id);
  const conditions: any[] = [
    inArray(invoiceEmailLogs.invoiceId, invoiceIds),
    eq(invoiceEmailLogs.status, 'sent'),
  ];
  if (organizationId) {
    conditions.push(eq(invoiceEmailLogs.organizationId, organizationId));
  }

  const latestSentRows = await db
    .select({
      invoiceId: invoiceEmailLogs.invoiceId,
      lastSentAt: sql<Date>`MAX(${invoiceEmailLogs.sentAt})`,
    })
    .from(invoiceEmailLogs)
    .where(and(...conditions))
    .groupBy(invoiceEmailLogs.invoiceId);

  const lastSentByInvoiceId = new Map(
    latestSentRows.map((row) => [row.invoiceId, row.lastSentAt ? new Date(row.lastSentAt) : null]),
  );

  for (const row of invoiceRows) {
    const lastSentAt = lastSentByInvoiceId.get(row.id) ?? null;
    result.set(row.id, {
      lastSentAt,
      emailStatus: deriveInvoiceEmailStatus(row.updatedAt, lastSentAt),
    });
  }

  return result;
}

export async function generateNextInvoiceNumber(organizationId: string, tx?: any): Promise<number> {
  const dbConn = tx || db;
  let varRow = await dbConn
    .select()
    .from(globalVariables)
    .where(and(eq(globalVariables.name, 'next_invoice_number'), eq(globalVariables.organizationId, organizationId)))
    .limit(1)
    .then((rows: any[]) => rows[0]);

  if (!varRow) {
    console.log(`[NUMBERING] Auto-initialized invoice numbering for org ${organizationId} with default sequence.`);
    const [newVar] = await dbConn
      .insert(globalVariables)
      .values({
        name: 'next_invoice_number',
        value: '1000',
        description: 'Next invoice number sequence (auto-initialized)',
        category: 'numbering',
        isActive: true,
        organizationId,
      })
      .returning();
    varRow = newVar;
  }

  const current = Math.floor(Number(varRow.value));
  await dbConn.update(globalVariables).set({ value: (current + 1).toString(), updatedAt: new Date() }).where(and(eq(globalVariables.id, varRow.id), eq(globalVariables.organizationId, organizationId)));
  return current;
}

export async function getMaxInvoiceNumber(organizationId: string): Promise<number | null> {
  const result = await db
    .select({ maxNumber: sql<number>`MAX(${invoices.invoiceNumber})` })
    .from(invoices)
    .where(eq(invoices.organizationId, organizationId));
  const val = result[0]?.maxNumber;
  return val != null ? Number(val) : null;
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

function normalizePaymentStatus(raw: unknown): string {
  if (!raw) return 'succeeded';
  return String(raw).trim().toLowerCase();
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

    const invoiceNumber = await generateNextInvoiceNumber(organizationId, tx);
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

    const sourceOrderNumber = order.orderNumber ? parseInt(order.orderNumber, 10) || null : null;
    const invoiceInsert: InsertInvoice = {
      organizationId,
      invoiceNumber,
      orderId: order.id,
      sourceOrderNumber: sourceOrderNumber as any, // Immutable snapshot — survives order deletion
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
        optionSelectionsJson: (li as any).optionSelectionsJson ?? null,
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
  const paymentRows = await db
    .select()
    .from(payments)
    .where(and(eq(payments.invoiceId, id), eq(payments.organizationId, (invoice as any).organizationId)));
  const emailTracking = await getInvoiceEmailStatus(id);
  return { invoice: { ...invoice, ...emailTracking }, lineItems, payments: paymentRows };
}

export async function applyPayment(invoiceId: string, userId: string, data: { amount: number; method: string; notes?: string }) {
  return db.transaction(async (tx) => {
    const rel = await getInvoiceWithRelations(invoiceId);
    if (!rel) throw new Error('Invoice not found');
    const { invoice } = rel;
    const existingStatus = String(invoice.status || '').toLowerCase();
    if (existingStatus === 'void') throw new Error('Cannot record payment on a void invoice');

    const amountPaidAlready = Number(invoice.amountPaid);
    const balanceDueNow = Number(invoice.balanceDue ?? (Number(invoice.total) - amountPaidAlready));
    if (data.amount > balanceDueNow) throw new Error('Overpayment not allowed');

    const paymentInsert: InsertPayment = {
      invoiceId,
      // orgId enforced on all payment rows
      organizationId: (invoice as any).organizationId,
      provider: 'manual' as any,
      status: 'succeeded' as any,
      currency: (invoice as any).currency || 'USD',
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
    const paymentRows = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.invoiceId, invoiceId), eq(payments.organizationId, (invoice as any).organizationId)));
    const rollup = computeInvoicePaymentRollup({
      invoiceTotalCents: Number((invoice as any).totalCents || 0),
      payments: paymentRows.map((p: any) => ({ id: p.id, status: normalizePaymentStatus(p.status), amountCents: Number(p.amountCents || 0) })),
    });

    const amountPaid = centsToDecimalString(rollup.amountPaidCents);
    const balanceDue = centsToDecimalString(rollup.amountDueCents);
    let newStatus = invoice.status;
    if (rollup.amountDueCents <= 0) newStatus = 'paid' as any;
    else {
      // Keep billed status if already billed; otherwise leave as-is (legacy statuses supported)
      if (String(invoice.status || '').toLowerCase() === 'billed') newStatus = 'billed' as any;
      else if (rollup.amountPaidCents > 0) newStatus = 'partially_paid' as any;
    }

    await tx.update(invoices).set({
      amountPaid,
      balanceDue,
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
  const rollup = computeInvoicePaymentRollup({
    invoiceTotalCents: Number((invoice as any).totalCents || 0),
    payments: paymentRows.map((p: any) => ({ id: p.id, status: normalizePaymentStatus(p.status), amountCents: Number(p.amountCents || 0) })),
  });

  const amountPaid = centsToDecimalString(rollup.amountPaidCents);
  const balanceDue = centsToDecimalString(rollup.amountDueCents);

  let status = invoice.status;
  if (rollup.amountDueCents <= 0) status = 'paid';
  else if (rollup.amountPaidCents > 0) status = 'partially_paid';
  if (status !== 'paid' && invoice.dueDate && new Date(invoice.dueDate) < new Date()) {
    status = 'overdue';
  }
  const [updated] = await db.update(invoices).set({ amountPaid, balanceDue, status, updatedAt: new Date() }).where(eq(invoices.id, id)).returning();
  return updated;
}

// Placeholder QuickBooks sync queueing
export async function queueInvoiceForSync(id: string) {
  await db.update(invoices).set({ syncStatus: 'pending', updatedAt: new Date() }).where(eq(invoices.id, id));
}
export async function queuePaymentForSync(id: string) {
  await db.update(payments).set({ syncStatus: 'pending', updatedAt: new Date() }).where(eq(payments.id, id));
}
