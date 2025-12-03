import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateMaterial, useUpdateMaterial, Material, calculateRollDerivedValues } from "@/hooks/useMaterials";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
  // Roll-specific fields
  rollLengthFt: z.coerce.number().positive().optional().or(z.nan()).transform(v=> isNaN(v as any)? undefined : v),
  costPerRoll: z.coerce.number().nonnegative().optional().or(z.nan()).transform(v=> isNaN(v as any)? undefined : v),
  edgeWasteInPerSide: z.coerce.number().nonnegative().optional().or(z.nan()).transform(v=> isNaN(v as any)? undefined : v),
  leadWasteFt: z.coerce.number().nonnegative().optional().or(z.nan()).transform(v=> isNaN(v as any)? undefined : v),
  tailWasteFt: z.coerce.number().nonnegative().optional().or(z.nan()).transform(v=> isNaN(v as any)? undefined : v),
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
      // Roll-specific fields
      rollLengthFt: material.rollLengthFt ? parseFloat(material.rollLengthFt) : undefined,
      costPerRoll: material.costPerRoll ? parseFloat(material.costPerRoll) : undefined,
      edgeWasteInPerSide: material.edgeWasteInPerSide ? parseFloat(material.edgeWasteInPerSide) : undefined,
      leadWasteFt: material.leadWasteFt ? parseFloat(material.leadWasteFt) : undefined,
      tailWasteFt: material.tailWasteFt ? parseFloat(material.tailWasteFt) : undefined,
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
      // Roll-specific fields
      rollLengthFt: undefined,
      costPerRoll: undefined,
      edgeWasteInPerSide: undefined,
      leadWasteFt: undefined,
      tailWasteFt: undefined,
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
      // Roll-specific fields
      rollLengthFt: values.rollLengthFt !== undefined ? values.rollLengthFt.toString() : undefined,
      costPerRoll: values.costPerRoll !== undefined ? values.costPerRoll.toString() : undefined,
      edgeWasteInPerSide: values.edgeWasteInPerSide !== undefined ? values.edgeWasteInPerSide.toString() : undefined,
      leadWasteFt: values.leadWasteFt !== undefined ? values.leadWasteFt.toString() : undefined,
      tailWasteFt: values.tailWasteFt !== undefined ? values.tailWasteFt.toString() : undefined,
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

  // Watch type to conditionally show roll fields
  const materialType = form.watch("type");
  const isRoll = materialType === "roll";

  // Calculate roll derived values in real-time
  const rollWidth = form.watch("width");
  const rollLength = form.watch("rollLengthFt");
  const rollCost = form.watch("costPerRoll");
  const edgeWaste = form.watch("edgeWasteInPerSide") || 0;
  const leadWaste = form.watch("leadWasteFt") || 0;
  const tailWaste = form.watch("tailWasteFt") || 0;

  const rollDerived = useMemo(() => {
    if (!isRoll || !rollWidth || !rollLength || !rollCost) return null;
    return calculateRollDerivedValues(rollWidth, rollLength, rollCost, edgeWaste, leadWaste, tailWaste);
  }, [isRoll, rollWidth, rollLength, rollCost, edgeWaste, leadWaste, tailWaste]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
              <label className="text-sm font-medium">Name <span className="text-destructive">*</span></label>
              <Input {...form.register("name")}/>
            </div>
            <div>
              <label className="text-sm font-medium">SKU <span className="text-destructive">*</span></label>
              <Input {...form.register("sku")}/>
            </div>
            <div>
              <label className="text-sm font-medium">Type <span className="text-destructive">*</span></label>
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
              <label className="text-sm font-medium">Unit <span className="text-destructive">*</span></label>
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
            
            {/* Roll-specific fields */}
            {isRoll && (
              <div className="col-span-2 border rounded-lg p-4 bg-muted/30">
                <h4 className="text-sm font-semibold mb-3">Roll Specifications</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Roll Width (in) <span className="text-destructive">*</span></label>
                    <Input type="number" step="0.01" placeholder="e.g. 54" {...form.register("width", {valueAsNumber:true})}/>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Roll Length (ft) <span className="text-destructive">*</span></label>
                    <Input type="number" step="0.01" placeholder="e.g. 150" {...form.register("rollLengthFt", {valueAsNumber:true})}/>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Cost per Roll ($) <span className="text-destructive">*</span></label>
                    <Input type="number" step="0.01" placeholder="e.g. 250.00" {...form.register("costPerRoll", {valueAsNumber:true})}/>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Edge Waste per Side (in)</label>
                    <Input type="number" step="0.01" placeholder="e.g. 2" {...form.register("edgeWasteInPerSide", {valueAsNumber:true})}/>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Lead Waste (ft)</label>
                    <Input type="number" step="0.01" placeholder="0" {...form.register("leadWasteFt", {valueAsNumber:true})}/>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Tail Waste (ft)</label>
                    <Input type="number" step="0.01" placeholder="0" {...form.register("tailWasteFt", {valueAsNumber:true})}/>
                  </div>
                </div>

                {/* Computed values display */}
                {rollDerived && (
                  <Card className="mt-4">
                    <CardHeader className="py-3">
                      <CardTitle className="text-sm">Computed Values</CardTitle>
                    </CardHeader>
                    <CardContent className="py-2">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Gross Sq Ft per Roll:</span>
                          <span className="font-medium">{rollDerived.grossSqftPerRoll.toLocaleString()} sqft</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Usable Width:</span>
                          <span className="font-medium">{rollDerived.usableWidthIn}" </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Usable Length:</span>
                          <span className="font-medium">{rollDerived.usableLengthFt} ft</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Usable Sq Ft per Roll:</span>
                          <span className="font-medium">{rollDerived.usableSqftPerRoll.toLocaleString()} sqft</span>
                        </div>
                        <div className="flex justify-between col-span-2 pt-2 border-t">
                          <span className="text-muted-foreground font-medium">Cost per Sq Ft:</span>
                          <span className="font-bold text-primary">${rollDerived.costPerSqft.toFixed(4)}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* Sheet-specific fields (width/height) */}
            {!isRoll && (
              <>
                <div>
                  <label className="text-sm font-medium">Width</label>
                  <Input type="number" step="0.01" {...form.register("width", {valueAsNumber:true})}/>
                </div>
                <div>
                  <label className="text-sm font-medium">Height</label>
                  <Input type="number" step="0.01" {...form.register("height", {valueAsNumber:true})}/>
                </div>
              </>
            )}

            <div>
              <label className="text-sm font-medium">{isRoll ? "Cost / Unit (for non-roll pricing)" : "Cost / Unit"}</label>
              <Input type="number" step="0.0001" {...form.register("costPerUnit", {valueAsNumber:true})}/>
            </div>
            <div>
              <label className="text-sm font-medium">{isRoll ? "Rolls on Hand" : "Stock Qty"}</label>
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

            {/* Only show thickness for non-roll materials */}
            {!isRoll && (
              <>
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
              </>
            )}
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
