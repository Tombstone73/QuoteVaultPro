import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";

type FormulaExample = {
  title: string;
  formula: string;
  description?: string;
};

const FORMULA_EXAMPLES: FormulaExample[] = [
  {
    title: "Simple sqft pricing",
    formula: "sqft * base_price * q",
    description: "Per-sqft rate × quantity",
  },
  {
    title: "Ceiling billing",
    formula: "ceil(sqft) * base_price * q",
    description: "Always bill whole sqft (round up)",
  },
  {
    title: "Minimum charge ($25)",
    formula: "max(25, sqft * base_price) * q",
    description: "$25 minimum per item, scaled by quantity",
  },
  {
    title: "ACM / 4×8 full-sheet logic",
    formula: "ceil(w / 48) * ceil(h / 96) * base_price * q",
    description: "Charge for whole 4×8 sheets — no partial credit",
  },
  {
    title: "Quantity break (10% off at 100+)",
    formula: "q >= 100 ? sqft * base_price * q * 0.9 : sqft * base_price * q",
    description: "Ternary: 90% rate when quantity ≥ 100",
  },
  {
    title: "Roll pricing (linear feet)",
    formula: "linear_feet * base_price * q",
    description: "Bill by linear footage, not sqft",
  },
  {
    title: "Sheet yield",
    formula: "ceil(q / floor((48 * 96) / (w * h))) * base_price",
    description: "Sheets needed based on nesting yield from a 4×8",
  },
];

export function FormulaSyntaxSection() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Supported Operators
        </p>
        <div className="border rounded overflow-hidden divide-y text-xs">
          {[
            { op: "+ - * / %", desc: "Arithmetic" },
            { op: "> < >= <= == !=", desc: "Comparison" },
            { op: "condition ? a : b", desc: "Ternary (if/else)" },
            { op: "( )", desc: "Grouping" },
          ].map(({ op, desc }) => (
            <div key={op} className="flex items-center px-2 py-1.5 gap-3">
              <code className="font-mono text-[11px] shrink-0">{op}</code>
              <span className="text-muted-foreground">{desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Supported Functions
        </p>
        <div className="border rounded overflow-hidden divide-y text-xs">
          {[
            { fn: "max(a, b, ...)", desc: "Largest value" },
            { fn: "min(a, b, ...)", desc: "Smallest value" },
            { fn: "ceil(x)", desc: "Round up" },
            { fn: "floor(x)", desc: "Round down" },
            { fn: "round(x)", desc: "Round to nearest" },
            { fn: "abs(x)", desc: "Absolute value" },
          ].map(({ fn, desc }) => (
            <div key={fn} className="flex items-center px-2 py-1.5 gap-3">
              <code className="font-mono text-[11px] shrink-0">{fn}</code>
              <span className="text-muted-foreground">{desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide mb-2">
          Not Supported
        </p>
        <div className="border border-amber-200 dark:border-amber-800 rounded overflow-hidden divide-y text-xs bg-amber-50/50 dark:bg-amber-950/20">
          {[
            { wrong: "Math.max()", fix: "max()" },
            { wrong: "Math.ceil()", fix: "ceil()" },
            { wrong: "||", fix: "condition ? a : b" },
            { wrong: "&&", fix: "condition ? a : b" },
            { wrong: "if / else", fix: "condition ? a : b" },
            { wrong: "x = expr", fix: "write expr directly" },
            { wrong: "function / return", fix: "single expression only" },
          ].map(({ wrong, fix }) => (
            <div key={wrong} className="flex items-center px-2 py-1.5 gap-2 flex-wrap">
              <code className="font-mono text-[11px] text-red-600 dark:text-red-400 line-through shrink-0">
                {wrong}
              </code>
              <span className="text-muted-foreground shrink-0">→</span>
              <code className="font-mono text-[11px] text-green-700 dark:text-green-400">{fix}</code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function FormulaExamplesSection({ onInsert }: { onInsert?: (formula: string) => void }) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const handleCopy = async (formula: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(formula);
      setCopiedIdx(idx);
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => setCopiedIdx(null), 1200);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="space-y-2">
      {FORMULA_EXAMPLES.map((ex, idx) => (
        <div key={idx} className="border rounded p-2 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs font-medium leading-tight">{ex.title}</span>
            <div className="flex gap-1 shrink-0">
              {onInsert && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => onInsert(ex.formula)}
                >
                  Insert
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 px-2"
                onClick={() => handleCopy(ex.formula, idx)}
                title="Copy formula"
              >
                {copiedIdx === idx ? (
                  <Check className="h-3 w-3 text-green-600" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </div>
          </div>
          <code className="block text-[11px] font-mono bg-muted px-2 py-1 rounded break-all">
            {ex.formula}
          </code>
          {ex.description && (
            <p className="text-[11px] text-muted-foreground">{ex.description}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function FormulaMistakesSection() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        PBV2 formulas are not JavaScript. These common patterns cause parser errors:
      </p>
      <div className="border rounded overflow-hidden divide-y text-xs">
        {[
          { wrong: "Math.max(a, b)", fix: "max(a, b)", note: "No Math object" },
          { wrong: "Math.ceil(x)", fix: "ceil(x)", note: "No Math object" },
          { wrong: "a || b", fix: "a ? a : b", note: "|| not supported" },
          { wrong: "a && b", fix: "a != 0 ? b : 0", note: "&& not supported" },
          { wrong: "if (q > 10) { ... }", fix: "q > 10 ? ... : 0", note: "No blocks" },
          { wrong: "result = sqft * p", fix: "sqft * p", note: "No assignment" },
          { wrong: "W * H / 144", fix: "w * h / 144", note: "Variables are lowercase" },
        ].map(({ wrong, fix, note }) => (
          <div key={wrong} className="px-2 py-2 space-y-0.5">
            <code className="font-mono text-[11px] text-red-600 dark:text-red-400 line-through block">
              {wrong}
            </code>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-muted-foreground">→</span>
              <code className="font-mono text-[11px] text-green-700 dark:text-green-400">{fix}</code>
              <span className="text-[10px] text-muted-foreground">({note})</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type HelpSection = "syntax" | "examples" | "mistakes";

const SECTION_LABELS: Record<HelpSection, string> = {
  syntax: "Syntax",
  examples: "Examples",
  mistakes: "Mistakes",
};

export function FormulaLanguageHelp({ onInsert }: { onInsert?: (formula: string) => void }) {
  const [activeSection, setActiveSection] = useState<HelpSection>("syntax");

  return (
    <div className="border rounded-md overflow-hidden bg-card">
      <div className="flex border-b">
        {(Object.keys(SECTION_LABELS) as HelpSection[]).map((section) => (
          <button
            key={section}
            type="button"
            onClick={() => setActiveSection(section)}
            className={`flex-1 px-2 py-1.5 text-[11px] font-medium transition-colors ${
              activeSection === section
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            {SECTION_LABELS[section]}
          </button>
        ))}
      </div>
      <div className="p-3 max-h-[420px] overflow-y-auto">
        {activeSection === "syntax" && <FormulaSyntaxSection />}
        {activeSection === "examples" && <FormulaExamplesSection onInsert={onInsert} />}
        {activeSection === "mistakes" && <FormulaMistakesSection />}
      </div>
    </div>
  );
}
