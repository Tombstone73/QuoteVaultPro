import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileText, Search, Edit, Mail, Package } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useConvertQuoteToOrder } from "@/hooks/useOrders";
import { QuoteSourceBadge } from "@/components/quote-source-badge";
import type { Quote, Product, QuoteWithRelations } from "@shared/schema";

function extractOrderIdFromConvertResult(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;

  if ("id" in result) {
    const id = (result as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }

  const data = (result as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;

  const order = (data as { order?: unknown }).order;
  if (!order || typeof order !== "object") return null;

  const id = (order as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

export default function QuoteHistory() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [searchCustomer, setSearchCustomer] = useState("");
  const [searchProduct, setSearchProduct] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [orderDueDate, setOrderDueDate] = useState("");
  const [orderPriority, setOrderPriority] = useState<"normal" | "rush" | "low">("normal");

  const convertToOrder = useConvertQuoteToOrder();

  const { data: quotes, isLoading } = useQuery<QuoteWithRelations[]>({
    queryKey: [
      "/api/quotes",
      { searchCustomer, searchProduct, startDate, endDate, minPrice, maxPrice }
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchCustomer) params.set("searchCustomer", searchCustomer);
      if (searchProduct && searchProduct !== "all") params.set("searchProduct", searchProduct);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (minPrice) params.set("minPrice", minPrice);
      if (maxPrice) params.set("maxPrice", maxPrice);

      const url = `/api/quotes${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await fetch(url, { credentials: "include" });
      
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text}`);
      }
      
      return response.json();
    },
  });

  const { data: products } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const handleClearFilters = () => {
    setSearchCustomer("");
    setSearchProduct("all");
    setStartDate("");
    setEndDate("");
    setMinPrice("");
    setMaxPrice("");
  };

  const emailQuoteMutation = useMutation({
    mutationFn: async ({ quoteId, email }: { quoteId: string; email: string }) => {
      return apiRequest("POST", `/api/quotes/${quoteId}/email`, { recipientEmail: email });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Quote email sent successfully!",
      });
      setEmailDialogOpen(false);
      setRecipientEmail("");
      setSelectedQuoteId(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send quote email",
        variant: "destructive",
      });
    },
  });

  const handleEmailQuote = (quoteId: string) => {
    setSelectedQuoteId(quoteId);
    setEmailDialogOpen(true);
  };

  const handleConvertToOrder = (quoteId: string) => {
    setSelectedQuoteId(quoteId);
    setConvertDialogOpen(true);
  };

  const handleConfirmConvert = async () => {
    if (!selectedQuoteId) return;
    
    try {
      const result = await convertToOrder.mutateAsync({
        quoteId: selectedQuoteId,
        dueDate: orderDueDate || undefined,
        priority: orderPriority,
      });
      
      setConvertDialogOpen(false);
      setSelectedQuoteId(null);
      setOrderDueDate("");
      setOrderPriority("normal");
      
      const orderId = extractOrderIdFromConvertResult(result);
      if (orderId) navigate(`/orders/${orderId}`);
    } catch (error) {
      // Error toast handled by mutation
    }
  };

  const handleSendEmail = () => {
    if (!recipientEmail) {
      toast({
        title: "Error",
        description: "Please enter an email address",
        variant: "destructive",
      });
      return;
    }
    if (selectedQuoteId) {
      emailQuoteMutation.mutate({ quoteId: selectedQuoteId, email: recipientEmail });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card data-testid="card-filters">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="w-5 h-5" />
            Filter Quotes
          </CardTitle>
          <CardDescription>Search and filter your quote history</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="searchCustomer" data-testid="label-filter-customer">Customer Name</Label>
              <Input
                id="searchCustomer"
                placeholder="Search by customer"
                value={searchCustomer}
                onChange={(e) => setSearchCustomer(e.target.value)}
                data-testid="input-filter-customer"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="searchProduct" data-testid="label-filter-product">Product Type</Label>
              <Select value={searchProduct} onValueChange={setSearchProduct}>
                <SelectTrigger id="searchProduct" data-testid="select-filter-product">
                  <SelectValue placeholder="All products" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" data-testid="option-filter-all-products">All products</SelectItem>
                  {products?.map((product) => (
                    <SelectItem key={product.id} value={product.id} data-testid={`option-filter-product-${product.id}`}>
                      {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="startDate" data-testid="label-filter-start-date">Start Date</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                data-testid="input-filter-start-date"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="endDate" data-testid="label-filter-end-date">End Date</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                data-testid="input-filter-end-date"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="minPrice" data-testid="label-filter-min-price">Min Price</Label>
              <Input
                id="minPrice"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                data-testid="input-filter-min-price"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxPrice" data-testid="label-filter-max-price">Max Price</Label>
              <Input
                id="maxPrice"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                data-testid="input-filter-max-price"
              />
            </div>
          </div>

          <Button variant="outline" onClick={handleClearFilters} data-testid="button-clear-filters">
            Clear Filters
          </Button>
        </CardContent>
      </Card>

      <Card data-testid="card-quote-list">
        <CardHeader>
          <CardTitle>Your Quotes</CardTitle>
          <CardDescription>
            {quotes?.length ?? 0} quote{quotes?.length !== 1 ? 's' : ''} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!quotes || quotes.length === 0 ? (
            <div className="py-16 text-center" data-testid="empty-state-quotes">
              <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground mb-2">No quotes found</p>
              <p className="text-sm text-muted-foreground">
                {searchCustomer || searchProduct || startDate || endDate || minPrice || maxPrice
                  ? "Try adjusting your filters"
                  : "Create your first quote using the calculator"}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead data-testid="header-quote-number">Quote #</TableHead>
                    <TableHead data-testid="header-date">Date</TableHead>
                    <TableHead data-testid="header-customer">Customer</TableHead>
                    <TableHead data-testid="header-items">Items</TableHead>
                    <TableHead data-testid="header-source">Source</TableHead>
                    <TableHead data-testid="header-price" className="text-right">Total</TableHead>
                    <TableHead data-testid="header-actions" className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quotes.map((quote) => (
                    <TableRow key={quote.id} data-testid={`row-quote-${quote.id}`}>
                      <TableCell data-testid={`cell-quote-number-${quote.id}`}>
                        <Badge variant="outline" className="font-mono">
                          {quote.quoteNumber || 'N/A'}
                        </Badge>
                      </TableCell>
                      <TableCell data-testid={`cell-date-${quote.id}`}>
                        {format(new Date(quote.createdAt), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell data-testid={`cell-customer-${quote.id}`}>
                        {quote.customerId ? (
                          <Link href={`/customers/${quote.customerId}`}>
                            <Button variant="link" className="p-0 h-auto font-normal">
                              {quote.customerName || "View Customer"}
                            </Button>
                          </Link>
                        ) : quote.customerName ? (
                          <span>{quote.customerName}</span>
                        ) : (
                          <span className="text-muted-foreground italic">Not specified</span>
                        )}
                      </TableCell>
                      <TableCell data-testid={`cell-items-${quote.id}`}>
                        {quote.lineItems && quote.lineItems.length > 0 ? (
                          <Badge variant="secondary">
                            {quote.lineItems.length} item{quote.lineItems.length !== 1 ? 's' : ''}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground italic text-sm">No items</span>
                        )}
                      </TableCell>
                      <TableCell data-testid={`cell-source-${quote.id}`}>
                        <QuoteSourceBadge source={quote.source} />
                      </TableCell>
                      <TableCell className="text-right font-mono" data-testid={`cell-price-${quote.id}`}>
                        ${parseFloat(quote.totalPrice).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Link href={`/quotes/${quote.id}/edit`}>
                            <Button variant="ghost" size="sm" data-testid={`button-edit-${quote.id}`}>
                              <Edit className="w-4 h-4 mr-1" />
                              Edit
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEmailQuote(quote.id)}
                            data-testid={`button-email-${quote.id}`}
                          >
                            <Mail className="w-4 h-4 mr-1" />
                            Email
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleConvertToOrder(quote.id)}
                            data-testid={`button-convert-${quote.id}`}
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
        </CardContent>
      </Card>

      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5" />
              Email Quote
            </DialogTitle>
            <DialogDescription>
              Send this quote to a recipient via email
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="recipientEmail">Recipient Email</Label>
              <Input
                id="recipientEmail"
                type="email"
                placeholder="customer@example.com"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleSendEmail();
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEmailDialogOpen(false);
                setRecipientEmail("");
                setSelectedQuoteId(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSendEmail}
              disabled={emailQuoteMutation.isPending}
            >
              {emailQuoteMutation.isPending ? "Sending..." : "Send Email"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={convertDialogOpen} onOpenChange={setConvertDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5" />
              Convert Quote to Order
            </DialogTitle>
            <DialogDescription>
              Create a new order from this quote with optional scheduling information
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="orderDueDate">Due Date (Optional)</Label>
              <Input
                id="orderDueDate"
                type="date"
                value={orderDueDate}
                onChange={(e) => setOrderDueDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="orderPriority">Priority</Label>
              <Select value={orderPriority} onValueChange={(value: any) => setOrderPriority(value)}>
                <SelectTrigger id="orderPriority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rush">Rush</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConvertDialogOpen(false);
                setSelectedQuoteId(null);
                setOrderDueDate("");
                setOrderPriority("normal");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmConvert}
              disabled={convertToOrder.isPending}
            >
              {convertToOrder.isPending ? "Converting..." : "Convert to Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
