export type ArAgingBucket = 'current' | '1-30' | '31-60' | '61-90' | '90+' | 'no_due_date';

export type AccountsReceivableRow = {
  id: string;
  customerId: string | null;
  customerName: string | null;
  contactName: string | null;
  invoiceNumber: string;
  orderId: string | null;
  orderNumber: string | null;
  jobName: string | null;
  purchaseOrderNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  daysPastDue: number | null;
  agingBucket: ArAgingBucket;
  invoiceStatus: string;
  approvalStatus: 'Approved';
  sendStatus: 'Never Sent' | 'Sent' | 'Updated After Sent';
  terms: string;
  totalCents: number;
  paidCents: number;
  remainingCents: number;
  lastSentAt: string | null;
  qbSyncStatus: string;
  jobStatus: 'open' | 'complete' | 'no linked order';
};

export type AccountsReceivableSummary = {
  totalOutstandingCents: number;
  invoiceCount: number;
  overdueOutstandingCents: number;
  overdueInvoiceCount: number;
  agingCents: Record<ArAgingBucket, number>;
};

/**
 * Defines the report's financial inclusion rule independently of delivery and
 * fulfillment workflow.  Callers must provide the canonical financial state,
 * rather than relying on an invoice's persisted lifecycle label.
 */
export function qualifiesForAccountsReceivable(input: {
  accountingApproval: string;
  invoiceWorkflowStatus: string | null | undefined;
  remainingCents: number;
  creditCents: number;
  displayStatus: string;
}): boolean {
  if (input.accountingApproval !== 'approved') return false;
  if (['void', 'voided', 'canceled', 'cancelled'].includes(String(input.invoiceWorkflowStatus || '').toLowerCase())) return false;
  if (input.remainingCents <= 0 || input.creditCents > 0) return false;
  return input.displayStatus !== 'Paid Historical';
}

const MS_PER_DAY = 86_400_000;

function asUtcDay(value: string): number {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

export function getAccountsReceivableAging(dueDate: string | null | undefined, businessDate: string): Pick<AccountsReceivableRow, 'agingBucket' | 'daysPastDue'> {
  if (!dueDate) return { agingBucket: 'no_due_date', daysPastDue: null };
  const daysPastDue = Math.max(0, Math.floor((asUtcDay(businessDate) - asUtcDay(dueDate)) / MS_PER_DAY));
  if (daysPastDue === 0) return { agingBucket: 'current', daysPastDue };
  if (daysPastDue <= 30) return { agingBucket: '1-30', daysPastDue };
  if (daysPastDue <= 60) return { agingBucket: '31-60', daysPastDue };
  if (daysPastDue <= 90) return { agingBucket: '61-90', daysPastDue };
  return { agingBucket: '90+', daysPastDue };
}

export function summarizeAccountsReceivable(rows: AccountsReceivableRow[]): AccountsReceivableSummary {
  const agingCents: Record<ArAgingBucket, number> = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0, no_due_date: 0 };
  let totalOutstandingCents = 0;
  let overdueOutstandingCents = 0;
  let overdueInvoiceCount = 0;
  for (const row of rows) {
    totalOutstandingCents += row.remainingCents;
    agingCents[row.agingBucket] += row.remainingCents;
    if (isAccountsReceivableRowOverdue(row)) {
      overdueOutstandingCents += row.remainingCents;
      overdueInvoiceCount += 1;
    }
  }
  return { totalOutstandingCents, invoiceCount: rows.length, overdueOutstandingCents, overdueInvoiceCount, agingCents };
}

/** A/R rows already satisfy approval, balance, void, and historical rules. */
export function isAccountsReceivableRowOverdue(row: Pick<AccountsReceivableRow, 'dueDate' | 'daysPastDue'>): boolean {
  return Boolean(row.dueDate) && (row.daysPastDue ?? 0) > 0;
}

/** Browser payloads stay bounded; totals remain derived from the complete filtered result. */
export function pageAccountsReceivableRows<T>(rows: T[], page: number, pageSize: number): T[] {
  return rows.slice((Math.max(page, 1) - 1) * pageSize, Math.max(page, 1) * pageSize);
}
