import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateMaterial, useUpdateMaterial, Material } from "@/hooks/useMaterials";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useEffect } from "react";

const materialSchema = z.object({
  name: z.string().min(1, "Name required"),
  sku: z.string().min(1, "SKU required"),
  type: z.enum(["sheet", "roll", "ink", "consumable"]),
  unitOfMeasure: z.enum(["sheet", "sqft", "linear_ft", "ml", "ea"]),
  costPerUnit: z.coerce.number().nonnegative(),
  stockQuantity: z.coerce.number().nonnegative().default(0),
  minStockAlert: z.coerce.number().nonnegative().default(0),
  width: z.coerce.number().optional().or(z.nan()).transform(v=> isNaN(v as any)? undefined : v).optional(),
  height: z.coerce.number().optional().or(z.nan()).transform(v=> isNaN(v as any)? undefined : v).optional(),
  thickness: z.coerce.number().optional().or(z.nan()).transform(v=> isNaN(v as any)? undefined : v).optional(),
  thicknessUnit: z.enum(["in", "mm", "mil", "gauge"]).optional().nullable(),
  color: z.string().optional(),
  specsJson: z.string().optional(), // JSON string editable
  preferredVendorId: z.string().optional().or(z.literal("")).transform(v=> v? v: undefined),
  vendorSku: z.string().optional(),
  vendorCostPerUnit: z.coerce.number().nonnegative().optional(),
});

export type MaterialFormValues = z.infer<typeof materialSchema>;

interface Props {
  open: boolean;
  onOpenChange: (o:boolean)=>void;
  material?: Material;
  /** When true, we are creating a copy of the material */
  isDuplicate?: boolean;
}

export function MaterialForm({ open, onOpenChange, material, isDuplicate }: Props) {
  const { toast } = useToast();
  const createMutation = useCreateMaterial();
  const updateMutation = useUpdateMaterial(material?.id || "");
  
  // Determine if we're in create mode (new or duplicate)
  const isCreateMode = !material || isDuplicate;

  const form = useForm<MaterialFormValues>({
    resolver: zodResolver(materialSchema),
    defaultValues: material ? {
      name: isDuplicate ? `${material.name} (Copy)` : material.name,
      sku: isDuplicate ? `${material.sku}-COPY` : material.sku,
      type: material.type,
      unitOfMeasure: material.unitOfMeasure as any,
      costPerUnit: parseFloat(material.costPerUnit),
      stockQuantity: isDuplicate ? 0 : parseFloat(material.stockQuantity),
      minStockAlert: parseFloat(material.minStockAlert),
      width: material.width ? parseFloat(material.width) : undefined,
      height: material.height ? parseFloat(material.height) : undefined,
      thickness: material.thickness ? parseFloat(material.thickness) : undefined,
      thicknessUnit: material.thicknessUnit || undefined,
      color: material.color || "",
      specsJson: material.specsJson ? JSON.stringify(material.specsJson, null, 2) : "",
      preferredVendorId: material.preferredVendorId || "",
      vendorSku: material.vendorSku || "",
      vendorCostPerUnit: material.vendorCostPerUnit ? parseFloat(material.vendorCostPerUnit) : undefined,
    } : {
      name: "",
      sku: "",
      type: "sheet",
      unitOfMeasure: "sheet",
      costPerUnit: 0,
      stockQuantity: 0,
      minStockAlert: 0,
      width: undefined,
      height: undefined,
      thickness: undefined,
      thicknessUnit: undefined,
      color: "",
      specsJson: "",
      preferredVendorId: "",
      vendorSku: "",
      vendorCostPerUnit: undefined,
    }
  });

  useEffect(()=> {
    if (!open) form.reset();
  }, [open]);

  async function onSubmit(values: MaterialFormValues) {
    const payload: any = {
      ...values,
      costPerUnit: values.costPerUnit.toString(),
      stockQuantity: values.stockQuantity.toString(),
      minStockAlert: values.minStockAlert.toString(),
      width: values.width !== undefined ? values.width.toString() : undefined,
      height: values.height !== undefined ? values.height.toString() : undefined,
      thickness: values.thickness !== undefined ? values.thickness.toString() : undefined,
      thicknessUnit: values.thicknessUnit || undefined,
      specsJson: values.specsJson ? safeParseJSON(values.specsJson) : undefined,
      preferredVendorId: values.preferredVendorId || undefined,
      vendorSku: values.vendorSku || undefined,
      vendorCostPerUnit: values.vendorCostPerUnit !== undefined ? values.vendorCostPerUnit.toString() : undefined,
    };
    try {
      if (isCreateMode) {
        await createMutation.mutateAsync(payload);
        toast({ title: isDuplicate ? "Material duplicated" : "Material created" });
      } else {
        await updateMutation.mutateAsync(payload);
        toast({ title: "Material updated" });
      }
      onOpenChange(false);
    } catch (e:any) {
      toast({ title:"Error", description: e.message, variant:"destructive" });
    }
  }

  function safeParseJSON(str: string) {
    try { return JSON.parse(str); } catch { return null; }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isDuplicate ? "Duplicate Material" : material ? "Edit Material" : "Create Material"}</DialogTitle>
          <DialogDescription>
            {isDuplicate 
              ? `Creating a copy of "${material?.name}". Modify the details below and save.`
              : "Manage material metadata and stock thresholds."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input {...form.register("name")}/>
            </div>
            <div>
              <label className="text-sm font-medium">SKU</label>
              <Input {...form.register("sku")}/>
            </div>
            <div>
              <label className="text-sm font-medium">Type</label>
              <Select onValueChange={v=> form.setValue("type", v as any)} value={form.watch("type")}> 
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sheet">Sheet</SelectItem>
                  <SelectItem value="roll">Roll</SelectItem>
                  <SelectItem value="ink">Ink</SelectItem>
                  <SelectItem value="consumable">Consumable</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Unit</label>
              <Select onValueChange={v=> form.setValue("unitOfMeasure", v as any)} value={form.watch("unitOfMeasure")}> 
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sheet">Sheet</SelectItem>
                  <SelectItem value="sqft">SqFt</SelectItem>
                  <SelectItem value="linear_ft">Linear Ft</SelectItem>
                  <SelectItem value="ml">mL</SelectItem>
                  <SelectItem value="ea">Each</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Cost / Unit</label>
              <Input type="number" step="0.0001" {...form.register("costPerUnit", {valueAsNumber:true})}/>
            </div>
            <div>
              <label className="text-sm font-medium">Stock Qty</label>
              <Input type="number" step="0.01" {...form.register("stockQuantity", {valueAsNumber:true})}/>
            </div>
            <div>
              <label className="text-sm font-medium">Min Stock Alert</label>
              <Input type="number" step="0.01" {...form.register("minStockAlert", {valueAsNumber:true})}/>
            </div>
            <div>
              <label className="text-sm font-medium">Color</label>
              <Input {...form.register("color")}/>
            </div>
            <div>
              <label className="text-sm font-medium">Width</label>
              <Input type="number" step="0.01" {...form.register("width", {valueAsNumber:true})}/>
            </div>
            <div>
              <label className="text-sm font-medium">Height</label>
              <Input type="number" step="0.01" {...form.register("height", {valueAsNumber:true})}/>
            </div>
            <div>
              <label className="text-sm font-medium">Thickness</label>
              <Input type="number" step="0.0001" {...form.register("thickness", {valueAsNumber:true})}/>
            </div>
            <div>
              <label className="text-sm font-medium">Thickness Unit</label>
              <Select onValueChange={v=> form.setValue("thicknessUnit", v === "__none__" ? undefined : v as any)} value={form.watch("thicknessUnit") || "__none__"}> 
                <SelectTrigger><SelectValue placeholder="Select unit"/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  <SelectItem value="in">Inches (in)</SelectItem>
                  <SelectItem value="mm">Millimeters (mm)</SelectItem>
                  <SelectItem value="mil">Mils (1/1000 in)</SelectItem>
                  <SelectItem value="gauge">Gauge</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <VendorSelectSection form={form} />
          </div>
          <div>
            <label className="text-sm font-medium">Specs JSON</label>
            <Textarea rows={4} {...form.register("specsJson")}/>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={()=> onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
              {isDuplicate ? "Duplicate" : material ? "Save" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Lazy vendor select sub-component
import { useVendors } from "@/hooks/useVendors";
import type { UseFormReturn } from "react-hook-form";

function VendorSelectSection({ form }: { form: UseFormReturn<MaterialFormValues> }) {
  const { data: vendors = [], isLoading } = useVendors({ isActive: true });
  return (
    <div className="col-span-2 space-y-2 border-t pt-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">Preferred Vendor</label>
          <Select value={form.watch("preferredVendorId") || ""} onValueChange={v => form.setValue("preferredVendorId", v === "__none__" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder={isLoading?"Loading vendors...":"Select vendor"} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium">Vendor SKU</label>
          <Input {...form.register("vendorSku")}/>
        </div>
        <div>
          <label className="text-sm font-medium">Vendor Cost / Unit</label>
          <Input type="number" step="0.0001" {...form.register("vendorCostPerUnit", { valueAsNumber: true })} />
        </div>
      </div>
    </div>
  );
}
