import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useCreateShipment, useUpdateShipment } from "@/hooks/useShipments";
import type { Shipment } from "@shared/schema";

const shipmentSchema = z.object({
  carrier: z.enum(["UPS", "FedEx", "USPS", "DHL", "Other"]),
  trackingNumber: z.string().min(1, "Tracking number is required"),
  shippedAt: z.string().min(1, "Shipped date is required"),
  deliveredAt: z.string().optional(),
  notes: z.string().optional(),
  sendEmail: z.boolean().default(false),
  emailSubject: z.string().optional(),
  emailMessage: z.string().optional(),
});

type ShipmentFormData = z.infer<typeof shipmentSchema>;

interface ShipmentFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  shipment?: Shipment;
  mode?: "create" | "edit";
}

export function ShipmentForm({ open, onOpenChange, orderId, shipment, mode = "create" }: ShipmentFormProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const createShipment = useCreateShipment(orderId);
  const updateShipment = useUpdateShipment(orderId);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
    reset,
  } = useForm<ShipmentFormData>({
    resolver: zodResolver(shipmentSchema),
    defaultValues: {
      carrier: "UPS",
      trackingNumber: "",
      shippedAt: new Date().toISOString().slice(0, 16),
      deliveredAt: "",
      notes: "",
      sendEmail: false,
      emailSubject: "",
      emailMessage: "",
    },
  });

  // Reset form when shipment changes or dialog opens
  useEffect(() => {
    if (open && shipment && mode === "edit") {
      reset({
        carrier: shipment.carrier as any,
        trackingNumber: shipment.trackingNumber || "",
        shippedAt: shipment.shippedAt ? new Date(shipment.shippedAt).toISOString().slice(0, 16) : "",
        deliveredAt: shipment.deliveredAt ? new Date(shipment.deliveredAt).toISOString().slice(0, 16) : "",
        notes: shipment.notes || "",
        sendEmail: false,
        emailSubject: "",
        emailMessage: "",
      });
    } else if (open && mode === "create") {
      reset({
        carrier: "UPS",
        trackingNumber: "",
        shippedAt: new Date().toISOString().slice(0, 16),
        deliveredAt: "",
        notes: "",
        sendEmail: false,
        emailSubject: "",
        emailMessage: "",
      });
    }
  }, [open, shipment, mode, reset]);

  const onSubmit = async (data: ShipmentFormData) => {
    setIsSubmitting(true);
    try {
      if (mode === "edit" && shipment) {
        await updateShipment.mutateAsync({
          id: shipment.id,
          updates: {
            carrier: data.carrier,
            trackingNumber: data.trackingNumber,
            shippedAt: new Date(data.shippedAt),
            deliveredAt: data.deliveredAt ? new Date(data.deliveredAt) : null,
            notes: data.notes || null,
          } as any,
        });
        toast({ title: "Success", description: "Shipment updated successfully" });
      } else {
        await createShipment.mutateAsync({
          orderId,
          carrier: data.carrier,
          trackingNumber: data.trackingNumber,
          shippedAt: new Date(data.shippedAt),
          deliveredAt: data.deliveredAt ? new Date(data.deliveredAt) : null,
          notes: data.notes || null,
          sendEmail: data.sendEmail,
          emailSubject: data.emailSubject,
          emailMessage: data.emailMessage,
        } as any);
        toast({ title: "Success", description: "Shipment created successfully" });
      }
      onOpenChange(false);
    } catch (error: any) {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to save shipment", 
        variant: "destructive" 
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const sendEmail = watch("sendEmail");
  const carrier = watch("carrier");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Edit Shipment" : "Add Shipment"}</DialogTitle>
          <DialogDescription>
            {mode === "edit" 
              ? "Update shipment tracking information" 
              : "Add shipment tracking information for this order"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="space-y-4">
            {/* Carrier */}
            <div className="space-y-2">
              <Label htmlFor="carrier">Carrier *</Label>
              <Select
                value={carrier}
                onValueChange={(value) => setValue("carrier", value as any)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select carrier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UPS">UPS</SelectItem>
                  <SelectItem value="FedEx">FedEx</SelectItem>
                  <SelectItem value="USPS">USPS</SelectItem>
                  <SelectItem value="DHL">DHL</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
              {errors.carrier && (
                <p className="text-sm text-destructive">{errors.carrier.message}</p>
              )}
            </div>

            {/* Tracking Number */}
            <div className="space-y-2">
              <Label htmlFor="trackingNumber">Tracking Number *</Label>
              <Input
                id="trackingNumber"
                {...register("trackingNumber")}
                placeholder="Enter tracking number"
              />
              {errors.trackingNumber && (
                <p className="text-sm text-destructive">{errors.trackingNumber.message}</p>
              )}
            </div>

            {/* Shipped At */}
            <div className="space-y-2">
              <Label htmlFor="shippedAt">Shipped Date & Time *</Label>
              <Input
                id="shippedAt"
                type="datetime-local"
                {...register("shippedAt")}
              />
              {errors.shippedAt && (
                <p className="text-sm text-destructive">{errors.shippedAt.message}</p>
              )}
            </div>

            {/* Delivered At */}
            <div className="space-y-2">
              <Label htmlFor="deliveredAt">Delivered Date & Time (optional)</Label>
              <Input
                id="deliveredAt"
                type="datetime-local"
                {...register("deliveredAt")}
              />
              {errors.deliveredAt && (
                <p className="text-sm text-destructive">{errors.deliveredAt.message}</p>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                {...register("notes")}
                placeholder="Add any additional notes about this shipment"
                rows={3}
              />
              {errors.notes && (
                <p className="text-sm text-destructive">{errors.notes.message}</p>
              )}
            </div>

            {/* Send Email (only on create) */}
            {mode === "create" && (
              <>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="sendEmail"
                    checked={sendEmail}
                    onCheckedChange={(checked) => setValue("sendEmail", !!checked)}
                  />
                  <Label htmlFor="sendEmail" className="cursor-pointer">
                    Send shipping notification to customer
                  </Label>
                </div>

                {sendEmail && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="emailSubject">Email Subject (optional)</Label>
                      <Input
                        id="emailSubject"
                        {...register("emailSubject")}
                        placeholder="Leave blank for default subject"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="emailMessage">Custom Message (optional)</Label>
                      <Textarea
                        id="emailMessage"
                        {...register("emailMessage")}
                        placeholder="Add a custom message to include in the email"
                        rows={3}
                      />
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : mode === "edit" ? "Update Shipment" : "Add Shipment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
