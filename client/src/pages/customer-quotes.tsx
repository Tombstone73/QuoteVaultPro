import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileText, Package, Eye, ArrowLeft } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useConvertQuoteToOrder } from "@/hooks/useOrders";
import { QuoteSourceBadge } from "@/components/quote-source-badge";
import type { QuoteWithRelations } from "@shared/schema";

export default function CustomerQuotes() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [orderNotes, setOrderNotes] = useState("");
  const [orderPriority, setOrderPriority] = useState<"normal" | "rush" | "low">("normal");

  const convertToOrder = useConvertQuoteToOrder();

  const { data: quotes, isLoading } = useQuery<QuoteWithRelations[]>({
    queryKey: ["/api/quotes", { source: "customer_quick_quote" }],
    queryFn: async () => {
      const params = new URLSearchParams({ source: "customer_quick_quote" });
      const url = `/api/quotes?${params.toString()}`;
      const response = await fetch(url, { credentials: "include" });
      
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text}`);
      }
      
      return response.json();
    },
  });

  const handleConvertToOrder = (quoteId: string) => {
    setSelectedQuoteId(quoteId);
    setConvertDialogOpen(true);
  };

  const handleConfirmConvert = async () => {
    if (!selectedQuoteId) return;
    
    const quote = quotes?.find(q => q.id === selectedQuoteId);
    console.log('[CUSTOMER QUOTES] Converting quote to order:', {
      quoteId: selectedQuoteId,
      quoteNumber: quote?.quoteNumber,
      customerId: quote?.customerId,
      contactId: quote?.contactId,
      source: quote?.source,
    });

    try {
      const result = await convertToOrder.mutateAsync({
        quoteId: selectedQuoteId,
        priority: orderPriority,
        notesInternal: orderNotes || undefined,
      });
      
      console.log('[CUSTOMER QUOTES] Quote converted successfully:', result);
      
      setConvertDialogOpen(false);
      setSelectedQuoteId(null);
      setOrderNotes("");
      setOrderPriority("normal");
      
      toast({
        title: "Success",
        description: `Quote ${quote?.quoteNumber} converted to order ${result?.orderNumber}`,
      });
      
      if (result?.id) {
        navigate(`/orders/${result.id}`);
      }
    } catch (error) {
      console.error('[CUSTOMER QUOTES] Conversion error:', error);
      toast({
        title: "Error Converting Quote",
        description: error instanceof Error ? error.message : "Failed to convert quote to order. Please try again.",
        variant: "destructive",
      });
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

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
          <div>
            <h1 className="text-3xl font-bold">My Quotes</h1>
            <p className="text-muted-foreground mt-1">
              View and manage your saved quotes
            </p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your Saved Quotes</CardTitle>
          <CardDescription>
            {quotes?.length ?? 0} quote{quotes?.length !== 1 ? 's' : ''} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!quotes || quotes.length === 0 ? (
            <div className="py-16 text-center">
              <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground mb-2">No quotes found</p>
              <p className="text-sm text-muted-foreground mb-4">
                Create your first quote using the calculator
              </p>
              <Button onClick={() => navigate("/")}>
                Go to Calculator
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quote #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="w-[180px]">Actions</TableHead>
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
                        <span className="font-mono text-titan-accent hover:text-titan-accent-hover hover:underline cursor-pointer">
                          {quote.quoteNumber || 'N/A'}
                        </span>
                      </TableCell>
                      <TableCell>
                        {format(new Date(quote.createdAt), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell>
                        {quote.customerName || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {quote.lineItems?.length || 0} items
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <QuoteSourceBadge source={quote.source} />
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
        </CardContent>
      </Card>

      {/* Convert to Order Dialog */}
      <Dialog open={convertDialogOpen} onOpenChange={setConvertDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert Quote to Order</DialogTitle>
            <DialogDescription>
              This will create a new order from your quote.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
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
              <Label htmlFor="notes">Special Instructions (Optional)</Label>
              <Input
                id="notes"
                placeholder="Any special requirements or notes..."
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
                setOrderNotes("");
                setOrderPriority("normal");
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
    </div>
  );
}
