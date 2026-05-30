import { db } from './db';
import { customerContacts, customers, invoices, invoiceEmailLogs, invoiceLineItems, payments, orders, orderLineItems } from '../shared/schema';
import { asc, desc, eq, and, ilike, inArray, or, sql } from 'drizzle-orm';
import { InsertInvoice, InsertInvoiceEmailLog, InsertInvoiceLineItem, InsertPayment, type Invoice } from '../shared/schema';
import { computeInvoicePaymentRollup } from '../shared/rollups/invoicePaymentRollup';
import { normalizeInvoiceAccountingDisplay } from '../shared/invoiceAccountingDisplay';
import {
  allocateDocumentNumber,
  isDocumentNumberUniqueViolation,
  toDocumentNumberConflictError,
} from './services/documentNumberingService';
import { resolveOrderLineItemInvoicePricing } from './lib/downstreamEffectivePricing';
import type { BillingInvoiceMilestone, InvoiceCreationSource } from '../shared/billingInvoicePolicy';

// Map payment terms to days offset
const TERM_OFFSETS: Record<string, number> = {
  due_on_receipt: 0,
  net_15: 15,
  net_30: 30,
  net_45: 45,
  custom: 0,
};

// 'sent_current'  = invoice was emailed and has not changed since
// 'sent_outdated' = invoice was emailed but has been edited/updated since last send
// 'not_sent'      = invoice has never been emailed as an original invoice send
//
// NOTE: reminder sends must NOT count toward this status — only type='invoice_send'
// rows in invoice_email_logs should be queried here.
export type InvoiceEmailStatus = 'not_sent' | 'sent_current' | 'sent_outdated';

export function deriveInvoiceEmailStatus(updatedAt: Date | string | null | undefined, lastSentAt: Date | string | null | undefined): InvoiceEmailStatus {
  if (!lastSentAt) {
    return 'not_sent';
  }

  const updatedAtMs = updatedAt ? new Date(updatedAt).getTime() : 0;
  const lastSentAtMs = new Date(lastSentAt).getTime();
  return updatedAtMs > lastSentAtMs ? 'sent_outdated' : 'sent_current';
}

export async function createInvoiceEmailLog(input: InsertInvoiceEmailLog): Promise<void> {
  await db.insert(invoiceEmailLogs).values(input as any);
}

export async function getInvoiceEmailStatus(invoiceId: string): Promise<{
  lastSentAt: Date | null;
  lastInvoiceEmailRecipient: string | null;
  emailStatus: InvoiceEmailStatus;
}> {
  const [invoice] = await db
    .select({ updatedAt: invoices.updatedAt })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  // Only count type='invoice_send' rows — reminder sends must not affect emailStatus.
  const [latestSent] = await db
    .select({
      lastSentAt: sql<Date>`MAX(${invoiceEmailLogs.sentAt})`,
    })
    .from(invoiceEmailLogs)
    .where(and(
      eq(invoiceEmailLogs.invoiceId, invoiceId),
      eq(invoiceEmailLogs.status, 'sent'),
      eq(invoiceEmailLogs.type, 'invoice_send'),
    ));

  const lastSentAt = latestSent?.lastSentAt ? new Date(latestSent.lastSentAt) : null;

  // Fetch recipient of the most recent successful invoice send
  let lastInvoiceEmailRecipient: string | null = null;
  if (lastSentAt) {
    const [recipientRow] = await db
      .select({ recipientEmail: invoiceEmailLogs.recipientEmail })
      .from(invoiceEmailLogs)
      .where(and(
        eq(invoiceEmailLogs.invoiceId, invoiceId),
        eq(invoiceEmailLogs.status, 'sent'),
        eq(invoiceEmailLogs.type, 'invoice_send'),
        sql`${invoiceEmailLogs.sentAt} = ${latestSent!.lastSentAt}`,
      ))
      .limit(1);
    lastInvoiceEmailRecipient = recipientRow?.recipientEmail ?? null;
  }

  return {
    lastSentAt,
    lastInvoiceEmailRecipient,
    emailStatus: deriveInvoiceEmailStatus(invoice.updatedAt, lastSentAt),
  };
}

export async function getInvoiceEmailStatuses(
  invoiceRows: Array<{ id: string; updatedAt: Date | string | null | undefined }>,
  organizationId?: string,
): Promise<Map<string, { lastSentAt: Date | null; lastInvoiceEmailRecipient: string | null; emailStatus: InvoiceEmailStatus }>> {
  const result = new Map<string, { lastSentAt: Date | null; lastInvoiceEmailRecipient: string | null; emailStatus: InvoiceEmailStatus }>();
  if (invoiceRows.length === 0) {
    return result;
  }

  const invoiceIds = invoiceRows.map((row) => row.id);
  const conditions: any[] = [
    inArray(invoiceEmailLogs.invoiceId, invoiceIds),
    eq(invoiceEmailLogs.status, 'sent'),
    // Only count original invoice sends — reminder sends must not affect emailStatus.
    eq(invoiceEmailLogs.type, 'invoice_send'),
  ];
  if (organizationId) {
    conditions.push(eq(invoiceEmailLogs.organizationId, organizationId));
  }

  // Get the max sentAt per invoice (one row per invoice)
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

  // Fetch the recipient for each invoice's most recent send in one query using DISTINCT ON
  const recipientRows = await db
    .select({
      invoiceId: invoiceEmailLogs.invoiceId,
      recipientEmail: invoiceEmailLogs.recipientEmail,
      sentAt: invoiceEmailLogs.sentAt,
    })
    .from(invoiceEmailLogs)
    .where(and(...conditions))
    .orderBy(sql`${invoiceEmailLogs.invoiceId}, ${invoiceEmailLogs.sentAt} DESC`);

  // Keep only the latest row per invoice (first encountered after sort by sentAt DESC)
  const recipientByInvoiceId = new Map<string, string>();
  for (const row of recipientRows) {
    if (!recipientByInvoiceId.has(row.invoiceId)) {
      recipientByInvoiceId.set(row.invoiceId, row.recipientEmail);
    }
  }

  for (const row of invoiceRows) {
    const lastSentAt = lastSentByInvoiceId.get(row.id) ?? null;
    const lastInvoiceEmailRecipient = recipientByInvoiceId.get(row.id) ?? null;
    result.set(row.id, {
      lastSentAt,
      lastInvoiceEmailRecipient,
      emailStatus: deriveInvoiceEmailStatus(row.updatedAt, lastSentAt),
    });
  }

  return result;
}

export type InvoiceListSortBy =
  | 'invoiceNumber'
  | 'customer'
  | 'contact'
  | 'orderNumber'
  | 'poNumber'
  | 'issueDate'
  | 'dueDate'
  | 'status'
  | 'total'
  | 'balance';

export type InvoiceListSortDir = 'asc' | 'desc';

export interface ListInvoicesForOrganizationOptions {
  organizationId: string;
  status?: string;
  customerId?: string;
  orderId?: string;
  search?: string;
  sortBy?: string;
  sortDir?: string;
  limit?: number;
  offset?: number;
}

export type EnrichedInvoiceListItem = Invoice & {
  customerName: string | null;
  companyName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  orderNumber: string | null;
  orderName: string | null;
  jobName: string | null;
  purchaseOrderNumber: string | null;
};

function normalizeInvoiceListSortBy(sortBy: unknown): InvoiceListSortBy {
  const raw = String(sortBy || '').trim();
  switch (raw) {
    case 'invoiceNumber':
    case 'customer':
    case 'contact':
    case 'orderNumber':
    case 'poNumber':
    case 'issueDate':
    case 'dueDate':
    case 'status':
    case 'total':
    case 'balance':
      return raw;
    default:
      return 'issueDate';
  }
}

function normalizeInvoiceListSortDir(sortDir: unknown): InvoiceListSortDir {
  return String(sortDir || '').trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
}

function invoiceListSortExpression(sortBy: InvoiceListSortBy) {
  switch (sortBy) {
    case 'invoiceNumber':
      return sql`coalesce(${invoices.displayNumber}, ${invoices.numberCore}::text, ${invoices.invoiceNumber}::text)`;
    case 'customer':
      return sql`lower(coalesce(${customers.companyName}, ''))`;
    case 'contact':
      return sql`lower(trim(coalesce(${customerContacts.firstName}, '') || ' ' || coalesce(${customerContacts.lastName}, '')))`;
    case 'orderNumber':
      return sql`coalesce(${orders.displayNumber}, ${orders.orderNumber}, ${invoices.sourceOrderNumber}::text, '')`;
    case 'poNumber':
      return sql`lower(coalesce(${orders.poNumber}, ${invoices.customerPoNumber}, ''))`;
    case 'dueDate':
      return invoices.dueDate;
    case 'status':
      return sql`lower(coalesce(${invoices.status}, ''))`;
    case 'total':
      return invoices.totalCents;
    case 'balance':
      return sql`case
        when lower(coalesce(${invoices.importSource}, '')) = 'quickbooks'
          then coalesce(${invoices.balanceDue}, '0')::numeric * 100
        else greatest(coalesce(${invoices.totalCents}, 0) - round(coalesce(${invoices.amountPaid}, '0')::numeric * 100), 0)
      end`;
    case 'issueDate':
    default:
      return invoices.issueDate;
  }
}

export async function listInvoicesForOrganization(
  opts: ListInvoicesForOrganizationOptions,
): Promise<EnrichedInvoiceListItem[]> {
  const limit = Math.min(Math.max(Number(opts.limit || 50), 1), 200);
  const offset = Math.max(Number(opts.offset || 0), 0);
  const sortBy = normalizeInvoiceListSortBy(opts.sortBy);
  const sortDir = normalizeInvoiceListSortDir(opts.sortDir);

  const whereClauses: any[] = [eq(invoices.organizationId, opts.organizationId)];
  if (opts.status) whereClauses.push(eq(invoices.status, opts.status));
  if (opts.customerId) whereClauses.push(eq(invoices.customerId, opts.customerId));
  if (opts.orderId) whereClauses.push(eq(invoices.orderId, opts.orderId));

  const search = String(opts.search || '').trim();
  if (search) {
    const pattern = `%${search}%`;
    whereClauses.push(or(
      ilike(invoices.displayNumber, pattern),
      sql`${invoices.numberCore}::text ILIKE ${pattern}`,
      sql`${invoices.invoiceNumber}::text ILIKE ${pattern}`,
      ilike(invoices.qbDocNumber, pattern),
      ilike(customers.companyName, pattern),
      ilike(customers.email, pattern),
      ilike(customerContacts.firstName, pattern),
      ilike(customerContacts.lastName, pattern),
      ilike(customerContacts.email, pattern),
      sql`trim(coalesce(${customerContacts.firstName}, '') || ' ' || coalesce(${customerContacts.lastName}, '')) ILIKE ${pattern}`,
      ilike(orders.displayNumber, pattern),
      ilike(orders.orderNumber, pattern),
      sql`${invoices.sourceOrderNumber}::text ILIKE ${pattern}`,
      ilike(orders.poNumber, pattern),
      ilike(invoices.customerPoNumber, pattern),
      ilike(orders.label, pattern),
    ));
  }

  const sortExpression = invoiceListSortExpression(sortBy);
  const sortDirection = sortDir === 'asc' ? asc : desc;

  const rows = await db
    .select({
      invoice: invoices,
      customerName: customers.companyName,
      companyName: customers.companyName,
      contactName: sql<string | null>`nullif(trim(coalesce(${customerContacts.firstName}, '') || ' ' || coalesce(${customerContacts.lastName}, '')), '')`,
      contactEmail: customerContacts.email,
      orderNumber: sql<string | null>`coalesce(${orders.displayNumber}, ${orders.orderNumber}, ${invoices.sourceOrderNumber}::text)`,
      orderName: orders.label,
      jobName: orders.label,
      purchaseOrderNumber: sql<string | null>`coalesce(${orders.poNumber}, ${invoices.customerPoNumber})`,
    })
    .from(invoices)
    .leftJoin(customers, and(
      eq(customers.id, invoices.customerId),
      eq(customers.organizationId, opts.organizationId),
    ))
    .leftJoin(orders, and(
      eq(orders.id, invoices.orderId),
      eq(orders.organizationId, opts.organizationId),
    ))
    .leftJoin(customerContacts, and(
      eq(customerContacts.id, orders.contactId),
      eq(customerContacts.customerId, customers.id),
    ))
    .where(and(...whereClauses))
    .orderBy(sortDirection(sortExpression), desc(invoices.issueDate), desc(invoices.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => ({
    ...row.invoice,
    customerName: row.customerName ?? null,
    companyName: row.companyName ?? null,
    contactName: row.contactName ?? null,
    contactEmail: row.contactEmail ?? null,
    orderNumber: row.orderNumber ?? null,
    orderName: row.orderName ?? null,
    jobName: row.jobName ?? null,
    purchaseOrderNumber: row.purchaseOrderNumber ?? null,
  }));
}

export async function generateNextInvoiceNumber(organizationId: string, tx?: any): Promise<number> {
  const dbConn = tx || db;
  const { numberCore } = await allocateDocumentNumber(organizationId, "invoice", dbConn);
  return numberCore;
}

export async function getMaxInvoiceNumber(organizationId: string): Promise<number | null> {
  const result = await db
    .select({ maxNumber: sql<number>`MAX(COALESCE(${invoices.numberCore}, ${invoices.invoiceNumber}))` })
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

function getNetInternalPaymentCents(paymentRows: Array<{ id?: string | null; status?: unknown; amountCents?: unknown }>): number {
  let paid = 0;
  const seen = new Set<string>();

  for (const payment of paymentRows || []) {
    const rawId = payment?.id == null ? null : String(payment.id).trim();
    if (rawId) {
      if (seen.has(rawId)) continue;
      seen.add(rawId);
    }

    const status = normalizePaymentStatus(payment?.status);
    const amountCents = Math.max(0, Math.round(Number(payment?.amountCents || 0)));

    if (status === 'succeeded') {
      paid += amountCents;
    } else if (status === 'refunded') {
      paid -= amountCents;
    }
  }

  return Math.max(0, paid);
}

function computeInvoiceFinancialState(
  invoice: Record<string, any>,
  paymentRows: Array<Record<string, any>>,
): { amountPaidCents: number; amountDueCents: number; status: string } {
  const totalCents = Math.max(0, Math.round(Number(invoice.totalCents || 0)));
  const isImportedFromQuickBooks = String(invoice.importSource || '').trim().toLowerCase() === 'quickbooks';

  if (isImportedFromQuickBooks) {
    const normalizedDisplay = normalizeInvoiceAccountingDisplay({
      ...invoice,
      payments: paymentRows.map((payment: any) => ({
        id: payment.id,
        status: payment.status,
        amountCents: Number(payment.amountCents || 0),
        syncStatus: payment.syncStatus,
        externalAccountingId: payment.externalAccountingId,
        qbReconciledAt: payment.qbReconciledAt,
      })),
    });
    const amountPaidCents = normalizedDisplay.displayPaidCents;
    const amountDueCents = normalizedDisplay.displayRemainingCents;

    let status = String(invoice.status || 'billed').trim().toLowerCase();
    if (amountDueCents <= 0) status = 'paid';
    else if (amountPaidCents > 0) status = 'partially_paid';
    else status = 'billed';

    return { amountPaidCents, amountDueCents, status };
  }

  const rollup = computeInvoicePaymentRollup({
    invoiceTotalCents: totalCents,
    payments: paymentRows.map((payment: any) => ({
      id: payment.id,
      status: normalizePaymentStatus(payment.status),
      amountCents: Number(payment.amountCents || 0),
    })),
  });

  let status = String(invoice.status || '').trim().toLowerCase();
  if (rollup.amountDueCents <= 0) status = 'paid';
  else if (rollup.amountPaidCents > 0) status = 'partially_paid';
  else if (status === 'billed' || status === 'finalized' || status === 'sent') status = status;

  return {
    amountPaidCents: rollup.amountPaidCents,
    amountDueCents: rollup.amountDueCents,
    status,
  };
}

function calculateDueDate(issueDate: Date, terms: string, customProvided?: Date | null): Date | null {
  if (terms === 'custom') return customProvided || null;
  const offset = TERM_OFFSETS[terms] ?? 0;
  const d = new Date(issueDate.getTime());
  d.setDate(d.getDate() + offset);
  return d;
}

async function lockInvoiceOrderCreation(tx: any, organizationId: string, orderId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${organizationId}:${orderId}`}))`);
}

export async function createInvoiceFromOrderInTransaction(
  tx: any,
  organizationId: string,
  orderId: string,
  userId: string,
  opts: {
    terms: string;
    customDueDate?: Date | null;
    invoiceCreationSource?: InvoiceCreationSource;
    billingMilestone?: BillingInvoiceMilestone | null;
  }
) {
    await lockInvoiceOrderCreation(tx, organizationId, orderId);

    // Fetch order & its line items
    const [order] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)));
    if (!order) throw new Error('Order not found');
    const lineItems = await tx.select().from(orderLineItems).where(eq(orderLineItems.orderId, orderId));

    const { displayNumber, numberCore } = await allocateDocumentNumber(organizationId, "invoice", tx);
    const invoiceNumber = numberCore;
    const issueDate = new Date();
    const dueDate = calculateDueDate(issueDate, opts.terms, opts.customDueDate || null);

    const pricedLineItems = lineItems.map((li: any) => ({
      lineItem: li,
      pricing: resolveOrderLineItemInvoicePricing(li as any),
    }));
    const subtotalCents = pricedLineItems.reduce((sum: number, item: any) => sum + item.pricing.effectiveTotalCents, 0);
    const subtotal = subtotalCents / 100;
    const tax = Number(order.tax || '0');
    const shippingCents = Number((order as any).shippingCents ?? 0) || 0;
    const shipping = shippingCents / 100;
    const total = subtotal + tax + shipping;

    const taxCents = toCents(tax);
    const totalCents = Math.max(0, subtotalCents + taxCents + shippingCents);

    const sourceOrderNumber = order.orderNumber ? parseInt(order.orderNumber, 10) || null : null;
    const invoiceInsert: InsertInvoice = {
      organizationId,
      invoiceNumber,
      displayNumber,
      numberCore,
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
      amountPaid: '0.00' as any,
      balanceDue: (totalCents / 100).toFixed(2) as any,
      currency: ((order as any)?.currency as any) || 'USD',
      notesPublic: undefined,
      notesInternal: undefined,
      createdByUserId: userId,
      syncStatus: 'pending',
      qbSyncStatus: 'not_synced' as any,
      modifiedAfterBilling: false as any,
      invoiceCreationSource: opts.invoiceCreationSource ?? 'manual',
      billingMilestone: opts.billingMilestone ?? null,
    } as any; // cast due to extended schema types differences

    const [invoice] = await tx.insert(invoices).values(invoiceInsert as any).returning();

    // Snapshot line items
    if (pricedLineItems.length) {
      const snapshotRows: InsertInvoiceLineItem[] = pricedLineItems.map(({ lineItem: li, pricing }: any, idx: number) => ({
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
        quantity: pricing.quantity,
        sqft: li.sqft ? Number(li.sqft) : null,
        unitPrice: pricing.effectiveUnitPriceCents / 100,
        totalPrice: pricing.effectiveTotalCents / 100,
        unitPriceCents: pricing.effectiveUnitPriceCents,
        lineTotalCents: pricing.effectiveTotalCents,
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
}

async function createInvoiceFromOrderImpl(
  organizationId: string,
  orderId: string,
  userId: string,
  opts: { terms: string; customDueDate?: Date | null }
) {
  return db.transaction(async (tx) => {
    return createInvoiceFromOrderInTransaction(tx, organizationId, orderId, userId, opts);
  }).catch((error) => {
    if (isDocumentNumberUniqueViolation(error)) throw toDocumentNumberConflictError(error);
    throw error;
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

    const currentFinancialState = computeInvoiceFinancialState(invoice as any, rel.payments as any);
    if (toCents(data.amount) > currentFinancialState.amountDueCents) throw new Error('Overpayment not allowed');

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
    const nextFinancialState = computeInvoiceFinancialState(invoice as any, paymentRows as any);

    const amountPaid = centsToDecimalString(nextFinancialState.amountPaidCents);
    const balanceDue = centsToDecimalString(nextFinancialState.amountDueCents);
    const newStatus = nextFinancialState.status as any;

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
  const financialState = computeInvoiceFinancialState(invoice as any, paymentRows as any);

  const amountPaid = centsToDecimalString(financialState.amountPaidCents);
  const balanceDue = centsToDecimalString(financialState.amountDueCents);

  let status = financialState.status;
  const isImportedFromQuickBooks = String((invoice as any).importSource || '').trim().toLowerCase() === 'quickbooks';
  if (!isImportedFromQuickBooks && status !== 'paid' && invoice.dueDate && new Date(invoice.dueDate) < new Date()) {
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
