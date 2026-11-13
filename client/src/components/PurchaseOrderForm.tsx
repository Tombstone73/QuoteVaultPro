import { useEffect, useRef, useState } from "react";
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
import { purchasePaymentMethods, purchasePaymentTerms, purchaseQuantity, purchaseUnitCost, purchaseLineTotal, purchaseTotals } from "@shared/purchaseOrderWorkflow";
import { useWorkspaceUnsavedChanges } from "@/contexts/navigationGuardRegistration";
import { PurchaseOrderMaterialPicker } from "@/components/PurchaseOrderMaterialPicker";

const lineItemSchema = z.object({
  persistedId: z.string().optional(),
  materialId: z.string().optional().or(z.literal("")),
  description: z.string().trim().min(1, "Description required"),
  vendorSku: z.string().optional().or(z.literal("")),
  quantityOrdered: purchaseQuantity,
  unitCost: purchaseUnitCost,
  inventoryUnitsPerPurchaseUnit: z.coerce.number().positive().default(1),
  notes: z.string().optional().or(z.literal("")),
});

const poSchema = z.object({
  vendorId: z.string().min(1, "Vendor required"),
  relatedOrderId: z.string().nullable().optional(),
  issueDate: z.string().min(1, "Issue date required"),
  expectedDate: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  paymentTerms: z.string().optional(),
  paymentMethod: z.string().optional(),
  paymentInstructions: z.string().max(2000).optional(),
  revisionReason: z.string().max(1000).optional(),
  lineItems: z.array(lineItemSchema).min(1, "At least one line item is required"),
});

export type POFormValues = z.infer<typeof poSchema>;

type Props = {
  purchaseOrder?: PurchaseOrder;
  initialVendorId?: string | null;
  onCancel: () => void;
  onSaved: (purchaseOrder: PurchaseOrder) => void;
  onDirtyChange?: (dirty: boolean) => void;
  readOnly?: boolean;
};

function asDateInput(value: string | null | undefined) {
  return value ? value.substring(0, 10) : "";
}

function money(value: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value));
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
  return { materialId: "", description: "", vendorSku: "", quantityOrdered: "1", unitCost: "0", inventoryUnitsPerPurchaseUnit: 1, notes: "" };
}

function formValues(purchaseOrder?: PurchaseOrder, initialVendorId?: string | null): POFormValues {
  return purchaseOrder ? {
      vendorId: purchaseOrder.vendorId,
      relatedOrderId: purchaseOrder.relatedOrderId ?? null,
      issueDate: asDateInput(purchaseOrder.issueDate),
      expectedDate: asDateInput(purchaseOrder.expectedDate ?? null),
      notes: purchaseOrder.notes || "",
      paymentTerms: purchaseOrder.paymentTerms ?? "",
      paymentMethod: purchaseOrder.paymentMethod ?? "",
      paymentInstructions: purchaseOrder.paymentInstructions ?? "",
      lineItems: purchaseOrder.lineItems.map(li => ({
        persistedId: li.id,
        materialId: li.materialId || "",
        description: li.description,
        vendorSku: li.vendorSku || "",
        quantityOrdered: li.quantityOrdered,
        unitCost: li.unitCost,
        inventoryUnitsPerPurchaseUnit: parseFloat(li.inventoryUnitsPerPurchaseUnit || "1"),
        notes: li.notes || "",
      })),
    } : {
      vendorId: initialVendorId || "",
      relatedOrderId: null,
      issueDate: new Date().toISOString().substring(0, 10),
      expectedDate: "",
      notes: "",
      paymentTerms: "",
      paymentMethod: "",
      paymentInstructions: "",
      lineItems: [defaultLine()],
    };
}

function previewLineTotal(line: POFormValues["lineItems"][number]) {
  const quantity = purchaseQuantity.safeParse(line.quantityOrdered);
  const unitCost = purchaseUnitCost.safeParse(line.unitCost);
  return quantity.success && unitCost.success ? purchaseLineTotal(quantity.data, unitCost.data) : "0.0000";
}

export function PurchaseOrderForm({ purchaseOrder, initialVendorId, onCancel, onSaved, onDirtyChange, readOnly = false }: Props) {
  const { data: vendors = [] } = useVendors({ isActive: true });
  const { data: materials = [] } = useMaterials();
  const { toast } = useToast();
  const createMutation = useCreatePurchaseOrder();
  const updateMutation = useUpdatePurchaseOrder(purchaseOrder?.id || "");
  const [selectedRelatedOrder, setSelectedRelatedOrder] = useState<PurchaseOrderRelatedOrder | null>(purchaseOrder?.relatedOrder ?? null);
  const loadedVersion = useRef(purchaseOrder?.version);
  const submitting = useRef(false);
  const form = useForm<POFormValues>({
    resolver: zodResolver(poSchema),
    defaultValues: formValues(purchaseOrder, initialVendorId),
  });
  const { isDirty, errors } = form.formState;
  const { reset } = form;
  useEffect(() => onDirtyChange?.(isDirty), [isDirty, onDirtyChange]);
  useEffect(() => {
    if (isDirty || submitting.current || !purchaseOrder || loadedVersion.current === purchaseOrder.version) return;
    if (loadedVersion.current !== undefined && purchaseOrder.version < loadedVersion.current) return;
    loadedVersion.current = purchaseOrder.version;
    setSelectedRelatedOrder(purchaseOrder.relatedOrder ?? null);
    reset(formValues(purchaseOrder));
  }, [isDirty, purchaseOrder, reset]);

  useWorkspaceUnsavedChanges(isDirty && !readOnly, purchaseOrder?.poNumber ?? "New Purchase Order");

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lineItems" });
  const watchedLines = form.watch("lineItems");
  const subtotal = purchaseTotals(watchedLines.map(line => ({ lineTotal: previewLineTotal(line) }))).subtotal;
  const saving = createMutation.isPending || updateMutation.isPending;
  const revising = Boolean(purchaseOrder && purchaseOrder.status !== "draft");
  const currentVendor = purchaseOrder?.vendor;

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
    if (Number.isFinite(unitCost)) form.setValue(`lineItems.${index}.unitCost`, String(unitCost), { shouldDirty: true, shouldValidate: true });
    const inventoryUnits = Number(material.inventoryUnitsPerPurchaseUnit ?? 1);
    if (Number.isFinite(inventoryUnits) && inventoryUnits > 0) {
      form.setValue(`lineItems.${index}.inventoryUnitsPerPurchaseUnit`, inventoryUnits, { shouldDirty: true, shouldValidate: true });
    }
    const minimumPurchaseQuantity = Number(material.minimumPurchaseQuantity ?? 1);
    if (Number.isFinite(minimumPurchaseQuantity) && minimumPurchaseQuantity > 0 && Number(form.getValues(`lineItems.${index}.quantityOrdered`)) < minimumPurchaseQuantity) {
      form.setValue(`lineItems.${index}.quantityOrdered`, String(minimumPurchaseQuantity), { shouldDirty: true, shouldValidate: true });
    }
    if (!form.getValues("vendorId") && material.preferredVendorId) {
      form.setValue("vendorId", material.preferredVendorId, { shouldDirty: true, shouldValidate: true });
    }
  }

  async function onSubmit(values: POFormValues) {
    if (submitting.current || readOnly) return;
    if (revising && !values.revisionReason?.trim()) {
      form.setError("revisionReason", { message: "Enter a reason for this revision." });
      return;
    }
    submitting.current = true;
    const payload: CreatePurchaseOrderInput = {
      vendorId: values.vendorId,
      relatedOrderId: values.relatedOrderId ?? null,
      issueDate: values.issueDate,
      expectedDate: values.expectedDate && values.expectedDate.trim() ? values.expectedDate : null,
      notes: values.notes || null,
      paymentTerms: values.paymentTerms || (purchaseOrder ? null : undefined),
      paymentMethod: values.paymentMethod || null,
      paymentInstructions: values.paymentInstructions || null,
      lineItems: values.lineItems.map(li => ({
        id: li.persistedId,
        materialId: li.materialId || null,
        description: li.description.trim(),
        vendorSku: li.vendorSku || null,
        quantityOrdered: li.quantityOrdered,
        unitCost: li.unitCost,
        notes: li.notes || null,
      })),
    };

    try {
      const saved = purchaseOrder
        ? await updateMutation.mutateAsync({ ...payload, expectedVersion: loadedVersion.current ?? 0, revisionReason: values.revisionReason?.trim() || undefined })
        : await createMutation.mutateAsync(payload);
      loadedVersion.current = saved.version;
      setSelectedRelatedOrder(saved.relatedOrder ?? null);
      form.reset(formValues(saved));
      toast({ title: revising ? "Revision saved" : purchaseOrder ? "Draft saved" : "Draft created" });
      onSaved(saved);
    } catch (error) {
      form.setError("root.server", { message: error instanceof Error ? error.message : "Could not save purchase order." });
    } finally {
      submitting.current = false;
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <fieldset disabled={readOnly || saving} className="min-w-0 space-y-4">
      <DataCard title="Purchase Order Details">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Vendor</label>
            <Select value={form.watch("vendorId") || undefined} onValueChange={value => {
              form.setValue("vendorId", value, { shouldDirty: true, shouldValidate: true });
              const vendor = vendors.find(item => item.id === value);
              if (!purchaseOrder && !form.getValues("paymentTerms") && vendor?.paymentTerms) form.setValue("paymentTerms", vendor.paymentTerms, { shouldDirty: true });
            }}>
              <SelectTrigger aria-label="Vendor"><SelectValue placeholder="Select vendor" /></SelectTrigger>
              <SelectContent>
                {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                {currentVendor && !vendors.some(vendor => vendor.id === currentVendor.id) &&
                  <SelectItem value={currentVendor.id}>{currentVendor.name} (inactive)</SelectItem>}
                {!currentVendor && purchaseOrder?.vendorId && !vendors.some(vendor => vendor.id === purchaseOrder.vendorId) &&
                  <SelectItem value={purchaseOrder.vendorId}>Vendor unavailable</SelectItem>}
              </SelectContent>
            </Select>
            {form.formState.errors.vendorId && <div className="text-xs text-destructive">{form.formState.errors.vendorId.message}</div>}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Issue Date</label>
            <Input type="date" aria-label="Issue Date" {...form.register("issueDate")} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Expected Date</label>
            <Input type="date" aria-label="Expected Delivery" {...form.register("expectedDate")} />
          </div>
          <label className="space-y-1 text-sm font-medium">Payment Terms
            <select aria-label="Payment Terms" className="block h-10 w-full rounded-md border bg-background px-2" {...form.register("paymentTerms")}>
              <option value="">Not set</option>
              {purchasePaymentTerms.map(term => <option key={term.value} value={term.value}>{term.label}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium">Payment Method
            <select aria-label="Payment Method" className="block h-10 w-full rounded-md border bg-background px-2" {...form.register("paymentMethod")}>
              <option value="">Not set</option>
              {purchasePaymentMethods.map(method => <option key={method.id} value={method.id}>{method.label}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium lg:col-span-2">Payment Instructions
            <Input maxLength={2000} {...form.register("paymentInstructions")} />
          </label>
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
            const lineTotal = previewLineTotal(line);
            const savedLine = purchaseOrder?.lineItems.find(item => item.id === line.persistedId);
            return (
              <div key={field.id} className="rounded-md border border-titan-border p-3">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
                  <div className="space-y-1 lg:col-span-3">
                    <label className="text-xs font-medium">Material</label>
                    <PurchaseOrderMaterialPicker materials={materials} value={line.materialId} savedDescription={line.description}
                      onChange={(materialId) => handleMaterialSelect(index, materialId)} />
                    {line.materialId ? (
                      <p className="text-[11px] text-titan-text-muted">
                        1 purchase unit = {Number(line.inventoryUnitsPerPurchaseUnit || 1).toLocaleString()} inventory unit{Number(line.inventoryUnitsPerPurchaseUnit || 1) === 1 ? "" : "s"}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-1 lg:col-span-4">
                    <label className="text-xs font-medium">Description</label>
                    <Input aria-label={`Description for line ${index + 1}`} {...form.register(`lineItems.${index}.description` as const)} />
                  </div>
                  <div className="space-y-1 lg:col-span-2">
                    <label className="text-xs font-medium">Vendor SKU</label>
                    <Input {...form.register(`lineItems.${index}.vendorSku` as const)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Purchase Qty</label>
                    <Input type="number" step="0.01" aria-label={`Purchase quantity for line ${index + 1}`} {...form.register(`lineItems.${index}.quantityOrdered` as const)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Price / Purchase Unit</label>
                    <Input type="number" step="0.0001" aria-label={`Purchase unit cost for line ${index + 1}`} {...form.register(`lineItems.${index}.unitCost` as const)} />
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
                    <Button type="button" variant="ghost" size="sm" aria-label={`Remove line ${index + 1}`} onClick={() => remove(index)}
                      disabled={fields.length === 1 || Boolean(savedLine && (Number(savedLine.quantityReceived) > 0 || purchaseOrder?.actualCosts[savedLine.id]))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {errors.lineItems?.[index] && <p role="alert" className="mt-2 text-sm text-destructive">
                  {(["description", "quantityOrdered", "unitCost", "vendorSku"] as const).map(key =>
                    errors.lineItems?.[index]?.[key]?.message).filter(Boolean).join(" ")}
                </p>}
              </div>
            );
          })}
          <Button type="button" variant="outline" onClick={() => append(defaultLine())}>
            <Plus className="mr-2 h-4 w-4" />
            Add Line
          </Button>
        </div>
      </DataCard>

      {revising && !readOnly && <label className="block space-y-1 text-sm font-medium">Revision reason
        <Textarea maxLength={1000} {...form.register("revisionReason")} />
        {errors.revisionReason && <span role="alert" className="text-destructive">{errors.revisionReason.message}</span>}
      </label>}
      {errors.root?.server && <p role="alert" className="text-sm text-destructive">{errors.root.server.message}</p>}
      {!readOnly && <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-titan-border bg-background py-3">
        <div className="text-sm text-titan-text-secondary">
          {isDirty ? "Unsaved changes" : "Matches saved purchase order"}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button type="submit" disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Saving..." : revising ? "Save Revision" : "Save Draft"}
          </Button>
        </div>
      </div>}
      </fieldset>
    </form>
  );
}
