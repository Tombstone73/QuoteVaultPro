import { Search } from "lucide-react";
import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { money, quoteApi, type OrderListItem } from "./api";
import { SalesEntryWorkspace } from "./SalesEntryWorkspace";
import { useSalesOrders } from "./quoteFormQueries";

const filters = ["All", "Open", "Cancelled"] as const;
const lifecycleFor = (filter: (typeof filters)[number]) =>
  filter === "All" ? undefined : filter.toLowerCase();
const date = (value?: string) =>
  value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
const statusTone = (value: string) =>
  value === "open" ? "info" : value === "cancelled" || value === "canceled" ? "late" : "neutral";
type UpdatedSort = "updated_desc" | "updated_asc";
const preferenceKey = (sessionScope: string, organizationId: string) =>
  `ph.v2.sales.orders.updated-sort.${sessionScope}.${organizationId}`;
const readSortPreference = (sessionScope: string, organizationId: string): UpdatedSort => {
  try {
    return window.localStorage.getItem(preferenceKey(sessionScope, organizationId)) === "updated_asc"
      ? "updated_asc"
      : "updated_desc";
  } catch { return "updated_desc"; }
};

const Status = ({ value }: Readonly<{ value: string }>) => (
  <span data-tone={statusTone(value)} className="status-badge inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap">
    {value.replaceAll("_", " ")}
  </span>
);

export const OrdersList = ({
  organizationId,
  sessionScope,
  onOpenV2,
  onOpenLegacy,
}: Readonly<{
  organizationId: string;
  sessionScope: string;
  onOpenV2: (orderId: string) => void;
  onOpenLegacy: (recordId: string) => void;
}>) => {
  const [creating, setCreating] = useState(() => {
    try {
      const requested = sessionStorage.getItem("ph.v2.new-order") === "1";
      if (requested) sessionStorage.removeItem("ph.v2.new-order");
      return requested;
    } catch { return false; }
  });
  useEffect(() => {
    const open = () => setCreating(true);
    window.addEventListener("v2:new-order", open);
    return () => window.removeEventListener("v2:new-order", open);
  }, []);
  const bootstrap = useQuery({ queryKey: ["v2", sessionScope, organizationId, "ui-bootstrap"], queryFn: () => quoteApi.bootstrap(organizationId), enabled: Boolean(sessionScope && organizationId) });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [sort, setSort] = useState<UpdatedSort>(() => readSortPreference(sessionScope, organizationId));
  const [cursor, setCursor] = useState("");
  const list = useSalesOrders(sessionScope, organizationId, {
    q: search,
    ...(lifecycleFor(filter) ? { lifecycle: lifecycleFor(filter) } : {}),
    ...(dueFrom ? { dueFrom } : {}),
    ...(dueTo ? { dueTo } : {}),
    sort,
    ...(cursor ? { cursor } : {}),
  });
  const rows = list.data?.items ?? [];
  const summary = list.data?.summary;
  const count = summary?.itemCount ?? rows.length;
  const singleCurrency = summary?.currencies.length === 1 ? summary.currencies[0] : undefined;
  const select = (row: OrderListItem) => {
    if (row.source === "legacy") onOpenLegacy(row.recordId);
    else onOpenV2(row.orderId);
  };
  const selectSort = (next: UpdatedSort) => {
    setSort(next);
    setCursor("");
    try { window.localStorage.setItem(preferenceKey(sessionScope, organizationId), next); } catch { /* persistence is a convenience only */ }
  };

  if (creating) return <SalesEntryWorkspace mode="order" organizationId={organizationId} sessionScope={sessionScope} canCreate={bootstrap.data?.capabilities.orderCreate === true} canOverridePrice={bootstrap.data?.capabilities.orderOverridePrice === true} csrfReady={Boolean(bootstrap.data)} onCancel={() => setCreating(false)} onOrderCreated={(id) => onOpenV2(id)} />;
  return <section className="v2-orders-list space-y-3 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
      <div className="min-w-0"><h1 className="text-lg font-semibold tracking-tight">Orders</h1><p className="mt-0.5 text-[13px] text-muted-foreground">{count} orders{summary?.sellingTotalCents !== undefined && singleCurrency ? <> · {money({ cents: summary.sellingTotalCents, currency: singleCurrency })} total value</> : cursor ? " shown" : ""}</p></div><button type="button" className="v2-quotes-new" disabled={bootstrap.data?.capabilities.orderCreate !== true} onClick={() => setCreating(true)}>New Order</button>
    </div>
    <div className="v2-orders-filters">
      <label className="v2-orders-search"><Search aria-hidden /><input value={search} onChange={(event) => { setSearch(event.target.value); setCursor(""); }} placeholder="Filter by number, PO, customer…" /></label>
      <div className="v2-orders-chips" aria-label="Order lifecycle filters">{filters.map((value) => <button key={value} type="button" className={filter === value ? "is-selected" : ""} onClick={() => { setFilter(value); setCursor(""); }}>{value}</button>)}</div>
      <label className="v2-orders-date-filter">Due from <input type="date" value={dueFrom} onChange={(event) => { setDueFrom(event.target.value); setCursor(""); }} /></label>
      <label className="v2-orders-date-filter">Due to <input type="date" value={dueTo} onChange={(event) => { setDueTo(event.target.value); setCursor(""); }} /></label>
      <label className="v2-orders-sort">Sort <select value={sort} onChange={(event) => selectSort(event.target.value === "updated_asc" ? "updated_asc" : "updated_desc")}><option value="updated_desc">Updated: newest</option><option value="updated_asc">Updated: oldest</option></select></label>
    </div>
    <div className="panel overflow-hidden v2-orders-table-wrap"><table className="w-full border-collapse"><thead><tr><th>Order #</th><th>Customer</th><th>PO</th><th>Rep</th><th className="is-number">Lines</th><th>Due</th><th>Status</th><th className="is-number">Total</th><th>Actions</th></tr></thead><tbody>
      {rows.map((row) => <tr key={`${row.source}:${row.recordId}`} className="row-h" onClick={() => select(row)}><td><button type="button" className="v2-orders-number">#{row.number}</button>{row.source === "legacy" && <span className="v2-orders-legacy">Legacy · Read only</span>}</td><td>{row.customerDisplayName}</td><td className="num muted">{row.purchaseOrderNumber ?? "—"}</td><td className="muted">—</td><td className="num is-number">{row.lineCount ?? "—"}</td><td className="num">{date(row.requestedDueDate)}</td><td><Status value={row.lifecycle} /></td><td className="num is-number v2-orders-total">{money({ cents: row.sellingTotalCents, currency: row.currency })}</td><td onClick={(event) => event.stopPropagation()}><details className="v2-sales-row-actions"><summary>Actions</summary><button type="button" onClick={() => select(row)}>Open</button></details></td></tr>)}
      {!list.isLoading && rows.length === 0 && <tr><td colSpan={9} className="v2-orders-empty">Nothing matches that filter.</td></tr>}
      {list.isLoading && <tr><td colSpan={9} className="v2-orders-empty">Loading Orders…</td></tr>}
    </tbody></table></div>
    {list.error && <p className="v2-orders-error">Orders could not be loaded.</p>}
    <div className="v2-orders-pagination">{cursor && <button type="button" onClick={() => setCursor("")}>First page</button>}{list.data?.nextCursor && <button type="button" onClick={() => setCursor(list.data!.nextCursor!)}>Next page</button>}</div>
  </section>;
};
