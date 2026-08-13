import { useForm } from "react-hook-form";
import { z } from "zod";
import { calculateNormalizedMaterialCost, MATERIAL_PURCHASE_UNITS } from "@shared/materialVendorCost";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateMaterial, useUpdateMaterial, Material, calculateRollDerivedValues } from "@/hooks/useMaterials";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MATERIAL_WEIGHT_BASES, MATERIAL_WEIGHT_UNITS } from "@shared/materialWeight";
import { centsToDollars, normalizeMaterialVendorProductUrl } from "@shared/materialVendorPurchasing";

type LinkableProduct = {
  id: string;
  name: string;
  category?: string | null;
  isActive?: boolean | null;
};

const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess(
    (v) => (v === "" || v == null || (typeof v === "number" && Number.isNaN(v)) ? undefined : v),
    schema.optional()
  );
const optionalVendorUrl = z.string().optional().superRefine((value, ctx) => {
  const result = normalizeMaterialVendorProductUrl(value);
  if (!result.ok) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: result.message,
    });
  }
});

function nullableTrimmed(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function formatDateInput(value?: string | Date | null) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

const MATERIAL_UNIT_VALUES = ["square_foot", "linear_foot", "sheet", "each", "milliliter", "pound"] as const;
const materialUnitSchema = z.enum(MATERIAL_UNIT_VALUES);
const optionalMaterialUnitSchema = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  materialUnitSchema.optional()
);
const optionalPurchaseUnitSchema = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.enum(MATERIAL_PURCHASE_UNITS).optional()
);
const MATERIAL_UNIT_OPTIONS = [
  { value: "sheet", label: "Sheet" },
  { value: "square_foot", label: "Square Foot" },
  { value: "linear_foot", label: "Linear Foot" },
  { value: "milliliter", label: "Milliliter" },
  { value: "each", label: "Each" },
  { value: "pound", label: "Pound" },
] as const;
const FORM_UNIT_OPTIONS = {
  roll: { inventory: ["square_foot", "linear_foot"], consumption: ["square_foot", "linear_foot"] },
  sheet: { inventory: ["sheet", "square_foot"], consumption: ["sheet", "square_foot"] },
  liquid: { inventory: ["milliliter"], consumption: ["milliliter"] },
  each: { inventory: ["each"], consumption: ["each"] },
  bulk_weight: { inventory: ["pound"], consumption: ["pound"] },
} as const;
const materialWeightUnitSchema = z.enum(MATERIAL_WEIGHT_UNITS);
const materialWeightBasisSchema = z.enum(MATERIAL_WEIGHT_BASES);
const optionalMaterialWeightUnitSchema = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  materialWeightUnitSchema.optional()
);
const optionalMaterialWeightBasisSchema = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  materialWeightBasisSchema.optional()
);
const MATERIAL_WEIGHT_UNIT_OPTIONS = [
  { value: "oz", label: "oz" },
  { value: "lb", label: "lb" },
  { value: "g", label: "g" },
  { value: "kg", label: "kg" },
] as const;
const MATERIAL_WEIGHT_BASIS_OPTIONS = [
  { value: "each", label: "Each" },
  { value: "sqft", label: "SqFt" },
  { value: "sheet", label: "Sheet" },
  { value: "linear_ft", label: "Linear Ft" },
  { value: "roll", label: "Roll" },
] as const;

const materialSchema = z
  .object({
  name: z.string().min(1, "Name required"),
  sku: z.string().min(1, "SKU required"),
  materialForm: z.enum(["sheet", "roll", "liquid", "each", "bulk_weight"]),
  category: z.string().trim().optional(),
  inventoryUnit: materialUnitSchema,
  consumptionUnit: materialUnitSchema,
  vendorCostUnit: optionalPurchaseUnitSchema,
  weightValue: optionalNumber(z.coerce.number().positive()),
  weightUnit: optionalMaterialWeightUnitSchema,
  weightBasis: optionalMaterialWeightBasisSchema,
  costPerUnit: z.coerce.number().nonnegative(),
  stockQuantity: z.coerce.number().nonnegative().default(0),
  minStockAlert: z.coerce.number().nonnegative().default(0),
  isActive: z.boolean().default(true),
  width: optionalNumber(z.coerce.number().nonnegative()),
  height: optionalNumber(z.coerce.number().nonnegative()),
  thickness: optionalNumber(z.coerce.number().nonnegative()),
  thicknessUnit: z.enum(["in", "mm", "mil", "gauge"]).optional().nullable(),
  color: z.string().optional(),
  specsJson: z.string().optional(), // JSON string editable
  aiParsingDescription: z.string().optional().nullable(),
  aiParsingDescriptionLinkedToDescription: z.boolean().default(false),
  preferredVendorId: z.string().optional().nullable().or(z.literal("")).transform(v=> v? v: null),
  preferredVendorName: z.string().optional(),
  vendorSku: z.string().optional(),
  vendorCostPerUnit: optionalNumber(z.coerce.number().nonnegative()),
  inventoryUnitsPerPurchaseUnit: optionalNumber(z.coerce.number().positive()),
  minimumPurchaseQuantity: optionalNumber(z.coerce.number().positive()),
  vendorProductUrl: optionalVendorUrl,
  vendorNotes: z.string().optional(),
  vendorLastPrice: optionalNumber(z.coerce.number().nonnegative()),
  vendorLastPriceUpdatedAt: z.string().optional(),
  // Roll-specific fields
  rollLengthFt: optionalNumber(z.coerce.number().positive()),
  costPerRoll: optionalNumber(z.coerce.number().positive()),
  edgeWasteInPerSide: optionalNumber(z.coerce.number().nonnegative()),
  leadWasteFt: optionalNumber(z.coerce.number().nonnegative()),
  tailWasteFt: optionalNumber(z.coerce.number().nonnegative()),
  linkedProductIds: z.array(z.string()).default([]),
})
  .superRefine((data, ctx) => {
    const allowed = FORM_UNIT_OPTIONS[data.materialForm];
    if (!allowed.inventory.includes(data.inventoryUnit as never)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inventoryUnit"], message: "Inventory unit is not valid for this material form" });
    }
    if (!allowed.consumption.includes(data.consumptionUnit as never)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["consumptionUnit"], message: "Consumption unit is not valid for this material form" });
    }
    if (data.materialForm !== "roll") return;

    if (data.inventoryUnit !== "square_foot" && data.inventoryUnit !== "linear_foot") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inventoryUnit"], message: "Roll inventory must use square feet or linear feet" });
    }
    if (data.consumptionUnit !== "square_foot" && data.consumptionUnit !== "linear_foot") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["consumptionUnit"], message: "Roll consumption must use square feet or linear feet" });
    }

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
      materialForm: material.materialForm as any,
      category: material.category || "",
      inventoryUnit: material.inventoryUnit as any,
      vendorCostUnit: material.vendorCostUnit as any,
      consumptionUnit: material.consumptionUnit as any,
      weightValue: material.weightValue ? parseFloat(material.weightValue) : undefined,
      weightUnit: material.weightUnit || undefined,
      weightBasis: material.weightBasis || undefined,
      costPerUnit: parseFloat(material.costPerUnit),
      stockQuantity: isDuplicate ? 0 : parseFloat(material.stockQuantity),
      minStockAlert: parseFloat(material.minStockAlert),
      isActive: isDuplicate ? true : material.isActive !== false,
      width: material.width ? parseFloat(material.width) : undefined,
      height: material.height ? parseFloat(material.height) : undefined,
      thickness: material.thickness ? parseFloat(material.thickness) : undefined,
      thicknessUnit: material.thicknessUnit || undefined,
      color: material.color || "",
      specsJson: material.specsJson ? JSON.stringify(material.specsJson, null, 2) : "",
      aiParsingDescription: material.aiParsingDescription || "",
      aiParsingDescriptionLinkedToDescription: Boolean(material.aiParsingDescriptionLinkedToDescription),
      preferredVendorId: material.preferredVendorId || "",
      preferredVendorName: material.preferredVendorName || "",
      vendorSku: material.vendorSku || "",
      vendorCostPerUnit: material.vendorCostPerUnit ? parseFloat(material.vendorCostPerUnit) : undefined,
      inventoryUnitsPerPurchaseUnit: material.inventoryUnitsPerPurchaseUnit ? parseFloat(material.inventoryUnitsPerPurchaseUnit) : undefined,
      minimumPurchaseQuantity: material.minimumPurchaseQuantity ? parseFloat(material.minimumPurchaseQuantity) : undefined,
      vendorProductUrl: material.vendorProductUrl || "",
      vendorNotes: material.vendorNotes || "",
      vendorLastPrice: centsToDollars(material.vendorLastPriceCents),
      vendorLastPriceUpdatedAt: formatDateInput(material.vendorLastPriceUpdatedAt),
      // Roll-specific fields
      rollLengthFt: material.rollLengthFt ? parseFloat(material.rollLengthFt) : undefined,
      costPerRoll: material.costPerRoll ? parseFloat(material.costPerRoll) : undefined,
      edgeWasteInPerSide: material.edgeWasteInPerSide ? parseFloat(material.edgeWasteInPerSide) : undefined,
      leadWasteFt: material.leadWasteFt ? parseFloat(material.leadWasteFt) : undefined,
      tailWasteFt: material.tailWasteFt ? parseFloat(material.tailWasteFt) : undefined,
      linkedProductIds: material.linkedProductIds || [],
    } : {
      name: "",
      sku: "",
      materialForm: "sheet",
      category: "",
      inventoryUnit: "sheet",
      vendorCostUnit: "sheet",
      consumptionUnit: "sheet",
      weightValue: undefined,
      weightUnit: undefined,
      weightBasis: undefined,
      costPerUnit: 0,
      stockQuantity: 0,
      minStockAlert: 0,
      isActive: true,
      width: undefined,
      height: undefined,
      thickness: undefined,
      thicknessUnit: undefined,
      color: "",
      specsJson: "",
      aiParsingDescription: "",
      aiParsingDescriptionLinkedToDescription: false,
      preferredVendorId: "",
      preferredVendorName: "",
      vendorSku: "",
      vendorCostPerUnit: undefined,
      inventoryUnitsPerPurchaseUnit: 1,
      minimumPurchaseQuantity: 1,
      vendorProductUrl: "",
      vendorNotes: "",
      vendorLastPrice: undefined,
      vendorLastPriceUpdatedAt: "",
      // Roll-specific fields
      rollLengthFt: undefined,
      costPerRoll: undefined,
      edgeWasteInPerSide: undefined,
      leadWasteFt: undefined,
      tailWasteFt: undefined,
      linkedProductIds: [],
    }
  });

  const [productSearch, setProductSearch] = useState("");
  const { data: linkableProducts = [] } = useQuery<LinkableProduct[]>({
    queryKey: ["/api/products?activeOnly=true", "material-link-picker"],
    queryFn: async () => {
      const response = await fetch("/api/products?activeOnly=true", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load products");
      const json = await response.json();
      const list = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
      return list
        .filter((product: any) => product?.isActive !== false)
        .map((product: any) => ({
          id: String(product.id || ""),
          name: String(product.name || ""),
          category: product.category ?? null,
          isActive: product.isActive,
        }))
        .filter((product: LinkableProduct) => product.id && product.name);
    },
    enabled: open,
  });

  useEffect(()=> {
    if (!open) form.reset();
  }, [open]);

  async function onSubmit(values: MaterialFormValues) {
    const payload: any = {
      ...values,
      category: values.category?.trim() || undefined,
      costPerUnit: values.costPerUnit.toString(),
      inventoryUnit: values.inventoryUnit,
      vendorCostUnit: values.vendorCostUnit || undefined,
      consumptionUnit: values.consumptionUnit,
      weightValue: values.weightValue !== undefined ? values.weightValue.toString() : undefined,
      weightUnit: values.weightUnit || undefined,
      weightBasis: values.weightBasis || undefined,
      stockQuantity: values.stockQuantity.toString(),
      minStockAlert: values.minStockAlert.toString(),
      isActive: values.isActive,
      width: values.width !== undefined ? values.width.toString() : undefined,
      height: values.height !== undefined ? values.height.toString() : undefined,
      thickness: values.thickness !== undefined ? values.thickness.toString() : undefined,
      thicknessUnit: values.thicknessUnit || undefined,
      specsJson: values.specsJson ? safeParseJSON(values.specsJson) : undefined,
      aiParsingDescription: nullableTrimmed(values.aiParsingDescription),
      aiParsingDescriptionLinkedToDescription: Boolean(values.aiParsingDescriptionLinkedToDescription),
      preferredVendorId: values.preferredVendorId || null,
      preferredVendorName: nullableTrimmed(values.preferredVendorName),
      vendorSku: nullableTrimmed(values.vendorSku),
      vendorCostPerUnit: values.vendorCostPerUnit !== undefined ? values.vendorCostPerUnit.toString() : undefined,
      inventoryUnitsPerPurchaseUnit: values.inventoryUnitsPerPurchaseUnit !== undefined ? values.inventoryUnitsPerPurchaseUnit.toString() : undefined,
      minimumPurchaseQuantity: values.minimumPurchaseQuantity !== undefined ? values.minimumPurchaseQuantity.toString() : undefined,
      vendorProductUrl: nullableTrimmed(values.vendorProductUrl),
      vendorNotes: nullableTrimmed(values.vendorNotes),
      // Roll-specific fields
      rollLengthFt: values.rollLengthFt !== undefined ? values.rollLengthFt.toString() : undefined,
      costPerRoll: values.costPerRoll !== undefined ? values.costPerRoll.toString() : undefined,
      edgeWasteInPerSide: values.edgeWasteInPerSide !== undefined ? values.edgeWasteInPerSide.toString() : undefined,
      leadWasteFt: values.leadWasteFt !== undefined ? values.leadWasteFt.toString() : undefined,
      tailWasteFt: values.tailWasteFt !== undefined ? values.tailWasteFt.toString() : undefined,
      linkedProductIds: values.linkedProductIds || [],
    };
    try {
      let result: any;
      if (isCreateMode) {
        result = await createMutation.mutateAsync(payload);
        toast({ title: isDuplicate ? "Material duplicated" : "Material created" });
      } else {
        result = await updateMutation.mutateAsync(payload);
        toast({ title: "Material updated" });
      }
      const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
      const linkWarning = warnings.find((warning: any) => String(warning?.code || "").startsWith("MATERIAL_PRODUCT_LINKS_"));
      if (linkWarning?.message) {
        toast({
          title: "Linked products need attention",
          description: linkWarning.message,
          variant: "destructive",
        });
      }
      onOpenChange(false);
    } catch (e:any) {
      toast({ title:"Error", description: e.message, variant:"destructive" });
    }
  }

  function safeParseJSON(str: string) {
    try { return JSON.parse(str); } catch { return null; }
  }

  // Material form controls the valid operational unit combination.
  const materialType = form.watch("materialForm");
  const isRoll = materialType === "roll";
  const inventoryUnit = form.watch("inventoryUnit");
  const consumptionUnit = form.watch("consumptionUnit");
  const allowedUnits = FORM_UNIT_OPTIONS[materialType];
  useEffect(() => {
    if (!allowedUnits.inventory.includes(inventoryUnit as never)) {
      form.setValue("inventoryUnit", allowedUnits.inventory[0] as any);
    }
    if (!allowedUnits.consumption.includes(consumptionUnit as never)) {
      form.setValue("consumptionUnit", allowedUnits.consumption[0] as any);
    }
  }, [allowedUnits, consumptionUnit, form, inventoryUnit]);
  const aiParsingLinkedToDescription = Boolean(form.watch("aiParsingDescriptionLinkedToDescription"));
  const linkedProductIds = form.watch("linkedProductIds") || [];
  const linkedProductIdSet = useMemo(() => new Set(linkedProductIds), [linkedProductIds]);
  const selectedLinkedProducts = useMemo(
    () => linkableProducts.filter((product) => linkedProductIdSet.has(product.id)),
    [linkableProducts, linkedProductIdSet]
  );
  const filteredLinkableProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    const base = q
      ? linkableProducts.filter((product) => {
          const category = product.category || "";
          return product.name.toLowerCase().includes(q) || category.toLowerCase().includes(q);
        })
      : linkableProducts;
    return [...base].sort((left, right) => {
      const leftSelected = linkedProductIdSet.has(left.id);
      const rightSelected = linkedProductIdSet.has(right.id);
      if (leftSelected !== rightSelected) return leftSelected ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
  }, [linkableProducts, linkedProductIdSet, productSearch]);

  const setLinkedProduct = (productId: string, checked: boolean) => {
    const current = form.getValues("linkedProductIds") || [];
    const next = checked
      ? Array.from(new Set([...current, productId]))
      : current.filter((id) => id !== productId);
    form.setValue("linkedProductIds", next, { shouldDirty: true });
  };

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
  const vendorPurchasePrice = form.watch("vendorCostPerUnit");
  const unitsPerPurchase = form.watch("inventoryUnitsPerPurchaseUnit");
  const edgeWaste = form.watch("edgeWasteInPerSide") || 0;
  const leadWaste = form.watch("leadWasteFt") || 0;
  const tailWaste = form.watch("tailWasteFt") || 0;
  const vendorProductUrl = form.watch("vendorProductUrl");
  const normalizedVendorProductUrl = useMemo(() => {
    const result = normalizeMaterialVendorProductUrl(vendorProductUrl);
    return result.ok ? result.value : null;
  }, [vendorProductUrl]);

  const rollDerived = useMemo(() => {
    if (!isRoll || !rollWidth || !rollLength || !rollCost) return null;
    return calculateRollDerivedValues(rollWidth, rollLength, rollCost, edgeWaste, leadWaste, tailWaste);
  }, [isRoll, rollWidth, rollLength, rollCost, edgeWaste, leadWaste, tailWaste]);

  useEffect(() => {
    if (isRoll) return;
    const normalized = calculateNormalizedMaterialCost({
      materialForm: materialType,
      vendorCostPerUnit: vendorPurchasePrice,
      inventoryUnitsPerPurchaseUnit: unitsPerPurchase,
    });
    if (normalized !== null) {
      form.setValue("costPerUnit", Number(normalized.toFixed(4)), { shouldDirty: true, shouldValidate: true });
    }
  }, [form, isRoll, materialType, unitsPerPurchase, vendorPurchasePrice]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-[1200px] flex-col overflow-hidden p-0 sm:max-w-[90vw]">
        <DialogHeader className="shrink-0 border-b px-6 py-5 pr-12">
          <DialogTitle>{isDuplicate ? "Duplicate Material" : material ? "Edit Material" : "Create Material"}</DialogTitle>
          <DialogDescription>
            {isDuplicate 
              ? `Creating a copy of "${material?.name}". Modify the details below and save.`
              : "Manage full material metadata, supplier data, and inventory thresholds."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="space-y-5">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Basic Material Info</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Identity, classification, units, status, and product relationships.
                  </p>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="lg:col-span-2">
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
                      <label className="text-sm font-medium">Material Form <span className="text-destructive">*</span></label>
                      <Select onValueChange={v=> form.setValue("materialForm", v as any)} value={form.watch("materialForm")}>
                        <SelectTrigger><SelectValue/></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sheet">Sheet</SelectItem>
                          <SelectItem value="roll">Roll</SelectItem>
                          <SelectItem value="liquid">Liquid</SelectItem>
                          <SelectItem value="each">Each item</SelectItem>
                          <SelectItem value="bulk_weight">Bulk weight</SelectItem>
                        </SelectContent>
                      </Select>
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
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <div>
                      <label className="text-sm font-medium">Inventory Unit <span className="text-destructive">*</span></label>
                      <Select onValueChange={v=> form.setValue("inventoryUnit", v as any)} value={form.watch("inventoryUnit")}>
                        <SelectTrigger><SelectValue/></SelectTrigger>
                        <SelectContent>
                          {MATERIAL_UNIT_OPTIONS.filter((option) => allowedUnits.inventory.includes(option.value as never)).map((option) => (
                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground mt-1">The canonical physical quantity for stock, adjustments, and reorder points.</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Consumption Unit <span className="text-destructive">*</span></label>
                      <Select onValueChange={v=> form.setValue("consumptionUnit", v as any)} value={form.watch("consumptionUnit")}>
                        <SelectTrigger><SelectValue/></SelectTrigger>
                        <SelectContent>
                          {MATERIAL_UNIT_OPTIONS.filter((option) => allowedUnits.consumption.includes(option.value as never)).map((option) => (
                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground mt-1">The unit production requirements use. Product sell units and pricing are separate.</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Purchase Unit</label>
                      <Select onValueChange={v=> form.setValue("vendorCostUnit", v === "__none__" ? undefined : v as any)} value={form.watch("vendorCostUnit") || "__none__"}>
                        <SelectTrigger><SelectValue/></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Not specified</SelectItem>
                          {MATERIAL_PURCHASE_UNITS.map((unit) => (
                            <SelectItem key={unit} value={unit}>{unit.replaceAll("_", " ")}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground mt-1">The unit the vendor sells, such as a lot, pack, roll, or sheet.</p>
                    </div>
                  </div>

                  <div className="rounded-md border p-3 space-y-3">
                    <div>
                      <h3 className="text-sm font-semibold">Linked Products</h3>
                      <p className="text-xs text-muted-foreground">
                        Active products commonly used with this material.
                      </p>
                    </div>
                    {selectedLinkedProducts.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {selectedLinkedProducts.map((product) => (
                          <Badge key={product.id} variant="secondary" className="gap-1 pr-1">
                            <span className="max-w-[220px] truncate">{product.name}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5"
                              onClick={() => setLinkedProduct(product.id, false)}
                              aria-label={`Remove ${product.name}`}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    <Input
                      value={productSearch}
                      onChange={(event) => setProductSearch(event.target.value)}
                      placeholder="Search active products"
                    />
                    <div className="max-h-44 overflow-y-auto rounded-md border">
                      {filteredLinkableProducts.length > 0 ? (
                        filteredLinkableProducts.map((product) => (
                          <label
                            key={product.id}
                            className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted/60"
                          >
                            <Checkbox
                              checked={linkedProductIdSet.has(product.id)}
                              onCheckedChange={(checked) => setLinkedProduct(product.id, checked === true)}
                            />
                            <span className="min-w-0 flex-1 truncate">{product.name}</span>
                            {product.category ? (
                              <span className="text-xs text-muted-foreground">{product.category}</span>
                            ) : null}
                          </label>
                        ))
                      ) : (
                        <div className="px-3 py-6 text-center text-sm text-muted-foreground">No active products found.</div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-md border p-3 space-y-3">
                    <div>
                      <h3 className="text-sm font-semibold">Weight</h3>
                      <p className="text-xs text-muted-foreground">
                        Used for shipping/weight estimates when products resolve this material. Optional for now.
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <label className="text-sm font-medium">Weight value</label>
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          placeholder="Optional"
                          {...form.register("weightValue", { valueAsNumber: true })}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium">Weight unit</label>
                        <Select
                          onValueChange={(v) => form.setValue("weightUnit", v === "__none__" ? undefined : v as any)}
                          value={form.watch("weightUnit") || "__none__"}
                        >
                          <SelectTrigger><SelectValue placeholder="Unit" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {MATERIAL_WEIGHT_UNIT_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-sm font-medium">Weight basis</label>
                        <Select
                          onValueChange={(v) => form.setValue("weightBasis", v === "__none__" ? undefined : v as any)}
                          value={form.watch("weightBasis") || "__none__"}
                        >
                          <SelectTrigger><SelectValue placeholder="Basis" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {MATERIAL_WEIGHT_BASIS_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Pricing / Costing</CardTitle>
                  <p className="text-xs text-muted-foreground">One normalized internal cost is used for inventory and job costing. Product sell pricing remains separate.</p>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid gap-4 lg:grid-cols-3">
                    <div>
                      <label className="text-sm font-medium">Material Cost per Inventory Unit</label>
                      <Input 
                        type="number" 
                        step="0.0001" 
                        placeholder="Material cost"
                        {...form.register("costPerUnit", {valueAsNumber:true})}
                        readOnly={Boolean(form.watch("vendorCostPerUnit")) && !isRoll}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        {Boolean(form.watch("vendorCostPerUnit")) && !isRoll
                          ? `Calculated from the vendor purchase price and units per purchase unit. / ${inventoryUnit.replaceAll("_", " ")}`
                          : "Internal material cost; it does not define a product sell price or sell unit."}
                      </p>
                    </div>
                    {!isRoll ? (
                      <>
                      <div>
                        <label className="text-sm font-medium">Vendor Purchase Price</label>
                        <Input type="number" step="0.0001" placeholder="What the vendor charges" {...form.register("vendorCostPerUnit", {valueAsNumber:true})}/>
                        <p className="text-xs text-muted-foreground mt-1">
                          Price for one Purchase Unit. It is not a per-inventory-unit cost unless the conversion is one.
                        </p>
                      </div>
                      <div>
                        <label className="text-sm font-medium">{inventoryUnit.replaceAll("_", " ")}s per Purchase Unit</label>
                        <Input type="number" min="0.000001" step="0.000001" {...form.register("inventoryUnitsPerPurchaseUnit", {valueAsNumber:true})}/>
                        <p className="text-xs text-muted-foreground mt-1">For example, 15 sheets in one lot. Defaults to 1 for legacy records.</p>
                      </div>
                      </>
                    ) : null}
                  </div>

                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Inventory</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    On-hand quantity, reorder threshold, and basic visual descriptor.
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                    <div>
                      <label className="text-sm font-medium">Color</label>
                      <Input {...form.register("color")}/>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Roll / Sheet Metrics</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Physical dimensions and roll-specific waste factors.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {isRoll ? (
                    <>
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                      </div>

                      <div className="rounded-md border p-3">
                        <h5 className="text-xs font-semibold mb-3 text-muted-foreground">Waste Factors</h5>
                        <div className="grid gap-3 md:grid-cols-3">
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

                      {rollDerived && (
                        <div className="rounded-md bg-muted/30 p-3">
                          <h5 className="text-xs font-semibold mb-2">Derived Cost Metrics (read-only)</h5>
                          <div className="grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
                            <div>
                              <span className="text-muted-foreground">Sq Ft per Roll</span>
                              <div className="font-medium">{rollDerived.grossSqftPerRoll.toLocaleString()} sqft</div>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Usable Sq Ft per Roll</span>
                              <div className="font-medium">{rollDerived.usableSqftPerRoll.toLocaleString()} sqft</div>
                            </div>
                            <div>
                              <span className="text-muted-foreground font-semibold">Vendor Cost per Sq Ft</span>
                              <div className="font-bold text-orange-600">${rollDerived.costPerSqft.toFixed(4)}</div>
                            </div>
                            <div>
                              <span className="text-muted-foreground font-semibold">Effective Cost (w/ waste)</span>
                              <div className="font-bold text-orange-600">${rollDerived.costPerSqft.toFixed(4)}</div>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                      <div>
                        <label className="text-sm font-medium">Width (in)</label>
                        <Input type="number" step="0.01" {...form.register("width", {valueAsNumber:true})}/>
                      </div>
                      <div>
                        <label className="text-sm font-medium">Height (in)</label>
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
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Vendor / Ordering Info</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Supplier ordering details saved with this material after the form is submitted.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <VendorSelectSection form={form} />

                  <div className="grid gap-4 lg:grid-cols-3">
                    <div className="lg:col-span-2">
                      <label className="text-sm font-medium">Ordering URL</label>
                      <Input placeholder="https://vendor.example.com/material" {...form.register("vendorProductUrl")} />
                      {form.formState.errors.vendorProductUrl?.message ? (
                        <p className="text-xs text-destructive mt-1">{form.formState.errors.vendorProductUrl.message}</p>
                      ) : null}
                      {normalizedVendorProductUrl ? (
                        <a
                          href={normalizedVendorProductUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-xs text-primary underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Open Vendor Page
                        </a>
                      ) : null}
                    </div>
                    <div>
                      <label className="text-sm font-medium">Vendor SKU</label>
                      <Input {...form.register("vendorSku")} />
                      <p className="text-xs text-muted-foreground mt-1">Vendor's product code for this material.</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Minimum Purchase Quantity</label>
                      <Input type="number" min="0.000001" step="0.000001" {...form.register("minimumPurchaseQuantity", { valueAsNumber: true })} />
                      <p className="text-xs text-muted-foreground mt-1">Minimum number of Purchase Units to order. Defaults to 1.</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Last Received Vendor Price</label>
                      <Input type="number" min="0" step="0.01" readOnly value={form.watch("vendorLastPrice") ?? ""} />
                      <p className="text-xs text-muted-foreground mt-1">System-maintained from the most recent purchase-order receipt.</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Last Receipt Date</label>
                      <Input type="date" readOnly value={form.watch("vendorLastPriceUpdatedAt") || ""} />
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium">Vendor Notes</label>
                    <Textarea rows={4} placeholder="Ordering notes, account terms, substitutions" {...form.register("vendorNotes")} />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Specs JSON</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Optional structured specs stored with the material record.
                  </p>
                </CardHeader>
                <CardContent>
                  <Textarea rows={6} {...form.register("specsJson")}/>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">AI Parsing Description</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Internal matching guidance for inbound parsing. This does not change customer-facing material behavior.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <label className="flex items-start gap-3 rounded-md border p-3">
                    <Checkbox
                      checked={aiParsingLinkedToDescription}
                      onCheckedChange={(checked) => form.setValue("aiParsingDescriptionLinkedToDescription", Boolean(checked), { shouldDirty: true })}
                    />
                    <span className="space-y-1">
                      <span className="block text-sm font-medium">Use material description for AI parsing</span>
                      <span className="block text-xs text-muted-foreground">
                        Keep AI matching tied to the material description when a separate internal hint is not needed.
                      </span>
                    </span>
                  </label>
                  <div>
                    <label className="text-sm font-medium">AI Parsing Description</label>
                    <Textarea
                      rows={5}
                      placeholder="Internal phrases, aliases, supplier terms, and ordering language staff expect AI parsing to match."
                      {...form.register("aiParsingDescription")}
                      disabled={aiParsingLinkedToDescription}
                      className={aiParsingLinkedToDescription ? "opacity-60" : ""}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {aiParsingLinkedToDescription
                        ? "The material description will be used as the AI parsing description."
                        : "Use this for alternate terms or staff-only matching guidance. Material name remains the strongest match signal."}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t bg-background px-6 py-4">
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
        <Input className="mb-2" placeholder="Vendor or supplier name" {...form.register("preferredVendorName")} />
        <p className="text-xs text-muted-foreground mb-2">Use a plain vendor name here; linking to an existing vendor record is optional.</p>
      </div>
      <div>
        <label className="text-sm font-medium">Vendor Record</label>
        <Select value={form.watch("preferredVendorId") || ""} onValueChange={v => form.setValue("preferredVendorId", v === "__none__" ? "" : v)}>
          <SelectTrigger><SelectValue placeholder={isLoading?"Loading vendors...":"Select vendor"} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None</SelectItem>
            {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
