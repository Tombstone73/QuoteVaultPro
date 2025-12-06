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
  id: z.string().optional(), // Include id for updating existing primary contact
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
  pricingTier: z.enum(["default", "wholesale", "retail"]).default("default"),
  // Per-customer pricing modifiers
  defaultDiscountPercent: z.coerce.number().min(0).max(100).optional().or(z.nan()).transform(v => isNaN(v as any) ? undefined : v).optional(),
  defaultMarkupPercent: z.coerce.number().min(0).max(500).optional().or(z.nan()).transform(v => isNaN(v as any) ? undefined : v).optional(),
  defaultMarginPercent: z.coerce.number().min(0).max(95).optional().or(z.nan()).transform(v => isNaN(v as any) ? undefined : v).optional(),
  productVisibilityMode: z.enum(["default", "linked-only"]).default("default"),
  // Tax fields
  isTaxExempt: z.boolean().default(false),
  taxRateOverride: z.coerce.number().min(0).max(30).optional().or(z.nan()).transform(v => isNaN(v as any) ? undefined : v).optional(),
  taxExemptReason: z.string().max(255).optional(),
  taxExemptCertificateRef: z.string().max(512).optional(),
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
  // Address behavior
  sameAsBilling: z.boolean().default(true),
  creditLimit: z.number().min(0).optional(),
  notes: z.string().optional(),
  primaryContact: primaryContactSchema.optional(),
});

type CustomerFormData = z.infer<typeof customerSchema>;

// Extended Customer type that may include contacts - works with both Customer and CustomerWithRelations
interface CustomerWithContacts {
  id: string;
  companyName: string;
  displayName?: string | null;
  customerType: string;
  status: string;
  pricingTier?: string | null;
  defaultDiscountPercent?: string | number | null;
  defaultMarkupPercent?: string | number | null;
  defaultMarginPercent?: string | number | null;
  productVisibilityMode?: string | null;
  isTaxExempt?: boolean | null;
  taxRateOverride?: string | number | null;
  taxExemptReason?: string | null;
  taxExemptCertificateRef?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  taxId?: string | null;
  billingAddress?: string | null;
  shippingAddress?: string | null;
  billingStreet1?: string | null;
  billingStreet2?: string | null;
  billingCity?: string | null;
  billingState?: string | null;
  billingPostalCode?: string | null;
  billingCountry?: string | null;
  shippingStreet1?: string | null;
  shippingStreet2?: string | null;
  shippingCity?: string | null;
  shippingState?: string | null;
  shippingPostalCode?: string | null;
  shippingCountry?: string | null;
  creditLimit?: string | number | null;
  notes?: string | null;
  contacts?: Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    title: string | null;
    isPrimary: boolean;
  }>;
  [key: string]: unknown; // Allow additional properties from CustomerWithRelations
}

interface CustomerFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer?: CustomerWithContacts;
}

export default function CustomerForm({ open, onOpenChange, customer }: CustomerFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  const [pendingData, setPendingData] = useState<CustomerFormData | null>(null);

  // Extract existing primary contact from customer if editing
  const existingPrimaryContact = customer?.contacts?.find((c) => c.isPrimary) || customer?.contacts?.[0];

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
      pricingTier: (customer.pricingTier as "default" | "wholesale" | "retail") || "default",
      defaultDiscountPercent: customer.defaultDiscountPercent ? parseFloat(String(customer.defaultDiscountPercent)) : undefined,
      defaultMarkupPercent: customer.defaultMarkupPercent ? parseFloat(String(customer.defaultMarkupPercent)) : undefined,
      defaultMarginPercent: customer.defaultMarginPercent ? parseFloat(String(customer.defaultMarginPercent)) : undefined,
      productVisibilityMode: (customer.productVisibilityMode as "default" | "linked-only") || "default",
      // Tax fields
      isTaxExempt: customer.isTaxExempt || false,
      taxRateOverride: customer.taxRateOverride ? parseFloat(customer.taxRateOverride.toString()) : undefined,
      taxExemptReason: customer.taxExemptReason || "",
      taxExemptCertificateRef: customer.taxExemptCertificateRef || "",
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
      // Determine if billing === shipping
      sameAsBilling: (
        customer.billingStreet1 === customer.shippingStreet1 &&
        customer.billingStreet2 === customer.shippingStreet2 &&
        customer.billingCity === customer.shippingCity &&
        customer.billingState === customer.shippingState &&
        customer.billingPostalCode === customer.shippingPostalCode &&
        customer.billingCountry === customer.shippingCountry
      ),
      creditLimit: customer.creditLimit ? Number(customer.creditLimit) : 0,
      notes: customer.notes || "",
      // Pre-populate primary contact when editing (includes id for update)
      primaryContact: existingPrimaryContact ? {
        id: existingPrimaryContact.id,
        firstName: existingPrimaryContact.firstName || "",
        lastName: existingPrimaryContact.lastName || "",
        email: existingPrimaryContact.email || "",
        phone: existingPrimaryContact.phone || "",
        title: existingPrimaryContact.title || "",
        isPrimary: existingPrimaryContact.isPrimary ?? true,
      } : undefined,
    } : {
      companyName: "",
      customerType: "business",
      status: "active",
      pricingTier: "default",
      defaultDiscountPercent: undefined,
      defaultMarkupPercent: undefined,
      defaultMarginPercent: undefined,
      productVisibilityMode: "default",
      // Tax fields
      isTaxExempt: false,
      taxRateOverride: undefined,
      taxExemptReason: "",
      taxExemptCertificateRef: "",
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
      sameAsBilling: true,
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
      const { primaryContact, sameAsBilling, ...rest } = data;

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
      // Convert creditLimit to string for database
      const { primaryContact, sameAsBilling, ...rest } = data;

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
          // Include id if updating existing contact, so backend can update instead of create
          id: primaryContact.id || undefined,
          firstName: primaryContact.firstName,
          lastName: primaryContact.lastName,
          email: primaryContact.email,
          phone: primaryContact.phone || undefined,
          title: primaryContact.title || undefined,
          isPrimary: primaryContact.isPrimary ?? true,
        };
      }

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
      // Also invalidate contacts query so Contacts panel stays in sync
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast({ title: "Success", description: "Customer updated successfully" });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const onSubmit = async (data: CustomerFormData) => {
    setIsSubmitting(true);
    
    // Handle "same as billing" logic: copy billing to shipping when checked
    let submitData = { ...data };
    if (data.sameAsBilling) {
      submitData.shippingStreet1 = data.billingStreet1;
      submitData.shippingStreet2 = data.billingStreet2;
      submitData.shippingCity = data.billingCity;
      submitData.shippingState = data.billingState;
      submitData.shippingPostalCode = data.billingPostalCode;
      submitData.shippingCountry = data.billingCountry;
    }
    
    try {
      if (customer) {
        await updateMutation.mutateAsync(submitData);
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
            setPendingData(submitData);
            setShowDuplicateWarning(true);
            setIsSubmitting(false);
            return;
          }
        }

        await createMutation.mutateAsync(submitData);
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
  const sameAsBilling = watch("sameAsBilling");

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
          {/* 1. Basic Information */}
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

          {/* 2. Company Contact & Primary Contact */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Company Contact & Primary Contact</h3>
            
            {/* General company contact info */}
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-3">General Contact Information</h4>
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
            <div className="pt-4 border-t">
              <h4 className="text-sm font-medium text-muted-foreground mb-3">Primary Contact Person</h4>
              <p className="text-xs text-muted-foreground mb-3">
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

                <div className="col-span-2">
                  <Label htmlFor="primaryTitle">Role / Title</Label>
                  <Input
                    id="primaryTitle"
                    {...register("primaryContact.title")}
                    placeholder="Buyer, Designer, Accounting, etc."
                  />
                </div>

                <div className="col-span-2 flex items-center space-x-2">
                  <Checkbox
                    id="primaryIsPrimary"
                    checked={watch("primaryContact.isPrimary") ?? true}
                    onCheckedChange={(checked) => setValue("primaryContact.isPrimary", Boolean(checked))}
                  />
                  <Label htmlFor="primaryIsPrimary" className="font-normal cursor-pointer">
                    Make this the primary contact for this company
                  </Label>
                </div>
              </div>
            </div>
          </div>

          {/* 3. Addresses */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Addresses</h3>

            {/* Billing Address */}
            <div className="space-y-3">
              <h4 className="font-medium">Billing Address</h4>
              <div className="grid gap-3">
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
            </div>

            {/* Same as Billing Checkbox */}
            <div className="flex items-center space-x-2 pt-2">
              <Checkbox
                id="sameAsBilling"
                checked={sameAsBilling}
                onCheckedChange={(checked) => setValue("sameAsBilling", Boolean(checked))}
              />
              <Label htmlFor="sameAsBilling" className="font-normal cursor-pointer">
                Billing address is same as shipping
              </Label>
            </div>

            {/* Shipping Address - only show if NOT same as billing */}
            {!sameAsBilling && (
              <div className="space-y-3 pt-2">
                <h4 className="font-medium">Shipping Address</h4>
                <div className="grid gap-3">
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
            )}
          </div>

          {/* 4. Pricing & Terms */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Pricing & Terms</h3>

            <div>
              <Label htmlFor="pricingTier">Pricing Tier *</Label>
              <Select
                value={watch("pricingTier") || "default"}
                onValueChange={(value) => setValue("pricingTier", value as any)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default (Base Pricing)</SelectItem>
                  <SelectItem value="wholesale">Wholesale (Trade Pricing)</SelectItem>
                  <SelectItem value="retail">Retail (Consumer Pricing)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Determines which pricing rates are used in quotes and orders.
              </p>
            </div>

            <div>
              <Label htmlFor="productVisibilityMode">Portal Product Visibility</Label>
              <Select
                value={watch("productVisibilityMode") || "default"}
                onValueChange={(value) => setValue("productVisibilityMode", value as any)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default (All Products Visible)</SelectItem>
                  <SelectItem value="linked-only">Linked Products Only</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Control which products this customer can see in the customer portal.
              </p>
            </div>

            <div className="pt-2">
              <h4 className="text-sm font-medium mb-3">Customer Pricing Modifiers (Optional)</h4>
              <p className="text-xs text-muted-foreground mb-3">
                Apply automatic adjustments to this customer's pricing. Only one modifier can be active at a time. Priority: Margin → Markup → Discount.
              </p>

              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="defaultDiscountPercent">Default Discount %</Label>
                  <Input
                    id="defaultDiscountPercent"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    placeholder="e.g., 10.00"
                    {...register("defaultDiscountPercent")}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Reduce final price (0-100%)
                  </p>
                  {errors.defaultDiscountPercent && (
                    <p className="text-xs text-red-600 mt-1">{errors.defaultDiscountPercent.message}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="defaultMarkupPercent">Default Markup %</Label>
                  <Input
                    id="defaultMarkupPercent"
                    type="number"
                    step="0.01"
                    min="0"
                    max="500"
                    placeholder="e.g., 25.00"
                    {...register("defaultMarkupPercent")}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Increase final price (0-500%)
                  </p>
                  {errors.defaultMarkupPercent && (
                    <p className="text-xs text-red-600 mt-1">{errors.defaultMarkupPercent.message}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="defaultMarginPercent">Default Margin %</Label>
                  <Input
                    id="defaultMarginPercent"
                    type="number"
                    step="0.01"
                    min="0"
                    max="95"
                    placeholder="e.g., 30.00"
                    {...register("defaultMarginPercent")}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Target profit margin (0-95%)
                  </p>
                  {errors.defaultMarginPercent && (
                    <p className="text-xs text-red-600 mt-1">{errors.defaultMarginPercent.message}</p>
                  )}
                </div>
              </div>
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

          {/* 5. Tax Settings & Financial */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Tax Settings & Financial</h3>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="isTaxExempt"
                className="h-4 w-4 rounded border-gray-300"
                {...register("isTaxExempt")}
              />
              <Label htmlFor="isTaxExempt" className="font-normal cursor-pointer">
                Tax Exempt
              </Label>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              If checked, no sales tax will be applied to this customer's orders.
            </p>

            {watch("isTaxExempt") && (
              <>
                <div>
                  <Label htmlFor="taxExemptReason">Tax Exempt Reason *</Label>
                  <Input
                    id="taxExemptReason"
                    placeholder="e.g., 'Resale certificate on file' or 'Non-profit 501(c)(3)'"
                    {...register("taxExemptReason")}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Required when marking customer as tax exempt.
                  </p>
                  {errors.taxExemptReason && (
                    <p className="text-xs text-red-600 mt-1">{errors.taxExemptReason.message}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="taxExemptCertificateRef">Tax Exempt Certificate Reference (Optional)</Label>
                  <Input
                    id="taxExemptCertificateRef"
                    placeholder="e.g., certificate ID, filename, or URL"
                    {...register("taxExemptCertificateRef")}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Optional reference to the certificate on file.
                  </p>
                </div>
              </>
            )}

            {!watch("isTaxExempt") && (
              <div>
                <Label htmlFor="taxRateOverride">Tax Rate Override (%)</Label>
                <Input
                  id="taxRateOverride"
                  type="number"
                  step="0.01"
                  min="0"
                  max="30"
                  placeholder="e.g., 7.50"
                  {...register("taxRateOverride")}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Optional. Overrides the company default tax rate for this customer (0-30%).
                </p>
                {errors.taxRateOverride && (
                  <p className="text-xs text-red-600 mt-1">{errors.taxRateOverride.message}</p>
                )}
              </div>
            )}

            <div>
              <Label htmlFor="taxId">Tax ID / EIN</Label>
              <Input
                id="taxId"
                {...register("taxId")}
                placeholder="12-3456789"
              />
            </div>
          </div>

          {/* 6. Notes */}
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
