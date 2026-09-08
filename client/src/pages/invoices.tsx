import { Fragment, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronLeft, ChevronRight, Eye, Filter, Plus, FileText, Mail, RotateCcw, Settings2, ShieldCheck, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useApproveInvoicesForAccounting, useBatchSendInvoices, useInvoiceEmailQueue, useInvoicesPage, useResolveInvoiceEmailDeliveryReview, type InvoiceEmailStatus, type InvoiceListColumnFilterQuery, type InvoiceListItem } from "@/hooks/useInvoices";
import { useToast } from "@/hooks/use-toast";
import { endOfMonth, format, startOfMonth, subDays, subMonths } from "date-fns";
import { ROUTES } from "@/config/routes";
import { canTakePaymentFromInvoiceList, getInvoiceListTakePaymentPath } from "@/lib/invoiceListPayment";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getNextInvoiceSortState, type InvoiceSortKey } from "@/lib/invoiceListSort";
import { getInvoiceTotalsVisible, setInvoiceTotalsVisible } from "@/lib/invoiceDashboardPreferences";
import { INVOICE_LIST_COLUMN_FILTER_PARAM_KEYS, parseInvoiceListUrlState, updateInvoiceListUrlState } from "@/lib/invoiceListUrlState";
import { DEFAULT_INVOICE_LIST_SORT_PREFERENCES, clearPersistedInvoiceListSortPreferences, persistInvoiceListSortPreferences, readPersistedInvoiceListSortPreferences } from "@/lib/invoiceListSortPreferences";
import { CustomerSelect } from "@/components/CustomerSelect";
import { useTableColumnConfig, type ColumnConfig } from "@/hooks/useTableColumnConfig";
import {
  Page,
  PageHeader,
  ContentLayout,
  DataCard,
  TitanSearchInput,
  TitanTableContainer,
  TitanTable,
  TitanTableHeader,
  TitanTableHead,
  TitanTableBody,
  TitanTableRow,
  TitanTableCell,
  TitanTableEmpty,
  TitanTableLoading,
  StatusPill,
  getStatusVariant,
} from "@/components/titan";
import { resolveDocumentDisplayNumber } from "@shared/documentNumbering";
import { InvoiceEmailSendDialog } from "@/components/invoices/InvoiceEmailSendDialog";
import { canCloseJobOverride, CloseJobOverrideDialog, type CloseJobOverrideTarget, getOrderJobStatus } from "@/components/orders/CloseJobOverrideDialog";
import { OrderNumberLink } from "@/components/orders/OrderNumberLink";

const EMPTY_VALUE = "\u2014";

const GLOBAL_INVOICE_COLUMNS: ColumnConfig[] = [
  { id: "select", label: "Select", visible: true, order: 0, locked: true },
  { id: "customer", label: "Customer", visible: true, order: 1 },
  { id: "contact", label: "Contact", visible: true, order: 2 },
  { id: "jobName", label: "Job / Order Name", visible: true, order: 3 },
  { id: "purchaseOrderNumber", label: "PO #", visible: true, order: 4 },
  { id: "orderNumber", label: "Order #", visible: true, order: 5 },
  { id: "invoiceNumber", label: "Invoice #", visible: true, order: 6, required: true },
  { id: "issueDate", label: "Issue Date", visible: true, order: 7 },
  { id: "dueDate", label: "Due Date", visible: true, order: 8 },
  { id: "status", label: "Invoice Status", visible: true, order: 9 },
  { id: "approval", label: "Approval", visible: true, order: 10 },
  { id: "jobStatus", label: "Job Status", visible: true, order: 11 },
  { id: "lastSentAt", label: "Last Sent", visible: true, order: 12 },
  { id: "total", label: "Total", visible: true, order: 13 },
  { id: "paid", label: "Paid", visible: true, order: 14 },
  { id: "balance", label: "Balance", visible: true, order: 15 },
  { id: "actions", label: "Actions", visible: true, order: 16, locked: true },
];

const statusLabels: Record<string, string> = {
  draft: "Draft",
  finalized: "Finalized",
  sent: "Sent",
  partially_paid: "Partially Paid",
  credit: "Credit / Refund Due",
  paid: "Paid",
  overdue: "Overdue",
  billed: "Billed",
  void: "Void",
};

const emailStatusMeta: Record<InvoiceEmailStatus, { label: string; variant: "muted" | "info" | "warning" }> = {
  not_sent: { label: "Not Sent", variant: "muted" },
  sent_current: { label: "Sent", variant: "info" },
  sent_outdated: { label: "Updated After Sent", variant: "warning" },
};

const deliveryStatusMeta = {
  queued: { label: "Queued", variant: "info" },
  processing: { label: "Sending", variant: "warning" },
  retrying: { label: "Retrying", variant: "warning" },
  failed: { label: "Delivery Failed", variant: "error" },
  needs_review: { label: "Needs Review", variant: "warning" },
  sent: { label: "Sent", variant: "info" },
  canceled: { label: "Delivery Canceled", variant: "muted" },
} as const;

const columnFilterLabels: Record<keyof InvoiceListColumnFilterQuery, string> = {
  customer: "Customer",
  contact: "Contact",
  jobName: "Job / Order",
  purchaseOrderNumber: "PO #",
  columnOrderNumber: "Order #",
  invoiceNumber: "Invoice #",
  issueDateFrom: "Issue from",
  issueDateTo: "Issue to",
  dueDateFrom: "Due from",
  dueDateTo: "Due to",
  sendStatus: "Send Status",
  lastSent: "Last sent",
  totalMin: "Total min",
  totalMax: "Total max",
  paidMin: "Paid min",
  paidMax: "Paid max",
  balanceMin: "Balance min",
  balanceMax: "Balance max",
  jobStatus: "Jobs",
  excludeCustomerId: "Excluding",
};

export default function InvoicesListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const [sortPreferenceRevision, setSortPreferenceRevision] = useState(0);
  const listState = useMemo(() => parseInvoiceListUrlState(searchParams), [searchParams]);
  const { search, status: statusFilter, customerId, customerName, excludeCustomerName, issueDatePreset: storedIssueDatePreset, hasExplicitSort, page, pageSize, columnFilters } = listState;
  const invoiceTableConfig = useTableColumnConfig(
    `global_invoices:org_${user?.lastActiveOrgId ?? "unknown"}:user_${user?.id ?? "anonymous"}`,
    GLOBAL_INVOICE_COLUMNS,
  );
  const visibleColumns = invoiceTableConfig.columns.filter((column) => column.visible);
  const preferredSort = useMemo(
    () => user?.id
      ? readPersistedInvoiceListSortPreferences(user.id, user.lastActiveOrgId ?? null)
      : DEFAULT_INVOICE_LIST_SORT_PREFERENCES,
    [sortPreferenceRevision, user?.id, user?.lastActiveOrgId],
  );
  const sortKey = hasExplicitSort ? listState.sortKey : preferredSort.sortKey;
  const sortDir = hasExplicitSort ? listState.sortDir : preferredSort.sortDir;
  const updateListState = (changes: Record<string, string | undefined>, resetPage = false) => {
    setSearchParams((current) => updateInvoiceListUrlState(current, changes, resetPage), { replace: true });
  };
  const setPage = (nextPage: number | ((current: number) => number)) => {
    const resolved = typeof nextPage === "function" ? nextPage(page) : nextPage;
    updateListState({ page: resolved > 1 ? String(resolved) : undefined });
  };
  const setPageSize = (nextPageSize: number) => updateListState({ pageSize: String(nextPageSize) }, true);
  const setSearch = (nextSearch: string) => updateListState({ search: nextSearch }, true);
  const setStatusFilter = (nextStatus: string) => updateListState({ status: nextStatus === "all" ? undefined : nextStatus }, true);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(() => new Set());
  const [showTotals, setShowTotals] = useState(getInvoiceTotalsVisible);
  const [emailQueueOpen, setEmailQueueOpen] = useState(false);
  const [emailQueueView, setEmailQueueView] = useState<'active' | 'failed' | 'sent' | 'all'>('active');
  const [emailQueuePage, setEmailQueuePage] = useState(1);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [quickSendInvoice, setQuickSendInvoice] = useState<{ id: string; label: string } | null>(null);
  const [needsReviewPromptJob, setNeedsReviewPromptJob] = useState<{ id: string; invoiceId: string; label: string } | null>(null);
  const [reviewJob, setReviewJob] = useState<{ id: string; invoiceId: string; label: string; source: 'direct' | 'queue' } | null>(null);
  const [approvingInvoiceId, setApprovingInvoiceId] = useState<string | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<CloseJobOverrideTarget | null>(null);

  const { data: invoiceResponse, isLoading, isError, error } = useInvoicesPage({
    status: statusFilter !== "all" ? statusFilter : undefined,
    search: search.trim() || undefined,
    sortBy: sortKey,
    sortDir,
    page,
    pageSize,
    ...columnFilters,
  });

  const isAdminOrOwner = user?.isAdmin || user?.role === 'owner' || user?.role === 'admin';
  const batchSendInvoices = useBatchSendInvoices();
  const resolveEmailDeliveryReview = useResolveInvoiceEmailDeliveryReview();
  const emailQueue = useInvoiceEmailQueue(emailQueueOpen, emailQueueView, emailQueuePage);
  const approveInvoices = useApproveInvoicesForAccounting();

  const formatCurrency = (amount: string | number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(Number(amount));
  };

  const formatDate = (dateString: string | Date | null) => {
    if (!dateString) return EMPTY_VALUE;
    try {
      return format(new Date(dateString), "MMM d, yyyy");
    } catch {
      return EMPTY_VALUE;
    }
  };

  const filteredInvoices = invoiceResponse?.items || [];
  const pagination = invoiceResponse?.pagination;
  const summary = invoiceResponse?.summary;
  const totalCount = pagination?.totalCount ?? 0;
  const totalPages = pagination?.totalPages ?? 1;
  const currentPage = pagination?.page ?? page;
  const accountingApprovableInvoices = filteredInvoices.filter((invoice) => {
    const status = String(invoice.status || "").toLowerCase();
    return !["void", "canceled", "cancelled"].includes(status)
      && String((invoice as any).importSource || "").toLowerCase() !== "quickbooks"
      && !(invoice as any).isHistorical;
  });
  const selectedCount = selectedInvoiceIds.size;
  const allVisibleApprovableSelected = accountingApprovableInvoices.length > 0 && accountingApprovableInvoices.every((invoice) => selectedInvoiceIds.has(invoice.id));
  const activeColumnFilters = (Object.entries(columnFilters) as Array<[keyof InvoiceListColumnFilterQuery, string | undefined]>)
    .filter(([key, value]) => Boolean(value) && key !== "excludeCustomerId");
  const activeFilters = [
    search ? { key: "search", label: "Search", value: search } : null,
    statusFilter !== "all" ? { key: "status", label: "Status", value: statusLabels[statusFilter] || statusFilter } : null,
    customerId ? { key: "customerId", label: "Customer", value: customerName || "Selected customer" } : null,
    columnFilters.excludeCustomerId ? { key: "excludeCustomerId", label: "Excluding", value: excludeCustomerName || "Selected customer" } : null,
    ...activeColumnFilters.map(([key, value]) => ({ key, label: columnFilterLabels[key], value: String(value) })),
  ].filter(Boolean) as Array<{ key: string; label: string; value: string }>;

  const setColumnFilter = (key: keyof InvoiceListColumnFilterQuery, value: string) => {
    updateListState({
      [key]: value || undefined,
      ...(key === "issueDateFrom" || key === "issueDateTo" ? { issueDatePreset: undefined } : {}),
    }, true);
  };

  const clearAllFilters = () => {
    updateListState({
      search: undefined,
      status: undefined,
      customerId: undefined,
      customerName: undefined,
      excludeCustomerName: undefined,
      issueDatePreset: undefined,
      ...Object.fromEntries(INVOICE_LIST_COLUMN_FILTER_PARAM_KEYS.map((key) => [key, undefined])),
    }, true);
  };

  const clearActiveFilter = (key: string) => {
    if (key === "search") return updateListState({ search: undefined }, true);
    if (key === "status") return updateListState({ status: undefined }, true);
    if (key === "customerId") return updateListState({ customerId: undefined, customerName: undefined }, true);
    if (key === "excludeCustomerId") return updateListState({ excludeCustomerId: undefined, excludeCustomerName: undefined }, true);
    setColumnFilter(key as keyof InvoiceListColumnFilterQuery, "");
  };

  const setCustomerFilter = (nextCustomerId: string | null, customer?: { companyName?: string | null; email?: string | null }) => {
    updateListState({
      customerId: nextCustomerId || undefined,
      customerName: nextCustomerId ? customer?.companyName || customer?.email || "Selected customer" : undefined,
    }, true);
  };

  const setExcludedCustomerFilter = (nextCustomerId: string | null, customer?: { companyName?: string | null; email?: string | null }) => {
    updateListState({
      excludeCustomerId: nextCustomerId || undefined,
      excludeCustomerName: nextCustomerId ? customer?.companyName || customer?.email || "Selected customer" : undefined,
    }, true);
  };

  const issueDatePreset = (() => {
    if (storedIssueDatePreset === "custom") return "custom";
    const today = new Date();
    const matches = (from?: string, to?: string) => columnFilters.issueDateFrom === from && columnFilters.issueDateTo === to;
    if (!columnFilters.issueDateFrom && !columnFilters.issueDateTo) return "all";
    if (matches(format(today, "yyyy-MM-dd"), format(today, "yyyy-MM-dd"))) return "today";
    if (matches(format(subDays(today, 6), "yyyy-MM-dd"), format(today, "yyyy-MM-dd"))) return "last_7_days";
    if (matches(format(subDays(today, 29), "yyyy-MM-dd"), format(today, "yyyy-MM-dd"))) return "last_30_days";
    if (matches(format(startOfMonth(today), "yyyy-MM-dd"), format(endOfMonth(today), "yyyy-MM-dd"))) return "this_month";
    const previousMonth = subMonths(today, 1);
    if (matches(format(startOfMonth(previousMonth), "yyyy-MM-dd"), format(endOfMonth(previousMonth), "yyyy-MM-dd"))) return "last_month";
    return "custom";
  })();

  const setIssueDatePreset = (preset: string) => {
    const today = new Date();
    const dateRange = (from?: Date, to?: Date) => updateListState({
      issueDateFrom: from ? format(from, "yyyy-MM-dd") : undefined,
      issueDateTo: to ? format(to, "yyyy-MM-dd") : undefined,
      issueDatePreset: undefined,
    }, true);
    if (preset === "custom") {
      updateListState({ issueDatePreset: "custom" });
      return;
    }
    if (preset === "all") dateRange();
    if (preset === "today") dateRange(today, today);
    if (preset === "last_7_days") dateRange(subDays(today, 6), today);
    if (preset === "last_30_days") dateRange(subDays(today, 29), today);
    if (preset === "this_month") dateRange(startOfMonth(today), endOfMonth(today));
    if (preset === "last_month") {
      const previousMonth = subMonths(today, 1);
      dateRange(startOfMonth(previousMonth), endOfMonth(previousMonth));
    }
  };

  const toggleTotals = () => {
    setShowTotals((visible) => {
      const next = !visible;
      setInvoiceTotalsVisible(next);
      return next;
    });
  };

  const handleSort = (key: InvoiceSortKey) => {
    const next = getNextInvoiceSortState({ sortKey, sortDir }, key);
    if (user?.id) {
      persistInvoiceListSortPreferences(user.id, user.lastActiveOrgId ?? null, { version: 1, sortKey: next.sortKey, sortDir: next.sortDir });
      setSortPreferenceRevision((current) => current + 1);
    }
    updateListState({ sortBy: next.sortKey, sortDir: next.sortDir }, true);
  };

  const resetSort = () => {
    if (user?.id) {
      clearPersistedInvoiceListSortPreferences(user.id, user.lastActiveOrgId ?? null);
      setSortPreferenceRevision((current) => current + 1);
    }
    updateListState({ sortBy: undefined, sortDir: undefined }, true);
  };

  const resetTable = () => {
    invoiceTableConfig.reset();
    resetSort();
  };

  const hasNonDefaultSort = hasExplicitSort
    || sortKey !== DEFAULT_INVOICE_LIST_SORT_PREFERENCES.sortKey
    || sortDir !== DEFAULT_INVOICE_LIST_SORT_PREFERENCES.sortDir;

  const renderSortIcon = (key: InvoiceSortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />;
    return sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />;
  };

  const renderSortableHead = (key: InvoiceSortKey, label: string, className = "") => (
    <TitanTableHead
      className={`cursor-pointer select-none transition-colors hover:bg-muted/60 focus-within:bg-muted/60 ${className}`}
      aria-sort={sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        className="flex min-h-8 w-full items-center gap-1 rounded-sm px-1 py-1 text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Sort by ${label} ${sortKey === key && sortDir === "asc" ? "descending" : "ascending"}`}
        onClick={() => handleSort(key)}
      >
        <span className="truncate">{label}</span>
        {renderSortIcon(key)}
      </button>
    </TitanTableHead>
  );

  const textOrEmpty = (value: unknown) => {
    const text = String(value ?? "").trim();
    return text || EMPTY_VALUE;
  };

  const toggleSelected = (invoiceId: string, checked: boolean) => {
    setSelectedInvoiceIds((current) => {
      const next = new Set(current);
      if (checked) next.add(invoiceId);
      else next.delete(invoiceId);
      return next;
    });
  };

  const toggleAllVisible = (checked: boolean) => {
    setSelectedInvoiceIds((current) => {
      const next = new Set(current);
      accountingApprovableInvoices.forEach((invoice) => {
        if (checked) next.add(invoice.id);
        else next.delete(invoice.id);
      });
      return next;
    });
  };

  const handleBatchSend = async () => {
    const invoiceIds = Array.from(selectedInvoiceIds);
    if (invoiceIds.length === 0) return;

    try {
      const idempotencyKey = crypto.randomUUID();
      const preview = (await batchSendInvoices.mutateAsync({ invoiceIds, dryRun: true, idempotencyKey })).data;
      const confirmation = [
        `${preview.selected} selected; ${preview.eligible} eligible for delivery.`,
        preview.recipientGroups ? `${preview.recipientGroups} recipient group${preview.recipientGroups === 1 ? '' : 's'} resolved.` : 'No recipient email is available for the selected invoices.',
        preview.unapprovedCount ? `${preview.unapprovedCount} invoice${preview.unapprovedCount === 1 ? ' is' : 's are'} not approved for accounting. Choosing OK will queue those invoices with an explicit Send Anyway override; they will remain Not Approved.` : '',
        preview.skipped.length ? `${preview.skipped.length} will be skipped by the normal invoice email rules.` : '',
        'Emails will be added to the Email Queue and sent approximately 1 minute apart.',
      ].filter(Boolean).join('\n\n');
      if (!window.confirm(confirmation)) return;

      const result = await batchSendInvoices.mutateAsync({ invoiceIds, idempotencyKey, allowUnapproved: preview.unapprovedCount > 0 });
      const summary = result.data;
      toast({
        title: "Invoice delivery queued",
        description: `${summary.queued || 0} queued${summary.alreadyQueued ? summary.blocked?.some((job) => job.status === 'needs_review') ? `, ${summary.alreadyQueued} needs review` : `, ${summary.alreadyQueued} already active` : ''}${summary.skipped.length ? `, ${summary.skipped.length} skipped` : ''}.`,
      });
      setSelectedInvoiceIds(new Set());
    } catch (error: any) {
      toast({ title: "Batch queue failed", description: error.message, variant: "destructive" });
    }
  };

  const getEmailDeliveryStatus = (invoice: { emailDeliveryStatus?: string | null; emailStatus: InvoiceEmailStatus }) => {
    const queueStatus = String(invoice.emailDeliveryStatus || "").toLowerCase() as keyof typeof deliveryStatusMeta;
    return queueStatus && deliveryStatusMeta[queueStatus]
      ? deliveryStatusMeta[queueStatus]
      : emailStatusMeta[invoice.emailStatus];
  };
  const queueStatusLabel = (status: string) => deliveryStatusMeta[status as keyof typeof deliveryStatusMeta]?.label || status;

  const handleQuickSend = (invoice: InvoiceListItem) => {
    if (invoice.emailDeliveryStatus === 'needs_review' && invoice.emailDeliveryJobId) {
      setNeedsReviewPromptJob({ id: invoice.emailDeliveryJobId, invoiceId: invoice.id, label: String(invoice.invoiceNumber || invoice.id) });
      return;
    }
    setQuickSendInvoice({ id: invoice.id, label: String(invoice.invoiceNumber || invoice.id) });
  };

  const confirmVerifiedNotSent = async (retryThroughQueue = false) => {
    if (!reviewJob) return;
    try {
      const completedReview = reviewJob;
      const result = await resolveEmailDeliveryReview.mutateAsync({ jobId: reviewJob.id, retryThroughQueue });
      setReviewJob(null);
      setNeedsReviewPromptJob(null);
      if (!retryThroughQueue && completedReview.source === 'direct') {
        setQuickSendInvoice({ id: completedReview.invoiceId, label: completedReview.label });
      } else {
        setEmailQueueView('active');
        setEmailQueuePage(1);
        setEmailQueueOpen(true);
      }
      toast({
        title: result.replayed ? 'Delivery review already resolved' : retryThroughQueue ? 'Replacement delivery queued' : 'Delivery review resolved',
        description: result.replayed ? 'The original review record remains in history.' : retryThroughQueue ? 'The original review record was retained and one new delivery job is queued.' : 'No email was queued or sent. You may now send directly or choose a queue retry.',
      });
    } catch (error: any) {
      toast({ title: 'Delivery review failed', description: error.message, variant: 'destructive' });
    }
  };

  const approvalState = (invoice: any) => {
    const currentVersion = Number(invoice.invoiceVersion || 1);
    if (invoice.accountingApprovedAt && !invoice.accountingApprovalRevokedAt && Number(invoice.accountingApprovedVersion || 0) === currentVersion) return 'Approved for Accounting';
    if (invoice.accountingApprovalRevokedAt || (invoice.accountingApprovedAt && Number(invoice.accountingApprovedVersion || 0) !== currentVersion)) return 'Needs Reapproval';
    return 'Not Approved';
  };

  const handleApproveSelected = async () => {
    const ids = Array.from(selectedInvoiceIds);
    if (!ids.length) return;
    try {
      const response = await approveInvoices.mutateAsync(ids);
      const result = response.data || response;
      toast({ title: 'Accounting approval updated', description: `${result.approved || 0} approved${result.skipped ? `, ${result.skipped} skipped` : ''}.` });
      setSelectedInvoiceIds(new Set());
    } catch (error: any) {
      toast({ title: 'Accounting approval failed', description: error.message, variant: 'destructive' });
    }
  };

  const handleApproveInvoice = async (invoice: InvoiceListItem) => {
    if (approveInvoices.isPending) return;

    setApprovingInvoiceId(invoice.id);
    try {
      await approveInvoices.mutateAsync([invoice.id]);
      toast({ title: 'Approved for Accounting' });
    } catch (error: any) {
      toast({ title: 'Accounting approval failed', description: error.message, variant: 'destructive' });
    } finally {
      setApprovingInvoiceId(null);
    }
  };

  const renderInvoiceHead = (column: ColumnConfig) => {
    switch (column.id) {
      case "select":
        return <TitanTableHead key={column.id} className="w-[44px]"><Checkbox checked={allVisibleApprovableSelected} onCheckedChange={(checked) => toggleAllVisible(checked === true)} aria-label="Select all visible accounting-approvable invoices" /></TitanTableHead>;
      case "customer": return <>{renderSortableHead("customer", column.label, "min-w-[180px] max-w-[220px]")}</>;
      case "contact": return <>{renderSortableHead("contact", column.label, "min-w-[150px] max-w-[190px]")}</>;
      case "jobName": return <>{renderSortableHead("jobName", column.label, "min-w-[180px] max-w-[240px]")}</>;
      case "purchaseOrderNumber": return <>{renderSortableHead("purchaseOrderNumber", column.label, "min-w-[110px] max-w-[140px]")}</>;
      case "orderNumber": return <>{renderSortableHead("orderNumber", column.label, "min-w-[110px] max-w-[140px]")}</>;
      case "invoiceNumber": return <>{renderSortableHead("invoiceNumber", column.label, "min-w-[120px] max-w-[150px]")}</>;
      case "issueDate": return <>{renderSortableHead("issueDate", column.label, "min-w-[120px]")}</>;
      case "dueDate": return <>{renderSortableHead("dueDate", column.label, "min-w-[120px]")}</>;
      case "status": return <>{renderSortableHead("status", column.label, "min-w-[130px]")}</>;
      case "approval": return <>{renderSortableHead("approval", column.label, "w-[116px] min-w-[116px]")}</>;
      case "jobStatus": return <>{renderSortableHead("jobStatus", column.label, "min-w-[145px]")}</>;
      case "lastSentAt": return <>{renderSortableHead("lastSentAt", column.label, "min-w-[140px]")}</>;
      case "total": return <>{renderSortableHead("total", column.label, "min-w-[110px] text-right")}</>;
      case "paid": return <>{renderSortableHead("paid", column.label, "min-w-[100px] text-right")}</>;
      case "balance": return <>{renderSortableHead("balance", column.label, "min-w-[110px] text-right")}</>;
      case "actions": return <TitanTableHead key={column.id} className="sticky right-0 z-10 min-w-[310px] bg-background text-center">Actions</TitanTableHead>;
      default: return null;
    }
  };

  const renderInvoiceCell = (invoice: InvoiceListItem, column: ColumnConfig) => {
    switch (column.id) {
      case "select": return <TitanTableCell key={column.id} onClick={(event) => event.stopPropagation()}><Checkbox checked={selectedInvoiceIds.has(invoice.id)} disabled={["void", "canceled", "cancelled"].includes(String(invoice.status || "").toLowerCase()) || String((invoice as any).importSource || "").toLowerCase() === "quickbooks" || Boolean((invoice as any).isHistorical)} onCheckedChange={(checked) => toggleSelected(invoice.id, checked === true)} aria-label={`Select invoice ${invoice.invoiceNumber}`} /></TitanTableCell>;
      case "customer": return <TitanTableCell key={column.id} className="max-w-[220px]"><div className="truncate font-medium" title={textOrEmpty(invoice.customerName || invoice.companyName)}>{textOrEmpty(invoice.customerName || invoice.companyName)}</div></TitanTableCell>;
      case "contact": return <TitanTableCell key={column.id} className="max-w-[190px]"><div className="truncate" title={textOrEmpty(invoice.contactName)}>{textOrEmpty(invoice.contactName)}</div>{invoice.contactEmail && <div className="truncate text-xs text-muted-foreground" title={invoice.contactEmail}>{invoice.contactEmail}</div>}</TitanTableCell>;
      case "jobName": return <TitanTableCell key={column.id} className="max-w-[240px]"><div className="truncate" title={textOrEmpty(invoice.jobName || invoice.orderName)}>{textOrEmpty(invoice.jobName || invoice.orderName)}</div></TitanTableCell>;
      case "purchaseOrderNumber": return <TitanTableCell key={column.id} className="max-w-[140px]"><div className="truncate" title={textOrEmpty(invoice.purchaseOrderNumber)}>{textOrEmpty(invoice.purchaseOrderNumber)}</div></TitanTableCell>;
      case "orderNumber": return <TitanTableCell key={column.id} className="max-w-[140px]"><div className="truncate" title={textOrEmpty(invoice.orderNumber)}><OrderNumberLink orderId={invoice.orderId} orderNumber={invoice.orderNumber} /></div></TitanTableCell>;
      case "invoiceNumber": return <TitanTableCell key={column.id} className="font-medium"><Link to={`/invoices/${invoice.id}`} className="text-titan-accent hover:underline" onClick={(event) => event.stopPropagation()}>{resolveDocumentDisplayNumber({ displayNumber: (invoice as any).displayNumber, numberCore: (invoice as any).numberCore, legacyNumber: invoice.invoiceNumber }) || invoice.invoiceNumber}</Link></TitanTableCell>;
      case "issueDate": return <TitanTableCell key={column.id}>{formatDate(invoice.issueDate)}</TitanTableCell>;
      case "dueDate": return <TitanTableCell key={column.id}>{formatDate(invoice.dueDate)}</TitanTableCell>;
      case "status": return <TitanTableCell key={column.id}><StatusPill variant={getStatusVariant(invoice.status)}>{invoice.displayStatus || statusLabels[invoice.status] || invoice.status}</StatusPill></TitanTableCell>;
      case "approval": return <TitanTableCell key={column.id} className="w-[116px] min-w-[116px]" onClick={(event) => event.stopPropagation()}>{approvalState(invoice) === "Approved for Accounting" ? <StatusPill variant="info">Approved</StatusPill> : isAdminOrOwner ? <Button type="button" variant="outline" size="sm" className="h-7 whitespace-nowrap px-2 text-xs" aria-label={`Approve invoice ${invoice.invoiceNumber} for accounting`} disabled={approveInvoices.isPending} onClick={(event) => { event.stopPropagation(); void handleApproveInvoice(invoice); }}><Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{approvingInvoiceId === invoice.id && approveInvoices.isPending ? "Approving…" : "Approve"}</Button> : <StatusPill variant={approvalState(invoice) === "Needs Reapproval" ? "warning" : "muted"}>Not Approved</StatusPill>}</TitanTableCell>;
      case "jobStatus": return <TitanTableCell key={column.id}>{getOrderJobStatus(invoice)}</TitanTableCell>;
      case "lastSentAt": return <TitanTableCell key={column.id}><div className="space-y-1"><div>{invoice.lastSentAt ? formatDate(invoice.lastSentAt) : EMPTY_VALUE}</div><span title={invoice.emailDeliveryStatus === "failed" ? invoice.emailDeliveryFailureReason || "Invoice delivery failed" : undefined}><StatusPill variant={getEmailDeliveryStatus(invoice).variant}>{getEmailDeliveryStatus(invoice).label}</StatusPill></span></div></TitanTableCell>;
      case "total": return <TitanTableCell key={column.id} className="text-right">{formatCurrency(invoice.displayTotal ?? invoice.total)}</TitanTableCell>;
      case "paid": return <TitanTableCell key={column.id} className="text-right">{formatCurrency(invoice.displayPaid ?? invoice.amountPaid)}</TitanTableCell>;
      case "balance": return <TitanTableCell key={column.id} className="text-right font-semibold">{formatCurrency(invoice.displayRemaining ?? invoice.balanceDue ?? Number(invoice.total) - Number(invoice.amountPaid))}</TitanTableCell>;
      case "actions": return <TitanTableCell key={column.id} className="sticky right-0 min-w-[310px] bg-background px-2" onClick={(event) => event.stopPropagation()}><TooltipProvider delayDuration={250}><div className="flex min-w-max flex-wrap items-center justify-start gap-1">{isAdminOrOwner && String((invoice as any).importSource || "").toLowerCase() !== "quickbooks" ? <Button variant="outline" size="sm" className="h-8 px-2" aria-label={`Send invoice ${invoice.invoiceNumber}`} disabled={batchSendInvoices.isPending} onClick={() => void handleQuickSend(invoice)}><Mail className="mr-1 h-4 w-4" aria-hidden="true" />{invoice.lastSentAt ? "Resend" : "Send"}</Button> : null}{canCloseJobOverride(invoice, Boolean(isAdminOrOwner)) ? <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => setOverrideTarget({ orderId: invoice.orderId!, orderNumber: invoice.orderNumber, jobName: invoice.jobName || invoice.orderName, purchaseOrderNumber: invoice.purchaseOrderNumber, customerName: invoice.companyName || invoice.customerName, invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, jobStatus: getOrderJobStatus(invoice) })}><ShieldCheck className="mr-1 h-4 w-4" aria-hidden="true" />Close Job Override</Button> : null}{canTakePaymentFromInvoiceList(invoice) ? <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="h-8 w-8 text-base font-semibold" aria-label={`Take payment for invoice ${invoice.invoiceNumber}`} onClick={() => navigate(getInvoiceListTakePaymentPath(invoice.id))}>$</Button></TooltipTrigger><TooltipContent>Take Payment</TooltipContent></Tooltip> : null}<Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="h-8 w-8" asChild><Link to={`/invoices/${invoice.id}`} aria-label={`View invoice ${invoice.invoiceNumber}`}><Eye className="h-4 w-4" /></Link></Button></TooltipTrigger><TooltipContent>View Invoice</TooltipContent></Tooltip></div></TooltipProvider></TitanTableCell>;
      default: return null;
    }
  };

  const renderPaginationControls = (position: "top" | "bottom") => (
    <>
      <div className="text-sm text-muted-foreground" aria-live="polite">
        {totalCount === 0 ? "0 invoices" : `${(currentPage - 1) * (pagination?.pageSize ?? pageSize) + 1}–${Math.min(currentPage * (pagination?.pageSize ?? pageSize), totalCount)} of ${totalCount} invoices`}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}>
          <SelectTrigger className="w-[132px]" aria-label={`Invoices per page (${position})`}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="25">25 per page</SelectItem><SelectItem value="50">50 per page</SelectItem><SelectItem value="100">100 per page</SelectItem></SelectContent>
        </Select>
        <Button type="button" variant="outline" size="sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={isLoading || currentPage <= 1} aria-label={`Previous invoice page (${position})`}><ChevronLeft className="h-4 w-4" /></Button>
        <span className="min-w-[92px] text-center text-sm text-muted-foreground">Page {currentPage} of {totalPages}</span>
        <Button type="button" variant="outline" size="sm" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={isLoading || currentPage >= totalPages} aria-label={`Next invoice page (${position})`}><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </>
  );

  const renderPagination = (position: "top" | "bottom") => (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`invoice-pagination-${position}`}>
      {renderPaginationControls(position)}
    </div>
  );

  return (
    <Page maxWidth="full">
      <PageHeader
        title="Invoices"
        subtitle="Manage invoices and payments"
        actions={
          isAdminOrOwner && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={handleBatchSend} disabled={selectedCount === 0 || batchSendInvoices.isPending}>
                <Mail className="mr-2 h-4 w-4" />
                {batchSendInvoices.isPending ? "Preparing..." : `Send Selected${selectedCount ? ` (${selectedCount})` : ""}`}
              </Button>
              <Button variant="outline" onClick={handleApproveSelected} disabled={selectedCount === 0 || approveInvoices.isPending}>
                {approveInvoices.isPending ? 'Approving…' : `Approve Selected${selectedCount ? ` (${selectedCount})` : ''}`}
              </Button>
              <Button asChild>
                <Link to={ROUTES.orders.list}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create from Order
                </Link>
              </Button>
            </div>
          )
        }
      />

      <ContentLayout>
        {showTotals && (
          <div className="grid divide-y rounded-titan-lg border border-titan-border-subtle bg-titan-bg-card shadow-titan-card sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4" data-testid="invoice-summary-strip">
            <div className="px-3 py-2.5"><div className="text-xs font-medium text-titan-text-muted">Total Outstanding</div><div className="mt-0.5 text-lg font-bold text-titan-text-primary">{summary ? formatCurrency(summary.totalOutstandingCents / 100) : EMPTY_VALUE}</div></div>
            <div className="px-3 py-2.5"><div className="text-xs font-medium text-titan-text-muted">Overdue</div><div className="mt-0.5 text-lg font-bold text-titan-text-primary">{summary?.overdueCount ?? EMPTY_VALUE}</div></div>
            <div className="px-3 py-2.5"><div className="text-xs font-medium text-titan-text-muted">Paid This Month</div><div className="mt-0.5 text-lg font-bold text-titan-text-primary">{summary ? formatCurrency(summary.paidThisMonthCents / 100) : EMPTY_VALUE}</div></div>
            <div className="px-3 py-2.5"><div className="text-xs font-medium text-titan-text-muted">Total Invoices</div><div className="mt-0.5 text-lg font-bold text-titan-text-primary">{summary?.totalInvoices ?? EMPTY_VALUE}</div></div>
          </div>
        )}
        {isError && (
          <DataCard className="border-destructive/40 text-sm text-destructive" role="alert">
            {error instanceof Error ? error.message : "Invoice dashboard data could not be loaded."}
          </DataCard>
        )}

        <DataCard noPadding>
          <div className="flex flex-wrap items-center gap-2 p-3" data-testid="invoice-toolbar">
            <TitanSearchInput
              placeholder="Search invoice, customer, contact, order, PO, or job..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
              containerClassName="min-w-[16rem] max-w-xl flex-1 basis-[22rem]"
            />
            <Select value={statusFilter} onValueChange={(nextStatus) => {
              setStatusFilter(nextStatus);
            }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="draft">Needs Review / Drafts</SelectItem>
                <SelectItem value="finalized">Finalized</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="partially_paid">Partially Paid</SelectItem>
                <SelectItem value="credit">Credit / Refund Due</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="billed">Billed</SelectItem>
                <SelectItem value="void">Void</SelectItem>
              </SelectContent>
            </Select>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" className="gap-2">
                  <Filter className="h-4 w-4" />
                  Filters{activeFilters.length ? ` (${activeFilters.length})` : ""}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[min(680px,calc(100vw-2rem))] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto overscroll-contain"
                align="end"
                collisionPadding={16}
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">Column filters</div>
                    <p className="text-xs text-muted-foreground">Filters compose with global search and apply across every invoice page.</p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={clearAllFilters} disabled={activeFilters.length === 0}>Clear all</Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <CustomerSelect value={customerId || null} onChange={setCustomerFilter} autoFocus={false} label="Customer / Company" placeholder="All customers" />
                  <CustomerSelect value={columnFilters.excludeCustomerId || null} onChange={setExcludedCustomerFilter} autoFocus={false} label="Exclude customer" placeholder="Do not exclude a customer" />
                  <label className="grid gap-1 text-sm"><span>Customer / Company contains</span><Input value={columnFilters.customer || ""} onChange={(event) => setColumnFilter("customer", event.target.value)} placeholder="e.g. Acme" /></label>
                  <label className="grid gap-1 text-sm"><span>Contact</span><Input value={columnFilters.contact || ""} onChange={(event) => setColumnFilter("contact", event.target.value)} placeholder="Name or email" /></label>
                  <label className="grid gap-1 text-sm"><span>Job / Order Name</span><Input value={columnFilters.jobName || ""} onChange={(event) => setColumnFilter("jobName", event.target.value)} /></label>
                  <label className="grid gap-1 text-sm"><span>PO #</span><Input value={columnFilters.purchaseOrderNumber || ""} onChange={(event) => setColumnFilter("purchaseOrderNumber", event.target.value)} /></label>
                  <label className="grid gap-1 text-sm"><span>Order #</span><Input value={columnFilters.columnOrderNumber || ""} onChange={(event) => setColumnFilter("columnOrderNumber", event.target.value)} /></label>
                  <label className="grid gap-1 text-sm"><span>Invoice #</span><Input value={columnFilters.invoiceNumber || ""} onChange={(event) => setColumnFilter("invoiceNumber", event.target.value)} /></label>
                  <label className="grid gap-1 text-sm"><span>Issue date</span><Select value={issueDatePreset} onValueChange={setIssueDatePreset}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Dates</SelectItem><SelectItem value="today">Today</SelectItem><SelectItem value="last_7_days">Last 7 Days</SelectItem><SelectItem value="last_30_days">Last 30 Days</SelectItem><SelectItem value="this_month">This Month</SelectItem><SelectItem value="last_month">Last Month</SelectItem><SelectItem value="custom">Custom Range</SelectItem></SelectContent></Select></label>
                  <label className="grid gap-1 text-sm"><span>Issue date from</span><Input type="date" value={columnFilters.issueDateFrom || ""} onChange={(event) => setColumnFilter("issueDateFrom", event.target.value)} /></label>
                  <label className="grid gap-1 text-sm"><span>Issue date to</span><Input type="date" value={columnFilters.issueDateTo || ""} onChange={(event) => setColumnFilter("issueDateTo", event.target.value)} /></label>
                  <label className="grid gap-1 text-sm"><span>Due date from</span><Input type="date" value={columnFilters.dueDateFrom || ""} onChange={(event) => setColumnFilter("dueDateFrom", event.target.value)} /></label>
                  <label className="grid gap-1 text-sm"><span>Due date to</span><Input type="date" value={columnFilters.dueDateTo || ""} onChange={(event) => setColumnFilter("dueDateTo", event.target.value)} /></label>
                  <label className="grid gap-1 text-sm"><span>Send Status</span><Select value={columnFilters.sendStatus || "all"} onValueChange={(value) => setColumnFilter("sendStatus", value === "all" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="never_sent">Never Sent</SelectItem><SelectItem value="sent">Sent</SelectItem><SelectItem value="updated_after_sent">Updated After Sent</SelectItem></SelectContent></Select></label>
                  <label className="grid gap-1 text-sm"><span>Jobs</span><Select value={columnFilters.jobStatus || "all"} onValueChange={(value) => setColumnFilter("jobStatus", value === "all" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Jobs</SelectItem><SelectItem value="open">Open Jobs</SelectItem><SelectItem value="complete">Complete Jobs</SelectItem></SelectContent></Select></label>
                </div>
                <div className="mt-4 border-t pt-4">
                  <div className="mb-2 text-sm font-medium">Amount ranges</div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="grid gap-1 text-sm"><span>Total min</span><Input inputMode="decimal" value={columnFilters.totalMin || ""} onChange={(event) => setColumnFilter("totalMin", event.target.value)} placeholder="$0.00" /></label>
                    <label className="grid gap-1 text-sm"><span>Total max</span><Input inputMode="decimal" value={columnFilters.totalMax || ""} onChange={(event) => setColumnFilter("totalMax", event.target.value)} placeholder="$0.00" /></label>
                    <div className="hidden sm:block" />
                    <label className="grid gap-1 text-sm"><span>Paid min</span><Input inputMode="decimal" value={columnFilters.paidMin || ""} onChange={(event) => setColumnFilter("paidMin", event.target.value)} placeholder="$0.00" /></label>
                    <label className="grid gap-1 text-sm"><span>Paid max</span><Input inputMode="decimal" value={columnFilters.paidMax || ""} onChange={(event) => setColumnFilter("paidMax", event.target.value)} placeholder="$0.00" /></label>
                    <div className="hidden sm:block" />
                    <label className="grid gap-1 text-sm"><span>Balance min</span><Input inputMode="decimal" value={columnFilters.balanceMin || ""} onChange={(event) => setColumnFilter("balanceMin", event.target.value)} placeholder="$0.00" /></label>
                    <label className="grid gap-1 text-sm"><span>Balance max</span><Input inputMode="decimal" value={columnFilters.balanceMax || ""} onChange={(event) => setColumnFilter("balanceMax", event.target.value)} placeholder="$0.00" /></label>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            <Button type="button" variant="outline" size="sm" className="gap-2" onClick={resetSort} disabled={!hasNonDefaultSort} aria-label="Reset global Invoice sort preference">
              <RotateCcw className="h-4 w-4" />Reset sort
            </Button>
            <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => setColumnsOpen(true)} aria-label="Configure global Invoice columns">
              <Settings2 className="h-4 w-4" />Columns
            </Button>
            <Button
              type="button"
              variant={showTotals ? "secondary" : "outline"}
              size="sm"
              aria-pressed={showTotals}
              onClick={toggleTotals}
            >
              Totals
            </Button>
            {isAdminOrOwner ? <Button type="button" variant="outline" size="sm" onClick={() => setEmailQueueOpen(true)} data-testid="invoice-email-queue-open">
              <Mail className="mr-2 h-4 w-4" />Email Queue{emailQueue.data?.counts.active ? ` (${emailQueue.data.counts.active})` : emailQueue.data?.counts.needsReview ? ` (${emailQueue.data.counts.needsReview} review)` : emailQueue.data?.counts.failed ? ` (${emailQueue.data.counts.failed})` : ''}
            </Button> : null}
            <div className="ml-auto flex flex-wrap items-center gap-2" data-testid="invoice-pagination-top">
              <Select value={columnFilters.accountingApproval || "all"} onValueChange={(value) => setColumnFilter("accountingApproval", value === "all" ? "" : value)}>
                <SelectTrigger className="w-[190px]" aria-label="Accounting approval filter"><SelectValue placeholder="Accounting approval" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All accounting approvals</SelectItem><SelectItem value="approved">Approved for Accounting</SelectItem><SelectItem value="not_approved">Not Approved</SelectItem><SelectItem value="needs_reapproval">Needs Reapproval</SelectItem></SelectContent>
              </Select>
              {renderPaginationControls("top")}
            </div>
          </div>
          {activeFilters.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-titan-border-subtle px-3 pb-3 pt-2" aria-label="Active invoice column filters">
              {activeFilters.map(({ key, label, value }) => (
                <Button key={key} type="button" variant="secondary" size="sm" className="h-7 gap-1" onClick={() => clearActiveFilter(key)}>
                  {label}: {value} <X className="h-3 w-3" />
                </Button>
              ))}
              <Button type="button" variant="ghost" size="sm" className="h-7" onClick={clearAllFilters}>Clear all</Button>
            </div>
          )}
        </DataCard>

        {/* Invoices Table */}
        <TitanTableContainer>
          <TitanTable>
            <TitanTableHeader>
              <TitanTableRow>{visibleColumns.map((column) => <Fragment key={column.id}>{renderInvoiceHead(column)}</Fragment>)}</TitanTableRow>
            </TitanTableHeader>
            <TitanTableBody>
              {isLoading && <TitanTableLoading colSpan={visibleColumns.length} message="Loading invoices..." />}
              {!isLoading && filteredInvoices.length === 0 && <TitanTableEmpty colSpan={visibleColumns.length} icon={<FileText className="h-12 w-12" />} message="No invoices found" action={isAdminOrOwner ? <Button variant="outline" size="sm" asChild><Link to={ROUTES.orders.list}><Plus className="mr-2 h-4 w-4" />Create from Order</Link></Button> : undefined} />}
              {!isLoading && filteredInvoices.map((invoice) => <TitanTableRow key={invoice.id} clickable onClick={() => navigate(`/invoices/${invoice.id}`)}>{visibleColumns.map((column) => renderInvoiceCell(invoice, column))}</TitanTableRow>)}
            </TitanTableBody>
            {false && <>
            <TitanTableHeader>
              <TitanTableRow>
                <TitanTableHead className="w-[44px]">
                  <Checkbox
                    checked={allVisibleApprovableSelected}
                    onCheckedChange={(checked) => toggleAllVisible(checked === true)}
                    aria-label="Select all visible accounting-approvable invoices"
                  />
                </TitanTableHead>
                {renderSortableHead("customer", "Customer", "min-w-[180px] max-w-[220px]")}
                {renderSortableHead("contact", "Contact", "min-w-[150px] max-w-[190px]")}
                <TitanTableHead className="min-w-[180px] max-w-[240px]">Job / Order Name</TitanTableHead>
                {renderSortableHead("purchaseOrderNumber", "PO #", "min-w-[110px] max-w-[140px]")}
                {renderSortableHead("orderNumber", "Order #", "min-w-[110px] max-w-[140px]")}
                {renderSortableHead("invoiceNumber", "Invoice #", "min-w-[120px] max-w-[150px]")}
                {renderSortableHead("issueDate", "Issue Date", "min-w-[120px]")}
                {renderSortableHead("dueDate", "Due Date", "min-w-[120px]")}
                {renderSortableHead("status", "Status", "min-w-[130px]")}
                <TitanTableHead className="w-[116px] min-w-[116px]">Approved</TitanTableHead>
                <TitanTableHead className="min-w-[145px]">Job Status</TitanTableHead>
                {renderSortableHead("lastSentAt", "Last Sent", "min-w-[140px]")}
                {renderSortableHead("total", "Total", "min-w-[110px] text-right")}
                <TitanTableHead className="min-w-[100px] text-right">Paid</TitanTableHead>
                {renderSortableHead("balance", "Balance", "min-w-[110px] text-right")}
                <TitanTableHead className="sticky right-0 z-10 min-w-[310px] bg-background text-center">Actions</TitanTableHead>
              </TitanTableRow>
            </TitanTableHeader>
            <TitanTableBody>
              {isLoading && <TitanTableLoading colSpan={17} message="Loading invoices..." />}
              
              {!isLoading && filteredInvoices.length === 0 && (
                <TitanTableEmpty
                  colSpan={17}
                  icon={<FileText className="w-12 h-12" />}
                  message="No invoices found"
                  action={
                    isAdminOrOwner && (
                      <Button variant="outline" size="sm" asChild>
                        <Link to={ROUTES.orders.list}>
                          <Plus className="w-4 h-4 mr-2" />
                          Create from Order
                        </Link>
                      </Button>
                    )
                  }
                />
              )}
              
              {!isLoading && filteredInvoices.map((invoice) => (
                <TitanTableRow
                  key={invoice.id}
                  clickable
                  onClick={() => navigate(`/invoices/${invoice.id}`)}
                >
                  <TitanTableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedInvoiceIds.has(invoice.id)}
                      disabled={["void", "canceled", "cancelled"].includes(String(invoice.status || "").toLowerCase()) || String((invoice as any).importSource || "").toLowerCase() === "quickbooks" || Boolean((invoice as any).isHistorical)}
                      onCheckedChange={(checked) => toggleSelected(invoice.id, checked === true)}
                      aria-label={`Select invoice ${invoice.invoiceNumber}`}
                    />
                  </TitanTableCell>
                  <TitanTableCell className="max-w-[220px]">
                    <div className="truncate font-medium" title={textOrEmpty(invoice.customerName || invoice.companyName)}>
                      {textOrEmpty(invoice.customerName || invoice.companyName)}
                    </div>
                  </TitanTableCell>
                  <TitanTableCell className="max-w-[190px]">
                    <div className="truncate" title={textOrEmpty(invoice.contactName)}>
                      {textOrEmpty(invoice.contactName)}
                    </div>
                    {invoice.contactEmail && (
                      <div className="truncate text-xs text-muted-foreground" title={invoice.contactEmail}>
                        {invoice.contactEmail}
                      </div>
                    )}
                  </TitanTableCell>
                  <TitanTableCell className="max-w-[240px]">
                    <div className="truncate" title={textOrEmpty(invoice.jobName || invoice.orderName)}>
                      {textOrEmpty(invoice.jobName || invoice.orderName)}
                    </div>
                  </TitanTableCell>
                  <TitanTableCell className="max-w-[140px]">
                    <div className="truncate" title={textOrEmpty(invoice.purchaseOrderNumber)}>
                      {textOrEmpty(invoice.purchaseOrderNumber)}
                    </div>
                  </TitanTableCell>
                  <TitanTableCell className="max-w-[140px]">
                    <div className="truncate" title={textOrEmpty(invoice.orderNumber)}>
                      {textOrEmpty(invoice.orderNumber)}
                    </div>
                  </TitanTableCell>
                  <TitanTableCell className="font-medium">
                    <Link
                      to={`/invoices/${invoice.id}`}
                      className="text-titan-accent hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {resolveDocumentDisplayNumber({
                        displayNumber: (invoice as any).displayNumber,
                        numberCore: (invoice as any).numberCore,
                        legacyNumber: invoice.invoiceNumber,
                      }) || invoice.invoiceNumber}
                    </Link>
                  </TitanTableCell>
                  <TitanTableCell>{formatDate(invoice.issueDate)}</TitanTableCell>
                  <TitanTableCell>{formatDate(invoice.dueDate)}</TitanTableCell>
                  <TitanTableCell>
                    <StatusPill variant={getStatusVariant(invoice.status)}>
                      {invoice.displayStatus || statusLabels[invoice.status] || invoice.status}
                    </StatusPill>
                  </TitanTableCell>
                  <TitanTableCell className="w-[116px] min-w-[116px]" onClick={(event) => event.stopPropagation()}>
                    {approvalState(invoice) === 'Approved for Accounting' ? (
                      <StatusPill variant="info">Approved</StatusPill>
                    ) : isAdminOrOwner ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 whitespace-nowrap px-2 text-xs"
                        aria-label={`Approve invoice ${invoice.invoiceNumber} for accounting`}
                        disabled={approveInvoices.isPending}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleApproveInvoice(invoice);
                        }}
                      >
                        <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{approvingInvoiceId === invoice.id && approveInvoices.isPending ? 'Approving…' : 'Approve'}
                      </Button>
                    ) : (
                      <StatusPill variant={approvalState(invoice) === 'Needs Reapproval' ? 'warning' : 'muted'}>Not Approved</StatusPill>
                    )}
                  </TitanTableCell>
                  <TitanTableCell>{getOrderJobStatus(invoice)}</TitanTableCell>
                  <TitanTableCell>
                    <div className="space-y-1">
                      <div>{invoice.lastSentAt ? formatDate(invoice.lastSentAt) : EMPTY_VALUE}</div>
                      <span title={invoice.emailDeliveryStatus === "failed" ? invoice.emailDeliveryFailureReason || "Invoice delivery failed" : undefined}>
                        <StatusPill variant={getEmailDeliveryStatus(invoice).variant}>
                          {getEmailDeliveryStatus(invoice).label}
                        </StatusPill>
                      </span>
                    </div>
                  </TitanTableCell>
                  <TitanTableCell className="text-right">{formatCurrency(invoice.displayTotal ?? invoice.total)}</TitanTableCell>
                  <TitanTableCell className="text-right">{formatCurrency(invoice.displayPaid ?? invoice.amountPaid)}</TitanTableCell>
                  <TitanTableCell className="text-right font-semibold">
                    {formatCurrency(invoice.displayRemaining ?? invoice.balanceDue ?? Number(invoice.total) - Number(invoice.amountPaid))}
                  </TitanTableCell>
                  <TitanTableCell className="sticky right-0 min-w-[310px] bg-background px-2" onClick={(e) => e.stopPropagation()}>
                    <TooltipProvider delayDuration={250}>
                    <div className="flex min-w-max flex-wrap items-center justify-start gap-1">
                      {isAdminOrOwner && String((invoice as any).importSource || "").toLowerCase() !== "quickbooks" ? <Button variant="outline" size="sm" className="h-8 px-2" aria-label={`Send invoice ${invoice.invoiceNumber}`} disabled={batchSendInvoices.isPending} onClick={() => void handleQuickSend(invoice)}><Mail className="mr-1 h-4 w-4" aria-hidden="true" />{invoice.lastSentAt ? "Resend" : "Send"}</Button> : null}
                      {canCloseJobOverride(invoice, Boolean(isAdminOrOwner)) ? <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => setOverrideTarget({ orderId: invoice.orderId!, orderNumber: invoice.orderNumber, jobName: invoice.jobName || invoice.orderName, purchaseOrderNumber: invoice.purchaseOrderNumber, customerName: invoice.companyName || invoice.customerName, invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, jobStatus: getOrderJobStatus(invoice) })}><ShieldCheck className="mr-1 h-4 w-4" aria-hidden="true" />Close Job Override</Button> : null}
                      {canTakePaymentFromInvoiceList(invoice) ? (
                        <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="h-8 w-8 text-base font-semibold" aria-label={`Take payment for invoice ${invoice.invoiceNumber}`} onClick={() => navigate(getInvoiceListTakePaymentPath(invoice.id))}>$</Button></TooltipTrigger><TooltipContent>Take Payment</TooltipContent></Tooltip>
                      ) : null}
                      <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" className="h-8 w-8" asChild><Link to={`/invoices/${invoice.id}`} aria-label={`View invoice ${invoice.invoiceNumber}`}><Eye className="h-4 w-4" /></Link></Button></TooltipTrigger><TooltipContent>View Invoice</TooltipContent></Tooltip>
                    </div>
                    </TooltipProvider>
                  </TitanTableCell>
                </TitanTableRow>
              ))}
            </TitanTableBody>
            </>}
          </TitanTable>
        </TitanTableContainer>

        {renderPagination("bottom")}
      </ContentLayout>
      <Dialog open={columnsOpen} onOpenChange={setColumnsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Global Invoice Columns</DialogTitle><DialogDescription>Choose the columns and order used by the Global Invoice backlog. This does not affect Customer Detail tables.</DialogDescription></DialogHeader>
          <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {invoiceTableConfig.columns.map((column) => (
              <div key={column.id} className="flex items-center gap-2 rounded border p-2">
                <Checkbox checked={column.visible} disabled={column.locked || column.required} onCheckedChange={(checked) => invoiceTableConfig.setColumnVisibility(column.id, checked === true)} aria-label={`Show ${column.label}`} />
                <span className="min-w-0 flex-1 truncate text-sm">{column.label}{column.locked || column.required ? " (required)" : ""}</span>
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={!invoiceTableConfig.canMoveColumn(column.id, "up")} onClick={() => invoiceTableConfig.moveColumn(column.id, "up")} aria-label={`Move ${column.label} up`}><ArrowUp className="h-4 w-4" /></Button>
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={!invoiceTableConfig.canMoveColumn(column.id, "down")} onClick={() => invoiceTableConfig.moveColumn(column.id, "down")} aria-label={`Move ${column.label} down`}><ArrowDown className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={resetTable}>Reset Table</Button><Button type="button" onClick={() => setColumnsOpen(false)}>Done</Button></div>
        </DialogContent>
      </Dialog>
      <Dialog open={emailQueueOpen} onOpenChange={setEmailQueueOpen}>
        <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col overflow-hidden">
          <DialogHeader><DialogTitle>Invoice Email Queue</DialogTitle><DialogDescription>Authoritative delivery jobs. Last Sent updates only after provider acceptance.</DialogDescription></DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={emailQueueView} onValueChange={(value: any) => { setEmailQueueView(value); setEmailQueuePage(1); }}><SelectTrigger className="w-[150px]" aria-label="Invoice email queue filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="failed">Failed</SelectItem><SelectItem value="sent">Sent / Recent</SelectItem><SelectItem value="all">All</SelectItem></SelectContent></Select>
            <span className="text-xs text-muted-foreground">{emailQueue.data ? `${emailQueue.data.counts.active} active · ${emailQueue.data.counts.failed} failed · ${emailQueue.data.counts.needsReview} needs review` : ''}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded border">
            <table className="w-full text-sm"><thead className="sticky top-0 bg-background"><tr className="border-b text-left"><th className="p-2">Invoice</th><th className="p-2">Recipient</th><th className="p-2">Status</th><th className="p-2">Timing</th><th className="p-2">Attempts</th><th className="p-2">Detail</th><th className="p-2" /></tr></thead><tbody>
              {emailQueue.isLoading ? <tr><td className="p-4" colSpan={7}>Loading queue…</td></tr> : emailQueue.data?.items.length ? emailQueue.data.items.map((job) => {
                const stale = job.status === 'processing' && job.claimedAt && Date.now() - new Date(job.claimedAt).getTime() > emailQueue.data.claimSeconds * 1000;
                const needsReview = job.status === 'needs_review';
                const retryable = job.status === 'failed';
                const reviewed = job.metadata?.deliveryReview;
                return <tr className="border-b align-top" key={job.id}>
                  <td className="p-2">{job.invoiceNumber || job.legacyInvoiceNumber || 'Invoice'}</td>
                  <td className="p-2 break-all">{job.recipientEmail}</td>
                  <td className="p-2"><StatusPill variant={retryable ? 'error' : needsReview || job.status === 'processing' || job.status === 'retrying' ? 'warning' : job.status === 'sent' ? 'info' : 'muted'}>{queueStatusLabel(job.status)}{retryable ? ' · Retryable' : ''}{stale ? ' · Stale' : ''}</StatusPill></td>
                  <td className="p-2 text-xs">{job.status === 'queued' ? `Scheduled ${format(new Date(job.availableAt), 'PP p')}` : `Queued ${format(new Date(job.queuedAt), 'PP p')}`}<br />{job.claimedAt ? `Claimed ${format(new Date(job.claimedAt), 'p')}` : job.status === 'queued' ? 'Waiting for its sender slot' : `Updated ${format(new Date(job.updatedAt), 'p')}`}</td>
                  <td className="p-2">{job.attemptCount} / {job.maxAttempts}</td>
                  <td className="max-w-[220px] p-2 text-xs text-muted-foreground">
                    {needsReview ? 'Delivery outcome uncertain. Retry blocked until reviewed. ' : retryable ? 'Safe to send again: ' : ''}
                    {job.failureReason || (stale ? 'No activity past the normal claim window.' : '—')}
                    {reviewed?.resolution === 'verified_not_sent' && reviewed.reviewedAt ? <><br />Reviewed {format(new Date(reviewed.reviewedAt), 'PP p')}{reviewed.reviewedByUserName ? ` by ${reviewed.reviewedByUserName}` : ''}. Operator verified email was not sent; retry allowed.</> : null}
                  </td>
                  <td className="p-2"><div className="flex gap-1">
                    {needsReview ? <Button variant="outline" size="sm" onClick={() => setReviewJob({ id: job.id, invoiceId: job.invoiceId, label: String(job.invoiceNumber || job.legacyInvoiceNumber || 'Invoice'), source: 'queue' })}>Review</Button> : null}
                    <Button variant="ghost" size="sm" onClick={() => { setEmailQueueOpen(false); navigate(`/invoices/${job.invoiceId}`); }}>Open</Button>
                  </div></td>
                </tr>;
              }) : <tr><td className="p-4 text-muted-foreground" colSpan={7}>No matching email delivery jobs.</td></tr>}
            </tbody></table>
          </div>
          {emailQueue.data ? <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Page {emailQueue.data.pagination.page} of {emailQueue.data.pagination.totalPages}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={emailQueuePage <= 1} onClick={() => setEmailQueuePage((page) => page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={emailQueuePage >= emailQueue.data.pagination.totalPages} onClick={() => setEmailQueuePage((page) => page + 1)}>Next</Button></div></div> : null}
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(needsReviewPromptJob)} onOpenChange={(open) => { if (!open) setNeedsReviewPromptJob(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Previous delivery needs review</DialogTitle><DialogDescription>We could not confirm whether the previous email for invoice {needsReviewPromptJob?.label} was delivered. Sending again could create a duplicate email.</DialogDescription></DialogHeader>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setNeedsReviewPromptJob(null)}>Cancel</Button><Button onClick={() => { setReviewJob({ ...needsReviewPromptJob!, source: 'direct' }); setNeedsReviewPromptJob(null); }}>Review Delivery</Button></div>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(reviewJob)} onOpenChange={(open) => { if (!open && !resolveEmailDeliveryReview.isPending) setReviewJob(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Resolve uncertain delivery</DialogTitle><DialogDescription>We could not confirm whether the previous email for invoice {reviewJob?.label} was delivered. Only continue if you verified it was not sent.</DialogDescription></DialogHeader>
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Sending again after an uncertain provider outcome can create a duplicate customer email.</p>
          <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={resolveEmailDeliveryReview.isPending} onClick={() => setReviewJob(null)}>Keep Blocked</Button><Button variant="outline" disabled={resolveEmailDeliveryReview.isPending} onClick={() => void confirmVerifiedNotSent()}>{resolveEmailDeliveryReview.isPending ? 'Resolving…' : 'I verified this email was not sent'}</Button><Button disabled={resolveEmailDeliveryReview.isPending} onClick={() => void confirmVerifiedNotSent(true)}>{resolveEmailDeliveryReview.isPending ? 'Queueing…' : 'Retry through Queue'}</Button></div>
        </DialogContent>
      </Dialog>
      {quickSendInvoice ? <InvoiceEmailSendDialog invoiceId={quickSendInvoice.id} open={Boolean(quickSendInvoice)} onOpenChange={(open) => { if (!open) setQuickSendInvoice(null); }} onSent={() => setQuickSendInvoice(null)} /> : null}
      <CloseJobOverrideDialog target={overrideTarget} onOpenChange={(open) => !open && setOverrideTarget(null)} />
    </Page>
  );
}
