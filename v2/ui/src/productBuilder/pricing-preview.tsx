import React from "react";
import { AlertTriangle, Calculator, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ProductDraftOption, ProductDraftPricingPreview, ProductRecipeComponent, ProductProductionUnitSpecification } from "../api";
import { Cell, ReferenceButton } from "./referencePrimitives";

export type PricingPreviewInputs = Readonly<{ quantity: string; width: string; height: string; selections: Record<string, unknown> }>;
export type PreviewFinding = Readonly<{ severity: "error" | "warning" | "info"; code: string; message: string; section: string }>;

/**
 * Presentation port of reference/lovable-ui/src/components/app/product-editor/pricing-preview.tsx.
 * It renders canonical V2 preview results only; it never runs a client-side calculator.
 */
export function PricingPreviewRail({ productId, measurementMode, options, recipe, production, inputs, onInputsChange, result, loading, error, onPreview, findings, onJump }: Readonly<{
  productId?: string;
  measurementMode: "dimensions_required" | "quantity_only";
  options: readonly ProductDraftOption[];
  recipe: readonly ProductRecipeComponent[];
  production: ProductProductionUnitSpecification | null;
  inputs: PricingPreviewInputs;
  onInputsChange: (next: PricingPreviewInputs) => void;
  result: ProductDraftPricingPreview | null;
  loading?: boolean;
  error?: string | null;
  onPreview: () => void;
  findings: readonly PreviewFinding[];
  onJump?: (section: string) => void;
}>) {
  const visible = options.filter((option) => option.inputType === "select" || option.inputType === "boolean" || option.inputType === "number" || option.inputType === "text");

  return <div className="space-y-3">
    <Card icon={<Calculator className="size-3.5 text-primary" />} title="Configuration preview" note="Server-calculated">
      {measurementMode === "dimensions_required" ? <div className="grid grid-cols-3 gap-2">
        <Cell label="Width"><input className="num h-8 text-[0.8125rem]" inputMode="decimal" value={inputs.width} onChange={(event) => onInputsChange({ ...inputs, width: event.target.value })} /></Cell>
        <Cell label="Height"><input className="num h-8 text-[0.8125rem]" inputMode="decimal" value={inputs.height} onChange={(event) => onInputsChange({ ...inputs, height: event.target.value })} /></Cell>
        <Cell label="Qty"><input className="num h-8 text-[0.8125rem]" type="number" min="1" value={inputs.quantity} onChange={(event) => onInputsChange({ ...inputs, quantity: event.target.value })} /></Cell>
      </div> : <div className="grid grid-cols-3 gap-2"><Cell label="Qty"><input className="num h-8 text-[0.8125rem]" type="number" min="1" value={inputs.quantity} onChange={(event) => onInputsChange({ ...inputs, quantity: event.target.value })} /></Cell></div>}

      <div className="mt-2.5 space-y-2">
        {visible.map((option) => <Cell key={option.optionId} label={option.label}>
          {option.choices.length ? <select value={String(inputs.selections[option.optionId] ?? option.defaultValue ?? "")} onChange={(event) => onInputsChange({ ...inputs, selections: { ...inputs.selections, [option.optionId]: event.target.value } })}>
            <option value="">Select</option>{option.choices.map((choice) => <option key={choice.choiceValue} value={choice.choiceValue}>{choice.label}</option>)}
          </select> : <input className="h-8 text-[0.8125rem]" placeholder="Free text at quote time" value={String(inputs.selections[option.optionId] ?? "")} onChange={(event) => onInputsChange({ ...inputs, selections: { ...inputs.selections, [option.optionId]: event.target.value } })} />}
        </Cell>)}
      </div>

      <ReferenceButton variant="outline" size="sm" className="mt-2.5" disabled={!productId || loading} aria-busy={loading || undefined} onClick={onPreview}>{loading ? "Resolving…" : "Preview price"}</ReferenceButton>
      {loading && <p className="mt-2.5 text-[0.6875rem] text-muted-foreground" role="status">Resolving the canonical server pricing preview…</p>}
      {!loading && error && <p className="mt-2.5 rounded-md border border-late/40 bg-late/10 px-2.5 py-2 text-[0.75rem] text-late" role="alert">{error}</p>}
      {!loading && !error && (result ? <PreviewResult result={result} /> : <p className="mt-2.5 text-[0.6875rem] text-muted-foreground">Preview calls the canonical server pricing service; no client calculation is used.</p>)}
    </Card>

    <Card title="Material resolution"><dl className="space-y-1 text-[0.75rem]">{recipe.length ? recipe.map((component, index) => <Row key={`${component.componentId ?? component.materialId}:${index}`} label={component.materialName ?? component.materialId} value={`${component.quantity} ${component.unit}${component.condition ? " · conditional" : ""}`} muted={Boolean(component.condition)} />) : <Row label="Recipe" value="No lines" muted />}</dl>{onJump && <RailJump target="materials" label="Edit materials" onJump={onJump} />}</Card>
    <Card title="Production resolution"><dl className="space-y-1 text-[0.75rem]">{production?.rules.length ? production.rules.map((unit) => <Row key={unit.key} label={unit.key} value={unit.side ? `${unit.side} required` : "Required"} muted={Boolean(unit.when)} />) : <Row label="Units" value="Unconfigured" muted />}</dl>{onJump && <RailJump target="production" label="Edit production" onJump={onJump} />}</Card>
    <Card title="Weight resolution">
      <Cell label="Weight">
        <input className="num h-8 text-[0.8125rem]" disabled readOnly value="Not available" aria-describedby="weight-resolution-unavailable" />
      </Cell>
      <p id="weight-resolution-unavailable" className="mt-2 text-[0.6875rem] text-muted-foreground">Weight resolution is unavailable because the canonical V2 preview contract does not expose material-weight values.</p>
    </Card>
    <Card title="Validation findings" note={`${findings.length} finding${findings.length === 1 ? "" : "s"}`}><div className="space-y-2">{findings.length === 0 ? <p className="flex items-center gap-1.5 text-[0.75rem] text-ok"><CheckCircle2 className="size-3.5" />No local presentation finding. Publish remains server-validated.</p> : findings.map((finding) => <FindingRow key={`${finding.code}:${finding.message}`} finding={finding} onJump={onJump} />)}</div></Card>
  </div>;
}

function PreviewResult({ result }: Readonly<{ result: ProductDraftPricingPreview }>) {
  return <><dl className="mt-2.5 space-y-1 border-t border-border pt-2 text-[0.75rem]">
    {result.dimensions && <Row label="Area" value={`${result.dimensions.areaSquareFeet.toFixed(2)} sq ft`} />}
    {result.explanation.computedSheetUsage && <><Row label="Computed sheets" value={String(result.explanation.computedSheetUsage.sheetCount)} />{result.explanation.computedSheetUsage.allowRotation !== undefined && <Row label="Rotation" value={result.explanation.computedSheetUsage.allowRotation ? "ON" : "OFF"} />}</>}
    {result.tier && <Row label="Pricing tier" value={`${result.tier.basis}: ${result.tier.value}`} />}
    {result.breakdown.map((entry, index) => <Row key={`${entry.label}:${index}`} label={entry.label} value={money(entry.cents)} muted />)}
    <Row label="Minimum charge" value={result.minimumChargeApplied ? "Applied" : "Not applied"} muted />
    {result.warnings.map((warning) => <Row key={warning} label="Warning" value={warning} muted />)}
  </dl><div className="mt-2 flex items-end justify-between border-t border-border pt-2"><span className="text-[0.75rem] text-muted-foreground">Unit price</span><span className="num text-[0.875rem] font-semibold">{money(result.calculatedUnitAmount.cents)}</span></div><div className="flex items-end justify-between"><span className="text-[0.75rem] text-muted-foreground">Line total</span><span className="num text-[1.1875rem] font-bold">{money(result.calculatedLineAmount.cents)}</span></div></>;
}

function Card({ title, icon, note, children }: Readonly<{ title: string; icon?: React.ReactNode; note?: string; children: React.ReactNode }>) { return <section className="rounded-md border border-border"><header className="flex items-center gap-2 border-b border-border px-3 py-2">{icon}<h2 className="text-[0.75rem] font-bold uppercase tracking-wide">{title}</h2>{note && <span className="num ml-auto text-[0.6875rem] text-muted-foreground">{note}</span>}</header><div className="p-3">{children}</div></section>; }
function Row({ label, value, muted }: Readonly<{ label: string; value: string; muted?: boolean }>) { return <div className="flex items-baseline justify-between gap-3"><dt className={muted ? "text-muted-foreground" : ""}>{label}</dt><dd className="num shrink-0 text-right">{value}</dd></div>; }
function FindingRow({ finding, onJump }: Readonly<{ finding: PreviewFinding; onJump?: (section: string) => void }>) { const Icon = finding.severity === "error" ? XCircle : finding.severity === "warning" ? AlertTriangle : Info; const tone = finding.severity === "error" ? "text-late" : finding.severity === "warning" ? "text-warn" : "text-muted-foreground"; return <div className="flex gap-2"><Icon className={`mt-0.5 size-3.5 shrink-0 ${tone}`} /><div className="min-w-0"><p className="text-[0.75rem] leading-snug">{finding.message}</p><button type="button" onClick={() => onJump?.(finding.section)} className="num text-[0.625rem] uppercase tracking-wide text-muted-foreground hover:text-primary hover:underline">{finding.code} · go to {finding.section}</button></div></div>; }
function RailJump({ target, label, onJump }: Readonly<{ target: string; label: string; onJump: (section: string) => void }>) { return <button type="button" className="mt-2.5 num text-[0.625rem] uppercase tracking-wide text-muted-foreground hover:text-primary hover:underline" onClick={() => onJump(target)}>{label}</button>; }
function money(cents: number) { return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(cents / 100); }
