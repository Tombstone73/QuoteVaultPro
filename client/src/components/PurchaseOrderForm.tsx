import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useForm, useFieldArray } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCreatePurchaseOrder, useUpdatePurchaseOrder, PurchaseOrder } from "@/hooks/usePurchaseOrders";
import { useVendors } from "@/hooks/useVendors";
import { useMaterials } from "@/hooks/useMaterials";
import { useToast } from "@/hooks/use-toast";

const lineItemSchema = z.object({
  materialId: z.string().optional().or(z.literal("")),
  description: z.string().min(1),
  vendorSku: z.string().optional().or(z.literal("")),
  quantityOrdered: z.coerce.number().positive(),
  unitCost: z.coerce.number().nonnegative(),
  notes: z.string().optional().or(z.literal("")),
});

const poSchema = z.object({
  vendorId: z.string().min(1, "Vendor required"),
  issueDate: z.string().min(1),
  expectedDate: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  lineItems: z.array(lineItemSchema).min(1),
});

export type POFormValues = z.infer<typeof poSchema>;

interface Props { open: boolean; onOpenChange: (o:boolean)=>void; purchaseOrder?: PurchaseOrder; }

export function PurchaseOrderForm({ open, onOpenChange, purchaseOrder }: Props) {
  const { data: vendors = [] } = useVendors({ isActive: true });
  const { data: materials = [] } = useMaterials();
  const { toast } = useToast();
  const createMutation = useCreatePurchaseOrder();
  const updateMutation = useUpdatePurchaseOrder(purchaseOrder?.id || "");

  const form = useForm<POFormValues>({
    resolver: zodResolver(poSchema),
    defaultValues: purchaseOrder ? {
      vendorId: purchaseOrder.vendorId,
      issueDate: purchaseOrder.issueDate.substring(0,10),
      expectedDate: purchaseOrder.expectedDate ? purchaseOrder.expectedDate.substring(0,10) : "",
      notes: purchaseOrder.notes || "",
      lineItems: purchaseOrder.lineItems.map(li => ({
        materialId: li.materialId || "",
        description: li.description,
        vendorSku: li.vendorSku || "",
        quantityOrdered: parseFloat(li.quantityOrdered),
        unitCost: parseFloat(li.unitCost),
        notes: li.notes || "",
      }))
    } : {
      vendorId: "",
      issueDate: new Date().toISOString().substring(0,10),
      expectedDate: "",
      notes: "",
      lineItems: [ { materialId: "", description: "", vendorSku: "", quantityOrdered: 1, unitCost: 0, notes: "" } ]
    }
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lineItems" });

  async function onSubmit(values: POFormValues) {
    const payload = {
      vendorId: values.vendorId,
      issueDate: values.issueDate,
      expectedDate: values.expectedDate || undefined,
      notes: values.notes || undefined,
      lineItems: values.lineItems.map(li => ({
        materialId: li.materialId || undefined,
        description: li.description,
        vendorSku: li.vendorSku || undefined,
        quantityOrdered: li.quantityOrdered,
        unitCost: li.unitCost,
        notes: li.notes || undefined,
      }))
    };
    try {
      if (purchaseOrder) {
        await updateMutation.mutateAsync(payload as any);
        toast({ title: "PO updated" });
      } else {
        await createMutation.mutateAsync(payload as any);
        toast({ title: "PO created" });
      }
      onOpenChange(false);
    } catch (e:any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{purchaseOrder?"Edit Purchase Order":"Create Purchase Order"}</DialogTitle>
          <DialogDescription>Manage vendor order and line items.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-1">
              <label className="text-sm font-medium">Vendor</label>
              <Select value={form.watch("vendorId")} onValueChange={v=> form.setValue("vendorId", v)}>
                <SelectTrigger><SelectValue placeholder="Select vendor"/></SelectTrigger>
                <SelectContent>
                  {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Issue Date</label>
              <Input type="date" {...form.register("issueDate")}/>
            </div>
            <div>
              <label className="text-sm font-medium">Expected Date</label>
              <Input type="date" {...form.register("expectedDate")}/>
            </div>
            <div className="col-span-3">
              <label className="text-sm font-medium">Notes</label>
              <Textarea rows={2} {...form.register("notes")}/>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Line Items</h3>
              <Button type="button" variant="outline" size="sm" onClick={()=> append({ materialId: "", description: "", vendorSku: "", quantityOrdered: 1, unitCost: 0, notes: "" })}>Add Line</Button>
            </div>
            <div className="space-y-3 max-h-80 overflow-auto pr-1">
              {fields.map((field, idx) => {
                const li = form.watch("lineItems")[idx];
                return (
                  <div key={field.id} className="border rounded p-3 grid grid-cols-6 gap-2 text-xs">
                    <div className="col-span-2">
                      <label className="font-medium">Material</label>
                      <Select value={li.materialId || ""} onValueChange={v => form.setValue(`lineItems.${idx}.materialId`, v)}>
                        <SelectTrigger><SelectValue placeholder="Optional"/></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">(None)</SelectItem>
                          {materials?.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2">
                      <label className="font-medium">Description</label>
                      <Input {...form.register(`lineItems.${idx}.description` as const)}/>
                    </div>
                    <div>
                      <label className="font-medium">Vendor SKU</label>
                      <Input {...form.register(`lineItems.${idx}.vendorSku` as const)}/>
                    </div>
                    <div>
                      <label className="font-medium">Qty Ordered</label>
                      <Input type="number" step="0.01" {...form.register(`lineItems.${idx}.quantityOrdered` as const, { valueAsNumber: true })}/>
                    </div>
                    <div>
                      <label className="font-medium">Unit Cost</label>
                      <Input type="number" step="0.0001" {...form.register(`lineItems.${idx}.unitCost` as const, { valueAsNumber: true })}/>
                    </div>
                    <div className="col-span-5">
                      <label className="font-medium">Notes</label>
                      <Input {...form.register(`lineItems.${idx}.notes` as const)}/>
                    </div>
                    <div className="flex items-end">
                      <Button type="button" variant="ghost" size="sm" onClick={()=> remove(idx)}>Remove</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={()=> onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>{purchaseOrder?"Save":"Create"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
