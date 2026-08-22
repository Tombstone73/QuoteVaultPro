import React, { useState } from "react";
import { ChevronDown, ChevronRight, HelpCircle, Plus, Trash2 } from "lucide-react";
import type {
  ProductDraftFormulaPricing,
  ProductDraftOptionPricing,
  ProductDraftOptionPricingImpact,
  ProductDraftPricing,
  ProductDraftPricingTier,
} from "../api";
import { Cell, Chip, ReferenceButton, Segmented } from "./referencePrimitives";

/**
 * Presentation port of reference/lovable-ui/src/components/app/product-editor/pricing-engine.tsx.
 * V2 supplies the canonical draft and accepts staged edits; all pricing evaluation remains server-owned.
 */
export function PricingEngine({ pricing, formula, disabled, onPricingChange, onFormulaChange }: Readonly<{
  pricing?: ProductDraftPricing;
  formula?: ProductDraftFormulaPricing;
  disabled?: boolean;
  onPricingChange: (next: ProductDraftPricing) => void;
  onFormulaChange: (next: Pick<ProductDraftFormulaPricing, "expression" | "variables" | "allowRotation">) => void;
}>) {
  const [tierTab, setTierTab] = useState<"qty" | "size">("qty");
  const [varsOpen, setVarsOpen] = useState(false);

  if (!pricing) return <div className="space-y-2"><p className="text-[0.75rem] text-muted-foreground">Set Product basics, then Save Changes to create the canonical Draft pricing record.</p></div>;

  const editable = !disabled && pricing.editable;
  const advanced = pricing.mode === "formula" || pricing.mode === "advanced" || pricing.mode === "matrix";
  const tiers = pricing.tiers;
  // The formula input contract is the only canonical ProductVersion home for
  // computed-sheet dimensions. Keep the Lovable controls visible, but never
  // synthesize a separate client-side pricing or nesting setting.
  const formulaInput = (keys: readonly string[]) => formula?.inputs.find((input) => keys.includes(input.key));
  const sheetWidth = formulaInput(["sheet_width", "sheetWidth"]);
  const sheetLength = formulaInput(["sheet_length", "sheetLength"]);
  const computedSheetUsage = pricing.tierBasis === "computed_sheet_usage" || Boolean(sheetWidth || sheetLength);
  const formulaVariableEditable = Boolean(!disabled && formula?.editable && formula.variablesEditable);
  const rotationEditable = Boolean(!disabled && formula?.rotationEditable);
  const updateFormulaVariable = (key: string, raw: string) => onFormulaChange({
    expression: formula?.expression ?? "",
    variables: { ...(formula?.variables ?? {}), [key]: raw === "" ? 0 : Number(raw) },
    allowRotation: formula?.allowRotation ?? false,
  });
  const updateBase = (field: keyof ProductDraftPricing["base"], value: number | null) => onPricingChange({ ...pricing, base: { ...pricing.base, [field]: value } });
  const updateTier = (index: number, change: Partial<ProductDraftPricingTier>) => onPricingChange({ ...pricing, tiers: pricing.tiers.map((tier, position) => position === index ? { ...tier, ...change } : tier) });
  const addTier = () => onPricingChange({
    ...pricing,
    mode: pricing.mode === "simple_base" ? "simple_with_tiers" : pricing.mode,
    tiers: [...pricing.tiers, { tierId: `new:${crypto.randomUUID()}`, minimum: Math.max(1, (pricing.tiers.at(-1)?.maximum ?? 0) + 1), maximum: null, perPieceCents: pricing.base.perPieceCents, perSqftCents: pricing.base.perSqftCents, minimumChargeCents: pricing.base.minimumChargeCents }],
  });

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <Segmented value={advanced ? "advanced" : "basic"} onChange={(mode) => onPricingChange({ ...pricing, mode: mode === "advanced" ? "advanced" : "simple_base" })} items={[{ id: "basic", label: "Basic" }, { id: "advanced", label: "Advanced" }]} disabled={!editable} />
      <span className="text-[0.6875rem] text-muted-foreground">{advanced ? "Formula sources, sheet nesting and tier tables." : "Rates and minimums only — enough for most products."}</span>
      <HelpCircle className="size-3.5 text-muted-foreground" />
    </div>

    <div className="grid gap-3 @container sm:grid-cols-3">
      <Cell label="Rate per sq ft"><MoneyInput disabled={!editable} value={pricing.base.perSqftCents} onChange={(value) => updateBase("perSqftCents", value)} /></Cell>
      <Cell label="Rate per piece"><MoneyInput disabled={!editable} value={pricing.base.perPieceCents} onChange={(value) => updateBase("perPieceCents", value)} /></Cell>
      <Cell label="Minimum charge"><MoneyInput disabled={!editable} value={pricing.base.minimumChargeCents} onChange={(value) => updateBase("minimumChargeCents", value)} /></Cell>
      <Cell label="Tier basis" hint="Which quantity chooses the price break.">
        <select value={pricing.tierBasis ?? ""} disabled={!editable} onChange={(event) => onPricingChange({ ...pricing, tierBasis: event.target.value === "" ? null : event.target.value as ProductDraftPricing["tierBasis"] })}><option value="">No tiers</option><option value="computed_sheet_usage">Computed Sheet Usage</option><option value="quantity">Customer Quantity</option><option value="square_foot">Total Sq Ft</option></select>
      </Cell>
    </div>

    {advanced && <>
      <div className="space-y-2">
        <div className="text-[0.75rem] font-semibold uppercase tracking-wide text-muted-foreground">Price source</div>
        <SourceCard active={Boolean(formula)} title="Formula library" badge="Reference">
          <Cell label="Formula source"><input readOnly value={formula?.formulaName ?? formula?.source ?? "No Formula selected"} /></Cell>
          <Cell label="Expression"><input readOnly value={formula?.expression ?? "No Formula expression"} /></Cell>
          {formula?.inputs.length ? <div className="mt-2 grid gap-2 sm:grid-cols-2">{formula.inputs.map((input) => <Cell key={input.key} label={input.label}><input disabled={!editable || !formula.editable || !formula.variablesEditable} inputMode="decimal" value={String(formula.variables[input.key] ?? "")} onChange={(event) => onFormulaChange({ expression: formula.expression, variables: { ...formula.variables, [input.key]: event.target.value === "" ? 0 : Number(event.target.value) }, allowRotation: formula.allowRotation })} /></Cell>)}</div> : null}
          <p className="mt-1 text-[0.6875rem] text-muted-foreground">Formula Library expressions are reference-only. ProductVersion inputs are editable where the canonical contract allows.</p>
          <button type="button" onClick={() => setVarsOpen(!varsOpen)} className="mt-1.5 inline-flex items-center gap-1 text-[0.75rem] text-primary hover:underline">{varsOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}Available pricing variables</button>
          {varsOpen && <dl className="mt-1.5 grid gap-x-4 gap-y-1 rounded-md border border-border bg-surface-2 p-2.5 text-[0.6875rem] sm:grid-cols-2">{(formula?.supportedRuntimeVariables ?? []).map((name) => <div key={name} className="flex gap-2"><dt className="num shrink-0 font-medium">{name}</dt><dd className="text-muted-foreground">Canonical server runtime variable</dd></div>)}</dl>}
        </SourceCard>
      </div>

      <div className="rounded-md border border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><Segmented value={tierTab} onChange={setTierTab} items={[{ id: "qty", label: `Quantity tiers (${tiers.length})` }, { id: "size", label: "Size tiers" }]} /><ReferenceButton variant="outline" size="compact" disabled={!editable} className="gap-1" onClick={addTier}><Plus className="size-3.5" />Add {tierTab === "qty" ? "qty" : "size"} tier</ReferenceButton></div>
        {tiers.length === 0 ? <p className="mt-2.5 text-[0.75rem] italic text-muted-foreground">No tiers — every quantity prices at list.</p> : <div className="mt-2.5 space-y-1.5"><div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground"><span>From</span><span>To</span><span>Per piece</span><span>Per sq ft</span><span className="w-8" /></div>{tiers.map((tier, index) => <div key={tier.tierId} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2"><input className="num h-8 text-[0.8125rem]" type="number" min="1" disabled={!editable} value={tier.minimum} onChange={(event) => updateTier(index, { minimum: Number(event.target.value) })} /><input className="num h-8 text-[0.8125rem]" type="number" min={tier.minimum} placeholder="∞" disabled={!editable} value={tier.maximum ?? ""} onChange={(event) => updateTier(index, { maximum: event.target.value === "" ? null : Number(event.target.value) })} /><MoneyInput disabled={!editable} value={tier.perPieceCents} onChange={(value) => updateTier(index, { perPieceCents: value })} /><MoneyInput disabled={!editable} value={tier.perSqftCents} onChange={(value) => updateTier(index, { perSqftCents: value })} /><ReferenceButton variant="ghost" size="icon" disabled={!editable} aria-label="Remove tier" className="size-8 text-muted-foreground hover:text-late" onClick={() => onPricingChange({ ...pricing, tiers: pricing.tiers.filter((_, position) => position !== index) })}><Trash2 className="size-3.5" /></ReferenceButton></div>)}</div>}
      </div>
    </>}
    {computedSheetUsage && <div className="rounded-md border border-border p-3">
      <div className="text-[0.75rem] font-semibold uppercase tracking-wide text-muted-foreground">Computed sheet usage</div>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <Cell label="Sheet width (in)">
          <input
            className="num h-8 text-[0.8125rem]"
            disabled={!sheetWidth || !formulaVariableEditable}
            inputMode="decimal"
            value={sheetWidth ? String(formula?.variables[sheetWidth.key] ?? "") : "Not available"}
            onChange={(event) => sheetWidth && updateFormulaVariable(sheetWidth.key, event.target.value)}
          />
        </Cell>
        <Cell label="Sheet length (in)">
          <input
            className="num h-8 text-[0.8125rem]"
            disabled={!sheetLength || !formulaVariableEditable}
            inputMode="decimal"
            value={sheetLength ? String(formula?.variables[sheetLength.key] ?? "") : "Not available"}
            onChange={(event) => sheetLength && updateFormulaVariable(sheetLength.key, event.target.value)}
          />
        </Cell>
        <Cell label="Rotation" hint="Allow rotated / mixed layouts when nesting.">
          <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-surface-2 px-2 text-[0.75rem] text-muted-foreground">
            <input type="checkbox" disabled={!rotationEditable} checked={formula?.allowRotation ?? false} onChange={(event) => onFormulaChange({ expression: formula?.expression ?? "", variables: formula?.variables ?? {}, allowRotation: event.target.checked })} aria-label="Allow rotation" />
            <span>Allow rotation</span>
          </label>
        </Cell>
      </div>
      {(!sheetWidth || !sheetLength) && <p className="mt-2 text-[0.6875rem] text-muted-foreground">Sheet dimensions are unavailable because the canonical Draft formula input contract does not expose them.</p>}
      <p className="mt-1 text-[0.6875rem] text-muted-foreground">Rotation is stored with the canonical Draft pricing configuration and resolved by the server preview.</p>
    </div>}
    {!pricing.editable && <p className="text-[0.6875rem] text-muted-foreground">{pricing.unavailableReason ?? "Pricing is read-only for this Product Draft."}</p>}
    <p className="text-[0.6875rem] text-muted-foreground">Pricing changes are saved to the product draft when you click Save Changes.</p>
  </div>;
}

export function OptionImpactsEditor({ options, disabled, onChange }: Readonly<{ options: ProductDraftOptionPricing["options"]; disabled?: boolean; onChange: (next: ProductDraftOptionPricing["options"]) => void }>) {
  const changeImpact = (optionIndex: number, choiceIndex: number | undefined, impact: ProductDraftOptionPricingImpact | null) => onChange(options.map((option, index) => index !== optionIndex ? option : choiceIndex === undefined ? { ...option, nodeImpact: impact } : { ...option, choices: option.choices.map((choice, position) => position === choiceIndex ? { ...choice, impact } : choice) }));
  if (options.length === 0) return <p className="text-[0.75rem] italic text-muted-foreground">No option pricing impacts — options change production only.</p>;
  return <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[520px] text-[0.8125rem]"><thead><tr className="border-b border-border text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground"><th className="py-1.5 pr-3 text-left">Option</th><th className="py-1.5 pr-3 text-left">Choice</th><th className="py-1.5 pr-3 text-left">Pricing effect</th><th className="py-1.5 text-right">Value</th></tr></thead><tbody>{options.flatMap((option, optionIndex) => [{ option, optionIndex, label: "All selections", editable: true, impact: option.nodeImpact, choiceIndex: undefined as number | undefined }, ...option.choices.map((choice, choiceIndex) => ({ option, optionIndex, label: choice.label, editable: choice.editable, impact: choice.impact, choiceIndex }))]).map((row) => <ImpactRow key={`${row.option.optionId}:${row.choiceIndex ?? "node"}`} row={row} disabled={disabled} onChange={(impact) => changeImpact(row.optionIndex, row.choiceIndex, impact)} />)}</tbody></table></div>;
}

function ImpactRow({ row, disabled, onChange }: Readonly<{ row: { option: ProductDraftOptionPricing["options"][number]; optionIndex: number; label: string; editable: boolean; impact: ProductDraftOptionPricingImpact | null; choiceIndex?: number }; disabled?: boolean; onChange: (impact: ProductDraftOptionPricingImpact | null) => void }>) { const impact = row.impact; return <tr className="border-b border-border/60 last:border-0"><td className="py-1 pr-3">{row.option.label}</td><td className="py-1 pr-3 text-muted-foreground">{row.label}</td><td className="py-1 pr-3"><select disabled={disabled || !row.editable} value={impact?.type ?? "none"} onChange={(event) => onChange(event.target.value === "none" ? null : { type: event.target.value as ProductDraftOptionPricingImpact["type"], value: impact?.value ?? 0 })}><option value="none">No pricing effect</option><option value="fixed">Fixed amount</option><option value="per_item">Per item</option><option value="per_square_foot">Per square foot</option><option value="percent_of_base">Percent of base</option><option value="multiplier">Multiplier</option></select></td><td className="num py-1 text-right"><input className="w-24 text-right" disabled={disabled || !row.editable || !impact} inputMode="decimal" value={impact?.value ?? ""} onChange={(event) => impact && onChange({ ...impact, value: Number(event.target.value) })} /></td></tr>; }
function MoneyInput({ value, onChange, disabled }: Readonly<{ value: number | null; onChange: (value: number | null) => void; disabled?: boolean }>) { return <div className="relative"><span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[0.75rem] text-muted-foreground">$</span><input className="num h-8 pl-5 text-[0.8125rem]" disabled={disabled} inputMode="decimal" value={value == null ? "" : (value / 100).toFixed(2)} onChange={(event) => onChange(event.target.value === "" ? null : Math.round(Number(event.target.value) * 100))} /></div>; }
function SourceCard({ active, title, badge, children }: Readonly<{ active: boolean; title: string; badge?: string; children: React.ReactNode }>) { return <div className={`rounded-md border p-2.5 transition-colors ${active ? "border-primary/60 bg-primary/5" : "border-border"}`}><div className="flex w-full items-center gap-2 text-left"><span className={`grid size-4 shrink-0 place-items-center rounded-full border ${active ? "border-primary" : "border-border"}`}>{active && <span className="size-2 rounded-full bg-primary" />}</span><span className="text-[0.8125rem] font-medium">{title}</span>{badge && <Chip>{badge}</Chip>}</div>{active && <div className="mt-2 pl-6">{children}</div>}</div>; }
