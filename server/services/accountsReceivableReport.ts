import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { customerContacts, customers, invoices, orders, payments } from '@shared/schema';
import { canonicalInvoiceCustomerId } from './invoiceCustomerProjection';
import { getOrganizationTimezone } from './orderDueDateService';
import { getInvoiceEmailStatuses } from '../invoicesService';
import { getInvoiceAccountingApprovalState } from '../lib/invoiceAccountingApproval';
import { normalizeInvoiceAccountingDisplay } from '@shared/invoiceAccountingDisplay';
import {
  getAccountsReceivableAging,
  pageAccountsReceivableRows,
  qualifiesForAccountsReceivable,
  summarizeAccountsReceivable,
  type AccountsReceivableRow,
  type AccountsReceivableSummary,
  type ArAgingBucket,
} from '@shared/accountsReceivableReport';

export type AccountsReceivableFilters = {
  customerId?: string;
  agingBucket?: ArAgingBucket;
  invoiceStatus?: string;
  sendStatus?: 'never_sent' | 'sent' | 'updated_after_sent';
  jobStatus?: 'open' | 'complete';
};

export type AccountsReceivableSort = 'customer' | 'invoiceNumber' | 'orderNumber' | 'issueDate' | 'dueDate' | 'daysPastDue' | 'invoiceStatus' | 'sendStatus' | 'total' | 'paid' | 'balance';
export type AccountsReceivableReport = { asOf: string; rows: AccountsReceivableRow[]; pageRows: AccountsReceivableRow[]; summary: AccountsReceivableSummary; page: number; pageSize: number; totalCount: number; totalPages: number; filters: AccountsReceivableFilters; };

function calendarDateInTimezone(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function isoDate(value: Date | string | null | undefined, timezone: string): string | null {
  if (!value) return null;
  // Database date values represent a business calendar day, not midnight UTC.
  // Preserve an ISO date string verbatim before applying timezone conversion to timestamps.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return calendarDateInTimezone(new Date(value), timezone);
}

function mapSendStatus(status: string | undefined): AccountsReceivableRow['sendStatus'] {
  if (status === 'sent_outdated') return 'Updated After Sent';
  if (status === 'sent_current') return 'Sent';
  return 'Never Sent';
}

function mapJobStatus(order: any): AccountsReceivableRow['jobStatus'] {
  if (!order?.id) return 'no linked order';
  const state = String(order.state || '').toLowerCase();
  const fulfillment = String(order.fulfillmentStatus || '').toLowerCase();
  return state === 'closed' || state === 'canceled' || ['shipped', 'delivered'].includes(fulfillment) ? 'complete' : 'open';
}

function sortRows(rows: AccountsReceivableRow[], sortBy: AccountsReceivableSort, sortDir: 'asc' | 'desc') {
  const multiplier = sortDir === 'asc' ? 1 : -1;
  const key = (row: AccountsReceivableRow): string | number => {
    switch (sortBy) {
      case 'customer': return row.customerName || '';
      case 'invoiceNumber': return row.invoiceNumber;
      case 'orderNumber': return row.orderNumber || '';
      case 'issueDate': return row.issueDate || '9999-12-31';
      case 'dueDate': return row.dueDate || '9999-12-31';
      case 'daysPastDue': return row.daysPastDue ?? -1;
      case 'invoiceStatus': return row.invoiceStatus;
      case 'sendStatus': return row.sendStatus;
      case 'total': return row.totalCents;
      case 'paid': return row.paidCents;
      case 'balance': return row.remainingCents;
      default: return row.dueDate || '9999-12-31';
    }
  };
  return [...rows].sort((left, right) => String(key(left)).localeCompare(String(key(right)), undefined, { numeric: true }) * multiplier);
}

async function paymentRowsByInvoice(organizationId: string, invoiceIds: string[]) {
  const result = new Map<string, any[]>();
  if (invoiceIds.length === 0) return result;
  for (let index = 0; index < invoiceIds.length; index += 500) {
    const batch = invoiceIds.slice(index, index + 500);
    const rows = await db.select().from(payments).where(and(eq(payments.organizationId, organizationId), inArray(payments.invoiceId, batch)));
    for (const payment of rows) result.set(payment.invoiceId, [...(result.get(payment.invoiceId) || []), payment]);
  }
  return result;
}

/** Canonical, read-only A/R projection. The same filtered rows drive screen, summary, and exports. */
export async function getAccountsReceivableReport(input: { organizationId: string; filters?: AccountsReceivableFilters; sortBy?: AccountsReceivableSort; sortDir?: 'asc' | 'desc'; page?: number; pageSize?: number; now?: Date }): Promise<AccountsReceivableReport> {
  const filters = input.filters ?? {};
  const [timezone, sourceRows] = await Promise.all([
    getOrganizationTimezone(input.organizationId),
    db.select({ invoice: invoices, customer: customers, order: orders, contact: customerContacts })
      .from(invoices)
      .leftJoin(orders, and(eq(orders.id, invoices.orderId), eq(orders.organizationId, input.organizationId)))
      .leftJoin(customers, and(eq(customers.id, canonicalInvoiceCustomerId), eq(customers.organizationId, input.organizationId)))
      .leftJoin(customerContacts, and(eq(customerContacts.id, orders.contactId), eq(customerContacts.organizationId, input.organizationId)))
      .where(eq(invoices.organizationId, input.organizationId)),
  ]);
  const asOf = calendarDateInTimezone(input.now ?? new Date(), timezone);
  const invoiceIds = sourceRows.map((row) => row.invoice.id);
  const [paymentsByInvoice, emailStatuses] = await Promise.all([
    paymentRowsByInvoice(input.organizationId, invoiceIds),
    getInvoiceEmailStatuses(sourceRows.map((row) => ({ id: row.invoice.id, invoiceVersion: row.invoice.invoiceVersion, lastSentVersion: row.invoice.lastSentVersion })), input.organizationId),
  ]);
  const rows: AccountsReceivableRow[] = [];
  for (const source of sourceRows) {
    const invoice = source.invoice;
    const accountingApproval = getInvoiceAccountingApprovalState(invoice as any);
    const display = normalizeInvoiceAccountingDisplay({ ...(invoice as any), payments: paymentsByInvoice.get(invoice.id) || [] });
    if (!qualifiesForAccountsReceivable({
      accountingApproval,
      invoiceWorkflowStatus: invoice.status,
      remainingCents: display.remainingCents,
      creditCents: display.creditCents,
      displayStatus: display.displayStatus,
    })) continue;
    const emailStatus = emailStatuses.get(invoice.id);
    const sendStatus = mapSendStatus(emailStatus?.emailStatus);
    const aging = getAccountsReceivableAging(isoDate(invoice.dueDate, timezone), asOf);
    const row: AccountsReceivableRow = {
      id: invoice.id, customerId: source.customer?.id ?? null, customerName: source.customer?.companyName ?? null,
      contactName: [source.contact?.firstName, source.contact?.lastName].filter(Boolean).join(' ') || null,
      invoiceNumber: invoice.displayNumber || invoice.qbDocNumber || String(invoice.invoiceNumber), orderId: source.order?.id ?? null,
      orderNumber: source.order?.displayNumber || (source.order?.orderNumber != null ? String(source.order.orderNumber) : null),
      jobName: source.order?.label ?? null, purchaseOrderNumber: invoice.customerPoNumber || source.order?.poNumber || null,
      issueDate: isoDate(invoice.issuedAt || invoice.issueDate, timezone), dueDate: isoDate(invoice.dueDate, timezone), ...aging,
      invoiceStatus: display.displayStatus, approvalStatus: 'Approved', sendStatus, terms: invoice.customTerms || invoice.terms,
      totalCents: display.totalCents, paidCents: display.paidCents, remainingCents: display.remainingCents,
      lastSentAt: emailStatus?.lastSentAt ? new Date(emailStatus.lastSentAt).toISOString() : null, qbSyncStatus: invoice.qbSyncStatus || invoice.syncStatus || 'not_synced', jobStatus: mapJobStatus(source.order),
    };
    if (filters.customerId && row.customerId !== filters.customerId) continue;
    if (filters.agingBucket && row.agingBucket !== filters.agingBucket) continue;
    if (filters.invoiceStatus && filters.invoiceStatus !== 'all' && row.invoiceStatus.toLowerCase().replace(/\s+/g, '_') !== filters.invoiceStatus) continue;
    if (filters.sendStatus && row.sendStatus !== mapSendStatus(filters.sendStatus === 'never_sent' ? 'not_sent' : filters.sendStatus === 'updated_after_sent' ? 'sent_outdated' : 'sent_current')) continue;
    if (filters.jobStatus && row.jobStatus !== filters.jobStatus) continue;
    rows.push(row);
  }
  const sorted = sortRows(rows, input.sortBy ?? 'dueDate', input.sortDir ?? 'asc');
  const pageSize = Math.min(Math.max(input.pageSize ?? 50, 1), 200);
  const page = Math.max(input.page ?? 1, 1);
  return { asOf, rows: sorted, pageRows: pageAccountsReceivableRows(sorted, page, pageSize), summary: summarizeAccountsReceivable(sorted), page, pageSize, totalCount: sorted.length, totalPages: Math.max(1, Math.ceil(sorted.length / pageSize)), filters };
}
