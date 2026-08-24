import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft, ArrowUpRight, Copy, GitCompare, GitBranch, Globe2, Library, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Panel, EmptyState, td, th } from "@/components/app/primitives";
import { Cell, Chip, Picker } from "@/components/app/product-editor/fields";
import { ExpressionEditor } from "@/components/app/formula/expression-editor";
import { DeclaredInputsEditor } from "@/components/app/formula/inputs-editor";
import { FormulaTester } from "@/components/app/formula/tester";
import { FormulaChips } from "@/components/app/formula/badges";
import { CompareRevisionsDialog, DuplicateFormulaDialog } from "@/components/app/formula/dialogs";
import {
  FORMULA_PURPOSES, FORMULA_STATUSES, currentRevision, fid, findFormula, isReferenceShared,
  type Formula, type FormulaPurpose, type FormulaStatus, type FormulaRevision,
} from "@/lib/mock/formulas";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/formula-library/$id")({
  validateSearch: (s: Record<string, unknown>): { product?: string; productName?: string } => ({
    ...(typeof s["product"] === "string" ? { product: s["product"] as string } : {}),
    ...(typeof s["productName"] === "string" ? { productName: s["productName"] as string } : {}),
  }),

  head: () => ({
    meta: [
      { title: "Formula Editor — PrintersHero V2" },
      { name: "description", content: "Edit a pricing formula: expression, declared product inputs, tester, product usage and immutable revision history." },
      { property: "og:title", content: "Formula Editor — PrintersHero V2" },
      { property: "og:description", content: "Edit expressions, declared inputs and review revisions for a PrintersHero pricing formula." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FormulaEditorPage,
});

const SECTIONS = [
  { id: "basics", label: "Basics" },
  { id: "formula", label: "Formula" },
  { id: "inputs", label: "Declared inputs" },
  { id: "tester", label: "Tester" },
  { id: "usage", label: "Usage" },
  { id: "revisions", label: "Revisions" },
] as const;

function FormulaEditorPage() {
  const { id } = Route.useParams();
  const { product, productName } = Route.useSearch();
  const navigate = useNavigate();
  const fromProduct = Boolean(product);
  const productLabel = productName ?? "this product";

  const blank = useMemo<Formula>(() => ({
    id: "new",
    name: "",
    description: "",
    purpose: "Area pricing",
    status: "Active",
    // A formula started from Product Builder begins scoped to that product.
    visibility: fromProduct ? "Product-scoped" : "In Library",
    ...(fromProduct ? { scopeProduct: productLabel } : {}),
    updated: "just now",
    updatedBy: "You",
    expression: "sqft = (w * h) / 144\nprice = sqft * rate\nprice",
    inputs: [],
    revisions: [
      { rev: 1, state: "Current", created: "just now", createdBy: "You", productsUsing: 0, note: "Initial revision.", expression: "", inputs: [] },
    ],
    usage: [],
  }), [fromProduct, productLabel]);

  const original = useMemo(() => (id === "new" ? blank : findFormula(id)), [id, blank]);
  const [f, setF] = useState<Formula | null>(() => (original ? structuredClone(original) : null));
  const [dirty, setDirty] = useState(false);
  const [dup, setDup] = useState(false);
  const [compare, setCompare] = useState<FormulaRevision | null>(null);

  if (!f || !original) {
    return (
      <div className="p-4">
        <Panel><EmptyState title="Formula not found" hint="It may have been archived. Return to the Formula Library." /></Panel>
        <Button size="sm" variant="outline" className="mt-3 h-8" asChild><Link to="/formula-library">Back to Formula Library</Link></Button>
      </div>
    );
  }

  /** Reference-only records from the future shared catalogue are never editable. */
  const readOnly = isReferenceShared(f);
  const patch = (fn: (d: Formula) => void) => {
    setF((prev) => { const next = structuredClone(prev!); fn(next); return next; });
    setDirty(true);
  };
  const rev = currentRevision(f);
  const nextRev = rev.rev + 1;
  const inUse = f.usage.length;
  const scoped = f.visibility === "Product-scoped";

  const createRevision = () => {
    setDirty(false);
    toast.success(
      inUse > 0
        ? `Revision ${nextRev} created — products stay on the revision they adopted`
        : `Revision ${nextRev} created`,
    );
  };

  const addToLibrary = () => {
    patch((d) => { d.visibility = "In Library"; });
    setDirty(false);
    toast.success(`${f.name || "Formula"} is now in your library and reusable by any product`);
  };

  const useAndReturn = () => {
    toast.success(`Revision ${rev.rev} handed back to ${productLabel} for adoption`);
    navigate({ to: "/product-builder", search: product ? { product } : {} });
  };

  return (
    <div className="pb-10">
      {/* sticky editor bar */}
      <div className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2">
          <Button size="icon" variant="ghost" className="size-8" asChild aria-label="Back to Formula Library">
            <Link to="/formula-library"><ArrowLeft className="size-4" /></Link>
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[15px] font-semibold">{f.name || "New formula"}</h1>
              <FormulaChips formula={f} />
              <span className="num text-[11px] text-muted-foreground">Revision {rev.rev}</span>
              {dirty && <Chip tone="warn">Saving creates revision {nextRev}</Chip>}
            </div>
            <p className="truncate text-[11px] text-muted-foreground">
              {readOnly
                ? `Reference example shared by ${f.sharedBy} — read-only preview.`
                : scoped
                  ? `Scoped to ${f.scopeProduct ?? productLabel} · Updated ${f.updated} by ${f.updatedBy}`
                  : `Used by ${inUse} product${inUse === 1 ? "" : "s"} · Updated ${f.updated} by ${f.updatedBy}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12px]" onClick={() => setDup(true)}><Copy className="size-3.5" />Duplicate</Button>
            {scoped && !readOnly && (
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12px]" onClick={addToLibrary}>
                <Library className="size-3.5" />Add to Library
              </Button>
            )}
            {!readOnly && (
              <Button size="sm" variant="outline" disabled className="h-8 gap-1.5 text-[12px]" title="Sharing with other shops is coming soon">
                <Globe2 className="size-3.5" />Share
                <span className="text-[10px] uppercase tracking-wide">Soon</span>
              </Button>
            )}
            {readOnly ? (
              <Button size="sm" className="h-8 gap-1.5 text-[12px]" disabled title="Copying shared formulas is coming soon">
                <Copy className="size-3.5" />Copy to my library
              </Button>
            ) : (
              <Button size="sm" className="h-8 gap-1.5 text-[12px]" disabled={!dirty || !f.name} onClick={createRevision}>
                <GitBranch className="size-3.5" />Create revision {nextRev}
              </Button>
            )}
            {fromProduct && (
              <Button size="sm" variant="secondary" className="h-8 gap-1.5 text-[12px]" onClick={useAndReturn}>
                <ArrowUpRight className="size-3.5" />Use this revision and return
              </Button>
            )}
          </div>
        </div>
        {fromProduct && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface-2 px-4 py-1.5 text-[11px] text-muted-foreground">
            <span className="font-medium uppercase tracking-wide">Editing product</span>
            <span className="text-foreground">{productLabel}</span>
            <span>· Creating a revision here does not change the product. Use “Use this revision and return” to take revision {rev.rev} back to Product Builder.</span>
          </div>
        )}
        <nav className="flex gap-1 overflow-x-auto px-4 pb-1.5">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="whitespace-nowrap rounded px-2 py-1 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground">{s.label}</a>
          ))}
        </nav>
      </div>

      <div className="space-y-3 p-4">
        <Section id="basics" title="Basics" hint="How this formula is identified and where it can be used.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Cell label="Formula name" className="sm:col-span-2">
              <Input className="h-8 text-[13px]" value={f.name} readOnly={readOnly} onChange={(e) => patch((d) => { d.name = e.target.value; })} />
            </Cell>
            <Cell label="Description" className="sm:col-span-2" hint="Explain what the formula prices and any assumptions it makes.">
              <Textarea className="min-h-16 text-[13px]" value={f.description} readOnly={readOnly} onChange={(e) => patch((d) => { d.description = e.target.value; })} />
            </Cell>
            <Cell label="Purpose">
              <Picker value={f.purpose} items={FORMULA_PURPOSES} disabled={readOnly} onChange={(v: FormulaPurpose) => patch((d) => { d.purpose = v; })} />
            </Cell>
            <Cell label="Status" hint="Inactive formulas can't be newly selected; products already using them keep working.">
              <Picker value={f.status} items={FORMULA_STATUSES} disabled={readOnly} onChange={(v: FormulaStatus) => patch((d) => { d.status = v; })} />
            </Cell>
            <Cell label="Visibility" className="sm:col-span-2" hint="Lifecycle status and reusable scope are separate concerns.">
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-2">
                <FormulaChips formula={f} />
                {scoped ? (
                  <>
                    <span className="min-w-0 flex-1 text-[12px] text-muted-foreground">
                      Only {f.scopeProduct ?? productLabel} can select this formula. Adding it to the library keeps the same
                      formula and revisions — nothing is copied and no product is repriced.
                    </span>
                    {!readOnly && (
                      <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[12px]" onClick={addToLibrary}>
                        <Library className="size-3.5" />Add to Library
                      </Button>
                    )}
                  </>
                ) : (
                  <span className="min-w-0 flex-1 text-[12px] text-muted-foreground">
                    Any product in this organization can select this formula.
                  </span>
                )}
              </div>
            </Cell>
          </div>
        </Section>

        <Section id="formula" title="Formula" hint="Job variables w, h, qty and sqft are always available. Declared inputs are supplied by the Product.">
          <ExpressionEditor value={f.expression} readOnly={readOnly} inputs={f.inputs} onChange={(v) => patch((d) => { d.expression = v; })} />
          {!readOnly && (
            <p className="mt-2 text-[12px] text-muted-foreground">
              Changes create revision {nextRev}. Revision {rev.rev} stays exactly as it is, and any product using this
              formula stays pinned to the revision it adopted until it is updated intentionally.
            </p>
          )}
        </Section>

        <Section id="inputs" title="Declared inputs" hint="Values the Product must supply. Products can't use a formula until every required input is mapped.">
          <DeclaredInputsEditor
            inputs={f.inputs}
            onChange={(next) => patch((d) => { d.inputs = next; })}
          />
          {!readOnly && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Renaming or removing an input changes the contract, so it lands in revision {nextRev} — products on older
              revisions keep working until they are reviewed. Product configuration policies such as rotation are not
              declared here.
            </p>
          )}
        </Section>

        <Section id="tester" title="Formula tester" hint="Try the formula against a sample job. Test values are not product configuration.">
          <FormulaTester formula={f} />
        </Section>

        <Section id="usage" title={`Usage (${inUse})`} hint="Products currently referencing this formula, and the revision each one is pinned to. Products adopt new formula revisions explicitly.">
          {inUse === 0 ? (
            <EmptyState title="Not used by any product yet" hint="Select this formula from a Product Builder pricing section to start using it." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={th}>Product</th>
                    <th className={th}>Product status</th>
                    <th className={th + " text-right"}>Revision in use</th>
                    <th className={th}>Lifecycle</th>
                    <th className={th + " text-right"} />
                  </tr>
                </thead>
                <tbody>
                  {f.usage.map((u) => (
                    <tr key={u.productId} className="border-t border-border hover:bg-accent/60">
                      <td className={td + " py-2 font-medium"}>{u.productName}</td>
                      <td className={td + " py-2 text-muted-foreground"}>{u.productStatus}</td>
                      <td className={td + " num py-2 text-right"}>
                        <span>{u.revision}</span>
                        {u.revision < rev.rev && (
                          <span className="ml-1 text-[11px] text-muted-foreground">{rev.rev - u.revision} behind</span>
                        )}
                      </td>
                      <td className={td + " py-2 text-muted-foreground"}>{u.lifecycle}</td>
                      <td className={td + " py-2 text-right"}>
                        <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-[12px]" asChild>
                          <Link to="/product-builder" search={{ product: u.productId }}><Users className="size-3.5" />Open product</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section id="revisions" title="Revisions" hint="Revisions are immutable. Products adopt a new revision explicitly — nothing is repriced automatically.">
          <ol className="space-y-2">
            {f.revisions.map((r) => (
              <li key={r.rev} className={cn("rounded-md border p-2.5", r.state === "Current" ? "border-primary/50 bg-primary/5" : "border-border")}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="num text-[13px] font-semibold">Revision {r.rev}</span>
                  <Chip tone={r.state === "Current" ? "ok" : "neutral"}>{r.state}</Chip>
                  <span className="text-[11px] text-muted-foreground">{r.created} · {r.createdBy}</span>
                  <span className="num text-[11px] text-muted-foreground">{r.productsUsing} product{r.productsUsing === 1 ? "" : "s"}</span>
                  <span className="ml-auto flex gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[12px]" onClick={() => setCompare(r)}>
                      <GitCompare className="size-3.5" />Compare with current
                    </Button>
                  </span>
                </div>
                {r.note && <p className="mt-1 text-[12px] text-muted-foreground">{r.note}</p>}
              </li>
            ))}
          </ol>
        </Section>
      </div>

      <DuplicateFormulaDialog formula={f} open={dup} onOpenChange={setDup} onConfirm={(name) => toast.success(`${name} created as a separate formula`)} />
      <CompareRevisionsDialog formula={f} a={compare} b={rev} open={compare !== null} onOpenChange={(o) => { if (!o) setCompare(null); }} />
    </div>
  );
}

function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="section-panel scroll-mt-28">
      <div className="section-label">{title}</div>
      <div className="p-3">
        {hint && <p className="mb-2.5 text-[12px] text-muted-foreground">{hint}</p>}
        {children}
      </div>
    </section>
  );
}

/** Placeholder kept for future generated ids in this prototype. */
export const nextFormulaId = fid;
