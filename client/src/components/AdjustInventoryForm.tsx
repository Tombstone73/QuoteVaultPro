import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useAdjustInventory } from "@/hooks/useMaterials";
import { useToast } from "@/hooks/use-toast";

const adjustmentSchema = z.object({
  type: z.enum(["manual_increase", "manual_decrease", "waste", "shrinkage"]),
  quantityChange: z.coerce.number().positive(),
  reason: z.string().optional(),
});

type AdjustmentValues = z.infer<typeof adjustmentSchema>;

interface Props {
  materialId: string;
  open: boolean;
  onOpenChange: (o:boolean)=>void;
}

export function AdjustInventoryForm({ materialId, open, onOpenChange }: Props) {
  const form = useForm<AdjustmentValues>({
    resolver: zodResolver(adjustmentSchema),
    defaultValues: { type: "manual_increase", quantityChange: 1, reason: "" }
  });
  const { toast } = useToast();
  const adjustMutation = useAdjustInventory(materialId);

  async function onSubmit(values: AdjustmentValues) {
    try {
      const payload = { ...values };
      if (values.type === "manual_decrease" || values.type === "waste" || values.type === "shrinkage") {
        // negative adjustment for decrease-like types
        payload.quantityChange = -Math.abs(values.quantityChange);
      }
      await adjustMutation.mutateAsync(payload);
      toast({ title: "Inventory adjusted" });
      onOpenChange(false);
    } catch (e:any) {
      toast({ title:"Error", description:e.message, variant:"destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust Inventory</DialogTitle>
          <DialogDescription>Record a stock change with reason.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Type</label>
            <Select value={form.watch("type")} onValueChange={v=> form.setValue("type", v as any)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual_increase">Manual Increase</SelectItem>
                <SelectItem value="manual_decrease">Manual Decrease</SelectItem>
                <SelectItem value="waste">Waste</SelectItem>
                <SelectItem value="shrinkage">Shrinkage</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Quantity</label>
            <Input type="number" step="0.01" {...form.register("quantityChange", {valueAsNumber:true})}/>
          </div>
          <div>
            <label className="text-sm font-medium">Reason</label>
            <Input {...form.register("reason")}/>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={()=> onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={adjustMutation.isPending}>Submit</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
