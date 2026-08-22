import React, { useState } from "react";
import { ChevronDown, ChevronRight, HelpCircle, Plus, Trash2 } from "lucide-react";
import type {
  ProductDraftFormulaPricing,
  ProductDraftOption,
  ProductDraftOptionPricing,
  ProductDraftOptionPricingImpact,
  ProductDraftOptionPricingOverride,
  ProductDraftPricing,
  ProductDraftPricingTier,
  ProductFormulaLibraryEntry,
} from "../api";
import { Cell, Chip, ReferenceButton, Segmented } from "./referencePrimitives";

/**
 * Presentation port of reference/lovable-ui/src/components/app/product-editor/pricing-engine.tsx.
 * V2 supplies the canonical draft and accepts staged edits; all pricing evaluation remains server-owned.
 */
export const legacyFormulaCandidate = (formula?: ProductDraftFormulaPricing): string | null => {
  if (formula?.source !== "unsupported_legacy") return null;
  const expression = formula.legacyExpression?.trim() || formula.expression.trim();
  return expression || null;
};

export const legacyFormulaCanBeAdopted = (formula: ProductDraftFormulaPricing | undefined, disabled: boolean | undefined, hasHandler: boolean): boolean => Boolean(
  !disabled && hasHandler && formula?.source === "unsupported_legacy" && formula.canAdoptLegacyFormula && legacyFormulaCandidate(formula),
);

export function PricingEngine({ pricing, formula, formulaLibrary = [], options = [], serviceFee = false, disabled, adoptingLegacyFormula, legacyFormulaError, onPricingChange, onFormulaChange, onAdoptLegacyFormula }: Readonly<{
  pricing?: ProductDraftPricing;
  formula?: ProductDraftFormulaPricing;
  formulaLibrary?: readonly ProductFormulaLibraryEntry[];
  options?: readonly ProductDraftOption[];
  serviceFee?: boolean;
  disabled?: boolean;
  adoptingLegacyFormula?: boolean;
  legacyFormulaError?: string | null;
  onPricingChange: (next: ProductDraftPricing) => void;
  onFormulaChange: (next: Readonly<{ source: "embedded" | "library"; formulaId?: string; expression: string; variables: Record<string, number>; allowRotation: boolean; rotationControl?: ProductDraftFormulaPricing["rotationControl"] }>) => void;
  onAdoptLegacyFormula?: () => void;
}>) {
  const [tierTab, setTierTab] = useState<"qty" | "size" | "sheets">("qty");
  const [varsOpen, setVarsOpen] = useState(false);
  const [newVariableKey, setNewVariableKey] = useState("");

  if (!pricing) return <div className="space-y-2"><p className="text-[0.75rem] text-muted-foreground">Set Product basics, then Save Changes to create the canonical Draft pricing record.</p></div>;

  const editable = !disabled && pricing.editable;
  const advanced = pricing.mode === "formula" || pricing.mode === "advanced" || pricing.mode === "matrix";
  // Formula provenance remains commercially material even when the rate
  // editor is otherwise in simple mode.
  const showFormulaDetails = advanced || Boolean(formula);
  const tierSetKey = tierTab === "qty" ? "quantity" : tierTab === "size" ? "squareFoot" : "computedSheetUsage";
  const tiers = pricing.tierSets[tierSetKey];
  // The formula input contract is the only canonical ProductVersion home for
  // computed-sheet dimensions. Keep the Lovable controls visible, but never
  // synthesize a separate client-side pricing or nesting setting.
  const formulaInput = (keys: readonly string[]) => formula?.inputs.find((input) => keys.includes(input.key));
  const sheetWidth = formulaInput(["sheet_width", "sheetWidth"]);
  const sheetLength = formulaInput(["sheet_length", "sheetLength"]);
  const computedSheetUsage = pricing.tierBasis === "computed_sheet_usage" || Boolean(sheetWidth || sheetLength);
  const formulaVariableEditable = Boolean(!disabled && formula?.editable && formula.variablesEditable);
  const rotationEditable = Boolean(!disabled && formula?.rotationEditable);
  const legacyExpression = legacyFormulaCandidate(formula);
  const canAdoptLegacyFormula = legacyFormulaCanBeAdopted(formula, disabled, Boolean(onAdoptLegacyFormula));
  const rotationOptions = options.filter((option) => (option.inputType === "select" || option.inputType === "multiselect") && option.choices.length > 0);
  const controlledOption = rotationOptions.find((option) => option.optionId === formula?.rotationControl?.optionId);
  const formulaDraft = () => ({ source: formula?.source.startsWith("library") ? "library" as const : "embedded" as const, ...(formula?.formulaId ? { formulaId: formula.formulaId } : {}), expression: formula?.expression ?? "", variables: formula?.variables ?? {}, allowRotation: formula?.allowRotation ?? false, ...(formula?.rotationControl ? { rotationControl: formula.rotationControl } : {}) });
  const updateRotation = (change: Partial<Pick<ProductDraftFormulaPricing, "allowRotation" | "rotationControl">>) => onFormulaChange({ ...formulaDraft(), ...change });
  const updateFormulaVariable = (key: string, raw: string) => onFormulaChange({ ...formulaDraft(), variables: { ...(formula?.variables ?? {}), [key]: raw === "" ? 0 : Number(raw) } });
  const updateBase = (field: keyof ProductDraftPricing["base"], value: number | null) => onPricingChange({ ...pricing, base: { ...pricing.base, [field]: value } });
  const replaceTierFamily = (next: readonly ProductDraftPricingTier[]) => {
    const nextSets = { ...pricing.tierSets, [tierSetKey]: next };
    const conventional = tierTab === "sheets" ? { quantity: [], squareFoot: [], computedSheetUsage: next } : { ...nextSets, computedSheetUsage: [] };
    const primary = tierTab === "qty" ? "quantity" : tierTab === "size" ? "square_foot" : "computed_sheet_usage" as const;
    onPricingChange({ ...pricing, mode: pricing.mode === "simple_base" ? "simple_with_tiers" : pricing.mode, tierBasis: primary, tiers: next, tierSets: conventional });
  };
  const updateTier = (index: number, change: Partial<ProductDraftPricingTier>) => replaceTierFamily(tiers.map((tier, position) => position === index ? { ...tier, ...change } : tier));
  const addTier = () => replaceTierFamily([...tiers, { tierId: `new:${crypto.randomUUID()}`, minimum: Math.max(1, (tiers.at(-1)?.maximum ?? 0) + 1), maximum: null, perPieceCents: pricing.base.perPieceCents, perSqftCents: pricing.base.perSqftCents, minimumChargeCents: pricing.base.minimumChargeCents }]);

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <Segmented value={advanced ? "advanced" : "basic"} onChange={(mode) => onPricingChange({ ...pricing, mode: mode === "advanced" ? "advanced" : "simple_base" })} items={[{ id: "basic", label: "Basic" }, { id: "advanced", label: "Advanced" }]} disabled={!editable} />
      <span className="text-[0.6875rem] text-muted-foreground">{advanced ? "Formula sources, sheet nesting and tier tables." : "Rates and minimums only — enough for most products."}</span>
      <HelpCircle className="size-3.5 text-muted-foreground" />
    </div>

    <div className="grid gap-3 @container sm:grid-cols-3">
      {serviceFee && <Cell label="Flat Fee Amount" hint="Charged once per line; quantity and dimensions do not multiply this service fee."><MoneyInput disabled={!editable} value={pricing.flatFeeCents} onChange={(flatFeeCents) => onPricingChange({ ...pricing, flatFeeCents })} /></Cell>}
      {!serviceFee && <Cell label="Rate per sq ft"><MoneyInput disabled={!editable} value={pricing.base.perSqftCents} onChange={(value) => updateBase("perSqftCents", value)} /></Cell>}
      {!serviceFee && <Cell label="Rate per piece"><MoneyInput disabled={!editable} value={pricing.base.perPieceCents} onChange={(value) => updateBase("perPieceCents", value)} /></Cell>}
      {!serviceFee && <Cell label="Minimum charge"><MoneyInput disabled={!editable} value={pricing.base.minimumChargeCents} onChange={(value) => updateBase("minimumChargeCents", value)} /></Cell>}
      {!serviceFee && <Cell label="Tier basis" hint="Which quantity chooses the price break.">
        <select value={pricing.tierBasis ?? ""} disabled={!editable} onChange={(event) => onPricingChange({ ...pricing, tierBasis: event.target.value === "" ? null : event.target.value as ProductDraftPricing["tierBasis"] })}><option value="">No tiers</option><option value="computed_sheet_usage">Computed Sheet Usage</option><option value="quantity">Customer Quantity</option><option value="square_foot">Total Sq Ft</option></select>
      </Cell>}
    </div>

    {!serviceFee && showFormulaDetails && <>
      <div className="space-y-2">
        <div className="text-[0.75rem] font-semibold uppercase tracking-wide text-muted-foreground">Price source</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Cell label="Formula source">
            <select disabled={!editable} value={formula?.source.startsWith("library") ? "library" : "embedded"} onChange={(event) => {
              const source = event.target.value as "embedded" | "library";
              const first = formulaLibrary[0];
              onFormulaChange(source === "library" && first ? { source, formulaId: first.id, expression: first.expression, variables: {}, allowRotation: false } : { ...formulaDraft(), source, ...(source === "embedded" ? { formulaId: undefined } : {}) });
            }}>
              <option value="embedded">Embedded ProductVersion Formula</option>
              <option value="library">Formula Library</option>
            </select>
          </Cell>
          {formula?.source.startsWith("library") && <Cell label="Formula Library entry">
            <select disabled={!editable || formulaLibrary.length === 0} value={formula?.formulaId ?? ""} onChange={(event) => {
              const selected = formulaLibrary.find((entry) => entry.id === event.target.value);
              if (selected) onFormulaChange({ source: "library", formulaId: selected.id, expression: selected.expression, variables: {}, allowRotation: false });
            }}>
              {!formulaLibrary.length && <option value="">No active Formula Library entries</option>}
              {formulaLibrary.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.code ? ` · ${entry.code}` : ""}</option>)}
            </select>
          </Cell>}
        </div>
        <SourceCard active={Boolean(formula)} title={formula?.source === "unsupported_legacy" ? "Legacy formula" : formula?.source === "embedded_editable" ? "ProductVersion formula" : "Formula library"} badge={formula?.source === "unsupported_legacy" ? "Legacy-compatible" : formula?.source === "embedded_editable" ? "Draft" : "Reference"}>
          <Cell label={formula?.source === "unsupported_legacy" ? "Legacy expression" : "Formula source"}><input readOnly value={formula?.source === "unsupported_legacy" ? (legacyExpression ?? "No legacy formula supplied") : (formula?.formulaName ?? formula?.source ?? "No Formula selected")} /></Cell>
          {formula?.source !== "unsupported_legacy" && <Cell label="Expression"><input readOnly={!formula?.expressionEditable} disabled={Boolean(disabled) || !formula?.expressionEditable} value={formula?.expression ?? ""} onChange={(event) => formula && onFormulaChange({ ...formulaDraft(), expression: event.target.value })} placeholder="No Formula expression" /></Cell>}
          {formula?.source === "unsupported_legacy" && <div className="mt-2 flex flex-wrap items-center gap-2"><ReferenceButton size="compact" disabled={!canAdoptLegacyFormula || adoptingLegacyFormula} onClick={onAdoptLegacyFormula}>{adoptingLegacyFormula ? "Adopting…" : "Adopt into Draft"}</ReferenceButton><span className="text-[0.6875rem] text-muted-foreground">Creates an editable ProductVersion formula from this legacy expression.</span></div>}
          {legacyFormulaError && <p role="alert" className="mt-1 text-[0.6875rem] text-late">{legacyFormulaError}</p>}
          {formula?.inputs.length ? <div className="mt-2 grid gap-2 sm:grid-cols-2">{formula.inputs.map((input) => <Cell key={input.key} label={input.label}><input disabled={!editable || !formula.editable || !formula.variablesEditable} inputMode="decimal" value={String(formula.variables[input.key] ?? "")} onChange={(event) => onFormulaChange({ ...formulaDraft(), variables: { ...formula.variables, [input.key]: event.target.value === "" ? 0 : Number(event.target.value) } })} /></Cell>)}</div> : null}
          {(formula?.source === "embedded_editable" || formula?.source === "none") && <div className="mt-2 flex flex-wrap items-end gap-2"><Cell label="Product Formula input" hint="A typed numeric ProductVersion input used by the embedded Formula."><input disabled={Boolean(disabled)} placeholder="e.g. roll_width" value={newVariableKey} onChange={(event) => setNewVariableKey(event.target.value)} /></Cell><ReferenceButton size="compact" disabled={Boolean(disabled) || !newVariableKey.trim() || Object.hasOwn(formula?.variables ?? {}, newVariableKey.trim())} onClick={() => { const key = newVariableKey.trim(); onFormulaChange({ ...formulaDraft(), variables: { ...(formula?.variables ?? {}), [key]: 0 } }); setNewVariableKey(""); }}>Add input</ReferenceButton></div>}
          <p className="mt-1 text-[0.6875rem] text-muted-foreground">{formula?.source === "unsupported_legacy" ? "Legacy compatibility data is read-only until it is explicitly adopted into this Product Draft." : "Formula Library expressions are reference-only. ProductVersion Formula expressions and inputs are editable where the canonical contract allows."}</p>
          <button type="button" onClick={() => setVarsOpen(!varsOpen)} className="mt-1.5 inline-flex items-center gap-1 text-[0.75rem] text-primary hover:underline">{varsOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}Available pricing variables</button>
          {varsOpen && <dl className="mt-1.5 grid gap-x-4 gap-y-1 rounded-md border border-border bg-surface-2 p-2.5 text-[0.6875rem] sm:grid-cols-2">{(formula?.supportedRuntimeVariables ?? []).map((name) => <div key={name} className="flex gap-2"><dt className="num shrink-0 font-medium">{name}</dt><dd className="text-muted-foreground">Canonical server runtime variable</dd></div>)}</dl>}
        </SourceCard>
      </div>

      {advanced && <div className="rounded-md border border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><Segmented value={tierTab} onChange={(value) => setTierTab(value as "qty" | "size" | "sheets")} items={[{ id: "qty", label: `Quantity tiers (${pricing.tierSets.quantity.length})` }, { id: "size", label: `Area tiers (${pricing.tierSets.squareFoot.length})` }, { id: "sheets", label: `Computed sheets (${pricing.tierSets.computedSheetUsage.length})` }]} /><ReferenceButton variant="outline" size="compact" disabled={!editable} className="gap-1" onClick={addTier}><Plus className="size-3.5" />Add {tierTab === "qty" ? "quantity" : tierTab === "size" ? "area" : "sheet"} tier</ReferenceButton></div>
        {tiers.length === 0 ? <p className="mt-2.5 text-[0.75rem] italic text-muted-foreground">No tiers — every quantity prices at list.</p> : <div className="mt-2.5 space-y-1.5"><div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground"><span>From</span><span>To</span><span>Per piece</span><span>Per sq ft</span><span className="w-8" /></div>{tiers.map((tier, index) => <div key={tier.tierId} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2"><input className="num h-8 text-[0.8125rem]" type="number" min="1" disabled={!editable} value={tier.minimum} onChange={(event) => updateTier(index, { minimum: Number(event.target.value) })} /><input className="num h-8 text-[0.8125rem]" type="number" min={tier.minimum} placeholder="∞" disabled={!editable} value={tier.maximum ?? ""} onChange={(event) => updateTier(index, { maximum: event.target.value === "" ? null : Number(event.target.value) })} /><MoneyInput disabled={!editable} value={tier.perPieceCents} onChange={(value) => updateTier(index, { perPieceCents: value })} /><MoneyInput disabled={!editable} value={tier.perSqftCents} onChange={(value) => updateTier(index, { perSqftCents: value })} /><ReferenceButton variant="ghost" size="icon" disabled={!editable} aria-label="Remove tier" className="size-8 text-muted-foreground hover:text-late" onClick={() => replaceTierFamily(tiers.filter((_, position) => position !== index))}><Trash2 className="size-3.5" /></ReferenceButton></div>)}</div>}
      </div>}
    </>}
    {!serviceFee && computedSheetUsage && <div className="rounded-md border border-border p-3">
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
            <input type="checkbox" disabled={!rotationEditable} checked={formula?.allowRotation ?? false} onChange={(event) => updateRotation({ allowRotation: event.target.checked })} aria-label="Allow rotation" />
            <span>Allow rotation</span>
          </label>
        </Cell>
      </div>
      {formula?.allowRotation && <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Cell label="Controlled by Product Option" hint="Optional. The selected Option decides when this Product may rotate.">
          <select disabled={!rotationEditable} value={formula.rotationControl?.optionId ?? ""} onChange={(event) => {
            const option = rotationOptions.find((value) => value.optionId === event.target.value);
            updateRotation({ rotationControl: option ? { optionId: option.optionId, allowWhenChoiceValues: [option.choices[0]!.choiceValue] } : undefined });
          }}>
            <option value="">No Option control</option>
            {rotationOptions.map((option) => <option key={option.optionId} value={option.optionId}>{option.label}</option>)}
          </select>
        </Cell>
        {controlledOption && <Cell label="Choices that allow rotation" hint="All other Choices prevent rotation.">
          <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-surface-2 px-2 text-[0.75rem] text-muted-foreground">
            {controlledOption.choices.map((choice) => {
              const checked = formula.rotationControl?.allowWhenChoiceValues.includes(choice.choiceValue) ?? false;
              const allowedChoices = formula.rotationControl?.allowWhenChoiceValues ?? [];
              return <label key={choice.choiceValue} className="inline-flex items-center gap-1.5"><input type="checkbox" disabled={!rotationEditable || (checked && allowedChoices.length === 1)} checked={checked} onChange={(event) => updateRotation({ rotationControl: { optionId: controlledOption.optionId, allowWhenChoiceValues: event.target.checked ? [...allowedChoices, choice.choiceValue] : allowedChoices.filter((value) => value !== choice.choiceValue) } })} />{choice.label}</label>;
            })}
          </div>
        </Cell>}
      </div>}
      {(!sheetWidth || !sheetLength) && <p className="mt-2 text-[0.6875rem] text-muted-foreground">Sheet dimensions are unavailable because the canonical Draft formula input contract does not expose them.</p>}
      <p className="mt-1 text-[0.6875rem] text-muted-foreground">Rotation is stored with the canonical Draft pricing configuration and resolved by the server preview.</p>
    </div>}
    {!pricing.editable && <p className="text-[0.6875rem] text-muted-foreground">{pricing.unavailableReason ?? "Pricing is read-only for this Product Draft."}</p>}
    <p className="text-[0.6875rem] text-muted-foreground">Pricing changes are saved to the product draft when you click Save Changes.</p>
  </div>;
}

export function OptionImpactsEditor({ options, disabled, onChange }: Readonly<{ options: ProductDraftOptionPricing["options"]; disabled?: boolean; onChange: (next: ProductDraftOptionPricing["options"]) => void }>) {
  const changeImpact = (optionIndex: number, choiceIndex: number | undefined, impacts: readonly ProductDraftOptionPricingImpact[]) => onChange(options.map((option, index) => index !== optionIndex ? option : choiceIndex === undefined ? { ...option, nodeImpacts: impacts, nodeImpact: impacts.length === 1 ? impacts[0]! : null } : { ...option, choices: option.choices.map((choice, position) => position === choiceIndex ? { ...choice, impacts, impact: impacts.length === 1 ? impacts[0]! : null } : choice) }));
  const changeOverride = (optionIndex: number, choiceIndex: number, override: ProductDraftOptionPricingOverride | null) => onChange(options.map((option, index) => index !== optionIndex ? option : { ...option, choices: option.choices.map((choice, position) => position === choiceIndex ? { ...choice, override } : choice) }));
  if (options.length === 0) return <p className="text-[0.75rem] italic text-muted-foreground">No option pricing impacts — options change production only.</p>;
  return <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[520px] text-[0.8125rem]"><thead><tr className="border-b border-border text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground"><th className="py-1.5 pr-3 text-left">Option</th><th className="py-1.5 pr-3 text-left">Choice</th><th className="py-1.5 pr-3 text-left">Pricing effect</th><th className="py-1.5 text-right">Value</th></tr></thead><tbody>{options.flatMap((option, optionIndex) => [{ option, optionIndex, label: "All selections", editable: true, impacts: option.nodeImpacts, choiceIndex: undefined as number | undefined, override: undefined as ProductDraftOptionPricingOverride | undefined }, ...option.choices.map((choice, choiceIndex) => ({ option, optionIndex, label: choice.label, editable: choice.editable, impacts: choice.impacts, choiceIndex, override: choice.override }))]).flatMap((row) => row.impacts.map((impact, impactIndex) => <ImpactRow key={`${row.option.optionId}:${row.choiceIndex ?? "node"}:${impactIndex}`} row={{ ...row, impact, impactIndex }} disabled={disabled} onChange={(next) => { const impacts = [...row.impacts]; impacts[impactIndex] = next; changeImpact(row.optionIndex, row.choiceIndex, impacts); }} onRemove={() => changeImpact(row.optionIndex, row.choiceIndex, row.impacts.filter((_, index) => index !== impactIndex))} onMove={(delta) => { const target = impactIndex + delta; if (target < 0 || target >= row.impacts.length) return; const impacts = [...row.impacts]; [impacts[impactIndex], impacts[target]] = [impacts[target]!, impacts[impactIndex]!]; changeImpact(row.optionIndex, row.choiceIndex, impacts); }} />).concat(<tr key={`${row.option.optionId}:${row.choiceIndex ?? "node"}:add`}><td colSpan={4}><ReferenceButton size="compact" disabled={disabled || !row.editable} onClick={() => changeImpact(row.optionIndex, row.choiceIndex, [...row.impacts, { type: "fixed", value: 0 }])}><Plus className="size-3.5" />Add impact</ReferenceButton>{row.choiceIndex !== undefined && <><select className="ml-2" disabled={disabled || !row.editable} value={row.override ? `${row.override.mode}:${row.override.target}` : "none"} onChange={(event) => { const [mode, target] = event.target.value.split(":"); const override = event.target.value === "none" ? null : { mode: mode as ProductDraftOptionPricingOverride["mode"], target: target as ProductDraftOptionPricingOverride["target"], value: mode === "multiply" ? 1 : 0 }; changeOverride(row.optionIndex, row.choiceIndex!, override); }}><option value="none">No base-rate override</option>{["set", "add", "multiply"].flatMap(mode => ["per_square_foot", "per_piece", "minimum_charge"].map(target => <option key={`${mode}:${target}`} value={`${mode}:${target}`}>{mode} {target.replaceAll("_", " ")}</option>))}</select>{row.override && <input aria-label="Base-rate override value" className="num ml-2 w-20 text-right" disabled={disabled || !row.editable} inputMode="decimal" value={row.override.value} onChange={(event) => changeOverride(row.optionIndex, row.choiceIndex!, { ...row.override!, value: Number(event.target.value) })} />}</>}</td></tr>))}</tbody></table></div>;
}

function ImpactRow({ row, disabled, onChange, onRemove, onMove }: Readonly<{ row: { option: ProductDraftOptionPricing["options"][number]; optionIndex: number; label: string; editable: boolean; impact: ProductDraftOptionPricingImpact; impactIndex: number; choiceIndex?: number }; disabled?: boolean; onChange: (impact: ProductDraftOptionPricingImpact) => void; onRemove: () => void; onMove: (delta: -1 | 1) => void }>) { const impact = row.impact; return <tr className="border-b border-border/60 last:border-0"><td className="py-1 pr-3">{row.option.label}</td><td className="py-1 pr-3 text-muted-foreground">{row.label}</td><td className="py-1 pr-3"><select disabled={disabled || !row.editable} value={impact.type} onChange={(event) => { const type = event.target.value as ProductDraftOptionPricingImpact["type"]; onChange(type === "formula" ? { type, formula: "" } : { type, value: type === "multiplier" ? 1 : 0 } as ProductDraftOptionPricingImpact); }}><option value="fixed">Fixed amount</option><option value="per_item">Per item</option><option value="per_square_foot">Per square foot</option><option value="per_linear_foot">Per linear foot</option><option value="per_inch">Per inch</option><option value="percent_of_base">Percent of base</option><option value="percent_of_options_subtotal">Percent of options subtotal</option><option value="percent_of_line_subtotal">Percent of line subtotal</option><option value="multiplier">Multiplier</option><option value="formula">Formula</option></select></td><td className="num py-1 text-right"><input className="w-24 text-right" disabled={disabled || !row.editable} inputMode="decimal" value={impact.type === "formula" ? impact.formula : impact.value} onChange={(event) => onChange(impact.type === "formula" ? { ...impact, formula: event.target.value } : { ...impact, value: Number(event.target.value) } as ProductDraftOptionPricingImpact)} /><ReferenceButton size="compactIcon" disabled={disabled || !row.editable} onClick={() => onMove(-1)} aria-label="Move impact up">↑</ReferenceButton><ReferenceButton size="compactIcon" disabled={disabled || !row.editable} onClick={() => onMove(1)} aria-label="Move impact down">↓</ReferenceButton><ReferenceButton size="compactIcon" disabled={disabled || !row.editable} onClick={onRemove} aria-label="Remove impact"><Trash2 className="size-3.5" /></ReferenceButton></td></tr>; }
function MoneyInput({ value, onChange, disabled }: Readonly<{ value: number | null; onChange: (value: number | null) => void; disabled?: boolean }>) { return <div className="relative"><span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[0.75rem] text-muted-foreground">$</span><input className="num h-8 pl-5 text-[0.8125rem]" disabled={disabled} inputMode="decimal" value={value == null ? "" : (value / 100).toFixed(2)} onChange={(event) => onChange(event.target.value === "" ? null : Math.round(Number(event.target.value) * 100))} /></div>; }
function SourceCard({ active, title, badge, children }: Readonly<{ active: boolean; title: string; badge?: string; children: React.ReactNode }>) { return <div className={`rounded-md border p-2.5 transition-colors ${active ? "border-primary/60 bg-primary/5" : "border-border"}`}><div className="flex w-full items-center gap-2 text-left"><span className={`grid size-4 shrink-0 place-items-center rounded-full border ${active ? "border-primary" : "border-border"}`}>{active && <span className="size-2 rounded-full bg-primary" />}</span><span className="text-[0.8125rem] font-medium">{title}</span>{badge && <Chip>{badge}</Chip>}</div>{active && <div className="mt-2 pl-6">{children}</div>}</div>; }
