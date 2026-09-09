import * as React from "react";
import { Check, ExternalLink, Eye, ListFilter, RotateCcw, Settings2, ShieldCheck, X } from "lucide-react";
import { useApproveInvoicesForAccounting, useInvoices, type InvoiceListItem } from "@/hooks/useInvoices";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useTableColumnConfig, ColumnConfig } from "@/hooks/useTableColumnConfig";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { InvoiceSendQuickAction } from "@/components/invoices/InvoiceSendQuickAction";
import { canCloseJobOverride, CloseJobOverrideDialog, type CloseJobOverrideTarget, getOrderJobStatus } from "@/components/orders/CloseJobOverrideDialog";
import { OrderNumberLink } from "@/components/orders/OrderNumberLink";

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
  if (invoice.accountingApprovedAt && !invoice.accountingApprovalRevokedAt && Number(invoice.accountingApprovedVersion || 0) === currentVersion) return "Approved";
  return "Not Approved";
}

function canApproveInvoice(invoice: InvoiceListItem) {
  return !["void", "canceled", "cancelled"].includes(String(invoice.status || "").toLowerCase())
    && String(invoice.importSource || "").toLowerCase() !== "quickbooks"
    && !invoice.isHistorical
    && approvalLabel(invoice) !== "Approved";
}

function toOverrideTarget(invoice: InvoiceListItem): CloseJobOverrideTarget | null {
  if (!invoice.orderId) return null;
  return {
    orderId: invoice.orderId,
    orderNumber: invoice.orderNumber,
    jobName: invoice.jobName || invoice.orderName,
    purchaseOrderNumber: invoice.purchaseOrderNumber,
    customerName: invoice.companyName || invoice.customerName,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    jobStatus: getOrderJobStatus(invoice),
  };
}

export function CustomerInvoicesTable({ customerId }: { customerId: string }) {
  const { data: invoices = [], isLoading } = useInvoices({ customerId });
  const cfg = useTableColumnConfig("customer_invoices_v2", DEFAULT_COLUMNS);
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const approveInvoices = useApproveInvoicesForAccounting();
  const [columnsOpen, setColumnsOpen] = React.useState(false);
  const [overrideTarget, setOverrideTarget] = React.useState<CloseJobOverrideTarget | null>(null);
  const cols = cfg.columns.filter((column) => column.visible);
  const isAdminOrOwner = Boolean(isAdmin || ["owner", "admin"].includes(String(user?.role || "").toLowerCase()));

  const approve = async (invoice: InvoiceListItem) => {
    try {
      await approveInvoices.mutateAsync([invoice.id]);
      toast({ title: "Approved for Accounting" });
    } catch (error) {
      toast({ variant: "destructive", title: "Accounting approval failed", description: error instanceof Error ? error.message : "Unable to approve the invoice." });
    }
  };

  return <div className="w-full">
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="text-sm" style={{ color: "var(--text-muted)" }}>Invoices</div>
      <Button size="sm" variant="secondary" className="border" onClick={() => setColumnsOpen(true)}><Settings2 className="mr-1.5 h-4 w-4" aria-hidden="true" />Columns</Button>
    </div>
    <div className="overflow-x-auto">
      <table className="min-w-[1440px] w-full text-sm" style={{ color: "var(--text-primary)" }}>
        <thead style={{ backgroundColor: "var(--table-header-bg)" }}><tr className="text-left" style={{ color: "var(--table-header-text)" }}>{cols.map((column) => <th key={column.id} className="whitespace-nowrap px-3 py-2 font-medium">{column.label}</th>)}</tr></thead>
        <tbody>
          {isLoading ? <tr><td className="px-3 py-6" style={{ color: "var(--text-muted)" }} colSpan={cols.length}>Loading...</td></tr> : null}
          {!isLoading && invoices.length === 0 ? <tr><td className="px-3 py-6" style={{ color: "var(--text-muted)" }} colSpan={cols.length}>No invoices</td></tr> : null}
          {!isLoading && invoices.map((invoice) => <tr key={invoice.id} className="border-t" style={{ borderColor: "var(--table-border-color)" }}>
            {cols.map((column) => {
              switch (column.id) {
                case "invoiceNumber": return <td className="whitespace-nowrap px-3 py-2 font-mono" key={column.id}>{invoice.invoiceNumber || "—"}</td>;
                case "jobOrder": return <td className="max-w-56 px-3 py-2" key={column.id}>{invoice.jobName || invoice.orderName || invoice.orderNumber || "—"}</td>;
                case "poNumber": return <td className="whitespace-nowrap px-3 py-2" key={column.id}>{invoice.purchaseOrderNumber || "—"}</td>;
                case "orderNumber": return <td className="whitespace-nowrap px-3 py-2 font-mono" key={column.id}><OrderNumberLink orderId={invoice.orderId} orderNumber={invoice.orderNumber} /></td>;
                case "invoiceDate": return <td className="whitespace-nowrap px-3 py-2" key={column.id}>{formatDate(invoice.issueDate || invoice.createdAt)}</td>;
                case "lastSent": return <td className="whitespace-nowrap px-3 py-2" key={column.id}>{invoice.lastSentAt ? `${formatDate(invoice.lastSentAt)}${invoice.emailStatus === "sent_outdated" ? " (updated)" : ""}` : "Not sent"}</td>;
                case "dueDate": return <td className="whitespace-nowrap px-3 py-2" key={column.id}>{formatDate(invoice.dueDate)}</td>;
                case "approval": return <td className="whitespace-nowrap px-3 py-2" key={column.id}>{approvalLabel(invoice)}</td>;
                case "jobStatus": return <td className="whitespace-nowrap px-3 py-2" key={column.id}>{getOrderJobStatus(invoice)}</td>;
                case "total": return <td className="whitespace-nowrap px-3 py-2 text-right" key={column.id}>{formatMoney(invoice.displayTotal ?? invoice.total)}</td>;
                case "balance": return <td className="whitespace-nowrap px-3 py-2 text-right" key={column.id}>{formatMoney(invoice.displayRemaining ?? invoice.balanceDue)}</td>;
                case "invoiceStatus": return <td className="whitespace-nowrap px-3 py-2" key={column.id}>{invoice.displayStatus || titleCase(invoice.status)}</td>;
                case "actions": return <td className="px-3 py-2" key={column.id}><div className="flex min-w-max flex-wrap gap-2">
                  <a href={`/invoices/${invoice.id}`}><Button size="sm" variant="outline"><Eye className="mr-1.5 h-4 w-4" aria-hidden="true" />View Invoice</Button></a>
                  {invoice.orderId ? <a href={`/orders/${invoice.orderId}`}><Button size="sm" variant="outline"><ExternalLink className="mr-1.5 h-4 w-4" aria-hidden="true" />View Order</Button></a> : null}
                  {isAdminOrOwner && canApproveInvoice(invoice) ? <Button size="sm" variant="outline" disabled={approveInvoices.isPending} onClick={() => void approve(invoice)}><Check className="mr-1.5 h-4 w-4" aria-hidden="true" />Approve</Button> : null}
                  {isAdminOrOwner && String(invoice.importSource || "").toLowerCase() !== "quickbooks" ? <InvoiceSendQuickAction invoiceId={invoice.id} invoiceNumber={invoice.invoiceNumber} alreadySent={Boolean(invoice.lastSentAt)} /> : null}
                  {canCloseJobOverride(invoice, isAdminOrOwner) ? <Button size="sm" variant="outline" onClick={() => setOverrideTarget(toOverrideTarget(invoice))}><ShieldCheck className="mr-1.5 h-4 w-4" aria-hidden="true" />Close Job Override</Button> : null}
                </div></td>;
                default: return null;
              }
            })}
          </tr>)}
        </tbody>
      </table>
    </div>

    <Dialog open={columnsOpen} onOpenChange={setColumnsOpen}><DialogContent><DialogHeader><DialogTitle>Configure Invoice Columns</DialogTitle></DialogHeader><div className="space-y-2 py-2">{cfg.columns.map((column) => <label key={column.id} className="flex items-center gap-3"><Checkbox checked={column.visible} onCheckedChange={(value) => cfg.setColumnVisibility(column.id, Boolean(value))} /><span className="text-sm">{column.label}</span><div className="ml-auto flex items-center gap-2"><Button variant="outline" size="sm" onClick={() => cfg.moveColumn(column.id, "up")}><ListFilter className="mr-1 h-4 w-4" aria-hidden="true" />Up</Button><Button variant="outline" size="sm" onClick={() => cfg.moveColumn(column.id, "down")}><ListFilter className="mr-1 h-4 w-4 rotate-180" aria-hidden="true" />Down</Button></div></label>)}</div><DialogFooter><Button variant="outline" onClick={() => cfg.reset()}><RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />Reset</Button><Button onClick={() => setColumnsOpen(false)}><X className="mr-1.5 h-4 w-4" aria-hidden="true" />Close</Button></DialogFooter></DialogContent></Dialog>
    <CloseJobOverrideDialog target={overrideTarget} onOpenChange={(open) => !open && setOverrideTarget(null)} />
  </div>;
}
