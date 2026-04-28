import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateMaterialReorderRequest, type Material } from "@/hooks/useMaterials";
import { useToast } from "@/hooks/use-toast";

const requestSchema = z.object({
  requestedQuantity: z.coerce.number().positive(),
  vendorId: z.string().optional(),
  notes: z.string().trim().optional(),
});

type RequestValues = z.infer<typeof requestSchema>;

type VendorOption = {
  id: string;
  name: string;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  material: Material;
  vendors: VendorOption[];
}

export function RequestMaterialReorderDialog({ open, onOpenChange, material, vendors }: Props) {
  const { toast } = useToast();
  const createMutation = useCreateMaterialReorderRequest(material.id);
  const form = useForm<RequestValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: {
      requestedQuantity: undefined,
      vendorId: material.preferredVendorId || undefined,
      notes: "",
    },
  });

  async function onSubmit(values: RequestValues) {
    try {
      await createMutation.mutateAsync({
        requestedQuantity: values.requestedQuantity,
        currentStockQuantity: Number(material.stockQuantity || 0),
        minStockAlert: Number(material.minStockAlert || 0),
        vendorId: values.vendorId || null,
        notes: values.notes || undefined,
      });
      onOpenChange(false);
      form.reset({ requestedQuantity: undefined, vendorId: material.preferredVendorId || undefined, notes: "" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Request Reorder</DialogTitle>
          <DialogDescription>Create a permanent reorder request for {material.name}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Current Quantity</label>
            <Input value={`${Number(material.stockQuantity || 0)} ${material.unitOfMeasure}`} readOnly />
          </div>
          <div>
            <label className="text-sm font-medium">Min Stock Alert</label>
            <Input value={`${Number(material.minStockAlert || 0)} ${material.unitOfMeasure}`} readOnly />
          </div>
          <div>
            <label className="text-sm font-medium">Requested Quantity</label>
            <Input type="number" step="0.01" {...form.register("requestedQuantity", { valueAsNumber: true })} />
          </div>
          <div>
            <label className="text-sm font-medium">Vendor / Supplier</label>
            <Select value={form.watch("vendorId") || "unassigned"} onValueChange={(value) => form.setValue("vendorId", value === "unassigned" ? undefined : value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {vendors.map((vendor) => (
                  <SelectItem key={vendor.id} value={vendor.id}>{vendor.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Notes</label>
            <Textarea rows={3} {...form.register("notes")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending}>Create Request</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}