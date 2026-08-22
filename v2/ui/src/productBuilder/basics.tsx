import { Sparkles } from "lucide-react";
import React from "react";
import type { ProductDraftGeneral } from "../api";
import { Cell, Disclosure, Picker, Toggle } from "./referencePrimitives";

/**
 * Direct composition port of the Basics panel from Lovable's
 * `_shell.product-builder.tsx`. Fields outside the canonical V2 Draft General
 * contract remain visibly present in their approved reference positions, but
 * are explicitly read-only until their owning contracts exist.
 */
export function BasicsSection({
  general,
  productTypeLabel,
  disabled,
  onChange,
}: Readonly<{
  general: ProductDraftGeneral;
  /** Canonical catalog read-model label. Product type has no Draft mutation contract. */
  productTypeLabel?: string | null;
  disabled?: boolean;
  onChange: (next: ProductDraftGeneral) => void;
}>) {
  const patch = (change: Partial<ProductDraftGeneral>) => onChange({ ...general, ...change });
  const unsupportedReason = "Not available in the canonical V2 Draft contract.";
  const productType = productTypeLabel?.trim() || "Not available in V2";

  return <div className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <Cell label="Product name">
        <input className="h-8 w-full text-[0.8125rem]" disabled={disabled} value={general.displayName} onChange={(event) => patch({ displayName: event.target.value })} />
      </Cell>
      <Cell label="Shop name" hint="Short internal name shown in queues and station screens. This field is not yet available in V2.">
        <input className="h-8 w-full text-[0.8125rem]" disabled placeholder="Not available in V2" aria-label="Shop name is not available in V2" />
      </Cell>
      <Cell label="Description" className="sm:col-span-2">
        <textarea className="min-h-[60px] w-full text-[0.8125rem]" disabled={disabled} value={general.description ?? ""} onChange={(event) => patch({ description: event.target.value || null })} />
      </Cell>
      <Cell label="Category">
        <input className="h-8 w-full text-[0.8125rem]" disabled={disabled} value={general.category ?? ""} onChange={(event) => patch({ category: event.target.value || null })} />
      </Cell>
      <Cell label="Product type" hint="Drives sheet yield and usage math. Product type is read-only in V2.">
        <Picker value={productType} disabled items={[productType]} onChange={() => undefined} />
      </Cell>
      <Cell label="Measurement mode">
        <Picker value={general.measurementMode} disabled={disabled} items={["dimensions_required", "quantity_only"] as const} onChange={(measurementMode) => patch({ measurementMode })} />
      </Cell>
      <Cell label="Workflow intent">
        <Picker value={general.workflowIntent} disabled={disabled} items={["standard_production", "fulfillment_only", "service_fee"] as const} onChange={(workflowIntent) => patch({ workflowIntent })} />
      </Cell>
      <Cell label="Units" hint="The canonical V2 Product Draft does not expose a units preference.">
        <Picker value="Not available in V2" disabled items={["Not available in V2"] as const} onChange={() => undefined} />
      </Cell>
      <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2 lg:grid-cols-3">
        <Toggle label="Active in catalog" checked={general.storefrontVisible} disabled={disabled} onChange={(storefrontVisible) => patch({ storefrontVisible })} />
        <Toggle label="Service fee product" hint="No material or production usage." checked={general.workflowIntent === "service_fee"} disabled={disabled} onChange={(selected) => patch({ workflowIntent: selected ? "service_fee" : "standard_production" })} />
        <Toggle label="Requires proof" checked={general.requiresProofApproval} disabled={disabled} onChange={(requiresProofApproval) => patch({ requiresProofApproval })} />
        <Toggle label="Creates production job" checked={general.requiresProductionJob} disabled={disabled} onChange={(requiresProductionJob) => patch({ requiresProductionJob })} />
        <Toggle label="Allow $0.00 lines" checked={false} disabled disabledReason={unsupportedReason} onChange={() => undefined} />
        <Toggle label="Taxable" checked={false} disabled disabledReason={unsupportedReason} onChange={() => undefined} />
      </div>
    </div>
    <Disclosure label="AI parsing hints (optional)" icon={<Sparkles className="size-3.5" />}>
      <div className="space-y-2.5">
        <p className="text-[0.75rem] text-muted-foreground">Only used when inbound email and RFQ text is matched to catalog products. Not required to publish.</p>
        <Toggle label="Use the customer-facing description" hint={unsupportedReason} checked={false} disabled onChange={() => undefined} />
        <textarea className="min-h-[76px] w-full text-[0.8125rem]" disabled placeholder="Not available in V2" aria-label="Dedicated AI parsing description is not available in V2" />
      </div>
    </Disclosure>
  </div>;
}
