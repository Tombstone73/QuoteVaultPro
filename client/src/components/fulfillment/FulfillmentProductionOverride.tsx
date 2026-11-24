import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FulfillmentProductionOverrideLine, FulfillmentProductionOverrideRequest } from "@shared/fulfillmentProductionOverride";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiCall, invalidateFulfillment, toFulfillmentError } from "@/hooks/useFulfillment";

type Target = { orderId: string; orderNumber: string };

export function FulfillmentProductionOverride({ canOverride, ...target }: Target & { canOverride: boolean }) {
  const [open, setOpen] = useState(false);
  if (!canOverride) return null;
  return <>
    <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>Production Completion Override</Button>
    {open && <ProductionOverrideDialog key={target.orderId} {...target} onClose={() => setOpen(false)} />}
  </>;
}

function ProductionOverrideDialog({ orderId, orderNumber, onClose }: Target & { onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const path = `/api/fulfillment/orders/${orderId}/production-override`;
  const preview = useQuery({
    queryKey: ["fulfillment", "production-override", orderId],
    queryFn: ({ signal }) => apiCall<FulfillmentProductionOverrideLine[]>(path, { signal }),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ReturnType<typeof toFulfillmentError> | null>(null);
  const inFlight = useRef(false);
  const request = useRef<{ selection: string; id: string } | null>(null);
  const lines = preview.data ?? [];
  const quantityFor = (line: FulfillmentProductionOverrideLine) => quantities[line.lineItemId] ?? String(line.maximumQuantity);
  const selected = lines.filter(line => !excluded[line.lineItemId]);
  const invalid = selected.some(line => {
    const quantity = Number(quantityFor(line));
    return !Number.isInteger(quantity) || quantity < 1 || quantity > line.maximumQuantity;
  });

  const complete = async () => {
    if (inFlight.current || preview.isFetching || preview.isError || !selected.length || invalid) return;
    const items = selected.map(line => ({
      lineItemId: line.lineItemId, quantity: Number(quantityFor(line)), revision: line.revision,
    }));
    const selection = JSON.stringify(items);
    if (request.current?.selection !== selection) request.current = { selection, id: crypto.randomUUID() };
    const payload: FulfillmentProductionOverrideRequest = { clientRequestId: request.current.id, items };
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await apiCall(path, { method: "POST", body: JSON.stringify(payload) });
      invalidateFulfillment(queryClient, orderId);
      void queryClient.invalidateQueries({ queryKey: ["fulfillment", "shipment"] });
      toast({ title: "Selected quantities are ready for fulfillment" });
      onClose();
    } catch (cause) {
      setError(toFulfillmentError(cause));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return <Dialog open onOpenChange={next => { if (!next && !inFlight.current) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Production Completion Override</DialogTitle>
        <DialogDescription>Confirm the finished units for Order #{orderNumber}. Selected units become ready to ship or pick up.</DialogDescription>
      </DialogHeader>
      {preview.isFetching && <p role="status" className="text-sm text-muted-foreground">Checking production and ready quantities…</p>}
      {preview.isError && <p role="alert" className="text-sm text-destructive">{toFulfillmentError(preview.error).message}</p>}
      {!preview.isFetching && !preview.isError && lines.length === 0 &&
        <p className="text-sm text-muted-foreground">No units are eligible for this override. Record any outstanding station or run work in Production.</p>}
      <div className="divide-y">
        {lines.map(line => <div key={line.lineItemId} className="grid gap-2 py-3 sm:grid-cols-[1fr_10rem]">
          <div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={!excluded[line.lineItemId]}
                disabled={submitting} onChange={event => setExcluded(previous => ({ ...previous, [line.lineItemId]: !event.target.checked }))} />
              {line.name}
            </label>
            <p className="mt-1 pl-6 text-xs text-muted-foreground">
              Ordered {line.orderedQuantity}{line.productionRequired
                ? ` · Previously completed ${line.productionCompleteQuantity} · Outstanding ${line.outstandingQuantity}`
                : " · No production required"}
            </p>
          </div>
          <label className="grid gap-1 text-xs font-medium">
            Quantity to make ready
            <Input type="number" min={1} max={line.maximumQuantity} step={1} value={quantityFor(line)}
              aria-label={`Quantity to make ready for ${line.name}`} disabled={submitting || !!excluded[line.lineItemId]}
              onChange={event => setQuantities(previous => ({ ...previous, [line.lineItemId]: event.target.value }))} />
          </label>
        </div>)}
      </div>
      {invalid && <p role="alert" className="text-sm text-destructive">Enter a whole quantity within the available range for each selected line.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
      <DialogFooter>
        {preview.isError && <Button variant="outline" onClick={() => void preview.refetch()}>Refresh quantities</Button>}
        <Button variant="outline" disabled={submitting} onClick={onClose}>Cancel</Button>
        <Button aria-busy={submitting} disabled={submitting || preview.isError || preview.isFetching || !selected.length || invalid}
          onClick={() => void complete()}>{submitting ? "Completing…" : "Complete Selected"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
