import { useEffect, useMemo, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CreatePurchaseOrderInput,
  PurchaseOrder,
  PurchaseOrderRelatedOrder,
  useCreatePurchaseOrder,
  usePurchaseOrderRelatedOrderSearch,
  useUpdatePurchaseOrder,
} from "@/hooks/usePurchaseOrders";
import { useVendors } from "@/hooks/useVendors";
import { Material, useMaterials } from "@/hooks/useMaterials";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DataCard } from "@/components/titan";
import { Search, X, Plus, Trash2, Save } from "lucide-react";

const lineItemSchema = z.object({
  materialId: z.string().optional().or(z.literal("")),
  description: z.string().trim().min(1, "Description required"),
  vendorSku: z.string().optional().or(z.literal("")),
  quantityOrdered: z.coerce.number().positive("Quantity must be positive"),
  unitCost: z.coerce.number().nonnegative("Unit cost cannot be negative"),
  inventoryUnitsPerPurchaseUnit: z.coerce.number().positive().default(1),
  notes: z.string().optional().or(z.literal("")),
});

const poSchema = z.object({
  vendorId: z.string().min(1, "Vendor required"),
  relatedOrderId: z.string().nullable().optional(),
  issueDate: z.string().min(1, "Issue date required"),
  expectedDate: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  lineItems: z.array(lineItemSchema).min(1, "At least one line item is required"),
});

export type POFormValues = z.infer<typeof poSchema>;

type Props = {
  purchaseOrder?: PurchaseOrder;
  initialVendorId?: string | null;
  onCancel: () => void;
  onSaved: (purchaseOrder: PurchaseOrder) => void;
};

function asDateInput(value: string | null | undefined) {
  return value ? value.substring(0, 10) : "";
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function orderLabel(order: PurchaseOrderRelatedOrder | null | undefined) {
  if (!order) return "";
  return order.displayNumber || order.orderNumber || order.jobNumber || order.id.slice(0, 8);
}

function RelatedOrderPicker({
  selected,
  onSelect,
}: {
  selected: PurchaseOrderRelatedOrder | null;
  onSelect: (order: PurchaseOrderRelatedOrder | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const showRecent = !selected && debouncedSearch.length < 2;
  const { data: results = [], isLoading, isError } = usePurchaseOrderRelatedOrderSearch(debouncedSearch, {
    recent: showRecent,
    limit: 10,
  });

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Related Job / Order</label>
      {selected ? (
        <div className="flex items-start justify-between gap-3 rounded-md border border-titan-border bg-titan-bg-subtle p-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-titan-text-primary">{orderLabel(selected)}</span>
              {selected.status && <Badge variant="outline">{selected.status}</Badge>}
            </div>
            <div className="mt-1 text-xs text-titan-text-secondary">
              {[selected.customerName, selected.primaryDescription, selected.poNumber ? `Customer PO ${selected.poNumber}` : null]
                .filter(Boolean)
                .join(" | ")}
            </div>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onSelect(null)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-titan-text-muted" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search order, job, customer, PO, or product"
              className="pl-9"
            />
          </div>
          <div className="max-h-64 overflow-auto rounded-md border border-titan-border bg-background">
            {isLoading && <div className="p-3 text-sm text-titan-text-secondary">Searching...</div>}
            {isError && <div className="p-3 text-sm text-destructive">Could not search jobs/orders.</div>}
            {!isLoading && !isError && results.length === 0 && (
              <div className="p-3 text-sm text-titan-text-secondary">
                {debouncedSearch.length < 2 ? "Recent open jobs appear here." : "No matching jobs/orders."}
              </div>
            )}
            {!isLoading && !isError && results.map((result) => (
              <button
                key={result.id}
                type="button"
                className="block w-full border-b border-titan-border p-3 text-left last:border-b-0 hover:bg-titan-bg-subtle"
                onClick={() => onSelect(result)}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{orderLabel(result)}</span>
                  {result.status && <Badge variant="outline">{result.status}</Badge>}
                  {result.dueDate && <span className="text-xs text-titan-text-muted">Due {String(result.dueDate).substring(0, 10)}</span>}
                </div>
                <div className="mt-1 text-xs text-titan-text-secondary">
                  {[result.customerName, result.primaryDescription || result.label, result.poNumber ? `Customer PO ${result.poNumber}` : null]
                    .filter(Boolean)
                    .join(" | ")}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function defaultLine() {
  return { materialId: "", description: "", vendorSku: "", quantityOrdered: 1, unitCost: 0, inventoryUnitsPerPurchaseUnit: 1, notes: "" };
}

export function PurchaseOrderForm({ purchaseOrder, initialVendorId, onCancel, onSaved }: Props) {
  const { data: vendors = [] } = useVendors({ isActive: true });
  const { data: materials = [] } = useMaterials();
  const { toast } = useToast();
  const createMutation = useCreatePurchaseOrder();
  const updateMutation = useUpdatePurchaseOrder(purchaseOrder?.id || "");
  const [selectedRelatedOrder, setSelectedRelatedOrder] = useState<PurchaseOrderRelatedOrder | null>(purchaseOrder?.relatedOrder ?? null);

  const form = useForm<POFormValues>({
    resolver: zodResolver(poSchema),
    defaultValues: purchaseOrder ? {
      vendorId: purchaseOrder.vendorId,
      relatedOrderId: purchaseOrder.relatedOrderId ?? null,
      issueDate: asDateInput(purchaseOrder.issueDate),
      expectedDate: asDateInput(purchaseOrder.expectedDate ?? null),
      notes: purchaseOrder.notes || "",
      lineItems: purchaseOrder.lineItems.map(li => ({
        materialId: li.materialId || "",
        description: li.description,
        vendorSku: li.vendorSku || "",
        quantityOrdered: parseFloat(li.quantityOrdered),
        unitCost: parseFloat(li.unitCost),
        inventoryUnitsPerPurchaseUnit: parseFloat(li.inventoryUnitsPerPurchaseUnit || "1"),
        notes: li.notes || "",
      })),
    } : {
      vendorId: initialVendorId || "",
      relatedOrderId: null,
      issueDate: new Date().toISOString().substring(0, 10),
      expectedDate: "",
      notes: "",
      lineItems: [defaultLine()],
    },
  });

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!form.formState.isDirty || createMutation.isPending || updateMutation.isPending) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [createMutation.isPending, form.formState.isDirty, updateMutation.isPending]);

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lineItems" });
  const watchedLines = form.watch("lineItems");
  const subtotal = useMemo(
    () => watchedLines.reduce((sum, line) => sum + Number(line.quantityOrdered || 0) * Number(line.unitCost || 0), 0),
    [watchedLines],
  );
  const saving = createMutation.isPending || updateMutation.isPending;

  function handleRelatedOrderSelect(order: PurchaseOrderRelatedOrder | null) {
    setSelectedRelatedOrder(order);
    form.setValue("relatedOrderId", order?.id ?? null, { shouldDirty: true, shouldValidate: true });
  }

  function handleMaterialSelect(index: number, materialId: string) {
    const material = materials.find((item: Material) => item.id === materialId);
    form.setValue(`lineItems.${index}.materialId`, materialId === "none" ? "" : materialId, { shouldDirty: true });
    if (!material) return;
    form.setValue(`lineItems.${index}.description`, material.name, { shouldDirty: true, shouldValidate: true });
    form.setValue(`lineItems.${index}.vendorSku`, material.vendorSku || "", { shouldDirty: true });
    const unitCost = Number(material.vendorCostPerUnit ?? material.costPerUnit ?? 0);
    if (Number.isFinite(unitCost)) form.setValue(`lineItems.${index}.unitCost`, unitCost, { shouldDirty: true, shouldValidate: true });
    const inventoryUnits = Number(material.inventoryUnitsPerPurchaseUnit ?? 1);
    if (Number.isFinite(inventoryUnits) && inventoryUnits > 0) {
      form.setValue(`lineItems.${index}.inventoryUnitsPerPurchaseUnit`, inventoryUnits, { shouldDirty: true, shouldValidate: true });
    }
    const minimumPurchaseQuantity = Number(material.minimumPurchaseQuantity ?? 1);
    if (Number.isFinite(minimumPurchaseQuantity) && minimumPurchaseQuantity > 0 && Number(form.getValues(`lineItems.${index}.quantityOrdered`)) < minimumPurchaseQuantity) {
      form.setValue(`lineItems.${index}.quantityOrdered`, minimumPurchaseQuantity, { shouldDirty: true, shouldValidate: true });
    }
    if (!form.getValues("vendorId") && material.preferredVendorId) {
      form.setValue("vendorId", material.preferredVendorId, { shouldDirty: true, shouldValidate: true });
    }
  }

  async function onSubmit(values: POFormValues) {
    const payload: CreatePurchaseOrderInput = {
      vendorId: values.vendorId,
      relatedOrderId: values.relatedOrderId ?? null,
      issueDate: values.issueDate,
      expectedDate: values.expectedDate && values.expectedDate.trim() ? values.expectedDate : null,
      notes: values.notes || null,
      lineItems: values.lineItems.map(li => ({
        materialId: li.materialId || null,
        description: li.description.trim(),
        vendorSku: li.vendorSku || null,
        quantityOrdered: li.quantityOrdered,
        unitCost: li.unitCost,
        inventoryUnitsPerPurchaseUnit: li.inventoryUnitsPerPurchaseUnit,
        notes: li.notes || null,
      })),
    };

    try {
      const saved = purchaseOrder
        ? await updateMutation.mutateAsync(payload)
        : await createMutation.mutateAsync(payload);
      form.reset(values);
      toast({ title: purchaseOrder ? "Draft saved" : "Draft created" });
      onSaved(saved as PurchaseOrder);
    } catch (error: any) {
      toast({ title: "Could not save purchase order", description: error.message, variant: "destructive" });
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <DataCard title="Purchase Order Details" description="Create a draft internal vendor purchase order. The PO number is assigned on first save.">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Vendor</label>
            <Select value={form.watch("vendorId") || undefined} onValueChange={value => form.setValue("vendorId", value, { shouldDirty: true, shouldValidate: true })}>
              <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
              <SelectContent>
                {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {form.formState.errors.vendorId && <div className="text-xs text-destructive">{form.formState.errors.vendorId.message}</div>}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Issue Date</label>
            <Input type="date" {...form.register("issueDate")} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Expected Date</label>
            <Input type="date" {...form.register("expectedDate")} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Subtotal</label>
            <div className="flex h-10 items-center rounded-md border border-titan-border px-3 font-semibold">{money(subtotal)}</div>
          </div>
          <div className="lg:col-span-2">
            <RelatedOrderPicker selected={selectedRelatedOrder} onSelect={handleRelatedOrderSelect} />
          </div>
          <div className="space-y-2 lg:col-span-2">
            <label className="text-sm font-medium">Notes</label>
            <Textarea rows={5} {...form.register("notes")} />
          </div>
        </div>
      </DataCard>

      <DataCard title="Line Items" description="Quantities are vendor purchase units. Material lines retain the inventory conversion that was in effect when the PO was saved.">
        <div className="space-y-3">
          {fields.map((field, index) => {
            const line = watchedLines[index] || defaultLine();
            const lineTotal = Number(line.quantityOrdered || 0) * Number(line.unitCost || 0);
            return (
              <div key={field.id} className="rounded-md border border-titan-border p-3">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
                  <div className="space-y-1 lg:col-span-3">
                    <label className="text-xs font-medium">Material</label>
                    <Select value={line.materialId || "none"} onValueChange={value => handleMaterialSelect(index, value)}>
                      <SelectTrigger><SelectValue placeholder="Manual line" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Manual / misc line</SelectItem>
                        {materials.map((material: Material) => (
                          <SelectItem key={material.id} value={material.id}>{material.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {line.materialId ? (
                      <p className="text-[11px] text-titan-text-muted">
                        1 purchase unit = {Number(line.inventoryUnitsPerPurchaseUnit || 1).toLocaleString()} inventory unit{Number(line.inventoryUnitsPerPurchaseUnit || 1) === 1 ? "" : "s"}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-1 lg:col-span-4">
                    <label className="text-xs font-medium">Description</label>
                    <Input {...form.register(`lineItems.${index}.description` as const)} />
                  </div>
                  <div className="space-y-1 lg:col-span-2">
                    <label className="text-xs font-medium">Vendor SKU</label>
                    <Input {...form.register(`lineItems.${index}.vendorSku` as const)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Purchase Qty</label>
                    <Input type="number" step="0.01" {...form.register(`lineItems.${index}.quantityOrdered` as const, { valueAsNumber: true })} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Price / Purchase Unit</label>
                    <Input type="number" step="0.0001" {...form.register(`lineItems.${index}.unitCost` as const, { valueAsNumber: true })} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Total</label>
                    <div className="flex h-10 items-center rounded-md border border-titan-border px-2 text-sm font-medium">{money(lineTotal)}</div>
                  </div>
                  <div className="space-y-1 lg:col-span-11">
                    <label className="text-xs font-medium">Notes</label>
                    <Input {...form.register(`lineItems.${index}.notes` as const)} />
                  </div>
                  <div className="flex items-end">
                    <Button type="button" variant="ghost" size="sm" onClick={() => remove(index)} disabled={fields.length === 1}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
          <Button type="button" variant="outline" onClick={() => append(defaultLine())}>
            <Plus className="mr-2 h-4 w-4" />
            Add Line
          </Button>
        </div>
      </DataCard>

      <div className="sticky bottom-0 flex items-center justify-between border-t border-titan-border bg-background py-3">
        <div className="text-sm text-titan-text-secondary">
          {form.formState.isDirty ? "Unsaved draft changes" : "Draft matches saved state"}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button type="submit" disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Saving..." : "Save Draft"}
          </Button>
        </div>
      </div>
    </form>
  );
}
