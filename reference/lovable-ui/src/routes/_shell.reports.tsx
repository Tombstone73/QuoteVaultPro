import { createFileRoute } from "@tanstack/react-router";
import { Metric, PageHeader, Panel, td, th } from "@/components/app/primitives";
import { arAging, customers, money, salesByWeek, stationLoad } from "@/lib/mock/data";

export const Route = createFileRoute("/_shell/reports")({
  head: () => ({
    meta: [
      { title: "Reports — PrintersHero V2" },
      { name: "description", content: "Sales trend, AR aging, station utilization and top customers for a commercial print shop." },
      { property: "og:title", content: "Reports — PrintersHero V2" },
      { property: "og:description", content: "The numbers an owner checks before opening the shop." },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const max = Math.max(...salesByWeek.map((s) => s.quotes));
  const ar = arAging.reduce((s, a) => s + a.amount, 0);
  return (
    <div className="space-y-3 p-4">
      <PageHeader title="Reports" subtitle="Rolling six weeks" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Sales (6 wk)" value={money(salesByWeek.reduce((s, x) => s + x.sales, 0))} />
        <Metric label="Quoted (6 wk)" value={money(salesByWeek.reduce((s, x) => s + x.quotes, 0))} />
        <Metric label="Close rate" value="74%" tone="ok" />
        <Metric label="AR outstanding" value={money(ar)} tone="warn" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Sales vs quoted">
          <div className="flex h-48 items-end gap-4">
            {salesByWeek.map((s) => (
              <div key={s.label} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-40 w-full items-end justify-center gap-1">
                  <div className="w-3 rounded-t bg-primary" style={{ height: `${(s.sales / max) * 100}%` }} />
                  <div className="w-3 rounded-t bg-muted" style={{ height: `${(s.quotes / max) * 100}%` }} />
                </div>
                <span className="num text-[11px] text-muted-foreground">{s.label}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="AR aging" dense>
          <table className="w-full border-collapse">
            <thead><tr><th className={th}>Bucket</th><th className={th + " text-right"}>Amount</th><th className={th + " w-40"} /></tr></thead>
            <tbody>
              {arAging.map((a) => (
                <tr key={a.bucket} className="row-h border-t border-border">
                  <td className={td}>{a.bucket}</td>
                  <td className={td + " num text-right"}>{money(a.amount)}</td>
                  <td className={td}><div className="h-1.5 w-32 overflow-hidden rounded bg-surface-2"><div className="h-full rounded bg-primary" style={{ width: `${(a.amount / ar) * 100}%` }} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Station utilization" dense>
          <table className="w-full border-collapse">
            <thead><tr><th className={th}>Station</th><th className={th + " text-right"}>Jobs</th><th className={th + " text-right"}>Hours</th></tr></thead>
            <tbody>
              {stationLoad.map((s) => (
                <tr key={s.station} className="row-h border-t border-border">
                  <td className={td}>{s.station}</td>
                  <td className={td + " num text-right"}>{s.jobs}</td>
                  <td className={td + " num text-right"}>{s.hours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Top customers" dense>
          <table className="w-full border-collapse">
            <thead><tr><th className={th}>Customer</th><th className={th + " text-right"}>Total sales</th><th className={th + " text-right"}>Balance</th></tr></thead>
            <tbody>
              {[...customers].sort((a, b) => b.totalSales - a.totalSales).map((c) => (
                <tr key={c.id} className="row-h border-t border-border">
                  <td className={td}>{c.name}</td>
                  <td className={td + " num text-right"}>{money(c.totalSales)}</td>
                  <td className={td + " num text-right text-muted-foreground"}>{money(c.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
