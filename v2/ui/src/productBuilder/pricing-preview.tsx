import React from "react";
import { AlertTriangle, Calculator, Info, XCircle } from "lucide-react";
import type { ProductDraftOption, ProductDraftPricingPreview, ProductRecipeComponent, ProductProductionUnitSpecification } from "../api";
import type { ProductOptionRule } from "../../../../shared/productOptionRules";
import { resolveProductOptionConfiguration } from "../../../../shared/productOptionConfigurationResolver";
import { Cell, ReferenceButton } from "./referencePrimitives";

export type PricingPreviewInputs = Readonly<{ quantity: string; width: string; height: string; selections: Record<string, unknown> }>;
export type PreviewFinding = Readonly<{ severity: "error" | "warning" | "info"; code: string; message: string; section: string }>;
export const previewSelectionKey = (optionId: string, selectionKeys: Readonly<Record<string, string>>): string => selectionKeys[optionId] ?? optionId;
export const visiblePreviewOptions = (
  options: readonly ProductDraftOption[],
  selectionKeys: Readonly<Record<string, string>>,
  configuration: ProductDraftPricingPreview["configuration"] | undefined,
) => options.filter((option) => {
  return !configuration || configuration.visibleOptionSelectionKeys.includes(previewSelectionKey(option.optionId, selectionKeys));
});

export const previewOptionValue = (
  inputs: PricingPreviewInputs,
  configuration: ProductDraftPricingPreview["configuration"],
  selectionKey: string,
): unknown => inputs.selections[selectionKey] ?? configuration.effectiveSelections[selectionKey];

export const withPreviewSelection = (
  inputs: PricingPreviewInputs,
  selectionKey: string,
  value: unknown,
): PricingPreviewInputs => {
  const selections = { ...inputs.selections };
  if (value === undefined) delete selections[selectionKey];
  else selections[selectionKey] = value;
  return { ...inputs, selections };
};
/**
 * Immediate Builder feedback uses the exact shared ProductVersion resolver.
 * The server returns the same projection with the price preview; this local
 * call only determines which authoring controls are currently applicable.
 */
export const resolvePreviewConfiguration = (
  options: readonly ProductDraftOption[],
  rules: readonly ProductOptionRule[],
  selections: Readonly<Record<string, unknown>>,
): ProductDraftPricingPreview["configuration"] => {
  const tree = {
    schemaVersion: 2,
    rootNodeIds: options.map((option) => option.optionId),
    nodes: Object.fromEntries(options.map((option) => [option.optionId, {
      id: option.optionId,
      kind: "question",
      label: option.label,
      ...(option.visibility ? { visibility: option.visibility } : {}),
      input: {
        type: option.inputType,
        selectionKey: option.selectionKey,
        required: option.required,
        ...(option.defaultValue === null ? {} : { defaultValue: option.defaultValue }),
      },
      choices: option.choices.map((choice) => ({
        value: choice.choiceValue,
        label: choice.label,
        ...(choice.visibilityRules?.length ? { visibilityRules: choice.visibilityRules } : {}),
      })),
    }])),
    optionRules: rules,
  } as any;
  const value = resolveProductOptionConfiguration(tree, selections);
  return {
    effectiveSelections: value.effectiveSelections,
    visibleOptionSelectionKeys: options
      .filter((option) => value.visibleNodeIds.includes(option.optionId))
      .map((option) => option.selectionKey),
    hiddenOptionSelectionKeys: options
      .filter((option) => !value.visibleNodeIds.includes(option.optionId))
      .map((option) => option.selectionKey),
    disabledOptionSelectionKeys: value.disabledOptionGroups,
    requiredOptionSelectionKeys: value.requiredOptionGroups,
    clearedOptionSelectionKeys: value.clearedOptionGroups,
    defaultedOptionSelectionKeys: value.defaultedOptionGroups,
  };
};

/**
 * Presentation port of reference/lovable-ui/src/components/app/product-editor/pricing-preview.tsx.
 * It renders canonical V2 preview results only; it never runs a client-side calculator.
 */
export function PricingPreviewRail({ productId, measurementMode, options, rules, selectionKeys, recipe, production, inputs, onInputsChange, result, loading, error, stale, canRetry, onPreview, findings, onJump }: Readonly<{
  productId?: string;
  measurementMode: "dimensions_required" | "quantity_only";
  options: readonly ProductDraftOption[];
  rules: readonly ProductOptionRule[];
  selectionKeys: Readonly<Record<string, string>>;
  recipe: readonly ProductRecipeComponent[];
  production: ProductProductionUnitSpecification | null;
  inputs: PricingPreviewInputs;
  onInputsChange: (next: PricingPreviewInputs) => void;
  result: ProductDraftPricingPreview | null;
  loading?: boolean;
  error?: string | null;
  stale?: boolean;
  /** Only server failures are retryable; incomplete configurations are not. */
  canRetry?: boolean;
  onPreview: () => void;
  findings: readonly PreviewFinding[];
  onJump?: (section: string) => void;
}>) {
  const immediateConfiguration = resolvePreviewConfiguration(options, rules, inputs.selections);
  // Retain the last server result for the confirmed price, but never let its
  // old option projection control the currently edited configuration.
  const configuration = immediateConfiguration;
  const visible = visiblePreviewOptions(options, selectionKeys, configuration);
  const missingJobInputs = measurementMode === "dimensions_required"
    ? ([inputs.width, inputs.height, inputs.quantity].every(isPositiveInput) ? [] : ["Enter width, height, and quantity greater than zero"])
    : (isPositiveInput(inputs.quantity) ? [] : ["Enter a quantity greater than zero"]);
  const missingRequiredOptions = configuration.requiredOptionSelectionKeys.filter((selectionKey) => isMissingSelection(configuration.effectiveSelections[selectionKey]));
  const missingConfiguration = [...missingJobInputs, ...missingRequiredOptions.map((selectionKey) => optionLabel(options, selectionKey) ?? selectionKey)];

  return <div className="space-y-2.5">
    <Card icon={<Calculator className="size-3.5 text-primary" />} title="Configuration preview" note="Server-authoritative">
      <section aria-label="Job inputs">
        <p className="mb-1.5 num text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">Job inputs</p>
        {measurementMode === "dimensions_required" ? <div className="grid grid-cols-3 gap-2">
        <Cell label="Width"><input className="num h-8 text-[0.8125rem]" inputMode="decimal" value={inputs.width} onChange={(event) => onInputsChange({ ...inputs, width: event.target.value })} /></Cell>
        <Cell label="Height"><input className="num h-8 text-[0.8125rem]" inputMode="decimal" value={inputs.height} onChange={(event) => onInputsChange({ ...inputs, height: event.target.value })} /></Cell>
        <Cell label="Qty"><input className="num h-8 text-[0.8125rem]" type="number" min="1" value={inputs.quantity} onChange={(event) => onInputsChange({ ...inputs, quantity: event.target.value })} /></Cell>
        </div> : <div className="grid grid-cols-3 gap-2"><Cell label="Qty"><input className="num h-8 text-[0.8125rem]" type="number" min="1" value={inputs.quantity} onChange={(event) => onInputsChange({ ...inputs, quantity: event.target.value })} /></Cell></div>}
      </section>

      {visible.length > 0 && <section className="mt-3 border-t border-border pt-2.5" aria-label="Product options">
        <p className="mb-1.5 num text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">Product options</p>
        <div className="space-y-2">
        {visible.map((option) => { const selectionKey = previewSelectionKey(option.optionId, selectionKeys), disabled = configuration.disabledOptionSelectionKeys.includes(selectionKey), required = configuration.requiredOptionSelectionKeys.includes(selectionKey); return <Cell key={option.optionId} label={option.label} hint={required ? "Required for this configuration" : undefined}>
          <PreviewOptionControl option={option} disabled={disabled} value={previewOptionValue(inputs, configuration, selectionKey)} onChange={(value) => onInputsChange(withPreviewSelection(inputs, selectionKey, value))} />
        </Cell>;})}
        </div>
      </section>}

      <section className="mt-3 border-t border-border pt-2.5" aria-label="Pricing result">
        <div className="flex items-center justify-between gap-2"><p className="num text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">Pricing result</p>{loading && <span className="text-[0.6875rem] text-muted-foreground" role="status">Updating price…</span>}</div>
        {result ? <PreviewResult result={result} stale={stale} /> : missingConfiguration.length ? <IncompleteConfiguration missing={missingConfiguration} /> : <p className="mt-2 text-[0.75rem] text-muted-foreground">Waiting for the canonical server price…</p>}
        {result && missingConfiguration.length ? <IncompleteConfiguration missing={missingConfiguration} /> : null}
        {error && <div className="mt-2 rounded-md border border-late/40 bg-late/10 px-2.5 py-2 text-[0.75rem] text-late" role="alert"><p>{error}</p>{result && <p className="mt-1 text-[0.6875rem]">The displayed price is the last confirmed result, not the current configuration.</p>}{canRetry && <ReferenceButton variant="outline" size="sm" className="mt-2" disabled={!productId || loading} onClick={onPreview}>Retry</ReferenceButton>}</div>}
        {(configuration.clearedOptionSelectionKeys.length || configuration.defaultedOptionSelectionKeys.length) ? <p className="mt-2 text-[0.6875rem] text-muted-foreground">Configuration rules applied: {configuration.clearedOptionSelectionKeys.length ? `${configuration.clearedOptionSelectionKeys.length} cleared` : ""}{configuration.clearedOptionSelectionKeys.length && configuration.defaultedOptionSelectionKeys.length ? ", " : ""}{configuration.defaultedOptionSelectionKeys.length ? `${configuration.defaultedOptionSelectionKeys.length} defaulted` : ""}.</p> : null}
      </section>
    </Card>

    <DetailsAndDiagnostics
      recipe={recipe}
      production={production}
      result={result}
      options={options}
      stale={stale}
      findings={findings}
      onJump={onJump}
    />
  </div>;
}

function PreviewOptionControl({ option, disabled, value, onChange }: Readonly<{
  option: ProductDraftOption;
  disabled: boolean;
  value: unknown;
  onChange: (value: unknown) => void;
}>) {
  if (option.inputType === "multiselect") {
    const selected = new Set(Array.isArray(value) ? value.map(String) : []);
    return <fieldset aria-label={option.label} className="flex flex-wrap gap-x-3 gap-y-1.5 py-1">{option.choices.map((choice) => <label key={choice.choiceValue} className="inline-flex items-center gap-1.5 text-[0.8125rem]"><input type="checkbox" disabled={disabled} checked={selected.has(choice.choiceValue)} onChange={(event) => { const next = event.target.checked ? [...selected, choice.choiceValue] : [...selected].filter((entry) => entry !== choice.choiceValue); onChange(next.length ? next : undefined); }} />{choice.label}</label>)}</fieldset>;
  }
  if (option.inputType === "select") return <select aria-label={option.label} disabled={disabled} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value || undefined)}><option value="">Select</option>{option.choices.map((choice) => <option key={choice.choiceValue} value={choice.choiceValue}>{choice.label}</option>)}</select>;
  if (option.inputType === "boolean") return <label className="inline-flex h-8 items-center gap-2 text-[0.8125rem]"><input aria-label={option.label} type="checkbox" disabled={disabled} checked={value === true} onChange={(event) => onChange(event.target.checked)} />{value === true ? "Yes" : "No"}</label>;
  if (option.inputType === "number") return <input aria-label={option.label} disabled={disabled} className="num h-8 text-[0.8125rem]" type="number" value={typeof value === "number" ? value : ""} onChange={(event) => { const raw = event.target.value; const parsed = Number(raw); onChange(raw === "" || !Number.isFinite(parsed) ? undefined : parsed); }} />;
  if (option.inputType === "textarea") return <textarea aria-label={option.label} disabled={disabled} className="min-h-16 w-full text-[0.8125rem]" placeholder="Free text at quote time" value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value || undefined)} />;
  return <input aria-label={option.label} disabled={disabled} className="h-8 text-[0.8125rem]" placeholder="Free text at quote time" value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value || undefined)} />;
}

function PreviewResult({ result, stale }: Readonly<{ result: ProductDraftPricingPreview; stale?: boolean }>) {
  return <><div className="mt-2 flex items-end justify-between"><span className="text-[0.75rem] text-muted-foreground">{stale ? "Last confirmed price" : "Confirmed price"}</span><span className="num text-[1.1875rem] font-bold">{money(result.calculatedLineAmount.cents)}</span></div><div className="flex items-end justify-between"><span className="text-[0.75rem] text-muted-foreground">Unit price</span><span className="num text-[0.875rem] font-semibold">{money(result.calculatedUnitAmount.cents)}</span></div></>;
}

/** Secondary resolution evidence stays available without competing with the
 * configuration and confirmed-price workflow above. Native disclosures keep
 * every section keyboard-accessible and collapsed until explicitly opened. */
function DetailsAndDiagnostics({ recipe, production, result, options, stale, findings, onJump }: Readonly<{
  recipe: readonly ProductRecipeComponent[];
  production: ProductProductionUnitSpecification | null;
  result: ProductDraftPricingPreview | null;
  options: readonly ProductDraftOption[];
  stale?: boolean;
  findings: readonly PreviewFinding[];
  onJump?: (section: string) => void;
}>) {
  return <details className="rounded-md border border-border" aria-label="Details and diagnostics">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
      <span className="text-[0.75rem] font-bold uppercase tracking-wide">Details &amp; diagnostics</span>
      <span className="ml-auto text-[0.6875rem] text-muted-foreground">Resolution evidence</span>
      <span aria-hidden className="text-muted-foreground">›</span>
    </summary>
    <div className="space-y-2 border-t border-border p-2">
      <CompactDisclosure title="Materials" summary={recipe.length ? `${recipe.length} requirement${recipe.length === 1 ? "" : "s"}` : "No requirements"}><dl className="space-y-1 text-[0.75rem]">{recipe.length ? recipe.map((component, index) => <Row key={`${component.componentId ?? component.materialId}:${index}`} label={component.materialName ?? component.materialId} value={`${component.quantity} ${component.unit}${component.condition ? " · conditional" : ""}`} muted={Boolean(component.condition)} />) : <Row label="Recipe" value="No lines" muted />}</dl>{onJump && <RailJump target="materials" label="Edit materials" onJump={onJump} />}</CompactDisclosure>
      <CompactDisclosure title="Production" summary={production?.rules.length ? `${production.rules.length} requirement${production.rules.length === 1 ? "" : "s"}` : "Unconfigured"}><dl className="space-y-1 text-[0.75rem]">{production?.rules.length ? production.rules.map((unit) => <Row key={unit.key} label={unit.key} value={unit.side ? `${unit.side} required` : "Required"} muted={Boolean(unit.when)} />) : <Row label="Units" value="Unconfigured" muted />}</dl>{onJump && <RailJump target="production" label="Edit production" onJump={onJump} />}</CompactDisclosure>
      <CompactDisclosure title="Weight" summary="Not available">
        <Cell label="Weight"><input className="num h-8 text-[0.8125rem]" disabled readOnly value="Not available" aria-describedby="weight-resolution-unavailable" /></Cell>
        <p id="weight-resolution-unavailable" className="mt-2 text-[0.6875rem] text-muted-foreground">Weight resolution is unavailable because the canonical V2 preview contract does not expose material-weight values.</p>
      </CompactDisclosure>
      <CompactDisclosure title="Pricing details" summary={result ? (stale ? "Last confirmed" : "Confirmed") : "No confirmed price"}>{result ? <PricingDetails result={result} options={options} /> : <p className="text-[0.75rem] text-muted-foreground">Pricing evidence appears after the canonical server confirms a preview.</p>}</CompactDisclosure>
      <CompactDisclosure title="Validation findings" summary={`${findings.length} product finding${findings.length === 1 ? "" : "s"}`}><div className="space-y-2">{findings.length === 0 ? <p className="flex items-center gap-1.5 text-[0.75rem] text-muted-foreground"><Info className="size-3.5" />No product publication finding. Publish remains server-validated.</p> : findings.map((finding) => <FindingRow key={`${finding.code}:${finding.message}`} finding={finding} onJump={onJump} />)}</div></CompactDisclosure>
    </div>
  </details>;
}

function PricingDetails({ result, options }: Readonly<{ result: ProductDraftPricingPreview; options: readonly ProductDraftOption[] }>) {
  const rotation = result.explanation.computedSheetUsage;
  const controlledOption = rotation?.rotationControl ? options.find((option) => option.optionId === rotation.rotationControl!.optionId) : undefined;
  const selectedRotationChoices = controlledOption && rotation?.rotationControl ? rotation.rotationControl.selectedChoiceValues.map((value) => controlledOption.choices.find((choice) => choice.choiceValue === value)?.label ?? value).join(", ") : undefined;
  return <dl className="space-y-1 text-[0.75rem]">
    {result.dimensions && <Row label="Area" value={`${result.dimensions.areaSquareFeet.toFixed(2)} sq ft`} />}
    {rotation && <><Row label="Computed sheets" value={String(rotation.sheetCount)} />{rotation.productAllowsRotation !== undefined && <Row label="Allow rotation" value={rotation.productAllowsRotation ? "ON" : "OFF"} />}{rotation.rotationControl && <Row label={controlledOption?.label ?? "Rotation control"} value={selectedRotationChoices || "No selection"} />}{rotation.effectiveRotation !== undefined ? <Row label="Effective rotation" value={rotation.effectiveRotation ? "ON" : "OFF"} /> : rotation.allowRotation !== undefined && <Row label="Rotation" value={rotation.allowRotation ? "ON" : "OFF"} />}</>}
    {result.tier && <Row label="Pricing tier" value={`${result.tier.basis}: ${result.tier.value}`} />}
    {result.breakdown.map((entry, index) => <Row key={`${entry.label}:${index}`} label={entry.label} value={money(entry.cents)} muted />)}
    <Row label="Minimum charge" value={result.minimumChargeApplied ? "Applied" : "Not applied"} muted />
    {result.warnings.map((warning) => <Row key={warning} label="Warning" value={warning} muted />)}
  </dl>;
}

function Card({ title, icon, note, children }: Readonly<{ title: string; icon?: React.ReactNode; note?: string; children: React.ReactNode }>) { return <section className="rounded-md border border-border"><header className="flex items-center gap-2 border-b border-border px-3 py-2">{icon}<h2 className="text-[0.75rem] font-bold uppercase tracking-wide">{title}</h2>{note && <span className="num ml-auto text-[0.6875rem] text-muted-foreground">{note}</span>}</header><div className="p-3">{children}</div></section>; }
function CompactDisclosure({ title, summary, children }: Readonly<{ title: string; summary: string; children: React.ReactNode }>) { return <details className="rounded-md border border-border"><summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden"><span className="text-[0.75rem] font-bold uppercase tracking-wide">{title}</span><span className="ml-auto text-[0.6875rem] text-muted-foreground">{summary}</span><span aria-hidden className="text-muted-foreground">›</span></summary><div className="border-t border-border p-3">{children}</div></details>; }
function IncompleteConfiguration({ missing }: Readonly<{ missing: readonly string[] }>) { return <div className="mt-2 rounded-md border border-warn/40 bg-warn/10 px-2.5 py-2 text-[0.75rem] text-warn"><p className="font-medium">Complete required information before pricing.</p><p className="mt-1 text-[0.6875rem]">{missing.join(" · ")}</p></div>; }
function Row({ label, value, muted }: Readonly<{ label: string; value: string; muted?: boolean }>) { return <div className="flex items-baseline justify-between gap-3"><dt className={muted ? "text-muted-foreground" : ""}>{label}</dt><dd className="num shrink-0 text-right">{value}</dd></div>; }
function FindingRow({ finding, onJump }: Readonly<{ finding: PreviewFinding; onJump?: (section: string) => void }>) { const Icon = finding.severity === "error" ? XCircle : finding.severity === "warning" ? AlertTriangle : Info; const tone = finding.severity === "error" ? "text-late" : finding.severity === "warning" ? "text-warn" : "text-muted-foreground"; return <div className="flex gap-2"><Icon className={`mt-0.5 size-3.5 shrink-0 ${tone}`} /><div className="min-w-0"><p className="text-[0.75rem] leading-snug">{finding.message}</p><button type="button" onClick={() => onJump?.(finding.section)} className="num text-[0.625rem] uppercase tracking-wide text-muted-foreground hover:text-primary hover:underline">{finding.code} · go to {finding.section}</button></div></div>; }
function RailJump({ target, label, onJump }: Readonly<{ target: string; label: string; onJump: (section: string) => void }>) { return <button type="button" className="mt-2.5 num text-[0.625rem] uppercase tracking-wide text-muted-foreground hover:text-primary hover:underline" onClick={() => onJump(target)}>{label}</button>; }
function optionLabel(options: readonly ProductDraftOption[], selectionKey: string): string | undefined { return options.find((option) => option.selectionKey === selectionKey)?.label; }
function isMissingSelection(value: unknown): boolean { return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0); }
function isPositiveInput(value: string): boolean { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0; }
function money(cents: number) { return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(cents / 100); }
