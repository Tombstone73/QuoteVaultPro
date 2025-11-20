import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Save, Trash2, Plus, Mail } from "lucide-react";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { QuoteWithRelations } from "@shared/schema";

export default function EditQuote() {
  const [, params] = useRoute("/quotes/:id/edit");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const quoteId = params?.id;

  const [customerName, setCustomerName] = useState("");
  const [taxRate, setTaxRate] = useState(0);
  const [marginPercentage, setMarginPercentage] = useState(0);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");

  const { data: quote, isLoading } = useQuery<QuoteWithRelations>({
    queryKey: ["/api/quotes", quoteId],
    queryFn: async () => {
      const response = await fetch(`/api/quotes/${quoteId}`, { credentials: "include" });
      if (!response.ok) {
        throw new Error("Failed to fetch quote");
      }
      return response.json();
    },
    enabled: !!quoteId,
  });

  // Initialize form values when quote loads
  useEffect(() => {
    if (quote) {
      setCustomerName(quote.customerName || "");
      setTaxRate(parseFloat(quote.taxRate || "0") * 100); // Convert to percentage
      setMarginPercentage(parseFloat(quote.marginPercentage || "0") * 100);
      setDiscountAmount(parseFloat(quote.discountAmount || "0"));
    }
  }, [quote]);

  // Calculate totals
  const subtotal = quote?.lineItems.reduce((sum, item) => sum + parseFloat(item.linePrice), 0) || 0;
  const taxAmount = subtotal * (taxRate / 100);
  const marginAmount = subtotal * (marginPercentage / 100);
  const total = subtotal + taxAmount + marginAmount - discountAmount;

  const updateQuoteMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("PATCH", `/api/quotes/${quoteId}`, data);
    },
    onSuccess: () => {
      toast({ title: "Quote Updated", description: "Your changes have been saved." });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes", quoteId] });
    },
    onError: () => {
      toast({ 
        title: "Error", 
        description: "Failed to update quote",
        variant: "destructive"
      });
    },
  });

  const deleteLineItemMutation = useMutation({
    mutationFn: async (lineItemId: string) => {
      return apiRequest("DELETE", `/api/quotes/${quoteId}/line-items/${lineItemId}`);
    },
    onSuccess: () => {
      toast({ title: "Line Item Deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes", quoteId] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete line item",
        variant: "destructive"
      });
    },
  });

  const emailQuoteMutation = useMutation({
    mutationFn: async (email: string) => {
      return apiRequest("POST", `/api/quotes/${quoteId}/email`, { recipientEmail: email });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Quote email sent successfully!",
      });
      setEmailDialogOpen(false);
      setRecipientEmail("");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send quote email",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    updateQuoteMutation.mutate({
      customerName: customerName || null,
      subtotal,
      taxRate: taxRate / 100, // Convert back to decimal
      marginPercentage: marginPercentage / 100,
      discountAmount,
      totalPrice: total,
    });
  };

  const handleDeleteLineItem = (lineItemId: string) => {
    if (confirm("Are you sure you want to delete this line item?")) {
      deleteLineItemMutation.mutate(lineItemId);
    }
  };

  const handleBack = () => {
    setLocation("/");
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
    emailQuoteMutation.mutate(recipientEmail);
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-16 text-center">
            <p className="text-muted-foreground">Quote not found</p>
            <Button onClick={handleBack} className="mt-4">Back to Quotes</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={handleBack} data-testid="button-back">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Edit Quote</h1>
            {quote.quoteNumber && (
              <Badge variant="outline" className="font-mono text-base" data-testid="badge-quote-number">
                #{quote.quoteNumber}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Created {format(new Date(quote.createdAt), "MMM d, yyyy")}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setEmailDialogOpen(true)}
          data-testid="button-email-quote"
        >
          <Mail className="w-4 h-4 mr-2" />
          Email Quote
        </Button>
      </div>

      <Card data-testid="card-customer-info">
        <CardHeader>
          <CardTitle>Customer Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="customerName">Customer Name</Label>
            <Input
              id="customerName"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Enter customer name"
              data-testid="input-customer-name"
            />
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-line-items">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Line Items</CardTitle>
              <CardDescription>Products included in this quote</CardDescription>
            </div>
            <Button variant="outline" size="sm" disabled data-testid="button-add-line-item">
              <Plus className="w-4 h-4 mr-2" />
              Add Item
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {quote.lineItems.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-muted-foreground">No line items</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Dimensions</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Options</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quote.lineItems.map((item) => (
                    <TableRow key={item.id} data-testid={`row-line-item-${item.id}`}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{item.productName}</div>
                          {item.variantName && (
                            <div className="text-xs text-muted-foreground">{item.variantName}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{item.width}" × {item.height}"</TableCell>
                      <TableCell>{item.quantity}</TableCell>
                      <TableCell>
                        {item.selectedOptions && item.selectedOptions.length > 0 ? (
                          <span className="text-sm">{item.selectedOptions.length} selected</span>
                        ) : (
                          <span className="text-sm text-muted-foreground">None</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${parseFloat(item.linePrice).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteLineItem(item.id)}
                          data-testid={`button-delete-${item.id}`}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-price-adjustments">
        <CardHeader>
          <CardTitle>Price Adjustments</CardTitle>
          <CardDescription>Apply tax, margin, or discounts to the final price</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="taxRate">Tax Rate (%)</Label>
              <Input
                id="taxRate"
                type="number"
                step="0.01"
                value={taxRate}
                onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                data-testid="input-tax-rate"
              />
              <p className="text-xs text-muted-foreground">
                +${taxAmount.toFixed(2)}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="marginPercentage">Margin (%)</Label>
              <Input
                id="marginPercentage"
                type="number"
                step="0.01"
                value={marginPercentage}
                onChange={(e) => setMarginPercentage(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                data-testid="input-margin-percentage"
              />
              <p className="text-xs text-muted-foreground">
                +${marginAmount.toFixed(2)}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="discountAmount">Discount ($)</Label>
              <Input
                id="discountAmount"
                type="number"
                step="0.01"
                value={discountAmount}
                onChange={(e) => setDiscountAmount(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                data-testid="input-discount-amount"
              />
              <p className="text-xs text-muted-foreground">
                -${discountAmount.toFixed(2)}
              </p>
            </div>
          </div>

          <div className="border-t pt-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal:</span>
                <span className="font-mono">${subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax ({taxRate}%):</span>
                <span className="font-mono">+${taxAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Margin ({marginPercentage}%):</span>
                <span className="font-mono">+${marginAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Discount:</span>
                <span className="font-mono">-${discountAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold border-t pt-2">
                <span>Total:</span>
                <span className="font-mono" data-testid="text-total-price">${total.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button
          onClick={handleSave}
          disabled={updateQuoteMutation.isPending}
          data-testid="button-save-quote"
        >
          <Save className="w-4 h-4 mr-2" />
          {updateQuoteMutation.isPending ? "Saving..." : "Save Changes"}
        </Button>
        <Button variant="outline" onClick={handleBack} data-testid="button-cancel">
          Cancel
        </Button>
      </div>

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
    </div>
  );
}
