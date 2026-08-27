import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Download, Loader2, RefreshCcw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import StripePayDialog from "@/components/payments/StripePayDialog";
import PortalFilesCard from "@/components/portal/PortalFilesCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getInvoiceFinancialPaymentEligibility } from "@shared/paymentOrchestration";
import { useToast } from "@/hooks/use-toast";
import {
  portalInvoiceKeys,
  portalInvoicePdfUrl,
  usePortalInvoice,
  usePortalInvoiceFiles,
  usePortalInvoicePayments,
  type PortalInvoicePaymentDto,
} from "@/hooks/usePortal";

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

function PaymentHistory({ payments, currency }: { payments: PortalInvoicePaymentDto[]; currency: string }) {
  if (payments.length === 0) {
    return <p className="text-sm text-muted-foreground">No payments have been recorded yet.</p>;
  }

  return (
    <div className="divide-y">
      {payments.map((payment) => (
        <div key={payment.id} className="grid gap-2 py-3 md:grid-cols-[1fr_auto_auto] md:items-center">
          <div>
            <p className="font-medium">{payment.methodLabel}</p>
            <p className="text-sm text-muted-foreground">
              {payment.paidAt ? formatDate(payment.paidAt) : "Pending"}
              {payment.referenceNumber ? ` · Ref ${payment.referenceNumber}` : ""}
            </p>
          </div>
          <Badge variant={payment.status === "succeeded" ? "default" : "outline"}>{payment.status}</Badge>
          <p className="font-medium md:text-right">{formatCurrency(payment.amount, payment.currency || currency)}</p>
        </div>
      ))}
    </div>
  );
}

export default function PortalInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const invoiceId = id || "";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [payOpen, setPayOpen] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const invoiceQuery = usePortalInvoice(invoiceId);
  const paymentsQuery = usePortalInvoicePayments(invoiceId);
  const filesQuery = usePortalInvoiceFiles(invoiceId);
  const invoice = invoiceQuery.data;
  const payments = paymentsQuery.data ?? [];
  const files = filesQuery.data ?? [];

  const paymentEligibility = useMemo(() => invoice
    ? getInvoiceFinancialPaymentEligibility({ invoiceStatus: invoice.status, remainingCents: Math.round(Number(invoice.amountDue || 0) * 100) })
    : { payable: false, blockedReason: "Invoice is not payable." }, [invoice]);
  const payable = paymentEligibility.payable;

  const refreshInvoiceState = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: portalInvoiceKeys.all }),
      queryClient.invalidateQueries({ queryKey: portalInvoiceKeys.detail(invoiceId) }),
      queryClient.invalidateQueries({ queryKey: portalInvoiceKeys.payments(invoiceId) }),
    ]);
  };

  const handleDownloadPdf = async () => {
    if (!invoiceId) return;
    setDownloadingPdf(true);
    try {
      const response = await fetch(portalInvoicePdfUrl(invoiceId, true), { credentials: "include" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message || "Could not download invoice PDF");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `invoice-${invoice?.invoiceNumber || invoiceId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      toast({
        title: "PDF unavailable",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setDownloadingPdf(false);
    }
  };

  if (invoiceQuery.isLoading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <Button asChild variant="ghost">
          <Link to="/portal/invoices">Back to invoices</Link>
        </Button>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">Invoice not found</p>
            <p className="mt-1 text-sm text-muted-foreground">This invoice is unavailable or you do not have access.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <StripePayDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        invoiceId={invoice.id}
        apiBasePath="/api/portal/invoices"
        onSettled={async ({ serverConfirmed }) => {
          await refreshInvoiceState();
          if (!serverConfirmed) {
            window.setTimeout(() => void refreshInvoiceState(), 1500);
            window.setTimeout(() => void refreshInvoiceState(), 5000);
          }
        }}
      />

      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <Button asChild variant="ghost" className="mb-2 px-0">
            <Link to="/portal/invoices">Back to invoices</Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-normal">Invoice {invoice.displayNumber || invoice.invoiceNumber}</h1>
            <Badge variant={statusVariant(invoice.status)}>{invoice.paymentStatusLabel}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Issued {formatDate(invoice.issueDate)} · Due {formatDate(invoice.dueDate)}
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={handleDownloadPdf} disabled={!invoice.pdfAvailable || downloadingPdf}>
            {downloadingPdf ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            PDF
          </Button>
          <Button variant="outline" onClick={() => void refreshInvoiceState()}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          {payable ? (
            <Button onClick={() => setPayOpen(true)}>Pay {formatCurrency(invoice.amountDue, invoice.currency)}</Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Amount Due</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatCurrency(invoice.amountDue, invoice.currency)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Paid</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatCurrency(invoice.amountPaid, invoice.currency)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatCurrency(invoice.total, invoice.currency)}</p>
          </CardContent>
        </Card>
      </div>

      {!payable ? (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            {paymentEligibility.blockedReason || "Online payment is not available for this invoice."}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Invoice Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatCurrency(invoice.subtotal, invoice.currency)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Tax</span>
            <span>{formatCurrency(invoice.tax, invoice.currency)}</span>
          </div>
          <Separator />
          <div className="flex justify-between font-medium">
            <span>Total</span>
            <span>{formatCurrency(invoice.total, invoice.currency)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment History</CardTitle>
        </CardHeader>
        <CardContent>
          {paymentsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading payments
            </div>
          ) : paymentsQuery.error ? (
            <p className="text-sm text-destructive">{(paymentsQuery.error as Error).message}</p>
          ) : (
            <PaymentHistory payments={payments} currency={invoice.currency} />
          )}
        </CardContent>
      </Card>

      <PortalFilesCard
        title="Invoice Documents"
        files={files}
        isLoading={filesQuery.isLoading}
        error={filesQuery.error}
        entity="invoices"
        entityId={invoice.id}
      />
    </div>
  );
}
