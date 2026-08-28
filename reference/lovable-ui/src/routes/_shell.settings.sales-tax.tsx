import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { AuditLine, EmptyBlock, ReadyChip, Row, SaveBar, Section, SettingsPage } from "@/components/app/settings/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { destinationJurisdictions, homeJurisdiction } from "@/lib/mock/settings";

export const Route = createFileRoute("/_shell/settings/sales-tax")({
  head: () => ({
    meta: [
      { title: "Sales Tax — PrintersHero V2 Settings" },
      { name: "description", content: "Configure the jurisdictions PrintersHero uses to resolve tax for pickup, shipping and local delivery." },
      { property: "og:title", content: "Sales Tax — PrintersHero V2 Settings" },
      { property: "og:description", content: "Tenant-configured jurisdictions for taxable customer documents." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SalesTaxPage,
});

const input = "h-8 text-[13px]";

function SalesTaxPage() {
  return (
    <SettingsPage
      title="Sales Tax"
      description="Configure the jurisdictions PrintersHero uses to resolve tax for taxable customer documents. Tax is always calculated on the server when a document is priced."
      actions={<ReadyChip state="attention" />}
    >
      <Section title="Fulfillment coverage" hint="Each way you deliver work needs a jurisdiction before taxable documents can be sent.">
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="panel p-3">
            <div className="text-[13px] font-semibold">Pickup</div>
            <div className="mt-1.5"><ReadyChip state="ready" /></div>
            <p className="mt-1 text-[12px] text-muted-foreground">{homeJurisdiction.name} · {homeJurisdiction.rate}%</p>
          </div>
          <div className="panel p-3">
            <div className="text-[13px] font-semibold">Shipping</div>
            <div className="mt-1.5"><ReadyChip state="not-configured" /></div>
            <p className="mt-1 text-[12px] text-muted-foreground">Shipped documents cannot be sent until a destination jurisdiction exists.</p>
          </div>
          <div className="panel p-3">
            <div className="text-[13px] font-semibold">Local delivery</div>
            <div className="mt-1.5"><ReadyChip state="not-configured" /></div>
            <p className="mt-1 text-[12px] text-muted-foreground">Delivered documents fall back to no tax until configured.</p>
          </div>
        </div>
      </Section>

      <Section title="Home / business jurisdiction" hint="Used for pickup and for work fulfilled at your own location.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Row label="Jurisdiction name"><Input className={input} defaultValue={homeJurisdiction.name} /></Row>
          <Row label="Country"><Input className={input} defaultValue={homeJurisdiction.country} /></Row>
          <Row label="Region / state"><Input className={input} defaultValue={homeJurisdiction.region} /></Row>
          <Row label="Postal code" hint="Optional. Use when your local rate differs from the state rate.">
            <Input className={`num ${input}`} defaultValue={homeJurisdiction.postal} />
          </Row>
          <Row label="Tax rate %"><Input className={`num ${input}`} defaultValue={homeJurisdiction.rate} /></Row>
          <div className="flex items-end">
            <label className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-surface-2/50 px-3 py-1.5 text-[13px]">
              <span>Active for pickup</span>
              <Switch defaultChecked={homeJurisdiction.activeForPickup} />
            </label>
          </div>
        </div>
        <AuditLine>Last changed by Dale Hensley · Feb 14, 2026</AuditLine>
      </Section>

      <Section
        title="Destination jurisdictions"
        hint="Used for shipping and local delivery. PrintersHero does not look tax rates up for you — you decide which jurisdictions you collect for."
        action={<Button size="sm" variant="outline" className="h-7 gap-1.5 text-[12px]"><Plus className="size-3.5" /> Add jurisdiction</Button>}
      >
        {destinationJurisdictions.length === 0 ? (
          <EmptyBlock
            title="No destination jurisdictions have been added"
            body="Until a destination jurisdiction exists, quotes and orders that ship or are delivered cannot resolve tax and cannot be sent. Add the states or postal areas you collect tax for."
            action={<Button size="sm" className="h-8 gap-1.5 text-[12px]"><Plus className="size-3.5" /> Add jurisdiction</Button>}
          />
        ) : (
          <div className="panel overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Jurisdiction</th>
                  <th className="px-3 py-2">Region</th>
                  <th className="px-3 py-2">Postal coverage</th>
                  <th className="px-3 py-2">Rate</th>
                  <th className="px-3 py-2">Applies to</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {destinationJurisdictions.map((j) => (
                  <tr key={j.id} className="text-[13px]">
                    <td className="px-3 py-2 font-medium">{j.name}</td>
                    <td className="px-3 py-2">{j.region}</td>
                    <td className="px-3 py-2">{j.coverage}</td>
                    <td className="num px-3 py-2">{j.rate}%</td>
                    <td className="px-3 py-2">{j.appliesTo}</td>
                    <td className="px-3 py-2"><ReadyChip state={j.status} /></td>
                    <td className="px-3 py-2 text-right"><Button size="sm" variant="outline" className="h-7 text-[12px]">Edit</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <SaveBar note="Tax is resolved on the server when a document is priced." />
    </SettingsPage>
  );
}
