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

type MaterialWithTierPricing = Material & {
  wholesaleBaseRate?: string | null;
  wholesaleMinCharge?: string | null;
  retailBaseRate?: string | null;
  retailMinCharge?: string | null;
};

const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess(
    (v) => (v === "" || v == null || (typeof v === "number" && Number.isNaN(v)) ? undefined : v),
    schema.optional()
  );

const LEGACY_UNIT_HELPER_TEXT =
  "Legacy/default unit for this material. Existing pricing, inventory, CSV, and some usage behavior may still fall back to this.";
const ROLL_UNIT_WARNING =
  "Roll inventory units are currently ambiguous. Stock quantity, vendor cost, and usage reservations may not all use the same unit. Review before relying on automated inventory depletion.";
const SHEET_SQFT_WARNING =
  "Sheet materials priced by sqft still need explicit conversion/yield handling before inventory depletion can be trusted.";
const MATERIAL_UNIT_VALUES = ["sheet", "sqft", "linear_ft", "ml", "ea"] as const;
const materialUnitSchema = z.enum(MATERIAL_UNIT_VALUES);
const optionalMaterialUnitSchema = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  materialUnitSchema.optional()
);
const MATERIAL_UNIT_OPTIONS = [
  { value: "sheet", label: "Sheet" },
  { value: "sqft", label: "SqFt" },
  { value: "linear_ft", label: "Linear Ft" },
  { value: "ml", label: "mL" },
  { value: "ea", label: "Each" },
] as const;

const materialSchema = z
  .object({
  name: z.string().min(1, "Name required"),
  sku: z.string().min(1, "SKU required"),
  type: z.enum(["sheet", "roll", "ink", "consumable"]),
  category: z.string().trim().optional(),
  unitOfMeasure: materialUnitSchema,
  inventoryUnit: optionalMaterialUnitSchema,
  sellPriceUnit: optionalMaterialUnitSchema,
  wholesalePriceUnit: optionalMaterialUnitSchema,
  vendorCostUnit: optionalMaterialUnitSchema,
  consumptionUnit: optionalMaterialUnitSchema,
  costPerUnit: z.coerce.number().nonnegative(),
  // Tiered pricing fields
  wholesaleBaseRate: optionalNumber(z.coerce.number().nonnegative()),
  wholesaleMinCharge: optionalNumber(z.coerce.number().nonnegative()),
  retailBaseRate: optionalNumber(z.coerce.number().nonnegative()),
  retailMinCharge: optionalNumber(z.coerce.number().nonnegative()),
  stockQuantity: z.coerce.number().nonnegative().default(0),
  minStockAlert: z.coerce.number().nonnegative().default(0),
  isActive: z.boolean().default(true),
  width: optionalNumber(z.coerce.number().nonnegative()),
  height: optionalNumber(z.coerce.number().nonnegative()),
  thickness: optionalNumber(z.coerce.number().nonnegative()),
  thicknessUnit: z.enum(["in", "mm", "mil", "gauge"]).optional().nullable(),
  color: z.string().optional(),
  specsJson: z.string().optional(), // JSON string editable
  preferredVendorId: z.string().optional().or(z.literal("")).transform(v=> v? v: undefined),
  vendorSku: z.string().optional(),
  vendorCostPerUnit: optionalNumber(z.coerce.number().nonnegative()),
  // Roll-specific fields
  rollLengthFt: optionalNumber(z.coerce.number().positive()),
  costPerRoll: optionalNumber(z.coerce.number().positive()),
  edgeWasteInPerSide: optionalNumber(z.coerce.number().nonnegative()),
  leadWasteFt: optionalNumber(z.coerce.number().nonnegative()),
  tailWasteFt: optionalNumber(z.coerce.number().nonnegative()),
})
  .superRefine((data, ctx) => {
    if (data.type !== "roll") return;

    const isPos = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;

    if (!isPos(data.width)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["width"],
        message: "Roll width is required",
      });
    }
    if (!isPos(data.rollLengthFt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rollLengthFt"],
        message: "Roll length is required",
      });
    }
    if (!isPos(data.costPerRoll)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["costPerRoll"],
        message: "Vendor roll cost is required",
      });
    }
  });

export type MaterialFormValues = z.infer<typeof materialSchema>;

interface Props {
  open: boolean;
  onOpenChange: (o:boolean)=>void;
  material?: MaterialWithTierPricing;
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
      category: material.category || "",
      unitOfMeasure: material.unitOfMeasure as any,
      inventoryUnit: (material.inventoryUnit || material.unitOfMeasure) as any,
      sellPriceUnit: (material.sellPriceUnit || material.unitOfMeasure) as any,
      wholesalePriceUnit: (material.wholesalePriceUnit || material.sellPriceUnit || material.unitOfMeasure) as any,
      vendorCostUnit: (material.vendorCostUnit || material.unitOfMeasure) as any,
      consumptionUnit: (material.consumptionUnit || material.sellPriceUnit || material.unitOfMeasure) as any,
      costPerUnit: parseFloat(material.costPerUnit),
      // Tiered pricing fields
      wholesaleBaseRate: material.wholesaleBaseRate ? parseFloat(material.wholesaleBaseRate) : undefined,
      wholesaleMinCharge: material.wholesaleMinCharge ? parseFloat(material.wholesaleMinCharge) : undefined,
      retailBaseRate: material.retailBaseRate ? parseFloat(material.retailBaseRate) : undefined,
      retailMinCharge: material.retailMinCharge ? parseFloat(material.retailMinCharge) : undefined,
      stockQuantity: isDuplicate ? 0 : parseFloat(material.stockQuantity),
      minStockAlert: parseFloat(material.minStockAlert),
      isActive: isDuplicate ? true : material.isActive !== false,
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
      category: "",
      unitOfMeasure: "sheet",
      inventoryUnit: "sheet",
      sellPriceUnit: "sheet",
      wholesalePriceUnit: "sheet",
      vendorCostUnit: "sheet",
      consumptionUnit: "sheet",
      costPerUnit: 0,
      // Tiered pricing fields
      wholesaleBaseRate: undefined,
      wholesaleMinCharge: undefined,
      retailBaseRate: undefined,
      retailMinCharge: undefined,
      stockQuantity: 0,
      minStockAlert: 0,
      isActive: true,
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
      category: values.category?.trim() || undefined,
      costPerUnit: values.costPerUnit.toString(),
      inventoryUnit: values.inventoryUnit || undefined,
      sellPriceUnit: values.sellPriceUnit || undefined,
      wholesalePriceUnit: values.wholesalePriceUnit || undefined,
      vendorCostUnit: values.vendorCostUnit || undefined,
      consumptionUnit: values.consumptionUnit || undefined,
      // Tiered pricing fields
      wholesaleBaseRate: values.wholesaleBaseRate !== undefined ? values.wholesaleBaseRate.toString() : undefined,
      wholesaleMinCharge: values.wholesaleMinCharge !== undefined ? values.wholesaleMinCharge.toString() : undefined,
      retailBaseRate: values.retailBaseRate !== undefined ? values.retailBaseRate.toString() : undefined,
      retailMinCharge: values.retailMinCharge !== undefined ? values.retailMinCharge.toString() : undefined,
      stockQuantity: values.stockQuantity.toString(),
      minStockAlert: values.minStockAlert.toString(),
      isActive: values.isActive,
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
  const unitOfMeasure = form.watch("unitOfMeasure");
  const inventoryUnit = form.watch("inventoryUnit") || unitOfMeasure;
  const stockQuantity = form.watch("stockQuantity");
  const stockQuantityNumber = Number(stockQuantity || 0);
  const showRollUnitWarning =
    isRoll &&
    ["sqft", "linear_ft", "ft"].includes(String(inventoryUnit || unitOfMeasure)) &&
    Number.isFinite(stockQuantityNumber) &&
    stockQuantityNumber > 0;
  const showSheetSqftWarning = materialType === "sheet" && (inventoryUnit || unitOfMeasure) === "sqft";

  // When switching away from Roll, clear roll-only values so they cannot block saving.
  useEffect(() => {
    if (isRoll) return;
    form.setValue("rollLengthFt", undefined, { shouldDirty: true });
    form.setValue("costPerRoll", undefined, { shouldDirty: true });
    form.setValue("edgeWasteInPerSide", undefined, { shouldDirty: true });
    form.setValue("leadWasteFt", undefined, { shouldDirty: true });
    form.setValue("tailWasteFt", undefined, { shouldDirty: true });
    form.clearErrors(["rollLengthFt", "costPerRoll", "edgeWasteInPerSide", "leadWasteFt", "tailWasteFt"]);
    // Note: do NOT clear `width` because it is used for both roll width and sheet width.
  }, [isRoll, form]);

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
              : "Manage full material metadata, supplier data, and inventory thresholds."}
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
              <label className="text-sm font-medium">Category / Group</label>
              <Input {...form.register("category")} placeholder="e.g. Rigid, Vinyl, Ink" />
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
              <label className="text-sm font-medium">Catalog Unit <span className="text-destructive">*</span></label>
              <Select onValueChange={v=> form.setValue("unitOfMeasure", v as any)} value={form.watch("unitOfMeasure")}> 
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  {MATERIAL_UNIT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {LEGACY_UNIT_HELPER_TEXT}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium">Inventory Unit</label>
              <Select onValueChange={v=> form.setValue("inventoryUnit", v as any)} value={form.watch("inventoryUnit") || form.watch("unitOfMeasure")}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  {MATERIAL_UNIT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">How stock quantity and reorder points are tracked. Conversion is not automatic yet.</p>
            </div>
            <div>
              <label className="text-sm font-medium">Sell Price Unit</label>
              <Select onValueChange={v=> form.setValue("sellPriceUnit", v as any)} value={form.watch("sellPriceUnit") || form.watch("unitOfMeasure")}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  {MATERIAL_UNIT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">How customer-facing material pricing is calculated.</p>
            </div>
            <div>
              <label className="text-sm font-medium">Wholesale Price Unit</label>
              <Select onValueChange={v=> form.setValue("wholesalePriceUnit", v as any)} value={form.watch("wholesalePriceUnit") || form.watch("sellPriceUnit") || form.watch("unitOfMeasure")}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  {MATERIAL_UNIT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">How wholesale/trade material pricing is calculated.</p>
            </div>
            <div>
              <label className="text-sm font-medium">Vendor Cost Unit</label>
              <Select onValueChange={v=> form.setValue("vendorCostUnit", v as any)} value={form.watch("vendorCostUnit") || form.watch("unitOfMeasure")}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  {MATERIAL_UNIT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">How the supplier charges for this material.</p>
            </div>
            <div>
              <label className="text-sm font-medium">Consumption Unit</label>
              <Select onValueChange={v=> form.setValue("consumptionUnit", v as any)} value={form.watch("consumptionUnit") || form.watch("sellPriceUnit") || form.watch("unitOfMeasure")}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  {MATERIAL_UNIT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">How production usage or reservations should consume this material. This does not enable automatic conversion yet.</p>
            </div>
            <div>
              <label className="text-sm font-medium">Status</label>
              <Select
                onValueChange={(value) => form.setValue("isActive", value === "active")}
                value={form.watch("isActive") ? "active" : "inactive"}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(showRollUnitWarning || showSheetSqftWarning) ? (
              <div className="col-span-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                {showRollUnitWarning ? ROLL_UNIT_WARNING : SHEET_SQFT_WARNING}
              </div>
            ) : null}
            
          {/* TWO-COLUMN RESPONSIVE LAYOUT: SELL PRICING + VENDOR COST */}
          <div className="col-span-2 grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)]">
            {/* LEFT COLUMN: MATERIAL SELL PRICING */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Material Sell Pricing</CardTitle>
                <p className="text-xs text-muted-foreground">
                  This is what Titan charges customers for this material. Used in quotes and orders.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Base Sell Price</label>
                  <Input 
                    type="number" 
                    step="0.0001" 
                    placeholder="Default price when no tier-specific price set" 
                    {...form.register("costPerUnit", {valueAsNumber:true})}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Recorded per Sell Price Unit. Existing quote pricing math is unchanged in this phase.
                  </p>
                </div>

                {/* Wholesale Pricing Section */}
                <div className="pt-3 border-t">
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <span className="text-blue-600">Wholesale Pricing</span>
                    <span className="text-xs font-normal text-muted-foreground">(Trade/Reseller Rates)</span>
                  </h4>
                  <p className="text-xs text-muted-foreground mb-3">
                    Special rates for trade customers and resellers. Leave empty to use base price. Recorded per Wholesale Price Unit; pricing math is unchanged in this phase.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium">Wholesale Base Sell Price</label>
                      <Input 
                        type="number" 
                        step="0.0001" 
                        placeholder="Optional"
                        {...form.register("wholesaleBaseRate", {valueAsNumber:true})}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Price for wholesale customers per Wholesale Price Unit.
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Wholesale Min Charge</label>
                      <Input 
                        type="number" 
                        step="0.01" 
                        placeholder="Optional"
                        {...form.register("wholesaleMinCharge", {valueAsNumber:true})}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Minimum charge for wholesale jobs; not a unit conversion.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Retail Pricing Section */}
                <div className="pt-3 border-t">
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <span className="text-green-600">Retail Pricing</span>
                    <span className="text-xs font-normal text-muted-foreground">(End-User Rates)</span>
                  </h4>
                  <p className="text-xs text-muted-foreground mb-3">
                    Rates for retail/consumer customers. Leave empty to use base price. Recorded per Sell Price Unit; pricing math is unchanged in this phase.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium">Retail Base Sell Price</label>
                      <Input 
                        type="number" 
                        step="0.0001" 
                        placeholder="Optional"
                        {...form.register("retailBaseRate", {valueAsNumber:true})}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Price for retail customers per Sell Price Unit.
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Retail Min Charge</label>
                      <Input 
                        type="number" 
                        step="0.01" 
                        placeholder="Optional"
                        {...form.register("retailMinCharge", {valueAsNumber:true})}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Minimum charge for retail jobs; not a unit conversion.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Sheet-specific dimensions */}
                {!isRoll && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-sm font-medium">Width (in)</label>
                        <Input type="number" step="0.01" {...form.register("width", {valueAsNumber:true})}/>
                      </div>
                      <div>
                        <label className="text-sm font-medium">Height (in)</label>
                        <Input type="number" step="0.01" {...form.register("height", {valueAsNumber:true})}/>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
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
                    </div>
                  </>
                )}

                <div className="pt-2 border-t">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium">Stock Quantity</label>
                      <Input type="number" step="0.01" {...form.register("stockQuantity", {valueAsNumber:true})}/>
                      <p className="text-xs text-muted-foreground mt-1">
                        Current on-hand quantity in the Inventory Unit. For rolls, confirm whether this represents rolls, sqft, or linear feet before relying on depletion.
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Minimum Stock Alert</label>
                      <Input type="number" step="0.01" {...form.register("minStockAlert", {valueAsNumber:true})}/>
                      <p className="text-xs text-muted-foreground mt-1">
                        Reorder threshold in the Inventory Unit.
                      </p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <label className="text-sm font-medium">Color</label>
                    <Input {...form.register("color")}/>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* RIGHT COLUMN: MATERIAL & VENDOR COST */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Material & Vendor Cost</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Internal cost numbers from your supplier. Used for margin and cost-plus pricing.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {isRoll ? (
                  <>
                    {/* Roll-specific vendor cost fields */}
                    <div>
                      <label className="text-sm font-medium">Roll Width (in) <span className="text-destructive">*</span></label>
                      <Input type="number" step="0.01" placeholder="e.g. 54" {...form.register("width", {valueAsNumber:true})}/>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Roll Length (ft) <span className="text-destructive">*</span></label>
                      <Input type="number" step="0.01" placeholder="e.g. 150" {...form.register("rollLengthFt", {valueAsNumber:true})}/>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Vendor Roll Cost ($) <span className="text-destructive">*</span></label>
                      <Input type="number" step="0.01" placeholder="e.g. 250.00" {...form.register("costPerRoll", {valueAsNumber:true})}/>
                      <p className="text-xs text-muted-foreground mt-1">
                        What your vendor charges for a full roll of this material. This is separate from the Inventory Unit and does not change inventory depletion behavior.
                      </p>
                    </div>
                    <div className="pt-2 border-t">
                      <h5 className="text-xs font-semibold mb-2 text-muted-foreground">Waste Factors</h5>
                      <div className="space-y-2">
                        <div>
                          <label className="text-xs font-medium">Edge Waste per Side (in)</label>
                          <Input type="number" step="0.01" placeholder="e.g. 2" {...form.register("edgeWasteInPerSide", {valueAsNumber:true})}/>
                          <p className="text-xs text-muted-foreground">Unusable edge on left & right.</p>
                        </div>
                        <div>
                          <label className="text-xs font-medium">Lead Waste (ft)</label>
                          <Input type="number" step="0.01" placeholder="0" {...form.register("leadWasteFt", {valueAsNumber:true})}/>
                          <p className="text-xs text-muted-foreground">Unusable material at roll start.</p>
                        </div>
                        <div>
                          <label className="text-xs font-medium">Tail Waste (ft)</label>
                          <Input type="number" step="0.01" placeholder="0" {...form.register("tailWasteFt", {valueAsNumber:true})}/>
                          <p className="text-xs text-muted-foreground">Unusable material at roll end.</p>
                        </div>
                      </div>
                    </div>

                    {/* Derived cost calculations (read-only display) */}
                    {rollDerived && (
                      <div className="pt-3 border-t bg-muted/30 rounded-md p-3">
                        <h5 className="text-xs font-semibold mb-2">Derived Cost Metrics (read-only)</h5>
                        <div className="space-y-1 text-xs">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Sq Ft per Roll:</span>
                            <span className="font-medium">{rollDerived.grossSqftPerRoll.toLocaleString()} sqft</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Usable Sq Ft per Roll:</span>
                            <span className="font-medium">{rollDerived.usableSqftPerRoll.toLocaleString()} sqft</span>
                          </div>
                          <div className="flex justify-between pt-1 border-t">
                            <span className="text-muted-foreground font-semibold">Vendor Cost per Sq Ft:</span>
                            <span className="font-bold text-orange-600">${rollDerived.costPerSqft.toFixed(4)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground font-semibold">Effective Cost (w/ waste):</span>
                            <span className="font-bold text-orange-600">${rollDerived.costPerSqft.toFixed(4)}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* Non-roll vendor cost */}
                    <div>
                      <label className="text-sm font-medium">Vendor Cost per Unit</label>
                      <Input type="number" step="0.0001" placeholder="What vendor charges you" {...form.register("vendorCostPerUnit", {valueAsNumber:true})}/>
                      <p className="text-xs text-muted-foreground mt-1">
                        What your vendor charges you per Vendor Cost Unit unless otherwise stated.
                      </p>
                    </div>
                  </>
                )}

                <div className="pt-2 border-t">
                  <VendorSelectSection form={form} />
                </div>
              </CardContent>
            </Card>
          </div>
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
    <div className="space-y-2">
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
        <p className="text-xs text-muted-foreground mt-1">Vendor's product code for this material.</p>
      </div>
    </div>
  );
}
