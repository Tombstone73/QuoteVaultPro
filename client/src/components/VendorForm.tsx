import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCreateVendor, useUpdateVendor, Vendor } from "@/hooks/useVendors";
import { useToast } from "@/hooks/use-toast";

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function isValidWebsite(value: string) {
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
    const parsed = new URL(candidate);
    return Boolean(parsed.hostname) && parsed.hostname.includes(".");
  } catch {
    return false;
  }
}

const optionalEmailSchema = z.preprocess(
  normalizeOptionalString,
  z.string().email("Enter a valid email address").optional(),
);

const optionalTextSchema = (maxLength?: number) => z.preprocess(
  normalizeOptionalString,
  typeof maxLength === "number"
    ? z.string().max(maxLength, `Must be ${maxLength} characters or fewer`).optional()
    : z.string().optional(),
);

const optionalWebsiteSchema = z.preprocess(
  normalizeOptionalString,
  z.string()
    .max(255, "Website must be 255 characters or fewer")
    .refine(isValidWebsite, "Enter a valid website like example.com or https://example.com")
    .optional(),
);

const vendorSchema = z.object({
  name: z.string().min(1, "Name required"),
  email: optionalEmailSchema,
  phone: optionalTextSchema(50),
  salesRepName: optionalTextSchema(255),
  salesRepEmail: optionalEmailSchema,
  salesRepPhone: optionalTextSchema(50),
  website: optionalWebsiteSchema,
  notes: optionalTextSchema(),
  additionalContactInfo: optionalTextSchema(),
  paymentTerms: z.enum(['due_on_receipt','net_15','net_30','net_45','custom']).default('due_on_receipt'),
  defaultLeadTimeDays: z.coerce.number().int().positive("Lead time days must be greater than 0").optional().or(z.nan()).transform(v => isNaN(v as any) ? undefined : v),
  leadTimeText: optionalTextSchema(120),
  isActive: z.preprocess((value) => value === "true" ? true : value === "false" ? false : value, z.boolean().default(true)),
});

export type VendorFormValues = z.infer<typeof vendorSchema>;

interface Props { open: boolean; onOpenChange: (o:boolean)=>void; vendor?: Vendor; }

export function VendorForm({ open, onOpenChange, vendor }: Props) {
  const { toast } = useToast();
  const createMutation = useCreateVendor();
  const updateMutation = useUpdateVendor(vendor?.id || "");
  const form = useForm<VendorFormValues>({
    resolver: zodResolver(vendorSchema),
    defaultValues: vendor ? {
      name: vendor.name,
      email: vendor.email || "",
      phone: vendor.phone || "",
      salesRepName: vendor.salesRepName || "",
      salesRepEmail: vendor.salesRepEmail || "",
      salesRepPhone: vendor.salesRepPhone || "",
      website: vendor.website || "",
      notes: vendor.notes || "",
      additionalContactInfo: vendor.additionalContactInfo || "",
      paymentTerms: vendor.paymentTerms as any,
      defaultLeadTimeDays: vendor.defaultLeadTimeDays || undefined,
      leadTimeText: vendor.leadTimeText || "",
      isActive: vendor.isActive,
    } : {
      name: "",
      email: "",
      phone: "",
      salesRepName: "",
      salesRepEmail: "",
      salesRepPhone: "",
      website: "",
      notes: "",
      additionalContactInfo: "",
      paymentTerms: 'due_on_receipt',
      defaultLeadTimeDays: undefined,
      leadTimeText: "",
      isActive: true,
    }
  });
  const errors = form.formState.errors;

  function renderFieldError(message?: string) {
    if (!message) return null;
    return <p className="mt-1 text-xs text-destructive">{message}</p>;
  }

  async function onSubmit(values: VendorFormValues) {
    const payload: any = {
      ...values,
      email: values.email ?? undefined,
      phone: values.phone ?? undefined,
      salesRepName: values.salesRepName ?? undefined,
      salesRepEmail: values.salesRepEmail ?? undefined,
      salesRepPhone: values.salesRepPhone ?? undefined,
      website: values.website ?? undefined,
      notes: values.notes ?? undefined,
      additionalContactInfo: values.additionalContactInfo ?? undefined,
      defaultLeadTimeDays: values.defaultLeadTimeDays,
      leadTimeText: values.leadTimeText ?? undefined,
      isActive: values.isActive,
    };
    try {
      if (vendor) {
        await updateMutation.mutateAsync(payload);
      } else {
        await createMutation.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch {
      return;
    }
  }

  function onInvalidSubmit() {
    toast({
      title: "Fix vendor form errors",
      description: "Check the highlighted fields and try again.",
      variant: "destructive",
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{vendor?"Edit Vendor":"Create Vendor"}</DialogTitle>
          <DialogDescription>Manage supplier information.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit, onInvalidSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input {...form.register("name")}/>
              {renderFieldError(errors.name?.message)}
            </div>
            <div>
              <label className="text-sm font-medium">Email</label>
              <Input type="email" {...form.register("email")}/>
              {renderFieldError(errors.email?.message)}
            </div>
            <div>
              <label className="text-sm font-medium">Phone</label>
              <Input {...form.register("phone")}/>
              {renderFieldError(errors.phone?.message)}
            </div>
            <div>
              <label className="text-sm font-medium">Sales Rep Name</label>
              <Input {...form.register("salesRepName")}/>
              {renderFieldError(errors.salesRepName?.message)}
            </div>
            <div>
              <label className="text-sm font-medium">Sales Rep Email</label>
              <Input type="email" {...form.register("salesRepEmail")}/>
              {renderFieldError(errors.salesRepEmail?.message)}
            </div>
            <div>
              <label className="text-sm font-medium">Sales Rep Phone</label>
              <Input {...form.register("salesRepPhone")}/>
              {renderFieldError(errors.salesRepPhone?.message)}
            </div>
            <div>
              <label className="text-sm font-medium">Website</label>
              <Input {...form.register("website")}/>
              {renderFieldError(errors.website?.message)}
            </div>
            <div>
              <label className="text-sm font-medium">Payment Terms</label>
              <Select value={form.watch("paymentTerms")} onValueChange={v => form.setValue("paymentTerms", v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="due_on_receipt">Due on Receipt</SelectItem>
                  <SelectItem value="net_15">Net 15</SelectItem>
                  <SelectItem value="net_30">Net 30</SelectItem>
                  <SelectItem value="net_45">Net 45</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
              {renderFieldError(errors.paymentTerms?.message)}
            </div>
            <div>
              <label className="text-sm font-medium">Lead Time (Days)</label>
              <Input type="number" {...form.register("defaultLeadTimeDays", { valueAsNumber: true })}/>
              {renderFieldError(errors.defaultLeadTimeDays?.message)}
            </div>
            <div className="col-span-2">
              <label className="text-sm font-medium">Lead Time Notes</label>
              <Input placeholder="Same day, 2-4 days, call rep first" {...form.register("leadTimeText")}/>
              {renderFieldError(errors.leadTimeText?.message)}
            </div>
            <div className="col-span-2">
              <label className="text-sm font-medium">Notes</label>
              <Textarea rows={3} {...form.register("notes")}/>
              {renderFieldError(errors.notes?.message)}
            </div>
            <div className="col-span-2">
              <label className="text-sm font-medium">Additional Contact Info</label>
              <Textarea rows={3} {...form.register("additionalContactInfo")}/>
              {renderFieldError(errors.additionalContactInfo?.message)}
            </div>
            <div>
              <label className="text-sm font-medium">Active?</label>
              <select className="border rounded px-2 py-1 text-sm" {...form.register("isActive")}>
                <option value={true as any}>Yes</option>
                <option value={false as any}>No</option>
              </select>
              {renderFieldError(errors.isActive?.message)}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={()=> onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>{vendor?"Save":"Create"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
