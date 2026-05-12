import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FormulaSyntaxSection,
  FormulaExamplesSection,
  FormulaMistakesSection,
} from "@/components/pbv2/FormulaLanguageHelp";
import {
  PBV2_PRICING_VARIABLES,
  PBV2_PRICING_VARIABLE_CATEGORY_ORDER,
  type PricingVariableCategory,
  type PricingVariableDefinition,
} from "@shared/pbv2/pricingVariableRegistry";
import { PBV2_PRICING_FUNCTIONS, type PricingFunctionDefinition } from "@shared/pbv2/pricingFunctionCatalog";

type FormulaReferenceResponse = {
  success?: boolean;
  data?: {
    supportedVariables?: PricingVariableDefinition[];
    supportedFunctions?: PricingFunctionDefinition[];
  };
};

interface FormulaReferenceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsertText?: (text: string) => void;
}

export function FormulaReferenceModal({ open, onOpenChange, onInsertText }: FormulaReferenceModalProps) {
  const [activeTab, setActiveTab] = useState<"variables" | "functions" | "syntax" | "examples" | "mistakes">("variables");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [variableSearch, setVariableSearch] = useState("");
  const [functionSearch, setFunctionSearch] = useState("");
  const copiedTimeoutRef = useRef<number | null>(null);

  const referenceQuery = useQuery({
    queryKey: ["pbv2FormulaReference"],
    queryFn: async () => {
      const res = await fetch("/api/pbv2/pricing-preview/reference", {
        method: "GET",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load formula reference");
      const json = (await res.json()) as FormulaReferenceResponse;
      return {
        supportedVariables: json?.data?.supportedVariables ?? PBV2_PRICING_VARIABLES,
        supportedFunctions: json?.data?.supportedFunctions ?? PBV2_PRICING_FUNCTIONS,
      };
    },
    staleTime: 5 * 60 * 1000,
  });

  const supportedVariables = referenceQuery.data?.supportedVariables ?? PBV2_PRICING_VARIABLES;
  const supportedFunctions = referenceQuery.data?.supportedFunctions ?? PBV2_PRICING_FUNCTIONS;

  const groupedVariables = useMemo(() => {
    const normalized = variableSearch.trim().toLowerCase();
    const filtered = !normalized
      ? supportedVariables
      : supportedVariables.filter((item) => {
          return (
            item.label.toLowerCase().includes(normalized) ||
            item.key.toLowerCase().includes(normalized) ||
            item.aliases.some((alias) => alias.toLowerCase().includes(normalized)) ||
            item.description.toLowerCase().includes(normalized)
          );
        });

    const byCategory = new Map<PricingVariableCategory, PricingVariableDefinition[]>();
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
  }, [supportedVariables, variableSearch]);

  const filteredFunctions = useMemo(() => {
    const normalized = functionSearch.trim().toLowerCase();
    if (!normalized) return supportedFunctions;
    return supportedFunctions.filter((fn) => {
      return (
        fn.key.toLowerCase().includes(normalized) ||
        fn.signature.toLowerCase().includes(normalized) ||
        fn.description.toLowerCase().includes(normalized) ||
        fn.example.toLowerCase().includes(normalized)
      );
    });
  }, [supportedFunctions, functionSearch]);

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(value);
      if (copiedTimeoutRef.current) {
        window.clearTimeout(copiedTimeoutRef.current);
      }
      copiedTimeoutRef.current = window.setTimeout(() => setCopiedKey(null), 1200);
    } catch {
      setCopiedKey(null);
    }
  };

  const renderInsertButton = (text: string) => {
    if (!onInsertText) return null;
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-6 px-2 text-[10px]"
        onClick={() => onInsertText(text)}
      >
        Insert
      </Button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[min(900px,95vw)] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Formula Reference</DialogTitle>
          <div className="text-sm text-muted-foreground">
            Use lowercase variable names such as w, h, q, sqft, total_sqft, and base_price. Use formula functions like ceil(...), round(...), and max(...), not Math.ceil(...).
          </div>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "variables" | "functions" | "syntax" | "examples" | "mistakes")} className="w-full flex-1 min-h-0 flex flex-col">
          <div className="shrink-0">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="variables" className="text-xs px-1">Variables</TabsTrigger>
              <TabsTrigger value="functions" className="text-xs px-1">Functions</TabsTrigger>
              <TabsTrigger value="syntax" className="text-xs px-1">Syntax</TabsTrigger>
              <TabsTrigger value="examples" className="text-xs px-1">Examples</TabsTrigger>
              <TabsTrigger value="mistakes" className="text-xs px-1">Mistakes</TabsTrigger>
            </TabsList>
          </div>

          {(activeTab === "variables" || activeTab === "functions") && (
            <div className="shrink-0 mt-3 pb-2">
              {activeTab === "variables" ? (
                <Input
                  value={variableSearch}
                  onChange={(e) => setVariableSearch(e.target.value)}
                  placeholder="Search variables"
                  className="h-8"
                />
              ) : (
                <Input
                  value={functionSearch}
                  onChange={(e) => setFunctionSearch(e.target.value)}
                  placeholder="Search functions"
                  className="h-8"
                />
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto overscroll-contain pr-2 min-h-0 mt-3">
            {activeTab === "variables" && (
              <div className="space-y-3 pb-1">
                {groupedVariables.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No matching variables.</div>
                ) : (
                  groupedVariables.map((group) => (
                    <div key={group.category} className="space-y-1">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{group.category}</div>
                      {group.entries.map((item) => (
                        <div key={item.key} className="rounded border border-border p-2 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-medium">{item.label}</div>
                            <div className="flex items-center gap-1">
                              <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => handleCopy(item.key)}>
                                Copy key
                              </Button>
                              {renderInsertButton(item.key)}
                            </div>
                          </div>
                          <div className="text-xs font-mono text-muted-foreground break-all">
                            {item.key}
                            {item.aliases.length > 0 ? (
                              <>
                                {" · aliases: "}
                                {item.aliases.map((alias, idx) => (
                                  <button key={alias} type="button" className="underline-offset-2 hover:underline" onClick={() => handleCopy(alias)}>
                                    {idx > 0 ? ", " : ""}
                                    {alias}
                                  </button>
                                ))}
                              </>
                            ) : null}
                          </div>
                          <div className="text-xs text-muted-foreground">{item.description}</div>
                          {typeof item.example !== "undefined" ? (
                            <div className="text-[11px] text-muted-foreground">Example: {String(item.example)}</div>
                          ) : null}
                          {(copiedKey === item.key || item.aliases.includes(copiedKey || "")) ? (
                            <div className="text-[10px] text-emerald-500">Copied</div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === "functions" && (
              <div className="space-y-2 pb-1">
                {filteredFunctions.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No matching functions.</div>
                ) : (
                  filteredFunctions.map((fn) => (
                    <div key={fn.key} className="rounded border border-border p-2 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-mono text-sm">{fn.signature}</div>
                        <div className="flex items-center gap-1">
                          <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => handleCopy(fn.signature)}>
                            Copy
                          </Button>
                          {renderInsertButton(fn.key + "()")}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">{fn.description}</div>
                      <div className="text-[11px] text-muted-foreground">Example: {fn.example}</div>
                      {copiedKey === fn.signature ? <div className="text-[10px] text-emerald-500">Copied</div> : null}
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === "syntax" && (
              <div className="pb-1">
                <FormulaSyntaxSection />
              </div>
            )}

            {activeTab === "examples" && (
              <div className="pb-1">
                <FormulaExamplesSection onInsert={onInsertText} />
              </div>
            )}

            {activeTab === "mistakes" && (
              <div className="pb-1">
                <FormulaMistakesSection />
              </div>
            )}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
