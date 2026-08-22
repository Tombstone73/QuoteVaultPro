import { Plus, Trash2 } from "lucide-react";
import React from "react";
import type { ProductDraftOption, ProductMaterial, ProductRecipeComponent } from "../api";
import { Cell, Chip, Picker, ReferenceButton, Sub, Toggle } from "./referencePrimitives";

/** Direct presentation port of the approved Lovable Recipe editor. V2 keeps
 * canonical IDs behind the controls; inventory normalization is Material-owned
 * and intentionally has no editable UI toggle. */
export function RecipeEditor({ components, materials, options, primaryMaterialName, disabled, onChange }: Readonly<{
  components: readonly ProductRecipeComponent[];
  materials: readonly ProductMaterial[];
  options: readonly ProductDraftOption[];
  /** Canonical catalog read-model fact; V2 has no ProductVersion primary-material mutation. */
  primaryMaterialName?: string;
  disabled?: boolean;
  onChange: (components: readonly ProductRecipeComponent[]) => void;
}>) {
  const selectableOptions = options.filter((option) => option.choices.length > 0);
  const materialFor = (materialId: string) => materials.find((material) => material.materialId === materialId);
  const optionFor = (optionId: string) => selectableOptions.find((option) => option.optionId === optionId);
  const update = (index: number, patch: (component: ProductRecipeComponent) => ProductRecipeComponent) => onChange(components.map((component, position) => position === index ? patch(component) : component));

  return <div className="space-y-2.5">
    <p className="text-[0.75rem] text-muted-foreground">Recipe lines describe consumption, not price. A line with a condition is only consumed when that option choice is selected.</p>
    {components.length === 0 && <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[0.75rem] italic text-muted-foreground">No recipe — this Product consumes no inventory.</p>}
    <div className="space-y-2">
      {components.map((line, index) => {
        const material = materialFor(line.materialId);
        const conditionOption = line.condition ? optionFor(line.condition.optionId) : undefined;
        return <div key={line.componentId ?? `${line.materialId}-${index}`} className="rounded-md border border-border p-2.5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate text-[0.8125rem] font-semibold">{material?.name ?? line.materialName ?? "Material component"}</span>
              {line.replacesPbv2Compatibility ? <Chip tone="accent">Replaces compatibility requirement</Chip> : <Chip>Additional</Chip>}
              {conditionOption ? <span className="truncate text-[0.6875rem] text-muted-foreground">When {conditionOption.label} = {line.condition?.choiceValue}</span> : <span className="text-[0.6875rem] text-muted-foreground">Always</span>}
            </div>
            <ReferenceButton variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground hover:text-late" aria-label="Remove recipe line" disabled={disabled} onClick={() => onChange(components.filter((_, position) => position !== index))}><Trash2 className="size-3.5" /></ReferenceButton>
          </div>
          <div className="mt-2 grid gap-2 @container sm:grid-cols-2 lg:grid-cols-4">
            <Cell label="Material"><select value={line.materialId} disabled={disabled} onChange={(event) => { const selected = materialFor(event.target.value); update(index, (current) => ({ ...current, materialId: event.target.value, materialName: selected?.name, materialSku: selected?.sku })); }}><option value="">Select material</option>{materials.map((item) => <option key={item.materialId} value={item.materialId}>{item.name}</option>)}</select></Cell>
            <Cell label="Requirement basis"><Picker value={line.quantityKind} disabled={disabled} items={["per_line", "per_piece", "per_area"] as const} onChange={(quantityKind) => update(index, (current) => ({ ...current, quantityKind }))} /></Cell>
            <Cell label="Quantity / factor"><input className="num h-8 text-[0.8125rem]" disabled={disabled} inputMode="decimal" value={line.quantity} onChange={(event) => update(index, (current) => ({ ...current, quantity: event.target.value }))} /></Cell>
            <Cell label="Unit"><Picker value={line.unit} disabled={disabled} items={["each", "square_foot", "linear_foot", "sheet", "roll"] as const} onChange={(unit) => update(index, (current) => ({ ...current, unit }))} /></Cell>
            <Cell label="Option condition" hint="Leave as Always for unconditional consumption."><select value={line.condition?.optionId ?? ""} disabled={disabled} onChange={(event) => { const selected = optionFor(event.target.value); update(index, (current) => ({ ...current, condition: selected ? { type: "selected", optionId: selected.optionId, choiceValue: selected.choices[0]?.choiceValue ?? "" } : undefined })); }}><option value="">Always</option>{selectableOptions.map((option) => <option key={option.optionId} value={option.optionId}>{option.label}</option>)}</select></Cell>
            {conditionOption && <Cell label="Choice"><select value={line.condition?.choiceValue ?? ""} disabled={disabled} onChange={(event) => update(index, (current) => current.condition ? { ...current, condition: { ...current.condition, choiceValue: event.target.value } } : current)}>{conditionOption.choices.map((choice) => <option key={choice.choiceValue} value={choice.choiceValue}>{choice.label}</option>)}</select></Cell>}
            <Toggle label="Replace matching legacy PBV2 compatibility requirement" checked={Boolean(line.replacesPbv2Compatibility)} disabled={disabled} onChange={(replacesPbv2Compatibility) => update(index, (current) => ({ ...current, replacesPbv2Compatibility }))} />
          </div>
        </div>;
      })}
    </div>
    <ReferenceButton variant="outline" size="sm" className="h-7 gap-1" disabled={disabled || materials.length === 0} onClick={() => { const material = materials[0]; if (!material) return; onChange([...components, { materialId: material.materialId, materialName: material.name, materialSku: material.sku, quantity: "1", unit: material.unit, quantityKind: "per_piece" }]); }}><Plus className="size-3.5" />Add material requirement</ReferenceButton>

    <PrimaryMaterialAndWeight primaryMaterialName={primaryMaterialName} />
  </div>;
}

/**
 * Literal Lovable primary-material/weight panel. V2 recipe components do not
 * define a Product-level primary-material, shipping, weight, or trim contract;
 * those facts remain unavailable rather than being fabricated in the client.
 */
function PrimaryMaterialAndWeight({ primaryMaterialName }: Readonly<{ primaryMaterialName?: string }>) {
  const unavailable = "Not available in the current canonical V2 Product contract.";

  return <Sub title="Primary material & weight">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Cell label="Primary material" hint={unavailable}>
        <input className="h-8 text-[0.8125rem]" readOnly value={primaryMaterialName ?? "Not configured"} aria-label="Primary material" />
      </Cell>
      <Cell label="Shipping policy" hint={unavailable}>
        <select disabled aria-label="Shipping policy"><option>Not available in V2</option></select>
      </Cell>
      <Cell label="Material weight" hint="Resolved from the material record. V2 does not expose this Product-level projection.">
        <input className="num h-8 text-[0.8125rem]" readOnly value="Not configured" aria-label="Material weight" />
      </Cell>
      <Cell label="Weight basis" hint={unavailable}>
        <select disabled aria-label="Weight basis"><option>Not available in V2</option></select>
      </Cell>
      <Cell label="Fallback weight" hint={unavailable}>
        <input className="num h-8 text-[0.8125rem]" readOnly value="Not configured" aria-label="Fallback weight" />
      </Cell>
      <Cell label="Fallback unit" hint={unavailable}>
        <select disabled aria-label="Fallback unit"><option>Not available in V2</option></select>
      </Cell>
      <Cell label="Trim allowance — width (in)" hint={unavailable}>
        <input className="num h-8 text-[0.8125rem]" readOnly value="Not configured" aria-label="Trim allowance width" />
      </Cell>
      <Cell label="Trim allowance — height (in)" hint={unavailable}>
        <input className="num h-8 text-[0.8125rem]" readOnly value="Not configured" aria-label="Trim allowance height" />
      </Cell>
    </div>
    <p className="mt-2 text-[0.6875rem] text-muted-foreground">
      V2 currently owns material consumption through Recipe components. Product-level primary material, shipping, weight, fallback, and trim fields have no canonical read/write contract.
    </p>
  </Sub>;
}
