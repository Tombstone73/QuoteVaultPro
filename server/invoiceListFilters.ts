import type { InvoiceListColumnFilters } from './invoicesService';

function invoiceListQueryText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 200) : undefined;
}

/** Accept legacy single-value query parameters as well as deterministic CSV or
 * repeated categorical values. Values are de-duplicated without manufacturing
 * an empty IN() predicate downstream. */
export function invoiceListQueryValues(value: unknown, allowed: readonly string[], label: string): string[] | undefined {
  const rawValues = Array.isArray(value) ? value : [value];
  const values = Array.from(new Set(rawValues.flatMap((item) => typeof item === 'string' ? item.split(',') : [])
    .map((item) => item.trim())
    .filter(Boolean)));
  if (values.some((item) => !allowed.includes(item))) {
    throw Object.assign(new Error(`Invalid ${label} filter`), { statusCode: 400 });
  }
  return values.length ? values : undefined;
}

export function invoiceListQueryIds(value: unknown): string[] | undefined {
  const rawValues = Array.isArray(value) ? value : [value];
  const values = Array.from(new Set(rawValues.flatMap((item) => typeof item === 'string' ? item.split(',') : [])
    .map((item) => item.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right));
  return values.length ? values : undefined;
}

function invoiceListQueryDate(value: unknown, boundary: 'start' | 'endExclusive'): Date | undefined {
  const raw = invoiceListQueryText(value);
  if (!raw) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw Object.assign(new Error('Invoice date filters must use YYYY-MM-DD'), { statusCode: 400 });
  const [year, month, day] = raw.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, day));
  if (start.getUTCFullYear() !== year || start.getUTCMonth() !== month - 1 || start.getUTCDate() !== day) {
    throw Object.assign(new Error('Invalid invoice date filter'), { statusCode: 400 });
  }
  return boundary === 'endExclusive' ? new Date(Date.UTC(year, month - 1, day + 1)) : start;
}

function invoiceListQueryCents(value: unknown): number | undefined {
  const raw = invoiceListQueryText(value);
  if (!raw) return undefined;
  const match = raw.match(/^(\d{1,12})(?:\.(\d{1,2}))?$/);
  if (!match) throw Object.assign(new Error('Invoice amount filters must be non-negative currency values'), { statusCode: 400 });
  const cents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0') || 0);
  if (!Number.isSafeInteger(cents)) throw Object.assign(new Error('Invoice amount filter is too large'), { statusCode: 400 });
  return cents;
}

export function invoiceListQueryBoolean(value: unknown, label: string): boolean {
  const raw = invoiceListQueryText(value);
  if (!raw || raw === '0') return false;
  if (raw === '1') return true;
  throw Object.assign(new Error(`${label} must be 0 or 1`), { statusCode: 400 });
}

export function invoiceListColumnFilters(query: Record<string, unknown>): InvoiceListColumnFilters {
  const accountingApproval = invoiceListQueryValues(query.accountingApproval, ['approved', 'not_approved', 'needs_reapproval'], 'accounting approval');
  const lastSent = invoiceListQueryText(query.lastSent);
  if (lastSent && lastSent !== 'sent' && lastSent !== 'not_sent') {
    throw Object.assign(new Error('Invalid Last Sent filter'), { statusCode: 400 });
  }
  const sendStatus = invoiceListQueryValues(query.sendStatus, ['never_sent', 'sent', 'updated_after_sent'], 'Send Status');
  const jobStatus = invoiceListQueryValues(query.jobStatus, ['open', 'complete', 'job_complete', 'new', 'in_production', 'on_hold', 'ready_for_shipment', 'production_complete', 'fulfillment_complete', 'closed', 'cancelled', 'no_linked_order'], 'Job Status');
  return {
    accountingApproval: accountingApproval as InvoiceListColumnFilters['accountingApproval'],
    customer: invoiceListQueryText(query.customer),
    contact: invoiceListQueryText(query.contact),
    jobName: invoiceListQueryText(query.jobName),
    purchaseOrderNumber: invoiceListQueryText(query.purchaseOrderNumber),
    orderNumber: invoiceListQueryText(query.columnOrderNumber),
    invoiceNumber: invoiceListQueryText(query.invoiceNumber),
    issueDateFrom: invoiceListQueryDate(query.issueDateFrom, 'start'),
    issueDateToExclusive: invoiceListQueryDate(query.issueDateTo, 'endExclusive'),
    dueDateFrom: invoiceListQueryDate(query.dueDateFrom, 'start'),
    dueDateToExclusive: invoiceListQueryDate(query.dueDateTo, 'endExclusive'),
    sendStatus: sendStatus as InvoiceListColumnFilters['sendStatus'],
    lastSent: lastSent as InvoiceListColumnFilters['lastSent'],
    totalMinCents: invoiceListQueryCents(query.totalMin),
    totalMaxCents: invoiceListQueryCents(query.totalMax),
    paidMinCents: invoiceListQueryCents(query.paidMin),
    paidMaxCents: invoiceListQueryCents(query.paidMax),
    balanceMinCents: invoiceListQueryCents(query.balanceMin),
    balanceMaxCents: invoiceListQueryCents(query.balanceMax),
    jobStatus: jobStatus as InvoiceListColumnFilters['jobStatus'],
    excludeCustomerId: invoiceListQueryText(query.excludeCustomerId),
    excludeCustomerIds: invoiceListQueryIds(query.excludeCustomerIds),
  };
}
