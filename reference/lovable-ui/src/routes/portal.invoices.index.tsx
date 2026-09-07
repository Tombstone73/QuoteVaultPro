import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Receipt, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, Money, Notice, PortalPage, Section, StatusPill } from "@/components/portal/ui";
import { invoices } from "@/lib/portal/data";
import { shortDate } from "@/lib/portal/service";
import { usePortalStore } from "@/lib/portal/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/portal/invoices/")({
  head: () => ({
    meta: [
      { title: "Invoices — Hensley Print Co." },
      { name: "description", content: "View open and paid invoices, download PDFs and settle several invoices in one payment." },
      { property: "og:title", content: "Invoices — Hensley Print Co." },
      { property: "og:description", content: "Pay several invoices with a single payment." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InvoicesPage,
});

function InvoicesPage() {
  const navigate = useNavigate();
  const { paidInvoices, selectedForPayment, setSelectedForPayment } = useSelection();
  const [tab, setTab] = useState<"open" | "paid">("open");
  const [q, setQ] = useState("");

  const list = invoices.map((i) => {
    const extra = paidInvoices[i.id] ?? 0;
    const balance = Math.max(0, i.balance - extra);
    return { ...i, paid: i.paid + extra, balance, status: balance === 0 ? ("Paid" as const) : i.status };
  });

  const rows = list.filter(
    (i) =>
      (tab === "open" ? i.balance > 0 : i.balance === 0) &&
      (i.number.toLowerCase().includes(q.toLowerCase()) ||
        i.orderNumber.toLowerCase().includes(q.toLowerCase()) ||
        i.po.toLowerCase().includes(q.toLowerCase())),
  );

  const selectedRows = rows.filter((i) => selectedForPayment.includes(i.id));
  const selectedTotal = selectedRows.reduce((s, i) => s + i.balance, 0);

  return (
    <PortalPage title="Invoices" description="Select any open invoices and pay them together.">
      <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
        <div className="inline-flex rounded-lg border border-border p-0.5">
          {(["open", "paid"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-3 py-1.5 text-[13px] font-medium capitalize transition-colors",
                tab === t ? "bg-accent text-foreground" : "text-muted-foreground",
              )}
            >
              {t === "open" ? "Open" : "Paid history"}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Invoice, order or PO number" className="pl-9" aria-label="Search invoices" />
        </div>
      </div>

      <Section className="mt-4" bare>
        {rows.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={tab === "open" ? "No open invoices" : "No paid invoices yet"}
            message={tab === "open" ? "You're all paid up. Nothing is currently outstanding." : "Paid invoices stay here for your records."}
          />
        ) : (
          <>
            <table className="hidden w-full border-collapse md:table">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="w-10 px-5 py-2.5" />
                  <th className="px-3 py-2.5 font-semibold">Invoice</th>
                  <th className="px-3 py-2.5 font-semibold">Order / PO</th>
                  <th className="px-3 py-2.5 font-semibold">Due</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Total</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Balance</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} className="border-b border-border last:border-0 hover:bg-accent/40">
                    <td className="px-5 py-3">
                      {i.balance > 0 && (
                        <Checkbox
                          checked={selectedForPayment.includes(i.id)}
                          onCheckedChange={(v) =>
                            setSelectedForPayment(v ? [...selectedForPayment, i.id] : selectedForPayment.filter((x: string) => x !== i.id))
                          }
                          aria-label={`Select ${i.number}`}
                        />
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Link to="/portal/invoices/$id" params={{ id: i.id }} className="text-sm font-medium text-primary hover:underline">
                        {i.number}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-[13px] text-muted-foreground">
                      {i.orderNumber} · {i.po}
                    </td>
                    <td className="px-3 py-3 text-[13px] text-muted-foreground">{shortDate(i.dueOn)}</td>
                    <td className="px-3 py-3"><StatusPill value={i.status} /></td>
                    <td className="px-3 py-3 text-right text-[13px]"><Money value={i.total} /></td>
                    <td className="px-3 py-3 text-right text-[13px] font-medium"><Money value={i.balance} /></td>
                    <td className="px-5 py-3 text-right">
                      <Button size="sm" variant="ghost" className="h-8" asChild>
                        <a href="#" onClick={(e) => e.preventDefault()}>PDF</a>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="divide-y divide-border md:hidden">
              {rows.map((i) => (
                <li key={i.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 px-4 py-3">
                  <div className="pt-0.5">
                    {i.balance > 0 && (
                      <Checkbox
                        checked={selectedForPayment.includes(i.id)}
                        onCheckedChange={(v) =>
                          setSelectedForPayment(v ? [...selectedForPayment, i.id] : selectedForPayment.filter((x: string) => x !== i.id))
                        }
                        aria-label={`Select ${i.number}`}
                      />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <Link to="/portal/invoices/$id" params={{ id: i.id }} className="truncate text-sm font-semibold">
                        {i.number}
                      </Link>
                      <Money value={i.balance} className="shrink-0 text-sm font-semibold" />
                    </div>
                    <p className="truncate text-[12px] text-muted-foreground">
                      {i.orderNumber} · PO {i.po} · Due {shortDate(i.dueOn)}
                    </p>
                    <div className="mt-1.5"><StatusPill value={i.status} /></div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      {tab === "open" && rows.some((i) => i.status === "Overdue") && (
        <div className="mt-4">
          <Notice tone="danger" title="Some invoices are past due">
            Paying the overdue balance keeps new work moving without a hold.
          </Notice>
        </div>
      )}

      {/* Sticky payment bar */}
      {selectedRows.length > 0 && (
        <div className="fixed inset-x-0 bottom-14 z-40 border-t border-border bg-card/95 px-4 py-3 backdrop-blur lg:bottom-0">
          <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {selectedRows.length} invoice{selectedRows.length === 1 ? "" : "s"} selected
              </p>
              <p className="truncate text-[12px] text-muted-foreground">
                One payment of <Money value={selectedTotal} /> allocated across your selection
              </p>
            </div>
            <Button onClick={() => navigate({ to: "/portal/pay" })}>Pay selected invoices</Button>
          </div>
        </div>
      )}
    </PortalPage>
  );
}

/** Selection lives in the portal store so the payment screen can read it. */
function useSelection() {
  const store = usePortalStore();
  return useMemo(
    () => ({
      paidInvoices: store.paidInvoices,
      selectedForPayment: store.selectedForPayment,
      setSelectedForPayment: store.setSelectedForPayment,
    }),
    [store],
  );
}
