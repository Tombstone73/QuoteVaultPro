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

function InvoiceRow({ invoice }: { invoice: PortalInvoiceDto }) {
  return (
    <div className="grid gap-4 border-b px-4 py-4 last:border-b-0 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/portal/invoices/${invoice.id}`} className="font-medium text-foreground hover:underline">
            Invoice #{invoice.invoiceNumber}
          </Link>
          <Badge variant={statusVariant(invoice.status)}>{invoice.paymentStatusLabel}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Issued {formatDate(invoice.issueDate)} · Due {formatDate(invoice.dueDate)}
        </p>
      </div>

      <div className="text-sm md:text-right">
        <p className="text-muted-foreground">Amount due</p>
        <p className="font-semibold text-foreground">{formatCurrency(invoice.amountDue, invoice.currency)}</p>
      </div>

      <div className="text-sm md:text-right">
        <p className="text-muted-foreground">Total</p>
        <p className="font-medium text-foreground">{formatCurrency(invoice.total, invoice.currency)}</p>
      </div>

      <div className="flex gap-2 md:justify-end">
        <Button asChild variant="outline" size="sm">
          <Link to={`/portal/invoices/${invoice.id}`}>View</Link>
        </Button>
        {invoice.pdfAvailable ? (
          <Button asChild variant="ghost" size="icon" title="Download invoice PDF">
            <a href={portalInvoicePdfUrl(invoice.id, true)} target="_blank" rel="noreferrer">
              <Download className="h-4 w-4" />
            </a>
          </Button>
        ) : null}
      </div>
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
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">Invoices</h1>
        <p className="mt-1 text-sm text-muted-foreground">View balances, payments, and invoice PDFs.</p>
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
            {invoices.map((invoice) => (
              <InvoiceRow key={invoice.id} invoice={invoice} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

