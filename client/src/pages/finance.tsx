import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { CustomerSelect } from "@/components/CustomerSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROUTES } from "@/config/routes";
import { apiFetch } from "@/lib/queryClient";
import { ContentLayout, DataCard, Page, PageHeader, TitanTable, TitanTableBody, TitanTableCell, TitanTableContainer, TitanTableEmpty, TitanTableHead, TitanTableHeader, TitanTableLoading, TitanTableRow } from "@/components/titan";

const PAGE_SIZE = 50;
const DATE_PRESETS = new Set(["today", "this-week", "this-month", "custom", "all"]);
const SORT_KEYS = ["paymentDate", "customer", "invoiceNumber", "orderNumber", "jobName", "method", "reference", "amount"] as const;
type SortKey = typeof SORT_KEYS[number];
type PaymentRow = { id: string; appliedAt: string; amountCents: number; method: string | null; provider: string | null; reference: string | null; quickbooksPaymentReference: string | null; note: string | null; notes: string | null; customerId: string | null; customerName: string | null; invoiceId: string | null; invoiceNumber: string | null; invoiceLegacyNumber: string | null; orderId: string | null; orderNumber: string | null; jobName: string | null };
type PaymentData = { rows: PaymentRow[]; summary: { totalPayments: number; totalCollectedCents: number }; pagination: { page: number; pageSize: number; totalCount: number; totalPages: number }; timezone: string };

function formatCurrency(cents: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100); }
function formatMethod(value: string | null) { return value ? value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "—"; }

export default function FinancePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const datePreset = DATE_PRESETS.has(searchParams.get("datePreset") || "") ? searchParams.get("datePreset")! : "all";
  const page = Math.max(1, Number(searchParams.get("page") || "1") || 1);
  const sortBy = SORT_KEYS.includes(searchParams.get("sortBy") as SortKey) ? searchParams.get("sortBy") as SortKey : "paymentDate";
  const sortDir = searchParams.get("sortDir") === "asc" ? "asc" : "desc";
  const updateParams = (changes: Record<string, string | null>, resetPage = true) => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    Object.entries(changes).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    if (resetPage) next.delete("page");
    return next;
  });
  const queryString = useMemo(() => {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(page)); next.set("pageSize", String(PAGE_SIZE)); next.set("datePreset", datePreset); next.set("sortBy", sortBy); next.set("sortDir", sortDir);
    return next.toString();
  }, [searchParams, page, datePreset, sortBy, sortDir]);
  const paymentQuery = useQuery<PaymentData>({
    queryKey: ["payments", queryString],
    queryFn: async () => {
      const response = await apiFetch(`/api/payments?${queryString}`);
      const payload = await response.json() as { success: boolean; data: PaymentData };
      if (!response.ok || !payload.success) throw new Error("Unable to load payments");
      return payload.data;
    },
  });
  const data = paymentQuery.data;
  const toggleSort = (key: SortKey) => updateParams({ sortBy: key, sortDir: sortBy === key && sortDir === "desc" ? "asc" : "desc" });
  const sortLabel = (label: string, key: SortKey) => <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort(key)}>{label}{sortBy === key && (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}</button>;

  return <Page>
    <PageHeader title="Payments" description="Canonical successful payments for the selected organization and date range." />
    <ContentLayout className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <DataCard title="Total Payments"><p className="text-2xl font-semibold">{data?.summary.totalPayments ?? "—"}</p></DataCard>
        <DataCard title="Total Collected"><p className="text-2xl font-semibold">{data ? formatCurrency(data.summary.totalCollectedCents) : "—"}</p></DataCard>
      </div>
      <div className="grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-2 xl:grid-cols-5">
        <div><Label>Date</Label><Select value={datePreset} onValueChange={(value) => updateParams({ datePreset: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="today">Today</SelectItem><SelectItem value="this-week">This Week</SelectItem><SelectItem value="this-month">This Month</SelectItem><SelectItem value="custom">Custom Range</SelectItem><SelectItem value="all">All Time</SelectItem></SelectContent></Select></div>
        <CustomerSelect value={searchParams.get("customerId")} onChange={(customerId) => updateParams({ customerId })} autoFocus={false} label="Customer" placeholder="All customers" />
        <div><Label>Payment Method</Label><Select value={searchParams.get("method") || "all"} onValueChange={(value) => updateParams({ method: value === "all" ? null : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All methods</SelectItem><SelectItem value="cash">Cash</SelectItem><SelectItem value="check">Check</SelectItem><SelectItem value="credit_card">Credit card</SelectItem><SelectItem value="wire">Wire</SelectItem><SelectItem value="bank_transfer">Bank transfer</SelectItem><SelectItem value="ach">ACH</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div>
        <div className="xl:col-span-2"><Label>Search</Label><Input value={searchParams.get("search") || ""} onChange={(event) => updateParams({ search: event.target.value || null })} placeholder="Customer, invoice, order, job, or reference" /></div>
        {datePreset === "custom" && <><div><Label>From</Label><Input type="date" value={searchParams.get("dateFrom") || ""} onChange={(event) => updateParams({ dateFrom: event.target.value || null })} /></div><div><Label>To</Label><Input type="date" value={searchParams.get("dateTo") || ""} onChange={(event) => updateParams({ dateTo: event.target.value || null })} /></div></>}
      </div>
      <TitanTableContainer><TitanTable className="min-w-[1120px]"><TitanTableHeader><TitanTableRow><TitanTableHead>{sortLabel("Payment Date", "paymentDate")}</TitanTableHead><TitanTableHead>{sortLabel("Customer", "customer")}</TitanTableHead><TitanTableHead>{sortLabel("Invoice #", "invoiceNumber")}</TitanTableHead><TitanTableHead>{sortLabel("Order #", "orderNumber")}</TitanTableHead><TitanTableHead>{sortLabel("Job / Order Name", "jobName")}</TitanTableHead><TitanTableHead>{sortLabel("Method", "method")}</TitanTableHead><TitanTableHead>{sortLabel("Reference", "reference")}</TitanTableHead><TitanTableHead className="text-right">{sortLabel("Amount", "amount")}</TitanTableHead></TitanTableRow></TitanTableHeader><TitanTableBody>
        {paymentQuery.isLoading && <TitanTableLoading colSpan={8} message="Loading payments..." />}
        {paymentQuery.isError && <TitanTableEmpty colSpan={8} message="Unable to load payments" action={<Button size="sm" onClick={() => paymentQuery.refetch()}>Retry</Button>} />}
        {!paymentQuery.isLoading && !paymentQuery.isError && data?.rows.length === 0 && <TitanTableEmpty colSpan={8} message="No payments found" />}
        {data?.rows.map((payment) => <TitanTableRow key={payment.id}><TitanTableCell>{new Date(payment.appliedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: data.timezone })}</TitanTableCell><TitanTableCell>{payment.customerId ? <Link className="text-primary hover:underline" to={ROUTES.customers.detail(payment.customerId)}>{payment.customerName || "Customer"}</Link> : payment.customerName || "—"}</TitanTableCell><TitanTableCell>{payment.invoiceId ? <Link className="text-primary hover:underline" to={ROUTES.invoices.detail(payment.invoiceId)}>{payment.invoiceNumber || payment.invoiceLegacyNumber || "Invoice"}</Link> : payment.invoiceNumber || payment.invoiceLegacyNumber || "—"}</TitanTableCell><TitanTableCell>{payment.orderId ? <Link className="text-primary hover:underline" to={ROUTES.orders.detail(payment.orderId)}>{payment.orderNumber || "Order"}</Link> : payment.orderNumber || "—"}</TitanTableCell><TitanTableCell>{payment.jobName || "—"}</TitanTableCell><TitanTableCell>{formatMethod(payment.method)}{payment.provider && <div className="text-xs text-muted-foreground">{payment.provider}</div>}</TitanTableCell><TitanTableCell>{payment.reference || payment.quickbooksPaymentReference || payment.note || payment.notes || "—"}</TitanTableCell><TitanTableCell className="text-right font-medium">{formatCurrency(payment.amountCents)}</TitanTableCell></TitanTableRow>)}
      </TitanTableBody></TitanTable></TitanTableContainer>
      {data && <div className="flex items-center justify-between text-sm text-muted-foreground"><span>{data.pagination.totalCount} matching payments</span><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={data.pagination.page <= 1} onClick={() => updateParams({ page: String(data.pagination.page - 1) }, false)}><ChevronLeft className="h-4 w-4" /> Previous</Button><span>Page {data.pagination.page} of {data.pagination.totalPages}</span><Button variant="outline" size="sm" disabled={data.pagination.page >= data.pagination.totalPages} onClick={() => updateParams({ page: String(data.pagination.page + 1) }, false)}>Next <ChevronRight className="h-4 w-4" /></Button></div></div>}
    </ContentLayout>
  </Page>;
}
