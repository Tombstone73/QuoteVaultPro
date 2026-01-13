import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

import type { RefContext } from "@shared/pbv2/refContract";
import type { SymbolTable } from "@shared/pbv2/symbolTable";
import type { VariableCatalogItem } from "@shared/pbv2/variableCatalog";
import { validateFormulaJson } from "@shared/pbv2/formulaValidation";

type Props = {
  valueText: string;
  onChangeText: (next: string) => void;
  context: RefContext;
  variableCatalog: VariableCatalogItem[];
  symbolTable: SymbolTable;
  label?: string;
  disabled?: boolean;
};

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
}

function formatSnippet(item: VariableCatalogItem): string {
  return JSON.stringify(item.insert, null, 2);
}

export default function FormulaEditor({
  valueText,
  onChangeText,
  context,
  variableCatalog,
  symbolTable,
  label,
  disabled,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [search, setSearch] = useState<string>("");

  const parsed = useMemo(() => {
    const t = (valueText ?? "").trim();
    if (!t) return { ok: false as const, error: "Empty" };
    return tryParseJson(t);
  }, [valueText]);

  const validation = useMemo(() => {
    if (!parsed.ok) return null;
    return validateFormulaJson(parsed.value, context, symbolTable, { pathBase: "expr" });
  }, [parsed, context, symbolTable]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const allowed = new Set<RefContext>([context]);
    return variableCatalog
      .filter((v) => v.allowedContexts.some((c) => allowed.has(c)))
      .filter((v) => {
        if (!q) return true;
        return v.key.toLowerCase().includes(q) || v.label.toLowerCase().includes(q);
      });
  }, [search, variableCatalog, context]);

  const insertAtCursor = (snippet: string) => {
    const el = textareaRef.current;
    if (!el) {
      onChangeText((valueText || "") + snippet);
      return;
    }

    const start = el.selectionStart ?? (valueText || "").length;
    const end = el.selectionEnd ?? start;
    const before = (valueText || "").slice(0, start);
    const after = (valueText || "").slice(end);

    const glueLeft = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
    const glueRight = after.length > 0 && !after.startsWith("\n") ? "\n" : "";

    const next = before + glueLeft + snippet + glueRight + after;
    onChangeText(next);

    // restore focus
    requestAnimationFrame(() => {
      try {
        el.focus();
        const cursor = (before + glueLeft + snippet).length;
        el.setSelectionRange(cursor, cursor);
      } catch {
        // ignore
      }
    });
  };

  useEffect(() => {
    // If field is empty, bootstrap with an empty object to make edits easier.
    if (!valueText.trim() && !disabled) {
      onChangeText("{}\n");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const errors = validation?.errors ?? [];
  const warnings = validation?.warnings ?? [];
  const ok = validation ? validation.ok : false;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          {label ? <Label className="text-sm">{label}</Label> : null}
          <div className="text-xs text-muted-foreground">Context: {context}</div>
        </div>
        {validation ? (
          ok ? (
            <Badge variant="outline">OK</Badge>
          ) : (
            <Badge variant="destructive">Invalid</Badge>
          )
        ) : (
          <Badge variant="secondary">Not validated</Badge>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-2">
          <Textarea
            ref={textareaRef}
            value={valueText}
            onChange={(e) => onChangeText(e.target.value)}
            className="font-mono text-xs min-h-[180px]"
            disabled={disabled}
          />
          {!parsed.ok && valueText.trim().length > 0 ? (
            <div className="text-xs text-destructive">{parsed.error}</div>
          ) : null}
        </div>

        <div className="rounded-md border border-border p-2">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs text-muted-foreground">Variables</Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="h-8 w-[180px] text-xs"
              disabled={disabled}
            />
          </div>
          <Separator className="my-2" />
          <ScrollArea className="h-[170px]">
            <div className="space-y-1">
              {filtered.length === 0 ? (
                <div className="text-xs text-muted-foreground">No variables match.</div>
              ) : (
                filtered.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    className="w-full text-left rounded-md px-2 py-1 hover:bg-accent text-xs"
                    disabled={disabled}
                    onClick={() => insertAtCursor(formatSnippet(v))}
                  >
                    <div className="font-mono">{v.key}</div>
                    <div className="text-muted-foreground">{v.label}</div>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {validation ? (
        <div className="space-y-1">
          {errors.length === 0 && warnings.length === 0 ? (
            <div className="text-xs text-muted-foreground">No findings.</div>
          ) : (
            <div className="space-y-1">
              {errors.map((f, i) => (
                <div key={`e-${i}`} className="text-xs text-destructive">
                  {f.code}: {f.message}
                </div>
              ))}
              {warnings.map((f, i) => (
                <div key={`w-${i}`} className="text-xs text-muted-foreground">
                  {f.code}: {f.message}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
