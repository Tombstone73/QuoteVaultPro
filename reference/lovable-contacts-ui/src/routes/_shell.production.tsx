import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useApp } from "@/lib/app-store";
import { Metric, PageHeader, Panel, Status, Thumb, td, th } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { customers, stationLoad, stations } from "@/lib/mock/data";
import {
  ProductionBoard,
  ProductionCalendar,
  StationDetail,
  StationsGrid,
  ViewToggle,
  PriorityPill,
} from "@/components/app/production-views";
import { fillerJobs, jobsFromDocs, nextActionLabel } from "@/lib/mock/production";

export const Route = createFileRoute("/_shell/production")({
  head: () => ({
    meta: [
      { title: "Production — PrintersHero V2" },
      { name: "description", content: "Line-item level production workspace: overview, station board, scheduling calendar and per-station operator screens." },
      { property: "og:title", content: "Production — PrintersHero V2" },
      { property: "og:description", content: "Track work by line item, not by order — the way a print shop actually runs." },
    ],
  }),
  component: ProductionPage,
});

type View = "overview" | "board" | "calendar" | "stations";

function ProductionPage() {
  const { docs, advanceLine } = useApp();
  const [view, setView] = useState<View>("overview");
  const [station, setStation] = useState<string | null>(null);

  const jobs = docs.filter((d) => d.documentType === "Order").flatMap((d) => d.lines.map((l) => ({ d, l })));
  const prodJobs = useMemo(() => [...jobsFromDocs(docs), ...fillerJobs()], [docs]);

  return (
    <div className="space-y-3 p-4">
      <PageHeader
        title="Production"
        subtitle={`${prodJobs.length} active line items across ${stations.length} stations`}
        actions={
          <ViewToggle
            value={view}
            onChange={(v) => { setView(v as View); setStation(null); }}
            options={[
              { key: "overview", label: "Overview" },
              { key: "board", label: "Board" },
              { key: "calendar", label: "Calendar" },
              { key: "stations", label: "Stations" },
            ]}
          />
        }
      />

      {view === "overview" && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="In production" value={jobs.filter((j) => j.l.routeStep === "Production").length} />
            <Metric label="Awaiting proof" value={jobs.filter((j) => j.l.routeStep === "Proofing").length} tone="warn" />
            <Metric label="Finishing" value={jobs.filter((j) => j.l.routeStep === "Finishing").length} />
            <Metric label="Ready to ship" value={jobs.filter((j) => j.l.routeStep === "Fulfillment").length} tone="ok" />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <Panel title="Job queue" dense>
              <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse">
                <thead><tr><th className={th}>Order</th><th className={th}>Customer</th><th className={th}>Item</th><th className={th + " text-right"}>Qty</th><th className={th}>Step</th><th className={th}>Station</th><th className={th}>Due</th><th className={th + " w-40"} /></tr></thead>
                <tbody>
                  {jobs.map(({ d, l }) => (
                    <tr key={l.id} className="row-h border-t border-border hover:bg-accent/60">
                      <td className={td}><Link to="/sales/$id" params={{ id: d.number }} className="num text-primary hover:underline">#{d.number}</Link></td>
                      <td className={td + " text-muted-foreground"}>{customers.find((c) => c.id === d.customerId)?.name}</td>
                      <td className={td}><div className="flex items-center gap-2"><Thumb label={l.description} className="size-6" /><span className="truncate">{l.description}</span></div></td>
                      <td className={td + " num text-right"}>{l.qty}</td>
                      <td className={td}><Status value={l.routeStep} /></td>
                      <td className={td + " text-muted-foreground"}>{l.station ?? "Unassigned"}</td>
                      <td className={td + " num text-muted-foreground"}>{d.dueDate}</td>
                      <td className={td + " text-right"}>
                        <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => advanceLine(d.id, l.id)}>
                          {nextActionLabel(l.routeStep)}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </Panel>

            <div className="space-y-3">
              <Panel title="Station load">
                <ul className="space-y-2.5">
                  {stationLoad.map((s) => (
                    <li key={s.station}>
                      <div className="flex justify-between text-[12px]"><span>{s.station}</span><span className="num text-muted-foreground">{s.jobs} jobs · {s.hours}h</span></div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded bg-surface-2">
                        <div className="h-full rounded bg-primary" style={{ width: `${Math.min(100, s.hours * 4)}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
              <Panel title="Rush & at-risk" dense>
                <ul className="divide-y divide-border">
                  {prodJobs.filter((j) => j.priority === "Rush" || j.dueTone === "late").slice(0, 6).map((j) => (
                    <li key={j.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[12px]">
                      <div className="min-w-0">
                        <span className="num font-semibold text-primary">#{j.orderNumber}</span>
                        <div className="truncate text-muted-foreground">{j.item}</div>
                      </div>
                      <PriorityPill value={j.priority} />
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          </div>
        </>
      )}

      {view === "board" && <ProductionBoard jobs={prodJobs} />}
      {view === "calendar" && <ProductionCalendar jobs={prodJobs} />}
      {view === "stations" && (station
        ? <StationDetail station={station} jobs={prodJobs} onBack={() => setStation(null)} />
        : <StationsGrid jobs={prodJobs} onOpen={setStation} />)}
    </div>
  );
}
