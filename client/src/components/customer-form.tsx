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
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import type { Customer } from "@shared/schema";

const primaryContactSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email"),
  phone: z.string().optional(),
  title: z.string().optional(),
  isPrimary: z.boolean().optional(),
});

const customerSchema = z.object({
  companyName: z.string().min(1, "Company name is required"),
  customerType: z.enum(["business", "individual"]),
  status: z.enum(["active", "inactive", "suspended"]),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  website: z.string().optional(),
  taxId: z.string().optional(),
  // Legacy address fields (kept for backward compatibility)
  billingAddress: z.string().optional(),
  shippingAddress: z.string().optional(),
  // Structured billing address
  billingStreet1: z.string().optional(),
  billingStreet2: z.string().optional(),
  billingCity: z.string().optional(),
  billingState: z.string().optional(),
  billingPostalCode: z.string().optional(),
  billingCountry: z.string().optional(),
  // Structured shipping address
  shippingStreet1: z.string().optional(),
  shippingStreet2: z.string().optional(),
  shippingCity: z.string().optional(),
  shippingState: z.string().optional(),
  shippingPostalCode: z.string().optional(),
  shippingCountry: z.string().optional(),
  creditLimit: z.number().min(0).optional(),
  notes: z.string().optional(),
  primaryContact: primaryContactSchema.optional(),
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
      billingStreet1: customer.billingStreet1 || "",
      billingStreet2: customer.billingStreet2 || "",
      billingCity: customer.billingCity || "",
      billingState: customer.billingState || "",
      billingPostalCode: customer.billingPostalCode || "",
      billingCountry: customer.billingCountry || "",
      shippingStreet1: customer.shippingStreet1 || "",
      shippingStreet2: customer.shippingStreet2 || "",
      shippingCity: customer.shippingCity || "",
      shippingState: customer.shippingState || "",
      shippingPostalCode: customer.shippingPostalCode || "",
      shippingCountry: customer.shippingCountry || "",
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
      billingStreet1: "",
      billingStreet2: "",
      billingCity: "",
      billingState: "",
      billingPostalCode: "",
      billingCountry: "",
      shippingStreet1: "",
      shippingStreet2: "",
      shippingCity: "",
      shippingState: "",
      shippingPostalCode: "",
      shippingCountry: "",
      creditLimit: 0,
      notes: "",
      primaryContact: {
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        title: "",
        isPrimary: true,
      },
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: CustomerFormData) => {
      // Convert creditLimit to string for database and normalize primaryContact
      const { primaryContact, ...rest } = data;

      const hasPrimaryContact = primaryContact && (
        primaryContact.firstName.trim() !== "" ||
        primaryContact.lastName.trim() !== "" ||
        primaryContact.email.trim() !== "" ||
        (primaryContact.phone ?? "").trim() !== "" ||
        (primaryContact.title ?? "").trim() !== ""
      );

      const payload: any = {
        ...rest,
        creditLimit: rest.creditLimit?.toString() || "0",
      };

      if (hasPrimaryContact) {
        payload.primaryContact = {
          firstName: primaryContact.firstName,
          lastName: primaryContact.lastName,
          email: primaryContact.email,
          phone: primaryContact.phone || undefined,
          title: primaryContact.title || undefined,
          isPrimary: primaryContact.isPrimary ?? true,
        };
      }

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
      // Convert creditLimit to string for database (ignore primaryContact on update for now)
      const { primaryContact: _pc, ...rest } = data;
      const payload = {
        ...rest,
        creditLimit: rest.creditLimit?.toString() || "0",
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

          {/* Primary Contact */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Primary Contact</h3>
            <p className="text-sm text-muted-foreground">
              Strongly recommended: add a primary contact for this company.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="primaryFirstName">First Name</Label>
                <Input
                  id="primaryFirstName"
                  {...register("primaryContact.firstName")}
                  placeholder="Jane"
                />
                {errors.primaryContact?.firstName && (
                  <p className="text-sm text-destructive mt-1">{errors.primaryContact.firstName.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="primaryLastName">Last Name</Label>
                <Input
                  id="primaryLastName"
                  {...register("primaryContact.lastName")}
                  placeholder="Doe"
                />
                {errors.primaryContact?.lastName && (
                  <p className="text-sm text-destructive mt-1">{errors.primaryContact.lastName.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="primaryEmail">Email</Label>
                <Input
                  id="primaryEmail"
                  type="email"
                  {...register("primaryContact.email")}
                  placeholder="jane.doe@example.com"
                />
                {errors.primaryContact?.email && (
                  <p className="text-sm text-destructive mt-1">{errors.primaryContact.email.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="primaryPhone">Phone</Label>
                <Input
                  id="primaryPhone"
                  {...register("primaryContact.phone")}
                  placeholder="(555) 987-6543"
                />
              </div>

              <div>
                <Label htmlFor="primaryTitle">Role / Title</Label>
                <Input
                  id="primaryTitle"
                  {...register("primaryContact.title")}
                  placeholder="Buyer, Designer, Accounting, etc."
                />
              </div>

              <div className="flex items-center space-x-2 mt-6">
                <Checkbox
                  id="primaryIsPrimary"
                  checked={watch("primaryContact.isPrimary") ?? true}
                  onCheckedChange={(checked) => setValue("primaryContact.isPrimary", Boolean(checked))}
                />
                <Label htmlFor="primaryIsPrimary">Make this the primary contact</Label>
              </div>
            </div>
          </div>

          {/* Addresses */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Addresses</h3>

            <div className="grid grid-cols-2 gap-6">
              {/* Billing Address */}
              <div className="space-y-3">
                <h4 className="font-medium">Billing Address</h4>
                <div>
                  <Label htmlFor="billingStreet1">Street Address</Label>
                  <Input
                    id="billingStreet1"
                    {...register("billingStreet1")}
                    placeholder="123 Main St"
                  />
                </div>
                <div>
                  <Label htmlFor="billingStreet2">Street Address 2 (Optional)</Label>
                  <Input
                    id="billingStreet2"
                    {...register("billingStreet2")}
                    placeholder="Suite 100"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="billingCity">City</Label>
                    <Input
                      id="billingCity"
                      {...register("billingCity")}
                      placeholder="City"
                    />
                  </div>
                  <div>
                    <Label htmlFor="billingState">State</Label>
                    <Input
                      id="billingState"
                      {...register("billingState")}
                      placeholder="State"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="billingPostalCode">Postal Code</Label>
                    <Input
                      id="billingPostalCode"
                      {...register("billingPostalCode")}
                      placeholder="12345"
                    />
                  </div>
                  <div>
                    <Label htmlFor="billingCountry">Country</Label>
                    <Input
                      id="billingCountry"
                      {...register("billingCountry")}
                      placeholder="USA"
                    />
                  </div>
                </div>
              </div>

              {/* Shipping Address */}
              <div className="space-y-3">
                <h4 className="font-medium">Shipping Address</h4>
                <div>
                  <Label htmlFor="shippingStreet1">Street Address</Label>
                  <Input
                    id="shippingStreet1"
                    {...register("shippingStreet1")}
                    placeholder="123 Main St"
                  />
                </div>
                <div>
                  <Label htmlFor="shippingStreet2">Street Address 2 (Optional)</Label>
                  <Input
                    id="shippingStreet2"
                    {...register("shippingStreet2")}
                    placeholder="Suite 100"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="shippingCity">City</Label>
                    <Input
                      id="shippingCity"
                      {...register("shippingCity")}
                      placeholder="City"
                    />
                  </div>
                  <div>
                    <Label htmlFor="shippingState">State</Label>
                    <Input
                      id="shippingState"
                      {...register("shippingState")}
                      placeholder="State"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="shippingPostalCode">Postal Code</Label>
                    <Input
                      id="shippingPostalCode"
                      {...register("shippingPostalCode")}
                      placeholder="12345"
                    />
                  </div>
                  <div>
                    <Label htmlFor="shippingCountry">Country</Label>
                    <Input
                      id="shippingCountry"
                      {...register("shippingCountry")}
                      placeholder="USA"
                    />
                  </div>
                </div>
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
