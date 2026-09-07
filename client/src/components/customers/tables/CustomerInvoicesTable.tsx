import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Eye, ListFilter, RotateCcw, Settings2, ShieldCheck, X } from "lucide-react";
import { useInvoices, type InvoiceListItem } from "@/hooks/useInvoices";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useTableColumnConfig, ColumnConfig } from "@/hooks/useTableColumnConfig";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

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

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: "invoiceNumber", label: "Invoice #", visible: true, order: 0 },
  { id: "jobOrder", label: "Job / Order", visible: true, order: 1 },
  { id: "poNumber", label: "PO #", visible: true, order: 2 },
  { id: "orderNumber", label: "Order #", visible: true, order: 3 },
  { id: "invoiceDate", label: "Invoice Date", visible: true, order: 4 },
  { id: "lastSent", label: "Last Sent", visible: true, order: 5 },
  { id: "dueDate", label: "Due Date", visible: true, order: 6 },
  { id: "approval", label: "Approval", visible: true, order: 7 },
  { id: "jobStatus", label: "Job Status", visible: true, order: 8 },
  { id: "total", label: "Total", visible: true, order: 9 },
  { id: "balance", label: "Balance", visible: true, order: 10 },
  { id: "invoiceStatus", label: "Invoice Status", visible: true, order: 11 },
  { id: "actions", label: "Actions", visible: true, order: 12 },
];

const terminalOrderStates = new Set(["closed", "canceled"]);
const terminalFulfillmentStates = new Set(["shipped", "delivered"]);

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

function formatMoney(value: unknown) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

function titleCase(value: string | null | undefined) {
  if (!value) return "—";
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function approvalLabel(invoice: InvoiceListItem) {
  const currentVersion = Number(invoice.invoiceVersion || 1);
  if (invoice.accountingApprovedAt && !invoice.accountingApprovalRevokedAt && Number(invoice.accountingApprovedVersion || 0) === currentVersion) {
    return "Approved for Accounting";
  }
  if (invoice.accountingApprovalRevokedAt || (invoice.accountingApprovedAt && Number(invoice.accountingApprovedVersion || 0) !== currentVersion)) {
    return "Needs Reapproval";
  }
  return "Approval Required";
}

function jobStatusLabel(invoice: InvoiceListItem) {
  if (!invoice.orderId) return "No linked Order";
  if (invoice.orderState === "canceled") return "Cancelled";
  if (invoice.orderState === "closed") return "Operationally Complete";
  if (terminalFulfillmentStates.has(String(invoice.orderFulfillmentStatus || "").toLowerCase())) return "Fulfillment Complete";
  if (invoice.orderState === "production_complete") return "Production Complete";
  return titleCase(invoice.orderStatusPillValue || invoice.orderStatus || invoice.orderState || "Open");
}

function canOfferCloseJobOverride(invoice: InvoiceListItem, isAdminOrOwner: boolean) {
  if (!isAdminOrOwner || !invoice.orderId) return false;
  if (terminalOrderStates.has(String(invoice.orderState || "").toLowerCase())) return false;
  return !terminalFulfillmentStates.has(String(invoice.orderFulfillmentStatus || "").toLowerCase());
}

export function CustomerInvoicesTable({ customerId }: { customerId: string }) {
  const { data: invoices = [], isLoading } = useInvoices({ customerId });
  // Version this preference key so saved sparse legacy settings cannot hide
  // the expanded canonical Invoice visibility surface.
  const cfg = useTableColumnConfig("customer_invoices_v2", DEFAULT_COLUMNS);
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [columnsOpen, setColumnsOpen] = React.useState(false);
  const [overrideInvoice, setOverrideInvoice] = React.useState<InvoiceListItem | null>(null);
  const [overrideReason, setOverrideReason] = React.useState<"historical_backlog_cleanup" | "completed_outside_printershero" | "other">("historical_backlog_cleanup");
  const [overrideNote, setOverrideNote] = React.useState("");
  const [isSubmittingOverride, setIsSubmittingOverride] = React.useState(false);
  const cols = cfg.columns.filter((column) => column.visible);
  const isAdminOrOwner = Boolean(isAdmin || ["owner", "admin"].includes(String(user?.role || "").toLowerCase()));

  const previewQuery = useQuery<HistoricalFulfillmentPreview>({
    queryKey: ["orders", overrideInvoice?.orderId, "historical-fulfillment-reconciliation"],
    enabled: Boolean(overrideInvoice?.orderId),
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/orders/${overrideInvoice!.orderId}/historical-fulfillment-reconciliation`);
      const payload = await response.json();
      return payload.data as HistoricalFulfillmentPreview;
    },
  });

  const closeOverrideDialog = () => {
    setOverrideInvoice(null);
    setOverrideReason("historical_backlog_cleanup");
    setOverrideNote("");
  };

  const submitCloseJobOverride = async () => {
    if (!overrideInvoice?.orderId) return;
    if (overrideReason === "other" && !overrideNote.trim()) {
      toast({ variant: "destructive", title: "Reason required", description: "Add a note when selecting Other." });
      return;
    }

    setIsSubmittingOverride(true);
    try {
      // Production completion remains in the established canonical route. It
      // owns prerequisite checks and quantity mutations; the follow-up
      // reconciliation owns only remaining fulfillment state.
      if (!previewQuery.data?.productionComplete) {
        await apiRequest("POST", `/api/orders/${overrideInvoice.orderId}/complete-production`, { confirmBypass: true });
      }
      await apiRequest("POST", `/api/orders/${overrideInvoice.orderId}/reconcile-historical-fulfillment`, {
        reason: overrideReason,
        note: overrideNote.trim() || undefined,
        sourceInvoiceId: overrideInvoice.id,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["invoices"] }),
        queryClient.invalidateQueries({ queryKey: ["orders", overrideInvoice.orderId] }),
      ]);
      toast({
        title: "Job operationally completed",
        description: "Production and fulfillment were reconciled. Invoice and payment status were not changed.",
      });
      closeOverrideDialog();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Close Job Override failed",
        description: error instanceof Error ? error.message : "Unable to reconcile this job safely.",
      });
    } finally {
      setIsSubmittingOverride(false);
    }
  };

  return (
    <div className="w-full">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm" style={{ color: "var(--text-muted)" }}>Invoices</div>
        <Button size="sm" variant="secondary" className="border" onClick={() => setColumnsOpen(true)}>
          <Settings2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Columns
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[1180px] w-full text-sm" style={{ color: "var(--text-primary)" }}>
          <thead style={{ backgroundColor: "var(--table-header-bg)" }}>
            <tr className="text-left" style={{ color: "var(--table-header-text)" }}>
              {cols.map((column) => <th key={column.id} className="whitespace-nowrap px-3 py-2 font-medium">{column.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td className="px-3 py-6" style={{ color: "var(--text-muted)" }} colSpan={cols.length}>Loading...</td></tr>
            ) : invoices.length === 0 ? (
              <tr><td className="px-3 py-6" style={{ color: "var(--text-muted)" }} colSpan={cols.length}>No invoices</td></tr>
            ) : invoices.map((invoice) => (
              <tr key={invoice.id} className="border-t" style={{ borderColor: "var(--table-border-color)" }}>
                {cols.map((column) => {
                  switch (column.id) {
                    case "invoiceNumber": return <td className="whitespace-nowrap px-3 py-2 font-mono" key={column.id}>{invoice.invoiceNumber || "—"}</td>;
                    case "jobOrder": return <td className="max-w-56 px-3 py-2" key={column.id}>{invoice.jobName || invoice.orderName || invoice.orderNumber || "—"}</td>;
                    case "poNumber": return <td className="whitespace-nowrap px-3 py-2" key={column.id}>{invoice.purchaseOrderNumber || "—"}</td>;
                    case "orderNumber": return <td className="whitespace-nowrap px-3 py-2 font-mono" key={column.id}>{invoice.orderNumber || "—"}</td>;
                    case "invoiceDate": return <td className="whitespace-nowrap px-3 py-2" key={column.id}>{formatDate(invoice.issueDate || invoice.createdAt)}</td>;
                    case "lastSent": return <td className="whitespace-nowrap px-3 py-2" key={column.id}>{invoice.lastSentAt ? `${formatDate(invoice.lastSentAt)}${invoice.emailStatus === "sent_outdated" ? " (updated)" : ""}` : "Not sent"}</td>;
                    case "dueDate": return <td className="whitespace-nowrap px-3 py-2" key={column.id}>{formatDate(invoice.dueDate)}</td>;
                    case "approval": return <td className="whitespace-nowrap px-3 py-2" key={column.id}>{approvalLabel(invoice)}</td>;
                    case "jobStatus": return <td className="whitespace-nowrap px-3 py-2" key={column.id}>{jobStatusLabel(invoice)}</td>;
                    case "total": return <td className="whitespace-nowrap px-3 py-2 text-right" key={column.id}>{formatMoney(invoice.displayTotal ?? invoice.total)}</td>;
                    case "balance": return <td className="whitespace-nowrap px-3 py-2 text-right" key={column.id}>{formatMoney(invoice.displayRemaining ?? invoice.balanceDue)}</td>;
                    case "invoiceStatus": return <td className="whitespace-nowrap px-3 py-2" key={column.id}>{invoice.displayStatus || titleCase(invoice.status)}</td>;
                    case "actions": return (
                      <td className="px-3 py-2" key={column.id}>
                        <div className="flex min-w-max flex-wrap gap-2">
                          <a href={`/invoices/${invoice.id}`}>
                            <Button size="sm" variant="outline"><Eye className="mr-1.5 h-4 w-4" aria-hidden="true" />View Invoice</Button>
                          </a>
                          {invoice.orderId ? (
                            <a href={`/orders/${invoice.orderId}`}>
                              <Button size="sm" variant="outline"><ExternalLink className="mr-1.5 h-4 w-4" aria-hidden="true" />View Order</Button>
                            </a>
                          ) : null}
                          {canOfferCloseJobOverride(invoice, isAdminOrOwner) ? (
                            <Button size="sm" variant="outline" onClick={() => setOverrideInvoice(invoice)}>
                              <ShieldCheck className="mr-1.5 h-4 w-4" aria-hidden="true" />Close Job Override
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    );
                    default: return null;
                  }
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={columnsOpen} onOpenChange={setColumnsOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Configure Invoice Columns</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            {cfg.columns.map((column) => (
              <label key={column.id} className="flex items-center gap-3">
                <Checkbox checked={column.visible} onCheckedChange={(value) => cfg.setColumnVisibility(column.id, Boolean(value))} />
                <span className="text-sm">{column.label}</span>
                <div className="ml-auto flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => cfg.moveColumn(column.id, "up")}><ListFilter className="mr-1 h-4 w-4" aria-hidden="true" />Up</Button>
                  <Button variant="outline" size="sm" onClick={() => cfg.moveColumn(column.id, "down")}><ListFilter className="mr-1 h-4 w-4 rotate-180" aria-hidden="true" />Down</Button>
                </div>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => cfg.reset()}><RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />Reset</Button>
            <Button onClick={() => setColumnsOpen(false)}><X className="mr-1.5 h-4 w-4" aria-hidden="true" />Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(overrideInvoice)} onOpenChange={(open) => !open && closeOverrideDialog()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Close Job Override</DialogTitle>
            <DialogDescription>
              This will mark all remaining production and fulfillment work as completed. The invoice and payment status will not be changed.
            </DialogDescription>
          </DialogHeader>
          {overrideInvoice ? (
            <div className="space-y-4 text-sm">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                <div><dt className="text-muted-foreground">Customer</dt><dd>{overrideInvoice.companyName || overrideInvoice.customerName || "Current customer"}</dd></div>
                <div><dt className="text-muted-foreground">Invoice</dt><dd>{overrideInvoice.invoiceNumber || "—"}</dd></div>
                <div><dt className="text-muted-foreground">Order</dt><dd>{overrideInvoice.orderNumber || "—"}</dd></div>
                <div><dt className="text-muted-foreground">Job</dt><dd>{overrideInvoice.jobName || overrideInvoice.orderName || "—"}</dd></div>
                <div><dt className="text-muted-foreground">PO #</dt><dd>{overrideInvoice.purchaseOrderNumber || "—"}</dd></div>
                <div><dt className="text-muted-foreground">Current job status</dt><dd>{jobStatusLabel(overrideInvoice)}</dd></div>
              </dl>
              {previewQuery.isLoading ? <p className="text-muted-foreground">Checking remaining production and fulfillment quantities…</p> : null}
              {previewQuery.isError ? <p className="text-destructive">The live job state could not be verified. Close Job Override is unavailable until it can be checked.</p> : null}
              {previewQuery.data ? (
                <div className="rounded-md border p-3">
                  <p>Remaining production: <strong>{previewQuery.data.remainingProductionQuantity}</strong></p>
                  <p>Remaining fulfillment: <strong>{previewQuery.data.remainingFulfillmentQuantity}</strong></p>
                  <p className="mt-2 text-muted-foreground">No shipment, tracking, pickup handoff, delivery evidence, invoice, payment, email, QuickBooks update, or billing automation will be created.</p>
                </div>
              ) : null}
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="historical-reconciliation-reason">Reason</label>
                <Select value={overrideReason} onValueChange={(value) => setOverrideReason(value as typeof overrideReason)}>
                  <SelectTrigger id="historical-reconciliation-reason"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="historical_backlog_cleanup">Historical backlog cleanup</SelectItem>
                    <SelectItem value="completed_outside_printershero">Completed outside PrintersHero</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="historical-reconciliation-note">Note {overrideReason === "other" ? "(required)" : "(optional)"}</label>
                <Textarea id="historical-reconciliation-note" value={overrideNote} onChange={(event) => setOverrideNote(event.target.value)} maxLength={500} placeholder="Optional administrative reconciliation note" />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" disabled={isSubmittingOverride} onClick={closeOverrideDialog}><X className="mr-1.5 h-4 w-4" aria-hidden="true" />Cancel</Button>
            <Button disabled={isSubmittingOverride || previewQuery.isLoading || previewQuery.isError || previewQuery.data?.canceled || previewQuery.data?.alreadyOperationallyComplete} onClick={submitCloseJobOverride}>
              <ShieldCheck className="mr-1.5 h-4 w-4" aria-hidden="true" />{isSubmittingOverride ? "Reconciling…" : "Close Job Override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
