import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Panel } from "@/components/app/primitives";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CURRENT_USER, stations } from "@/lib/mock/data";

export const Route = createFileRoute("/_shell/settings")({
  head: () => ({
    meta: [
      { title: "Settings — PrintersHero V2" },
      { name: "description", content: "Shop profile, tax, numbering, stations and document defaults for the print shop operating system." },
      { property: "og:title", content: "Settings — PrintersHero V2" },
      { property: "og:description", content: "Shop-wide defaults for documents, tax and stations." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="space-y-3 p-4">
      <PageHeader title="Settings" subtitle={CURRENT_USER.org} />
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Shop profile">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label className="text-[12px]">Company</Label><Input className="h-8 text-[13px]" defaultValue={CURRENT_USER.org} /></div>
            <div className="grid gap-1.5"><Label className="text-[12px]">Phone</Label><Input className="num h-8 text-[13px]" defaultValue="765-555-8800" /></div>
            <div className="grid gap-1.5 sm:col-span-2"><Label className="text-[12px]">Address</Label><Input className="h-8 text-[13px]" defaultValue="1400 Sagamore Pkwy, Lafayette, IN" /></div>
          </div>
        </Panel>
        <Panel title="Documents & tax">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label className="text-[12px]">Next quote number</Label><Input className="num h-8 text-[13px]" defaultValue="10461" /></div>
            <div className="grid gap-1.5"><Label className="text-[12px]">Next order number</Label><Input className="num h-8 text-[13px]" defaultValue="10674" /></div>
            <div className="grid gap-1.5"><Label className="text-[12px]">Default terms</Label><Input className="h-8 text-[13px]" defaultValue="Net 30" /></div>
            <div className="grid gap-1.5"><Label className="text-[12px]">Sales tax rate</Label><Input className="num h-8 text-[13px]" defaultValue="7.00%" /></div>
          </div>
        </Panel>
        <Panel title="Workflow defaults">
          <div className="space-y-2.5">
            {["Require proof approval before production", "Auto-create draft invoice with each order", "Allow partial pickups", "Warn when selling price is below calculated price"].map((s, i) => (
              <div key={s} className="flex items-center justify-between text-[13px]"><span>{s}</span><Switch defaultChecked={i !== 3} /></div>
            ))}
          </div>
        </Panel>
        <Panel title="Stations">
          <ul className="flex flex-wrap gap-2">
            {stations.map((s) => <li key={s} className="rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[12px]">{s}</li>)}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
