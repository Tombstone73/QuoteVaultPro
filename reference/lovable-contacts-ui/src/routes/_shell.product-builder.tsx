import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ChevronRight, GripVertical, Plus } from "lucide-react";
import { PageHeader, Panel, td, th } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { materials, money, routeTemplates } from "@/lib/mock/data";

export const Route = createFileRoute("/_shell/product-builder")({
  head: () => ({
    meta: [
      { title: "Product Builder — PrintersHero V2" },
      { name: "description", content: "Build a configurable print product step by step: basics, options, pricing rules, materials and production route, with a live customer preview." },
      { property: "og:title", content: "Product Builder — PrintersHero V2" },
      { property: "og:description", content: "Guided builder with a live preview of what the customer will see." },
    ],
  }),
  component: BuilderPage,
});

const steps = ["Basics", "Options", "Pricing", "Materials", "Route", "Preview"] as const;

function BuilderPage() {
  const [step, setStep] = useState<(typeof steps)[number]>("Basics");
  const [name, setName] = useState("4mm Coroplast Sign");
  const [pricing, setPricing] = useState("Per Square Foot");
  const [rate, setRate] = useState("4.75");
  const [setupFee, setSetupFee] = useState("15");
  const [opts, setOpts] = useState<{ id: string; label: string; type: string; choices: string[]; priceImpact: string }[]>([
    { id: "o1", label: "Size", type: "Size", choices: ['24" x 18"', '36" x 24"', '48" x 24"'], priceImpact: "Area matrix" },
    { id: "o2", label: "Sides", type: "Select", choices: ["Single", "Double"], priceImpact: "+65% on double" },
    { id: "o3", label: "Flutes", type: "Select", choices: ["Vertical", "Horizontal"], priceImpact: "None" },
    { id: "o4", label: "Grommets", type: "Number", choices: ["0", "2", "4"], priceImpact: "$0.35 each" },
  ]);
  const [route, setRoute] = useState(routeTemplates[0]!.name);
  const [storefront, setStorefront] = useState(true);
  const sqft = 3;

  return (
    <div className="space-y-3 p-4">
      <PageHeader
        title="Product Builder"
        subtitle="Define once — quoting, pricing and production routing all follow."
        actions={<>
          <Button size="sm" variant="outline" className="h-8">Save Draft</Button>
          <Button size="sm" className="h-8" onClick={() => toast.success(`${name} published`)}>Publish</Button>
        </>}
      />

      <div className="flex items-center gap-1 border-b border-border pb-2 text-[12px]">
        {steps.map((s, i) => (
          <button key={s} onClick={() => setStep(s)} className={`flex items-center gap-1 rounded px-2 py-1 ${step === s ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            <span className="num opacity-60">{i + 1}</span>{s}
            {i < steps.length - 1 && <ChevronRight className="size-3 opacity-40" />}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {step === "Basics" && (
            <Panel title="Basics">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5"><Label className="text-[12px]">Product name</Label><Input className="h-8 text-[13px]" value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div className="grid gap-1.5"><Label className="text-[12px]">Category</Label>
                  <Select defaultValue="Rigid Signs"><SelectTrigger className="h-8 text-[13px]"><SelectValue /></SelectTrigger>
                    <SelectContent>{["Banners", "Rigid Signs", "Decals", "Vehicle", "Apparel"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5 sm:col-span-2"><Label className="text-[12px]">Customer-facing description</Label><Input className="h-8 text-[13px]" defaultValue="Durable corrugated plastic sign, printed full color, indoor/outdoor." /></div>
                <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 sm:col-span-2">
                  <div><div className="text-[13px] font-medium">Show in customer storefront</div><div className="text-[12px] text-muted-foreground">Portal users can configure and order this product directly.</div></div>
                  <Switch checked={storefront} onCheckedChange={setStorefront} />
                </div>
              </div>
            </Panel>
          )}

          {step === "Options" && (
            <Panel title="Options" dense action={<Button size="sm" variant="outline" className="h-7 gap-1 text-[12px]" onClick={() => setOpts([...opts, { id: `o${opts.length + 1}`, label: "New option", type: "Select", choices: ["A", "B"], priceImpact: "None" }])}><Plus className="size-3.5" />Add option</Button>}>
              <table className="w-full border-collapse">
                <thead><tr><th className={th + " w-8"} /><th className={th}>Label</th><th className={th}>Type</th><th className={th}>Choices</th><th className={th}>Price impact</th></tr></thead>
                <tbody>
                  {opts.map((o) => (
                    <tr key={o.id} className="row-h border-t border-border">
                      <td className={td + " text-muted-foreground"}><GripVertical className="size-3.5" /></td>
                      <td className={td}><Input className="h-7 border-transparent text-[13px] hover:border-border" defaultValue={o.label} /></td>
                      <td className={td + " text-muted-foreground"}>{o.type}</td>
                      <td className={td + " text-muted-foreground"}>{o.choices.join(", ")}</td>
                      <td className={td}>{o.priceImpact}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}

          {step === "Pricing" && (
            <Panel title="Pricing rules">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1.5 sm:col-span-3"><Label className="text-[12px]">Pricing method</Label>
                  <Select value={pricing} onValueChange={setPricing}><SelectTrigger className="h-8 text-[13px]"><SelectValue /></SelectTrigger>
                    <SelectContent>{["Per Square Foot", "Flat Rate", "Tiered Quantity", "Per Linear Foot"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5"><Label className="text-[12px]">Rate</Label><Input className="num h-8 text-[13px]" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
                <div className="grid gap-1.5"><Label className="text-[12px]">Setup fee</Label><Input className="num h-8 text-[13px]" value={setupFee} onChange={(e) => setSetupFee(e.target.value)} /></div>
                <div className="grid gap-1.5"><Label className="text-[12px]">Minimum charge</Label><Input className="num h-8 text-[13px]" defaultValue="35" /></div>
              </div>
              <div className="mt-3 rounded-md border border-border bg-surface-2 p-3 text-[12px] text-muted-foreground">
                Quantity breaks: 1–9 list · 10–49 <span className="num">-8%</span> · 50–199 <span className="num">-14%</span> · 200+ <span className="num">-21%</span>
              </div>
            </Panel>
          )}

          {step === "Materials" && (
            <Panel title="Linked materials" dense>
              <table className="w-full border-collapse">
                <thead><tr><th className={th}>Material</th><th className={th}>Vendor</th><th className={th + " text-right"}>Cost</th><th className={th + " text-right"}>On hand</th><th className={th + " w-24"}>Default</th></tr></thead>
                <tbody>
                  {materials.map((m, i) => (
                    <tr key={m.id} className="row-h border-t border-border">
                      <td className={td}>{m.name}</td>
                      <td className={td + " text-muted-foreground"}>{m.vendor}</td>
                      <td className={td + " num text-right"}>{money(m.cost)}</td>
                      <td className={td + " num text-right"}>{m.onHand}</td>
                      <td className={td}><Switch defaultChecked={i === 0} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}

          {step === "Route" && (
            <Panel title="Default production route">
              <div className="grid gap-1.5 max-w-xs"><Label className="text-[12px]">Route template</Label>
                <Select value={route} onValueChange={setRoute}><SelectTrigger className="h-8 text-[13px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{routeTemplates.map((r) => <SelectItem key={r.id} value={r.name}>{r.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <ol className="mt-3 flex flex-wrap items-center gap-2">
                {(routeTemplates.find((r) => r.name === route)?.steps ?? []).map((s, i) => (
                  <li key={s.name} className="flex items-center gap-2">
                    <span className="rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[12px]"><span className="num mr-1 text-muted-foreground">{i + 1}</span>{s.name}</span>
                    <ChevronRight className="size-3.5 text-muted-foreground" />
                  </li>
                ))}
              </ol>
            </Panel>
          )}

          {step === "Preview" && (
            <Panel title="Publish checklist">
              <ul className="space-y-1.5 text-[13px]">
                <li>Pricing method set — {pricing} at <span className="num">{money(Number(rate))}</span>/sqft</li>
                <li>{opts.length} customer options configured</li>
                <li>Route: {route}</li>
                <li>Storefront visibility: {storefront ? "Visible" : "Internal only"}</li>
              </ul>
            </Panel>
          )}
        </div>

        <Panel title="Live customer preview" className="h-fit lg:sticky lg:top-4">
          <div className="rounded-md border border-border bg-surface-2 p-3">
            <div className="text-[14px] font-semibold">{name}</div>
            <div className="mt-0.5 text-[12px] text-muted-foreground">Configure your sign</div>
            <div className="mt-3 space-y-2">
              {opts.slice(0, 4).map((o) => (
                <div key={o.id} className="grid gap-1"><span className="text-[11px] uppercase tracking-wide text-muted-foreground">{o.label}</span>
                  <div className="rounded border border-border bg-background px-2 py-1 text-[13px]">{o.choices[0]}</div>
                </div>
              ))}
              <div className="grid gap-1"><span className="text-[11px] uppercase tracking-wide text-muted-foreground">Quantity</span><div className="num rounded border border-border bg-background px-2 py-1 text-[13px]">50</div></div>
            </div>
            <div className="mt-3 flex items-end justify-between border-t border-border pt-2">
              <div className="text-[11px] text-muted-foreground">{sqft} sqft × <span className="num">{money(Number(rate))}</span> × 50 + setup</div>
              <div className="num text-[17px] font-semibold">{money(sqft * Number(rate || 0) * 50 + Number(setupFee || 0))}</div>
            </div>
            <Button size="sm" className="mt-3 h-8 w-full">Add to Cart</Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
