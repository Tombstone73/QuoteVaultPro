import { ArrowRight, ExternalLink, Eye, Plus, Trash2 } from "lucide-react";
import React, { useState } from "react";
import type { ProductDraftOption, ProductDraftRouting, ProductProductionUnitRule, ProductProductionUnitSpecification, RoutingWorkspaceRead } from "../api";
import { Cell, Chip } from "./referencePrimitives";

/** Direct presentation port of production-routing.tsx, adapted to V2's canonical generic unit schema. */
export function ProductionUnits({ specification, options, selectionKeys = {}, disabled, onChange }: Readonly<{
  specification: ProductProductionUnitSpecification | null;
  options: readonly ProductDraftOption[];
  /** Product Draft options are identified by optionId, while Production rules
   * correctly persist the canonical PBV2 selectionKey. */
  selectionKeys?: Readonly<Record<string, string>>;
  disabled?: boolean;
  onChange: (specification: ProductProductionUnitSpecification) => void;
}>) {
  const rules = specification?.rules ?? [];
  const selectableOptions = options.filter((option) => option.choices.length > 0);
  const optionFor = (selectionKey: string) => selectableOptions.find((option) => option.optionId === selectionKey || selectionKeys[option.optionId] === selectionKey);
  const update = (index: number, patch: (rule: ProductProductionUnitRule) => ProductProductionUnitRule) =>
    onChange({ schemaVersion: 1, rules: rules.map((rule, position) => position === index ? patch(rule) : rule) });
  const remove = (index: number) => onChange({ schemaVersion: 1, rules: rules.filter((_, position) => position !== index) });

  return <div className="space-y-2.5">
    <p className="text-[12px] text-muted-foreground">Production units are the physical things that get made — sides, pages, layers or panels. Add a condition when a unit only exists for certain options.</p>
    <div className="space-y-2">
      {rules.map((unit, index) => {
        const conditionOption = unit.when ? optionFor(unit.when.selectionKey) : undefined;
        return <div key={`${unit.key}-${index}`} className="rounded-md border border-border p-2.5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2"><span className="truncate text-[13px] font-semibold">{unit.key || "Untitled unit"}</span>{conditionOption ? <Chip tone="accent">When {conditionOption.label} = {String(unit.when?.equals ?? "")}</Chip> : <Chip tone="ok">Always</Chip>}</div>
            <button type="button" className="size-7 shrink-0 text-muted-foreground hover:text-late" aria-label="Remove production unit" disabled={disabled} onClick={() => remove(index)}><Trash2 className="size-3.5" /></button>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Cell label="Unit name"><input className="h-8 text-[13px]" disabled={disabled} value={unit.key} onChange={(event) => update(index, (current) => ({ ...current, key: event.target.value }))} /></Cell>
            <Cell label="Side"><select disabled={disabled} value={unit.side ?? ""} onChange={(event) => update(index, (current) => ({ ...current, side: event.target.value ? event.target.value as "front" | "back" : undefined }))}><option value="">Not specified</option><option value="front">Front</option><option value="back">Back</option></select></Cell>
            <Cell label="Source page"><input className="h-8 text-[13px]" disabled={disabled} type="number" min="1" value={unit.sourcePageIndex === undefined ? "" : unit.sourcePageIndex + 1} onChange={(event) => update(index, (current) => ({ ...current, sourcePageIndex: event.target.value === "" ? undefined : Number(event.target.value) - 1 }))} /></Cell>
            <Cell label="Layer"><input className="h-8 text-[13px]" disabled={disabled} value={unit.layerKey ?? ""} onChange={(event) => update(index, (current) => ({ ...current, layerKey: event.target.value || undefined }))} /></Cell>
            <Cell label="Required when"><select disabled={disabled} value={unit.when?.selectionKey ?? ""} onChange={(event) => {
              const selected = optionFor(event.target.value);
              update(index, (current) => ({ ...current, when: selected ? { selectionKey: selectionKeys[selected.optionId] ?? selected.optionId, equals: selected.choices[0]?.choiceValue ?? "" } : undefined }));
            }}><option value="">Always</option>{selectableOptions.map((option) => <option key={option.optionId} value={selectionKeys[option.optionId] ?? option.optionId}>{option.label}</option>)}</select></Cell>
            {conditionOption && <Cell label="Choice"><select disabled={disabled} value={String(unit.when?.equals ?? "")} onChange={(event) => update(index, (current) => current.when ? { ...current, when: { ...current.when, equals: event.target.value } } : current)}>{conditionOption.choices.map((choice) => <option key={choice.choiceValue} value={choice.choiceValue}>{choice.label}</option>)}</select></Cell>}
          </div>
        </div>;
      })}
      {rules.length === 0 && <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[12px] italic text-muted-foreground">No production units — nothing is manufactured for this Product.</p>}
    </div>
    <button type="button" className="button secondary h-7 gap-1 text-[12px]" disabled={disabled} onClick={() => onChange({ schemaVersion: 1, rules: [...rules, { key: `unit_${rules.length + 1}` }] })}><Plus className="size-3.5" />Add production unit</button>
  </div>;
}

/** Direct presentation port of RoutingSection; Routing retains ownership of template step authoring. */
export function RoutingSection({ routing, templates, disabled, onChange, onManageRoutes }: Readonly<{
  routing: ProductDraftRouting["routing"];
  templates: RoutingWorkspaceRead["templates"];
  disabled?: boolean;
  onChange: (routing: ProductDraftRouting["routing"]) => void;
  onManageRoutes?: () => void;
}>) {
  const [viewOpen, setViewOpen] = useState(false);
  const selected = routing.kind === "route_required" ? templates.find((template) => template.routeTemplateId === routing.routeTemplateId) : undefined;
  const selectTemplate = (routeTemplateId: string) => {
    const template = templates.find((item) => item.routeTemplateId === routeTemplateId);
    if (!template) return;
    onChange({ kind: "route_required", routeTemplateId: template.routeTemplateId, routeTemplateName: template.name, sourceTemplateRevision: template.revision, sourceTemplateFingerprint: template.definitionFingerprint, steps: template.steps.map((step) => ({ position: step.position, kind: step.kind as "proofing" | "prepress" | "production" | "fulfillment" })) });
  };
  const required = routing.kind === "route_required";

  return <div className="space-y-3">
    <p className="text-[12px] text-muted-foreground">Route Templates are defined and versioned in the Routing module. This Product only selects which one its orders should follow.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <Cell label="Route policy" hint="Whether orders for this Product must follow a route template."><select disabled={disabled} value={routing.kind} onChange={(event) => {
        if (event.target.value === "route_required") { const first = templates.find((template) => template.active); if (first) selectTemplate(first.routeTemplateId); return; }
        onChange(event.target.value === "no_route" ? { kind: "no_route" } : { kind: "unconfigured" });
      }}><option value="unconfigured">Unconfigured</option><option value="no_route">No route</option><option value="route_required">Route required</option></select></Cell>
      {required && <Cell label="Default route" hint="Selected from Route Templates owned by the Routing module."><select disabled={disabled} value={routing.routeTemplateId} onChange={(event) => selectTemplate(event.target.value)}><option value="">Select route template</option>{templates.filter((template) => template.active).map((template) => <option key={template.routeTemplateId} value={template.routeTemplateId}>{template.name}</option>)}</select></Cell>}
    </div>
    {required ? <>
      <div className="rounded-md border border-border p-2.5"><div className="flex flex-wrap items-center gap-2"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Route preview</span><Chip tone="ok">Read-only</Chip><span className="ml-auto text-[11px] text-muted-foreground">Revision {routing.sourceTemplateRevision ?? "—"}</span></div><div className="mt-1.5 text-[13px] font-semibold">{routing.routeTemplateName}</div><ol className="mt-2 flex flex-wrap items-center gap-1.5">{routing.steps.map((step, index) => <li key={step.position} className="flex items-center gap-1.5">{index > 0 && <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />}{/* Route steps are deliberately preview-only in Product Builder. */}<span className="rounded border border-border bg-surface-2 px-2 py-1 text-[12px] font-medium">{step.kind}</span></li>)}{routing.steps.length === 0 && <li className="text-[12px] italic text-muted-foreground">This template has no steps.</li>}</ol><div className="mt-2.5 flex flex-wrap items-center gap-2"><button type="button" className="button secondary h-7 gap-1.5 text-[12px]" onClick={() => setViewOpen(true)}><Eye className="size-3.5" />View route</button>{onManageRoutes && <button type="button" className="button secondary h-7 gap-1.5 text-[12px]" onClick={onManageRoutes}><ExternalLink className="size-3.5" />Manage routes</button>}<span className="text-[11px] text-muted-foreground">Editing steps happens in the Routing module.</span></div></div>
      {viewOpen && <div className="v2-ref-dialog-backdrop" role="dialog" aria-modal="true" aria-label="Route template"><div className="v2-ref-dialog"><h2>{selected?.name ?? routing.routeTemplateName}</h2><p>Route template defined in the Routing module.</p><dl className="grid grid-cols-2 gap-2 text-[12px]"><div><dt className="text-muted-foreground">Status</dt><dd className="font-medium">{selected?.active ? "Active" : "Inactive"}</dd></div><div><dt className="text-muted-foreground">Revision</dt><dd className="font-medium">{routing.sourceTemplateRevision ?? "—"}</dd></div><div><dt className="text-muted-foreground">Owned by</dt><dd className="font-medium">Routing module</dd></div><div><dt className="text-muted-foreground">Steps</dt><dd className="font-medium">{routing.steps.length}</dd></div></dl><ol className="space-y-1">{routing.steps.map((step, index) => <li key={step.position} className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px]"><span className="num w-4 text-muted-foreground">{index + 1}</span>{step.kind}</li>)}</ol><p className="text-[11px] text-muted-foreground">Read-only context. Changes to this route affect every Product that references it.</p><button type="button" className="button secondary" onClick={() => setViewOpen(false)}>Close</button></div></div>}
    </> : <p className="text-[12px] text-muted-foreground">{routing.kind === "no_route" ? "Orders skip Routing — typical for service fees and fulfillment-only Products." : "Routing is unconfigured; staff will route these orders manually."}</p>}
  </div>;
}
