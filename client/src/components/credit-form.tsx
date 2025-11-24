import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

const creditSchema = z.object({
  transactionType: z.enum(["credit", "debit"]),
  amount: z.number().min(0.01, "Amount must be greater than 0"),
  reason: z.string().min(1, "Reason is required"),
  approvalStatus: z.enum(["pending", "approved", "rejected"]).default("approved"),
});

type CreditFormData = z.infer<typeof creditSchema>;

interface CreditFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  currentBalance: number;
  creditLimit: number;
}

export default function CreditForm({ 
  open, 
  onOpenChange, 
  customerId, 
  currentBalance,
  creditLimit 
}: CreditFormProps) {
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
  } = useForm<CreditFormData>({
    resolver: zodResolver(creditSchema),
    defaultValues: {
      transactionType: "credit",
      amount: 0,
      reason: "",
      approvalStatus: "approved",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: CreditFormData) => {
      const response = await fetch(`/api/customers/${customerId}/apply-credit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: data.amount,
          type: data.transactionType, // Backend expects 'type' not 'transactionType'
          reason: data.reason,
          approvalStatus: data.approvalStatus,
        }),
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to apply credit");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/customers/${customerId}`] });
      toast({ title: "Success", description: "Credit transaction applied successfully" });
      reset();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const onSubmit = async (data: CreditFormData) => {
    setIsSubmitting(true);
    try {
      await createMutation.mutateAsync(data);
    } finally {
      setIsSubmitting(false);
    }
  };

  const transactionType = watch("transactionType");
  const amount = watch("amount") || 0;
  const approvalStatus = watch("approvalStatus");

  const newBalance = transactionType === "credit" 
    ? currentBalance + amount 
    : currentBalance - amount;

  const availableCredit = creditLimit - newBalance;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Apply Credit Transaction</DialogTitle>
          <DialogDescription>
            Add or deduct credit from this customer's account (Admin Only)
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Current Balance Info */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="font-medium">Current Balance:</span>
                  <span>${currentBalance.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Credit Limit:</span>
                  <span>${creditLimit.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Available Credit:</span>
                  <span>${(creditLimit - currentBalance).toFixed(2)}</span>
                </div>
              </div>
            </AlertDescription>
          </Alert>

          {/* Transaction Type */}
          <div className="space-y-2">
            <Label htmlFor="transactionType">Transaction Type *</Label>
            <Select
              value={transactionType}
              onValueChange={(value) => setValue("transactionType", value as any)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="credit">Credit (Add to Balance)</SelectItem>
                <SelectItem value="debit">Debit (Deduct from Balance)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <Label htmlFor="amount">Amount *</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              {...register("amount", { valueAsNumber: true })}
              placeholder="0.00"
            />
            {errors.amount && (
              <p className="text-sm text-destructive mt-1">{errors.amount.message}</p>
            )}
          </div>

          {/* Reason */}
          <div className="space-y-2">
            <Label htmlFor="reason">Reason *</Label>
            <Textarea
              id="reason"
              {...register("reason")}
              placeholder="Explain why this credit is being applied..."
              rows={4}
            />
            {errors.reason && (
              <p className="text-sm text-destructive mt-1">{errors.reason.message}</p>
            )}
          </div>

          {/* Approval Status */}
          <div className="space-y-2">
            <Label htmlFor="approvalStatus">Approval Status *</Label>
            <Select
              value={approvalStatus}
              onValueChange={(value) => setValue("approvalStatus", value as any)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Preview New Balance */}
          {amount > 0 && (
            <Alert className={newBalance > creditLimit ? "border-destructive" : ""}>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="font-medium">New Balance:</span>
                    <span className={newBalance > creditLimit ? "text-destructive font-bold" : ""}>
                      ${newBalance.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">New Available Credit:</span>
                    <span className={availableCredit < 0 ? "text-destructive font-bold" : ""}>
                      ${availableCredit.toFixed(2)}
                    </span>
                  </div>
                  {newBalance > creditLimit && (
                    <p className="text-sm text-destructive mt-2">
                      ⚠️ Warning: This transaction will exceed the credit limit!
                    </p>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}

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
              {isSubmitting ? "Applying..." : "Apply Credit"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

