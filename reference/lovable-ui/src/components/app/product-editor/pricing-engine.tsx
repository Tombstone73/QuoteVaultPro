import { ChevronDown, ChevronRight, ExternalLink, HelpCircle, Library, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  PRICING_PROFILES, PRICING_VARIABLES, uid,
  type PricingConfig, type ProductDraft, type Tier,
} from "@/lib/mock/product-editor";
import { FormulaPicker } from "@/components/app/formula/picker";
import { ExpressionView } from "@/components/app/formula/expression-editor";
import { InputValueFields } from "@/components/app/formula/inputs-editor";
import { currentRevision, myFormulas, type Formula } from "@/lib/mock/formulas";
import { Cell, Chip, Picker, Segmented, Toggle } from "./fields";

export function PricingEngine({ draft, patch }: { draft: ProductDraft; patch: (fn: (d: ProductDraft) => void) => void }) {
  const p = draft.pricing;
  const setP = (fn: (p: PricingConfig) => void) => patch((d) => fn(d.pricing));
  const [tierTab, setTierTab] = useState<"qty" | "size">("qty");
  const [varsOpen, setVarsOpen] = useState(false);

  const tiers = tierTab === "qty" ? p.qtyTiers : p.sizeTiers;
  const addTier = () => setP((c) => {
    const t: Tier = { id: uid("t"), from: "", to: "", adjust: "0%" };
    (tierTab === "qty" ? c.qtyTiers : c.sizeTiers).push(t);
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={p.mode}
          onChange={(v) => setP((c) => { c.mode = v; })}
          items={[{ id: "Basic" as const, label: "Basic" }, { id: "Advanced" as const, label: "Advanced" }]}
        />
        <span className="text-[11px] text-muted-foreground">
          {p.mode === "Basic" ? "Rates and minimums only — enough for most products." : "Formula sources, sheet nesting and tier tables."}
        </span>
        <HelpCircle className="size-3.5 text-muted-foreground" />
      </div>

      <div className="grid gap-3 @container sm:grid-cols-3">
        <Cell label="Rate per sq ft"><MoneyInput value={p.ratePerSqFt} onChange={(v) => setP((c) => { c.ratePerSqFt = v; })} /></Cell>
        <Cell label="Rate per piece"><MoneyInput value={p.ratePerPiece} onChange={(v) => setP((c) => { c.ratePerPiece = v; })} /></Cell>
        <Cell label="Minimum charge"><MoneyInput value={p.minimumCharge} onChange={(v) => setP((c) => { c.minimumCharge = v; })} /></Cell>
        <Cell label="Tier basis" hint="Which quantity chooses the price break.">
          <Picker value={p.tierBasis} items={["Computed Sheet Usage", "Customer Quantity", "Total Sq Ft"] as const} onChange={(v) => setP((c) => { c.tierBasis = v; })} />
        </Cell>
        <Cell label="Units"><Picker value={p.units} items={["Imperial", "Metric"] as const} onChange={(v) => setP((c) => { c.units = v; })} /></Cell>
      </div>

      {p.mode === "Advanced" && (
        <>
          <div className="space-y-2">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Price source</div>
            <SourceCard
              active={p.source === "library"}
              onSelect={() => setP((c) => { c.source = "library"; })}
              title="Formula"
              badge="Formula Library"
            >
              <FormulaSource productName={draft.name} value={p.library} onChange={(v) => setP((c) => { c.library = v; })} />
            </SourceCard>
            <SourceCard active={p.source === "profile"} onSelect={() => setP((c) => { c.source = "profile"; })} title="Pricing profile">
              <Picker value={p.profile} items={PRICING_PROFILES} onChange={(v) => setP((c) => { c.profile = v; })} />
            </SourceCard>
            <SourceCard active={p.source === "formula"} onSelect={() => setP((c) => { c.source = "formula"; })} title="Custom formula" badge="Advanced">
              <Input className="num h-8 text-[12px]" value={p.formula} onChange={(e) => setP((c) => { c.formula = e.target.value; })} />
              <p className="mt-1 text-[11px] text-muted-foreground">Use lowercase variables such as w, h, q, sqft, total_sqft, base_price. Use ceil(…), round(…), max(…) — not Math.ceil(…).</p>
              <button type="button" onClick={() => setVarsOpen(!varsOpen)} className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-primary hover:underline">
                {varsOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}Available pricing variables
              </button>
              {varsOpen && (
                <dl className="mt-1.5 grid gap-x-4 gap-y-1 rounded-md border border-border bg-surface-2 p-2.5 text-[11px] sm:grid-cols-2">
                  {PRICING_VARIABLES.map(([name, desc]) => (
                    <div key={name} className="flex gap-2"><dt className="num shrink-0 font-medium">{name}</dt><dd className="text-muted-foreground">{desc}</dd></div>
                  ))}
                </dl>
              )}
            </SourceCard>
          </div>

          <Toggle
            label="Allow rotation / mixed sheet layout"
            hint="Sheet-yield formulas use normal orientation only when off. When on, pricing may use rotated and mixed layouts."
            checked={p.allowRotation}
            onChange={(v) => setP((c) => { c.allowRotation = v; })}
          />

          <div className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Segmented
                value={tierTab}
                onChange={setTierTab}
                items={[
                  { id: "qty" as const, label: `Quantity tiers (${p.qtyTiers.length})` },
                  { id: "size" as const, label: `Size tiers (${p.sizeTiers.length})` },
                ]}
              />
              <Button size="sm" variant="outline" className="h-7 gap-1 text-[12px]" onClick={addTier}>
                <Plus className="size-3.5" />Add {tierTab === "qty" ? "qty" : "size"} tier
              </Button>
            </div>
            {tiers.length === 0 ? (
              <p className="mt-2.5 text-[12px] italic text-muted-foreground">No tiers — every quantity prices at list.</p>
            ) : (
              <div className="mt-2.5 space-y-1.5">
                <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <span>From</span><span>To</span><span>Adjustment</span><span className="w-8" />
                </div>
                {tiers.map((t, i) => (
                  <div key={t.id} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
                    <Input className="num h-8 text-[13px]" value={t.from} onChange={(e) => setP((c) => { (tierTab === "qty" ? c.qtyTiers : c.sizeTiers)[i]!.from = e.target.value; })} />
                    <Input className="num h-8 text-[13px]" placeholder="∞" value={t.to} onChange={(e) => setP((c) => { (tierTab === "qty" ? c.qtyTiers : c.sizeTiers)[i]!.to = e.target.value; })} />
                    <Input className="num h-8 text-[13px]" value={t.adjust} onChange={(e) => setP((c) => { (tierTab === "qty" ? c.qtyTiers : c.sizeTiers)[i]!.adjust = e.target.value; })} />
                    <Button size="icon" variant="ghost" className="size-8 text-muted-foreground hover:text-late" aria-label="Remove tier" onClick={() => setP((c) => { (tierTab === "qty" ? c.qtyTiers : c.sizeTiers).splice(i, 1); })}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <p className="text-[11px] text-muted-foreground">Pricing changes are saved to the product draft when you click Save Changes.</p>
    </div>
  );
}

function MoneyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">$</span>
      <Input className="num h-8 pl-5 text-[13px]" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function SourceCard({
  active, onSelect, title, badge, children,
}: { active: boolean; onSelect: () => void; title: string; badge?: string; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-md border p-2.5 transition-colors", active ? "border-primary/60 bg-primary/5" : "border-border")}>
      <button type="button" onClick={onSelect} className="flex w-full items-center gap-2 text-left">
        <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border", active ? "border-primary" : "border-border")}>
          {active && <span className="size-2 rounded-full bg-primary" />}
        </span>
        <span className="text-[13px] font-medium">{title}</span>
        {badge && <Chip>{badge}</Chip>}
      </button>
      {active && <div className="mt-2 pl-6">{children}</div>}
    </div>
  );
}

/**
 * Product-side formula selection. The Formula Library owns the formula itself;
 * the Product owns which formula/revision it uses and the values for its inputs.
 */
function FormulaSource({ productName, value, onChange }: { productName: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState(false);
  const selected: Formula | undefined = myFormulas.find((f) => f.name === value);

  const pick = (f: Formula) => {
    onChange(f.name);
    const next: Record<string, string> = {};
    for (const i of f.inputs) next[i.name] = i.defaultValue;
    setValues(next);
  };

  const rev = selected ? currentRevision(selected) : null;
  const missing = selected ? selected.inputs.filter((i) => i.required && !(values[i.name] ?? i.defaultValue)) : [];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12px]" onClick={() => setOpen(true)}>
          <Library className="size-3.5" />{selected ? "Change formula" : "Select formula"}
        </Button>
        {selected && (
          <>
            <span className="min-w-0 truncate text-[13px] font-medium">{selected.name}</span>
            <span className="num text-[11px] text-muted-foreground">Rev {rev?.rev}</span>
            <Chip>{selected.purpose}</Chip>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-[12px]" asChild>
              <Link to="/formula-library/$id" params={{ id: selected.id }} search={{ product: "current", productName }}>
                <ExternalLink className="size-3.5" />Edit formula
              </Link>
            </Button>
          </>
        )}
      </div>

      {!selected ? (
        <p className="text-[12px] text-muted-foreground">
          No formula selected. Pick one from your library, or{" "}
          <Link to="/formula-library/$id" params={{ id: "new" }} search={{ product: "current", productName }} className="text-primary hover:underline">create a new formula</Link>.
        </p>
      ) : (
        <>
          <p className="text-[12px] text-muted-foreground">{selected.description}</p>

          <button type="button" onClick={() => setDetail(!detail)} className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline">
            {detail ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}Formula expression (read-only)
          </button>
          {detail && <ExpressionView expression={selected.expression} inputs={selected.inputs} />}

          <div className="rounded-md border border-border p-2.5">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Product values for declared inputs
            </div>
            {selected.inputs.length === 0 ? (
              <p className="text-[12px] italic text-muted-foreground">This formula needs no product-supplied inputs.</p>
            ) : (
              <InputValueFields
                inputs={selected.inputs}
                values={values}
                showMissing
                onChange={(name, v) => setValues((s) => ({ ...s, [name]: v }))}
              />
            )}
            {missing.length > 0 && (
              <p className="mt-2 text-[12px] text-warn">
                {missing.length} required input{missing.length === 1 ? "" : "s"} still needs a value before this product can price.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-2">
            <span className="min-w-0 flex-1 text-[12px] text-muted-foreground">
              This product is pinned to revision {rev?.rev}. Newer formula revisions are only applied when you adopt them here.
            </span>
            <Button size="sm" variant="outline" className="h-7 text-[12px]" onClick={() => toast.success(`Adopted revision ${rev?.rev} for this product`)}>
              Adopt latest revision
            </Button>
          </div>
        </>
      )}

      <FormulaPicker
        open={open}
        onOpenChange={setOpen}
        selectedId={selected?.id}
        onSelect={pick}
      />
    </div>
  );
}
