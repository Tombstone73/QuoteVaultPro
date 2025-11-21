import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";

const contactSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  title: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  isPrimary: z.boolean().default(false),
  isBilling: z.boolean().default(false),
  isShipping: z.boolean().default(false),
  canAccessPortal: z.boolean().default(false),
});

type ContactFormData = z.infer<typeof contactSchema>;

interface ContactFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  contact?: any;
}

export default function ContactForm({ open, onOpenChange, customerId, contact }: ContactFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
    reset,
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
    defaultValues: contact ? {
      firstName: contact.firstName,
      lastName: contact.lastName,
      title: contact.title || "",
      email: contact.email || "",
      phone: contact.phone || "",
      isPrimary: contact.isPrimary || false,
      isBilling: contact.isBilling || false,
      isShipping: contact.isShipping || false,
      canAccessPortal: contact.canAccessPortal || false,
    } : {
      firstName: "",
      lastName: "",
      title: "",
      email: "",
      phone: "",
      isPrimary: false,
      isBilling: false,
      isShipping: false,
      canAccessPortal: false,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: ContactFormData) => {
      const response = await fetch(`/api/customers/${customerId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to create contact");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/customers/${customerId}`] });
      toast({ title: "Success", description: "Contact created successfully" });
      reset();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: ContactFormData) => {
      const response = await fetch(`/api/customer-contacts/${contact?.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to update contact");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/customers/${customerId}`] });
      toast({ title: "Success", description: "Contact updated successfully" });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const onSubmit = async (data: ContactFormData) => {
    setIsSubmitting(true);
    try {
      if (contact) {
        await updateMutation.mutateAsync(data);
      } else {
        await createMutation.mutateAsync(data);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const isPrimary = watch("isPrimary");
  const isBilling = watch("isBilling");
  const isShipping = watch("isShipping");
  const canAccessPortal = watch("canAccessPortal");

  // Reset form when contact changes or dialog opens
  useEffect(() => {
    if (open) {
      if (contact) {
        reset({
          firstName: contact.firstName,
          lastName: contact.lastName,
          title: contact.title || "",
          email: contact.email || "",
          phone: contact.phone || "",
          isPrimary: contact.isPrimary || false,
          isBilling: contact.isBilling || false,
          isShipping: contact.isShipping || false,
          canAccessPortal: contact.canAccessPortal || false,
        });
      } else {
        reset({
          firstName: "",
          lastName: "",
          title: "",
          email: "",
          phone: "",
          isPrimary: false,
          isBilling: false,
          isShipping: false,
          canAccessPortal: false,
        });
      }
    }
  }, [open, contact, reset]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{contact ? "Edit Contact" : "New Contact"}</DialogTitle>
          <DialogDescription>
            {contact ? "Update contact information" : "Add a new contact for this customer"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Basic Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Basic Information</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  {...register("firstName")}
                  placeholder="John"
                />
                {errors.firstName && (
                  <p className="text-sm text-destructive mt-1">{errors.firstName.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="lastName">Last Name *</Label>
                <Input
                  id="lastName"
                  {...register("lastName")}
                  placeholder="Doe"
                />
                {errors.lastName && (
                  <p className="text-sm text-destructive mt-1">{errors.lastName.message}</p>
                )}
              </div>

              <div className="col-span-2">
                <Label htmlFor="title">Title / Position</Label>
                <Input
                  id="title"
                  {...register("title")}
                  placeholder="Sales Manager"
                />
              </div>

              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  {...register("email")}
                  placeholder="john.doe@company.com"
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
            </div>
          </div>

          {/* Contact Roles */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Contact Roles</h3>

            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="isPrimary"
                  checked={isPrimary}
                  onCheckedChange={(checked) => setValue("isPrimary", checked as boolean)}
                />
                <Label htmlFor="isPrimary" className="font-normal cursor-pointer">
                  Primary Contact - Main point of contact for this customer
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="isBilling"
                  checked={isBilling}
                  onCheckedChange={(checked) => setValue("isBilling", checked as boolean)}
                />
                <Label htmlFor="isBilling" className="font-normal cursor-pointer">
                  Billing Contact - Receives invoices and payment communications
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="isShipping"
                  checked={isShipping}
                  onCheckedChange={(checked) => setValue("isShipping", checked as boolean)}
                />
                <Label htmlFor="isShipping" className="font-normal cursor-pointer">
                  Shipping Contact - Receives shipping notifications
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="canAccessPortal"
                  checked={canAccessPortal}
                  onCheckedChange={(checked) => setValue("canAccessPortal", checked as boolean)}
                />
                <Label htmlFor="canAccessPortal" className="font-normal cursor-pointer">
                  Portal Access - Can log in to customer portal
                </Label>
              </div>
            </div>
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
              {isSubmitting ? "Saving..." : contact ? "Update Contact" : "Create Contact"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

