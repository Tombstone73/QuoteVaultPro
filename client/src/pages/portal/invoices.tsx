import { Link } from "react-router-dom";
import { Download, FileText, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { usePortalInvoices, portalInvoicePdfUrl, type PortalInvoiceDto } from "@/hooks/usePortal";

function formatCurrency(amount: number, currency = "USD") {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount || 0));
  } catch {
    return `$${Number(amount || 0).toFixed(2)}`;
  }
}

function formatDate(value: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "paid") return "default";
  if (status === "overdue") return "destructive";
  if (status === "void") return "secondary";
  return "outline";
}

function invoiceLabel(invoice: PortalInvoiceDto) {
  return invoice.displayNumber || invoice.invoiceNumber;
}

function jobOrOrderLabel(invoice: PortalInvoiceDto) {
  return invoice.jobLabel || (invoice.orderNumber ? `Order ${invoice.orderNumber}` : "—");
}

function InvoiceActions({ invoice, mobile = false }: { invoice: PortalInvoiceDto; mobile?: boolean }) {
  const mobileActionClassName = mobile ? "min-h-11 flex-1" : undefined;

  return (
    <div className={`flex gap-2 ${mobile ? "w-full" : "justify-end"}`}>
      <Button asChild variant="outline" size="sm" className={mobileActionClassName}>
        <Link to={`/portal/invoices/${invoice.id}`}>View invoice</Link>
      </Button>
      {invoice.pdfAvailable ? (
        <Button
          asChild
          variant="ghost"
          size={mobile ? "sm" : "icon"}
          className={mobileActionClassName}
          title="Download invoice PDF"
        >
          <a
            href={portalInvoicePdfUrl(invoice.id, true)}
            target="_blank"
            rel="noreferrer"
            aria-label={`Download PDF for invoice ${invoiceLabel(invoice)}`}
          >
            <Download className="h-4 w-4" />
            {mobile ? <span>Download</span> : null}
          </a>
        </Button>
      ) : null}
    </div>
  );
}

export function PortalInvoiceMobileCard({ invoice }: { invoice: PortalInvoiceDto }) {
  const jobOrOrder = jobOrOrderLabel(invoice);

  return (
    <article className="border-b px-4 py-4 last:border-b-0 2xl:hidden">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Link to={`/portal/invoices/${invoice.id}`} className="font-semibold text-foreground hover:underline">
          Invoice {invoiceLabel(invoice)}
        </Link>
        <Badge variant={statusVariant(invoice.status)}>{invoice.paymentStatusLabel}</Badge>
      </div>

      <div className="mt-3 min-w-0 space-y-1 text-sm">
        <p className="break-words font-medium text-foreground" title={jobOrOrder}>{jobOrOrder}</p>
        <p className="break-words text-muted-foreground">PO # {invoice.customerPoNumber || "—"}</p>
        {invoice.jobLabel && invoice.orderNumber ? <p className="text-muted-foreground">Order {invoice.orderNumber}</p> : null}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Issued</dt>
          <dd className="mt-0.5 font-medium text-foreground">{formatDate(invoice.issueDate)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Due</dt>
          <dd className="mt-0.5 font-medium text-foreground">{formatDate(invoice.dueDate)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Amount due</dt>
          <dd className="mt-0.5 font-semibold text-foreground">{formatCurrency(invoice.amountDue, invoice.currency)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Total</dt>
          <dd className="mt-0.5 font-medium text-foreground">{formatCurrency(invoice.total, invoice.currency)}</dd>
        </div>
      </dl>

      <div className="mt-4"><InvoiceActions invoice={invoice} mobile /></div>
    </article>
  );
}

export function PortalInvoiceDesktopTable({ invoices }: { invoices: PortalInvoiceDto[] }) {
  return (
    <div className="hidden 2xl:block">
      <table className="w-full min-w-[72rem] table-fixed" aria-label="Customer invoices">
        <colgroup>
          <col className="w-[10%]" />
          <col className="w-[16%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[11%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[13%]" />
        </colgroup>
        <thead>
          <tr className="border-b bg-muted/30 text-left text-xs font-medium text-muted-foreground">
            <th scope="col" className="px-4 py-3">Invoice</th>
            <th scope="col" className="px-3 py-3">Job / Order</th>
            <th scope="col" className="px-3 py-3">PO #</th>
            <th scope="col" className="px-2 py-3">Issued</th>
            <th scope="col" className="px-2 py-3">Due</th>
            <th scope="col" className="px-3 py-3 text-right">Amount Due</th>
            <th scope="col" className="px-3 py-3 text-right">Total</th>
            <th scope="col" className="px-2 py-3">Status</th>
            <th scope="col" className="px-2 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => {
            const jobOrOrder = jobOrOrderLabel(invoice);
            return (
              <tr key={invoice.id} className="border-b text-sm last:border-b-0 hover:bg-muted/20">
                <td className="px-4 py-3 align-middle">
                  <Link to={`/portal/invoices/${invoice.id}`} className="font-semibold text-foreground hover:underline">
                    {invoiceLabel(invoice)}
                  </Link>
                </td>
                <td className="min-w-0 px-3 py-3 align-middle">
                  <p className="truncate font-medium text-foreground" title={jobOrOrder}>{jobOrOrder}</p>
                  {invoice.jobLabel && invoice.orderNumber ? (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground" title={`Order ${invoice.orderNumber}`}>
                      Order {invoice.orderNumber}
                    </p>
                  ) : null}
                </td>
                <td className="px-3 py-3 align-middle">
                  <p className="truncate text-foreground" title={invoice.customerPoNumber || undefined}>{invoice.customerPoNumber || "—"}</p>
                </td>
                <td className="whitespace-nowrap px-2 py-3 align-middle text-foreground">{formatDate(invoice.issueDate)}</td>
                <td className="whitespace-nowrap px-2 py-3 align-middle text-foreground">{formatDate(invoice.dueDate)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right align-middle font-semibold text-foreground">{formatCurrency(invoice.amountDue, invoice.currency)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right align-middle text-foreground">{formatCurrency(invoice.total, invoice.currency)}</td>
                <td className="px-2 py-3 align-middle"><Badge variant={statusVariant(invoice.status)}>{invoice.paymentStatusLabel}</Badge></td>
                <td className="px-2 py-3 align-middle"><InvoiceActions invoice={invoice} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function PortalInvoicesPage() {
  const { data: invoices = [], isLoading, error } = usePortalInvoices();

  if (isLoading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">Invoices</h1>
        <p className="mt-1 text-sm text-muted-foreground">Review balances, payment history, and available invoice documents.</p>
      </div>

      {error ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-medium text-destructive">Could not load invoices</p>
            <p className="mt-1 text-sm text-muted-foreground">{(error as Error).message}</p>
          </CardContent>
        </Card>
      ) : invoices.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-14 text-center">
            <FileText className="mb-3 h-9 w-9 text-muted-foreground" />
            <p className="font-medium">No invoices yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Invoices will appear here when they are ready for you.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <PortalInvoiceDesktopTable invoices={invoices} />
            <div className="2xl:hidden">
              {invoices.map((invoice) => (
                <PortalInvoiceMobileCard key={invoice.id} invoice={invoice} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
