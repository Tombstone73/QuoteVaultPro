import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { useApp } from "@/lib/app-store";
import { PageHeader, Status, td, th } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { customers, docGrand, money, type DocumentType } from "@/lib/mock/data";
import { cn } from "@/lib/utils";

const QUOTE_FILTERS = ["All", "Draft", "Sent", "Accepted", "Converted", "Declined"];
const ORDER_FILTERS = ["All", "Open", "In Production", "Ready", "Shipped", "Complete"];

export function SalesList({ type }: { type: DocumentType }) {
  const { docs } = useApp();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("All");
  const filters = type === "Quote" ? QUOTE_FILTERS : ORDER_FILTERS;

  const rows = useMemo(
    () =>
      docs
        .filter((d) => d.documentType === type)
        .filter((d) => filter === "All" || d.status === filter)
        .filter((d) => {
          const name = customers.find((c) => c.id === d.customerId)?.name ?? "";
          const hay = `${d.number} ${d.po} ${name} ${d.rep}`.toLowerCase();
          return hay.includes(q.toLowerCase());
        }),
    [docs, type, filter, q],
  );

  return (
    <div className="space-y-3 p-4">
      <PageHeader
        title={type === "Quote" ? "Quotes" : "Orders"}
        subtitle={`${rows.length} ${type.toLowerCase()}s · ${money(rows.reduce((s, d) => s + docGrand(d), 0))} total value`}
        actions={
          <Button size="sm" className="h-8 gap-1.5"><Plus className="size-4" />New {type}</Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by number, PO, customer…" className="h-8 w-72 pl-7 text-[13px]" />
        </div>
        <div className="flex gap-1">
          {filters.map((f) => (
            <button
              key={f} type="button" onClick={() => setFilter(f)}
              className={cn(
                "rounded-md border px-2 py-1 text-[12px]",
                filter === f ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="panel overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>{type} #</th>
              <th className={th}>Customer</th>
              <th className={th}>PO</th>
              <th className={th}>Rep</th>
              <th className={th + " text-right"}>Lines</th>
              <th className={th}>Due</th>
              <th className={th}>Status</th>
              <th className={th + " text-right"}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="row-h border-t border-border hover:bg-accent/60">
                <td className={td}>
                  <Link to="/sales/$id" params={{ id: d.number }} className="num font-medium text-primary hover:underline">#{d.number}</Link>
                </td>
                <td className={td}>{customers.find((c) => c.id === d.customerId)?.name}</td>
                <td className={td + " num text-muted-foreground"}>{d.po || "—"}</td>
                <td className={td}>{d.rep}</td>
                <td className={td + " num text-right"}>{d.lines.length}</td>
                <td className={td + " num"}>{d.dueDate.replace(", 2026", "")}</td>
                <td className={td}><Status value={d.status} /></td>
                <td className={td + " num text-right font-medium"}>{money(docGrand(d))}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td className="px-3 py-8 text-center text-[13px] text-muted-foreground" colSpan={8}>Nothing matches that filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
