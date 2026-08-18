import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Status } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { integrations } from "@/lib/mock/data";

export const Route = createFileRoute("/_shell/integrations")({
  head: () => ({
    meta: [
      { title: "Integrations — PrintersHero V2" },
      { name: "description", content: "Accounting, payments, shipping, RIP and workstation bridge connections that keep the shop in sync." },
      { property: "og:title", content: "Integrations — PrintersHero V2" },
      { property: "og:description", content: "Connected systems and their live status." },
    ],
  }),
  component: IntegrationsPage,
});

function IntegrationsPage() {
  return (
    <div className="space-y-3 p-4">
      <PageHeader title="Integrations" subtitle={`${integrations.filter((i) => i.status === "Connected").length} of ${integrations.length} connected`} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {integrations.map((i) => (
          <div key={i.name} className="panel flex items-start justify-between gap-3 p-3">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold">{i.name}</div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{i.category}</div>
              <div className="mt-1.5 flex items-center gap-2"><Status value={i.status} />{i.detail && <span className="truncate text-[12px] text-muted-foreground">{i.detail}</span>}</div>
            </div>
            <Button size="sm" variant="outline" className="h-7 shrink-0 text-[12px]">{i.status === "Connected" ? "Manage" : "Connect"}</Button>
          </div>
        ))}
      </div>
    </div>
  );
}
