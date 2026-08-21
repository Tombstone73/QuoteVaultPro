import { Plus, Trash2 } from "lucide-react";
import React from "react";
import type { ProductDraftOption, ProductMaterial, ProductRecipeComponent } from "../api";
import { Cell, Chip, Picker, Toggle } from "./referencePrimitives";

/**
 * Direct presentation port of reference/lovable-ui/.../product-editor/recipe.tsx.
 *
 * The only semantic adjustments are the approved V2 contract differences:
 * Material and condition values retain their canonical IDs, Material-owned
 * normalization is automatic (therefore no local toggle), and the replacement
 * label is the precise PBV2 compatibility meaning.
 */
export function RecipeEditor({
  components,
  materials,
  options,
  disabled,
  onChange,
}: Readonly<{
  components: readonly ProductRecipeComponent[];
  materials: readonly ProductMaterial[];
  options: readonly ProductDraftOption[];
  disabled?: boolean;
  onChange: (components: readonly ProductRecipeComponent[]) => void;
}>) {
  const selectableOptions = options.filter((option) => option.choices.length > 0);
  const materialFor = (materialId: string) => materials.find((material) => material.materialId === materialId);
  const optionFor = (optionId: string) => selectableOptions.find((option) => option.optionId === optionId);
  const optionLabel = (option: ProductDraftOption) => option.label;
  const update = (index: number, patch: (component: ProductRecipeComponent) => ProductRecipeComponent) =>
    onChange(components.map((component, position) => position === index ? patch(component) : component));

  return <div className="space-y-2.5">
    <p className="text-[12px] text-muted-foreground">
      Recipe lines describe consumption, not price. A line with a condition is only consumed when
      that option choice is selected.
    </p>

    {components.length === 0 && <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[12px] italic text-muted-foreground">
      No recipe — this Product consumes no inventory.
    </p>}

    <div className="space-y-2">
      {components.map((line, index) => {
        const material = materialFor(line.materialId);
        const conditionOption = line.condition ? optionFor(line.condition.optionId) : undefined;
        return <div key={line.componentId ?? `${line.materialId}-${index}`} className="rounded-md border border-border p-2.5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate text-[13px] font-semibold">{material?.name ?? line.materialName ?? "Material component"}</span>
              {line.replacesPbv2Compatibility ? <Chip tone="accent">Replaces compatibility requirement</Chip> : <Chip>Additional</Chip>}
              {conditionOption ? <span className="truncate text-[11px] text-muted-foreground">When {conditionOption.label} = {line.condition?.choiceValue}</span> : <span className="text-[11px] text-muted-foreground">Always</span>}
            </div>
            <button type="button" className="size-7 shrink-0 text-muted-foreground hover:text-late" aria-label="Remove recipe line" disabled={disabled} onClick={() => onChange(components.filter((_, position) => position !== index))}>
              <Trash2 className="size-3.5" />
            </button>
          </div>

          <div className="mt-2 grid gap-2 @container sm:grid-cols-2 lg:grid-cols-4">
            <Cell label="Material">
              <select value={line.materialId} disabled={disabled} onChange={(event) => {
                const selected = materialFor(event.target.value);
                update(index, (current) => ({ ...current, materialId: event.target.value, materialName: selected?.name, materialSku: selected?.sku }));
              }}>
                <option value="">Select material</option>
                {materials.map((item) => <option key={item.materialId} value={item.materialId}>{item.name}</option>)}
              </select>
            </Cell>
            <Cell label="Requirement basis">
              <Picker value={line.quantityKind} disabled={disabled} items={["per_line", "per_piece", "per_area"] as const} onChange={(quantityKind) => update(index, (current) => ({ ...current, quantityKind }))} />
            </Cell>
            <Cell label="Quantity / factor">
              <input className="num h-8 text-[13px]" disabled={disabled} inputMode="decimal" value={line.quantity} onChange={(event) => update(index, (current) => ({ ...current, quantity: event.target.value }))} />
            </Cell>
            <Cell label="Unit">
              <Picker value={line.unit} disabled={disabled} items={["each", "square_foot", "linear_foot", "sheet", "roll"] as const} onChange={(unit) => update(index, (current) => ({ ...current, unit }))} />
            </Cell>
            <Cell label="Option condition" hint="Leave as Always for unconditional consumption.">
              <select value={line.condition?.optionId ?? ""} disabled={disabled} onChange={(event) => {
                const selected = optionFor(event.target.value);
                update(index, (current) => ({ ...current, condition: selected ? { type: "selected", optionId: selected.optionId, choiceValue: selected.choices[0]?.choiceValue ?? "" } : undefined }));
              }}>
                <option value="">Always</option>
                {selectableOptions.map((option) => <option key={option.optionId} value={option.optionId}>{optionLabel(option)}</option>)}
              </select>
            </Cell>
            {conditionOption && <Cell label="Choice">
              <select value={line.condition?.choiceValue ?? ""} disabled={disabled} onChange={(event) => update(index, (current) => current.condition ? { ...current, condition: { ...current.condition, choiceValue: event.target.value } } : current)}>
                {conditionOption.choices.map((choice) => <option key={choice.choiceValue} value={choice.choiceValue}>{choice.label}</option>)}
              </select>
            </Cell>}
            <Toggle label="Replace matching legacy PBV2 compatibility requirement" checked={Boolean(line.replacesPbv2Compatibility)} disabled={disabled} onChange={(replacesPbv2Compatibility) => update(index, (current) => ({ ...current, replacesPbv2Compatibility }))} />
          </div>
        </div>;
      })}
    </div>

    <button type="button" className="button secondary h-7 gap-1 text-[12px]" disabled={disabled || materials.length === 0} onClick={() => {
      const material = materials[0];
      if (!material) return;
      onChange([...components, { materialId: material.materialId, materialName: material.name, materialSku: material.sku, quantity: "1", unit: material.unit, quantityKind: "per_piece" }]);
    }}><Plus className="size-3.5" />Add material requirement</button>
  </div>;
}
