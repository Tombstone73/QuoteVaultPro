import { AlertTriangle, Calculator, CheckCircle2, Info, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { materials, money } from "@/lib/mock/data";
import {
  allOptions, computePreview, validateDraft,
  type Finding, type OptionState, type PreviewInputs, type ProductDraft,
} from "@/lib/mock/product-editor";
import { Cell, Chip, Picker } from "./fields";

/**
 * Sticky configuration preview. In the real app these numbers come back from
 * the server pricing / resolution services — the UI only renders the result.
 */
export function PricingPreview({
  draft, states, inputs, setInputs, sel, setSel, onJump,
}: {
  draft: ProductDraft;
  states: Record<string, OptionState>;
  inputs: PreviewInputs;
  setInputs: (i: PreviewInputs) => void;
  sel: Record<string, string>;
  setSel: (s: Record<string, string>) => void;
  onJump?: ((section: string) => void) | undefined;
}) {
  const result = computePreview(draft, inputs, sel);
  const findings = validateDraft(draft);
  const visible = allOptions(draft).filter((r) => states[r.option.id]?.visible);
  const mat = materials.find((m) => m.id === draft.material.primaryMaterialId);

  return (
    <div className="space-y-3">
      <Card icon={<Calculator className="size-3.5 text-primary" />} title="Configuration preview" note="Server-calculated">
        {draft.measurements === "Dimensions required" && (
          <div className="grid grid-cols-3 gap-2">
            <Cell label="Width"><Input className="num h-8 text-[13px]" value={inputs.w} onChange={(e) => setInputs({ ...inputs, w: e.target.value })} /></Cell>
            <Cell label="Height"><Input className="num h-8 text-[13px]" value={inputs.h} onChange={(e) => setInputs({ ...inputs, h: e.target.value })} /></Cell>
            <Cell label="Qty"><Input className="num h-8 text-[13px]" value={inputs.qty} onChange={(e) => setInputs({ ...inputs, qty: e.target.value })} /></Cell>
          </div>
        )}

        <div className="mt-2.5 space-y-2">
          {visible.map(({ group, option }) => {
            const s = states[option.id]!;
            const items = option.choices.map((c) => c.label);
            return (
              <Cell key={option.id} label={group.name === option.label ? option.label : `${group.name} → ${option.label}`}>
                {items.length > 0 ? (
                  <Picker value={sel[option.id] ?? s.forcedDefault ?? ""} items={items} onChange={(v) => setSel({ ...sel, [option.id]: v })} />
                ) : (
                  <Input className="h-8 text-[13px]" placeholder="Free text at quote time" value={sel[option.id] ?? ""} onChange={(e) => setSel({ ...sel, [option.id]: e.target.value })} />
                )}
                {s.conditional && <Chip tone="accent">Shown by condition</Chip>}
              </Cell>
            );
          })}
        </div>

        {result.blockers.length > 0 && (
          <p className="mt-2.5 rounded-md border border-warn/50 bg-warn/10 px-2.5 py-2 text-[12px] text-warn">
            Needs input before a price resolves: {result.blockers.join(", ")}.
          </p>
        )}

        <dl className="mt-2.5 space-y-1 border-t border-border pt-2 text-[12px]">
          <Row label="Area" value={`${result.sqft.toFixed(2)} sq ft`} />
          {draft.productType === "Sheet" && (
            <>
              <Row label="Per sheet" value={`${result.perSheet} up`} muted />
              <Row label="Computed sheets" value={String(result.sheets)} />
            </>
          )}
          {result.tier && <Row label="Pricing tier" value={result.tier.label} />}
          {result.matrixSelection && <Row label="Matrix selection" value={result.matrixSelection} />}
          {result.rate && <Row label="Rate" value={`${money(result.rate.value)} ${result.rate.unit}`} />}
          <Row label="Base" value={money(result.base)} />
          {result.adders.map((a, i) => <Row key={i} label={a.label} value={money(a.amount)} muted />)}
          {result.adders.length === 0 && <Row label="Option impacts" value={money(0)} muted />}
          <Row label="Minimum charge" value={`${money(result.minimum)} — ${result.minimumApplied ? "applied" : "not applied"}`} muted />
        </dl>
        <div className="mt-2 flex items-end justify-between border-t border-border pt-2">
          <span className="text-[12px] text-muted-foreground">Unit price</span>
          <span className="num text-[14px] font-semibold">{money(result.unitPrice)}</span>
        </div>
        <div className="flex items-end justify-between">
          <span className="text-[12px] text-muted-foreground">Line total</span>
          <span className="num text-[19px] font-bold">{money(result.total)}</span>
        </div>
      </Card>

      <Card title="Material resolution">
        <dl className="space-y-1 text-[12px]">
          <Row label="Primary material" value={mat?.name ?? "—"} />
          <Row label="Inventory unit" value={mat?.unit ?? "—"} muted />
          {draft.productType === "Sheet" && <Row label="Sheet size" value={`${draft.pricing.sheetWidth ?? 48} × ${draft.pricing.sheetLength ?? 96}`} muted />}
          {result.recipe.map((r, i) => <Row key={i} label={r.label} value={r.detail} muted={!r.active} />)}
          {result.recipe.length === 0 && <Row label="Recipe" value="No lines" muted />}
        </dl>
      </Card>

      <Card title="Production resolution">
        <dl className="space-y-1 text-[12px]">
          {result.production.map((p) => (
            <div key={p.name} className="flex items-baseline justify-between gap-3">
              <dt className={p.required ? "" : "text-muted-foreground"}>{p.name}<span className="ml-1.5 text-[11px] text-muted-foreground">{p.reason}</span></dt>
              <dd className={`shrink-0 text-[12px] font-medium ${p.required ? "text-ok" : "text-muted-foreground"}`}>{p.required ? "Required" : "Not required"}</dd>
            </div>
          ))}
          {result.production.length === 0 && <Row label="Units" value="None" muted />}
          <Row label="Route" value={draft.routing.policy === "Route required" ? draft.routing.template : draft.routing.policy} muted />
        </dl>
      </Card>

      <Card title="Weight resolution">
        <dl className="space-y-1 text-[12px]">
          {result.weight.map((w) => <Row key={w.label} label={w.label} value={w.value} muted />)}
        </dl>
      </Card>

      <Card title="Validation" note={`${findings.length} finding${findings.length === 1 ? "" : "s"}`}>
        <div className="space-y-2">
          {findings.length === 0 && (
            <p className="flex items-center gap-1.5 text-[12px] text-ok"><CheckCircle2 className="size-3.5" />No issues — ready to publish.</p>
          )}
          {findings.map((f) => <FindingRow key={f.code + f.message} f={f} onJump={onJump} />)}
        </div>
      </Card>
    </div>
  );
}

function Card({ title, icon, note, children }: { title: string; icon?: React.ReactNode; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        {icon}
        <h2 className="text-[12px] font-bold uppercase tracking-wide">{title}</h2>
        {note && <span className="num ml-auto text-[11px] text-muted-foreground">{note}</span>}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={muted ? "text-muted-foreground" : ""}>{label}</dt>
      <dd className="num shrink-0 text-right">{value}</dd>
    </div>
  );
}

function FindingRow({ f, onJump }: { f: Finding; onJump?: ((s: string) => void) | undefined }) {
  const Icon = f.severity === "error" ? XCircle : f.severity === "warning" ? AlertTriangle : Info;
  const tone = f.severity === "error" ? "text-late" : f.severity === "warning" ? "text-warn" : "text-muted-foreground";
  return (
    <div className="flex gap-2">
      <Icon className={`mt-0.5 size-3.5 shrink-0 ${tone}`} />
      <div className="min-w-0">
        <p className="text-[12px] leading-snug">{f.message}</p>
        <button type="button" onClick={() => onJump?.(f.section)} className="num text-[10px] uppercase tracking-wide text-muted-foreground hover:text-primary hover:underline">
          {f.code} · go to {f.section}
        </button>
      </div>
    </div>
  );
}
