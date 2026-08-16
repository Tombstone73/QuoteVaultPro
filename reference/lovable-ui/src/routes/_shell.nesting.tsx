import { createFileRoute } from "@tanstack/react-router";
import { Metric, PageHeader, Panel } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_shell/nesting")({
  head: () => ({
    meta: [
      { title: "Nesting — PrintersHero V2" },
      { name: "description", content: "Sheet nesting preview showing how line items are ganged onto a 48x96 substrate and how much waste is left." },
      { property: "og:title", content: "Nesting — PrintersHero V2" },
      { property: "og:description", content: "Gang jobs onto sheets and watch yield in real time." },
    ],
  }),
  component: NestingPage,
});

const parts = [
  { id: "n1", label: "Delta 24×18", x: 2, y: 2, w: 30, h: 22 },
  { id: "n2", label: "Delta 24×18", x: 34, y: 2, w: 30, h: 22 },
  { id: "n3", label: "Delta 24×18", x: 66, y: 2, w: 30, h: 22 },
  { id: "n4", label: "MCD 48×24", x: 2, y: 26, w: 62, h: 30 },
  { id: "n5", label: "Ace pole 18×24", x: 66, y: 26, w: 30, h: 30 },
  { id: "n6", label: "Delta 24×18", x: 2, y: 58, w: 30, h: 22 },
];

function NestingPage() {
  return (
    <div className="space-y-3 p-4">
      <PageHeader title="Nesting" subtitle="4mm Coroplast 48×96 — sheet 1 of 3" actions={<Button size="sm" className="h-8">Send to RIP</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Sheet yield" value="82%" tone="ok" />
        <Metric label="Parts nested" value={parts.length} />
        <Metric label="Waste area" value="5.8 sqft" tone="warn" />
        <Metric label="Est. run time" value="34 min" />
      </div>
      <Panel title="Sheet layout">
        <div className="relative aspect-[2/1] w-full rounded border border-border bg-surface-2">
          {parts.map((p) => (
            <div key={p.id} className="absolute rounded-sm border border-primary/60 bg-primary/15 p-1 text-[10px]"
              style={{ left: `${p.x}%`, top: `${p.y}%`, width: `${p.w}%`, height: `${p.h}%` }}>
              {p.label}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
