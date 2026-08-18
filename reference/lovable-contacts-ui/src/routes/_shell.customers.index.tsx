import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { PageHeader, Status, td, th } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { customers, money } from "@/lib/mock/data";
import { getPipeline, getProfile, lastTouch, openTaskCount, pipelineValue } from "@/lib/mock/crm";

export const Route = createFileRoute("/_shell/customers/")({
  head: () => ({
    meta: [
      { title: "Customers — PrintersHero V2" },
      { name: "description", content: "Practical print-shop CRM: accounts, contacts, balances, credit and order history without Salesforce bloat." },
      { property: "og:title", content: "Customers — PrintersHero V2" },
      { property: "og:description", content: "Accounts, contacts, balances and order history in one compact list." },
    ],
  }),
  component: CustomersPage,
});

function CustomersPage() {
  const [q, setQ] = useState("");
  const [rep, setRep] = useState("All");
  const reps = ["All", ...Array.from(new Set(customers.map((c) => c.rep)))];
  const rows = customers.filter((c) =>
    (rep === "All" || c.rep === rep) &&
    `${c.name} ${getProfile(c.id).tags.join(" ")} ${c.contacts.map((x) => x.name + x.email + x.phone).join(" ")}`
      .toLowerCase().includes(q.toLowerCase()),
  );
  const totalPipeline = customers.reduce((s, c) => s + pipelineValue(getPipeline(c.id)), 0);
  return (
    <div className="space-y-3 p-4">
      <PageHeader
        title="Customers"
        subtitle={`${customers.length} accounts · ${money(totalPipeline)} open pipeline · ${money(customers.reduce((s, c) => s + c.balance, 0))} outstanding`}
        actions={<Button size="sm" className="h-8 gap-1.5"><Plus className="size-4" />New Customer</Button>}
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Company, contact, tag, email, phone…" className="h-8 w-80 pl-7 text-[13px]" />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Rep</span>
          {reps.map((r) => (
            <Button
              key={r}
              size="sm"
              variant={rep === r ? "default" : "outline"}
              className="h-7 text-[12px]"
              onClick={() => setRep(r)}
            >
              {r}
            </Button>
          ))}
        </div>
      </div>
      <div className="panel overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Company</th>
              <th className={th}>Primary Contact</th>
              <th className={th}>Terms</th>
              <th className={th}>Rep</th>
              <th className={th}>Last Touch</th>
              <th className={th + " text-right"}>Follow-ups</th>
              <th className={th + " text-right"}>Pipeline</th>
              <th className={th + " text-right"}>Open Orders</th>
              <th className={th + " text-right"}>Balance</th>
              <th className={th + " text-right"}>Total Sales</th>
              <th className={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const ct = c.contacts[0];
              const open = openTaskCount(c.id);
              const pipe = pipelineValue(getPipeline(c.id));
              return (
                <tr key={c.id} className="row-h border-t border-border hover:bg-accent/60">
                  <td className={td}>
                    <Link to="/customers/$id" params={{ id: c.id }} className="font-medium text-primary hover:underline">{c.name}</Link>
                  </td>
                  <td className={td + " text-muted-foreground"}>{ct?.name} · <span className="num">{ct?.phone}</span></td>
                  <td className={td}>{c.terms}</td>
                  <td className={td}>{c.rep}</td>
                  <td className={td + " text-muted-foreground"}>{lastTouch(c.id)}</td>
                  <td className={td + " num text-right"}>
                    {open > 0 ? <span className="rounded border border-warn/50 bg-warn/15 px-1.5 py-0.5 text-[11px] font-semibold text-warn">{open}</span> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className={td + " num text-right"}>{pipe ? money(pipe) : <span className="text-muted-foreground">—</span>}</td>
                  <td className={td + " num text-right"}>{c.openOrders}</td>
                  <td className={td + " num text-right"}>{money(c.balance)}</td>
                  <td className={td + " num text-right text-muted-foreground"}>{money(c.totalSales)}</td>
                  <td className={td}><Status value={c.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
