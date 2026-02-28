import { useRef, useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PRICING_VARIABLES } from "./pricingVariables";

export function PricingVariableHelper() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timeoutRef = useRef<number | null>(null);

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
            <ScrollArea className="max-h-[200px] w-full min-w-0">
              <div className="space-y-1 pr-1">
                {PRICING_VARIABLES.map((variable) => (
                  <button
                    key={variable.key}
                    type="button"
                    onClick={() => handleCopy(variable.key)}
                    className="flex w-full min-w-0 items-start justify-between gap-2 rounded-sm border border-slate-700/70 bg-slate-900/50 px-2 py-1.5 text-left hover:bg-slate-900"
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-slate-100">{variable.key}</div>
                      <div className="text-[11px] text-slate-400">{variable.description}</div>
                    </div>
                    <span className="shrink-0 text-[10px] text-emerald-400">
                      {copiedKey === variable.key ? "Copied" : ""}
                    </span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}