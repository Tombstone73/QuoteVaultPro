import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useReceiveMaterialReorderRequest, type MaterialReorderRequest } from "@/hooks/useMaterials";
import { useToast } from "@/hooks/use-toast";

const receiveSchema = z.object({
  receivedQuantity: z.coerce.number().positive(),
  notes: z.string().trim().optional(),
});

type ReceiveValues = z.infer<typeof receiveSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reorderRequest: MaterialReorderRequest;
}

export function ReceiveMaterialReorderDialog({ open, onOpenChange, reorderRequest }: Props) {
  const { toast } = useToast();
  const receiveMutation = useReceiveMaterialReorderRequest();
  const form = useForm<ReceiveValues>({
    resolver: zodResolver(receiveSchema),
    defaultValues: {
      receivedQuantity: Number(reorderRequest.requestedQuantity || 0),
      notes: "",
    },
  });

  async function onSubmit(values: ReceiveValues) {
    try {
      await receiveMutation.mutateAsync({
        reorderRequestId: reorderRequest.id,
        data: values,
      });
      onOpenChange(false);
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Receive Material</DialogTitle>
          <DialogDescription>Close the reorder loop for {reorderRequest.materialName}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Requested Quantity</label>
            <Input value={reorderRequest.requestedQuantity} readOnly />
          </div>
          <div>
            <label className="text-sm font-medium">Received Quantity</label>
            <Input type="number" step="0.01" {...form.register("receivedQuantity", { valueAsNumber: true })} />
          </div>
          <div>
            <label className="text-sm font-medium">Notes</label>
            <Textarea rows={3} {...form.register("notes")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={receiveMutation.isPending}>Receive</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}