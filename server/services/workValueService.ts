import { READY_TO_FINALIZE_JOB_STATUSES, READY_TO_FINALIZE_SEND_STATUS } from "@shared/invoiceReadyToFinalize";
import { listInvoicesPageForOrganization, type InvoiceListColumnFilters } from "../invoicesService";
import { projectActiveProductionValueContributions } from "../lib/activeProductionValue";
import { buildWorkValueSummary, centsSummary, filterActiveWorkValueRows, groupActiveOrderRows, workValueDueWindow, type WorkValueFilters, type WorkValuePage, type WorkValueRow } from "../lib/workValueProjection";
import { getOrganizationTimezone } from "./orderDueDateService";
import { listActiveProductionValueCandidates } from "./activeProductionValueService";

const PAGE_SIZE = 50;
const readyToFinalizeFilters: InvoiceListColumnFilters = {
  jobStatus: [...READY_TO_FINALIZE_JOB_STATUSES],
  sendStatus: READY_TO_FINALIZE_SEND_STATUS,
};
export async function getWorkValuePage(organizationId: string, filters: WorkValueFilters, now = new Date()): Promise<WorkValuePage> {
  const [candidates, completeSummaryPage, timezone] = await Promise.all([
    listActiveProductionValueCandidates(organizationId),
    listInvoicesPageForOrganization({ organizationId, includePaidHistorical: false, includeCanceled: false, columnFilters: readyToFinalizeFilters, limit: 1 }),
    getOrganizationTimezone(organizationId),
  ]);
  const byLineId = new Map(candidates.map((line) => [line.id, line]));
  const activeLineRows: WorkValueRow[] = projectActiveProductionValueContributions(organizationId, candidates).map((entry) => {
    const line = byLineId.get(entry.lineId)!;
    return {
      id: entry.lineId, kind: "order", status: entry.bucket === "new" ? "New" : "In Production",
      orderId: entry.orderId, orderNumber: line.orderNumber, lineDescription: line.lineDescription,
      customerId: line.customerId, customerName: line.customerName, poNumber: line.poNumber,
      jobLabel: line.jobLabel, dueDate: line.dueDate, invoiceId: null, invoiceNumber: null,
      valueCents: entry.valueCents,
    };
  });
  const activeRows = groupActiveOrderRows(activeLineRows);
  const summary = buildWorkValueSummary(activeRows, { count: completeSummaryPage.totalCount, valueCents: completeSummaryPage.totalValueCents });

  if (filters.status !== "complete_not_sent") {
    const matching = filterActiveWorkValueRows(activeRows, filters, now, timezone);
    const filtered = centsSummary(matching);
    const offset = (filters.page - 1) * PAGE_SIZE;
    return { summary, rows: matching.slice(offset, offset + PAGE_SIZE), filtered, pagination: { page: filters.page, pageSize: PAGE_SIZE, totalPages: Math.max(1, Math.ceil(filtered.count / PAGE_SIZE)) } };
  }

  const { from, toExclusive } = workValueDueWindow(filters, now, timezone);
  const invoicePage = await listInvoicesPageForOrganization({
    organizationId, includePaidHistorical: false, includeCanceled: false,
    columnFilters: {
      ...readyToFinalizeFilters,
      ...(from ? { dueDateFrom: new Date(`${from}T00:00:00Z`) } : {}),
      ...(toExclusive ? { dueDateToExclusive: new Date(`${toExclusive}T00:00:00Z`) } : {}),
    },
    customerId: filters.customerId,
    search: filters.search,
    sortBy: "issueDate", sortDir: "desc",
    limit: PAGE_SIZE, offset: (filters.page - 1) * PAGE_SIZE,
  });
  return {
    summary,
    rows: invoicePage.items.map((invoice) => ({
      id: invoice.id, kind: "invoice" as const, status: "Complete, Not Sent" as const,
      orderId: invoice.orderId, orderNumber: invoice.orderNumber, lineDescription: null,
      customerId: invoice.effectiveCustomerId, customerName: invoice.customerName, poNumber: invoice.purchaseOrderNumber,
      jobLabel: invoice.jobName, dueDate: invoice.dueDate?.toISOString?.() ?? (invoice.dueDate ? String(invoice.dueDate) : null),
      invoiceId: invoice.id, invoiceNumber: invoice.displayNumber ?? String(invoice.invoiceNumber),
      valueCents: invoice.totalCents,
    })),
    filtered: { count: invoicePage.totalCount, valueCents: invoicePage.totalValueCents },
    pagination: { page: filters.page, pageSize: PAGE_SIZE, totalPages: invoicePage.totalPages },
  };
}
