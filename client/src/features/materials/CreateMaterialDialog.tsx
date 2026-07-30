import * as React from "react";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";

const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess(
    (v) => (v === "" || v == null || (typeof v === "number" && Number.isNaN(v)) ? undefined : v),
    schema.optional()
  );

const FORM_UNIT_OPTIONS = {
  roll: { inventory: ["square_foot", "linear_foot"], consumption: ["square_foot", "linear_foot"] },
  sheet: { inventory: ["sheet", "square_foot"], consumption: ["sheet", "square_foot"] },
  liquid: { inventory: ["milliliter"], consumption: ["milliliter"] },
  each: { inventory: ["each"], consumption: ["each"] },
  bulk_weight: { inventory: ["pound"], consumption: ["pound"] },
} as const;

const createMaterialSchema = z
  .object({
  name: z.string().trim().min(1, "Material name is required"),
  sku: z.string().trim().min(1, "SKU is required"),
  materialForm: z.enum(["sheet", "roll", "liquid", "each", "bulk_weight"]),
  inventoryUnit: z.enum(["square_foot", "linear_foot", "sheet", "each", "milliliter", "pound"]),
  consumptionUnit: z.enum(["square_foot", "linear_foot", "sheet", "each", "milliliter", "pound"]),
  // Roll-only fields
  width: optionalNumber(z.coerce.number().nonnegative()),
  rollLengthFt: optionalNumber(z.coerce.number().positive()),
  costPerRoll: optionalNumber(z.coerce.number().positive()),
})
  .superRefine((data, ctx) => {
    const allowed = FORM_UNIT_OPTIONS[data.materialForm];
    if (!(allowed.inventory as readonly string[]).includes(data.inventoryUnit)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inventoryUnit"], message: "Inventory unit is not valid for this material form" });
    }
    if (!(allowed.consumption as readonly string[]).includes(data.consumptionUnit)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["consumptionUnit"], message: "Consumption unit is not valid for this material form" });
    }
    if (data.materialForm !== "roll") return;

    const isPos = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
    if (!isPos(data.width)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["width"], message: "Roll width is required" });
    }
    if (!isPos(data.rollLengthFt)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rollLengthFt"], message: "Roll length is required" });
    }
    if (!isPos(data.costPerRoll)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["costPerRoll"], message: "Vendor roll cost is required" });
    }
  });

type CreateMaterialValues = z.infer<typeof createMaterialSchema>;

type CreatedMaterial = {
  id: string;
  name: string;
  inventoryUnit?: string;
};

type CreateMaterialResult = {
  material: CreatedMaterial;
  duplicate: boolean;
};

export function CreateMaterialDialog({
  onCreated,
  triggerClassName,
  open,
  onOpenChange,
  hideTrigger,
}: {
  onCreated: (material: CreatedMaterial) => void;
  triggerClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const isControlled = typeof open === "boolean";
  const dialogOpen = isControlled ? !!open : uncontrolledOpen;
  const setDialogOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [isControlled, onOpenChange]
  );

  const form = useForm<CreateMaterialValues>({
    resolver: zodResolver(createMaterialSchema),
    defaultValues: {
      name: "",
      sku: "",
      materialForm: "sheet",
      inventoryUnit: "sheet",
      consumptionUnit: "sheet",
      width: undefined,
      rollLengthFt: undefined,
      costPerRoll: undefined,
    },
  });

  const materialForm = form.watch("materialForm");
  const isRoll = materialForm === "roll";
  const inventoryUnit = form.watch("inventoryUnit");
  const consumptionUnit = form.watch("consumptionUnit");
  const allowedUnits = FORM_UNIT_OPTIONS[materialForm];

  React.useEffect(() => {
    if (!(allowedUnits.inventory as readonly string[]).includes(inventoryUnit)) form.setValue("inventoryUnit", allowedUnits.inventory[0] as any);
    if (!(allowedUnits.consumption as readonly string[]).includes(consumptionUnit)) form.setValue("consumptionUnit", allowedUnits.consumption[0] as any);
    if (!isRoll) {
      form.setValue("width", undefined, { shouldDirty: true });
      form.setValue("rollLengthFt", undefined, { shouldDirty: true });
      form.setValue("costPerRoll", undefined, { shouldDirty: true });
      form.clearErrors(["width", "rollLengthFt", "costPerRoll"]);
    }
  }, [allowedUnits, consumptionUnit, form, inventoryUnit, isRoll]);

  const createMutation = useMutation({
    mutationFn: async (values: CreateMaterialValues) => {
      const res = await fetch("/api/materials", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, costPerUnit: 0 }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        const message = json?.error || json?.message || `Failed to create material (${res.status})`;
        const existing = json?.data?.material || json?.data || json?.material;
        if (res.status === 409 && existing?.id) {
          return {
            material: {
              id: existing.id,
              name: existing.name,
              inventoryUnit: existing.inventoryUnit,
            },
            duplicate: true,
          } as CreateMaterialResult;
        }
        throw new Error(message);
      }

      const payload = json?.success ? json : { success: true, data: json };
      const material = payload?.data?.material || payload?.data || payload?.material;
      const duplicate = payload?.duplicate === true || payload?.data?.duplicate === true;

      if (!material?.id) {
        throw new Error("Create material: missing id in response");
      }

      return {
        material: {
          id: material.id,
          name: material.name,
          inventoryUnit: material.inventoryUnit,
        },
        duplicate,
      } as CreateMaterialResult;
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/materials"] });
      onCreated({ id: result.material.id, name: result.material.name, inventoryUnit: result.material.inventoryUnit });
      toast({
        title: result.duplicate ? "Material already exists" : "Material created",
        description: result.duplicate
          ? "Material already exists, selected it."
          : result.material.name,
      });
      setDialogOpen(false);
      form.reset({
        name: "",
        sku: "",
        materialForm: "sheet",
        inventoryUnit: "sheet",
        consumptionUnit: "sheet",
        width: undefined,
        rollLengthFt: undefined,
        costPerRoll: undefined,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Unable to create material",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      {!hideTrigger ? (
        <DialogTrigger asChild>
          <Button type="button" variant="link" size="sm" className={triggerClassName}>
            Add material
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Material</DialogTitle>
          <DialogDescription>
            Quick add a base material for product setup. Full inventory, supplier, and reorder configuration belongs in Settings &gt; Inventory &amp; Procurement.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          This shortcut creates a permanent material with the physical inventory configuration required for product setup. Supplier and reorder details can be completed in Inventory &amp; Procurement.
          <div className="mt-2">
            <Button asChild type="button" variant="link" size="sm" className="h-auto px-0 text-amber-900">
              <Link to="/settings/inventory">Manage full material inventory settings in Settings &gt; Inventory &amp; Procurement.</Link>
            </Button>
          </div>
        </div>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g., 13oz Scrim Vinyl" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="sku"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>SKU</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g., SCRIM-13OZ" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="materialForm"
                render={({ field }) => (
                  <FormItem>
                  <FormLabel>Material Form</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select form" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="sheet">Sheet</SelectItem>
                        <SelectItem value="roll">Roll</SelectItem>
                        <SelectItem value="liquid">Liquid</SelectItem>
                        <SelectItem value="each">Each item</SelectItem>
                        <SelectItem value="bulk_weight">Bulk weight</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="inventoryUnit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Inventory Unit</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select unit" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {allowedUnits.inventory.includes("sheet" as never) ? <SelectItem value="sheet">Sheet</SelectItem> : null}
                        {allowedUnits.inventory.includes("square_foot" as never) ? <SelectItem value="square_foot">Square foot</SelectItem> : null}
                        {allowedUnits.inventory.includes("linear_foot" as never) ? <SelectItem value="linear_foot">Linear foot</SelectItem> : null}
                        {allowedUnits.inventory.includes("milliliter" as never) ? <SelectItem value="milliliter">Milliliter</SelectItem> : null}
                        {allowedUnits.inventory.includes("each" as never) ? <SelectItem value="each">Each</SelectItem> : null}
                        {allowedUnits.inventory.includes("pound" as never) ? <SelectItem value="pound">Pound</SelectItem> : null}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="consumptionUnit"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Consumption Unit</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select unit" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {allowedUnits.consumption.includes("square_foot" as never) ? <SelectItem value="square_foot">Square foot</SelectItem> : null}
                      {allowedUnits.consumption.includes("linear_foot" as never) ? <SelectItem value="linear_foot">Linear foot</SelectItem> : null}
                      {allowedUnits.consumption.includes("sheet" as never) ? <SelectItem value="sheet">Sheet</SelectItem> : null}
                      {allowedUnits.consumption.includes("each" as never) ? <SelectItem value="each">Each</SelectItem> : null}
                      {allowedUnits.consumption.includes("milliliter" as never) ? <SelectItem value="milliliter">Milliliter</SelectItem> : null}
                      {allowedUnits.consumption.includes("pound" as never) ? <SelectItem value="pound">Pound</SelectItem> : null}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">The unit used by production requirements. Product sell units and pricing are configured on the product.</p>
                  <FormMessage />
                </FormItem>
              )}
            />

            {isRoll ? (
              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="width"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Roll Width (in)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="e.g., 54"
                          value={field.value ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            field.onChange(v === "" ? undefined : Number(v));
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="rollLengthFt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Roll Length (ft)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="e.g., 150"
                          value={field.value ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            field.onChange(v === "" ? undefined : Number(v));
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="costPerRoll"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vendor Roll Cost ($)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="e.g., 199"
                          value={field.value ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            field.onChange(v === "" ? undefined : Number(v));
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
