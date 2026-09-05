import { Search } from "lucide-react";
import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { money, quoteApi, type OrderListItem } from "./api";
import { SalesEntryWorkspace } from "./SalesEntryWorkspace";
import { useSalesOrders } from "./quoteFormQueries";
import {
  salesOrderLifecycleFilters,
  type SalesOrderOperationalFilter,
  useSalesOrderLifecycleFilterPreference,
  useSalesOrderOperationalFilterPreference,
  useSalesUpdatedSortPreference,
} from "./salesSortPreference";

const workflowFilters: readonly Readonly<{ value: SalesOrderOperationalFilter; label: string }>[] = [
  { value: "all", label: "All work" },
  { value: "needs_artwork", label: "Needs artwork" },
  { value: "prepress", label: "Prepress" },
  { value: "production", label: "Production" },
  { value: "flatbed", label: "Flatbed" },
  { value: "roll", label: "Roll" },
  { value: "ready_for_fulfillment", label: "Ready for fulfillment" },
  { value: "fulfillment", label: "Fulfillment" },
  { value: "open_balance", label: "Open balance" },
];
const scopeFor = (filter: (typeof salesOrderLifecycleFilters)[number]) => filter === "Archived"
  ? { archive: "archived" as const }
  : { archive: "active" as const, ...(filter === "All" ? {} : { lifecycle: filter.toLowerCase() }) };
const date = (value?: string) =>
  value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
const statusTone = (value: string) =>
  value === "open" ? "info" : value === "cancelled" || value === "canceled" ? "late" : "neutral";

const Status = ({ value }: Readonly<{ value: string }>) => (
  <span data-tone={statusTone(value)} className="status-badge inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap">
    {value.replaceAll("_", " ")}
  </span>
);

/** Displays the server-owned operational projection without deriving state in React. */
export const OrderOperationalSummary = ({ row }: Readonly<{ row: OrderListItem }>) => {
  const operational = row.operational;
  if (!operational) return <span className="muted">Legacy read-only</span>;
  const artwork = operational.artwork;
  const production = [
    operational.production.state.replaceAll("_", " "),
    ...operational.production.destinations,
  ].join(" · ");
  const attention = [
    operational.attention.overdue ? "Overdue" : undefined,
    operational.attention.needsArtwork ? "Artwork needed" : undefined,
    operational.notes.hasOrderNotes ? "Notes" : undefined,
  ].filter((value): value is string => Boolean(value));
  return <div className="v2-orders-operational-summary">
    <span>
      {artwork.state === "none"
        ? "No art"
        : `${artwork.assignmentCount} art${artwork.assignmentCount === 1 ? "" : "works"}${artwork.representative?.sides.length ? ` · ${artwork.representative.sides.join("/")}` : ""}`}
    </span>
    <span>Prepress · {operational.prepress.replaceAll("_", " ")}</span>
    <span>Production · {production}</span>
    <span>Fulfillment · {operational.fulfillment.replaceAll("_", " ")}</span>
    <span>Billing · {operational.billing.state.replaceAll("_", " ")}{operational.billing.state === "open_balance" ? ` · ${money({ cents: operational.billing.openBalanceCents, currency: row.currency })}` : ""}</span>
    {attention.length > 0 && <strong data-tone="late">{attention.join(" · ")}</strong>}
  </div>;
};

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
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const { sort, setSort, preferenceReady: sortPreferenceReady } = useSalesUpdatedSortPreference("orders", sessionScope, organizationId);
  const { filter: lifecycleFilter, setFilter: setLifecycleFilter, preferenceReady: lifecyclePreferenceReady } = useSalesOrderLifecycleFilterPreference(sessionScope, organizationId);
  const { filter: operationalFilter, setFilter: setOperationalFilter, preferenceReady: operationalPreferenceReady } = useSalesOrderOperationalFilterPreference(sessionScope, organizationId);
  const [cursor, setCursor] = useState("");
  const list = useSalesOrders(sessionScope, organizationId, {
    q: search,
    ...scopeFor(lifecycleFilter),
    ...(operationalFilter === "all" ? {} : { operational: operationalFilter }),
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
  const selectSort = (next: "updated_desc" | "updated_asc") => {
    setSort(next);
    setCursor("");
  };

  if (creating) return <SalesEntryWorkspace mode="order" organizationId={organizationId} sessionScope={sessionScope} canCreate={bootstrap.data?.capabilities.orderCreate === true} canOverridePrice={bootstrap.data?.capabilities.orderOverridePrice === true} csrfReady={Boolean(bootstrap.data)} onCancel={() => setCreating(false)} onOrderCreated={(id) => onOpenV2(id)} />;
  return <section className="v2-orders-list space-y-3 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
      <div className="min-w-0"><h1 className="text-lg font-semibold tracking-tight">Orders</h1><p className="mt-0.5 text-[13px] text-muted-foreground">{count} orders{summary?.sellingTotalCents !== undefined && singleCurrency ? <> · {money({ cents: summary.sellingTotalCents, currency: singleCurrency })} total value</> : cursor ? " shown" : ""}</p></div><button type="button" className="v2-quotes-new" disabled={bootstrap.data?.capabilities.orderCreate !== true} onClick={() => setCreating(true)}>New Order</button>
    </div>
    <div className="v2-orders-filters">
      <label className="v2-orders-search"><Search aria-hidden /><input value={search} onChange={(event) => { setSearch(event.target.value); setCursor(""); }} placeholder="Filter by number, PO, customer…" /></label>
      <div className="v2-orders-chips" aria-label="Order lifecycle filters">{salesOrderLifecycleFilters.map((value) => <button key={value} type="button" className={lifecycleFilter === value ? "is-selected" : ""} disabled={!lifecyclePreferenceReady} onClick={() => { setLifecycleFilter(value); setCursor(""); }}>{value}</button>)}</div>
      <label className="v2-orders-workflow-filter">Workboard <select value={operationalFilter} disabled={!operationalPreferenceReady} onChange={(event) => { setOperationalFilter(event.target.value as SalesOrderOperationalFilter); setCursor(""); }}>{workflowFilters.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label className="v2-orders-date-filter">Due from <input type="date" value={dueFrom} onChange={(event) => { setDueFrom(event.target.value); setCursor(""); }} /></label>
      <label className="v2-orders-date-filter">Due to <input type="date" value={dueTo} onChange={(event) => { setDueTo(event.target.value); setCursor(""); }} /></label>
      <label className="v2-orders-sort">Sort <select value={sort} disabled={!sortPreferenceReady} onChange={(event) => selectSort(event.target.value === "updated_asc" ? "updated_asc" : "updated_desc")}><option value="updated_desc">Updated: newest</option><option value="updated_asc">Updated: oldest</option></select></label>
    </div>
    <div className="panel overflow-hidden v2-orders-table-wrap"><table className="w-full border-collapse"><thead><tr><th>Order #</th><th>Customer</th><th>PO</th><th>Contact</th><th className="is-number">Lines</th><th>Due</th><th>Status</th><th>Operations</th><th className="is-number">Total</th><th>Actions</th></tr></thead><tbody>
      {rows.map((row) => <tr key={`${row.source}:${row.recordId}`} className="row-h" onClick={() => select(row)}><td><button type="button" className="v2-orders-number">#{row.number}</button>{row.source === "legacy" && <span className="v2-orders-legacy">Legacy · Read only</span>}</td><td>{row.customerDisplayName}</td><td className="num muted">{row.purchaseOrderNumber ?? "—"}</td><td className="muted">{row.operational?.primaryContact?.displayName ?? "—"}</td><td className="num is-number">{row.lineCount ?? "—"}</td><td className="num">{date(row.requestedDueDate)}</td><td><Status value={row.archived ? "archived" : row.lifecycle} /></td><td><OrderOperationalSummary row={row} /></td><td className="num is-number v2-orders-total">{money({ cents: row.sellingTotalCents, currency: row.currency })}</td><td onClick={(event) => event.stopPropagation()}><details className="v2-sales-row-actions"><summary>Actions</summary><button type="button" onClick={() => select(row)}>Open</button></details></td></tr>)}
      {!list.isLoading && rows.length === 0 && <tr><td colSpan={10} className="v2-orders-empty">Nothing matches that filter.</td></tr>}
      {list.isLoading && <tr><td colSpan={10} className="v2-orders-empty">Loading Orders…</td></tr>}
    </tbody></table></div>
    {list.error && <p className="v2-orders-error">Orders could not be loaded.</p>}
    <div className="v2-orders-pagination">{cursor && <button type="button" onClick={() => setCursor("")}>First page</button>}{list.data?.nextCursor && <button type="button" onClick={() => setCursor(list.data!.nextCursor!)}>Next page</button>}</div>
  </section>;
};
