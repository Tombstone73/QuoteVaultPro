import { assistantInvoiceFilterTotalInputSchema, assistantInvoiceFilterTotalResultSchema, type AssistantToolResultEnvelope } from '@shared/assistantContracts';
import { READY_TO_FINALIZE_JOB_STATUSES, READY_TO_FINALIZE_SEND_STATUS } from '@shared/invoiceReadyToFinalize';
import { listInvoicesPageForOrganization, type EnrichedInvoiceListItem, type ListInvoicesForOrganizationOptions } from '../../invoicesService';
import { invoiceListColumnFilters, invoiceListQueryBoolean, invoiceListQueryIds, invoiceListQueryValues } from '../../invoiceListFilters';
import type { AssistantToolAdapters, AssistantTrustedToolContext } from './toolRegistry';

const statusValues = ['draft', 'finalized', 'sent', 'unpaid', 'partially_paid', 'credit', 'paid', 'paid_historical', 'overdue', 'billed', 'void'] as const;
const supportedFilters = new Set(['status', 'includePaidHistorical', 'includeCanceled', 'customerId', 'customerIds', 'search',
  'customer', 'contact', 'jobName', 'purchaseOrderNumber', 'columnOrderNumber', 'invoiceNumber', 'accountingApproval',
  'issueDateFrom', 'issueDateTo', 'dueDateFrom', 'dueDateTo', 'sendStatus', 'lastSent', 'totalMin', 'totalMax',
  'paidMin', 'paidMax', 'balanceMin', 'balanceMax', 'jobStatus', 'excludeCustomerId', 'excludeCustomerIds', 'sortBy', 'sortDir']);

function currentPageFilters(context: AssistantTrustedToolContext): Record<string, string> {
  if (context.context.route !== '/invoices') throw new Error('The current Invoice list is unavailable. Open Invoices and retry.');
  return Object.fromEntries(context.context.activeFilters.filter(row => supportedFilters.has(row.key)).map(row => [row.key, row.value]));
}

function invoiceOptions(organizationId: string, filters: Record<string, string>): ListInvoicesForOrganizationOptions {
  const statuses = invoiceListQueryValues(filters.status, statusValues, 'status');
  return {
    organizationId, includePaidHistorical: invoiceListQueryBoolean(filters.includePaidHistorical, 'includePaidHistorical'),
    includeCanceled: invoiceListQueryBoolean(filters.includeCanceled, 'includeCanceled'),
    ...(statuses?.length === 1 ? { status: statuses[0] } : {}),
    ...(statuses && statuses.length > 1 ? { statuses } : {}),
    customerId: filters.customerId, customerIds: invoiceListQueryIds(filters.customerIds),
    search: filters.search, sortBy: filters.sortBy, sortDir: filters.sortDir,
    columnFilters: invoiceListColumnFilters(filters),
  };
}

function sumRows(rows: EnrichedInvoiceListItem[]) {
  const byCurrency = new Map<string, { count: number; cents: bigint }>();
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const currency = row.currency;
    const prior = byCurrency.get(currency) ?? { count: 0, cents: BigInt(0) };
    byCurrency.set(currency, { count: prior.count + 1, cents: prior.cents + BigInt(row.totalCents) });
  }
  return Array.from(byCurrency).sort(([left], [right]) => left.localeCompare(right)).map(([currency, value]) => {
    const totalCents = Number(value.cents);
    if (!Number.isSafeInteger(totalCents)) throw new Error('Invoice total exceeds safe integer cents');
    return { currency, count: value.count, totalCents };
  });
}

export function createAssistantInvoiceFilterTotalToolAdapters(deps: { listPage?: typeof listInvoicesPageForOrganization } = {}): AssistantToolAdapters {
  const listPage = deps.listPage ?? listInvoicesPageForOrganization;
  return { 'analytics.invoice_filter_total': { async execute(raw, context): Promise<AssistantToolResultEnvelope> {
    const input = assistantInvoiceFilterTotalInputSchema.parse(raw);
    if (!context.permissions.includes('finance.read') && !context.permissions.includes('finance:read'))
      throw new Error('Finance read permission is required.');
    if (input.scope === 'named_filter' && input.namedFilter !== 'ready_to_finalize') throw new Error('Choose a supported named Invoice filter.');
    const filters = input.scope === 'named_filter'
      ? { jobStatus: READY_TO_FINALIZE_JOB_STATUSES.join(','), sendStatus: READY_TO_FINALIZE_SEND_STATUS }
      : currentPageFilters(context);
    const options = invoiceOptions(context.scope.organizationId, filters);
    const page = Number(context.context.activeFilters.find(row => row.key === 'page')?.value ?? 1);
    const pageSize = Number(context.context.activeFilters.find(row => row.key === 'pageSize')?.value ?? 50);
    const boundedPage = Number.isSafeInteger(page) && page > 0 ? page : 1;
    const boundedSize = [25, 50, 100].includes(pageSize) ? pageSize : 50;
    const selected = input.scope === 'selected_rows' ? context.context.selectedRecordIds : undefined;
    const result = await listPage({ ...options, ...(selected ? { invoiceIds: selected } : {}),
      limit: input.scope === 'current_page' ? boundedSize : 1,
      offset: input.scope === 'current_page' ? (boundedPage - 1) * boundedSize : 0 });
    const totalsByCurrency = input.scope === 'current_page' ? sumRows(result.items) : result.totalsByCurrency;
    const count = totalsByCurrency.reduce((sum, row) => sum + row.count, 0);
    const params = new URLSearchParams(Object.entries(filters));
    if (input.scope === 'current_page') { params.set('page', String(boundedPage)); params.set('pageSize', String(boundedSize)); }
    const sourceLink = { label: input.scope === 'named_filter' ? 'Invoices · Ready to Finalize' : 'Filtered Invoice list',
      href: `/invoices${params.size ? `?${params.toString()}` : ''}` };
    const data = assistantInvoiceFilterTotalResultSchema.parse({ scope: input.scope,
      filterLabel: input.scope === 'named_filter' ? 'Ready to finalize' : input.scope === 'current_page' ? 'current Invoice page'
        : input.scope === 'selected_rows' ? 'selected Invoice rows' : 'current filtered Invoices',
      metric: 'invoice_total', count, totalsByCurrency, sourceLink });
    const capturedAt = new Date().toISOString();
    return { status: 'succeeded', data, provenance: { sourceLinks: [{ ...sourceLink, capturedAt }], freshness: { capturedAt } } };
  } } };
}
