import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { toFulfillmentError, useCompleteProductionFromFulfillmentMutation, type FulfillmentDetail } from "@/hooks/useFulfillment";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

type Line = FulfillmentDetail["lineItems"][number];

export function canOfferFulfillmentProductionCompletion(line: Line, canConfirm: boolean): boolean {
  const production = line.production;
  return canConfirm && production.productionRequired &&
    production.productionCompleteQuantity < production.orderedQuantity &&
    !!production.activeOwnerJobId &&
    !["fulfillment", "prepress", "design", "proofing"].includes(String(production.stationKey || "").toLowerCase()) &&
    !["done", "void", "canceled", "cancelled"].includes(String(production.activeOwnerStatus || "").toLowerCase());
}

export function FulfillmentProductionCompletion({ orderId, line, onCompleted }: {
  orderId: string;
  line: Line;
  onCompleted?: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const mutation = useCompleteProductionFromFulfillmentMutation(orderId);
  const remainingProduction = Math.max(0, line.production.orderedQuantity - line.production.productionCompleteQuantity);
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(remainingProduction);
  const [clientRequestId, setClientRequestId] = useState<string | null>(null);
  const isPartial = quantity !== remainingProduction;

  const begin = () => {
    setQuantity(remainingProduction);
    setClientRequestId(crypto.randomUUID());
    setOpen(true);
  };
  const confirm = async () => {
    if (!clientRequestId || !line.production.activeOwnerJobId || isPartial || mutation.isPending) return;
    try {
      const saved = await mutation.mutateAsync({ lineItemId: line.id, jobId: line.production.activeOwnerJobId,
        quantity, clientRequestId });
      setOpen(false);
      toast({ title: "Production completed", description: `${saved.lineItems.find((item) => item.id === line.id)?.production.readyWaitingQuantity ?? 0} ready for fulfillment.` });
      await onCompleted?.();
    } catch (error) {
      // Keep the operation ID so a retry can read back a write whose response failed.
      toast({ title: "Could not complete production", description: toFulfillmentError(error).message, variant: "destructive" });
    }
  };

  return <>
    <Button type="button" variant="outline" size="sm" onClick={begin}>Mark Ready for Fulfillment</Button>
    <AlertDialog open={open} onOpenChange={(next) => { if (!mutation.isPending) setOpen(next); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Mark Ready for Fulfillment</AlertDialogTitle>
          <AlertDialogDescription>Confirm the quantity physically completed for {line.productName || line.description || "this order line"}. This records production completion and makes finished units available for shipment or pickup.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 text-sm">
          <p>Ordered: {line.production.orderedQuantity}</p>
          <p>Production complete: {line.production.productionCompleteQuantity}</p>
          <p>Remaining production: {remainingProduction}</p>
          <p>Ready for fulfillment: {line.production.readyWaitingQuantity}</p>
          <p>Available for new allocation: {line.production.availableForAllocationQuantity ?? line.production.readyWaitingQuantity}</p>
          <label className="block font-medium" htmlFor={`fulfillment-production-quantity-${line.id}`}>Physically completed now</label>
          <Input id={`fulfillment-production-quantity-${line.id}`} type="number" min={1} max={remainingProduction} step={1}
            value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} />
          {isPartial && <p className="text-amber-700">Partial standalone production completion is not supported. Record partial quantities through the Production run workflow.</p>}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
          <Button type="button" disabled={mutation.isPending || isPartial || !Number.isInteger(quantity) || quantity <= 0}
            onClick={() => void confirm()}>{mutation.isPending ? "Saving…" : "Confirm completion"}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
