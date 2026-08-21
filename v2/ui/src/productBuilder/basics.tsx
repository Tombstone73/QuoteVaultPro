import React from "react";
import type { ProductDraftGeneral } from "../api";
import { Cell, Picker, Toggle } from "./referencePrimitives";

/**
 * Direct composition port of the Basics panel from Lovable's
 * `_shell.product-builder.tsx`. Its controls are deliberately restricted to
 * the canonical V2 Draft General contract. Reference-only Shop name, Product
 * type, units, zero-dollar/tax flags, and AI parsing hints are omitted because
 * V2 has no corresponding canonical persistence contract.
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
  const patch = (change: Partial<ProductDraftGeneral>) => onChange({ ...general, ...change });

  return <div className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <Cell label="Product name">
        <input className="h-8 w-full text-[13px]" disabled={disabled} value={general.displayName} onChange={(event) => patch({ displayName: event.target.value })} />
      </Cell>
      <Cell label="Description" className="sm:col-span-2">
        <textarea className="min-h-[60px] w-full text-[13px]" disabled={disabled} value={general.description ?? ""} onChange={(event) => patch({ description: event.target.value || null })} />
      </Cell>
      <Cell label="Category">
        <input className="h-8 w-full text-[13px]" disabled={disabled} value={general.category ?? ""} onChange={(event) => patch({ category: event.target.value || null })} />
      </Cell>
      <Cell label="Measurement mode">
        <Picker value={general.measurementMode} disabled={disabled} items={["dimensions_required", "quantity_only"] as const} onChange={(measurementMode) => patch({ measurementMode })} />
      </Cell>
      <Cell label="Workflow intent">
        <Picker value={general.workflowIntent} disabled={disabled} items={["standard_production", "fulfillment_only", "service_fee"] as const} onChange={(workflowIntent) => patch({ workflowIntent })} />
      </Cell>
      <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2 lg:grid-cols-3">
        <Toggle label="Active in catalog" checked={general.storefrontVisible} disabled={disabled} onChange={(storefrontVisible) => patch({ storefrontVisible })} />
        <Toggle label="Service fee product" hint="No material or production usage." checked={general.workflowIntent === "service_fee"} disabled={disabled} onChange={(selected) => patch({ workflowIntent: selected ? "service_fee" : "standard_production" })} />
        <Toggle label="Requires proof" checked={general.requiresProofApproval} disabled={disabled} onChange={(requiresProofApproval) => patch({ requiresProofApproval })} />
        <Toggle label="Creates production job" checked={general.requiresProductionJob} disabled={disabled} onChange={(requiresProductionJob) => patch({ requiresProductionJob })} />
      </div>
    </div>
  </div>;
}
