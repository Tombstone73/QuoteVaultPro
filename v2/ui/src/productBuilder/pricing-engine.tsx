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
  FormulaDomainDeclaredInput,
  FormulaDomainListEntry,
  FormulaDomainRevision,
} from "../api";
import { Cell, Chip, ReferenceButton, Segmented } from "./referencePrimitives";
import { ProductBuilderMoneyInput as MoneyInput } from "./money-input";

/**
 * Presentation port of reference/lovable-ui/src/components/app/product-editor/pricing-engine.tsx.
 * V2 supplies the canonical draft and accepts staged edits; all pricing evaluation remains server-owned.
 */
type FormulaRevisionDraft = Readonly<{
  source: "formula_revision";
  formulaId?: string;
  formulaRevisionId?: string;
  expression: string;
  inputValues: Record<string, number | boolean>;
  allowRotation: boolean;
  rotationControl?: ProductDraftFormulaPricing["rotationControl"];
}>;

const defaultInputValues = (inputs: readonly FormulaDomainDeclaredInput[]): Record<string, number | boolean> =>
  Object.fromEntries(inputs.flatMap((input) => input.defaultValue === undefined ? [] : [[input.key, input.defaultValue] as const]));

const inputValuesForRevision = (
  inputs: readonly FormulaDomainDeclaredInput[],
  previous: Record<string, number | boolean>,
): Record<string, number | boolean> => Object.fromEntries(inputs.flatMap((input) => {
  const value = previous[input.key] ?? input.defaultValue;
  return value === undefined ? [] : [[input.key, value] as const];
}));

export function PricingEngine({ pricing, formula, formulaLibrary = [], formulaRevisions = [], options = [], serviceFee = false, disabled, onManageFormulaLibrary, onPricingChange, onFormulaChange }: Readonly<{
  pricing?: ProductDraftPricing;
  formula?: ProductDraftFormulaPricing;
  formulaLibrary?: readonly FormulaDomainListEntry[];
  formulaRevisions?: readonly FormulaDomainRevision[];
  options?: readonly ProductDraftOption[];
  serviceFee?: boolean;
  disabled?: boolean;
  onManageFormulaLibrary?: () => void;
  onPricingChange: (next: ProductDraftPricing) => void;
  onFormulaChange: (next: FormulaRevisionDraft) => void;
}>) {
  const [tierTab, setTierTab] = useState<"qty" | "size" | "sheets">("qty");
  const [varsOpen, setVarsOpen] = useState(false);

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
  const selectedFormula = formulaLibrary.find((entry) => entry.formulaId === formula?.formulaId);
  const selectedCurrentRevision = selectedFormula?.revision;
  const selectedRevision = formulaRevisions.find((revision) => revision.formulaRevisionId === formula?.formulaRevisionId)
    ?? (selectedCurrentRevision?.formulaRevisionId === formula?.formulaRevisionId ? selectedCurrentRevision : undefined);
  const declaredInputs: readonly FormulaDomainDeclaredInput[] = selectedRevision?.declaredInputs ?? (formula?.inputs ?? []).map((input) => ({
    key: input.key,
    label: input.label,
    type: input.type ?? "number",
    required: input.required ?? false,
    ...(input.defaultValue !== undefined ? { defaultValue: input.defaultValue } : {}),
    ...(input.minimum !== undefined ? { minimum: input.minimum } : {}),
    ...(input.maximum !== undefined ? { maximum: input.maximum } : {}),
    ...(input.unit ? { unit: input.unit } : {}),
    authorable: true,
  }));
  const formulaInput = (keys: readonly string[]) => declaredInputs.find((input) => keys.includes(input.key));
  const sheetWidth = formulaInput(["sheet_width", "sheetWidth"]);
  const sheetLength = formulaInput(["sheet_length", "sheetLength"]);
  const computedSheetUsage = pricing.tierBasis === "computed_sheet_usage" || Boolean(sheetWidth || sheetLength);
  // FormulaRevision selection and its declared ProductVersion values are a
  // separate Draft authoring concern from scalar/matrix rate editing. A
  // Matrix makes the rate editor read-only, but must never prevent an
  // authorized editor from pinning the Draft to an immutable FormulaRevision.
  const formulaAuthoringEditable = !disabled;
  const rotationEditable = Boolean(!disabled && formula?.rotationEditable);
  const rotationOptions = options.filter((option) => (option.inputType === "select" || option.inputType === "multiselect") && option.choices.length > 0);
  const controlledOption = rotationOptions.find((option) => option.optionId === formula?.rotationControl?.optionId);
  const formulaDraft = (): FormulaRevisionDraft => ({ source: "formula_revision", ...(formula?.formulaId ? { formulaId: formula.formulaId } : {}), ...(formula?.formulaRevisionId ? { formulaRevisionId: formula.formulaRevisionId } : {}), expression: formula?.expression ?? "", inputValues: { ...(formula?.inputValues ?? {}) }, allowRotation: formula?.allowRotation ?? false, ...(formula?.rotationControl ? { rotationControl: formula.rotationControl } : {}) });
  const updateRotation = (change: Partial<Pick<ProductDraftFormulaPricing, "allowRotation" | "rotationControl">>) => onFormulaChange({ ...formulaDraft(), ...change });
  const updateFormulaInput = (input: FormulaDomainDeclaredInput, value: number | boolean) => onFormulaChange({ ...formulaDraft(), inputValues: { ...(formula?.inputValues ?? {}), [input.key]: value } });
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[0.75rem] font-semibold uppercase tracking-wide text-muted-foreground">Formula</div>
          <div className="flex flex-wrap gap-2">
            <ReferenceButton size="compact" disabled={Boolean(disabled)} onClick={onManageFormulaLibrary}>New Formula</ReferenceButton>
            <ReferenceButton size="compact" variant="outline" disabled={Boolean(disabled) || !formula?.formulaRevisionId} onClick={onManageFormulaLibrary}>Edit Formula</ReferenceButton>
            <ReferenceButton size="compact" variant="outline" onClick={onManageFormulaLibrary}>Manage Formula Library</ReferenceButton>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Cell label="Select Formula">
            <select disabled={!formulaAuthoringEditable} value={formula?.formulaId ?? ""} onChange={(event) => {
              const next = formulaLibrary.find((entry) => entry.formulaId === event.target.value);
              if (!next) return;
              onFormulaChange({
                source: "formula_revision",
                formulaId: next.formulaId,
                formulaRevisionId: next.revision.formulaRevisionId,
                expression: next.revision.expression,
                inputValues: defaultInputValues(next.revision.declaredInputs),
                allowRotation: formula?.allowRotation ?? false,
                ...(formula?.rotationControl ? { rotationControl: formula.rotationControl } : {}),
              });
            }}>
              <option value="">Select Formula</option>
              {formulaLibrary.map((entry) => <option key={entry.formulaId} value={entry.formulaId} disabled={entry.status !== "active"}>{entry.name} · Revision {entry.revision.revisionNumber}{entry.status !== "active" ? ` (${entry.status})` : ""}</option>)}
            </select>
          </Cell>
          <Cell label="Formula Revision">
            <select disabled={!formulaAuthoringEditable || !formula?.formulaId} value={formula?.formulaRevisionId ?? ""} onChange={(event) => {
              const next = formulaRevisions.find((revision) => revision.formulaRevisionId === event.target.value);
              if (!next) return;
              onFormulaChange({
                ...formulaDraft(),
                formulaRevisionId: next.formulaRevisionId,
                expression: next.expression,
                inputValues: inputValuesForRevision(next.declaredInputs, formula?.inputValues ?? {}),
              });
            }}>
              {!formula?.formulaId && <option value="">Select a Formula first</option>}
              {formulaRevisions.map((revision) => <option key={revision.formulaRevisionId} value={revision.formulaRevisionId}>Revision {revision.revisionNumber}</option>)}
              {!formulaRevisions.length && selectedFormula && <option value={selectedFormula.revision.formulaRevisionId}>Revision {selectedFormula.revision.revisionNumber}</option>}
            </select>
            {selectedFormula && formula?.formulaRevisionId && formula?.formulaRevisionId !== selectedFormula.currentRevisionId ? <p className="mt-1 text-[0.6875rem] text-amber-700 dark:text-amber-300">Newer revision available. This Draft remains pinned until you select it.</p> : null}
          </Cell>
        </div>
        <SourceCard active={Boolean(formula?.formulaRevisionId) || formula?.source === "unsupported_legacy"} title={formula?.formulaName ?? selectedFormula?.name ?? "Formula revision"} badge={formula?.source === "unsupported_legacy" ? "Legacy-compatible" : formula?.formulaRevisionId ? `Revision ${selectedRevision?.revisionNumber ?? formula?.formulaRevisionNumber ?? ""}` : "Not selected"}>
          {formula?.source === "unsupported_legacy" ? <p className="text-[0.75rem] text-muted-foreground">Legacy compatibility Formula is read-only. Select a canonical Formula revision to stage an intentional Draft canonicalization.</p> : null}
          <Cell label="Formula Expression"><textarea readOnly value={formula?.source === "unsupported_legacy" ? formula.legacyExpression ?? formula.expression : formula?.expression ?? ""} placeholder="Select a Formula revision" className="min-h-20 w-full resize-y font-mono" /></Cell>
          {declaredInputs.length ? <div className="mt-2"><div className="text-[0.75rem] font-semibold uppercase tracking-wide text-muted-foreground">Product-specific Formula Inputs</div><div className="mt-2 grid gap-2 sm:grid-cols-2">{declaredInputs.map((input) => <FormulaInputValueField key={input.key} input={input} value={formula?.inputValues?.[input.key]} disabled={!formulaAuthoringEditable || input.authorable === false} onChange={(value) => updateFormulaInput(input, value)} />)}</div></div> : <p className="mt-2 text-[0.6875rem] text-muted-foreground">This Formula revision declares no Product-specific inputs.</p>}
          <p className="mt-2 text-[0.6875rem] text-muted-foreground">Formula expressions are immutable Formula Library revisions. Product Drafts store only the selected revision and these declared input values.</p>
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
            disabled={!sheetWidth || !formulaAuthoringEditable || sheetWidth.authorable === false}
            inputMode="decimal"
            value={sheetWidth ? String(formula?.inputValues?.[sheetWidth.key] ?? sheetWidth.defaultValue ?? "") : "Not available"}
            onChange={(event) => sheetWidth && event.target.value !== "" && updateFormulaInput(sheetWidth, Number(event.target.value))}
          />
        </Cell>
        <Cell label="Sheet length (in)">
          <input
            className="num h-8 text-[0.8125rem]"
            disabled={!sheetLength || !formulaAuthoringEditable || sheetLength.authorable === false}
            inputMode="decimal"
            value={sheetLength ? String(formula?.inputValues?.[sheetLength.key] ?? sheetLength.defaultValue ?? "") : "Not available"}
            onChange={(event) => sheetLength && event.target.value !== "" && updateFormulaInput(sheetLength, Number(event.target.value))}
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

function FormulaInputValueField({ input, value, disabled, onChange }: Readonly<{
  input: FormulaDomainDeclaredInput;
  value: number | boolean | undefined;
  disabled: boolean;
  onChange: (value: number | boolean) => void;
}>) {
  const hint = [input.description, input.unit ? `Unit: ${input.unit.replace("_", " ")}` : null, input.required ? "Required" : "Optional"].filter(Boolean).join(" · ");
  const current = value ?? input.defaultValue;
  if (input.type === "boolean") return <Cell label={input.label} hint={hint}>
    <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-surface-2 px-2 text-[0.75rem] text-muted-foreground">
      <input type="checkbox" disabled={disabled} checked={Boolean(current)} onChange={(event) => onChange(event.target.checked)} />
      <span>{current ? "Yes" : "No"}</span>
    </label>
  </Cell>;
  return <Cell label={input.label} hint={hint}>
    <input
      className="num h-8 text-[0.8125rem]"
      type="number"
      inputMode="decimal"
      step={input.type === "integer" ? "1" : "any"}
      min={input.minimum}
      max={input.maximum}
      disabled={disabled}
      value={current === undefined ? "" : String(current)}
      onChange={(event) => {
        if (event.target.value === "") return;
        const next = Number(event.target.value);
        if (Number.isFinite(next)) onChange(input.type === "integer" ? Math.trunc(next) : next);
      }}
    />
  </Cell>;
}

export function OptionImpactsEditor({ options, disabled, onChange }: Readonly<{ options: ProductDraftOptionPricing["options"]; disabled?: boolean; onChange: (next: ProductDraftOptionPricing["options"]) => void }>) {
  const changeImpact = (optionIndex: number, choiceIndex: number | undefined, impacts: readonly ProductDraftOptionPricingImpact[]) => onChange(options.map((option, index) => index !== optionIndex ? option : choiceIndex === undefined ? { ...option, nodeImpacts: impacts, nodeImpact: impacts.length === 1 ? impacts[0]! : null } : { ...option, choices: option.choices.map((choice, position) => position === choiceIndex ? { ...choice, impacts, impact: impacts.length === 1 ? impacts[0]! : null } : choice) }));
  const changeOverride = (optionIndex: number, choiceIndex: number, override: ProductDraftOptionPricingOverride | null) => onChange(options.map((option, index) => index !== optionIndex ? option : { ...option, choices: option.choices.map((choice, position) => position === choiceIndex ? { ...choice, override } : choice) }));
  if (options.length === 0) return <p className="text-[0.75rem] italic text-muted-foreground">No option pricing impacts — options change production only.</p>;
  const rows = options.flatMap((option, optionIndex) => [
    { option, optionIndex, label: "All selections", editable: true, impacts: option.nodeImpacts, choiceIndex: undefined as number | undefined, override: undefined as ProductDraftOptionPricingOverride | undefined },
    ...option.choices.map((choice, choiceIndex) => ({ option, optionIndex, label: choice.label, editable: choice.editable, impacts: choice.impacts, choiceIndex, override: choice.override })),
  ]);
  return <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[520px] text-[0.8125rem]"><thead><tr className="border-b border-border text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground"><th className="py-1.5 pr-3 text-left">Option</th><th className="py-1.5 pr-3 text-left">Choice</th><th className="py-1.5 pr-3 text-left">Pricing effect</th><th className="py-1.5 text-right">Value</th></tr></thead><tbody>{rows.flatMap((row) => [
    ...row.impacts.map((impact, impactIndex) => <ImpactRow key={`${row.option.optionId}:${row.choiceIndex ?? "node"}:${impactIndex}`} row={{ ...row, impact, impactIndex }} disabled={disabled} onChange={(next) => { const impacts = [...row.impacts]; impacts[impactIndex] = next; changeImpact(row.optionIndex, row.choiceIndex, impacts); }} onRemove={() => changeImpact(row.optionIndex, row.choiceIndex, row.impacts.filter((_, index) => index !== impactIndex))} onMove={(delta) => { const target = impactIndex + delta; if (target < 0 || target >= row.impacts.length) return; const impacts = [...row.impacts]; [impacts[impactIndex], impacts[target]] = [impacts[target]!, impacts[impactIndex]!]; changeImpact(row.optionIndex, row.choiceIndex, impacts); }} />),
    <tr key={`${row.option.optionId}:${row.choiceIndex ?? "node"}:add`}><td colSpan={4}><ReferenceButton size="compact" disabled={disabled || !row.editable} onClick={() => changeImpact(row.optionIndex, row.choiceIndex, [...row.impacts, { type: "fixed", value: 0 }])}><Plus className="size-3.5" />Add impact</ReferenceButton>{row.choiceIndex !== undefined && <><select className="ml-2" disabled={disabled || !row.editable} value={row.override ? `${row.override.mode}:${row.override.target}` : "none"} onChange={(event) => { const [mode, target] = event.target.value.split(":"); changeOverride(row.optionIndex, row.choiceIndex!, event.target.value === "none" ? null : { mode: mode as ProductDraftOptionPricingOverride["mode"], target: target as ProductDraftOptionPricingOverride["target"], value: mode === "multiply" ? 1 : 0 }); }}><option value="none">No base-rate override</option>{["set", "add", "multiply"].flatMap((mode) => ["per_square_foot", "per_piece", "minimum_charge"].map((target) => <option key={`${mode}:${target}`} value={`${mode}:${target}`}>{mode} {target.replaceAll("_", " ")}</option>))}</select>{row.override && (row.override.mode === "multiply" ? <input aria-label="Base-rate override value" className="num ml-2 w-20 text-right" disabled={disabled || !row.editable} inputMode="decimal" value={row.override.value} onChange={(event) => changeOverride(row.optionIndex, row.choiceIndex!, { ...row.override!, value: Number(event.target.value) })} /> : <MoneyInput ariaLabel="Base-rate override value" className="ml-2 w-20 text-right" disabled={disabled || !row.editable} value={row.override.value} onChange={(value) => { if (value !== null) changeOverride(row.optionIndex, row.choiceIndex!, { ...row.override!, value }); }} />)}</>}</td></tr>,
  ])}</tbody></table></div>;
}

const monetaryImpact = (impact: ProductDraftOptionPricingImpact): boolean => impact.type === "fixed" || impact.type === "per_item" || impact.type === "per_square_foot" || impact.type === "per_linear_foot" || impact.type === "per_inch";

function ImpactRow({ row, disabled, onChange, onRemove, onMove }: Readonly<{ row: { option: ProductDraftOptionPricing["options"][number]; optionIndex: number; label: string; editable: boolean; impact: ProductDraftOptionPricingImpact; impactIndex: number; choiceIndex?: number }; disabled?: boolean; onChange: (impact: ProductDraftOptionPricingImpact) => void; onRemove: () => void; onMove: (delta: -1 | 1) => void }>) {
  const impact = row.impact;
  const editable = !disabled && row.editable;
  const currency = impact.type !== "formula" && monetaryImpact(impact);
  return <tr className="border-b border-border/60 last:border-0"><td className="py-1 pr-3">{row.option.label}</td><td className="py-1 pr-3 text-muted-foreground">{row.label}</td><td className="py-1 pr-3"><select disabled={!editable} value={impact.type} onChange={(event) => { const type = event.target.value as ProductDraftOptionPricingImpact["type"]; onChange(type === "formula" ? { type, formula: "" } : { type, value: type === "multiplier" ? 1 : 0 } as ProductDraftOptionPricingImpact); }}><option value="fixed">Fixed amount</option><option value="per_item">Per item</option><option value="per_square_foot">Per square foot</option><option value="per_linear_foot">Per linear foot</option><option value="per_inch">Per inch</option><option value="percent_of_base">Percent of base</option><option value="percent_of_options_subtotal">Percent of options subtotal</option><option value="percent_of_line_subtotal">Percent of line subtotal</option><option value="multiplier">Multiplier</option><option value="formula">Formula</option></select></td><td className="num py-1 text-right">{impact.type === "formula" ? <input className="w-24 text-right" disabled={!editable} value={impact.formula} onChange={(event) => onChange({ ...impact, formula: event.target.value })} /> : currency ? <MoneyInput ariaLabel="Option pricing amount" className="w-24 text-right" disabled={!editable} value={impact.value} onChange={(value) => { if (value !== null) onChange({ ...impact, value }); }} /> : <input className="w-24 text-right" disabled={!editable} inputMode="decimal" value={impact.value} onChange={(event) => onChange({ ...impact, value: Number(event.target.value) } as ProductDraftOptionPricingImpact)} />}<ReferenceButton size="compactIcon" disabled={!editable} onClick={() => onMove(-1)} aria-label="Move impact up">↑</ReferenceButton><ReferenceButton size="compactIcon" disabled={!editable} onClick={() => onMove(1)} aria-label="Move impact down">↓</ReferenceButton><ReferenceButton size="compactIcon" disabled={!editable} onClick={onRemove} aria-label="Remove impact"><Trash2 className="size-3.5" /></ReferenceButton></td></tr>;
}
function SourceCard({ active, title, badge, children }: Readonly<{ active: boolean; title: string; badge?: string; children: React.ReactNode }>) { return <div className={`rounded-md border p-2.5 transition-colors ${active ? "border-primary/60 bg-primary/5" : "border-border"}`}><div className="flex w-full items-center gap-2 text-left"><span className={`grid size-4 shrink-0 place-items-center rounded-full border ${active ? "border-primary" : "border-border"}`}>{active && <span className="size-2 rounded-full bg-primary" />}</span><span className="text-[0.8125rem] font-medium">{title}</span>{badge && <Chip>{badge}</Chip>}</div>{active && <div className="mt-2 pl-6">{children}</div>}</div>; }
