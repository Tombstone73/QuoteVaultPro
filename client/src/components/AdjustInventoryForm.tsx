import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAdjustInventory, useMaterial, type Material } from "@/hooks/useMaterials";
import { useToast } from "@/hooks/use-toast";
import { useMemo } from "react";

const adjustmentSchema = z.object({
  adjustmentMode: z.enum(["set_quantity", "add_quantity", "subtract_quantity"]),
  quantity: z.coerce.number(),
  reason: z.enum(["damage", "miscount", "scrap", "correction", "received_outside_reorder", "other"]),
  otherReason: z.string().trim().optional(),
  notes: z.string().trim().optional(),
}).superRefine((value, ctx) => {
  if (!Number.isFinite(value.quantity)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantity"], message: "Quantity must be numeric" });
  }
  if ((value.adjustmentMode === "add_quantity" || value.adjustmentMode === "subtract_quantity") && value.quantity <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantity"], message: "Quantity must be greater than zero" });
  }
  if (value.adjustmentMode === "set_quantity" && value.quantity < 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantity"], message: "Quantity cannot be negative" });
  }
  if (value.reason === "other" && !value.otherReason?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["otherReason"], message: "Other reason is required" });
  }
});

type AdjustmentValues = z.infer<typeof adjustmentSchema>;

interface Props {
  materialId: string;
  material?: Material | null;
  open: boolean;
  onOpenChange: (o:boolean)=>void;
}

export function AdjustInventoryForm({ materialId, material: providedMaterial, open, onOpenChange }: Props) {
  const { data: loadedMaterial } = useMaterial(providedMaterial ? undefined : materialId);
  const material = providedMaterial ?? loadedMaterial;
  const form = useForm<AdjustmentValues>({
    resolver: zodResolver(adjustmentSchema),
    defaultValues: {
      adjustmentMode: "add_quantity",
      quantity: 1,
      reason: "correction",
      otherReason: "",
      notes: "",
    }
  });
  const { toast } = useToast();
  const adjustMutation = useAdjustInventory(materialId);
  const currentQuantity = Number(material?.stockQuantity || 0);
  const inventoryUnit = material?.inventoryUnit || "";

  const projectedQuantity = useMemo(() => {
    const values = form.getValues();
    const quantity = Number(values.quantity || 0);
    if (!Number.isFinite(quantity)) return currentQuantity;
    if (values.adjustmentMode === "set_quantity") return quantity;
    if (values.adjustmentMode === "add_quantity") return currentQuantity + quantity;
    return currentQuantity - quantity;
  }, [currentQuantity, form.watch("adjustmentMode"), form.watch("quantity")]);

  async function onSubmit(values: AdjustmentValues) {
    try {
      if (projectedQuantity < 0) {
        throw new Error("Adjustment would make stock negative");
      }

      await adjustMutation.mutateAsync(values);
      toast({ title: "Inventory adjusted" });
      form.reset({
        adjustmentMode: "add_quantity",
        quantity: 1,
        reason: "correction",
        otherReason: "",
        notes: "",
      });
      onOpenChange(false);
    } catch (e:any) {
      toast({ title:"Error", description:e.message, variant:"destructive" });
    }
  }

  const reason = form.watch("reason");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust Inventory</DialogTitle>
          <DialogDescription>Record a permanent stock adjustment with a traceable reason.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Current Quantity</label>
            <Input value={material ? `${currentQuantity} ${inventoryUnit}` : "Loading..."} readOnly />
          </div>
          <div>
            <label className="text-sm font-medium">Adjustment Mode</label>
            <Select value={form.watch("adjustmentMode")} onValueChange={v=> form.setValue("adjustmentMode", v as any)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="set_quantity">Set Quantity</SelectItem>
                <SelectItem value="add_quantity">Add Quantity</SelectItem>
                <SelectItem value="subtract_quantity">Subtract Quantity</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Quantity</label>
            <Input type="number" step="0.01" {...form.register("quantity", {valueAsNumber:true})}/>
          </div>
          <div>
            <label className="text-sm font-medium">Projected Quantity</label>
            <Input value={Number.isFinite(projectedQuantity) ? `${projectedQuantity} ${inventoryUnit}`.trim() : "-"} readOnly />
          </div>
          <div>
            <label className="text-sm font-medium">Reason</label>
            <Select value={reason} onValueChange={v=> form.setValue("reason", v as any)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="damage">Damage</SelectItem>
                <SelectItem value="miscount">Miscount</SelectItem>
                <SelectItem value="scrap">Scrap</SelectItem>
                <SelectItem value="correction">Correction</SelectItem>
                <SelectItem value="received_outside_reorder">Received Outside Reorder</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {reason === "other" ? (
            <div>
              <label className="text-sm font-medium">Other Reason</label>
              <Input {...form.register("otherReason")} />
            </div>
          ) : null}
          <div>
            <label className="text-sm font-medium">Notes</label>
            <Textarea rows={3} {...form.register("notes")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={()=> onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={adjustMutation.isPending || !material}>Submit</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
