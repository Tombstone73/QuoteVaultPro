import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Copy, RotateCcw, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { InlineSelect, SaveButton, type SaveState } from "@/components/app/sales-editable";
import { Status } from "@/components/app/primitives";
import { cn } from "@/lib/utils";
import { lineTotal, materials, money, products, type LineItem } from "@/lib/mock/data";
import { artForSide, lineArt, lineSides } from "@/lib/mock/order-context";
import { ArtThumb, useArtUpload } from "@/components/app/line-art";
import {
  computeMaterials,
  computeUsage,
  formatSize,
  optionDefsFor,
  parseSize,
  productById,
  requiresDimensions,
} from "@/lib/mock/product-config";

/**
 * ONE line-item configuration experience, shared by:
 * quote create, quote edit, order create, order edit.
 */
export function LineEditor({
  docNumber,
  mode,
  line,
  onClose,
  onCommit,
  onDelete,
  onDuplicate,
  onAttachArt,
}: {
  docNumber: string;
  mode: "edit" | "new";
  line: LineItem;
  onClose: () => void;
  onCommit: (l: LineItem) => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  /** Attach Line Item Art from inside the editor. Artwork still owns versions. */
  onAttachArt?: (names: string[]) => void;
}) {
  const [draft, setDraft] = useState<LineItem>(line);
  const [state, setState] = useState<SaveState>(mode === "new" ? "dirty" : "clean");

  useEffect(() => {
    setDraft(line);
    setState(mode === "new" ? "dirty" : "clean");
  }, [line, mode]);

  const { input: artInput, open: openArt } = useArtUpload((names) => onAttachArt?.(names));

  const patch = (p: Partial<LineItem>) => {
    setDraft((d) => ({ ...d, ...p }));
    setState("dirty");
  };

  const product = productById(draft.productId);
  const defs = optionDefsFor(draft.productId);
  const dims = requiresDimensions(product);
  const size = parseSize(draft.size);
  const overridden = Math.abs(draft.sellUnit - draft.calcUnit) > 0.001;
  const sides = lineSides(draft);
  const productionArt = lineArt(draft, "production");

  // Read-only production math resolved from the Product — never fabricated.
  const usage = useMemo(
    () => computeUsage(draft.productId, size, draft.qty),
    [draft.productId, size.w, size.h, size.unit, draft.qty],
  );
  const needs = useMemo(
    () => computeMaterials(draft.productId, size, draft.qty, draft.options, materials),
    [draft.productId, size.w, size.h, size.unit, draft.qty, draft.options],
  );

  const setDim = (which: "w" | "h", v: string) => {
    const next = { ...size, [which]: v };
    patch({ size: formatSize(next.w, next.h, next.unit) });
  };

  const changeProduct = (productId: string) => {
    const next = productById(productId);
    // Configuration that cannot exist on the new Product is dropped, not carried over.
    const nextDefs = optionDefsFor(productId);
    patch({
      productId,
      description: `${next?.name ?? "Product"} — ${draft.description.split("—").slice(1).join("—").trim() || "new line"}`,
      options: nextDefs.map((d) => {
        const kept = draft.options.find((o) => o.label === d.label);
        return {
          label: d.label,
          value: kept && d.choices.includes(kept.value) ? kept.value : d.default,
        };
      }),
      size: requiresDimensions(next) ? (draft.size ?? '24" × 18"') : undefined,
    });
  };

  const commit = () => {
    setState("saving");
    window.setTimeout(() => {
      onCommit(draft);
      setState("saved");
      window.setTimeout(() => setState((s) => (s === "saved" ? "clean" : s)), 1400);
    }, 450);
  };

  return (
    <aside className="@container flex h-full min-w-0 flex-col bg-surface">
      <header className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold">
            {mode === "new" ? "New line item" : product?.name}
          </div>
          <div className="num truncate text-[11px] text-muted-foreground">
            {product?.sku} · {mode === "new" ? "Not yet added" : `Line on #${docNumber}`}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close line editor"
          className="rounded p-1 hover:bg-accent"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-3 overflow-y-auto p-3 @[620px]:grid-cols-2 @[980px]:grid-cols-3">
        <Section title="Product" className="@[620px]:col-span-2 @[980px]:col-span-3">
          <div className="grid gap-2 @[620px]:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] @[620px]:items-end">
            <InlineSelect
              label="Product"
              value={draft.productId}
              options={products.map((p) => ({
                value: p.id,
                label: p.name,
                hint: `${p.sku} · ${p.basis}`,
              }))}
              onChange={changeProduct}
              render={(v) => productById(v)?.name ?? v}
              width="w-64"
            />
            <div className="mt-2 grid gap-1 @[620px]:mt-0">
              <Label className="text-[11px] uppercase text-muted-foreground">Job description</Label>
              <Input
                value={draft.description}
                className="h-8 text-[13px]"
                onChange={(e) => patch({ description: e.target.value })}
              />
            </div>
          </div>
        </Section>

        <Section title="Configuration" className="@[620px]:col-span-2">
          {defs.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              This product has no configurable options.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 @[980px]:grid-cols-3">
              {defs.map((d) => {
                const current = draft.options.find((o) => o.label === d.label)?.value ?? d.default;
                return (
                  <InlineSelect
                    key={d.label}
                    label={d.label}
                    value={current}
                    options={d.choices.map((c) => ({ value: c, label: c }))}
                    onChange={(v) => {
                      const exists = draft.options.some((o) => o.label === d.label);
                      patch({
                        options: exists
                          ? draft.options.map((o) => (o.label === d.label ? { ...o, value: v } : o))
                          : [...draft.options, { label: d.label, value: v }],
                      });
                    }}
                    width="w-48"
                  />
                );
              })}
            </div>
          )}
        </Section>

        <Section
          title={dims ? "Dimensions & quantity" : "Quantity"}
          className="@[620px]:col-span-1 @[980px]:col-span-2"
        >
          <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
            {dims && (
              <>
                <Field label={`Width (${size.unit})`}>
                  <Input
                    value={size.w}
                    className="num h-8 w-20"
                    onChange={(e) => setDim("w", e.target.value)}
                  />
                </Field>
                <span className="pb-2 text-muted-foreground">×</span>
                <Field label={`Height (${size.unit})`}>
                  <Input
                    value={size.h}
                    className="num h-8 w-20"
                    onChange={(e) => setDim("h", e.target.value)}
                  />
                </Field>
              </>
            )}
            <Field label="Quantity (pcs)">
              <Input
                type="number"
                min={1}
                value={draft.qty}
                className="num h-8 w-24"
                onChange={(e) => patch({ qty: Number(e.target.value) || 0 })}
              />
            </Field>
            {dims && draft.size && (
              <span className="num pb-2 text-[12px] text-muted-foreground">{draft.size}</span>
            )}
          </div>

          {usage ? (
            <div className="mt-2.5 grid gap-x-4 gap-y-1 border-t border-border pt-2 @[420px]:grid-cols-2">
              {usage.rows.map((r) => (
                <div key={r.label} className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {r.label}
                  </span>
                  <span className="num text-[13px] font-semibold">{r.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {product?.name} prices per {product?.basis} — no area or sheet usage applies.
            </p>
          )}
        </Section>

        <Section title="Pricing" className="@[980px]:col-span-1">
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-muted-foreground">
              Calculated unit price <span className="text-[10px] uppercase">(Pricing)</span>
            </span>
            <span className="num">{money(draft.calcUnit)}</span>
          </div>
          <div className="mt-2 grid gap-1">
            <Label className="text-[11px] uppercase text-muted-foreground">
              Selling unit price
            </Label>
            <div className="flex flex-wrap items-center gap-1.5">
              <Input
                type="number"
                step="0.01"
                value={draft.sellUnit}
                className="num h-8 w-32"
                onChange={(e) =>
                  patch({
                    sellUnit: Number(e.target.value) || 0,
                    overrideReason: "Manual entry",
                    overrideBy: "Dale",
                  })
                }
              />
              {overridden && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 text-[11px]"
                  onClick={() =>
                    patch({
                      sellUnit: draft.calcUnit,
                      overrideReason: undefined,
                      overrideBy: undefined,
                    })
                  }
                >
                  <RotateCcw className="size-3" /> Reset to calculated price
                </Button>
              )}
            </div>
          </div>
          {overridden && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-[11px]">
              <span className="rounded border border-warn/50 bg-warn/15 px-1 font-semibold uppercase text-warn">
                Manual price
              </span>
              <span className="text-muted-foreground">
                {draft.overrideReason} — {draft.overrideBy ?? "Dale"}
              </span>
            </div>
          )}
          <div className="mt-2 flex justify-between border-t border-border pt-2 text-[13px] font-semibold">
            <span>Line total</span>
            <span className="num">{money(lineTotal(draft))}</span>
          </div>
        </Section>

        {needs.length > 0 && (
          <Section
            title="Material / inventory need"
            className="@[620px]:col-span-2 @[980px]:col-span-3"
          >
            <div className="grid gap-1 @[620px]:grid-cols-2 @[980px]:grid-cols-3">
              {needs.map((n) => (
                <div
                  key={n.material}
                  className="flex items-baseline justify-between gap-2 rounded border border-border/70 bg-surface-2/40 px-2 py-1"
                >
                  <span className="min-w-0 truncate text-[12px]">{n.material}</span>
                  <span className="shrink-0 text-right">
                    <span className="num block text-[12px] font-semibold">{n.need}</span>
                    {n.available && (
                      <span className="num block text-[10px] text-muted-foreground">
                        {n.available}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Informational — inventory is adjusted and reserved in the Inventory module.
            </p>
          </Section>
        )}

        <Section title="Line item notes" className="@[620px]:col-span-2 @[980px]:col-span-1">
          <Textarea
            rows={3}
            value={draft.notes ?? ""}
            placeholder="Note for this line only — e.g. match previous blue, leave 1/2in unprinted margin on left edge."
            className="min-h-[68px] text-[12px]"
            onChange={(e) => patch({ notes: e.target.value })}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Applies to this line item, not the whole order.
          </p>
        </Section>

        <Section title="Artwork" className="@[620px]:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Status value={draft.artworkStatus} />
            <div className="flex items-center gap-1.5">
              {artInput}
              <Button
                size="sm"
                className="h-7 gap-1 text-[11px]"
                onClick={openArt}
                disabled={!onAttachArt}
              >
                <Upload className="size-3" /> Upload art
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[11px]" asChild>
                <Link to="/artwork" search={{ order: docNumber, line: draft.id }}>
                  Open Artwork
                </Link>
              </Button>
            </div>
          </div>

          <div className="mt-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Line item art
            </div>
            <div className="mt-1 flex flex-wrap items-start gap-2">
              {sides.map((sd) => {
                const art = artForSide(draft, sd);
                return art ? (
                  <span
                    key={sd}
                    className="flex items-center gap-1.5 rounded border border-border px-1.5 py-1"
                  >
                    <ArtThumb art={art} side={sd} />
                    <span className="num max-w-[10rem] truncate text-[11px]">{art.name}</span>
                  </span>
                ) : (
                  <button
                    key={sd}
                    type="button"
                    onClick={openArt}
                    disabled={!onAttachArt}
                    className="flex h-12 min-w-24 flex-col items-center justify-center rounded border border-dashed border-border bg-surface-2/50 px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-accent disabled:opacity-60"
                  >
                    No art{sd !== "Single" ? ` · ${sd}` : ""}
                  </button>
                );
              })}
            </div>
          </div>

          {productionArt.length > 0 && (
            <div className="mt-2 border-t border-border pt-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Production art (read-only — owned by Prepress)
              </div>
              <ul className="mt-1 space-y-0.5">
                {productionArt.map((a) => (
                  <li
                    key={a.id}
                    className="num flex items-center justify-between gap-2 text-[11px]"
                  >
                    <span className="truncate">{a.name}</span>
                    <span className="text-muted-foreground">{a.side}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
        <div className="flex items-center gap-1">
          {mode === "edit" && (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1 px-2 text-[12px]"
                onClick={onDuplicate}
              >
                <Copy className="size-3.5" /> Duplicate
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 gap-1 px-2 text-[12px] text-destructive"
                  >
                    <Trash2 className="size-3.5" /> Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this line item?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {product?.name} · Qty {draft.qty} · {money(lineTotal(draft))} will be removed
                      from #{docNumber}. This is recorded in Order history.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground"
                      onClick={onDelete}
                    >
                      Delete line
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
        <SaveButton state={state} onSave={commit} />
      </footer>
    </aside>
  );
}

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("h-fit rounded-md border border-border", className)}>
      <h3 className="border-b border-border bg-surface-2 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="p-2.5">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <Label className="text-[11px] uppercase text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
