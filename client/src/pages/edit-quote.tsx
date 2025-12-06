import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ROUTES } from "@/config/routes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { 
  ArrowLeft, Save, Trash2, Plus, Mail, ExternalLink, Loader2, Check, ChevronsUpDown,
  Pencil, Paperclip 
} from "lucide-react";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { LineItemAttachmentsPanel, LineItemArtworkBadge } from "@/components/LineItemAttachmentsPanel";
import type { QuoteWithRelations, Product, ProductVariant } from "@shared/schema";

type Customer = {
  id: string;
  companyName: string;
  displayName: string | null;
};

type CustomerContact = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  isPrimary: boolean;
};

type QuoteLineItem = {
  id: string;
  productId: string;
  productName: string;
  variantId: string | null;
  variantName: string | null;
  productType: string;
  width: string;
  height: string;
  quantity: number;
  specsJson: Record<string, any> | null;
  selectedOptions: any[];
  linePrice: string;
  priceBreakdown: any;
  displayOrder: number;
};

export default function EditQuote() {
  const params = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClientInstance = useQueryClient();
  const quoteId = params?.id;

  const [customerName, setCustomerName] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [contactId, setContactId] = useState<string | null>(null);
  const [taxRate, setTaxRate] = useState(0);
  const [marginPercentage, setMarginPercentage] = useState(0);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");

  // Line item editing state
  const [lineItemDialogOpen, setLineItemDialogOpen] = useState(false);
  const [editingLineItem, setEditingLineItem] = useState<QuoteLineItem | null>(null);
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState("");
  
  // Line item form state
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [lineItemWidth, setLineItemWidth] = useState("");
  const [lineItemHeight, setLineItemHeight] = useState("");
  const [lineItemQuantity, setLineItemQuantity] = useState("1");
  const [lineItemNotes, setLineItemNotes] = useState("");
  const [calculatedPrice, setCalculatedPrice] = useState<number | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [lineItemError, setLineItemError] = useState<string | null>(null);

  // Fetch customers list
  const { data: customers } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  // Fetch contacts for selected customer
  const { data: contacts } = useQuery<CustomerContact[]>({
    queryKey: [`/api/customers/${customerId}/contacts`],
    enabled: !!customerId,
  });

  // Fetch products for line item form
  const { data: products } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  // Fetch variants for selected product
  const { data: productVariants } = useQuery<ProductVariant[]>({
    queryKey: ["/api/products", selectedProductId, "variants"],
    enabled: !!selectedProductId,
  });

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

  // Filter products for combobox
  const filteredProducts = useMemo(() => {
    if (!products) return [];
    const activeProducts = products.filter(p => p.isActive);
    if (!productSearchQuery) return activeProducts;
    const query = productSearchQuery.toLowerCase();
    return activeProducts.filter(p => 
      p.name.toLowerCase().includes(query) ||
      (p.sku && p.sku.toLowerCase().includes(query))
    );
  }, [products, productSearchQuery]);

  // Initialize form values when quote loads
  useEffect(() => {
    if (quote) {
      setCustomerName(quote.customerName || "");
      setCustomerId(quote.customerId || null);
      setContactId(quote.contactId || null);
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

  // Calculate price when product/dimensions change
  const calculatePrice = useCallback(async () => {
    if (!selectedProductId || !lineItemQuantity) {
      setCalculatedPrice(null);
      return;
    }

    const selectedProduct = products?.find(p => p.id === selectedProductId);
    const requiresDimensions = selectedProduct?.useNestingCalculator || 
      (selectedProduct?.pricingFormula && selectedProduct.pricingFormula.includes('sqft'));

    if (requiresDimensions && (!lineItemWidth || !lineItemHeight)) {
      setCalculatedPrice(null);
      return;
    }

    setIsCalculating(true);
    try {
      const response = await apiRequest("POST", "/api/quotes/calculate", {
        productId: selectedProductId,
        variantId: selectedVariantId,
        width: parseFloat(lineItemWidth) || 1,
        height: parseFloat(lineItemHeight) || 1,
        quantity: parseInt(lineItemQuantity),
        selectedOptions: {},
      });
      const data = await response.json();
      setCalculatedPrice(data.price);
    } catch (error) {
      console.error("Price calculation error:", error);
      setCalculatedPrice(null);
    } finally {
      setIsCalculating(false);
    }
  }, [selectedProductId, selectedVariantId, lineItemWidth, lineItemHeight, lineItemQuantity, products]);

  // Debounced calculation
  useEffect(() => {
    const timer = setTimeout(calculatePrice, 500);
    return () => clearTimeout(timer);
  }, [calculatePrice]);

  const updateQuoteMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("PATCH", `/api/quotes/${quoteId}`, data);
    },
    onSuccess: () => {
      toast({ title: "Quote Updated", description: "Your changes have been saved." });
      queryClientInstance.invalidateQueries({ queryKey: ["/api/quotes"] });
      queryClientInstance.invalidateQueries({ queryKey: ["/api/quotes", quoteId] });
    },
    onError: () => {
      toast({ 
        title: "Error", 
        description: "Failed to update quote",
        variant: "destructive"
      });
    },
  });

  const addLineItemMutation = useMutation({
    mutationFn: async (lineItem: any) => {
      console.log("[Add Line Item] Sending to:", `/api/quotes/${quoteId}/line-items`);
      console.log("[Add Line Item] Payload:", JSON.stringify(lineItem, null, 2));
      try {
        const response = await apiRequest("POST", `/api/quotes/${quoteId}/line-items`, lineItem);
        console.log("[Add Line Item] Response OK");
        return response;
      } catch (err) {
        console.error("[Add Line Item] Request failed:", err);
        throw err;
      }
    },
    onSuccess: () => {
      toast({ title: "Line Item Added", description: "The item has been added to the quote." });
      queryClientInstance.invalidateQueries({ queryKey: ["/api/quotes", quoteId] });
      resetLineItemForm();
      setLineItemDialogOpen(false);
    },
    onError: (error: Error) => {
      console.error("[Add Line Item] Mutation error:", error);
      const message = error.message || "Failed to add line item";
      // Check for network errors
      const isNetworkError = message === "Failed to fetch" || message.includes("NetworkError");
      const displayMessage = isNetworkError 
        ? "Unable to reach server. Check if dev server is running."
        : message;
      setLineItemError(displayMessage);
      toast({ 
        title: isNetworkError ? "Network Error" : "Error", 
        description: displayMessage,
        variant: "destructive"
      });
    },
  });

  const updateLineItemMutation = useMutation({
    mutationFn: async ({ lineItemId, data }: { lineItemId: string; data: any }) => {
      console.log("[Update Line Item] Sending to:", `/api/quotes/${quoteId}/line-items/${lineItemId}`);
      console.log("[Update Line Item] Payload:", JSON.stringify(data, null, 2));
      try {
        const response = await apiRequest("PATCH", `/api/quotes/${quoteId}/line-items/${lineItemId}`, data);
        console.log("[Update Line Item] Response OK");
        return response;
      } catch (err) {
        console.error("[Update Line Item] Request failed:", err);
        throw err;
      }
    },
    onSuccess: () => {
      toast({ title: "Line Item Updated", description: "The item has been updated." });
      queryClientInstance.invalidateQueries({ queryKey: ["/api/quotes", quoteId] });
      resetLineItemForm();
      setLineItemDialogOpen(false);
    },
    onError: (error: Error) => {
      console.error("[Update Line Item] Mutation error:", error);
      const message = error.message || "Failed to update line item";
      const isNetworkError = message === "Failed to fetch" || message.includes("NetworkError");
      const displayMessage = isNetworkError 
        ? "Unable to reach server. Check if dev server is running."
        : message;
      setLineItemError(displayMessage);
      toast({ 
        title: isNetworkError ? "Network Error" : "Error", 
        description: displayMessage,
        variant: "destructive"
      });
    },
  });

  const deleteLineItemMutation = useMutation({
    mutationFn: async (lineItemId: string) => {
      console.log("[Delete Line Item] Sending to:", `/api/quotes/${quoteId}/line-items/${lineItemId}`);
      try {
        const response = await apiRequest("DELETE", `/api/quotes/${quoteId}/line-items/${lineItemId}`);
        console.log("[Delete Line Item] Response OK");
        return response;
      } catch (err) {
        console.error("[Delete Line Item] Request failed:", err);
        throw err;
      }
    },
    onSuccess: () => {
      toast({ title: "Line Item Deleted" });
      queryClientInstance.invalidateQueries({ queryKey: ["/api/quotes", quoteId] });
    },
    onError: (error: Error) => {
      console.error("[Delete Line Item] Mutation error:", error);
      const message = error.message || "Failed to delete line item";
      const isNetworkError = message === "Failed to fetch" || message.includes("NetworkError");
      toast({
        title: isNetworkError ? "Network Error" : "Error",
        description: isNetworkError 
          ? "Unable to reach server. Check if dev server is running."
          : message,
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

  const resetLineItemForm = () => {
    setSelectedProductId("");
    setSelectedVariantId(null);
    setLineItemWidth("");
    setLineItemHeight("");
    setLineItemQuantity("1");
    setLineItemNotes("");
    setCalculatedPrice(null);
    setEditingLineItem(null);
    setLineItemError(null);
  };

  const handleOpenAddLineItem = () => {
    resetLineItemForm();
    setLineItemDialogOpen(true);
  };

  const handleOpenEditLineItem = (lineItem: QuoteLineItem) => {
    setEditingLineItem(lineItem);
    setSelectedProductId(lineItem.productId);
    setSelectedVariantId(lineItem.variantId);
    setLineItemWidth(lineItem.width);
    setLineItemHeight(lineItem.height);
    setLineItemQuantity(lineItem.quantity.toString());
    setLineItemNotes((lineItem.specsJson as any)?.notes || "");
    setCalculatedPrice(parseFloat(lineItem.linePrice));
    setLineItemError(null);
    setLineItemDialogOpen(true);
  };

  const handleSaveLineItem = async () => {
    // Guard: ensure we have a quote ID
    if (!quoteId) {
      console.error("[handleSaveLineItem] No quoteId available!");
      toast({
        title: "Error",
        description: "Quote ID is missing. Please refresh the page.",
        variant: "destructive",
      });
      return;
    }

    if (!selectedProductId || calculatedPrice === null) {
      console.warn("[handleSaveLineItem] Missing product or price:", { selectedProductId, calculatedPrice });
      return;
    }

    const product = products?.find(p => p.id === selectedProductId);
    const variant = productVariants?.find(v => v.id === selectedVariantId);

    const lineItemData = {
      productId: selectedProductId,
      productName: product?.name || "",
      variantId: selectedVariantId,
      variantName: variant?.name || null,
      productType: "wide_roll",
      width: parseFloat(lineItemWidth) || 1,
      height: parseFloat(lineItemHeight) || 1,
      quantity: parseInt(lineItemQuantity),
      specsJson: lineItemNotes ? { notes: lineItemNotes } : null,
      selectedOptions: [],
      linePrice: calculatedPrice,
      priceBreakdown: {
        basePrice: calculatedPrice,
        optionsPrice: 0,
        total: calculatedPrice,
        formula: "",
      },
      displayOrder: editingLineItem?.displayOrder ?? (quote?.lineItems.length || 0),
    };

    console.log("[handleSaveLineItem] lineItemData:", lineItemData);

    if (editingLineItem) {
      updateLineItemMutation.mutate({ lineItemId: editingLineItem.id, data: lineItemData });
    } else {
      addLineItemMutation.mutate(lineItemData);
    }
  };

  const handleSave = () => {
    updateQuoteMutation.mutate({
      customerName: customerName || null,
      customerId: customerId || null,
      contactId: contactId || null,
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

  // Navigate back to internal quotes list (FIX #2)
  const handleBack = () => {
    navigate(ROUTES.quotes.list);
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
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="customer">Customer</Label>
            <Select
              value={customerId || "none"}
              onValueChange={(value) => {
                if (value === "none") {
                  setCustomerId(null);
                  setContactId(null);
                  setCustomerName("");
                } else {
                  setCustomerId(value);
                  setContactId(null);
                  const customer = customers?.find(c => c.id === value);
                  setCustomerName(customer?.companyName || "");
                }
              }}
            >
              <SelectTrigger data-testid="select-customer">
                <SelectValue placeholder="Select a customer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Customer (Manual Entry)</SelectItem>
                {customers?.map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {customer.companyName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {customerId && (
              <Link to={ROUTES.customers.detail(customerId)}>
                <Button variant="link" size="sm" className="p-0 h-auto">
                  <ExternalLink className="w-3 h-3 mr-1" />
                  View Customer Details
                </Button>
              </Link>
            )}
          </div>

          {customerId && contacts && contacts.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="contact">Contact</Label>
              <Select
                value={contactId || "none"}
                onValueChange={(value) => setContactId(value === "none" ? null : value)}
              >
                <SelectTrigger data-testid="select-contact">
                  <SelectValue placeholder="Select a contact" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Contact</SelectItem>
                  {contacts.map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contact.firstName} {contact.lastName}
                      {contact.isPrimary && " (Primary)"}
                      {contact.email && ` - ${contact.email}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {!customerId && (
            <div className="space-y-2">
              <Label htmlFor="customerName">Customer Name (Manual Entry)</Label>
              <Input
                id="customerName"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Enter customer name"
                data-testid="input-customer-name"
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-line-items">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Line Items</CardTitle>
              <CardDescription>Products included in this quote</CardDescription>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleOpenAddLineItem}
              data-testid="button-add-line-item"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Item
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {quote.lineItems.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-muted-foreground">No line items</p>
              <Button 
                variant="outline" 
                className="mt-4"
                onClick={handleOpenAddLineItem}
              >
                <Plus className="w-4 h-4 mr-2" />
                Add First Item
              </Button>
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
                    <TableHead>Artwork</TableHead>
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
                      <TableCell>
                        <LineItemArtworkBadge 
                          quoteId={quoteId!} 
                          lineItemId={item.id}
                        />
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${parseFloat(item.linePrice).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleOpenEditLineItem(item as any)}
                            data-testid={`button-edit-${item.id}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteLineItem(item.id)}
                            data-testid={`button-delete-${item.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
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

      {/* Totals Card with integrated Price Adjustments (FIX #4) */}
      <Card data-testid="card-totals">
        <CardHeader>
          <CardTitle>Quote Totals</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Price Adjustment Inputs - Compact Row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="taxRate" className="text-xs">Tax Rate (%)</Label>
              <Input
                id="taxRate"
                type="number"
                step="0.01"
                value={taxRate}
                onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                className="h-8"
                data-testid="input-tax-rate"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="marginPercentage" className="text-xs">Margin (%)</Label>
              <Input
                id="marginPercentage"
                type="number"
                step="0.01"
                value={marginPercentage}
                onChange={(e) => setMarginPercentage(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                className="h-8"
                data-testid="input-margin-percentage"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="discountAmount" className="text-xs">Discount ($)</Label>
              <Input
                id="discountAmount"
                type="number"
                step="0.01"
                value={discountAmount}
                onChange={(e) => setDiscountAmount(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                className="h-8"
                data-testid="input-discount-amount"
              />
            </div>
          </div>

          <Separator />

          {/* Totals Breakdown */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal:</span>
              <span className="font-mono">${subtotal.toFixed(2)}</span>
            </div>
            {taxRate > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax ({taxRate}%):</span>
                <span className="font-mono">+${taxAmount.toFixed(2)}</span>
              </div>
            )}
            {marginPercentage > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Margin ({marginPercentage}%):</span>
                <span className="font-mono">+${marginAmount.toFixed(2)}</span>
              </div>
            )}
            {discountAmount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Discount:</span>
                <span className="font-mono text-green-600">-${discountAmount.toFixed(2)}</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between text-lg font-bold">
              <span>Total:</span>
              <span className="font-mono" data-testid="text-total-price">${total.toFixed(2)}</span>
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

      {/* Line Item Dialog (FIX #1 and #3) */}
      <Dialog open={lineItemDialogOpen} onOpenChange={(open) => {
        if (!open) {
          resetLineItemForm();
        }
        setLineItemDialogOpen(open);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingLineItem ? "Edit Line Item" : "Add Line Item"}
            </DialogTitle>
            <DialogDescription>
              {editingLineItem ? "Update the product details" : "Add a new product to this quote"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Product Selection */}
            <div className="space-y-2">
              <Label>Product</Label>
              <Popover open={productSearchOpen} onOpenChange={setProductSearchOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={productSearchOpen}
                    className="w-full justify-between font-normal"
                  >
                    {selectedProductId
                      ? products?.find(p => p.id === selectedProductId)?.name || "Select product..."
                      : "Select product..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[350px] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput 
                      placeholder="Search products..." 
                      value={productSearchQuery}
                      onValueChange={setProductSearchQuery}
                    />
                    <CommandList>
                      <CommandEmpty>No products found.</CommandEmpty>
                      <CommandGroup>
                        {filteredProducts.map((product) => (
                          <CommandItem
                            key={product.id}
                            value={product.id}
                            onSelect={() => {
                              setSelectedProductId(product.id);
                              setProductSearchOpen(false);
                              setProductSearchQuery("");
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedProductId === product.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <span className="truncate">{product.name}</span>
                            {product.sku && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                {product.sku}
                              </span>
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Variant Selection */}
            {productVariants && productVariants.filter(v => v.isActive).length > 0 && (
              <div className="space-y-2">
                <Label>Variant</Label>
                <Select value={selectedVariantId || ""} onValueChange={setSelectedVariantId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select variant" />
                  </SelectTrigger>
                  <SelectContent>
                    {productVariants.filter(v => v.isActive).map((variant) => (
                      <SelectItem key={variant.id} value={variant.id}>
                        {variant.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Dimensions */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Width (in)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={lineItemWidth}
                  onChange={(e) => setLineItemWidth(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label>Height (in)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={lineItemHeight}
                  onChange={(e) => setLineItemHeight(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>

            {/* Quantity */}
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input
                type="number"
                min="1"
                value={lineItemQuantity}
                onChange={(e) => setLineItemQuantity(e.target.value)}
              />
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea
                value={lineItemNotes}
                onChange={(e) => setLineItemNotes(e.target.value)}
                placeholder="Special instructions..."
                rows={2}
              />
            </div>

            {/* Calculated Price */}
            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-sm text-muted-foreground">Calculated Price:</span>
              {isCalculating ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Calculating...</span>
                </div>
              ) : calculatedPrice !== null ? (
                <span className="text-lg font-semibold font-mono">${calculatedPrice.toFixed(2)}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>

            {/* Artwork Attachments - only show when editing existing line item */}
            {editingLineItem && (
              <div className="pt-2 border-t">
                <LineItemAttachmentsPanel
                  quoteId={quoteId!}
                  lineItemId={editingLineItem.id}
                  defaultExpanded={true}
                />
              </div>
            )}

            {/* Inline Error Display */}
            {lineItemError && (
              <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                {lineItemError}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLineItemDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSaveLineItem}
              disabled={!selectedProductId || calculatedPrice === null || addLineItemMutation.isPending || updateLineItemMutation.isPending}
            >
              {(addLineItemMutation.isPending || updateLineItemMutation.isPending) ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : editingLineItem ? "Update Item" : "Add Item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
