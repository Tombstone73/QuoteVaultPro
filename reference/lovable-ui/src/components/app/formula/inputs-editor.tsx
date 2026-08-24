import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Cell, Chip, Picker, Toggle } from "@/components/app/product-editor/fields";
import { EmptyState } from "@/components/app/primitives";
import { cn } from "@/lib/utils";
import {
  FORMULA_INPUT_TYPES, fid,
  type FormulaInput, type FormulaInputType,
} from "@/lib/mock/formulas";

/** Declared-input editor: dense rows that expand for detail. */
export function DeclaredInputsEditor({
  inputs, onChange,
}: { inputs: FormulaInput[]; onChange: (next: FormulaInput[]) => void }) {
  const patch = (id: string, fn: (i: FormulaInput) => void) => {
    const next = structuredClone(inputs);
    const target = next.find((i) => i.id === id);
    if (target) fn(target);
    onChange(next);
  };
  const move = (index: number, dir: -1 | 1) => {
    const next = structuredClone(inputs);
    const to = index + dir;
    if (to < 0 || to >= next.length) return;
    const [row] = next.splice(index, 1);
    next.splice(to, 0, row!);
    onChange(next);
  };
  const add = () =>
    onChange([
      ...structuredClone(inputs),
      { id: fid("in"), name: "new_input", label: "New input", description: "", type: "Number", required: false, defaultValue: "", min: "", max: "", unit: "" },
    ]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted-foreground">
          Inputs a Product must supply. Values live on the Product; the expression lives here.
        </p>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-[12px]" onClick={add}>
          <Plus className="size-3.5" />Add input
        </Button>
      </div>

      {inputs.length === 0 ? (
        <EmptyState title="No declared inputs" hint="Add the values a Product should configure, such as sheet width or minimum billable sq ft." />
      ) : (
        <div className="space-y-1.5">
          {inputs.map((i, index) => (
            <InputRow
              key={i.id}
              row={i}
              onPatch={(fn) => patch(i.id, fn)}
              onRemove={() => onChange(inputs.filter((x) => x.id !== i.id))}
              onUp={() => move(index, -1)}
              onDown={() => move(index, 1)}
              first={index === 0}
              last={index === inputs.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function InputRow({
  row, onPatch, onRemove, onUp, onDown, first, last,
}: {
  row: FormulaInput;
  onPatch: (fn: (i: FormulaInput) => void) => void;
  onRemove: () => void;
  onUp: () => void;
  onDown: () => void;
  first: boolean;
  last: boolean;
}) {
  return (
    <details className="group rounded-md border border-border open:bg-surface-2/40">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5">
        <GripVertical className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="num min-w-0 flex-1 truncate text-[13px] font-medium">{row.name}</span>
        <span className="hidden min-w-0 flex-1 truncate text-[12px] text-muted-foreground sm:block">{row.label}</span>
        <Chip>{row.type}</Chip>
        {row.required ? <Chip tone="accent">Required</Chip> : <Chip>Optional</Chip>}
        {row.unit && <span className="hidden text-[11px] text-muted-foreground sm:inline">{row.unit}</span>}
        <span className="flex shrink-0 items-center">
          <Button size="icon" variant="ghost" className="size-7" aria-label="Move up" disabled={first} onClick={(e) => { e.preventDefault(); onUp(); }}>
            <ChevronUp className="size-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="size-7" aria-label="Move down" disabled={last} onClick={(e) => { e.preventDefault(); onDown(); }}>
            <ChevronDown className="size-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="size-7 text-muted-foreground hover:text-late" aria-label="Remove input" onClick={(e) => { e.preventDefault(); onRemove(); }}>
            <Trash2 className="size-3.5" />
          </Button>
        </span>
      </summary>
      <div className="grid gap-3 border-t border-border p-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Cell label="Variable name" hint="Used inside the expression.">
          <Input className="num h-8 text-[13px]" value={row.name} onChange={(e) => onPatch((i) => { i.name = e.target.value.replace(/\s+/g, "_").toLowerCase(); })} />
        </Cell>
        <Cell label="Display label">
          <Input className="h-8 text-[13px]" value={row.label} onChange={(e) => onPatch((i) => { i.label = e.target.value; })} />
        </Cell>
        <Cell label="Type">
          <Picker value={row.type} items={FORMULA_INPUT_TYPES} onChange={(v: FormulaInputType) => onPatch((i) => { i.type = v; })} />
        </Cell>
        <Cell label="Unit / meaning" hint="Shown next to the Product field.">
          <Input className="h-8 text-[13px]" value={row.unit} onChange={(e) => onPatch((i) => { i.unit = e.target.value; })} />
        </Cell>
        <Cell label="Description" className="sm:col-span-2 lg:col-span-4">
          <Textarea className="min-h-[52px] text-[13px]" value={row.description} onChange={(e) => onPatch((i) => { i.description = e.target.value; })} />
        </Cell>
        <Cell label="Default value">
          {row.type === "Boolean" ? (
            <Picker value={row.defaultValue === "true" ? "Yes" : "No"} items={["Yes", "No"] as const} onChange={(v) => onPatch((i) => { i.defaultValue = v === "Yes" ? "true" : "false"; })} />
          ) : (
            <Input className="num h-8 text-[13px]" value={row.defaultValue} onChange={(e) => onPatch((i) => { i.defaultValue = e.target.value; })} />
          )}
        </Cell>
        <Cell label="Minimum">
          <Input className="num h-8 text-[13px]" disabled={row.type === "Boolean"} value={row.min} onChange={(e) => onPatch((i) => { i.min = e.target.value; })} />
        </Cell>
        <Cell label="Maximum">
          <Input className="num h-8 text-[13px]" disabled={row.type === "Boolean"} value={row.max} onChange={(e) => onPatch((i) => { i.max = e.target.value; })} />
        </Cell>
        <div className="self-end">
          <Toggle label="Required" hint="Product must supply a value." checked={row.required} onChange={(v) => onPatch((i) => { i.required = v; })} />
        </div>
      </div>
    </details>
  );
}

/**
 * Renders declared inputs as ordinary form fields — used by the tester and by
 * Product Builder for Product-specific values.
 */
export function InputValueFields({
  inputs, values, onChange, className, showMissing,
}: {
  inputs: FormulaInput[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  className?: string;
  showMissing?: boolean;
}) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {inputs.map((i) => {
        const raw = values[i.name] ?? "";
        const missing = !!showMissing && i.required && raw.trim() === "";
        return (
          <Cell
            key={i.id}
            label={`${i.label}${i.required ? " *" : ""}`}
            hint={missing ? <span className="text-late">Required by this formula.</span> : (i.description || (i.unit ? `In ${i.unit}.` : undefined))}
          >
            {i.type === "Boolean" ? (
              <Picker
                value={(raw || i.defaultValue) === "true" ? "Yes" : "No"}
                items={["Yes", "No"] as const}
                onChange={(v) => onChange(i.name, v === "Yes" ? "true" : "false")}
              />
            ) : (
              <div className="relative">
                <Input
                  className={cn("num h-8 text-[13px]", i.unit && "pr-12", missing && "border-late")}
                  value={raw}
                  placeholder={i.defaultValue ? `${i.defaultValue} (default)` : ""}
                  onChange={(e) => onChange(i.name, e.target.value)}
                />
                {i.unit && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">{i.unit}</span>}
              </div>
            )}
          </Cell>
        );
      })}
    </div>
  );
}
