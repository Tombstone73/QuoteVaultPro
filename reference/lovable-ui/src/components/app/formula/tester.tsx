import { AlertTriangle, Play, RotateCcw, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Cell, Picker } from "@/components/app/product-editor/fields";
import { InputValueFields } from "./inputs-editor";
import { mockTest, type Formula, type TesterJob } from "@/lib/mock/formulas";

/**
 * Formula tester. Results are illustrative: the production server performs the
 * authoritative calculation and returns the diagnostics shown here.
 */
export function FormulaTester({ formula, seedValues }: { formula: Formula; seedValues?: Record<string, string> }) {
  const defaults = useMemo(() => {
    const out: Record<string, string> = {};
    for (const i of formula.inputs) out[i.name] = seedValues?.[i.name] ?? i.defaultValue;
    return out;
  }, [formula, seedValues]);

  const [job, setJob] = useState<TesterJob>({ w: "24", h: "18", qty: "25", unit: "in" });
  const [values, setValues] = useState<Record<string, string>>(defaults);
  const [result, setResult] = useState(() => mockTest(formula, { w: "24", h: "18", qty: "25", unit: "in" }, defaults));

  const run = () => setResult(mockTest(formula, job, values));
  const reset = () => {
    setJob({ w: "24", h: "18", qty: "25", unit: "in" });
    setValues(defaults);
    setResult(mockTest(formula, { w: "24", h: "18", qty: "25", unit: "in" }, defaults));
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-3">
        <Group title="Job inputs" hint="A sample line item to price.">
          <div className="grid gap-3 sm:grid-cols-4">
            <Cell label="Width"><Input className="num h-8 text-[13px]" value={job.w} onChange={(e) => setJob({ ...job, w: e.target.value })} /></Cell>
            <Cell label="Height"><Input className="num h-8 text-[13px]" value={job.h} onChange={(e) => setJob({ ...job, h: e.target.value })} /></Cell>
            <Cell label="Quantity"><Input className="num h-8 text-[13px]" value={job.qty} onChange={(e) => setJob({ ...job, qty: e.target.value })} /></Cell>
            <Cell label="Dimension unit">
              <Picker value={job.unit} items={["in", "cm"] as const} onChange={(v) => setJob({ ...job, unit: v })} />
            </Cell>
          </div>
        </Group>

        <Group title="Formula inputs" hint="Values a Product would supply.">
          {formula.inputs.length === 0 ? (
            <p className="text-[12px] italic text-muted-foreground">This formula declares no Product inputs.</p>
          ) : (
            <InputValueFields inputs={formula.inputs} values={values} onChange={(n, v) => setValues((s) => ({ ...s, [n]: v }))} />
          )}
        </Group>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" className="h-8 gap-1.5" onClick={run}><Play className="size-3.5" />Run test</Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={reset}><RotateCcw className="size-3.5" />Reset</Button>
          <span className="text-[11px] text-muted-foreground">Test results are a preview — final pricing is calculated by PrintersHero when the line is priced.</span>
        </div>
      </div>

      <div className="min-w-0 space-y-2 rounded-md border border-border bg-surface-2 p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Result</div>
        <div className="num text-2xl font-semibold tabular-nums">{result.price}</div>
        <dl className="divide-y divide-border border-y border-border">
          {result.lines.map((l) => (
            <div key={l.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 py-1.5">
              <dt className="min-w-0">
                <span className="block truncate text-[12px]">{l.label}</span>
                {l.hint && <span className="block truncate text-[11px] text-muted-foreground">{l.hint}</span>}
              </dt>
              <dd className="num text-[13px] font-medium tabular-nums">{l.value}</dd>
            </div>
          ))}
        </dl>
        {result.errors.map((e) => (
          <p key={e} className="flex items-start gap-1.5 text-[12px] text-late"><XCircle className="mt-0.5 size-3.5 shrink-0" />{e}</p>
        ))}
        {result.warnings.map((w) => (
          <p key={w} className="flex items-start gap-1.5 text-[12px] text-warn"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{w}</p>
        ))}
        {result.ok && result.warnings.length === 0 && (
          <p className="text-[12px] text-muted-foreground">No warnings for this combination.</p>
        )}
      </div>
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline gap-2 border-b border-border pb-1">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}
