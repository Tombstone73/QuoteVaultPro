import React, { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router-dom";
import { ROUTES } from "@/config/routes";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Edit, Package, FileText } from "lucide-react";
import { format } from "date-fns";
import { QuoteSourceBadge } from "@/components/quote-source-badge";
import { useAuth } from "@/hooks/useAuth";
import { Page, PageHeader, ContentLayout, DataCard, StatusPill } from "@/components/titan";
import { useToast } from "@/hooks/use-toast";
import { ConvertQuoteToOrderDialog } from "@/components/convert-quote-to-order-dialog";
import { useConvertQuoteToOrder } from "@/hooks/useOrders";
import type { QuoteWithRelations } from "@shared/schema";

type QuoteDetailRouteParams = {
  id?: string;
  quoteId?: string;
};

export default function QuoteDetail() {
  const params = useParams<QuoteDetailRouteParams>();
  const navigate = useNavigate();
  const quoteId = params.quoteId ?? params.id ?? null;
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isInternalUser = user && ['admin', 'owner', 'manager', 'employee'].includes(user.role || '');

  if (!quoteId) {
    console.error("[QuoteDetail] Missing quoteId in route params", { params });
    return (
      <div className="container mx-auto p-6">
        <p className="text-destructive">
          Unable to load quote: invalid or missing quote ID.
        </p>
      </div>
    );
  }

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

  // Some deployments return a `convertedToOrderId` field; keep this optional in the UI without changing backend types.
  const convertedToOrderId =
    (quote as (QuoteWithRelations & { convertedToOrderId?: string | null }) | undefined)?.convertedToOrderId ?? null;

  const convertToOrder = useConvertQuoteToOrder(quoteId);
  const [showConvertDialog, setShowConvertDialog] = useState(false);

  const handleConvertToOrder = (values: { dueDate: string; promisedDate: string; priority: string; notes: string }) => {
    convertToOrder.mutate({
      dueDate: values.dueDate || undefined,
      promisedDate: values.promisedDate || undefined,
      priority: values.priority || undefined,
      notesInternal: values.notes || undefined,
    });
  };

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
      <Page>
        <ContentLayout className="space-y-4">
          <Skeleton className="h-32 w-full bg-titan-bg-card-elevated" />
          <Skeleton className="h-96 w-full bg-titan-bg-card-elevated" />
        </ContentLayout>
      </Page>
    );
  }

  if (!quote) {
    return (
      <Page>
        <ContentLayout>
          <DataCard className="bg-titan-bg-card border-titan-border-subtle">
            <div className="py-16 text-center">
              <FileText className="w-12 h-12 mx-auto mb-4 text-titan-text-muted" />
              <p className="text-titan-text-secondary">Quote not found</p>
              <Button
                onClick={handleBack}
                className="mt-4 bg-titan-accent hover:bg-titan-accent-hover text-white rounded-titan-md"
              >
                Go Back
              </Button>
            </div>
          </DataCard>
        </ContentLayout>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title={`Quote #${quote.quoteNumber || 'N/A'}`}
        subtitle={`Created ${format(new Date(quote.createdAt), 'MMMM d, yyyy')}`}
        className="pb-3"
        backButton={
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            className="text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated rounded-titan-md"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        }
        actions={
          <div className="flex items-center gap-2">
            <QuoteSourceBadge source={quote.source} />
            {isInternalUser && quote.source === 'internal' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(ROUTES.quotes.edit(quote.id))}
                className="border-titan-border text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated rounded-titan-md"
              >
                <Edit className="w-4 h-4 mr-2" />
                Edit Quote
              </Button>
            )}
            {quote.status !== 'canceled' && !convertedToOrderId && (
              <Button
                size="sm"
                onClick={() => setShowConvertDialog(true)}
                disabled={convertToOrder.isPending}
                className="bg-titan-accent hover:bg-titan-accent-hover text-white rounded-titan-md"
              >
                <Package className="w-4 h-4 mr-2" />
                {convertToOrder.isPending ? 'Converting...' : 'Convert to Order'}
              </Button>
            )}
            {convertedToOrderId && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate(ROUTES.orders.detail(convertedToOrderId))}
                className="border-titan-border text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated rounded-titan-md"
              >
                <Package className="w-4 h-4 mr-2" />
                View Order
              </Button>
            )}
          </div>
        }
      />

      <ContentLayout className="space-y-4">
        {/* Quote Info Cards */}
        <div className="grid md:grid-cols-3 gap-4">
          <DataCard
            title="Bill To"
            className="bg-titan-bg-card border-titan-border-subtle"
          >
            <div className="space-y-1 text-titan-sm">
              {quote.billToName ? (
                <>
                  <div className="font-medium text-titan-text-primary">{quote.billToName}</div>
                  {quote.billToCompany && (
                    <div className="text-titan-text-secondary">{quote.billToCompany}</div>
                  )}
                  {quote.billToAddress1 && (
                    <div className="text-titan-text-secondary">{quote.billToAddress1}</div>
                  )}
                  {quote.billToAddress2 && (
                    <div className="text-titan-text-secondary">{quote.billToAddress2}</div>
                  )}
                  {(quote.billToCity || quote.billToState || quote.billToPostalCode) && (
                    <div className="text-titan-text-secondary">
                      {quote.billToCity && `${quote.billToCity}, `}
                      {quote.billToState && `${quote.billToState} `}
                      {quote.billToPostalCode}
                    </div>
                  )}
                  {quote.billToPhone && (
                    <div className="text-titan-text-secondary">{quote.billToPhone}</div>
                  )}
                  {quote.billToEmail && (
                    <div className="text-titan-text-secondary">{quote.billToEmail}</div>
                  )}
                </>
              ) : (
                <div className="text-titan-text-muted">
                  {quote.customerName || '—'}
                </div>
              )}
            </div>
          </DataCard>

          <DataCard
            title="Ship To"
            className="bg-titan-bg-card border-titan-border-subtle"
          >
            <div className="space-y-1 text-titan-sm">
              {quote.shipToName ? (
                <>
                  <div className="font-medium text-titan-text-primary">{quote.shipToName}</div>
                  {quote.shipToCompany && (
                    <div className="text-titan-text-secondary">{quote.shipToCompany}</div>
                  )}
                  {quote.shipToAddress1 && (
                    <div className="text-titan-text-secondary">{quote.shipToAddress1}</div>
                  )}
                  {quote.shipToAddress2 && (
                    <div className="text-titan-text-secondary">{quote.shipToAddress2}</div>
                  )}
                  {(quote.shipToCity || quote.shipToState || quote.shipToPostalCode) && (
                    <div className="text-titan-text-secondary">
                      {quote.shipToCity && `${quote.shipToCity}, `}
                      {quote.shipToState && `${quote.shipToState} `}
                      {quote.shipToPostalCode}
                    </div>
                  )}
                  {quote.shippingMethod && (
                    <div className="mt-2">
                      <Badge variant="outline" className="border-titan-border text-titan-text-secondary">
                        {quote.shippingMethod}
                      </Badge>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-titan-text-muted">—</div>
              )}
            </div>
          </DataCard>

          <DataCard
            title="Quote Information"
            className="bg-titan-bg-card border-titan-border-subtle"
          >
            <div className="space-y-2 text-titan-sm">
              <div>
                <span className="text-titan-text-muted">Created by: </span>
                <span className="text-titan-text-primary">
                  {quote.user ? `${quote.user.firstName || ''} ${quote.user.lastName || ''}`.trim() || quote.user.email : '—'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-titan-text-muted">Source: </span>
                <QuoteSourceBadge source={quote.source} />
              </div>
            </div>
          </DataCard>
        </div>

        {/* Line Items */}
        <DataCard
          title="Line Items"
          className="bg-titan-bg-card border-titan-border-subtle"
        >
          <div className="rounded-titan-lg border border-titan-border-subtle overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-titan-bg-card-elevated border-b border-titan-border-subtle">
                  <TableHead className="text-titan-text-secondary">Product</TableHead>
                  <TableHead className="text-titan-text-secondary">Variant</TableHead>
                  <TableHead className="text-titan-text-secondary">Dimensions</TableHead>
                  <TableHead className="text-center text-titan-text-secondary">Quantity</TableHead>
                  <TableHead className="text-right text-titan-text-secondary">Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quote.lineItems?.map((item: any, idx: number) => (
                  <TableRow key={item.id} className="border-b border-titan-border-subtle hover:bg-titan-bg-card-elevated/50">
                    <TableCell>
                      <div className="font-medium text-titan-text-primary">{item.productName}</div>
                      {item.selectedOptions && item.selectedOptions.length > 0 && (
                        <div className="text-xs text-titan-text-muted mt-1">
                          {item.selectedOptions.map((opt: any) => (
                            <span key={opt.optionId} className="mr-2">
                              {opt.optionName}
                              {typeof opt.value !== 'boolean' && `: ${opt.value}`}
                              {typeof opt.note === 'string' && opt.note.trim() !== '' && ` (${opt.note.trim()})`}
                            </span>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-titan-text-secondary">
                      {item.variantName || <span className="text-titan-text-muted">—</span>}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-titan-sm text-titan-text-secondary">
                        {parseFloat(item.width).toFixed(2)}" × {parseFloat(item.height).toFixed(2)}"
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="border-titan-border text-titan-text-secondary">
                        {item.quantity}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium text-titan-text-primary">
                      ${parseFloat(item.linePrice).toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DataCard>

        {/* Totals */}
        <div className="flex justify-end">
          <DataCard className="w-full md:w-1/2 lg:w-1/3 bg-titan-bg-card border-titan-border-subtle">
            <div className="space-y-2">
              <div className="flex justify-between text-titan-sm">
                <span className="text-titan-text-muted">Subtotal:</span>
                <span className="font-mono text-titan-text-secondary">${parseFloat(quote.subtotal).toFixed(2)}</span>
              </div>
              {parseFloat(quote.discountAmount) > 0 && (
                <div className="flex justify-between text-titan-sm">
                  <span className="text-titan-text-muted">Discount:</span>
                  <span className="font-mono text-titan-success">
                    -${parseFloat(quote.discountAmount).toFixed(2)}
                  </span>
                </div>
              )}
              {parseFloat(quote.taxRate ?? "0") > 0 && (
                <div className="flex justify-between text-titan-sm">
                  <span className="text-titan-text-muted">
                    Tax ({(parseFloat(quote.taxRate ?? "0") * 100).toFixed(2)}%):
                  </span>
                  <span className="font-mono text-titan-text-secondary">
                    ${(parseFloat(quote.subtotal) * parseFloat(quote.taxRate ?? "0")).toFixed(2)}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-titan-lg font-semibold border-t border-titan-border-subtle pt-2">
                <span className="text-titan-text-primary">Total:</span>
                <span className="font-mono text-titan-text-primary">${parseFloat(quote.totalPrice).toFixed(2)}</span>
              </div>
            </div>
          </DataCard>
        </div>
      </ContentLayout>
      <ConvertQuoteToOrderDialog
        open={showConvertDialog}
        onOpenChange={setShowConvertDialog}
        isLoading={convertToOrder.isPending}
        onSubmit={handleConvertToOrder}
      />
    </Page>
  );
}
