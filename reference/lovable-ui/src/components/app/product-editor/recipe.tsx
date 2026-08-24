import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { materials } from "@/lib/mock/data";
import { RECIPE_BASES, allOptions, findOption, uid, type ProductDraft, type RecipeLine } from "@/lib/mock/product-editor";
import { Cell, Chip, Picker, Toggle } from "./fields";

const materialNames = materials.map((m) => m.name);
const nameOf = (id: string) => materials.find((m) => m.id === id)?.name ?? materialNames[0]!;

/** What the product physically consumes — deliberately separate from pricing. */
export function RecipeEditor({ draft, patch }: { draft: ProductDraft; patch: (fn: (d: ProductDraft) => void) => void }) {
  const options = allOptions(draft).filter(({ option }) => option.choices.length > 0);
  const condLabel = (o: { group: { name: string }; option: { label: string } }) =>
    o.group.name === o.option.label ? o.option.label : `${o.group.name} → ${o.option.label}`;

  return (
    <div className="space-y-2.5">
      <p className="text-[12px] text-muted-foreground">
        Recipe lines describe consumption, not price. A line with a condition is only consumed when that option choice is selected.
      </p>

      {draft.recipe.length === 0 && (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[12px] italic text-muted-foreground">
          No recipe — this product consumes no inventory.
        </p>
      )}

      <div className="space-y-2">
        {draft.recipe.map((line, i) => {
          const set = (fn: (l: RecipeLine) => void) => patch((d) => { fn(d.recipe[i]!); });
          const cond = line.conditionOptionId ? findOption(draft, line.conditionOptionId) : undefined;
          return (
            <div key={line.id} className="rounded-md border border-border p-2.5">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate text-[13px] font-semibold">{nameOf(line.materialId)}</span>
                  {line.replaces ? <Chip tone="accent">Replaces primary</Chip> : <Chip>Additional</Chip>}
                  {cond ? (
                    <span className="truncate text-[11px] text-muted-foreground">When {cond.option.label} = {line.conditionValue}</span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">Always</span>
                  )}
                </div>
                <Button size="icon" variant="ghost" className="size-7 shrink-0 text-muted-foreground hover:text-late" aria-label="Remove recipe line" onClick={() => patch((d) => { d.recipe.splice(i, 1); })}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>

              <div className="mt-2 grid gap-2 @container sm:grid-cols-2 lg:grid-cols-4">
                <Cell label="Material">
                  <Picker value={nameOf(line.materialId)} items={materialNames} onChange={(v) => set((l) => { l.materialId = materials.find((m) => m.name === v)!.id; })} />
                </Cell>
                <Cell label="Requirement basis">
                  <Picker value={line.basis} items={RECIPE_BASES} onChange={(v) => set((l) => { l.basis = v; })} />
                </Cell>
                <Cell label="Quantity / factor">
                  <Input className="num h-8 text-[13px]" value={line.factor} onChange={(e) => set((l) => { l.factor = e.target.value; })} />
                </Cell>
                <Cell label="Unit">
                  <Input className="h-8 text-[13px]" value={line.unit} onChange={(e) => set((l) => { l.unit = e.target.value; })} />
                </Cell>
                <Cell label="Option condition" hint="Leave as Always for unconditional consumption.">
                  <Picker
                    value={cond ? condLabel(cond) : "Always"}
                    items={["Always", ...options.map(condLabel)]}
                    onChange={(v) => set((l) => {
                      if (v === "Always") { l.conditionOptionId = undefined; l.conditionValue = undefined; return; }
                      const hit = options.find((o) => condLabel(o) === v)!;
                      l.conditionOptionId = hit.option.id;
                      l.conditionValue = hit.option.choices[0]?.label;
                    })}
                  />
                </Cell>
                {cond && (
                  <Cell label="Choice">
                    <Picker
                      value={line.conditionValue ?? cond.option.choices[0]?.label ?? ""}
                      items={cond.option.choices.map((c) => c.label)}
                      onChange={(v) => set((l) => { l.conditionValue = v; })}
                    />
                  </Cell>
                )}
                <Toggle label="Replaces primary material" checked={line.replaces} onChange={(v) => set((l) => { l.replaces = v; })} />
                <Toggle label="Normalize to inventory unit" hint="Convert computed usage into the material's stocking unit." checked={line.normalize} onChange={(v) => set((l) => { l.normalize = v; })} />
              </div>
            </div>
          );
        })}
      </div>

      <Button
        size="sm" variant="outline" className="h-7 gap-1 text-[12px]"
        onClick={() => patch((d) => { d.recipe.push({ id: uid("rc"), materialId: materials[0]!.id, basis: "Per piece", factor: "1", unit: "ea", replaces: false, normalize: true, conditionOptionId: undefined, conditionValue: undefined }); })}
      >
        <Plus className="size-3.5" />Add material requirement
      </Button>
    </div>
  );
}
