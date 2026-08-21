import React, { useState } from "react";
import type { ProductDraftGeneral } from "../api";
import { Cell, Picker, Toggle } from "./referencePrimitives";

/**
 * Direct composition port of the Basics panel from Lovable's
 * `_shell.product-builder.tsx`.  Its controls are deliberately restricted to
 * the canonical V2 Draft General contract; the reference-only AI parsing,
 * units and product-type fields have no V2 persistence counterparts.
 */
export function BasicsSection({
  general,
  disabled,
  onChange,
}: Readonly<{
  general: ProductDraftGeneral;
  disabled?: boolean;
  onChange: (next: ProductDraftGeneral) => void;
}>) {
  const [aiHintsOpen, setAiHintsOpen] = useState(false);
  const patch = (change: Partial<ProductDraftGeneral>) => onChange({ ...general, ...change });

  return <div className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <Cell label="Product name">
        <input className="h-8 text-[13px]" disabled={disabled} value={general.displayName} onChange={(event) => patch({ displayName: event.target.value })} />
      </Cell>
      <Cell label="Category" hint="Internal catalog grouping used by the canonical Product record.">
        <input className="h-8 text-[13px]" disabled={disabled} value={general.category ?? ""} onChange={(event) => patch({ category: event.target.value || null })} />
      </Cell>
      <Cell label="Description" className="sm:col-span-2">
        <textarea className="min-h-[60px] text-[13px]" disabled={disabled} value={general.description ?? ""} onChange={(event) => patch({ description: event.target.value || null })} />
      </Cell>
      <Cell label="Measurement mode">
        <Picker value={general.measurementMode} disabled={disabled} items={["dimensions_required", "quantity_only"] as const} onChange={(measurementMode) => patch({ measurementMode })} />
      </Cell>
      <Cell label="Workflow intent">
        <Picker value={general.workflowIntent} disabled={disabled} items={["standard_production", "fulfillment_only", "service_fee"] as const} onChange={(workflowIntent) => patch({ workflowIntent })} />
      </Cell>
    </div>

    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <Toggle label="Active in catalog" checked={general.storefrontVisible} disabled={disabled} onChange={(storefrontVisible) => patch({ storefrontVisible })} />
      <Toggle label="Service fee product" hint="No material or production usage." checked={general.workflowIntent === "service_fee"} disabled={disabled} onChange={(selected) => patch({ workflowIntent: selected ? "service_fee" : "standard_production" })} />
      <Toggle label="Requires proof" checked={general.requiresProofApproval} disabled={disabled} onChange={(requiresProofApproval) => patch({ requiresProofApproval })} />
      <Toggle label="Creates production job" checked={general.requiresProductionJob} disabled={disabled} onChange={(requiresProductionJob) => patch({ requiresProductionJob })} />
    </div>

    <div className="rounded-md border border-border">
      <button type="button" className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[12px] font-medium text-muted-foreground hover:text-foreground" aria-expanded={aiHintsOpen} onClick={() => setAiHintsOpen((open) => !open)}>
        <span aria-hidden className="text-[14px]">✦</span>
        AI parsing hints (optional)
        <span className="ml-auto" aria-hidden>{aiHintsOpen ? "⌄" : "›"}</span>
      </button>
      {aiHintsOpen && <div className="border-t border-border p-2.5"><p className="text-[12px] text-muted-foreground">Dedicated Product Draft AI parsing hints are not part of the current canonical V2 General contract. The description above remains the authoritative descriptive Product field.</p></div>}
    </div>
  </div>;
}
