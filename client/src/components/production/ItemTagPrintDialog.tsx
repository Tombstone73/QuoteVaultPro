import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { itemTagPrintUrl, validTagQuantity, type ItemTagScope } from "@/lib/itemTagPrint";

export function ItemTagPrintDialog({ orderId, lineItemId, orderedQuantity, open, onOpenChange }: {
  orderId: string;
  lineItemId: string;
  orderedQuantity: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [scope, setScope] = useState<ItemTagScope>("line");
  const [quantity, setQuantity] = useState("");
  const [includeThumbnails, setIncludeThumbnails] = useState(false);
  useEffect(() => {
    if (!open) return;
    setScope("line");
    setQuantity("");
    setIncludeThumbnails(false);
  }, [open, lineItemId]);
  const partialQuantity = Number(quantity);
  const valid = scope === "order" || (orderedQuantity != null && validTagQuantity(orderedQuantity, orderedQuantity)
    && (scope !== "partial" || (quantity.trim() !== "" && validTagQuantity(partialQuantity, orderedQuantity))));

  function print() {
    if (!valid) return;
    const url = itemTagPrintUrl({ orderId, lineItemId, scope, orderedQuantity: orderedQuantity ?? 0, quantity: partialQuantity, includeThumbnails });
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
    onOpenChange(false);
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>Print Item Tag</DialogTitle><DialogDescription>Print-only label. This does not record production or fulfillment.</DialogDescription></DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2"><Label>Scope</Label>
          {([ ["order", "Whole Order"], ["line", "Selected Line Item"], ["partial", "Partial Quantity of Selected Line Item"] ] as const).map(([value, label]) =>
            <label key={value} className="flex items-center gap-2 text-sm"><input type="radio" name="item-tag-scope" checked={scope === value} onChange={() => setScope(value)} />{label}</label>)}
        </div>
        {scope === "partial" && <div className="space-y-1.5"><Label htmlFor="item-tag-quantity">Quantity on this tag (of {orderedQuantity ?? "unknown"})</Label>
          <Input id="item-tag-quantity" type="number" min="1" max={orderedQuantity ?? undefined} step="1" value={quantity} onChange={event => setQuantity(event.target.value)} aria-invalid={!valid} />
          {!valid && <p className="text-xs text-destructive">Enter a positive whole number no greater than the ordered line quantity.</p>}
        </div>}
        {scope !== "order" && <label className="flex items-center gap-2 text-sm"><Checkbox checked={includeThumbnails} onCheckedChange={value => setIncludeThumbnails(value === true)} />Include Artwork Thumbnails</label>}
      </div>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!valid} onClick={print}>Open Browser Print</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function PrintItemTagButton({ orderId, lineItemId, orderedQuantity }: { orderId: string; lineItemId: string; orderedQuantity: number | null }) {
  const [open, setOpen] = useState(false);
  return <><Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>Print Item Tag</Button>
    <ItemTagPrintDialog orderId={orderId} lineItemId={lineItemId} orderedQuantity={orderedQuantity} open={open} onOpenChange={setOpen} /></>;
}
