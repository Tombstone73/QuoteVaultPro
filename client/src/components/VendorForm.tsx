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

const vendorSchema = z.object({
  name: z.string().min(1, "Name required"),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  website: z.string().url().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  paymentTerms: z.enum(['due_on_receipt','net_15','net_30','net_45','custom']).default('due_on_receipt'),
  defaultLeadTimeDays: z.coerce.number().int().positive().optional().or(z.nan()).transform(v => isNaN(v as any) ? undefined : v),
  isActive: z.boolean().default(true),
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
      website: vendor.website || "",
      notes: vendor.notes || "",
      paymentTerms: vendor.paymentTerms as any,
      defaultLeadTimeDays: vendor.defaultLeadTimeDays || undefined,
      isActive: vendor.isActive,
    } : {
      name: "",
      email: "",
      phone: "",
      website: "",
      notes: "",
      paymentTerms: 'due_on_receipt',
      defaultLeadTimeDays: undefined,
      isActive: true,
    }
  });

  async function onSubmit(values: VendorFormValues) {
    const payload: any = {
      ...values,
      email: values.email || undefined,
      phone: values.phone || undefined,
      website: values.website || undefined,
      notes: values.notes || undefined,
      defaultLeadTimeDays: values.defaultLeadTimeDays,
    };
    try {
      if (vendor) {
        await updateMutation.mutateAsync(payload);
        toast({ title: "Vendor updated" });
      } else {
        await createMutation.mutateAsync(payload);
        toast({ title: "Vendor created" });
      }
      onOpenChange(false);
    } catch (e:any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{vendor?"Edit Vendor":"Create Vendor"}</DialogTitle>
          <DialogDescription>Manage supplier information.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input {...form.register("name")}/>
            </div>
            <div>
              <label className="text-sm font-medium">Email</label>
              <Input type="email" {...form.register("email")}/>
            </div>
            <div>
              <label className="text-sm font-medium">Phone</label>
              <Input {...form.register("phone")}/>
            </div>
            <div>
              <label className="text-sm font-medium">Website</label>
              <Input {...form.register("website")}/>
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
            </div>
            <div>
              <label className="text-sm font-medium">Lead Time (Days)</label>
              <Input type="number" {...form.register("defaultLeadTimeDays", { valueAsNumber: true })}/>
            </div>
            <div className="col-span-2">
              <label className="text-sm font-medium">Notes</label>
              <Textarea rows={3} {...form.register("notes")}/>
            </div>
            <div>
              <label className="text-sm font-medium">Active?</label>
              <select className="border rounded px-2 py-1 text-sm" {...form.register("isActive")}>
                <option value={true as any}>Yes</option>
                <option value={false as any}>No</option>
              </select>
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
