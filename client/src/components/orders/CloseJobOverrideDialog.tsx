import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

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
  productionStarted: boolean;
  activeProductionJobCount: number;
  productionConflicts?: Array<{
    lineItemId: string; lineDescription: string; jobId: string | null;
    stationKey: string; jobStatus: string; runningTimer: boolean; runId: string | null;
  }>;
  requiresProductionBootstrap: boolean;
  productionBootstrapLineCount?: number;
  requiresParentProductionRecovery: boolean;
  canCloseJobOverride: boolean;
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
  if (String(input.orderState || "").toLowerCase() === "closed") return "Closed";
  if (terminalFulfillmentStates.has(String(input.orderFulfillmentStatus || "").toLowerCase())) return "Fulfillment Complete";
  if (String(input.orderState || "").toLowerCase() === "production_complete") return "Production Complete";
  const value = input.orderStatusPillValue || input.orderStatus || input.orderState || "Open";
  return String(value).replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function isCloseJobOverrideEligible(preview: Pick<HistoricalFulfillmentPreview, "canCloseJobOverride"> | null | undefined) {
  return preview?.canCloseJobOverride === true;
}

export function hasProductionBypassConflict(preview: HistoricalFulfillmentPreview | null | undefined) {
  return Boolean(preview?.productionConflicts?.length);
}

export function useCloseJobOverrideEligibility(orderId: string | null | undefined, isAdminOrOwner: boolean) {
  return useQuery<HistoricalFulfillmentPreview>({
    queryKey: ["orders", orderId, "historical-fulfillment-reconciliation"],
    enabled: Boolean(orderId && isAdminOrOwner),
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/orders/${orderId}/historical-fulfillment-reconciliation`);
      const payload = await response.json();
      return payload.data as HistoricalFulfillmentPreview;
    },
  });
}

/**
 * The list action deliberately waits for the same live, backend-derived
 * preview consumed by the dialog. This prevents a terminal-looking parent
 * from hiding real line obligations, and prevents completed jobs from
 * retaining a dead action after the relevant queries are invalidated.
 */
export function CloseJobOverrideAction({
  target,
  isAdminOrOwner,
  onOpen,
  className,
  label = "Close Job Override",
}: {
  target: CloseJobOverrideTarget | null;
  isAdminOrOwner: boolean;
  onOpen: (target: CloseJobOverrideTarget) => void;
  className?: string;
  label?: string;
}) {
  const previewQuery = useCloseJobOverrideEligibility(target?.orderId, isAdminOrOwner);
  if (!target || !isAdminOrOwner || (!isCloseJobOverrideEligible(previewQuery.data) && !hasProductionBypassConflict(previewQuery.data))) return null;
  return <Button variant="outline" size="sm" className={className} onClick={() => onOpen(target)}>
    <ShieldCheck className="mr-1 h-4 w-4" aria-hidden="true" />{hasProductionBypassConflict(previewQuery.data) ? "Resolve production conflict" : label}
  </Button>;
}

export function CloseJobOverrideDialog({ target, onOpenChange }: {
  target: CloseJobOverrideTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = React.useState<"historical_backlog_cleanup" | "completed_outside_printershero" | "other">("historical_backlog_cleanup");
  const [note, setNote] = React.useState("");
  const [productionBootstrapAcknowledged, setProductionBootstrapAcknowledged] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [conflictJobId, setConflictJobId] = React.useState("");
  const [resolution, setResolution] = React.useState<"production_completed" | "production_not_required" | "">("");
  const [conflictReason, setConflictReason] = React.useState("");
  const [conflictNote, setConflictNote] = React.useState("");
  const orderId = target?.orderId;
  const previewQuery = useCloseJobOverrideEligibility(orderId, Boolean(orderId));

  const resetAndClose = () => {
    setReason("historical_backlog_cleanup");
    setNote("");
    setProductionBootstrapAcknowledged(false);
    setConflictJobId(""); setResolution(""); setConflictReason(""); setConflictNote("");
    onOpenChange(false);
  };

  const close = () => {
    if (!isSubmitting) resetAndClose();
  };

  const submit = async () => {
    if (!target) return;
    if (hasProductionBypassConflict(previewQuery.data)) return;
    if (reason === "other" && !note.trim()) {
      toast({ variant: "destructive", title: "Reason required", description: "Add a note when selecting Other." });
      return;
    }
    if (previewQuery.data?.requiresProductionBootstrap && !productionBootstrapAcknowledged) {
      toast({ variant: "destructive", title: "Production acknowledgement required", description: "Confirm the production bootstrap before running Close Job Override." });
      return;
    }
    setIsSubmitting(true);
    try {
      // Production completion remains owned by the canonical Order operation.
      // This reconciliation then handles only the remaining fulfillment work.
      if (!previewQuery.data?.productionComplete) {
        await apiRequest("POST", `/api/orders/${target.orderId}/complete-production`, {
          confirmBypass: true,
          ...(previewQuery.data?.requiresProductionBootstrap ? { confirmProductionBootstrap: true } : {}),
          closeJobOverride: true,
          sourceInvoiceId: target.invoiceId || undefined,
          reconciliationReason: reason,
          reconciliationNote: note.trim() || undefined,
        });
      }
      await apiRequest("POST", `/api/orders/${target.orderId}/reconcile-historical-fulfillment`, {
        reason,
        note: note.trim() || undefined,
        sourceInvoiceId: target.invoiceId || undefined,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["invoices"] }),
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/operational-summary"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboardSummary"] }),
        queryClient.invalidateQueries({ queryKey: ["fulfillment"] }),
        queryClient.invalidateQueries({ predicate: query => query.queryKey.some(key => typeof key === 'string' && key.includes('production')) }),
      ]);
      toast({ title: "Job operationally completed", description: "Production and fulfillment were reconciled. Invoice and payment status were not changed." });
      resetAndClose();
    } catch (error) {
      toast({ variant: "destructive", title: "Close Job Override failed", description: overrideErrorDescription(error) });
    } finally {
      setIsSubmitting(false);
    }
  };

  const reconcileConflict = async () => {
    if (!target || !resolution || conflictReason.trim().length < 3) return;
    const conflict = previewQuery.data?.productionConflicts?.find((item) => item.jobId === conflictJobId);
    if (!conflict?.jobId || conflict.runId) return;
    setIsSubmitting(true);
    try {
      await apiRequest("POST", `/api/orders/${target.orderId}/production-bypass-conflict/reconcile`, {
        lineItemId: conflict.lineItemId, jobId: conflict.jobId,
        resolution, reason: conflictReason.trim(), note: conflictNote.trim() || undefined,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: ["fulfillment"] }),
        queryClient.invalidateQueries({ predicate: query => query.queryKey.some(key => typeof key === "string" && key.includes("production")) }),
      ]);
      await previewQuery.refetch();
      setConflictJobId(""); setResolution(""); setConflictReason(""); setConflictNote("");
      toast({ title: "Production conflict reconciled", description: "Review the refreshed preview before closing the job. Fulfillment was not reconciled." });
    } catch (error) {
      toast({ variant: "destructive", title: "Production reconciliation failed", description: overrideErrorDescription(error) });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Close Job Override</DialogTitle>
          <DialogDescription>{hasProductionBypassConflict(previewQuery.data)
            ? "Choose what happened to the active production work. This step will not reconcile fulfillment or change invoice and payment status."
            : "This will mark all remaining production and fulfillment work as completed. The invoice and payment status will not be changed."}</DialogDescription>
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
            <p>Production started: <strong>{previewQuery.data.productionStarted ? "Yes" : "No"}</strong></p>
            <p>Active production jobs: <strong>{previewQuery.data.activeProductionJobCount}</strong></p>
            {hasProductionBypassConflict(previewQuery.data) ? <div className="mt-3 rounded-md border border-destructive/50 bg-destructive/5 p-3">
              <p className="font-semibold text-destructive">Production conflict</p>
              {previewQuery.data.productionConflicts?.map((conflict) => <p key={conflict.jobId || conflict.runId} className="mt-1">
                {conflict.lineDescription}: production is not required, but {conflict.stationKey} {conflict.runId ? `Combined Run ${conflict.runId}` : `job ${conflict.jobId}`} is still {conflict.jobStatus}{conflict.runningTimer ? " with a running timer" : ""}.
              </p>)}
              <p className="mt-2">Resolve active production before closing this Order.</p>
              {previewQuery.data.productionConflicts?.some((conflict) => conflict.runId) ? <p className="mt-1 text-muted-foreground">Active Combined Runs must be resolved through the Combined Run workflow before this reconciliation is available.</p> : null}
            </div> : null}
            {previewQuery.data.requiresParentProductionRecovery ? <p className="mt-2 text-amber-700 dark:text-amber-300">Historical Order state will be repaired: this Order is marked Ready for Shipment while production remains incomplete. The override will temporarily restore In Production before completing canonical Production.</p> : null}
            <p className="mt-2 text-muted-foreground">No shipment, tracking, pickup handoff, delivery evidence, invoice, payment, email, QuickBooks update, or billing automation will be created.</p>
          </div> : null}
          {hasProductionBypassConflict(previewQuery.data) ? <div className="space-y-3 rounded-md border p-3">
            <p className="font-medium">What actually happened?</p>
            <Select value={conflictJobId} onValueChange={setConflictJobId}>
              <SelectTrigger aria-label="Production job to reconcile"><SelectValue placeholder="Select the active production job" /></SelectTrigger>
              <SelectContent>{previewQuery.data?.productionConflicts?.filter((item) => item.jobId && !item.runId).map((item) =>
                <SelectItem key={item.jobId} value={item.jobId!}>{item.lineDescription} · {item.stationKey} · {item.jobId}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={resolution} onValueChange={(value) => setResolution(value as typeof resolution)}>
              <SelectTrigger aria-label="Production resolution"><SelectValue placeholder="Choose the actual outcome" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="production_completed">Production was completed</SelectItem>
                <SelectItem value="production_not_required">Production was not required</SelectItem>
              </SelectContent>
            </Select>
            <label className="block text-sm font-medium" htmlFor="production-conflict-reason">Reason (required)</label>
            <Textarea id="production-conflict-reason" value={conflictReason} onChange={(event) => setConflictReason(event.target.value)} maxLength={2000} placeholder="Explain the production state reconciliation" />
            <label className="block text-sm font-medium" htmlFor="production-conflict-note">Note (optional)</label>
            <Textarea id="production-conflict-note" value={conflictNote} onChange={(event) => setConflictNote(event.target.value)} maxLength={2000} />
          </div> : null}
          {!hasProductionBypassConflict(previewQuery.data) && previewQuery.data?.requiresProductionBootstrap ? <div className="space-y-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
            <p className="font-medium">{previewQuery.data.productionBootstrapLineCount && previewQuery.data.productionBootstrapLineCount > 1
              ? `${previewQuery.data.productionBootstrapLineCount} production lines need an administrative owner.`
              : previewQuery.data.productionStarted ? "A remaining production line has no active owner." : "Production has not been started for this Order."}</p>
            <p className="text-muted-foreground">Continuing will administratively create and resolve the required production ownership, mark the remaining production complete, and then reconcile fulfillment.</p>
            <label className="flex items-start gap-2" htmlFor="close-job-override-production-bootstrap">
              <Checkbox id="close-job-override-production-bootstrap" checked={productionBootstrapAcknowledged} onCheckedChange={(value) => setProductionBootstrapAcknowledged(value === true)} />
              <span>I understand production will be started and completed by this override.</span>
            </label>
          </div> : null}
          {!hasProductionBypassConflict(previewQuery.data) ? <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="historical-reconciliation-reason">Reason</label>
            <Select value={reason} onValueChange={(value) => setReason(value as typeof reason)}>
              <SelectTrigger id="historical-reconciliation-reason"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="historical_backlog_cleanup">Historical backlog cleanup</SelectItem><SelectItem value="completed_outside_printershero">Completed outside PrintersHero</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent>
            </Select>
          </div> : null}
          {!hasProductionBypassConflict(previewQuery.data) ? <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="historical-reconciliation-note">Note {reason === "other" ? "(required)" : "(optional)"}</label>
            <Textarea id="historical-reconciliation-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Optional administrative reconciliation note" />
          </div> : null}
        </div> : null}
        <DialogFooter>
          <Button variant="outline" disabled={isSubmitting} onClick={close}><X className="mr-1.5 h-4 w-4" aria-hidden="true" />Cancel</Button>
          {hasProductionBypassConflict(previewQuery.data)
            ? <Button disabled={isSubmitting || !conflictJobId || !resolution || conflictReason.trim().length < 3} onClick={() => void reconcileConflict()}><ShieldCheck className="mr-1.5 h-4 w-4" aria-hidden="true" />{isSubmitting ? "Reconciling…" : "Reconcile production"}</Button>
            : <Button disabled={isSubmitting || previewQuery.isLoading || previewQuery.isError || !isCloseJobOverrideEligible(previewQuery.data) || (previewQuery.data?.requiresProductionBootstrap && !productionBootstrapAcknowledged)} onClick={() => void submit()}><ShieldCheck className="mr-1.5 h-4 w-4" aria-hidden="true" />{isSubmitting ? "Reconciling…" : "Close Job Override"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
