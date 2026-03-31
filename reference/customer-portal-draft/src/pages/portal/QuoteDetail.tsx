import { useParams, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useQuoteDetail } from "@/hooks/useQuoteDetail";
import { useConvertQuote } from "@/hooks/useConvertQuote";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft, AlertCircle, CheckCircle2, Loader2, AlertTriangle, Clock,
} from "lucide-react";
import type { QuoteState } from "@/types/portal";

const STATE_BADGE_VARIANT: Record<QuoteState, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  sent: "default",
  approved: "secondary",
  expired: "outline",
  rejected: "destructive",
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

export default function QuoteDetail() {
  const { quoteId } = useParams<{ quoteId: string }>();
  const navigate = useNavigate();
  const { data: quote, isLoading, isError } = useQuoteDetail(quoteId);
  const convertQuote = useConvertQuote();
  const [showApproveDialog, setShowApproveDialog] = useState(false);

  const canApprove = quote?.state === "sent" && !isExpired(quote.expiresAt);
  const expired = quote ? isExpired(quote.expiresAt) : false;

  const handleApprove = () => {
    if (!quote) return;
    convertQuote.mutate(quote.id, {
      onSuccess: () => {
        setShowApproveDialog(false);
        navigate("/quotes");
      },
      onSettled: () => setShowApproveDialog(false),
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !quote) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <p className="text-lg font-medium text-foreground">Quote not found</p>
        <Button variant="outline" onClick={() => navigate("/quotes")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Quotes
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/quotes")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {quote.quoteNumber}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Created {formatDate(quote.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={STATE_BADGE_VARIANT[quote.state]}>{quote.stateLabel}</Badge>
          {canApprove && (
            <Button onClick={() => setShowApproveDialog(true)}>
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
              Approve Quote
            </Button>
          )}
        </div>
      </div>

      {/* Expiration warning */}
      {expired && quote.state === "sent" && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          This quote expired on {formatDate(quote.expiresAt)}. Backend expiration enforcement is not confirmed — contact your rep if you still wish to proceed.
        </div>
      )}

      {/* Expiry info */}
      {!expired && quote.expiresAt && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          <Clock className="h-4 w-4 shrink-0" />
          Valid until {formatDate(quote.expiresAt)}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Subtotal</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">{formatCurrency(quote.subtotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tax</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">{formatCurrency(quote.tax)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">{formatCurrency(quote.total)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Line Items */}
      {quote.lineItems.length > 0 && (
        <>
          <Separator />
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-4">Line Items</h2>
            <div className="rounded-md border border-border">
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
                  {quote.lineItems.map((li) => (
                    <TableRow key={li.id}>
                      <TableCell className="font-medium">{li.description}</TableCell>
                      <TableCell className="text-right">{li.quantity}</TableCell>
                      <TableCell className="text-right">{formatCurrency(li.unitPrice)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(li.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}

      {quote.lineItems.length === 0 && (
        <>
          <Separator />
          <p className="text-sm text-muted-foreground">
            Line item details are not available from the current API. Only summary totals are shown.
          </p>
        </>
      )}

      {/* Approve dialog */}
      <AlertDialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve Quote</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to approve{" "}
              <span className="font-medium text-foreground">{quote.quoteNumber}</span> for{" "}
              <span className="font-medium text-foreground">{formatCurrency(quote.total)}</span>?
              This will create a new order from this quote.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={convertQuote.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleApprove} disabled={convertQuote.isPending}>
              {convertQuote.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Approve Quote
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
