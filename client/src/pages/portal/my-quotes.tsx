import { Link } from "react-router-dom";
import { FileText, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useMyQuotes, type PortalQuoteListDto } from "@/hooks/usePortal";

function formatDate(value: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(amount || 0));
}

function expirationLabel(quote: PortalQuoteListDto) {
  if (!quote.validUntil) return "No expiration date";
  return quote.displayStatus === "Expired" ? `Expired ${formatDate(quote.validUntil)}` : `Valid until ${formatDate(quote.validUntil)}`;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "Expired" || status === "Unavailable" || status === "Declined") return "secondary";
  if (status === "Accepted" || status === "Converted to Order") return "default";
  return "outline";
}

function QuoteRow({ quote }: { quote: PortalQuoteListDto }) {
  return (
    <div className="grid gap-4 border-b px-4 py-4 last:border-b-0 md:grid-cols-[1fr_auto_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/portal/quotes/${quote.id}`} className="font-medium text-foreground hover:underline">
            Quote {quote.displayNumber ?? quote.quoteNumber ?? quote.id.slice(0, 8)}
          </Link>
          <Badge variant={statusVariant(quote.displayStatus)}>{quote.displayStatus}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Created {formatDate(quote.createdAt)} / {expirationLabel(quote)}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {quote.itemCount} item{quote.itemCount === 1 ? "" : "s"}
        </p>
      </div>

      <div className="text-sm md:text-right">
        <p className="text-muted-foreground">Total</p>
        <p className="font-medium text-foreground">{formatCurrency(quote.total)}</p>
      </div>

      <div className="flex md:justify-end">
        <Button asChild variant="outline" size="sm">
          <Link to={`/portal/quotes/${quote.id}`}>View</Link>
        </Button>
      </div>
    </div>
  );
}

export default function MyQuotes() {
  const { data: quotes = [], isLoading, error } = useMyQuotes();

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
        <h1 className="text-2xl font-semibold tracking-normal">Quotes</h1>
        <p className="mt-1 text-sm text-muted-foreground">Review quote details and expiration dates.</p>
      </div>

      {error ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-medium text-destructive">Could not load quotes</p>
            <p className="mt-1 text-sm text-muted-foreground">{(error as Error).message}</p>
          </CardContent>
        </Card>
      ) : quotes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-14 text-center">
            <FileText className="mb-3 h-9 w-9 text-muted-foreground" />
            <p className="font-medium">No quotes yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Quotes will appear here when they are ready for you.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            {quotes.map((quote) => (
              <QuoteRow key={quote.id} quote={quote} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
