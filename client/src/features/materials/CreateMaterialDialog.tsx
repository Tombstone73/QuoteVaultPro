import * as React from "react";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess(
    (v) => (v === "" || v == null || (typeof v === "number" && Number.isNaN(v)) ? undefined : v),
    schema.optional()
  );

const createMaterialSchema = z
  .object({
  name: z.string().trim().min(1, "Material name is required"),
  sku: z.string().trim().min(1, "SKU is required"),
  type: z.enum(["sheet", "roll", "ink", "consumable"]),
  unitOfMeasure: z.enum(["sheet", "sqft", "linear_ft", "ml", "ea"]),
  costPerUnit: z.coerce.number().nonnegative(),
  // Roll-only fields (required only when type === "roll")
  width: optionalNumber(z.coerce.number().nonnegative()),
  rollLengthFt: optionalNumber(z.coerce.number().positive()),
  costPerRoll: optionalNumber(z.coerce.number().positive()),
})
  .superRefine((data, ctx) => {
    if (data.type !== "roll") return;

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
};

export function CreateMaterialDialog({
  onCreated,
  triggerClassName,
}: {
  onCreated: (material: CreatedMaterial) => void;
  triggerClassName?: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);

  const form = useForm<CreateMaterialValues>({
    resolver: zodResolver(createMaterialSchema),
    defaultValues: {
      name: "",
      sku: "",
      type: "sheet",
      unitOfMeasure: "sheet",
      costPerUnit: 0,
      width: undefined,
      rollLengthFt: undefined,
      costPerRoll: undefined,
    },
  });

  const materialType = form.watch("type");
  const isRoll = materialType === "roll";

  React.useEffect(() => {
    if (isRoll) return;
    form.setValue("width", undefined, { shouldDirty: true });
    form.setValue("rollLengthFt", undefined, { shouldDirty: true });
    form.setValue("costPerRoll", undefined, { shouldDirty: true });
    form.clearErrors(["width", "rollLengthFt", "costPerRoll"]);
  }, [isRoll, form]);

  const createMutation = useMutation({
    mutationFn: async (values: CreateMaterialValues) => {
      const res = await apiRequest("POST", "/api/materials", values);
      const json = await res.json();
      const material = (json?.success ? json.data : json) as any;
      if (!material?.id) {
        throw new Error("Create material: missing id in response");
      }
      return material as CreatedMaterial;
    },
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/materials"] });
      onCreated({ id: created.id, name: created.name });
      toast({ title: "Material created", description: created.name });
      setOpen(false);
      form.reset({
        name: "",
        sku: "",
        type: "sheet",
        unitOfMeasure: "sheet",
        costPerUnit: 0,
        width: undefined,
        rollLengthFt: undefined,
        costPerRoll: undefined,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to create material",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="link" size="sm" className={triggerClassName}>
          Add material
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Material</DialogTitle>
          <DialogDescription>Quick add a material, then select it for this product.</DialogDescription>
        </DialogHeader>

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
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="sheet">Sheet</SelectItem>
                        <SelectItem value="roll">Roll</SelectItem>
                        <SelectItem value="ink">Ink</SelectItem>
                        <SelectItem value="consumable">Consumable</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="unitOfMeasure"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unit</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select unit" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="sheet">Sheet</SelectItem>
                        <SelectItem value="sqft">Sqft</SelectItem>
                        <SelectItem value="linear_ft">Linear ft</SelectItem>
                        <SelectItem value="ml">mL</SelectItem>
                        <SelectItem value="ea">Each</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="costPerUnit"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cost / Unit</FormLabel>
                  <FormControl>
                    <Input
                      inputMode="decimal"
                      type="number"
                      step="0.0001"
                      placeholder="0"
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
                onClick={() => setOpen(false)}
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
