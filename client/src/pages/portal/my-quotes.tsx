import { useMyQuotes } from "@/hooks/usePortal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Loader2, FileText, ArrowRight } from "lucide-react";

export default function MyQuotes() {
  const { data: quotes, isLoading, error } = useMyQuotes();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <p className="text-destructive mb-2">Failed to load quotes</p>
        <p className="text-sm text-muted-foreground">{(error as Error).message}</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">My Quotes</h1>
          <p className="text-muted-foreground">
            View and manage your quote requests
          </p>
        </div>
      </div>

      {!quotes || quotes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No quotes found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {quotes.map((quote: any) => (
            <Card key={quote.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-xl">
                      Quote #{quote.quoteNumber}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      Created {new Date(quote.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge variant="secondary">
                    {quote.source || 'draft'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Reference</p>
                      <p className="font-medium">{quote.customerName || 'N/A'}</p>
                    </div>
                  </div>

                  <div className="border-t pt-4">
                    <p className="text-sm text-muted-foreground mb-2">
                      {quote.lineItems?.length || 0} item(s)
                    </p>
                    <div className="flex items-center justify-between">
                      <div className="text-2xl font-bold">
                        ${parseFloat(quote.totalPrice || 0).toFixed(2)}
                      </div>
                      <div className="flex gap-2">
                        <Link href={`/quotes/${quote.id}`}>
                          <Button variant="outline" size="sm">
                            View Details
                          </Button>
                        </Link>
                        <Link href={`/portal/quotes/${quote.id}/checkout`}>
                          <Button size="sm">
                            Proceed to Order
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
