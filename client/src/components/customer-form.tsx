import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type { Customer } from "@shared/schema";

const customerSchema = z.object({
  companyName: z.string().min(1, "Company name is required"),
  customerType: z.enum(["business", "individual"]),
  status: z.enum(["active", "inactive", "suspended"]),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  website: z.string().optional(),
  taxId: z.string().optional(),
  billingAddress: z.string().optional(),
  shippingAddress: z.string().optional(),
  creditLimit: z.number().min(0).optional(),
  notes: z.string().optional(),
});

type CustomerFormData = z.infer<typeof customerSchema>;

interface CustomerFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer?: Customer;
}

export default function CustomerForm({ open, onOpenChange, customer }: CustomerFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  const [pendingData, setPendingData] = useState<CustomerFormData | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
    reset,
  } = useForm<CustomerFormData>({
    resolver: zodResolver(customerSchema),
    defaultValues: customer ? {
      companyName: customer.companyName,
      customerType: customer.customerType as "business" | "individual",
      status: customer.status as "active" | "inactive" | "suspended",
      email: customer.email || "",
      phone: customer.phone || "",
      website: customer.website || "",
      taxId: customer.taxId || "",
      billingAddress: customer.billingAddress || "",
      shippingAddress: customer.shippingAddress || "",
      creditLimit: customer.creditLimit ? Number(customer.creditLimit) : 0,
      notes: customer.notes || "",
    } : {
      companyName: "",
      customerType: "business",
      status: "active",
      email: "",
      phone: "",
      website: "",
      taxId: "",
      billingAddress: "",
      shippingAddress: "",
      creditLimit: 0,
      notes: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: CustomerFormData) => {
      // Convert creditLimit to string for database
      const payload = {
        ...data,
        creditLimit: data.creditLimit?.toString() || "0",
      };
      const response = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create customer");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      toast({ title: "Success", description: "Customer created successfully" });
      reset();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: CustomerFormData) => {
      // Convert creditLimit to string for database
      const payload = {
        ...data,
        creditLimit: data.creditLimit?.toString() || "0",
      };
      const response = await fetch(`/api/customers/${customer?.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to update customer");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/customers/${customer?.id}`] });
      toast({ title: "Success", description: "Customer updated successfully" });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const onSubmit = async (data: CustomerFormData) => {
    setIsSubmitting(true);
    try {
      if (customer) {
        await updateMutation.mutateAsync(data);
      } else {
        // Check for duplicate company name
        const response = await fetch(`/api/customers?search=${encodeURIComponent(data.companyName)}`, {
          credentials: "include",
        });
        if (response.ok) {
          const existingCustomers = await response.json();
          const exactMatch = existingCustomers.find(
            (c: any) => c.companyName.toLowerCase() === data.companyName.toLowerCase()
          );

          if (exactMatch) {
            setPendingData(data);
            setShowDuplicateWarning(true);
            setIsSubmitting(false);
            return;
          }
        }

        await createMutation.mutateAsync(data);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDuplicate = async () => {
    if (pendingData) {
      setShowDuplicateWarning(false);
      setIsSubmitting(true);
      try {
        await createMutation.mutateAsync(pendingData);
      } finally {
        setIsSubmitting(false);
        setPendingData(null);
      }
    }
  };

  const handleCancelDuplicate = () => {
    setShowDuplicateWarning(false);
    setPendingData(null);
  };

  const customerType = watch("customerType");
  const status = watch("status");

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{customer ? "Edit Company" : "New Company"}</DialogTitle>
          <DialogDescription>
            {customer ? "Update company information" : "Add a new company to your database"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Basic Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Basic Information</h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label htmlFor="companyName">Company Name *</Label>
                <Input
                  id="companyName"
                  {...register("companyName")}
                  placeholder="Acme Corporation"
                />
                {errors.companyName && (
                  <p className="text-sm text-destructive mt-1">{errors.companyName.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="customerType">Customer Type *</Label>
                <Select
                  value={customerType}
                  onValueChange={(value) => setValue("customerType", value as any)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="business">Business</SelectItem>
                    <SelectItem value="individual">Individual</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="status">Status *</Label>
                <Select
                  value={status}
                  onValueChange={(value) => setValue("status", value as any)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Contact Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Contact Information</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  {...register("email")}
                  placeholder="contact@acme.com"
                />
                {errors.email && (
                  <p className="text-sm text-destructive mt-1">{errors.email.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  {...register("phone")}
                  placeholder="(555) 123-4567"
                />
              </div>

              <div className="col-span-2">
                <Label htmlFor="website">Website</Label>
                <Input
                  id="website"
                  {...register("website")}
                  placeholder="https://acme.com"
                />
                {errors.website && (
                  <p className="text-sm text-destructive mt-1">{errors.website.message}</p>
                )}
              </div>
            </div>
          </div>

          {/* Addresses */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Addresses</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="billingAddress">Billing Address</Label>
                <Textarea
                  id="billingAddress"
                  {...register("billingAddress")}
                  placeholder="123 Main St, City, State 12345"
                  rows={3}
                />
              </div>

              <div>
                <Label htmlFor="shippingAddress">Shipping Address</Label>
                <Textarea
                  id="shippingAddress"
                  {...register("shippingAddress")}
                  placeholder="123 Main St, City, State 12345"
                  rows={3}
                />
              </div>
            </div>
          </div>

          {/* Financial Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Financial Information</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="taxId">Tax ID / EIN</Label>
                <Input
                  id="taxId"
                  {...register("taxId")}
                  placeholder="12-3456789"
                />
              </div>

              <div>
                <Label htmlFor="creditLimit">Credit Limit ($)</Label>
                <Input
                  id="creditLimit"
                  type="number"
                  step="0.01"
                  {...register("creditLimit", { valueAsNumber: true })}
                  placeholder="0.00"
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Notes</h3>
            <Textarea
              id="notes"
              {...register("notes")}
              placeholder="Additional notes about this customer..."
              rows={4}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : customer ? "Update Company" : "Create Company"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>

    <AlertDialog open={showDuplicateWarning} onOpenChange={setShowDuplicateWarning}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Duplicate Company Name</AlertDialogTitle>
          <AlertDialogDescription>
            A company with the name "{pendingData?.companyName}" already exists. Are you sure you want to create another company with the same name?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancelDuplicate}>
            No, Keep Editing
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirmDuplicate}>
            Yes, Create Anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
