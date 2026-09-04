import React, { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Grid3x3, Plus, Trash2 } from "lucide-react";
import type {
  ProductDraftPricingMatrix,
  ProductDraftPricingTier,
} from "../api";
import { Cell, Chip, ReferenceButton, Toggle } from "./referencePrimitives";
import { ProductBuilderMoneyInput as MoneyRate } from "./money-input";
import { canMoveProductBuilderItem, moveProductBuilderItem } from "./ordering";

type Value = string | number | boolean;
type Dimension = ProductDraftPricingMatrix["dimensions"][number];

const same = (left: readonly Value[], right: readonly Value[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

/** Generates local authoring rows only. Pricing and Matrix matching remain server-owned. */
export const completeMatrixRows = (
  dimensions: readonly Dimension[],
  existing: ProductDraftPricingMatrix["rows"],
): ProductDraftPricingMatrix["rows"] => {
  const combinations: Record<string, Value>[] = [];
  const build = (index: number, combination: Record<string, Value>): void => {
    if (index === dimensions.length) {
      combinations.push(combination);
      return;
    }
    const dimension = dimensions[index]!;
    for (const choice of dimension.values)
      build(index + 1, {
        ...combination,
        [dimension.selectionKey]: choice.value,
      });
  };
  if (dimensions.length) build(0, {});
  return combinations.map((combination) => {
    const found = existing.find((row) =>
      same(
        dimensions.map((dimension) => row.combination[dimension.selectionKey]),
        dimensions.map((dimension) => combination[dimension.selectionKey]),
      ),
    );
    return (
      found ?? {
        rowId: `new:${crypto.randomUUID()}`,
        combination,
        baseRateCents: null,
        tierBasis: null,
        tiers: [],
      }
    );
  });
};

export const updateMatrixPricingRow = (
  matrix: ProductDraftPricingMatrix,
  rowId: string,
  change: Partial<ProductDraftPricingMatrix["rows"][number]>,
): ProductDraftPricingMatrix => ({
  ...matrix,
  rows: matrix.rows.map((row) => row.rowId === rowId ? { ...row, ...change } : row),
});

export const updateMatrixPricingTier = (
  matrix: ProductDraftPricingMatrix,
  rowId: string,
  tierIndex: number,
  change: Partial<ProductDraftPricingTier>,
): ProductDraftPricingMatrix => {
  const row = matrix.rows.find((entry) => entry.rowId === rowId);
  if (!row) return matrix;
  return updateMatrixPricingRow(matrix, rowId, {
    tiers: row.tiers.map((tier, index) => index === tierIndex ? { ...tier, ...change } : tier),
  });
};

export function MatrixPricing({
  matrix,
  disabled,
  onChange,
}: Readonly<{
  matrix: ProductDraftPricingMatrix;
  disabled?: boolean;
  onChange: (next: ProductDraftPricingMatrix) => void;
}>) {
  const [slice, setSlice] = useState<Record<string, Value>>({});
  // Input events can arrive before React commits an intervening parent render.
  // Keep every local matrix edit composed from the latest staged snapshot so a
  // later tier edit cannot restore an earlier tier's stale value.
  const matrixRef = useRef(matrix);
  matrixRef.current = matrix;
  const editable = !disabled && matrix.editable;
  const dimensions = matrix.dimensions;
  const rowDim = dimensions[0],
    colDim = dimensions[1],
    extraDims = dimensions.slice(2);
  const sliceValues = useMemo(
    () =>
      Object.fromEntries(
        extraDims.map((dimension) => [
          dimension.selectionKey,
          slice[dimension.selectionKey] ?? dimension.values[0]?.value ?? "",
        ]),
      ) as Record<string, Value>,
    [extraDims, slice],
  );
  const staged = (change: Partial<ProductDraftPricingMatrix>) => {
    const next = { ...matrixRef.current, ...change };
    matrixRef.current = next;
    onChange(next);
  };
  const setDimensions = (selectionKeys: readonly string[]) => {
    const current = matrixRef.current;
    const available = new Map(current.availableDimensions.map((dimension) => [dimension.selectionKey, dimension]));
    const next = selectionKeys.flatMap((selectionKey) => {
      const dimension = available.get(selectionKey);
      return dimension ? [dimension] : [];
    });
    staged({
      active: true,
      dimensions: next,
      rows: completeMatrixRows(next, current.rows),
    });
  };
  const moveDimension = (index: number, direction: -1 | 1) => {
    const next = moveProductBuilderItem(matrixRef.current.dimensions, index, index + direction);
    setDimensions(next.map((dimension) => dimension.selectionKey));
  };
  const updateRow = (
    rowId: string,
    change: Partial<ProductDraftPricingMatrix["rows"][number]>,
  ) =>
    staged(updateMatrixPricingRow(matrixRef.current, rowId, change));
  const updateTier = (
    rowId: string,
    tierIndex: number,
    change: Partial<ProductDraftPricingTier>,
  ) => staged(updateMatrixPricingTier(matrixRef.current, rowId, tierIndex, change));
  const removeTier = (rowId: string, tierIndex: number) => {
    const row = matrixRef.current.rows.find((entry) => entry.rowId === rowId);
    if (!row) return;
    updateRow(rowId, {
      tiers: row.tiers.filter((_, index) => index !== tierIndex),
      tierBasis: row.tiers.length === 1 ? null : row.tierBasis,
    });
  };
  const activeRow = (row: Value, column?: Value) =>
    matrix.rows.find(
      (entry) =>
        entry.combination[rowDim?.selectionKey ?? ""] === row &&
        (!colDim || entry.combination[colDim.selectionKey] === column) &&
        extraDims.every(
          (dimension) =>
            entry.combination[dimension.selectionKey] ===
            sliceValues[dimension.selectionKey],
        ),
    );
  const missing = matrix.rows.filter(
    (row) => row.baseRateCents === null,
  ).length;
  const addTier = (row: ProductDraftPricingMatrix["rows"][number]) =>
    updateRow(row.rowId, {
      tiers: [
        ...row.tiers,
        {
          tierId: `new:${crypto.randomUUID()}`,
          minimum: Math.max(1, (row.tiers.at(-1)?.maximum ?? 0) + 1),
          maximum: null,
          perPieceCents:
            matrix.pricingUnit === "per_piece" ? row.baseRateCents : null,
          perSqftCents:
            matrix.pricingUnit === "per_square_foot" ? row.baseRateCents : null,
          minimumChargeCents: null,
        },
      ],
      tierBasis: row.tierBasis ?? "quantity",
    });

  return (
    <div className="space-y-3">
      <Toggle
        label="Use matrix pricing"
        hint="Rates come from a complete table driven by selected Product Options."
        checked={matrix.active}
        onChange={(active) =>
          staged({
            active,
            dimensions: active ? dimensions : [],
            rows: active ? matrix.rows : [],
          })
        }
        disabled={!editable}
      />
      {matrix.active && (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-md border border-border p-2.5">
              <div className="flex items-center gap-2">
                <Grid3x3 className="size-3.5 text-primary" />
                <span className="text-[0.75rem] font-bold uppercase tracking-wide">
                  Matrix dimensions
                </span>
                <Chip tone="accent">Option groups</Chip>
              </div>
              <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                Every choice combination must have a rate before the Draft can
                be saved.
              </p>
              <div className="mt-2 space-y-1.5">
                {matrix.availableDimensions.map((dimension) => (
                  <label
                    key={dimension.selectionKey}
                    className="flex items-center gap-2 rounded border border-border bg-surface-2 px-2 py-1.5"
                  >
                    <input
                      type="checkbox"
                      disabled={!editable}
                      checked={dimensions.some(
                        (selected) =>
                          selected.selectionKey === dimension.selectionKey,
                      )}
                      onChange={(event) =>
                        setDimensions(
                          event.target.checked
                            ? [
                                ...dimensions.map(
                                  (selected) => selected.selectionKey,
                                ),
                                dimension.selectionKey,
                              ]
                            : dimensions
                                .filter(
                                  (selected) =>
                                    selected.selectionKey !==
                                    dimension.selectionKey,
                                )
                                .map((selected) => selected.selectionKey),
                        )
                      }
                    />
                    <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium">
                      {dimension.label}
                    </span>
                    <span className="num text-[0.6875rem] text-muted-foreground">
                      {dimension.values.length} choices
                    </span>
                  </label>
                ))}
              </div>
              {dimensions.length > 1 && <div className="mt-3 border-t border-border pt-2">
                <p className="text-[0.6875rem] text-muted-foreground">Display the first selected dimension as rows, the second as columns, then use the remaining dimensions as slices.</p>
                <ol className="mt-1.5 space-y-1">
                  {dimensions.map((dimension, index) => <li key={dimension.selectionKey} className="flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1">
                    <span className="num w-4 text-[0.6875rem] text-muted-foreground">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[0.75rem] font-medium">{dimension.label}</span>
                    <ReferenceButton variant="ghost" size="compactIcon" aria-label={`Move ${dimension.label} dimension up`} title="Move matrix dimension up" disabled={!editable || !canMoveProductBuilderItem(dimensions, index, -1)} onClick={() => moveDimension(index, -1)}><ArrowUp className="size-3" /></ReferenceButton>
                    <ReferenceButton variant="ghost" size="compactIcon" aria-label={`Move ${dimension.label} dimension down`} title="Move matrix dimension down" disabled={!editable || !canMoveProductBuilderItem(dimensions, index, 1)} onClick={() => moveDimension(index, 1)}><ArrowDown className="size-3" /></ReferenceButton>
                  </li>)}
                </ol>
              </div>}
            </div>
            <div className="rounded-md border border-border p-2.5">
              <div className="text-[0.75rem] font-bold uppercase tracking-wide">
                Matrix behavior
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Cell label="Rate unit">
                  <select
                    disabled={!editable}
                    value={matrix.pricingUnit}
                    onChange={(event) =>
                      staged({
                        pricingUnit: event.target
                          .value as ProductDraftPricingMatrix["pricingUnit"],
                      })
                    }
                  >
                    <option value="per_square_foot">Per square foot</option>
                    <option value="per_piece">Per piece</option>
                  </select>
                </Cell>
                <Cell label="Complete rows">
                  <input
                    readOnly
                    value={`${matrix.rows.length} / ${dimensions.reduce((total, dimension) => total * dimension.values.length, 1)}`}
                  />
                </Cell>
              </div>
              {matrix.warnings.map((warning) => (
                <p key={warning} className="mt-2 text-[0.6875rem] text-warn">
                  {warning}
                </p>
              ))}
            </div>
          </div>
          {!dimensions.length ? (
            <p className="text-[0.75rem] italic text-muted-foreground">
              Select one or more choice-based Options to define the Matrix.
            </p>
          ) : (
            <div className="rounded-md border border-border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-[0.75rem] font-bold uppercase tracking-wide">
                    Rates
                  </span>
                  {missing > 0 && (
                    <Chip tone="warn">{missing} rates required</Chip>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {extraDims.map((dimension) => (
                    <label
                      key={dimension.selectionKey}
                      className="flex items-center gap-1"
                    >
                      <span className="text-[0.6875rem] text-muted-foreground">
                        {dimension.label}
                      </span>
                      <select
                        value={String(sliceValues[dimension.selectionKey])}
                        onChange={(event) =>
                          setSlice((value) => ({
                            ...value,
                            [dimension.selectionKey]: dimension.values.find(
                              (choice) => String(choice.value) === event.target.value,
                            )?.value ?? event.target.value,
                          }))
                        }
                      >
                        {dimension.values.map((choice) => (
                          <option
                            key={String(choice.value)}
                            value={String(choice.value)}
                          >
                            {choice.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[460px] text-[0.8125rem]">
                  <thead>
                    <tr>
                      <th className="px-2 py-1 text-left">{rowDim!.label}</th>
                      {(colDim
                        ? colDim.values
                        : [{ value: "single", label: "Rate" }]
                      ).map((choice) => (
                        <th
                          key={String(choice.value)}
                          className="px-2 py-1 text-left"
                        >
                          {choice.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rowDim!.values.map((rowChoice) => (
                      <tr key={String(rowChoice.value)}>
                        <th className="px-2 py-1 text-left">
                          {rowChoice.label}
                        </th>
                        {(colDim
                          ? colDim.values
                          : [{ value: undefined, label: "" }]
                        ).map((columnChoice) => {
                          const row = activeRow(
                            rowChoice.value,
                            columnChoice.value,
                          );
                          return (
                            <td
                              key={String(columnChoice.value)}
                              className="p-1"
                            >
                              <div className="flex gap-1">
                                 <MoneyRate
                                   disabled={!editable || !row}
                                   value={row?.baseRateCents ?? null}
                                   ariaLabel="Matrix rate"
                                   className="h-7 w-[88px]"
                                   placeholder="—"
                                  onChange={(baseRateCents) =>
                                    row &&
                                    updateRow(row.rowId, { baseRateCents })
                                  }
                                />
                                {row && (
                                  <ReferenceButton
                                    variant="ghost"
                                    size="icon"
                                    aria-label="Add matrix tier"
                                    disabled={!editable}
                                    onClick={() => addTier(row)}
                                  >
                                    <Plus className="size-3.5" />
                                  </ReferenceButton>
                                )}
                              </div>
                              {row?.tiers.map((tier, index) => (
                                <TierRow
                                  key={tier.tierId}
                                  tier={tier}
                                  computed={
                                    row.tierBasis === "computed_sheet_usage"
                                  }
                                  pricingUnit={matrix.pricingUnit}
                                  disabled={!editable}
                                  onChange={(change) =>
                                    updateTier(row.rowId, index, change)
                                  }
                                  onComputed={(computed) =>
                                    updateRow(row.rowId, {
                                      tierBasis: computed
                                        ? "computed_sheet_usage"
                                        : "quantity",
                                    })
                                  }
                                  onRemove={() => removeTier(row.rowId, index)}
                                />
                              ))}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TierRow({
  tier,
  computed,
  pricingUnit,
  disabled,
  onChange,
  onComputed,
  onRemove,
}: Readonly<{
  tier: ProductDraftPricingTier;
  computed: boolean;
  pricingUnit: ProductDraftPricingMatrix["pricingUnit"];
  disabled: boolean;
  onChange: (change: Partial<ProductDraftPricingTier>) => void;
  onComputed: (computed: boolean) => void;
  onRemove: () => void;
}>) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 text-[0.6875rem]">
      <select
        disabled={disabled}
        value={computed ? "computed" : "quantity"}
        onChange={(event) => onComputed(event.target.value === "computed")}
      >
        <option value="quantity">Qty</option>
        <option value="computed">Sheets</option>
      </select>
      <input
        aria-label="Matrix tier minimum"
        className="w-12"
        type="number"
        min="1"
        disabled={disabled}
        value={tier.minimum}
        onChange={(event) => onChange({ minimum: Number(event.target.value) })}
      />
      <input
        aria-label="Matrix tier maximum"
        className="w-12"
        type="number"
        min={tier.minimum}
        placeholder="∞"
        disabled={disabled}
        value={tier.maximum ?? ""}
        onChange={(event) => onChange({ maximum: event.target.value === "" ? null : Number(event.target.value) })}
      />
      <MoneyRate
        disabled={disabled}
        value={tier.perPieceCents ?? tier.perSqftCents}
        ariaLabel="Matrix tier rate"
        className="h-7 w-[88px]"
        onChange={(value) =>
          onChange(
            pricingUnit === "per_square_foot"
              ? { perPieceCents: null, perSqftCents: value }
              : { perPieceCents: value, perSqftCents: null },
          )
        }
      />
      <MoneyRate
        disabled={disabled}
        value={tier.minimumChargeCents}
        ariaLabel="Matrix tier minimum charge"
        className="h-7 w-[88px]"
        placeholder="Min $"
        onChange={(minimumChargeCents) => onChange({ minimumChargeCents })}
      />
      <ReferenceButton
        variant="ghost"
        size="icon"
        aria-label="Remove matrix tier"
        disabled={disabled}
        onClick={onRemove}
      >
        <Trash2 className="size-3" />
      </ReferenceButton>
    </div>
  );
}
