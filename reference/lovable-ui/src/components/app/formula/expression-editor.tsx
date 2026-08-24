import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { FormulaInput } from "@/lib/mock/formulas";

const KEYWORDS = ["max", "min", "ceil", "floor", "round", "abs", "if"];
const JOB_VARS = ["w", "h", "q", "sqft", "total_sqft", "price", "unit"];

/** Very light client-side lint. The server performs authoritative validation. */
export function lintExpression(expression: string, inputs: FormulaInput[]) {
  const text = expression.trim();
  if (!text) return { ok: false, message: "Formula expression is empty." };
  const open = (expression.match(/\(/g) ?? []).length;
  const close = (expression.match(/\)/g) ?? []).length;
  if (open !== close) return { ok: false, message: `Unbalanced parentheses — ${open} opening and ${close} closing.` };
  if (/Math\./.test(expression)) return { ok: false, message: "Use ceil(…), floor(…) and max(…) rather than Math.ceil(…)." };

  const declared = new Set([...inputs.map((i) => i.name), ...JOB_VARS, ...KEYWORDS]);
  const assigned = new Set<string>();
  for (const line of expression.split("\n")) {
    const m = /^\s*([a-z_][a-z0-9_]*)\s*=/.exec(line);
    if (m?.[1]) assigned.add(m[1]);
  }
  const used = expression
    .replace(/#.*$/gm, "")
    .match(/[a-z_][a-z0-9_]*/g) ?? [];
  const unknown = [...new Set(used)].filter(
    (t) => !declared.has(t) && !assigned.has(t) && !["sheet_rate", "rate_per_sqft", "rate_per_linear_ft", "minimum_charge"].includes(t),
  );
  if (unknown.length) {
    return { ok: true, warning: `Not declared as an input: ${unknown.slice(0, 4).join(", ")}${unknown.length > 4 ? "…" : ""}` } as const;
  }
  return { ok: true } as const;
}

function highlight(line: string, names: Set<string>) {
  const parts = line.split(/([a-z_][a-z0-9_]*|#.*$)/gi);
  return parts.map((p, i) => {
    if (!p) return null;
    if (p.startsWith("#")) return <span key={i} className="text-muted-foreground italic">{p}</span>;
    if (KEYWORDS.includes(p)) return <span key={i} className="text-info font-semibold">{p}</span>;
    if (names.has(p)) return <span key={i} className="text-primary">{p}</span>;
    if (JOB_VARS.includes(p)) return <span key={i} className="text-ok">{p}</span>;
    return <span key={i}>{p}</span>;
  });
}

/** Read-only, syntax-tinted rendering used in Product Builder and dialogs. */
export function ExpressionView({ expression, inputs = [], className }: { expression: string; inputs?: FormulaInput[]; className?: string }) {
  const names = useMemo(() => new Set(inputs.map((i) => i.name)), [inputs]);
  const lines = expression.split("\n");
  return (
    <div className={cn("overflow-x-auto rounded-md border border-border bg-surface-2", className)}>
      <pre className="num min-w-full p-0 text-[12px] leading-[1.55]">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-2 px-0">
            <span className="select-none border-r border-border/70 py-0 pr-2 text-right text-muted-foreground/70">{i + 1}</span>
            <code className="whitespace-pre pr-3">{highlight(l, names) as unknown as string}</code>
          </div>
        ))}
      </pre>
    </div>
  );
}

export function ExpressionEditor({
  value, onChange, inputs, readOnly,
}: { value: string; onChange: (v: string) => void; inputs: FormulaInput[]; readOnly?: boolean }) {
  const lint = lintExpression(value, inputs);
  const lineCount = Math.max(value.split("\n").length, 10);

  if (readOnly) return <ExpressionView expression={value} inputs={inputs} />;

  return (
    <div className="space-y-1.5">
      <div className="flex overflow-hidden rounded-md border border-border bg-surface-2 focus-within:ring-1 focus-within:ring-ring">
        <div aria-hidden className="num select-none border-r border-border/70 px-2 py-2 text-right text-[12px] leading-[1.55] text-muted-foreground/70">
          {Array.from({ length: lineCount }, (_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          aria-label="Formula expression"
          rows={lineCount}
          className="num min-h-[200px] w-full resize-y bg-transparent px-2.5 py-2 text-[12px] leading-[1.55] outline-none"
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {lint.ok ? (
          <span className="inline-flex items-center gap-1 text-ok"><CheckCircle2 className="size-3.5" />Expression looks valid</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-late"><AlertTriangle className="size-3.5" />{lint.message}</span>
        )}
        {lint.ok && "warning" in lint && lint.warning && (
          <span className="inline-flex items-center gap-1 text-warn"><AlertTriangle className="size-3.5" />{lint.warning}</span>
        )}
        <span className="text-muted-foreground">Final validation runs on save.</span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Job variables: <span className="num text-ok">w</span>, <span className="num text-ok">h</span>, <span className="num text-ok">q</span>,{" "}
        <span className="num text-ok">sqft</span>, <span className="num text-ok">total_sqft</span>. Declared inputs are available by variable name.
        Use <span className="num">ceil()</span>, <span className="num">floor()</span>, <span className="num">round()</span>, <span className="num">max()</span>, <span className="num">min()</span>.
      </p>
    </div>
  );
}
