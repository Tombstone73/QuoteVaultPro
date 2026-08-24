import { Copy, Library, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Segmented } from "@/components/app/product-editor/fields";
import { EmptyState } from "@/components/app/primitives";
import { cn } from "@/lib/utils";
import { FormulaChips } from "./badges";
import { myFormulas, revisionNumber, sharedFormulas, type Formula } from "@/lib/mock/formulas";

/** Formula picker used by Product Builder and by "use as base" flows. */
export function FormulaPicker({
  open, onOpenChange, selectedId, onSelect,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  selectedId?: string | undefined;
  onSelect: (f: Formula) => void;
}) {
  const [tab, setTab] = useState<"mine" | "shared">("mine");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | undefined>(selectedId);

  const list = useMemo(() => {
    const source = tab === "mine" ? myFormulas.filter((f) => f.status !== "Archived") : sharedFormulas;
    const needle = q.trim().toLowerCase();
    if (!needle) return source;
    return source.filter((f) => `${f.name} ${f.description} ${f.purpose}`.toLowerCase().includes(needle));
  }, [tab, q]);

  const current = list.find((f) => f.id === picked);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Select a formula</DialogTitle>
          <DialogDescription className="text-[12px]">
            Choose reusable pricing logic. The Product supplies values for the formula&apos;s declared inputs.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={tab}
            onChange={(v) => { setTab(v); setPicked(undefined); }}
            items={[{ id: "mine" as const, label: "My formulas" }, { id: "shared" as const, label: "Shared formulas" }]}
          />
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-8 pl-7 text-[13px]" placeholder="Search formulas" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        {tab === "shared" && (
          <p className="rounded-md border border-border bg-surface-2 px-2.5 py-2 text-[12px] text-muted-foreground">
            <span className="font-medium text-foreground">Coming soon.</span> Sharing formulas between organizations is not
            live yet. These are reference examples — copying one into your library will be available later.
          </p>
        )}

        {list.length === 0 ? (
          <EmptyState title="No formulas match" hint="Try a different search, or create a new formula from Product Builder." />
        ) : (
          <div className="max-h-[46vh] space-y-1.5 overflow-y-auto pr-0.5">
            {list.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setPicked(f.id)}
                aria-pressed={picked === f.id}
                className={cn(
                  "block w-full rounded-md border p-2.5 text-left transition-colors",
                  picked === f.id ? "border-primary/60 bg-primary/5" : "border-border hover:bg-accent/50",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{f.name}</span>
                  <span className="num text-[11px] text-muted-foreground">Rev {revisionNumber(f)}</span>
                  <FormulaChips formula={f} />
                </div>
                <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{f.description}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                  <span>{f.purpose}</span>
                  <span>{f.inputs.length} declared input{f.inputs.length === 1 ? "" : "s"}</span>
                  {f.sharedBy && <span>Shared by {f.sharedBy}</span>}
                  {typeof f.copies === "number" && <span>{f.copies} copies</span>}
                </div>
              </button>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <span className="text-[11px] text-muted-foreground">
            {tab === "shared"
              ? "A shared formula will be copied into your library as an independent formula before a Product can use it."
              : "Product-scoped formulas only appear on the Product that created them."}
          </span>
          <span className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="h-8" onClick={() => onOpenChange(false)}>Cancel</Button>
            {tab === "shared" ? (
              <Button size="sm" className="h-8 gap-1.5" disabled title="Copying shared formulas is coming soon">
                <Copy className="size-3.5" />Copy to my library &amp; use
              </Button>
            ) : (
              <Button size="sm" className="h-8 gap-1.5" disabled={!current} onClick={() => { if (current) { onSelect(current); onOpenChange(false); } }}>
                <Library className="size-3.5" />Use formula
              </Button>
            )}
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
