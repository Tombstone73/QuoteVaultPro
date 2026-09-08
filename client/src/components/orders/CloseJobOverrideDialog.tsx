import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type CloseJobOverrideTarget = {
  orderId: string;
  orderNumber?: string | null;
  jobName?: string | null;
  purchaseOrderNumber?: string | null;
  customerName?: string | null;
  invoiceId?: string | null;
  invoiceNumber?: string | number | null;
  jobStatus?: string | null;
};

type HistoricalFulfillmentPreview = {
  orderState: string | null;
  orderStatus: string | null;
  fulfillmentStatus: string | null;
  canceled: boolean;
  physicalLineCount: number;
  remainingProductionQuantity: number;
  remainingFulfillmentQuantity: number;
  productionComplete: boolean;
  alreadyOperationallyComplete: boolean;
};

function overrideErrorDescription(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Unable to reconcile this job safely.";
  const jsonStart = raw.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const payload = JSON.parse(raw.slice(jsonStart));
      if (payload?.code === "PRODUCTION_NOT_COMPLETE") {
        return "Could not close job: one or more physical line items still need production completion.";
      }
      if (typeof payload?.message === "string" && payload.message.trim()) return payload.message;
    } catch {
      // Keep the safe plain-text fallback below.
    }
  }
  return raw.replace(/^\d{3}:\s*/, "") || "Unable to reconcile this job safely.";
}

const terminalOrderStates = new Set(["closed", "canceled"]);
const terminalFulfillmentStates = new Set(["shipped", "delivered"]);

export function getOrderJobStatus(input: {
  orderId?: string | null;
  orderState?: string | null;
  orderStatus?: string | null;
  orderStatusPillValue?: string | null;
  orderFulfillmentStatus?: string | null;
}) {
  if (!input.orderId) return "No linked Order";
  if (String(input.orderState || "").toLowerCase() === "canceled") return "Cancelled";
  if (String(input.orderState || "").toLowerCase() === "closed") return "Operationally Complete";
  if (terminalFulfillmentStates.has(String(input.orderFulfillmentStatus || "").toLowerCase())) return "Fulfillment Complete";
  if (String(input.orderState || "").toLowerCase() === "production_complete") return "Production Complete";
  const value = input.orderStatusPillValue || input.orderStatus || input.orderState || "Open";
  return String(value).replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function canCloseJobOverride(input: {
  orderId?: string | null;
  orderState?: string | null;
  orderFulfillmentStatus?: string | null;
}, isAdminOrOwner: boolean) {
  if (!isAdminOrOwner || !input.orderId) return false;
  if (terminalOrderStates.has(String(input.orderState || "").toLowerCase())) return false;
  return !terminalFulfillmentStates.has(String(input.orderFulfillmentStatus || "").toLowerCase());
}

export function CloseJobOverrideDialog({ target, onOpenChange }: {
  target: CloseJobOverrideTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = React.useState<"historical_backlog_cleanup" | "completed_outside_printershero" | "other">("historical_backlog_cleanup");
  const [note, setNote] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const orderId = target?.orderId;
  const previewQuery = useQuery<HistoricalFulfillmentPreview>({
    queryKey: ["orders", orderId, "historical-fulfillment-reconciliation"],
    enabled: Boolean(orderId),
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/orders/${orderId}/historical-fulfillment-reconciliation`);
      const payload = await response.json();
      return payload.data as HistoricalFulfillmentPreview;
    },
  });

  const resetAndClose = () => {
    setReason("historical_backlog_cleanup");
    setNote("");
    onOpenChange(false);
  };

  const close = () => {
    if (!isSubmitting) resetAndClose();
  };

  const submit = async () => {
    if (!target) return;
    if (reason === "other" && !note.trim()) {
      toast({ variant: "destructive", title: "Reason required", description: "Add a note when selecting Other." });
      return;
    }
    setIsSubmitting(true);
    try {
      // Production completion remains owned by the canonical Order operation.
      // This reconciliation then handles only the remaining fulfillment work.
      if (!previewQuery.data?.productionComplete) {
        await apiRequest("POST", `/api/orders/${target.orderId}/complete-production`, { confirmBypass: true });
      }
      await apiRequest("POST", `/api/orders/${target.orderId}/reconcile-historical-fulfillment`, {
        reason,
        note: note.trim() || undefined,
        sourceInvoiceId: target.invoiceId || undefined,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["invoices"] }),
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
      ]);
      toast({ title: "Job operationally completed", description: "Production and fulfillment were reconciled. Invoice and payment status were not changed." });
      resetAndClose();
    } catch (error) {
      toast({ variant: "destructive", title: "Close Job Override failed", description: overrideErrorDescription(error) });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Close Job Override</DialogTitle>
          <DialogDescription>This will mark all remaining production and fulfillment work as completed. The invoice and payment status will not be changed.</DialogDescription>
        </DialogHeader>
        {target ? <div className="space-y-4 text-sm">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Customer</dt><dd>{target.customerName || "—"}</dd></div>
            <div><dt className="text-muted-foreground">Invoice</dt><dd>{target.invoiceNumber || "No linked invoice"}</dd></div>
            <div><dt className="text-muted-foreground">Order</dt><dd>{target.orderNumber || "—"}</dd></div>
            <div><dt className="text-muted-foreground">Job</dt><dd>{target.jobName || target.orderNumber || "—"}</dd></div>
            <div><dt className="text-muted-foreground">PO #</dt><dd>{target.purchaseOrderNumber || "—"}</dd></div>
            <div><dt className="text-muted-foreground">Current job status</dt><dd>{target.jobStatus || "—"}</dd></div>
          </dl>
          {previewQuery.isLoading ? <p className="text-muted-foreground">Checking remaining production and fulfillment quantities…</p> : null}
          {previewQuery.isError ? <p className="text-destructive">The live job state could not be verified. Close Job Override is unavailable until it can be checked.</p> : null}
          {previewQuery.data ? <div className="rounded-md border p-3">
            <p>Remaining production: <strong>{previewQuery.data.remainingProductionQuantity}</strong></p>
            <p>Remaining fulfillment: <strong>{previewQuery.data.remainingFulfillmentQuantity}</strong></p>
            <p className="mt-2 text-muted-foreground">No shipment, tracking, pickup handoff, delivery evidence, invoice, payment, email, QuickBooks update, or billing automation will be created.</p>
          </div> : null}
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="historical-reconciliation-reason">Reason</label>
            <Select value={reason} onValueChange={(value) => setReason(value as typeof reason)}>
              <SelectTrigger id="historical-reconciliation-reason"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="historical_backlog_cleanup">Historical backlog cleanup</SelectItem><SelectItem value="completed_outside_printershero">Completed outside PrintersHero</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="historical-reconciliation-note">Note {reason === "other" ? "(required)" : "(optional)"}</label>
            <Textarea id="historical-reconciliation-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Optional administrative reconciliation note" />
          </div>
        </div> : null}
        <DialogFooter>
          <Button variant="outline" disabled={isSubmitting} onClick={close}><X className="mr-1.5 h-4 w-4" aria-hidden="true" />Cancel</Button>
          <Button disabled={isSubmitting || previewQuery.isLoading || previewQuery.isError || previewQuery.data?.canceled || previewQuery.data?.alreadyOperationallyComplete} onClick={() => void submit()}><ShieldCheck className="mr-1.5 h-4 w-4" aria-hidden="true" />{isSubmitting ? "Reconciling…" : "Close Job Override"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
