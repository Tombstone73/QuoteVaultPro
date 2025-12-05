import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { ROUTES } from "@/config/routes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Edit, Package, FileText } from "lucide-react";
import { format } from "date-fns";
import { QuoteSourceBadge } from "@/components/quote-source-badge";
import { useAuth } from "@/hooks/useAuth";
import type { QuoteWithRelations } from "@shared/schema";

export default function QuoteDetail() {
  const [match, params] = useRoute("/quotes/:id");
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const quoteId = params?.id;

  const isInternalUser = user && ['admin', 'owner', 'manager', 'employee'].includes(user.role || '');

  const { data: quote, isLoading } = useQuery<QuoteWithRelations>({
    queryKey: ["/api/quotes", quoteId],
    queryFn: async () => {
      if (!quoteId) throw new Error("Quote ID is required");
      const response = await fetch(`/api/quotes/${quoteId}`, { credentials: "include" });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text}`);
      }
      return response.json();
    },
    enabled: !!quoteId,
  });

  const handleBack = () => {
    if (quote?.source === 'customer_quick_quote' && !isInternalUser) {
      navigate(ROUTES.portal.myQuotes);
    } else if (isInternalUser) {
      navigate(ROUTES.quotes.list);
    } else {
      navigate(ROUTES.dashboard);
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="py-16 text-center">
            <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">Quote not found</p>
            <Button onClick={handleBack} className="mt-4">
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={handleBack}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <div className="flex gap-2">
          {isInternalUser && quote.source === 'internal' && (
            <Button variant="outline" onClick={() => navigate(ROUTES.quotes.edit(quote.id))}>
              <Edit className="w-4 h-4 mr-2" />
              Edit Quote
            </Button>
          )}
          <Button onClick={() => navigate(ROUTES.orders.new + `?fromQuote=${quote.id}`)}>
            <Package className="w-4 h-4 mr-2" />
            Convert to Order
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-2xl">
                Quote #{quote.quoteNumber || 'N/A'}
              </CardTitle>
              <CardDescription>
                Created {format(new Date(quote.createdAt), 'MMMM d, yyyy')}
              </CardDescription>
            </div>
            <QuoteSourceBadge source={quote.source} />
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Quote Details */}
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <h3 className="font-semibold">Customer Information</h3>
              <div className="text-sm space-y-1">
                <div>
                  <span className="text-muted-foreground">Name: </span>
                  {quote.customerName || <span className="text-muted-foreground">—</span>}
                </div>
                {quote.customerId && (
                  <div>
                    <span className="text-muted-foreground">Customer ID: </span>
                    {quote.customerId}
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold">Quote Information</h3>
              <div className="text-sm space-y-1">
                <div>
                  <span className="text-muted-foreground">Created by: </span>
                  {quote.user ? `${quote.user.firstName || ''} ${quote.user.lastName || ''}`.trim() || quote.user.email : '—'}
                </div>
                <div>
                  <span className="text-muted-foreground">Source: </span>
                  <QuoteSourceBadge source={quote.source} className="ml-2" />
                </div>
              </div>
            </div>
          </div>

          {/* Line Items */}
          <div className="space-y-4">
            <h3 className="font-semibold">Line Items</h3>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Variant</TableHead>
                    <TableHead>Dimensions</TableHead>
                    <TableHead className="text-center">Quantity</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quote.lineItems?.map((item, idx) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="font-medium">{item.productName}</div>
                        {item.selectedOptions && item.selectedOptions.length > 0 && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {item.selectedOptions.map((opt: any) => (
                              <span key={opt.optionId} className="mr-2">
                                {opt.optionName}
                                {typeof opt.value !== 'boolean' && `: ${opt.value}`}
                              </span>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {item.variantName || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-sm">
                          {parseFloat(item.width).toFixed(2)}" × {parseFloat(item.height).toFixed(2)}"
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{item.quantity}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        ${parseFloat(item.linePrice).toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-full md:w-1/2 lg:w-1/3 space-y-2 border-t pt-4">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal:</span>
                <span className="font-mono">${parseFloat(quote.subtotal).toFixed(2)}</span>
              </div>
              {parseFloat(quote.discountAmount) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Discount:</span>
                  <span className="font-mono text-green-600">
                    -${parseFloat(quote.discountAmount).toFixed(2)}
                  </span>
                </div>
              )}
              {parseFloat(quote.taxRate) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Tax ({(parseFloat(quote.taxRate) * 100).toFixed(2)}%):
                  </span>
                  <span className="font-mono">
                    ${(parseFloat(quote.subtotal) * parseFloat(quote.taxRate)).toFixed(2)}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-lg font-semibold border-t pt-2">
                <span>Total:</span>
                <span className="font-mono">${parseFloat(quote.totalPrice).toFixed(2)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
