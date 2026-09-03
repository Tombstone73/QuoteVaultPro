import { Plus, Search } from "lucide-react";
import React, { useState } from "react";
import { money, type QuoteListItem } from "./api";
import { useSalesQuotes } from "./quoteFormQueries";
import { useSalesUpdatedSortPreference } from "./salesSortPreference";

const filters = ["All", "Draft", "Sent", "Accepted", "Converted"] as const;
const lifecycleFor = (filter: (typeof filters)[number]) =>
  filter === "All" ? undefined : filter.toLowerCase();
const date = (value?: string) =>
  value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
const statusTone = (value: string) =>
  value === "accepted" ? "ok" : value === "sent" ? "info" : value === "converted" ? "accent" : "neutral";

const Status = ({ value }: Readonly<{ value: string }>) => (
  <span data-tone={statusTone(value)} className="status-badge inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap">
    {value.replaceAll("_", " ")}
  </span>
);

export const QuotesList = ({
  organizationId,
  sessionScope,
  canCreate,
  onCreate,
  onOpenV2,
  onOpenLegacy,
}: Readonly<{
  organizationId: string;
  sessionScope: string;
  canCreate: boolean;
  onCreate: () => void;
  onOpenV2: (quoteId: string) => void;
  onOpenLegacy: (recordId: string) => void;
}>) => {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const { sort, setSort, preferenceReady } = useSalesUpdatedSortPreference("quotes", sessionScope, organizationId);
  const [cursor, setCursor] = useState("");
  const list = useSalesQuotes(sessionScope, organizationId, {
    q: search,
    ...(lifecycleFor(filter) ? { lifecycle: lifecycleFor(filter) } : {}),
    ...(dueFrom ? { dueFrom } : {}),
    ...(dueTo ? { dueTo } : {}),
    sort,
    ...(cursor ? { cursor } : {}),
  });
  const rows = list.data?.items ?? [];
  const summary = list.data?.summary;
  const total = summary?.sellingTotalCents ?? rows.reduce((sum, row) => sum + row.sellingTotalCents, 0);
  const select = (row: QuoteListItem) => {
    if (row.source === "legacy") onOpenLegacy(row.recordId);
    else onOpenV2(row.quoteId);
  };
  const selectSort = (next: "updated_desc" | "updated_asc") => {
    setSort(next);
    setCursor("");
  };

  return (
    <section className="v2-quotes-list space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">Quotes</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {list.data?.totalMatching ?? rows.length} quotes · {money({ cents: total, currency: summary?.currencies[0] ?? rows[0]?.currency ?? "USD" })} total value
          </p>
        </div>
        <button type="button" className="v2-quotes-new" onClick={onCreate} disabled={!canCreate}>
          <Plus aria-hidden /> New Quote
        </button>
      </div>

      <div className="v2-quotes-filters">
        <label className="v2-quotes-search">
          <Search aria-hidden />
          <input value={search} onChange={(event) => { setSearch(event.target.value); setCursor(""); }} placeholder="Filter by number, PO, customer…" />
        </label>
        <div className="v2-quotes-chips" aria-label="Quote lifecycle filters">
          {filters.map((value) => <button key={value} type="button" className={filter === value ? "is-selected" : ""} onClick={() => { setFilter(value); setCursor(""); }}>{value}</button>)}
        </div>
        <label className="v2-quotes-date-filter">Due from <input type="date" value={dueFrom} onChange={(event) => { setDueFrom(event.target.value); setCursor(""); }} /></label>
        <label className="v2-quotes-date-filter">Due to <input type="date" value={dueTo} onChange={(event) => { setDueTo(event.target.value); setCursor(""); }} /></label>
        <label className="v2-quotes-sort">Sort <select value={sort} disabled={!preferenceReady} onChange={(event) => selectSort(event.target.value === "updated_asc" ? "updated_asc" : "updated_desc")}><option value="updated_desc">Updated: newest</option><option value="updated_asc">Updated: oldest</option></select></label>
      </div>

      <div className="panel overflow-hidden v2-quotes-table-wrap">
        <table className="w-full border-collapse">
          <thead><tr>
            <th>Quote #</th><th>Customer</th><th>PO</th><th>Rep</th><th className="is-number">Lines</th><th>Due</th><th>Status</th><th className="is-number">Total</th><th>Actions</th>
          </tr></thead>
          <tbody>
            {rows.map((row) => <tr key={`${row.source}:${row.recordId}`} className="row-h" onClick={() => select(row)}>
              <td><button type="button" className="v2-quotes-number">#{row.number}</button>{row.source === "legacy" && <span className="v2-quotes-legacy">Legacy · Read only</span>}</td>
              <td>{row.customerDisplayName}</td>
              <td className="num muted">{row.purchaseOrderNumber ?? "—"}</td>
              <td className="muted">—</td>
              <td className="num is-number">{row.lineCount ?? "—"}</td>
              <td className="num">{date(row.requestedDueDate)}</td>
              <td><Status value={row.lifecycle} /></td>
              <td className="num is-number v2-quotes-total">{money({ cents: row.sellingTotalCents, currency: row.currency })}</td>
              <td onClick={(event) => event.stopPropagation()}><details className="v2-sales-row-actions"><summary>Actions</summary><button type="button" onClick={() => select(row)}>Open</button></details></td>
            </tr>)}
            {!list.isLoading && rows.length === 0 && <tr><td colSpan={9} className="v2-quotes-empty">Nothing matches that filter.</td></tr>}
            {list.isLoading && <tr><td colSpan={9} className="v2-quotes-empty">Loading Quotes…</td></tr>}
          </tbody>
        </table>
      </div>
      {list.error && <p className="v2-quotes-error">Quotes could not be loaded.</p>}
      <div className="v2-quotes-pagination">
        {cursor && <button type="button" onClick={() => setCursor("")}>First page</button>}
        {list.data?.nextCursor && <button type="button" onClick={() => setCursor(list.data!.nextCursor!)}>Next page</button>}
      </div>
      {/* Legacy list detail replaced by the shared Sales document workspace.
      {legacyId && <section className="v2-quotes-legacy-detail">
        <button type="button" onClick={() => setLegacyId("")}>Close legacy record</button>
        {legacy.isLoading ? <p>Loading read-only legacy record…</p> : legacy.data ? <><h2>{legacy.data.number} <span>Legacy · Read only</span></h2><p>{legacy.data.customerDisplayName} · {legacy.data.lifecycle} · {money({ cents: legacy.data.sellingTotalCents, currency: legacy.data.currency })}</p><p>Legacy Quotes are visible for history and cannot be edited, converted, invoiced, paid, or routed from V2.</p></> : <p>Unable to open the legacy record.</p>}
      </section>}
      */}
    </section>
  );
};
