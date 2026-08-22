import React, { useMemo, useState } from "react";
import { Copy, Grid3x3 } from "lucide-react";
import type { ProductDraftPricingMatrix } from "../api";
import { Cell, Chip, ReferenceButton, Toggle } from "./referencePrimitives";

/**
 * Presentation port of reference/lovable-ui/src/components/app/product-editor/matrix-pricing.tsx.
 * V2's canonical N-dimensional matrix rows replace the mock map: row/column dimensions are rendered
 * directly and further dimensions are slice selectors.
 */
export function MatrixPricing({ matrix, disabled, onChange }: Readonly<{
  matrix: ProductDraftPricingMatrix | null;
  disabled?: boolean;
  onChange: (next: ProductDraftPricingMatrix) => void;
}>) {
  const [slice, setSlice] = useState<Record<string, string | number | boolean>>({});
  if (!matrix) return <p className="text-[0.75rem] italic text-muted-foreground">Matrix pricing is not configured for this Draft.</p>;

  const rowDim = matrix.dimensions[0];
  const colDim = matrix.dimensions[1];
  const extraDims = matrix.dimensions.slice(2);
  const sliceValues = useMemo(() => Object.fromEntries(extraDims.map((dimension) => [dimension.selectionKey, slice[dimension.selectionKey] ?? dimension.values[0]?.value ?? ""])), [extraDims, slice]);
  const activeRows = (row: string | number | boolean, column?: string | number | boolean) => matrix.rows.find((entry) => entry.combination[rowDim?.selectionKey ?? ""] === row && (!colDim || entry.combination[colDim.selectionKey] === column) && extraDims.every((dimension) => entry.combination[dimension.selectionKey] === sliceValues[dimension.selectionKey]));
  const updateRate = (rowId: string, baseRateCents: number) => onChange({ ...matrix, rows: matrix.rows.map((row) => row.rowId === rowId ? { ...row, baseRateCents } : row) });
  const missing = matrix.rows.filter((row) => !Number.isFinite(row.baseRateCents)).length;
  const editable = !disabled && matrix.editable;

  return <div className="space-y-3">
    <Toggle label="Use matrix pricing" hint="Rates come from a table driven by the product's own option groups instead of one flat rate." checked onChange={() => undefined} disabled />

    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-md border border-border p-2.5">
        <div className="flex items-center gap-2"><Grid3x3 className="size-3.5 text-primary" /><span className="text-[0.75rem] font-bold uppercase tracking-wide">Matrix dimensions</span><Chip tone="accent">Option groups</Chip></div>
        <p className="mt-1 text-[0.6875rem] text-muted-foreground">Each dimension is one option group. Its choices become rows, columns or slices.</p>
        <div className="mt-2 space-y-1.5">
          {matrix.dimensions.map((dimension, index) => <div key={dimension.selectionKey} className="flex items-center gap-2 rounded border border-border bg-surface-2 px-2 py-1.5">
            <span className="num w-14 shrink-0 text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">{index === 0 ? "Rows" : index === 1 ? "Columns" : `Slice ${index - 1}`}</span>
            <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium">{dimension.label}</span>
            <span className="num shrink-0 text-[0.6875rem] text-muted-foreground">{dimension.values.length} choices</span>
          </div>)}
          {matrix.dimensions.length === 0 && <p className="text-[0.75rem] italic text-muted-foreground">No dimensions yet — add at least one option group.</p>}
        </div>
      </div>

      <div className="rounded-md border border-border p-2.5">
        <div className="flex items-center gap-2"><span className="text-[0.75rem] font-bold uppercase tracking-wide">Tier basis</span><Chip>Not an option group</Chip></div>
        <p className="mt-1 text-[0.6875rem] text-muted-foreground">Selects which matrix values apply, based on the resolved job size.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Cell label="Rate unit"><input readOnly value={matrix.pricingUnit === "per_piece" ? "Per piece" : "Per square foot"} /></Cell>
          <Cell label="Rows"><input readOnly value={String(matrix.rows.length)} /></Cell>
        </div>
        {matrix.warnings.map((warning) => <p key={warning} className="mt-2 text-[0.6875rem] text-warn">{warning}</p>)}
      </div>
    </div>

    {rowDim && <div className="rounded-md border border-border">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border px-2.5 py-2 sm:flex sm:flex-wrap sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2"><span className="text-[0.75rem] font-bold uppercase tracking-wide">Rates</span><Chip tone="accent">{matrix.pricingUnit === "per_piece" ? "Per piece" : "Per square foot"}</Chip>{missing > 0 && <Chip tone="warn">{missing} empty</Chip>}</div>
        <div className="flex shrink-0 items-center gap-2">
          {extraDims.map((dimension) => <label key={dimension.selectionKey} className="flex items-center gap-1.5"><span className="text-[0.6875rem] text-muted-foreground">{dimension.label}</span><select className="h-8 w-[150px] text-[0.8125rem]" value={String(sliceValues[dimension.selectionKey])} onChange={(event) => setSlice((current) => ({ ...current, [dimension.selectionKey]: event.target.value }))}>{dimension.values.map((value) => <option key={String(value.value)} value={String(value.value)}>{value.label}</option>)}</select></label>)}
          {matrix.rows.some((row) => row.tiers.length > 1) && <ReferenceButton variant="outline" size="sm" className="h-7 gap-1" disabled><Copy className="size-3.5" />Copy previous tier</ReferenceButton>}
        </div>
      </div>
      <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[420px] border-collapse text-[0.8125rem]"><thead><tr><th className="sticky left-0 z-20 border-b border-r border-border bg-surface-2 px-2.5 py-1.5 text-left text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">{rowDim.label}</th>{(colDim ? colDim.values : [{ value: "single", label: "Rate" }]).map((choice) => <th key={String(choice.value)} className="border-b border-border bg-surface-2 px-2.5 py-1.5 text-left text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">{choice.label}</th>)}</tr></thead><tbody>{rowDim.values.map((rowChoice) => <tr key={String(rowChoice.value)}><th className="sticky left-0 z-10 border-b border-r border-border bg-background px-2.5 py-1 text-left text-[0.75rem] font-medium">{rowChoice.label}</th>{(colDim ? colDim.values : [{ value: undefined, label: "" }]).map((columnChoice) => { const row = activeRows(rowChoice.value, columnChoice.value); return <td key={String(columnChoice.value)} className="border-b border-border px-1.5 py-1"><MoneyRate disabled={!editable || !row || row.tierBasis === "computed_sheet_usage"} value={row?.baseRateCents ?? null} onChange={(value) => row && updateRate(row.rowId, value ?? 0)} /></td>; })}</tr>)}</tbody></table></div>
      <p className="border-t border-border px-2.5 py-1.5 text-[0.6875rem] text-muted-foreground">Each cell is the rate charged {matrix.pricingUnit === "per_piece" ? "per piece" : "per square foot"} for that combination. N-dimensional rows remain canonical in V2.</p>
    </div>}
    {!matrix.editable && <p className="text-[0.6875rem] text-muted-foreground">{matrix.unavailableReason ?? "Matrix pricing is read-only for this Draft."}</p>}
  </div>;
}

function MoneyRate({ value, onChange, disabled }: Readonly<{ value: number | null; onChange: (value: number | null) => void; disabled?: boolean }>) {
  return <div className="relative"><span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[0.75rem] text-muted-foreground">$</span><input aria-label="Matrix rate" className="num h-7 w-[92px] pl-5 text-[0.8125rem]" placeholder="—" disabled={disabled} inputMode="decimal" value={value == null ? "" : (value / 100).toFixed(2)} onChange={(event) => onChange(event.target.value === "" ? null : Math.round(Number(event.target.value) * 100))} /></div>;
}
