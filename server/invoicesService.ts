import { db } from './db';
import { auditLogs, customerContacts, customers, invoices, invoiceEmailLogs, invoiceLineItems, payments, orders, orderLineItems } from '../shared/schema';
import { asc, desc, eq, and, ilike, inArray, or, sql, ne } from 'drizzle-orm';
import { InsertInvoice, InsertInvoiceEmailLog, InsertInvoiceLineItem, InsertPayment, type Invoice } from '../shared/schema';
import { computeInvoicePaymentRollup, getInvoiceFinancialLifecycleStatus } from '../shared/rollups/invoicePaymentRollup';
import { normalizeInvoiceAccountingDisplay } from '../shared/invoiceAccountingDisplay';
import { formatSharedInvoiceNumber } from '../shared/documentNumbering';
import {
  allocateDocumentNumber,
  isDocumentNumberUniqueViolation,
  toDocumentNumberConflictError,
} from './services/documentNumberingService';
import { resolveOrderLineItemInvoicePricing } from './lib/downstreamEffectivePricing';
import { getBillableBundleRoots } from './services/lineItemBundles';
import type { BillingInvoiceMilestone, InvoiceCreationSource } from '../shared/billingInvoicePolicy';
import { isCanceledOrder } from '../shared/operationalState';
import { getInvoiceFinancialPaymentEligibility } from '../shared/paymentOrchestration';
import {
  resolveBillingCustomerForOrder,
  writeContactAccountingPromotionAudit,
} from './services/contactAccountingPromotionService';

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
  | 'purchaseOrderNumber'
  | 'issueDate'
  | 'dueDate'
  | 'lastSentAt'
  | 'status'
  | 'total'
  | 'balance';

export type InvoiceListSortDir = 'asc' | 'desc';

export interface ListInvoicesForOrganizationOptions {
  organizationId: string;
  status?: string;
  /** A bounded allowlist used by analytical consumers. It is still combined
   * with the trusted organization predicate below. */
  statuses?: readonly string[];
  customerId?: string;
  orderId?: string;
  search?: string;
  /** Inclusive/exclusive window over the canonical posted-or-issued timestamp.
   * These values are server-created Dates, never a model-authored query. */
  issuedAtStart?: Date;
  issuedAtEndExclusive?: Date;
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
    case 'purchaseOrderNumber':
    case 'issueDate':
    case 'dueDate':
    case 'status':
    case 'total':
    case 'balance':
      return raw === 'poNumber' ? 'purchaseOrderNumber' : raw;
    default:
      return 'issueDate';
  }
}

function normalizeInvoiceListSortDir(sortDir: unknown): InvoiceListSortDir {
  return String(sortDir || '').trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
}

function invoiceListSortExpression(sortBy: InvoiceListSortBy, organizationId: string) {
  switch (sortBy) {
    case 'invoiceNumber':
      return sql`coalesce(
        ${invoices.numberCore},
        ${invoices.invoiceNumber},
        nullif(regexp_replace(coalesce(${invoices.displayNumber}, ${invoices.qbDocNumber}, ''), '\\D', '', 'g'), '')::int,
        0
      )`;
    case 'customer':
      return sql`lower(coalesce(${customers.companyName}, ''))`;
    case 'contact':
      return sql`lower(trim(coalesce(${customerContacts.firstName}, '') || ' ' || coalesce(${customerContacts.lastName}, '')))`;
    case 'orderNumber':
      return sql`coalesce(${orders.displayNumber}, ${orders.orderNumber}, ${invoices.sourceOrderNumber}::text, '')`;
    case 'purchaseOrderNumber':
      return sql`lower(coalesce(${orders.poNumber}, ${invoices.customerPoNumber}, ''))`;
    case 'dueDate':
      return sql`coalesce(${invoices.dueDate}, '9999-12-31'::timestamptz)`;
    case 'lastSentAt':
      return sql`coalesce((
        select max(${invoiceEmailLogs.sentAt})
        from ${invoiceEmailLogs}
        where ${invoiceEmailLogs.invoiceId} = ${invoices.id}
          and ${invoiceEmailLogs.organizationId} = ${organizationId}
          and ${invoiceEmailLogs.type} = 'invoice_send'
          and ${invoiceEmailLogs.status} = 'sent'
      ), 'epoch'::timestamptz)`;
    case 'status':
      return sql`lower(coalesce(${invoices.status}, ''))`;
    case 'total':
      return sql`coalesce(${invoices.totalCents}, 0)`;
    case 'balance':
      return sql`case
        when lower(coalesce(${invoices.importSource}, '')) = 'quickbooks'
          then coalesce(${invoices.balanceDue}, '0')::numeric * 100
        else greatest(
          coalesce(${invoices.totalCents}, 0) -
          coalesce((
            select sum(case
              when ${payments.status} in ('succeeded', 'captured') then ${payments.amountCents}
              when ${payments.status} = 'refunded' then -${payments.amountCents}
              else 0
            end)
            from ${payments}
            where ${payments.invoiceId} = ${invoices.id}
              and ${payments.organizationId} = ${organizationId}
          ), round(coalesce(${invoices.amountPaid}, '0')::numeric * 100), 0),
          0
        )
      end`;
    case 'issueDate':
    default:
      return sql`coalesce(${invoices.issueDate}, '9999-12-31'::timestamptz)`;
  }
}

export async function listInvoicesForOrganization(
  opts: ListInvoicesForOrganizationOptions,
): Promise<EnrichedInvoiceListItem[]> {
  const limit = Math.min(Math.max(Number(opts.limit || 50), 1), 201);
  const offset = Math.max(Number(opts.offset || 0), 0);
  const sortBy = normalizeInvoiceListSortBy(opts.sortBy);
  const sortDir = normalizeInvoiceListSortDir(opts.sortDir);

  const whereClauses: any[] = [eq(invoices.organizationId, opts.organizationId)];
  if (opts.statuses?.length) whereClauses.push(inArray(invoices.status, [...opts.statuses]));
  else if (opts.status) whereClauses.push(eq(invoices.status, opts.status));
  if (opts.customerId) whereClauses.push(eq(invoices.customerId, opts.customerId));
  if (opts.orderId) whereClauses.push(eq(invoices.orderId, opts.orderId));
  const postedOrIssuedAt = sql<Date>`coalesce(${invoices.issuedAt}, ${invoices.issueDate})`;
  if (opts.issuedAtStart) whereClauses.push(sql`${postedOrIssuedAt} >= ${opts.issuedAtStart}`);
  if (opts.issuedAtEndExclusive) whereClauses.push(sql`${postedOrIssuedAt} < ${opts.issuedAtEndExclusive}`);

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

  const sortExpression = invoiceListSortExpression(sortBy, opts.organizationId);
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

    if (status === 'succeeded' || status === 'captured') {
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

    const status = getInvoiceFinancialLifecycleStatus({
      invoiceStatus: invoice.status,
      rollup: { amountPaidCents, amountDueCents },
    });

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

  const status = getInvoiceFinancialLifecycleStatus({
    invoiceStatus: invoice.status,
    rollup,
  });

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

function buildOrderInvoiceFinancialSnapshot(order: any, lineItems: any[]) {
  const pricedLineItems = lineItems.map((lineItem: any) => ({
    lineItem,
    pricing: resolveOrderLineItemInvoicePricing(lineItem),
  }));
  const billablePricedLineItems = getBillableBundleRoots(pricedLineItems.map((item) => item.lineItem))
    .map((lineItem: any) => pricedLineItems.find((item) => item.lineItem.id === lineItem.id)!);
  const subtotalCents = billablePricedLineItems.reduce((sum: number, item: any) => sum + item.pricing.effectiveTotalCents, 0);
  const tax = Number(order.tax || '0');
  const taxCents = toCents(tax);
  const shippingCents = Number(order.shippingCents ?? 0) || 0;
  const totalCents = Math.max(0, subtotalCents + taxCents + shippingCents);

  return {
    pricedLineItems,
    subtotalCents,
    taxCents,
    shippingCents,
    totalCents,
    subtotal: subtotalCents / 100,
    tax,
    total: totalCents / 100,
  };
}

function buildInvoiceLineItemSnapshots(invoiceId: string, pricedLineItems: Array<{ lineItem: any; pricing: any }>): InsertInvoiceLineItem[] {
  return pricedLineItems.map(({ lineItem: li, pricing }: any, idx: number) => ({
    invoiceId,
    orderLineItemId: li.id,
    productId: li.productId,
    productVariantId: li.productVariantId,
    productType: li.productType,
    name: li.name ?? null,
    sku: li.sku ?? null,
    description: li.description,
    width: li.width ? Number(li.width) : null,
    height: li.height ? Number(li.height) : null,
    quantity: pricing.quantity,
    sqft: li.sqft ? Number(li.sqft) : null,
    unitPrice: pricing.effectiveUnitPriceCents / 100,
    totalPrice: pricing.effectiveTotalCents / 100,
    unitPriceCents: pricing.effectiveUnitPriceCents,
    lineTotalCents: pricing.effectiveTotalCents,
    sortOrder: typeof li.sortOrder === 'number' ? li.sortOrder : idx,
    specsJson: li.specsJson as any,
    selectedOptions: li.selectedOptions as any,
    optionSelectionsJson: li.optionSelectionsJson ?? null,
    pbv2SnapshotJson: li.pbv2SnapshotJson ?? null,
    parentLineItemId: li.parentLineItemId ?? null,
    lineItemRole: li.lineItemRole ?? "standalone",
    childDisplayMode: li.childDisplayMode ?? "hidden",
    parentPriceMode: li.parentPriceMode ?? "sum_children",
    childCalculatedTotalCents: li.childCalculatedTotalCents ?? null,
  } as any));
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

    // This low-level creator is still used by established UI/automation
    // adapters. Keep the one-active-invoice invariant here as well so a
    // compatibility caller cannot bypass the canonical order boundary.
    const [existingActiveInvoice] = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(
        eq(invoices.organizationId, organizationId),
        eq(invoices.orderId, orderId),
        ne(invoices.status, "void"),
      ))
      .limit(1);
    if (existingActiveInvoice) {
      throw Object.assign(new Error("Order already has an active invoice."), { code: "INVOICE_ALREADY_EXISTS" });
    }

    // Fetch order & its line items
    const [order] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)));
    if (!order) throw new Error('Order not found');
    const billingCustomer = await resolveBillingCustomerForOrder(tx, {
      organizationId,
      order,
      actorUserId: userId,
    });
    const lineItems = await tx.select().from(orderLineItems).where(eq(orderLineItems.orderId, orderId));

    // New-style Orders carry a frozen Job Number. The first Invoice has no
    // suffix; later independent invoices use the next ordinal. The per-order
    // advisory lock above serializes this calculation and creation.
    const orderJobNumber = Number((order as any).jobNumber);
    const hasSharedJobNumber = Number.isSafeInteger(orderJobNumber) && orderJobNumber > 0;
    const existingJobInvoices = hasSharedJobNumber
      ? await tx.select({ invoiceSequence: invoices.invoiceSequence })
        .from(invoices)
        .where(and(eq(invoices.organizationId, organizationId), eq(invoices.jobNumber, orderJobNumber)))
      : [];
    const invoiceSequence = hasSharedJobNumber
      ? Math.max(0, ...existingJobInvoices.map((row: any) => Number(row.invoiceSequence) || 0)) + 1
      : null;
    const legacyParts = hasSharedJobNumber ? null : await allocateDocumentNumber(organizationId, "invoice", tx);
    const invoiceNumber = hasSharedJobNumber ? orderJobNumber : legacyParts!.numberCore;
    const numberCore = hasSharedJobNumber ? orderJobNumber : legacyParts!.numberCore;
    const displayNumber = hasSharedJobNumber
      ? formatSharedInvoiceNumber(orderJobNumber, invoiceSequence!)
      : legacyParts!.displayNumber;
    const issueDate = new Date();
    const dueDate = calculateDueDate(issueDate, opts.terms, opts.customDueDate || null);

    const financialSnapshot = buildOrderInvoiceFinancialSnapshot(order, lineItems);

    const sourceOrderNumber = order.orderNumber ? parseInt(order.orderNumber, 10) || null : null;
    const invoiceInsert: InsertInvoice = {
      organizationId,
      invoiceNumber,
      jobNumber: hasSharedJobNumber ? orderJobNumber : null,
      invoiceSequence,
      displayNumber,
      numberCore,
      orderId: order.id,
      sourceOrderNumber: sourceOrderNumber as any, // Immutable snapshot — survives order deletion
      customerId: billingCustomer.customerId,
      // An Order-backed invoice is immediately a live receivable. Its
      // commercial facts keep projecting from the editable Order; payment is
      // never gated on a separate document-finalization action.
      status: 'billed',
      terms: opts.terms as any,
      customTerms: undefined,
      issueDate,
      issuedAt: issueDate,
      dueDate: dueDate || undefined,
      subtotal: financialSnapshot.subtotal.toFixed(2) as any,
      tax: financialSnapshot.tax.toFixed(2) as any,
      total: financialSnapshot.total.toFixed(2) as any,
      subtotalCents: financialSnapshot.subtotalCents,
      taxCents: financialSnapshot.taxCents,
      shippingCents: financialSnapshot.shippingCents,
      totalCents: financialSnapshot.totalCents,
      amountPaid: '0.00' as any,
      balanceDue: (financialSnapshot.totalCents / 100).toFixed(2) as any,
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

    // The Order is the commercial authority and its linked Invoice is live
    // immediately.  This is an availability marker, not a payment or
    // fulfillment gate: terms and the immutable payment ledger still decide
    // what is due and whether any downstream work can proceed.
    await tx.update(orders).set({
      billingStatus: "billed",
      updatedAt: new Date(),
    } as any).where(and(eq(orders.id, order.id), eq(orders.organizationId, organizationId)));

    await writeContactAccountingPromotionAudit(tx, {
      organizationId,
      actorUserId: userId,
      orderId: order.id,
      invoiceId: invoice.id,
      customerId: billingCustomer.customerId,
      contactId: billingCustomer.contactId,
      resolution: billingCustomer.resolution,
      createdCustomerId: billingCustomer.createdCustomerId,
    });

    // Snapshot line items
    if (financialSnapshot.pricedLineItems.length) {
      const snapshotRows = buildInvoiceLineItemSnapshots(invoice.id, financialSnapshot.pricedLineItems);
      if (snapshotRows.length) {
        await tx.insert(invoiceLineItems).values(snapshotRows as any);
      }
    }

    return {
      ...invoice,
      accountingPromotion: billingCustomer.resolution === "existing_order_customer"
        ? null
        : {
            resolution: billingCustomer.resolution,
            customerId: billingCustomer.customerId,
            contactId: billingCustomer.contactId,
            createdCustomerId: billingCustomer.createdCustomerId,
            message: billingCustomer.message,
          },
    };
}

/**
 * The forward Order creation invariant. The historical function name remains
 * for compatibility with established callers; it creates a live, order-backed
 * receivable rather than a payment-blocking draft. The advisory lock serializes all
 * creation paths (direct, quote conversion, inbound, and assistant) without
 * imposing a new uniqueness migration on historical invoice data.
 */
export async function ensureDraftInvoiceForOrderInTransaction(
  tx: any,
  input: {
    organizationId: string;
    orderId: string;
    actorUserId: string;
    terms?: string;
    customDueDate?: Date | null;
    source?: "order_created" | "quote_converted" | "inbound_order";
  },
) {
  await lockInvoiceOrderCreation(tx, input.organizationId, input.orderId);
  const [existing] = await tx
    .select()
    .from(invoices)
    .where(and(
      eq(invoices.organizationId, input.organizationId),
      eq(invoices.orderId, input.orderId),
      ne(invoices.status, "void"),
    ))
    .orderBy(asc(invoices.createdAt), asc(invoices.id))
    .limit(1);

  if (existing) return { invoice: existing, created: false };

  const invoice = await createInvoiceFromOrderInTransaction(
    tx,
    input.organizationId,
    input.orderId,
    input.actorUserId,
    {
      terms: input.terms ?? "due_on_receipt",
      customDueDate: input.customDueDate ?? null,
      // The persisted enum intentionally has no separate system-created value.
      // Audit metadata records the actual creation path.
      invoiceCreationSource: "manual",
      billingMilestone: null,
    },
  );
  await tx.insert(auditLogs).values({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    actionType: "invoice_order_backed_created",
    entityType: "invoice",
    entityId: invoice.id,
    entityName: String(invoice.displayNumber || invoice.invoiceNumber),
    description: "Created the linked live invoice as part of Order creation.",
    newValues: { orderId: input.orderId, source: input.source ?? "order_created" } as any,
  } as any);
  return { invoice, created: true };
}

function invoiceSnapshotComparable(row: any) {
  return {
    orderLineItemId: row.orderLineItemId ?? null,
    productId: row.productId ?? null,
    productVariantId: row.productVariantId ?? null,
    productType: row.productType ?? null,
    name: row.name ?? null,
    sku: row.sku ?? null,
    description: row.description ?? null,
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    quantity: Number(row.quantity ?? 0),
    sqft: row.sqft == null ? null : Number(row.sqft),
    unitPriceCents: Number(row.unitPriceCents ?? 0),
    lineTotalCents: Number(row.lineTotalCents ?? 0),
    sortOrder: Number(row.sortOrder ?? 0),
    specsJson: row.specsJson ?? null,
    selectedOptions: row.selectedOptions ?? null,
    optionSelectionsJson: row.optionSelectionsJson ?? null,
    pbv2SnapshotJson: row.pbv2SnapshotJson ?? null,
    parentLineItemId: row.parentLineItemId ?? null,
    lineItemRole: row.lineItemRole ?? "standalone",
    childDisplayMode: row.childDisplayMode ?? "hidden",
    parentPriceMode: row.parentPriceMode ?? "sum_children",
    childCalculatedTotalCents: row.childCalculatedTotalCents == null ? null : Number(row.childCalculatedTotalCents),
  };
}

/**
 * Projects the current Order into its single native linked invoice. Historical
 * imports, voids, and ambiguous legacy links remain deliberately untouched.
 */
export async function synchronizeDraftInvoiceFromOrderInTransaction(
  tx: any,
  input: { organizationId: string; orderId: string; actorUserId?: string | null },
) {
  await lockInvoiceOrderCreation(tx, input.organizationId, input.orderId);
  const [order] = await tx.select().from(orders).where(and(
    eq(orders.id, input.orderId),
    eq(orders.organizationId, input.organizationId),
  )).limit(1);
  if (!order) return { status: "order_not_found" as const };

  const linkedInvoices = await tx.select().from(invoices).where(and(
    eq(invoices.organizationId, input.organizationId),
    eq(invoices.orderId, input.orderId),
    ne(invoices.status, "void"),
  )).orderBy(asc(invoices.createdAt), asc(invoices.id));
  if (linkedInvoices.length !== 1) {
    return { status: "not_editable" as const, invoiceId: linkedInvoices[0]?.id ?? null };
  }

  const invoice = linkedInvoices[0]!;
  if (String((invoice as any).importSource || "").toLowerCase() === "quickbooks") {
    return { status: "not_editable" as const, invoiceId: invoice.id };
  }
  const lineItems = await tx.select().from(orderLineItems).where(eq(orderLineItems.orderId, order.id));
  const snapshot = buildOrderInvoiceFinancialSnapshot(order, lineItems);
  const desiredRows = buildInvoiceLineItemSnapshots(invoice.id, snapshot.pricedLineItems);
  const existingRows = await tx.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoice.id)).orderBy(asc(invoiceLineItems.sortOrder), asc(invoiceLineItems.id));
  const lineSnapshotsChanged = JSON.stringify(existingRows.map(invoiceSnapshotComparable)) !== JSON.stringify(desiredRows.map(invoiceSnapshotComparable));
  const financialChanged =
    Number((invoice as any).subtotalCents ?? 0) !== snapshot.subtotalCents ||
    Number((invoice as any).taxCents ?? 0) !== snapshot.taxCents ||
    Number((invoice as any).shippingCents ?? 0) !== snapshot.shippingCents ||
    Number((invoice as any).totalCents ?? 0) !== snapshot.totalCents ||
    String((invoice as any).customerId ?? "") !== String((order as any).customerId ?? (invoice as any).customerId ?? "");
  if (!lineSnapshotsChanged && !financialChanged) return { status: "unchanged" as const, invoice };

  if (lineSnapshotsChanged) {
    await tx.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoice.id));
    if (desiredRows.length) await tx.insert(invoiceLineItems).values(desiredRows as any);
  }
  const paymentRows = await tx.select().from(payments).where(and(
    eq(payments.invoiceId, invoice.id),
    eq(payments.organizationId, input.organizationId),
  ));
  const nextInvoice = {
    ...invoice,
    status: String(invoice.status || "").toLowerCase() === "draft" ? "billed" : invoice.status,
    totalCents: snapshot.totalCents,
  };
  const financialState = computeInvoiceFinancialState(nextInvoice, paymentRows as any);
  const [updated] = await tx.update(invoices).set({
    customerId: order.customerId ?? invoice.customerId,
    subtotal: snapshot.subtotal.toFixed(2),
    tax: snapshot.tax.toFixed(2),
    total: snapshot.total.toFixed(2),
    subtotalCents: snapshot.subtotalCents,
    taxCents: snapshot.taxCents,
    shippingCents: snapshot.shippingCents,
    totalCents: snapshot.totalCents,
    amountPaid: centsToDecimalString(financialState.amountPaidCents),
    balanceDue: centsToDecimalString(financialState.amountDueCents),
    status: financialState.status,
    invoiceVersion: Number((invoice as any).invoiceVersion || 1) + 1,
    modifiedAfterBilling: Boolean((invoice as any).qbInvoiceId),
    ...((invoice as any).qbInvoiceId ? { qbSyncStatus: "pending", qbLastError: null } : {}),
    updatedAt: new Date(),
  } as any).where(and(eq(invoices.id, invoice.id), eq(invoices.organizationId, input.organizationId))).returning();
  await tx.insert(auditLogs).values({
    organizationId: input.organizationId,
    userId: input.actorUserId ?? null,
    actionType: "invoice_order_backed_synchronized",
    entityType: "invoice",
    entityId: invoice.id,
    entityName: String(invoice.displayNumber || invoice.invoiceNumber),
    description: "Synchronized the live Order-backed invoice from its current commercial snapshot.",
    oldValues: { subtotalCents: invoice.subtotalCents, taxCents: invoice.taxCents, shippingCents: invoice.shippingCents, totalCents: invoice.totalCents } as any,
    newValues: { subtotalCents: snapshot.subtotalCents, taxCents: snapshot.taxCents, shippingCents: snapshot.shippingCents, totalCents: snapshot.totalCents, lineSnapshotsChanged } as any,
  } as any);
  return { status: "updated" as const, invoice: updated };
}

export async function synchronizeDraftInvoiceFromOrder(input: { organizationId: string; orderId: string; actorUserId?: string | null }) {
  return db.transaction((tx) => synchronizeDraftInvoiceFromOrderInTransaction(tx, input));
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

export type CanonicalSafeInvoiceDraftPatch = {
  terms?: "due_on_receipt" | "net_15" | "net_30" | "net_45" | "custom";
  customDueDate?: Date | null;
  notesPublic?: string;
};

/** Canonical, non-financial draft edit boundary shared by reviewed callers. */
export async function updateInvoiceSafeDraftCanonical(input: {
  organizationId: string;
  invoiceId: string;
  userId: string;
  patch: CanonicalSafeInvoiceDraftPatch;
}) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${input.organizationId}:${input.invoiceId}`}))`);
    const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.id, input.invoiceId), eq(invoices.organizationId, input.organizationId))).limit(1);
    if (!invoice) throw Object.assign(new Error("Invoice not found"), { code: "INVOICE_NOT_FOUND" });
    if (String(invoice.status || "").toLowerCase() !== "draft") throw Object.assign(new Error("Only draft invoices can be edited."), { code: "INVOICE_NOT_EDITABLE" });
    if (String((invoice as any).importSource || "").toLowerCase() === "quickbooks") throw Object.assign(new Error("Imported QuickBooks invoices are read-only."), { code: "INVOICE_IMPORTED_READ_ONLY" });
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.patch.terms !== undefined) updates.terms = input.patch.terms;
    if (input.patch.customDueDate !== undefined) updates.dueDate = input.patch.customDueDate;
    if (input.patch.notesPublic !== undefined) updates.notesPublic = input.patch.notesPublic;
    if (Object.keys(updates).length === 1) throw Object.assign(new Error("Provide at least one safe draft field to update."), { code: "INVOICE_PATCH_EMPTY" });
    const [updated] = await tx.update(invoices).set(updates as any).where(and(eq(invoices.id, invoice.id), eq(invoices.organizationId, input.organizationId))).returning();
    await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.userId, actionType: "invoice_draft_updated", entityType: "invoice", entityId: invoice.id, entityName: String(invoice.invoiceNumber), description: "Updated safe draft invoice details through the canonical Invoice operation.", oldValues: { terms: invoice.terms, dueDate: invoice.dueDate, notesPublic: invoice.notesPublic } as any, newValues: { terms: updated.terms, dueDate: updated.dueDate, notesPublic: updated.notesPublic } as any } as any);
    return { previous: invoice, updated };
  });
}

/** Canonical status-only send marker; never changes payment or financial state. */
export async function markInvoiceSentCanonical(input: { organizationId: string; invoiceId: string; userId: string; via?: "email" | "manual" | "portal" }) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${input.organizationId}:${input.invoiceId}`}))`);
    const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.id, input.invoiceId), eq(invoices.organizationId, input.organizationId))).limit(1);
    if (!invoice) throw Object.assign(new Error("Invoice not found"), { code: "INVOICE_NOT_FOUND" });
    const status = String(invoice.status || "").toLowerCase();
    if (String((invoice as any).importSource || "").toLowerCase() === "quickbooks") throw Object.assign(new Error("Imported QuickBooks invoices are read-only."), { code: "INVOICE_IMPORTED_READ_ONLY" });
    const now = new Date();
    const via = input.via ?? "manual";
    const nextStatus = ["void", "paid", "partially_paid"].includes(status) ? status : "sent";
    const [updated] = await tx.update(invoices).set({ status: nextStatus as any, lastSentAt: now, lastSentVersion: Number((invoice as any).invoiceVersion || 1), lastSentVia: via, updatedAt: now } as any).where(and(eq(invoices.id, invoice.id), eq(invoices.organizationId, input.organizationId))).returning();
    await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.userId, actionType: "invoice_marked_sent", entityType: "invoice", entityId: invoice.id, entityName: String(invoice.invoiceNumber), description: "Marked invoice as sent through the canonical Invoice operation.", newValues: { via, invoiceVersion: Number((invoice as any).invoiceVersion || 1) } as any } as any);
    return updated;
  });
}

/** Appends an internal-only billing note without touching workflow or payment state. */
export async function appendInvoiceInternalNoteCanonical(input: { organizationId: string; invoiceId: string; userId: string; note: string }) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${input.organizationId}:${input.invoiceId}`}))`);
    const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.id, input.invoiceId), eq(invoices.organizationId, input.organizationId))).limit(1);
    if (!invoice) throw Object.assign(new Error("Invoice not found"), { code: "INVOICE_NOT_FOUND" });
    if (String(invoice.status || "").toLowerCase() === "void") throw Object.assign(new Error("Void invoices cannot be updated."), { code: "INVOICE_NOT_EDITABLE" });
    const note = input.note.trim();
    if (!note) throw Object.assign(new Error("An invoice note is required."), { code: "INVOICE_NOTE_REQUIRED" });
    const previous = String(invoice.notesInternal || "").trim();
    const notesInternal = previous ? `${previous}\n${note}` : note;
    const [updated] = await tx.update(invoices).set({ notesInternal, updatedAt: new Date() } as any).where(and(eq(invoices.id, invoice.id), eq(invoices.organizationId, input.organizationId))).returning();
    await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.userId, actionType: "invoice_internal_note_added", entityType: "invoice", entityId: invoice.id, entityName: String(invoice.invoiceNumber), description: "Added an internal invoice note through the canonical Invoice operation.", newValues: { noteLength: note.length } as any } as any);
    return { previousNotesInternal: invoice.notesInternal ?? null, updated };
  });
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
  const result = await db.transaction(async (tx) => {
    const rel = await getInvoiceWithRelations(invoiceId);
    if (!rel) throw new Error('Invoice not found');
    const { invoice } = rel;
    const currentFinancialState = computeInvoiceFinancialState(invoice as any, rel.payments as any);
    const paymentEligibility = getInvoiceFinancialPaymentEligibility({
      invoiceStatus: invoice.status,
      remainingCents: currentFinancialState.amountDueCents,
    });
    if (!paymentEligibility.payable) throw new Error(paymentEligibility.blockedReason || 'Invoice cannot accept payment');
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

    return {
      payment,
      organizationId: String((invoice as any).organizationId),
      orderId: (invoice as any).orderId ? String((invoice as any).orderId) : null,
      becamePaid: String(newStatus).toLowerCase() === 'paid',
    };
  });

  if (result.becamePaid && result.orderId) {
    const { applyWorkflowStatusPillFailSoft } = await import('./services/workflowStatusPillService');
    await applyWorkflowStatusPillFailSoft({
      organizationId: result.organizationId,
      orderId: result.orderId,
      triggerKey: 'payment_received',
      actorUserId: userId,
      actorUserName: 'System',
      source: 'system',
      reason: 'Invoice paid',
      metadata: { invoiceId, paymentId: result.payment.id },
    });
  }

  return result.payment;
}

export const assistantManualPaymentMethodValues = ["cash", "check", "wire", "bank_transfer", "other"] as const;
export type AssistantManualPaymentMethod = typeof assistantManualPaymentMethodValues[number];
export type CanonicalInternalManualPaymentMethod = AssistantManualPaymentMethod | "ach";

/**
 * Canonical assistant boundary for internal/manual payment recording. It is
 * intentionally separate from provider flows: it cannot call EPS, the portal,
 * or a card/ACH processor, and it uses the payment provider idempotency key
 * already protected by a tenant-scoped unique index.
 */
export async function recordManualPaymentCanonical(input: {
  organizationId: string;
  invoiceId: string;
  userId: string;
  amount: number;
  method: CanonicalInternalManualPaymentMethod;
  paidAt?: Date;
  notes?: string;
  idempotencyKey: string;
  source?: "ui" | "assistant";
  reference?: string;
}) {
  if (!Number.isFinite(input.amount) || toCents(input.amount) <= 0) {
    throw Object.assign(new Error("Payment amount must be greater than zero."), { code: "PAYMENT_AMOUNT_INVALID" });
  }
  const allowedMethods = input.source === "ui" ? [...assistantManualPaymentMethodValues, "ach"] : [...assistantManualPaymentMethodValues];
  if (!allowedMethods.includes(input.method)) {
    throw Object.assign(new Error("This payment method is not available for assistant payment recording."), { code: "PAYMENT_METHOD_NOT_ALLOWED" });
  }

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`payment:${input.organizationId}:${input.invoiceId}`}))`);
    const [existing] = await tx.select().from(payments).where(and(
      eq(payments.organizationId, input.organizationId),
      eq(payments.provider, "manual"),
      eq(payments.providerIdempotencyKey, input.idempotencyKey),
    )).limit(1);
    if (existing) {
      if (existing.invoiceId !== input.invoiceId || Number(existing.amountCents || 0) !== toCents(input.amount) || String(existing.method) !== input.method) {
        throw Object.assign(new Error("The idempotency key was already used for a different payment request."), { code: "IDEMPOTENCY_KEY_CONFLICT" });
      }
      const [existingInvoice] = await tx.select().from(invoices).where(and(eq(invoices.id, existing.invoiceId), eq(invoices.organizationId, input.organizationId))).limit(1);
      return { payment: existing, becamePaid: String(existingInvoice?.status || "").toLowerCase() === "paid", orderId: existingInvoice?.orderId ? String(existingInvoice.orderId) : null, reused: true };
    }

    const [invoice] = await tx.select().from(invoices).where(and(
      eq(invoices.id, input.invoiceId),
      eq(invoices.organizationId, input.organizationId),
    )).limit(1);
    if (!invoice) throw Object.assign(new Error("Invoice not found."), { code: "INVOICE_NOT_FOUND" });
    if (String((invoice as any).importSource || "").toLowerCase() === "quickbooks") {
      throw Object.assign(new Error("Imported QuickBooks invoices must be reconciled from QuickBooks."), { code: "IMPORTED_QB_PAYMENT_RECONCILIATION_REQUIRED" });
    }
    if (invoice.orderId) {
      const [order] = await tx.select().from(orders).where(and(eq(orders.id, invoice.orderId), eq(orders.organizationId, input.organizationId))).limit(1);
      if (!order) throw Object.assign(new Error("The invoice order is unavailable."), { code: "ORDER_NOT_FOUND" });
      if (isCanceledOrder(order)) throw Object.assign(new Error("Cancelled orders cannot receive payments."), { code: "ORDER_CANCELLED" });
    }

    const paymentRows = await tx.select().from(payments).where(and(eq(payments.invoiceId, invoice.id), eq(payments.organizationId, input.organizationId)));
    const financialState = computeInvoiceFinancialState(invoice as any, paymentRows as any);
    const paymentEligibility = getInvoiceFinancialPaymentEligibility({
      invoiceStatus: invoice.status,
      remainingCents: financialState.amountDueCents,
    });
    if (!paymentEligibility.payable) {
      throw Object.assign(new Error(paymentEligibility.blockedReason || "This invoice cannot receive a manual payment."), { code: "INVOICE_NOT_PAYABLE" });
    }
    const amountCents = toCents(input.amount);
    if (financialState.amountDueCents <= 0 || amountCents > financialState.amountDueCents) {
      throw Object.assign(new Error("Overpayment not allowed."), { code: "OVERPAYMENT_NOT_ALLOWED" });
    }

    const [payment] = await tx.insert(payments).values({
      organizationId: input.organizationId,
      invoiceId: invoice.id,
      provider: "manual",
      providerIdempotencyKey: input.idempotencyKey,
      status: "succeeded",
      currency: (invoice as any).currency || "USD",
      amount: input.amount,
      amountCents,
      method: input.method,
      notes: input.notes?.trim() || null,
      note: input.notes?.trim() || null,
      paidAt: input.paidAt ?? new Date(),
      createdByUserId: input.userId,
      syncStatus: "pending",
      metadata: { source: `${input.source ?? "assistant"}_manual_payment`, ...(input.reference ? { reference: input.reference } : {}) },
    } as any).returning();
    const nextRows = [...paymentRows, payment] as any;
    const nextState = computeInvoiceFinancialState(invoice as any, nextRows);
    await tx.update(invoices).set({
      amountPaid: centsToDecimalString(nextState.amountPaidCents),
      balanceDue: centsToDecimalString(nextState.amountDueCents),
      status: nextState.status as any,
      updatedAt: new Date(),
    }).where(and(eq(invoices.id, invoice.id), eq(invoices.organizationId, input.organizationId)));
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId, userId: input.userId, actionType: "manual_payment_recorded",
      entityType: "payment", entityId: payment.id, entityName: String(invoice.invoiceNumber),
      description: "Recorded an internal manual payment through the canonical Payment operation.",
      newValues: { invoiceId: invoice.id, amountCents, method: input.method, source: input.source ?? "assistant", reference: input.reference ?? null } as any,
    } as any);
    return { payment, becamePaid: String(nextState.status).toLowerCase() === "paid", orderId: invoice.orderId ? String(invoice.orderId) : null, reused: false };
  });

  if (result.becamePaid && result.orderId) {
    const { applyWorkflowStatusPillFailSoft } = await import('./services/workflowStatusPillService');
    await applyWorkflowStatusPillFailSoft({
      organizationId: input.organizationId, orderId: result.orderId, triggerKey: 'payment_received', actorUserId: input.userId,
      actorUserName: 'System', source: 'system', reason: 'Invoice paid', metadata: { invoiceId: input.invoiceId, paymentId: result.payment.id },
    });
  }
  return result.payment;
}

/** Canonical internal note boundary; it never changes payment or invoice state. */
export async function appendPaymentNoteCanonical(input: { organizationId: string; paymentId: string; userId: string; note: string }) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`payment-note:${input.organizationId}:${input.paymentId}`}))`);
    const [payment] = await tx.select().from(payments).where(and(eq(payments.id, input.paymentId), eq(payments.organizationId, input.organizationId))).limit(1);
    if (!payment) throw Object.assign(new Error("Payment not found."), { code: "PAYMENT_NOT_FOUND" });
    const trimmed = input.note.trim();
    if (!trimmed) throw Object.assign(new Error("A payment note is required."), { code: "PAYMENT_NOTE_REQUIRED" });
    const previous = String(payment.notes ?? payment.note ?? "").trim();
    const notes = previous ? `${previous}\n${trimmed}` : trimmed;
    const [updated] = await tx.update(payments).set({ notes, note: notes, updatedAt: new Date() }).where(and(eq(payments.id, payment.id), eq(payments.organizationId, input.organizationId))).returning();
    await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.userId, actionType: "payment_note_added", entityType: "payment", entityId: payment.id, entityName: payment.id, description: "Added an internal payment note through the canonical Payment operation.", newValues: { noteLength: trimmed.length } as any } as any);
    return { previousNotes: payment.notes ?? payment.note ?? null, updated };
  });
}

export async function markInvoiceSent(id: string) {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (!inv) throw new Error('Invoice not found');
  if (inv.status !== 'draft') return inv; // only transition from draft
  const [updated] = await db.update(invoices).set({ status: 'sent', updatedAt: new Date() }).where(eq(invoices.id, id)).returning();
  return updated;
}

/** Rebuild an invoice rollup inside the payment mutation's transaction. */
export async function reconcileInvoicePaymentStateInTransaction(input: {
  tx: any;
  organizationId: string;
  invoiceId: string;
}) {
  const [invoice] = await input.tx.select().from(invoices).where(and(
    eq(invoices.id, input.invoiceId),
    eq(invoices.organizationId, input.organizationId),
  )).limit(1);
  if (!invoice) return null;
  const paymentRows = await input.tx.select().from(payments).where(and(
    eq(payments.invoiceId, input.invoiceId),
    eq(payments.organizationId, input.organizationId),
  ));
  const financialState = computeInvoiceFinancialState(invoice as any, paymentRows as any);
  let status = financialState.status;
  const isImportedFromQuickBooks = String((invoice as any).importSource || '').trim().toLowerCase() === 'quickbooks';
  if (!isImportedFromQuickBooks && status !== 'paid' && invoice.dueDate && new Date(invoice.dueDate) < new Date()) status = 'overdue';
  const [updated] = await input.tx.update(invoices).set({
    amountPaid: centsToDecimalString(financialState.amountPaidCents),
    balanceDue: centsToDecimalString(financialState.amountDueCents),
    status,
    updatedAt: new Date(),
  }).where(and(eq(invoices.id, input.invoiceId), eq(invoices.organizationId, input.organizationId))).returning();
  return { updated, invoice, status };
}

/** Soft-void a manual payment and rebuild its invoice rollup atomically. */
export async function voidManualPaymentCanonical(input: {
  organizationId: string;
  invoiceId: string;
  paymentId: string;
  userId: string;
}) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`invoice-rollup:${input.invoiceId}`}))`);
    const [invoice] = await tx.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber }).from(invoices).where(and(
      eq(invoices.id, input.invoiceId), eq(invoices.organizationId, input.organizationId),
    )).limit(1);
    if (!invoice) throw Object.assign(new Error("Invoice not found."), { code: "INVOICE_NOT_FOUND" });
    const [payment] = await tx.select().from(payments).where(and(
      eq(payments.id, input.paymentId), eq(payments.invoiceId, input.invoiceId), eq(payments.organizationId, input.organizationId),
    )).limit(1);
    if (!payment) throw Object.assign(new Error("Payment not found."), { code: "PAYMENT_NOT_FOUND" });
    if (String((payment as any).provider || "").toLowerCase() !== "manual") {
      throw Object.assign(new Error("Only manual payments can be voided here."), { code: "PAYMENT_VOID_NOT_ALLOWED" });
    }
    const now = new Date();
    const alreadyVoided = String((payment as any).status || "").toLowerCase() === "voided";
    const [updatedPayment] = alreadyVoided ? [payment] : await tx.update(payments).set({
      status: "voided",
      canceledAt: now,
      metadata: {
        ...(((payment as any).metadata && typeof (payment as any).metadata === "object") ? (payment as any).metadata : {}),
        voidedAt: now.toISOString(),
        voidedByUserId: input.userId,
      } as any,
      updatedAt: now,
    } as any).where(and(eq(payments.id, payment.id), eq(payments.organizationId, input.organizationId))).returning();
    const reconciled = await reconcileInvoicePaymentStateInTransaction({ tx, organizationId: input.organizationId, invoiceId: input.invoiceId });
    if (!alreadyVoided) {
      await tx.insert(auditLogs).values({
        organizationId: input.organizationId, userId: input.userId, actionType: "manual_payment_voided",
        entityType: "payment", entityId: payment.id, entityName: String(invoice.invoiceNumber),
        description: "Manual payment voided through the canonical Payment operation.",
        oldValues: { status: payment.status, amountCents: Number((payment as any).amountCents || 0) } as any,
        newValues: { status: "voided", voidedAt: now.toISOString() } as any,
      } as any);
    }
    return { payment: updatedPayment, invoice: reconciled?.updated ?? null };
  });
}

export async function refreshInvoiceStatus(id: string) {
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`invoice-rollup:${id}`}))`);
    const [invoice] = await tx.select({ organizationId: invoices.organizationId }).from(invoices).where(eq(invoices.id, id)).limit(1);
    if (!invoice) return null;
    return reconcileInvoicePaymentStateInTransaction({ tx, organizationId: invoice.organizationId, invoiceId: id });
  });
  if (!result) return null;
  const { updated, invoice, status } = result;
  if (status === 'paid' && (invoice as any).orderId) {
    const { applyWorkflowStatusPillFailSoft } = await import('./services/workflowStatusPillService');
    await applyWorkflowStatusPillFailSoft({
      organizationId: String((invoice as any).organizationId), orderId: String((invoice as any).orderId),
      triggerKey: 'payment_received', actorUserId: String((invoice as any).createdByUserId), actorUserName: 'System',
      source: 'system', reason: 'Invoice paid', metadata: { invoiceId: id },
    });
  }
  return updated;
}

// Placeholder QuickBooks sync queueing
export async function queueInvoiceForSync(id: string) {
  await db.update(invoices).set({ syncStatus: 'pending', updatedAt: new Date() }).where(eq(invoices.id, id));
}
export async function queuePaymentForSync(id: string) {
  await db.update(payments).set({ syncStatus: 'pending', updatedAt: new Date() }).where(eq(payments.id, id));
}
