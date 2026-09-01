import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Filter, Plus, FileText, DollarSign, Mail, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useBatchSendInvoices, useInvoicesPage, type InvoiceEmailStatus, type InvoiceListColumnFilterQuery } from "@/hooks/useInvoices";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ROUTES } from "@/config/routes";
import { canTakePaymentFromInvoiceList, getInvoiceListTakePaymentPath } from "@/lib/invoiceListPayment";
import { getNextInvoiceSortState, type InvoiceSortDir, type InvoiceSortKey } from "@/lib/invoiceListSort";
import {
  Page,
  PageHeader,
  ContentLayout,
  DataCard,
  TitanStatCard,
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

const EMPTY_VALUE = "\u2014";

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

const EMPTY_COLUMN_FILTERS: InvoiceListColumnFilterQuery = {};

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
  lastSent: "Last sent",
  totalMin: "Total min",
  totalMax: "Total max",
  paidMin: "Paid min",
  paidMax: "Paid max",
  balanceMin: "Balance min",
  balanceMax: "Balance max",
};

export default function InvoicesListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<InvoiceSortKey>("issueDate");
  const [sortDir, setSortDir] = useState<InvoiceSortDir>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [columnFilters, setColumnFilters] = useState<InvoiceListColumnFilterQuery>(EMPTY_COLUMN_FILTERS);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(() => new Set());

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
  const sendableInvoices = filteredInvoices.filter((invoice) => !["paid", "void"].includes(String(invoice.status || "").toLowerCase()));
  const selectedCount = selectedInvoiceIds.size;
  const allVisibleSendableSelected = sendableInvoices.length > 0 && sendableInvoices.every((invoice) => selectedInvoiceIds.has(invoice.id));
  const activeColumnFilters = (Object.entries(columnFilters) as Array<[keyof InvoiceListColumnFilterQuery, string | undefined]>).filter(([, value]) => Boolean(value));

  const setColumnFilter = (key: keyof InvoiceListColumnFilterQuery, value: string) => {
    setColumnFilters((current) => ({ ...current, [key]: value || undefined }));
    setPage(1);
  };

  const clearColumnFilters = () => {
    setColumnFilters(EMPTY_COLUMN_FILTERS);
    setPage(1);
  };

  const handleSort = (key: InvoiceSortKey) => {
    const next = getNextInvoiceSortState({ sortKey, sortDir }, key);
    setSortKey(next.sortKey);
    setSortDir(next.sortDir);
    setPage(1);
  };

  const renderSortIcon = (key: InvoiceSortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />;
    return sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />;
  };

  const renderSortableHead = (key: InvoiceSortKey, label: string, className = "") => (
    <TitanTableHead
      className={className}
      aria-sort={sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        className="flex w-full items-center gap-1 text-left font-medium"
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
      sendableInvoices.forEach((invoice) => {
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
        preview.skipped.length ? `${preview.skipped.length} will be skipped by the normal invoice email rules.` : '',
        'Emails will be queued and sent in a throttled background worker.',
      ].filter(Boolean).join('\n\n');
      if (!window.confirm(confirmation)) return;

      const result = await batchSendInvoices.mutateAsync({ invoiceIds, idempotencyKey });
      const summary = result.data;
      toast({
        title: "Invoice delivery queued",
        description: `${summary.queued || 0} queued${summary.alreadyQueued ? `, ${summary.alreadyQueued} already queued` : ''}${summary.skipped.length ? `, ${summary.skipped.length} skipped` : ''}.`,
      });
      setSelectedInvoiceIds(new Set());
    } catch (error: any) {
      toast({ title: "Batch queue failed", description: error.message, variant: "destructive" });
    }
  };

  const renderPagination = (position: "top" | "bottom") => (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`invoice-pagination-${position}`}>
      <div className="text-sm text-muted-foreground" aria-live="polite">
        {totalCount === 0 ? "0 invoices" : `${(currentPage - 1) * (pagination?.pageSize ?? pageSize) + 1}–${Math.min(currentPage * (pagination?.pageSize ?? pageSize), totalCount)} of ${totalCount} invoices`}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPage(1); }}>
          <SelectTrigger className="w-[132px]" aria-label={`Invoices per page (${position})`}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="25">25 per page</SelectItem><SelectItem value="50">50 per page</SelectItem><SelectItem value="100">100 per page</SelectItem></SelectContent>
        </Select>
        <Button type="button" variant="outline" size="sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={isLoading || currentPage <= 1} aria-label={`Previous invoice page (${position})`}><ChevronLeft className="h-4 w-4" /></Button>
        <span className="min-w-[92px] text-center text-sm text-muted-foreground">Page {currentPage} of {totalPages}</span>
        <Button type="button" variant="outline" size="sm" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={isLoading || currentPage >= totalPages} aria-label={`Next invoice page (${position})`}><ChevronRight className="h-4 w-4" /></Button>
      </div>
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
        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <TitanStatCard
            label="Total Outstanding"
            value={summary ? formatCurrency(summary.totalOutstandingCents / 100) : EMPTY_VALUE}
            icon={DollarSign}
          />
          <TitanStatCard
            label="Overdue"
            value={summary?.overdueCount ?? EMPTY_VALUE}
            icon={FileText}
          />
          <TitanStatCard
            label="Paid This Month"
            value={summary ? formatCurrency(summary.paidThisMonthCents / 100) : EMPTY_VALUE}
            icon={DollarSign}
          />
          <TitanStatCard
            label="Total Invoices"
            value={summary?.totalInvoices ?? EMPTY_VALUE}
            icon={FileText}
          />
        </div>
        {isError && (
          <DataCard className="border-destructive/40 text-sm text-destructive" role="alert">
            {error instanceof Error ? error.message : "Invoice dashboard data could not be loaded."}
          </DataCard>
        )}

        {/* Filters */}
        <DataCard>
          <div className="flex flex-wrap gap-4">
            <TitanSearchInput
              placeholder="Search invoice, customer, contact, order, PO, or job..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              containerClassName="flex-1"
            />
            <Select value={statusFilter} onValueChange={(nextStatus) => {
              setStatusFilter(nextStatus);
              setPage(1);
            }}>
              <SelectTrigger className="w-[200px]">
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
                  Filters{activeColumnFilters.length ? ` (${activeColumnFilters.length})` : ""}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[min(680px,calc(100vw-2rem))] max-h-[calc(100vh-8rem)] overflow-y-auto" align="end">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">Column filters</div>
                    <p className="text-xs text-muted-foreground">Filters compose with global search and apply across every invoice page.</p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={clearColumnFilters} disabled={activeColumnFilters.length === 0}>Clear all</Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm"><span>Customer / Company</span><Input value={columnFilters.customer || ""} onChange={(event) => setColumnFilter("customer", event.target.value)} placeholder="e.g. Acme" /></label>
                  <label className="grid gap-1 text-sm"><span>Contact</span><Input value={columnFilters.contact || ""} onChange={(event) => setColumnFilter("contact", event.target.value)} placeholder="Name or email" /></label>
                  <label className="grid gap-1 text-sm"><span>Job / Order Name</span><Input value={columnFilters.jobName || ""} onChange={(event) => setColumnFilter("jobName", event.target.value)} /></label>
                  <label className="grid gap-1 text-sm"><span>PO #</span><Input value={columnFilters.purchaseOrderNumber || ""} onChange={(event) => setColumnFilter("purchaseOrderNumber", event.target.value)} /></label>
                  <label className="grid gap-1 text-sm"><span>Order #</span><Input value={columnFilters.columnOrderNumber || ""} onChange={(event) => setColumnFilter("columnOrderNumber", event.target.value)} /></label>
                  <label className="grid gap-1 text-sm"><span>Invoice #</span><Input value={columnFilters.invoiceNumber || ""} onChange={(event) => setColumnFilter("invoiceNumber", event.target.value)} /></label>
                  <label className="grid gap-1 text-sm"><span>Issue date from</span><Input type="date" value={columnFilters.issueDateFrom || ""} onChange={(event) => setColumnFilter("issueDateFrom", event.target.value)} /></label>
                  <label className="grid gap-1 text-sm"><span>Issue date to</span><Input type="date" value={columnFilters.issueDateTo || ""} onChange={(event) => setColumnFilter("issueDateTo", event.target.value)} /></label>
                  <label className="grid gap-1 text-sm"><span>Due date from</span><Input type="date" value={columnFilters.dueDateFrom || ""} onChange={(event) => setColumnFilter("dueDateFrom", event.target.value)} /></label>
                  <label className="grid gap-1 text-sm"><span>Due date to</span><Input type="date" value={columnFilters.dueDateTo || ""} onChange={(event) => setColumnFilter("dueDateTo", event.target.value)} /></label>
                  <label className="grid gap-1 text-sm"><span>Last sent</span><Select value={columnFilters.lastSent || "all"} onValueChange={(value) => setColumnFilter("lastSent", value === "all" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Any</SelectItem><SelectItem value="sent">Sent</SelectItem><SelectItem value="not_sent">Not sent</SelectItem></SelectContent></Select></label>
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
          </div>
          {activeColumnFilters.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2" aria-label="Active invoice column filters">
              {activeColumnFilters.map(([key, value]) => (
                <Button key={key} type="button" variant="secondary" size="sm" className="h-7 gap-1" onClick={() => setColumnFilter(key, "")}>
                  {columnFilterLabels[key]}: {value} <X className="h-3 w-3" />
                </Button>
              ))}
            </div>
          )}
        </DataCard>

        {renderPagination("top")}

        {/* Invoices Table */}
        <TitanTableContainer>
          <TitanTable>
            <TitanTableHeader>
              <TitanTableRow>
                <TitanTableHead className="w-[44px]">
                  <Checkbox
                    checked={allVisibleSendableSelected}
                    onCheckedChange={(checked) => toggleAllVisible(checked === true)}
                    aria-label="Select all visible sendable invoices"
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
                {renderSortableHead("lastSentAt", "Last Sent", "min-w-[140px]")}
                {renderSortableHead("total", "Total", "min-w-[110px] text-right")}
                <TitanTableHead className="min-w-[100px] text-right">Paid</TitanTableHead>
                {renderSortableHead("balance", "Balance", "min-w-[110px] text-right")}
                <TitanTableHead className="sticky right-0 z-10 min-w-[90px] bg-background">Actions</TitanTableHead>
              </TitanTableRow>
            </TitanTableHeader>
            <TitanTableBody>
              {isLoading && <TitanTableLoading colSpan={15} message="Loading invoices..." />}
              
              {!isLoading && filteredInvoices.length === 0 && (
                <TitanTableEmpty
                  colSpan={15}
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
                      disabled={["paid", "void"].includes(String(invoice.status || "").toLowerCase())}
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
                  <TitanTableCell>
                    <div className="space-y-1">
                      <div>{invoice.lastSentAt ? formatDate(invoice.lastSentAt) : EMPTY_VALUE}</div>
                      <StatusPill variant={emailStatusMeta[invoice.emailStatus].variant}>
                        {emailStatusMeta[invoice.emailStatus].label}
                      </StatusPill>
                    </div>
                  </TitanTableCell>
                  <TitanTableCell className="text-right">{formatCurrency(invoice.displayTotal ?? invoice.total)}</TitanTableCell>
                  <TitanTableCell className="text-right">{formatCurrency(invoice.displayPaid ?? invoice.amountPaid)}</TitanTableCell>
                  <TitanTableCell className="text-right font-semibold">
                    {formatCurrency(invoice.displayRemaining ?? invoice.balanceDue ?? Number(invoice.total) - Number(invoice.amountPaid))}
                  </TitanTableCell>
                  <TitanTableCell className="sticky right-0 bg-background" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                      {canTakePaymentFromInvoiceList(invoice) ? (
                        <Button variant="outline" size="sm" onClick={() => navigate(getInvoiceListTakePaymentPath(invoice.id))}>
                          Take Payment
                        </Button>
                      ) : null}
                      <Button variant="outline" size="sm" asChild>
                        <Link to={`/invoices/${invoice.id}`}>View</Link>
                      </Button>
                    </div>
                  </TitanTableCell>
                </TitanTableRow>
              ))}
            </TitanTableBody>
          </TitanTable>
        </TitanTableContainer>

        {renderPagination("bottom")}
      </ContentLayout>
    </Page>
  );
}
