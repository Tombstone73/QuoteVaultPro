import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { CustomerSelect } from "@/components/CustomerSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ContentLayout, Page, PageHeader, TitanTable, TitanTableBody, TitanTableCell, TitanTableContainer, TitanTableEmpty, TitanTableHead, TitanTableHeader, TitanTableLoading, TitanTableRow } from "@/components/titan";
import { useActiveOrganizationRole } from "@/hooks/useActiveOrganizationRole";
import { apiFetch } from "@/lib/queryClient";
import { ROUTES } from "@/config/routes";
import { canReadWorkValue } from "@shared/workValueAccess";

type WorkValueStatus = "active_production" | "new" | "in_production" | "complete_not_sent";
type WorkValueRow = {
  id: string; kind: "order" | "invoice"; status: string; orderId: string | null;
  orderNumber: string | null; lineDescription: string | null; customerName: string | null;
  poNumber: string | null; jobLabel: string | null; dueDate: string | null;
  invoiceId: string | null; invoiceNumber: string | null; valueCents: number;
};
type WorkValueData = {
  summary: Record<WorkValueStatus, { count: number; valueCents: number }>;
  rows: WorkValueRow[];
  filtered: { count: number; valueCents: number };
  pagination: { page: number; pageSize: number; totalPages: number };
};

const statusOptions: { value: WorkValueStatus; label: string }[] = [
  { value: "active_production", label: "Active Production" },
  { value: "new", label: "New" },
  { value: "in_production", label: "In Production" },
  { value: "complete_not_sent", label: "Complete, Not Sent" },
];
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const formatMoney = (cents: number) => money.format(cents / 100);
const formatDay = (value: string | null) => value ? new Date(value).toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" }) : "—";

export default function WorkValuePage() {
  const { role, isLoading: roleLoading } = useActiveOrganizationRole();
  const canReadFinance = canReadWorkValue(role);
  const [params, setParams] = useSearchParams();
  const status = statusOptions.find((item) => item.value === params.get("status"))?.value ?? "active_production";
  const duePreset = params.get("duePreset") || "all";
  const page = Math.max(1, Number(params.get("page") || "1") || 1);
  const update = (changes: Record<string, string | null>, resetPage = true) => setParams((current) => {
    const next = new URLSearchParams(current);
    Object.entries(changes).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    if (resetPage) next.delete("page");
    return next;
  });
  const queryString = useMemo(() => {
    const query = new URLSearchParams(params);
    query.set("status", status);
    query.set("duePreset", duePreset);
    query.set("page", String(page));
    return query.toString();
  }, [params, status, duePreset, page]);
  const query = useQuery<WorkValueData>({
    queryKey: ["workValue", queryString], enabled: canReadFinance,
    queryFn: async () => {
      const response = await apiFetch(`/api/dashboard/work-value?${queryString}`);
      const payload: { success: boolean; data: WorkValueData; message?: string } = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.message || "Unable to load Work Value");
      return payload.data;
    },
  });

  if (roleLoading) return <Page><PageHeader title="Work Value" /><ContentLayout>Checking access…</ContentLayout></Page>;
  if (!canReadFinance) return <Page><PageHeader title="Work Value" /><ContentLayout>Financial access required.</ContentLayout></Page>;

  return <Page>
    <PageHeader title="Work Value" subtitle="Selling value by visible Order status and the Invoice Ready to Finalize list." />
    <ContentLayout className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {statusOptions.map((item) => {
          const figure = query.data?.summary[item.value];
          return <button key={item.value} type="button" onClick={() => update({ status: item.value })}
            aria-pressed={status === item.value}
            className={`rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${status === item.value ? "border-primary ring-1 ring-primary/30" : "border-border"}`}>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{item.label}</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{figure ? formatMoney(figure.valueCents) : "—"}</div>
            <div className="mt-1 text-xs text-muted-foreground">{figure ? `${figure.count} ${item.value === "complete_not_sent" ? "invoices" : "orders"}` : "—"}</div>
          </button>;
        })}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 text-sm font-semibold">Filters</div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div><Label>Status</Label><Select value={status} onValueChange={(value) => update({ status: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{statusOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
          <CustomerSelect value={params.get("customerId")} onChange={(customerId) => update({ customerId })} autoFocus={false} label="Customer" placeholder="All customers" />
          <div><Label>Due date</Label><Select value={duePreset} onValueChange={(value) => update({ duePreset: value, dateFrom: null, dateTo: null })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All dates</SelectItem><SelectItem value="today">Today</SelectItem><SelectItem value="tomorrow">Tomorrow</SelectItem><SelectItem value="this_week">This Week</SelectItem><SelectItem value="overdue">Overdue</SelectItem><SelectItem value="custom">Custom range</SelectItem></SelectContent></Select></div>
          <div className="xl:col-span-2"><Label htmlFor="work-value-search">Search</Label><Input id="work-value-search" value={params.get("search") || ""} onChange={(event) => update({ search: event.target.value || null })} placeholder="Order, customer, PO, job label" /></div>
          {duePreset === "custom" && <><div><Label htmlFor="work-value-from">From</Label><Input id="work-value-from" type="date" value={params.get("dateFrom") || ""} onChange={(event) => update({ dateFrom: event.target.value || null })} /></div><div><Label htmlFor="work-value-to">To</Label><Input id="work-value-to" type="date" value={params.get("dateTo") || ""} onChange={(event) => update({ dateTo: event.target.value || null })} /></div></>}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">Salesperson filtering is unavailable: Orders and Invoices have no assigned salesperson field.</span>
          <Button variant="ghost" size="sm" onClick={() => setParams(new URLSearchParams())}>Clear Filters</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><div className="text-sm text-muted-foreground">Showing {query.data?.filtered.count ?? "—"} {status === "complete_not_sent" ? "invoices" : "orders"}</div><div className="text-lg font-semibold">Filtered Value: {query.data ? formatMoney(query.data.filtered.valueCents) : "—"}</div></div>
        {status === "complete_not_sent" && <div className="text-xs text-muted-foreground">Matches the Invoice “Ready to Finalize” preset.</div>}
      </div>

      <TitanTableContainer><TitanTable className="min-w-[900px]"><TitanTableHeader><TitanTableRow><TitanTableHead>Status</TitanTableHead><TitanTableHead>Order / Job #</TitanTableHead><TitanTableHead>Customer</TitanTableHead><TitanTableHead>PO / Job Info</TitanTableHead><TitanTableHead>Due Date</TitanTableHead><TitanTableHead>Invoice</TitanTableHead><TitanTableHead className="text-right">Value</TitanTableHead></TitanTableRow></TitanTableHeader><TitanTableBody>
        {query.isLoading && <TitanTableLoading colSpan={7} message="Loading work value…" />}
        {query.isError && <TitanTableEmpty colSpan={7} message="Unable to load Work Value" action={<Button size="sm" onClick={() => query.refetch()}>Retry</Button>} />}
        {!query.isLoading && !query.isError && query.data?.rows.length === 0 && <TitanTableEmpty colSpan={7} message="No matching work" />}
        {query.data?.rows.map((row) => <TitanTableRow key={`${row.kind}:${row.id}`}><TitanTableCell>{row.status}</TitanTableCell><TitanTableCell>{row.orderId ? <Link to={ROUTES.orders.detail(row.orderId)} className="font-medium text-primary hover:underline">{row.orderNumber || "Order"}</Link> : row.orderNumber || "—"}{row.lineDescription && <div className="max-w-[220px] truncate text-xs text-muted-foreground" title={row.lineDescription}>{row.lineDescription}</div>}</TitanTableCell><TitanTableCell>{row.customerName || "—"}</TitanTableCell><TitanTableCell>{row.poNumber || "—"}{row.jobLabel && <div className="max-w-[220px] truncate text-xs text-muted-foreground" title={row.jobLabel}>{row.jobLabel}</div>}</TitanTableCell><TitanTableCell>{formatDay(row.dueDate)}</TitanTableCell><TitanTableCell>{row.invoiceId ? <Link to={ROUTES.invoices.detail(row.invoiceId)} className="text-primary hover:underline">{row.invoiceNumber || "Invoice"}</Link> : "—"}</TitanTableCell><TitanTableCell className="text-right font-medium tabular-nums">{formatMoney(row.valueCents)}</TitanTableCell></TitanTableRow>)}
      </TitanTableBody></TitanTable></TitanTableContainer>
      {query.data && <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) }, false)}><ChevronLeft className="h-4 w-4" /> Previous</Button><span>Page {page} of {query.data.pagination.totalPages}</span><Button variant="outline" size="sm" disabled={page >= query.data.pagination.totalPages} onClick={() => update({ page: String(page + 1) }, false)}>Next <ChevronRight className="h-4 w-4" /></Button></div>}
    </ContentLayout>
  </Page>;
}
