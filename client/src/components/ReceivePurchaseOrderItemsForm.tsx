import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useForm } from "react-hook-form";
import { useReceivePurchaseOrder, PurchaseOrder } from "@/hooks/usePurchaseOrders";
import { useToast } from "@/hooks/use-toast";

interface Props { open: boolean; onOpenChange: (o:boolean)=>void; purchaseOrder: PurchaseOrder; }

export function ReceivePurchaseOrderItemsForm({ open, onOpenChange, purchaseOrder }: Props) {
  const { toast } = useToast();
  const receiveMutation = useReceivePurchaseOrder(purchaseOrder.id);
  const form = useForm<{ items: { lineItemId: string; quantityToReceive: number; }[] }>({
    defaultValues: {
      items: purchaseOrder.lineItems.filter(li => parseFloat(li.quantityReceived) < parseFloat(li.quantityOrdered)).map(li => ({ lineItemId: li.id, quantityToReceive: 0 }))
    }
  });

  async function onSubmit(values: { items: { lineItemId: string; quantityToReceive: number; }[] }) {
    try {
      const filtered = values.items.filter(i => i.quantityToReceive > 0);
      if (filtered.length === 0) {
        toast({ title: "No quantities entered", variant: "destructive" });
        return;
      }
      await receiveMutation.mutateAsync(filtered.map(i => ({ ...i })));
      toast({ title: "Items received" });
      onOpenChange(false);
    } catch (e:any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Receive Items</DialogTitle>
          <DialogDescription>Record received quantities for PO {purchaseOrder.poNumber}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-3 max-h-80 overflow-auto pr-1 text-xs">
            {purchaseOrder.lineItems.map(li => {
              const ordered = parseFloat(li.quantityOrdered);
              const received = parseFloat(li.quantityReceived);
              const remaining = ordered - received;
              if (remaining <= 0) return null;
              return (
                <div key={li.id} className="border rounded p-3 flex flex-col gap-2">
                  <div className="flex justify-between">
                    <span className="font-medium">{li.description}</span>
                    <span>{received.toFixed(2)} / {ordered.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs">Receive Qty</label>
                    <Input type="number" step="0.01" className="h-8" {...form.register(`items.${purchaseOrder.lineItems.indexOf(li)}.quantityToReceive` as const, { valueAsNumber: true })} />
                    <span className="text-muted-foreground text-xs">Remaining: {remaining.toFixed(2)}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={()=> onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={receiveMutation.isPending}>Receive</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
