import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Cell, Chip } from "@/components/app/product-editor/fields";
import { ExpressionView } from "./expression-editor";
import { cn } from "@/lib/utils";
import type { Formula, FormulaRevision } from "@/lib/mock/formulas";

/* ------------------------------ duplicate ------------------------------ */

export function DuplicateFormulaDialog({
  formula, open, onOpenChange, onConfirm,
}: { formula: Formula | null; open: boolean; onOpenChange: (o: boolean) => void; onConfirm: (name: string) => void }) {
  const [name, setName] = useState("");
  const value = name || (formula ? `Copy of ${formula.name}` : "");
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setName(""); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Duplicate formula</DialogTitle>
          <DialogDescription className="text-[12px]">
            Creates a new formula in your library from {formula?.name}. The expression, declared inputs and description are copied.
          </DialogDescription>
        </DialogHeader>
        <Cell label="New formula name">
          <Input className="h-8 text-[13px]" value={value} onChange={(e) => setName(e.target.value)} />
        </Cell>
        <ul className="space-y-1 text-[12px] text-muted-foreground">
          <li>Copied: expression, declared inputs, description.</li>
          <li>Not copied: product usage, revision history and shared-library listing.</li>
        </ul>
        <DialogFooter>
          <Button size="sm" variant="outline" className="h-8" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" className="h-8" onClick={() => { onConfirm(value); onOpenChange(false); setName(""); }}>Create duplicate</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- compare ------------------------------- */

export function CompareRevisionsDialog({
  formula, a, b, open, onOpenChange,
}: { formula: Formula | null; a: FormulaRevision | null; b: FormulaRevision | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  if (!formula || !a || !b) {
    return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent /></Dialog>;
  }
  const namesA = new Set(a.inputs.map((i) => i.name));
  const namesB = new Set(b.inputs.map((i) => i.name));
  const added = b.inputs.filter((i) => !namesA.has(i.name));
  const removed = a.inputs.filter((i) => !namesB.has(i.name));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Compare revisions — {formula.name}</DialogTitle>
          <DialogDescription className="text-[12px]">
            Revision {a.rev} ({a.created}) compared with revision {b.rev} ({b.created}).
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-2">
          {[a, b].map((r, idx) => (
            <div key={r.rev} className="min-w-0 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Revision {r.rev}</span>
                {r.state === "Current" && <Chip tone="ok">Current</Chip>}
                {idx === 1 && <ArrowRight className="hidden size-3.5 text-muted-foreground md:block" />}
              </div>
              <ExpressionView expression={r.expression} inputs={r.inputs} />
              <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px]">
                <dt className="text-muted-foreground">Created</dt><dd>{r.created}</dd>
                <dt className="text-muted-foreground">Created by</dt><dd>{r.createdBy}</dd>
                <dt className="text-muted-foreground">Products using</dt><dd className="num">{r.productsUsing}</dd>
                <dt className="text-muted-foreground">Declared inputs</dt><dd className="num">{r.inputs.length}</dd>
              </dl>
              {r.note && <p className="text-[11px] italic text-muted-foreground">{r.note}</p>}
            </div>
          ))}
        </div>

        <div className="rounded-md border border-border p-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Input changes</div>
          {added.length === 0 && removed.length === 0 ? (
            <p className="mt-1 text-[12px] text-muted-foreground">No declared inputs were added or removed.</p>
          ) : (
            <ul className="mt-1 space-y-0.5 text-[12px]">
              {added.map((i) => <li key={i.name} className={cn("num text-ok")}>+ {i.name} — {i.label}</li>)}
              {removed.map((i) => <li key={i.name} className="num text-late">− {i.name} — {i.label}</li>)}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button size="sm" variant="outline" className="h-8" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
