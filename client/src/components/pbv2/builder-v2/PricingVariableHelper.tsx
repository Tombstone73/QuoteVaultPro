import { useEffect, useMemo, useRef, useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  PRICING_VARIABLE_CATALOG,
  PRICING_VARIABLE_CATEGORY_ORDER,
  type PricingVariableCategory,
} from "@/lib/pbv2/pricing/pricingVariableCatalog";

export function PricingVariableHelper() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const filtered = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase();
    if (!normalized) return PRICING_VARIABLE_CATALOG;
    return PRICING_VARIABLE_CATALOG.filter((item) => {
      return (
        item.key.toLowerCase().includes(normalized) ||
        item.label.toLowerCase().includes(normalized) ||
        item.description.toLowerCase().includes(normalized) ||
        item.category.toLowerCase().includes(normalized)
      );
    });
  }, [searchTerm]);

  const grouped = useMemo(() => {
    const byCategory = new Map<PricingVariableCategory, typeof filtered>();
    for (const category of PRICING_VARIABLE_CATEGORY_ORDER) {
      byCategory.set(category, []);
    }
    for (const item of filtered) {
      const current = byCategory.get(item.category) ?? [];
      current.push(item);
      byCategory.set(item.category, current);
    }
    return PRICING_VARIABLE_CATEGORY_ORDER
      .map((category) => ({ category, entries: byCategory.get(category) ?? [] }))
      .filter((group) => group.entries.length > 0);
  }, [filtered]);

  const handleCopy = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopiedKey(key);
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = window.setTimeout(() => {
        setCopiedKey(null);
      }, 1200);
    } catch {
      setCopiedKey(null);
    }
  };

  return (
    <div className="min-w-0 w-full rounded-md border border-slate-700 bg-slate-800/40 px-2 py-1">
      <Accordion type="single" collapsible defaultValue="pricing-variables" className="w-full min-w-0">
        <AccordionItem value="pricing-variables" className="border-b-0">
          <AccordionTrigger className="py-2 text-xs text-slate-300 hover:no-underline">
            Available Pricing Variables
          </AccordionTrigger>
          <AccordionContent className="pt-1">
            <div className="px-1 pb-2">
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search variables…"
                className="h-8 bg-slate-950/60 border-slate-700/60 text-xs"
              />
            </div>
            <ScrollArea className="max-h-[200px] w-full min-w-0">
              <div className="space-y-2 pr-1">
                {grouped.length === 0 ? (
                  <div className="px-2 py-3 text-[11px] text-slate-400">No variables match your search.</div>
                ) : (
                  grouped.map((group) => (
                    <div key={group.category} className="space-y-1">
                      <div className="px-1 text-[10px] uppercase tracking-wide text-slate-400">{group.category}</div>
                      {group.entries.map((variable) => (
                        <div
                          key={variable.key}
                          className="w-full min-w-0 rounded-sm border border-slate-700/70 bg-slate-900/50 px-2 py-1.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-xs font-medium text-slate-100">{variable.label}</div>
                              <button
                                type="button"
                                onClick={() => handleCopy(variable.key)}
                                className="font-mono text-[11px] text-blue-300 hover:text-blue-200"
                              >
                                {variable.key}
                              </button>
                            </div>
                            <span className="shrink-0 text-[10px] text-emerald-400">
                              {copiedKey === variable.key ? "Copied" : ""}
                            </span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-400">{variable.description}</div>
                          {typeof variable.example !== "undefined" ? (
                            <div className="mt-0.5 text-[10px] text-slate-500">Example: {String(variable.example)}</div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}