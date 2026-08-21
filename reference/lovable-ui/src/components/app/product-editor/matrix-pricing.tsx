import { useMemo, useState } from "react";
import { Copy, Grid3x3, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  MATRIX_TIER_BASES,
  MATRIX_UNITS,
  allOptions,
  countMissingMatrixCells,
  matrixDimensions,
  matrixKey,
  uid,
  type MatrixTier,
  type ProductDraft,
} from "@/lib/mock/product-editor";
import { Cell, Chip, Picker, Toggle } from "./fields";

/**
 * Multi-option matrix pricing.
 * Dimension 1 = rows, dimension 2 = columns, any further dimensions become
 * slice selectors so the operator edits one readable 2D table at a time.
 */
export function MatrixPricing({
  draft,
  patch,
}: {
  draft: ProductDraft;
  patch: (fn: (d: ProductDraft) => void) => void;
}) {
  const m = draft.matrix;
  const dims = matrixDimensions(draft);
  const [tierId, setTierId] = useState(() => m.tiers[0]?.id ?? "");
  const [slice, setSlice] = useState<Record<string, string>>({});

  const candidates = allOptions(draft).filter(
    ({ option }) => option.choices.length > 0 && !m.dimensionOptionIds.includes(option.id),
  );

  const activeTier = m.tiers.find((t) => t.id === tierId) ?? m.tiers[0];
  const rowDim = dims[0];
  const colDim = dims[1];
  const extraDims = dims.slice(2);
  const missing = countMissingMatrixCells(draft);

  const sliceValues = useMemo(
    () => extraDims.map(({ option }) => slice[option.id] ?? option.choices[0]?.label ?? ""),
    [extraDims, slice],
  );

  const cellKey = (rowLabel: string, colLabel?: string) =>
    matrixKey(activeTier?.id ?? "t0", [rowLabel, ...(colLabel ? [colLabel] : []), ...sliceValues]);

  const setCell = (key: string, value: string) =>
    patch((d) => {
      d.matrix.cells[key] = value;
    });

  const copyPreviousTier = () => {
    const idx = m.tiers.findIndex((t) => t.id === activeTier?.id);
    const prev = m.tiers[idx - 1];
    if (!prev || !activeTier) return;
    patch((d) => {
      for (const [k, v] of Object.entries(d.matrix.cells)) {
        if (k.startsWith(`${prev.id}|`))
          d.matrix.cells[`${activeTier.id}|${k.slice(prev.id.length + 1)}`] = v;
      }
    });
  };

  return (
    <div className="space-y-3">
      <Toggle
        label="Use matrix pricing"
        hint="Rates come from a table driven by the product's own option groups instead of one flat rate."
        checked={m.enabled}
        onChange={(v) =>
          patch((d) => {
            d.matrix.enabled = v;
          })
        }
      />

      {m.enabled && (
        <>
          {/* dimensions vs tier basis — deliberately separated */}
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-md border border-border p-2.5">
              <div className="flex items-center gap-2">
                <Grid3x3 className="size-3.5 text-primary" />
                <span className="text-[12px] font-bold uppercase tracking-wide">
                  Matrix dimensions
                </span>
                <Chip tone="accent">Option groups</Chip>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Each dimension is one option group. Its choices become rows, columns or slices.
              </p>
              <div className="mt-2 space-y-1.5">
                {dims.map(({ group, option }, i) => (
                  <div
                    key={option.id}
                    className="flex items-center gap-2 rounded border border-border bg-surface-2 px-2 py-1.5"
                  >
                    <span className="num w-14 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {i === 0 ? "Rows" : i === 1 ? "Columns" : `Slice ${i - 1}`}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                      {group.name === option.label
                        ? option.label
                        : `${group.name} → ${option.label}`}
                    </span>
                    <span className="num shrink-0 text-[11px] text-muted-foreground">
                      {option.choices.length} choices
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6 text-muted-foreground hover:text-late"
                      aria-label={`Remove ${option.label} dimension`}
                      onClick={() =>
                        patch((d) => {
                          d.matrix.dimensionOptionIds = d.matrix.dimensionOptionIds.filter(
                            (x) => x !== option.id,
                          );
                        })
                      }
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ))}
                {dims.length === 0 && (
                  <p className="text-[12px] italic text-muted-foreground">
                    No dimensions yet — add at least one option group.
                  </p>
                )}
                {candidates.length > 0 && (
                  <div className="flex items-center gap-2 pt-0.5">
                    <Picker
                      className="flex-1"
                      value=""
                      items={[
                        "+ Add dimension",
                        ...candidates.map(({ group, option }) =>
                          group.name === option.label
                            ? option.label
                            : `${group.name} → ${option.label}`,
                        ),
                      ]}
                      onChange={(v) => {
                        const hit = candidates.find(
                          ({ group, option }) =>
                            (group.name === option.label
                              ? option.label
                              : `${group.name} → ${option.label}`) === v,
                        );
                        if (hit)
                          patch((d) => {
                            d.matrix.dimensionOptionIds.push(hit.option.id);
                          });
                      }}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-md border border-border p-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-bold uppercase tracking-wide">Tier basis</span>
                <Chip>Not an option group</Chip>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Selects which matrix values apply, based on the resolved job size.
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Cell label="Basis">
                  <Picker
                    value={m.tierBasis}
                    items={MATRIX_TIER_BASES}
                    onChange={(v) =>
                      patch((d) => {
                        d.matrix.tierBasis = v;
                      })
                    }
                  />
                </Cell>
                <Cell label="Rate unit">
                  <Picker
                    value={m.unit}
                    items={MATRIX_UNITS}
                    onChange={(v) =>
                      patch((d) => {
                        d.matrix.unit = v;
                      })
                    }
                  />
                </Cell>
              </div>
              {m.tierBasis !== "None" && (
                <div className="mt-2 space-y-1.5">
                  {m.tiers.map((t, i) => (
                    <TierRow
                      key={t.id}
                      tier={t}
                      active={t.id === activeTier?.id}
                      onSelect={() => setTierId(t.id)}
                      onChange={(fn) =>
                        patch((d) => {
                          fn(d.matrix.tiers[i]!);
                        })
                      }
                      onRemove={() =>
                        patch((d) => {
                          d.matrix.tiers.splice(i, 1);
                        })
                      }
                    />
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-[12px]"
                    onClick={() =>
                      patch((d) => {
                        d.matrix.tiers.push({
                          id: uid("mt"),
                          label: "New tier",
                          from: "1",
                          to: "",
                        });
                      })
                    }
                  >
                    <Plus className="size-3.5" />
                    Add tier
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* matrix table */}
          {rowDim && (
            <div className="rounded-md border border-border">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border px-2.5 py-2 sm:flex sm:flex-wrap sm:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-[12px] font-bold uppercase tracking-wide">Rates</span>
                  {activeTier && <Chip tone="accent">{activeTier.label}</Chip>}
                  <span className="text-[11px] text-muted-foreground">{m.unit}</span>
                  {missing > 0 && <Chip tone="warn">{missing} empty</Chip>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {extraDims.map(({ group, option }) => (
                    <div key={option.id} className="flex items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground">
                        {group.name === option.label ? option.label : group.name}
                      </span>
                      <Picker
                        className="w-[150px]"
                        value={slice[option.id] ?? option.choices[0]?.label ?? ""}
                        items={option.choices.map((c) => c.label)}
                        onChange={(v) => setSlice((s) => ({ ...s, [option.id]: v }))}
                      />
                    </div>
                  ))}
                  {m.tiers.length > 1 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-[12px]"
                      onClick={copyPreviousTier}
                    >
                      <Copy className="size-3.5" />
                      Copy previous tier
                    </Button>
                  )}
                </div>
              </div>

              <div className="max-w-full overflow-x-auto">
                <table className="w-full min-w-[420px] border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-20 border-b border-r border-border bg-surface-2 px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {rowDim.option.label}
                      </th>
                      {(colDim ? colDim.option.choices : [{ id: "single", label: "Rate" }]).map(
                        (c) => (
                          <th
                            key={c.id}
                            className="border-b border-border bg-surface-2 px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                          >
                            {c.label}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rowDim.option.choices.map((r) => (
                      <tr key={r.id}>
                        <th className="sticky left-0 z-10 border-b border-r border-border bg-background px-2.5 py-1 text-left text-[12px] font-medium">
                          {r.label}
                        </th>
                        {(colDim ? colDim.option.choices : [{ id: "single", label: "" }]).map(
                          (c) => {
                            const key = cellKey(r.label, colDim ? c.label : undefined);
                            const value = m.cells[key] ?? "";
                            return (
                              <td key={c.id} className="border-b border-border px-1.5 py-1">
                                <Input
                                  aria-label={`Rate for ${r.label}${colDim ? ` × ${c.label}` : ""}`}
                                  className={cn(
                                    "num h-7 w-[92px] text-[13px]",
                                    !value && "border-warn/60",
                                  )}
                                  placeholder="—"
                                  value={value}
                                  onChange={(e) => setCell(key, e.target.value)}
                                />
                              </td>
                            );
                          },
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-border px-2.5 py-1.5 text-[11px] text-muted-foreground">
                Each cell is the rate charged {m.unit} for that combination in the selected tier.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TierRow({
  tier,
  active,
  onSelect,
  onChange,
  onRemove,
}: {
  tier: MatrixTier;
  active: boolean;
  onSelect: () => void;
  onChange: (fn: (t: MatrixTier) => void) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded border px-1.5 py-1",
        active ? "border-primary/60 bg-primary/5" : "border-border",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        className="shrink-0 rounded px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        {active ? "Editing" : "Edit"}
      </button>
      <Input
        className="h-7 min-w-0 flex-1 text-[12px]"
        value={tier.label}
        onChange={(e) =>
          onChange((t) => {
            t.label = e.target.value;
          })
        }
      />
      <Input
        className="num h-7 w-14 text-[12px]"
        value={tier.from}
        onChange={(e) =>
          onChange((t) => {
            t.from = e.target.value;
          })
        }
      />
      <Input
        className="num h-7 w-14 text-[12px]"
        placeholder="∞"
        value={tier.to}
        onChange={(e) =>
          onChange((t) => {
            t.to = e.target.value;
          })
        }
      />
      <Button
        size="icon"
        variant="ghost"
        className="size-6 text-muted-foreground hover:text-late"
        aria-label={`Remove ${tier.label}`}
        onClick={onRemove}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

/** Read-only digest of option-driven pricing impacts that are not matrix dimensions. */
export function OptionImpacts({ draft }: { draft: ProductDraft }) {
  const dimIds = new Set(draft.matrix.enabled ? draft.matrix.dimensionOptionIds : []);
  const rows = allOptions(draft)
    .filter(({ option }) => !dimIds.has(option.id))
    .flatMap(({ option }) =>
      option.choices.flatMap((c) =>
        c.impacts.map((im) => ({ option: option.label, choice: c.label, im })),
      ),
    );

  if (rows.length === 0) {
    return (
      <p className="text-[12px] italic text-muted-foreground">
        No option pricing impacts — options change production only.
      </p>
    );
  }
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full min-w-[380px] text-[13px]">
        <thead>
          <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="py-1.5 pr-3 text-left">Option</th>
            <th className="py-1.5 pr-3 text-left">Choice</th>
            <th className="py-1.5 text-right">Pricing effect</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0">
              <td className="py-1 pr-3">{r.option}</td>
              <td className="py-1 pr-3 text-muted-foreground">{r.choice}</td>
              <td className="num py-1 text-right">
                {r.im.kind === "Percent of line"
                  ? `+${r.im.amount}% of line`
                  : `+$${r.im.amount.toFixed(2)} ${r.im.kind.toLowerCase()}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
