import { useParams, useNavigate } from "react-router-dom";
import { useInvoiceDetail } from "@/hooks/useInvoiceDetail";
import { useCreatePaymentIntent, useConfirmPayment } from "@/hooks/useStripePayment";
import { useRuntimeConfig } from "@/contexts/RuntimeConfigContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ArrowLeft, AlertCircle, CreditCard, CheckCircle2, Loader2, Download } from "lucide-react";
import { toast } from "sonner";
import { useState, useEffect, useCallback } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import type { InvoiceStatus } from "@/types/portal";

const STATUS_BADGE_VARIANT: Record<InvoiceStatus, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  billed: "destructive",
  paid: "secondary",
  void: "outline",
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Lazy-load Stripe only when needed
const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const stripePromise = stripePublishableKey ? loadStripe(stripePublishableKey) : null;

export default function InvoiceDetail() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const navigate = useNavigate();
  const { data: invoice, isLoading, isError } = useInvoiceDetail(invoiceId);
  const { isMockMode } = useRuntimeConfig();
  const createIntent = useCreatePaymentIntent();
  const confirmPayment = useConfirmPayment();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  const isPayable = invoice?.status === "billed" && invoice.amountDue > 0;

  const handleInitiatePayment = useCallback(async () => {
    if (!invoiceId) return;

    if (isMockMode) {
      // In demo mode, simulate the whole flow
      confirmPayment.mutate(
        { invoiceId },
        {
          onSuccess: () => {
            setPaymentSuccess(true);
            toast.success("Demo mode — payment simulated successfully");
          },
        }
      );
      return;
    }

    try {
      const result = await createIntent.mutateAsync(invoiceId);
      setClientSecret(result.clientSecret);
    } catch {
      toast.error("Failed to initiate payment");
    }
  }, [invoiceId, isMockMode, createIntent, confirmPayment]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !invoice) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <p className="text-lg font-medium text-foreground">Invoice not found</p>
        <Button variant="outline" onClick={() => navigate("/invoices")}>
          <ArrowLeft className="mr-2 h-4 w-4" />Back to Invoices
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/invoices")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {invoice.invoiceNumber}
            </h1>
            <Badge variant={STATUS_BADGE_VARIANT[invoice.status]}>{invoice.statusLabel}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Created {formatDate(invoice.createdAt)}
            {invoice.dueDate && <> · Due {formatDate(invoice.dueDate)}</>}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => {
          if (isMockMode) {
            toast.info("Demo mode — PDF download simulated");
          } else {
            window.open(`/api/invoices/${invoice.id}/pdf`, "_blank");
          }
        }}>
          <Download className="mr-1.5 h-3.5 w-3.5" />PDF
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Subtotal</CardDescription>
            <CardTitle className="text-xl">{formatCurrency(invoice.subtotal)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Tax</CardDescription>
            <CardTitle className="text-xl">{formatCurrency(invoice.tax)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Amount Due</CardDescription>
            <CardTitle className="text-xl text-destructive">
              {invoice.amountDue > 0 ? formatCurrency(invoice.amountDue) : formatCurrency(0)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Line Items */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Line Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.lineItems.map((li) => (
                <TableRow key={li.id}>
                  <TableCell>{li.description}</TableCell>
                  <TableCell className="text-right">{li.quantity}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{formatCurrency(li.unitPrice)}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(li.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Separator className="my-4" />
          <div className="flex justify-end">
            <div className="w-48 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatCurrency(invoice.subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>{formatCurrency(invoice.tax)}</span></div>
              <Separator className="my-1" />
              <div className="flex justify-between font-medium"><span>Total</span><span>{formatCurrency(invoice.total)}</span></div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payment History */}
      {invoice.payments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Payments</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{formatDate(p.paidAt)}</TableCell>
                    <TableCell className="capitalize">{p.method}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(p.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Payment Section */}
      {isPayable && !paymentSuccess && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Make a Payment
            </CardTitle>
            <CardDescription>
              Pay {formatCurrency(invoice.amountDue)} via credit or debit card.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!clientSecret && !isMockMode && (
              <Button
                onClick={handleInitiatePayment}
                disabled={createIntent.isPending}
              >
                {createIntent.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <CreditCard className="mr-2 h-4 w-4" />
                Pay {formatCurrency(invoice.amountDue)}
              </Button>
            )}

            {isMockMode && (
              <Button
                onClick={handleInitiatePayment}
                disabled={confirmPayment.isPending}
              >
                {confirmPayment.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <CreditCard className="mr-2 h-4 w-4" />
                Pay {formatCurrency(invoice.amountDue)} (Demo)
              </Button>
            )}

            {clientSecret && stripePromise && (
              <Elements stripe={stripePromise} options={{ clientSecret }}>
                <StripeCheckoutForm
                  invoiceId={invoice.id}
                  onSuccess={() => setPaymentSuccess(true)}
                />
              </Elements>
            )}

            {clientSecret && !stripePromise && (
              <p className="text-sm text-destructive">
                Stripe is not configured. Set VITE_STRIPE_PUBLISHABLE_KEY to enable payments.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {paymentSuccess && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-center gap-3 py-6">
            <CheckCircle2 className="h-6 w-6 text-primary" />
            <div>
              <p className="font-medium text-foreground">Payment Successful</p>
              <p className="text-sm text-muted-foreground">
                Thank you! Your payment of {formatCurrency(invoice.amountDue)} has been processed.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Stripe Elements checkout form — only rendered when clientSecret is available */
function StripeCheckoutForm({
  invoiceId,
  onSuccess,
}: {
  invoiceId: string;
  onSuccess: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const confirmPayment = useConfirmPayment();
  const [isProcessing, setIsProcessing] = useState(false);
  const [ready, setReady] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsProcessing(true);
    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
      });

      if (error) {
        toast.error(error.message ?? "Payment failed");
      } else if (paymentIntent?.status === "succeeded") {
        // Notify our backend
        await confirmPayment.mutateAsync({
          invoiceId,
          paymentIntentId: paymentIntent.id,
        });
        toast.success("Payment processed successfully!");
        onSuccess();
      }
    } catch {
      toast.error("An unexpected error occurred during payment.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement onReady={() => setReady(true)} />
      <Button type="submit" disabled={!stripe || !ready || isProcessing}>
        {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Confirm Payment
      </Button>
    </form>
  );
}
