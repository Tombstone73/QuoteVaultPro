import { useState } from "react";
import { CloseJobOverrideAction, CloseJobOverrideDialog, type CloseJobOverrideTarget } from "@/components/orders/CloseJobOverrideDialog";

/** Presentation adapter only: the shared preview, acknowledgement and Order operation own the decision. */
export function FulfillmentProductionOverride({ canOverride, ...target }: CloseJobOverrideTarget & { canOverride: boolean }) {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  if (!canOverride) return null;
  return <>
    <CloseJobOverrideAction target={target} isAdminOrOwner={canOverride} productionOnly label="Production Completion Override" onOpen={() => setSelectedOrderId(target.orderId)} />
    {selectedOrderId === target.orderId && <CloseJobOverrideDialog productionOnly target={target} onOpenChange={open => { if (!open) setSelectedOrderId(null); }} />}
  </>;
}
