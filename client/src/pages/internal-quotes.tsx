import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileText, Plus, Edit, Package, Eye, User, ArrowLeft } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useConvertQuoteToOrder } from "@/hooks/useOrders";
import { QuoteSourceBadge } from "@/components/quote-source-badge";
import { useAuth } from "@/hooks/useAuth";
import { Page, PageHeader, ContentLayout, FilterPanel, DataCard } from "@/components/titan";
import type { QuoteWithRelations, Product } from "@shared/schema";

export default function InternalQuotes() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [searchCustomer, setSearchCustomer] = useState("");
  const [searchProduct, setSearchProduct] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [orderDueDate, setOrderDueDate] = useState("");
  const [orderPromisedDate, setOrderPromisedDate] = useState("");
  const [orderPriority, setOrderPriority] = useState<"normal" | "rush" | "low">("normal");
  const [orderNotes, setOrderNotes] = useState("");

  const convertToOrder = useConvertQuoteToOrder();

  // Check if user is internal staff
  const isInternalUser = user && ['admin', 'owner', 'manager', 'employee'].includes(user.role || '');

  const { data: quotes, isLoading } = useQuery<QuoteWithRelations[]>({
    queryKey: [
      "/api/quotes",
      { source: "internal", searchCustomer, searchProduct, startDate, endDate }
    ],
    queryFn: async () => {
      const params = new URLSearchParams({ source: "internal" });
      if (searchCustomer) params.set("searchCustomer", searchCustomer);
      if (searchProduct && searchProduct !== "all") params.set("searchProduct", searchProduct);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);

      const url = `/api/quotes${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await fetch(url, { credentials: "include" });
      
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text}`);
      }
      
      return response.json();
    },
    enabled: isInternalUser,
  });

  const { data: products } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const handleClearFilters = () => {
    setSearchCustomer("");
    setSearchProduct("all");
    setStartDate("");
    setEndDate("");
  };

  const handleConvertToOrder = (quoteId: string) => {
    setSelectedQuoteId(quoteId);
    setConvertDialogOpen(true);
  };

  const handleConfirmConvert = async () => {
    if (!selectedQuoteId) return;
    
    const quote = quotes?.find(q => q.id === selectedQuoteId);
    console.log('[INTERNAL QUOTES] Converting quote to order:', {
      quoteId: selectedQuoteId,
      quoteNumber: quote?.quoteNumber,
      customerId: quote?.customerId,
      contactId: quote?.contactId,
      source: quote?.source,
    });

    try {
      const result = await convertToOrder.mutateAsync({
        quoteId: selectedQuoteId,
        dueDate: orderDueDate || undefined,
        promisedDate: orderPromisedDate || undefined,
        priority: orderPriority,
        notesInternal: orderNotes || undefined,
      });
      
      console.log('[INTERNAL QUOTES] Quote converted successfully:', result);
      
      setConvertDialogOpen(false);
      setSelectedQuoteId(null);
      setOrderDueDate("");
      setOrderPromisedDate("");
      setOrderPriority("normal");
      setOrderNotes("");
      
      toast({
        title: "Success",
        description: `Quote ${quote?.quoteNumber} converted to order ${result?.orderNumber}`,
      });
      
      if (result?.id) {
        navigate(`/orders/${result.id}`);
      }
    } catch (error) {
      console.error('[INTERNAL QUOTES] Conversion error:', error);
      toast({
        title: "Error Converting Quote",
        description: error instanceof Error ? error.message : "Failed to convert quote to order. Please try again.",
        variant: "destructive",
      });
    }
  };

  if (!isInternalUser) {
    return (
      <Page>
        <DataCard>
          <div className="py-16 text-center">
            <p className="text-muted-foreground">Access denied. This page is for internal staff only.</p>
          </div>
        </DataCard>
      </Page>
    );
  }

  if (isLoading) {
    return (
      <Page>
        <ContentLayout>
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-96 w-full" />
        </ContentLayout>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Internal Quotes"
        subtitle="Manage internal quotes and convert them to orders"
        backButton={
          <Button variant="ghost" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
        }
        actions={
          <Button onClick={() => navigate("/quotes/new")}>
            <Plus className="w-4 h-4 mr-2" />
            New Quote
          </Button>
        }
      />

      <ContentLayout>
        {/* Filters */}
        <FilterPanel title="Filter Quotes" description="Search and narrow down internal quotes">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="searchCustomer">Customer Name</Label>
              <Input
                id="searchCustomer"
                placeholder="Search by customer"
                value={searchCustomer}
                onChange={(e) => setSearchCustomer(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="searchProduct">Product Type</Label>
              <Select value={searchProduct} onValueChange={setSearchProduct}>
                <SelectTrigger id="searchProduct">
                  <SelectValue placeholder="All products" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All products</SelectItem>
                  {products?.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="startDate">Start Date</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="endDate">End Date</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <Button variant="outline" onClick={handleClearFilters}>
            Clear Filters
          </Button>
        </FilterPanel>

        {/* Quotes List */}
        <DataCard
          title="Internal Quotes"
          description={`${quotes?.length ?? 0} quote${quotes?.length !== 1 ? 's' : ''} found`}
        >
          {!quotes || quotes.length === 0 ? (
            <div className="py-16 text-center">
              <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground mb-2">No quotes found</p>
              <p className="text-sm text-muted-foreground mb-4">
                {searchCustomer || searchProduct || startDate || endDate
                  ? "Try adjusting your filters"
                  : "Create your first internal quote"}
              </p>
              <Button onClick={() => navigate("/quotes/new")}>
                <Plus className="w-4 h-4 mr-2" />
                New Quote
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quote #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Created By</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="w-[200px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quotes.map((quote) => (
                    <TableRow 
                      key={quote.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/quotes/${quote.id}`)}
                    >
                      <TableCell>
                        <Badge variant="outline" className="font-mono">
                          {quote.quoteNumber || 'N/A'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {format(new Date(quote.createdAt), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {quote.customerId ? (
                          <Link href={`/customers/${quote.customerId}`}>
                            <Button variant="link" className="p-0 h-auto font-normal">
                              {quote.customerName || "View Customer"}
                            </Button>
                          </Link>
                        ) : quote.customerName ? (
                          <span>{quote.customerName}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {quote.lineItems?.length || 0} items
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <QuoteSourceBadge source={quote.source} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm">
                            {quote.user ? `${quote.user.firstName || ''} ${quote.user.lastName || ''}`.trim() || quote.user.email : '—'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        ${parseFloat(quote.totalPrice).toFixed(2)}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => navigate(`/quotes/${quote.id}`)}
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            View
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => navigate(`/quotes/${quote.id}/edit`)}
                          >
                            <Edit className="w-4 h-4 mr-1" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleConvertToOrder(quote.id)}
                          >
                            <Package className="w-4 h-4 mr-1" />
                            Order
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DataCard>
      </ContentLayout>

      {/* Convert to Order Dialog */}
      <Dialog open={convertDialogOpen} onOpenChange={setConvertDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert Quote to Order</DialogTitle>
            <DialogDescription>
              This will create a new order from the selected quote.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="dueDate">Due Date (Optional)</Label>
              <Input
                id="dueDate"
                type="date"
                value={orderDueDate}
                onChange={(e) => setOrderDueDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="promisedDate">Promised Date (Optional)</Label>
              <Input
                id="promisedDate"
                type="date"
                value={orderPromisedDate}
                onChange={(e) => setOrderPromisedDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select value={orderPriority} onValueChange={(value: any) => setOrderPriority(value)}>
                <SelectTrigger id="priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="rush">Rush</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Internal Notes (Optional)</Label>
              <Input
                id="notes"
                placeholder="Production notes, special instructions..."
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConvertDialogOpen(false);
                setSelectedQuoteId(null);
                setOrderDueDate("");
                setOrderPromisedDate("");
                setOrderPriority("normal");
                setOrderNotes("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmConvert}
              disabled={convertToOrder.isPending}
            >
              {convertToOrder.isPending ? "Creating..." : "Create Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
