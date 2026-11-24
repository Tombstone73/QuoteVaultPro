import { useRef, useState } from "react";
import type { FulfillmentStockAvailability } from "@shared/fulfillmentReadiness";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiCall, toFulfillmentError } from "@/hooks/useFulfillment";

export function StockFulfillmentSummary({ stock, orderId, lineItemId, itemName, remainingQuantity, readyQuantity,
  eligibleQuantity, reservedHere = 0, canConfirm, onConfirmed }: {
  stock: FulfillmentStockAvailability;
  orderId: string;
  lineItemId: string;
  itemName: string;
  remainingQuantity: number;
  readyQuantity: number;
  eligibleQuantity: number;
  reservedHere?: number;
  canConfirm: boolean;
  onConfirmed: () => void | Promise<void>;
}) {
  const [quantityInput, setQuantityInput] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRequest = useRef<{ quantity: number; id: string }>();
  const inFlight = useRef(false);
  const maximum = Math.max(0, remainingQuantity - readyQuantity);
  const quantity = Number(quantityInput ?? maximum);
  const confirm = async () => {
    if (inFlight.current || quantity < 1 || quantity > maximum || !Number.isInteger(quantity)) return;
    if (pendingRequest.current?.quantity !== quantity) pendingRequest.current = { quantity, id: crypto.randomUUID() };
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      await apiCall(`/api/fulfillment/orders/${orderId}/ready-quantities`, { method: "POST", body: JSON.stringify({
        action: "confirm_stock", clientRequestId: pendingRequest.current.id, items: [{ orderLineItemId: lineItemId, quantityDelta: quantity }],
      }) });
      await onConfirmed();
      pendingRequest.current = undefined;
      setQuantityInput(null);
    } catch (cause) {
      setError(toFulfillmentError(cause).message);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  return <div className="space-y-1 text-xs text-muted-foreground">
    <p><span className="font-semibold text-foreground">Stock Item</span> · Eligible {eligibleQuantity}{reservedHere > 0 && ` · Reserved here ${reservedHere}`}</p>
    {stock.status === "tracked" && <p>Unreserved inventory {stock.availableQuantity ?? 0}{maximum > 0 && ` · Shortage ${maximum}`}</p>}
    {remainingQuantity > 0 && stock.status === "reconcile" && <p>Resolve stock tracking or quantities in Inventory.</p>}
    {maximum > 0 && stock.status === "untracked" && <p>Check physical stock.</p>}
    {maximum > 0 && stock.status === "untracked" && canConfirm && <div className="flex flex-wrap items-center gap-2">
      <Input type="number" min={1} max={maximum} step={1} aria-label={`Physical stock quantity for ${itemName}`}
        value={quantityInput ?? String(maximum)} className="h-8 w-20" disabled={saving}
        onChange={event => setQuantityInput(event.target.value)} />
      <Button variant="outline" type="button" size="sm" aria-busy={saving}
        disabled={saving || quantity < 1 || quantity > maximum || !Number.isInteger(quantity)} onClick={() => void confirm()}>
        {saving ? "Confirming…" : "Confirm stock"}
      </Button>
    </div>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
