import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Info } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  PBV2_PRICING_VARIABLE_CATEGORY_ORDER,
  PBV2_PRICING_VARIABLES,
  type PricingVariableCategory,
  type PricingVariableDefinition,
} from "@shared/pbv2/pricingVariableRegistry";

export function PricingVariableHelper() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const timeoutRef = useRef<number | null>(null);

  const variablesQuery = useQuery({
    queryKey: ["pbv2PricingPreviewVariables"],
    queryFn: async () => {
      const res = await fetch("/api/pbv2/pricing-preview/variables", {
        method: "GET",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load pricing variables");
      const json = await res.json();
      return (json?.data ?? []) as PricingVariableDefinition[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const variables = variablesQuery.data && variablesQuery.data.length > 0
    ? variablesQuery.data
    : PBV2_PRICING_VARIABLES;

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const filtered = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase();
    if (!normalized) return variables;
    return variables.filter((item) => {
      return (
        item.key.toLowerCase().includes(normalized) ||
        item.label.toLowerCase().includes(normalized) ||
        item.description.toLowerCase().includes(normalized) ||
        item.category.toLowerCase().includes(normalized) ||
        item.aliases.some((alias) => alias.toLowerCase().includes(normalized))
      );
    });
  }, [searchTerm, variables]);

  const grouped = useMemo(() => {
    const byCategory = new Map<PricingVariableCategory, typeof filtered>();
    for (const category of PBV2_PRICING_VARIABLE_CATEGORY_ORDER) {
      byCategory.set(category, []);
    }
    for (const item of filtered) {
      const current = byCategory.get(item.category) ?? [];
      current.push(item);
      byCategory.set(item.category, current);
    }
    return PBV2_PRICING_VARIABLE_CATEGORY_ORDER
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

  const helperText = "Use lowercase variable names such as w, h, q, sqft, total_sqft, and base_price. Use ceil(...), round(...), and max(...), not Math.ceil(...).";

  return (
    <div className="min-w-0 w-full rounded-md border border-slate-700 bg-slate-800/40 px-2 py-1">
      <Accordion type="single" collapsible className="w-full min-w-0">
        <AccordionItem value="pricing-variables" className="border-b-0">
          <AccordionTrigger className="py-2 text-xs text-slate-300 hover:no-underline">
            Available Pricing Variables
          </AccordionTrigger>
          <AccordionContent className="pt-1">
            <div className="px-1 pb-2 text-[11px] text-slate-400">
              {helperText}
            </div>
            <div
              className="max-h-[220px] overflow-y-auto overscroll-contain pr-1"
              tabIndex={0}
              role="region"
              aria-label="Available pricing variables"
              onWheelCapture={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 z-10 bg-slate-800/95 backdrop-blur supports-[backdrop-filter]:bg-slate-800/80 px-1 pb-2 pt-1">
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search variables…"
                  className="h-8 bg-slate-950/60 border-slate-700/60 text-xs"
                />
              </div>

              <TooltipProvider>
                <div className="space-y-2">
                {grouped.length === 0 ? (
                  <div className="px-2 py-3 text-[11px] text-slate-400">No variables match your search.</div>
                ) : (
                  grouped.map((group) => (
                    <div key={group.category} className="space-y-1">
                      <div className="px-1 text-[10px] uppercase tracking-wide text-slate-400">{group.category}</div>
                      {group.entries.map((variable) => (
                        <div
                          key={variable.key}
                          className="w-full min-w-0 rounded-sm border border-slate-700/70 bg-slate-900/50 px-2 py-1"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex items-center gap-1.5">
                              <div className="text-xs font-medium text-slate-100">{variable.label}</div>
                              <button
                                type="button"
                                onClick={() => handleCopy(variable.key)}
                                className="inline-flex items-center gap-1 rounded border border-slate-700/70 px-1.5 py-0.5 text-[10px] text-blue-300 hover:text-blue-200"
                                aria-label={`Copy key ${variable.key}`}
                              >
                                <Copy className="h-3 w-3" />
                                Copy key
                              </button>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className="inline-flex h-4 w-4 items-center justify-center rounded text-slate-400 hover:text-slate-200"
                                    aria-label={`Variable help for ${variable.label}`}
                                  >
                                    <Info className="h-3.5 w-3.5" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-[280px] text-xs">
                                  <div>{variable.description}</div>
                                  {typeof variable.example !== "undefined" ? (
                                    <div className="mt-1 text-[11px] opacity-80">Example value: {String(variable.example)}</div>
                                  ) : null}
                                </TooltipContent>
                              </Tooltip>
                            </div>
                            <span className="shrink-0 text-[10px] text-emerald-400">
                              {copiedKey === variable.key || (copiedKey != null && variable.aliases.includes(copiedKey)) ? "Copied" : ""}
                            </span>
                          </div>
                          <div className="mt-1 text-[10px] text-slate-400 font-mono break-all">
                            {variable.key}
                            {variable.aliases.length > 0 ? " · " : ""}
                            {variable.aliases.length > 0 ? (
                              <>
                                aliases:
                                {" "}
                                {variable.aliases.map((alias, idx) => (
                                  <button
                                    key={alias}
                                    type="button"
                                    onClick={() => handleCopy(alias)}
                                    className="text-blue-300 hover:text-blue-200"
                                  >
                                    {idx > 0 ? ", " : ""}
                                    {alias}
                                  </button>
                                ))}
                              </>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))
                )}
                </div>
              </TooltipProvider>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}