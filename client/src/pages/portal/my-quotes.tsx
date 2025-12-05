import { useMyQuotes } from "@/hooks/usePortal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { Loader2, FileText, ArrowRight } from "lucide-react";
import { Page, PageHeader, ContentLayout, DataCard, StatusPill } from "@/components/titan";

export default function MyQuotes() {
  const { data: quotes, isLoading, error } = useMyQuotes();

  if (isLoading) {
    return (
      <Page>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-titan-text-muted" />
        </div>
      </Page>
    );
  }

  if (error) {
    return (
      <Page>
        <ContentLayout>
          <DataCard className="bg-titan-bg-card border-titan-border-subtle">
            <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
              <p className="text-titan-error mb-2">Failed to load quotes</p>
              <p className="text-titan-sm text-titan-text-muted">{(error as Error).message}</p>
            </div>
          </DataCard>
        </ContentLayout>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="My Quotes"
        subtitle="View and manage your quote requests"
        className="pb-3"
      />

      <ContentLayout className="space-y-4">
        {!quotes || quotes.length === 0 ? (
          <DataCard className="bg-titan-bg-card border-titan-border-subtle">
            <div className="flex flex-col items-center justify-center py-12">
              <FileText className="h-12 w-12 text-titan-text-muted mb-4" />
              <p className="text-titan-text-muted">No quotes found</p>
            </div>
          </DataCard>
        ) : (
          <div className="grid gap-4">
            {quotes.map((quote: any) => (
              <DataCard key={quote.id} className="bg-titan-bg-card border-titan-border-subtle">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-titan-lg font-semibold text-titan-text-primary">
                      Quote #{quote.quoteNumber}
                    </h3>
                    <p className="text-titan-sm text-titan-text-muted mt-1">
                      Created {new Date(quote.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <StatusPill variant="default">
                    {quote.source || 'draft'}
                  </StatusPill>
                </div>

                <div className="grid grid-cols-2 gap-4 text-titan-sm mb-4">
                  <div>
                    <p className="text-titan-text-muted">Reference</p>
                    <p className="font-medium text-titan-text-primary">{quote.customerName || 'N/A'}</p>
                  </div>
                </div>

                <div className="border-t border-titan-border-subtle pt-4">
                  <p className="text-titan-sm text-titan-text-muted mb-2">
                    {quote.lineItems?.length || 0} item(s)
                  </p>
                  <div className="flex items-center justify-between">
                    <div className="text-titan-xl font-bold text-titan-text-primary">
                      ${parseFloat(quote.totalPrice || 0).toFixed(2)}
                    </div>
                    <div className="flex gap-2">
                      <Link to={`/quotes/${quote.id}`}>
                        <Button 
                          variant="outline" 
                          size="sm"
                          className="border-titan-border text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated rounded-titan-md"
                        >
                          View Details
                        </Button>
                      </Link>
                      <Link to={`/portal/quotes/${quote.id}/checkout`}>
                        <Button 
                          size="sm"
                          className="bg-titan-accent hover:bg-titan-accent-hover text-white rounded-titan-md"
                        >
                          Proceed to Order
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>
              </DataCard>
            ))}
          </div>
        )}
      </ContentLayout>
    </Page>
  );
}
