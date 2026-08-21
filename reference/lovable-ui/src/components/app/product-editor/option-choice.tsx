import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { materials } from "@/lib/mock/data";
import {
  IMPACT_KINDS,
  PRICING_OVERRIDES,
  QUANTITY_BASES,
  uid,
  type Choice,
  type ImpactKind,
} from "@/lib/mock/product-editor";
import { Cell, Chip, Picker } from "./fields";

const materialNames = materials.map((m) => m.name);

export function ChoiceEditor({
  choice,
  onChange,
  onRemove,
}: {
  choice: Choice;
  onChange: (fn: (c: Choice) => void) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const mat = materials.find((m) => m.name === choice.materialOverride);

  return (
    <div className="rounded-md border border-border bg-surface-2/50">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="text-muted-foreground hover:text-foreground"
          aria-label={open ? "Collapse choice" : "Expand choice"}
        >
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <Input
          className="h-7 max-w-[220px] border-transparent bg-transparent text-[13px] font-medium hover:border-border focus:border-border"
          value={choice.label}
          onChange={(e) =>
            onChange((c) => {
              c.label = e.target.value;
            })
          }
        />
        {choice.variantDefining && <Chip tone="accent">Variant-defining</Chip>}
        {choice.additiveModifier && <Chip>Additive modifier</Chip>}
        {choice.impacts.length > 0 && (
          <Chip tone="ok">
            {choice.impacts.length} impact{choice.impacts.length === 1 ? "" : "s"}
          </Chip>
        )}
        {choice.materials.length > 0 && <Chip>{choice.materials.length} material</Chip>}
        <span className="flex-1" />
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground hover:text-late"
          onClick={onRemove}
          aria-label="Delete choice"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-border px-3 py-3 @container">
          <div className="grid gap-3 @[520px]:grid-cols-2">
            <Cell label="Label">
              <Input
                className="h-8 text-[13px]"
                value={choice.label}
                onChange={(e) =>
                  onChange((c) => {
                    c.label = e.target.value;
                  })
                }
              />
            </Cell>
            <Cell label="Value" hint="Stable key stored on the order line.">
              <Input
                className="num h-8 text-[13px]"
                value={choice.value}
                onChange={(e) =>
                  onChange((c) => {
                    c.value = e.target.value;
                  })
                }
              />
            </Cell>
          </div>

          <div className="flex flex-wrap gap-2">
            <TagToggle
              active={choice.variantDefining}
              onClick={() =>
                onChange((c) => {
                  c.variantDefining = !c.variantDefining;
                })
              }
            >
              Variant-defining
            </TagToggle>
            <TagToggle
              active={choice.additiveModifier}
              onClick={() =>
                onChange((c) => {
                  c.additiveModifier = !c.additiveModifier;
                })
              }
            >
              Additive modifier
            </TagToggle>
          </div>

          <div className="rounded-md border border-border p-3">
            <div className="text-[12px] font-semibold">Variant context</div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Use these for variant-defining selections. Keep additive money in Pricing impacts
              below.
            </p>
            <div className="mt-2.5 grid gap-3 @[520px]:grid-cols-2">
              <Cell
                label="Pricing override"
                hint="Use when the choice defines base pricing, such as substrate thickness."
              >
                <Picker
                  value={choice.pricingOverride}
                  items={PRICING_OVERRIDES}
                  onChange={(v) =>
                    onChange((c) => {
                      c.pricingOverride = v;
                    })
                  }
                />
              </Cell>
              <Cell
                label="Variant price delta ($)"
                hint="Metadata only — additive impacts still apply separately."
              >
                <Input
                  className="num h-8 text-[13px]"
                  placeholder="0.00 (optional)"
                  value={choice.priceDelta}
                  onChange={(e) =>
                    onChange((c) => {
                      c.priceDelta = e.target.value;
                    })
                  }
                />
              </Cell>
              <Cell
                label="Resolved material override"
                className="@[520px]:col-span-2"
                hint={
                  mat ? (
                    <>
                      SKU {mat.sku} · consumption unit {mat.unit} ·{" "}
                      <span className="text-warn">weight not configured on this choice</span>
                    </>
                  ) : (
                    "Use when the selected choice should resolve to a canonical material."
                  )
                }
              >
                <Picker
                  value={choice.materialOverride ?? "— None —"}
                  items={["— None —", ...materialNames]}
                  onChange={(v) =>
                    onChange((c) => {
                      c.materialOverride = v === "— None —" ? undefined : v;
                    })
                  }
                />
              </Cell>
              <Cell
                label="Workflow context tags"
                className="@[520px]:col-span-2"
                hint="Comma separated tags passed downstream to prepress and production."
              >
                <Textarea
                  className="min-h-[52px] text-[13px]"
                  value={choice.tags}
                  onChange={(e) =>
                    onChange((c) => {
                      c.tags = e.target.value;
                    })
                  }
                />
              </Cell>
            </div>
          </div>

          <SubList
            title="Pricing impacts"
            empty="No pricing impacts defined."
            onAdd={() =>
              onChange((c) => {
                c.impacts.push({ id: uid("i"), kind: "Flat", amount: 0 });
              })
            }
            addLabel="Add impact"
          >
            {choice.impacts.map((im, idx) => (
              <div key={im.id} className="flex items-center gap-2">
                <Picker
                  className="max-w-[160px]"
                  value={im.kind}
                  items={IMPACT_KINDS}
                  onChange={(v: ImpactKind) =>
                    onChange((c) => {
                      c.impacts[idx]!.kind = v;
                    })
                  }
                />
                <Input
                  className="num h-8 max-w-[120px] text-[13px]"
                  value={String(im.amount)}
                  onChange={(e) =>
                    onChange((c) => {
                      c.impacts[idx]!.amount = Number(e.target.value) || 0;
                    })
                  }
                />
                <span className="text-[11px] text-muted-foreground">
                  {im.kind === "Percent of line" ? "%" : "$"}
                </span>
                <span className="flex-1" />
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 text-muted-foreground hover:text-late"
                  aria-label="Remove impact"
                  onClick={() =>
                    onChange((c) => {
                      c.impacts.splice(idx, 1);
                    })
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </SubList>

          <SubList
            title="Materials / inventory"
            empty="No planned material usage."
            hint="Planned material usage metadata for prepress and purchasing."
            onAdd={() =>
              onChange((c) => {
                c.materials.push({
                  id: uid("cm"),
                  materialId: materials[0]!.id,
                  basis: "Area (sqft)",
                  perUnit: 1,
                });
              })
            }
            addLabel="Add material"
          >
            {choice.materials.map((cm, idx) => (
              <div key={cm.id} className="grid gap-2 @[520px]:grid-cols-[1fr_150px_100px_auto]">
                <Picker
                  value={materials.find((m) => m.id === cm.materialId)?.name ?? materialNames[0]!}
                  items={materialNames}
                  onChange={(v) =>
                    onChange((c) => {
                      c.materials[idx]!.materialId = materials.find((m) => m.name === v)!.id;
                    })
                  }
                />
                <Picker
                  value={cm.basis}
                  items={QUANTITY_BASES}
                  onChange={(v) =>
                    onChange((c) => {
                      c.materials[idx]!.basis = v;
                    })
                  }
                />
                <Input
                  className="num h-8 text-[13px]"
                  value={String(cm.perUnit)}
                  onChange={(e) =>
                    onChange((c) => {
                      c.materials[idx]!.perUnit = Number(e.target.value) || 0;
                    })
                  }
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 text-muted-foreground hover:text-late"
                  aria-label="Remove material"
                  onClick={() =>
                    onChange((c) => {
                      c.materials.splice(idx, 1);
                    })
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </SubList>
        </div>
      )}
    </div>
  );
}

function TagToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
        active
          ? "border-primary/50 bg-primary/15 text-primary"
          : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function SubList({
  title,
  hint,
  empty,
  addLabel,
  onAdd,
  children,
}: {
  title: string;
  hint?: string;
  empty: string;
  addLabel: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  const has = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[12px] font-semibold">{title}</div>
          {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
        </div>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-[12px]" onClick={onAdd}>
          <Plus className="size-3.5" />
          {addLabel}
        </Button>
      </div>
      <div className="mt-2 space-y-2">
        {has ? children : <p className="text-[12px] italic text-muted-foreground">{empty}</p>}
      </div>
    </div>
  );
}
