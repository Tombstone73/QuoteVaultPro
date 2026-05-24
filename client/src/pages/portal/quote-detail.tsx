import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarClock, FileText, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useQuoteCheckout } from "@/hooks/usePortal";

function formatDate(value: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(amount || 0));
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "Expired" || status === "Unavailable" || status === "Declined") return "secondary";
  if (status === "Accepted" || status === "Converted to Order") return "default";
  return "outline";
}

export default function PortalQuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const quoteId = id || "";
  const quoteQuery = useQuoteCheckout(quoteId);
  const quote = quoteQuery.data;

  if (quoteQuery.isLoading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <Button asChild variant="ghost">
          <Link to="/portal/my-quotes">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to quotes
          </Link>
        </Button>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">Quote not found</p>
            <p className="mt-1 text-sm text-muted-foreground">This quote is unavailable or you do not have access.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <Button asChild variant="ghost" className="mb-2 px-0">
            <Link to="/portal/my-quotes">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to quotes
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-normal">Quote #{quote.quoteNumber ?? quote.id.slice(0, 8)}</h1>
            <Badge variant={statusVariant(quote.displayStatus)}>{quote.displayStatus}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Created {formatDate(quote.createdAt)} / {quote.expirationSummary.expirationLabel}
          </p>
        </div>
        <Button disabled title={quote.customerVisibleActions.disabledReason || undefined}>
          Quote approval will be available soon
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatCurrency(quote.total)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <FileText className="h-4 w-4" />
              Items
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{quote.itemCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CalendarClock className="h-4 w-4" />
              Expiration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-medium">{quote.expirationSummary.expirationLabel}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Line Items</CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {quote.lineItems.map((item) => (
            <div key={item.id} className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_auto_auto] md:items-center">
              <div className="min-w-0">
                <p className="font-medium">{item.name}</p>
                {item.description ? <p className="mt-1 text-sm text-muted-foreground">{item.description}</p> : null}
                <p className="mt-1 text-sm text-muted-foreground">
                  Qty {item.quantity}
                  {item.dimensions.width && item.dimensions.height
                    ? ` / ${item.dimensions.width} x ${item.dimensions.height}`
                    : ""}
                </p>
                {item.displayOptions.length > 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">{item.displayOptions.join(" / ")}</p>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground md:text-right">{formatCurrency(item.unitPrice)} each</p>
              <p className="font-medium md:text-right">{formatCurrency(item.lineTotal)}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quote Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatCurrency(quote.subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Tax</span>
            <span>{formatCurrency(quote.tax)}</span>
          </div>
          <Separator />
          <div className="flex justify-between font-medium">
            <span>Total</span>
            <span>{formatCurrency(quote.total)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
