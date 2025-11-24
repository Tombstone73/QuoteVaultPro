import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Save, Plus, Calculator, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import type { Product, ProductVariant, QuoteWithRelations } from "@shared/schema";

type QuoteLineItemDraft = {
  tempId?: string;
  id?: string;
  productId: string;
  productName: string;
  variantId: string | null;
  variantName: string | null;
  productType: string;
  width: number;
  height: number;
  quantity: number;
  specsJson: Record<string, any>;
  selectedOptions: any[];
  linePrice: number;
  priceBreakdown: any;
  displayOrder: number;
};

export default function QuoteEditor() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [match, params] = useRoute("/quotes/:mode");
  const [, navigate] = useLocation();
  
  const mode = params?.mode === 'new' ? 'new' : params?.mode; // ID or 'new'
  const quoteId = mode !== 'new' ? mode : null;
  const isNewQuote = mode === 'new';

  const isInternalUser = user && ['admin', 'owner', 'manager', 'employee'].includes(user.role || '');

  // Customer search
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");

  // Line item being added
  const [lineItems, setLineItems] = useState<QuoteLineItemDraft[]>([]);
  const [editingLineItem, setEditingLineItem] = useState<QuoteLineItemDraft | null>(null);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [calculatedPrice, setCalculatedPrice] = useState<number | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load existing quote if editing
  const { data: quote, isLoading: quoteLoading } = useQuery<QuoteWithRelations>({
    queryKey: ["/api/quotes", quoteId],
    queryFn: async () => {
      if (!quoteId) throw new Error("Quote ID is required");
      const response = await fetch(`/api/quotes/${quoteId}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load quote");
      return response.json();
    },
    enabled: !isNewQuote && !!quoteId,
  });

  // Load data when editing existing quote
  useEffect(() => {
    if (quote && !isNewQuote) {
      setSelectedCustomerId(quote.customerId || null);
      setSelectedContactId(quote.contactId || null);
      setCustomerName(quote.customerName || "");
      setLineItems(quote.lineItems?.map((item, idx) => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        variantId: item.variantId,
        variantName: item.variantName,
        productType: item.productType || 'wide_roll',
        width: parseFloat(item.width),
        height: parseFloat(item.height),
        quantity: item.quantity,
        specsJson: item.specsJson || {},
        selectedOptions: item.selectedOptions || [],
        linePrice: parseFloat(item.linePrice),
        priceBreakdown: item.priceBreakdown,
        displayOrder: idx,
      })) || []);
    }
  }, [quote, isNewQuote]);

  const { data: products } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const { data: productVariants } = useQuery<ProductVariant[]>({
    queryKey: ["/api/products", selectedProductId, "variants"],
    enabled: !!selectedProductId,
  });

  const { data: customers } = useQuery({
    queryKey: ["/api/customers", { search: customerSearch }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (customerSearch) params.set("search", customerSearch);
      const url = `/api/customers${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load customers");
      return response.json();
    },
  });

  const { data: contacts } = useQuery({
    queryKey: ["/api/customers", selectedCustomerId, "contacts"],
    queryFn: async () => {
      if (!selectedCustomerId) return [];
      const response = await fetch(`/api/customers/${selectedCustomerId}/contacts`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load contacts");
      return response.json();
    },
    enabled: !!selectedCustomerId,
  });

  // Auto-calculate price with debounce
  const triggerAutoCalculate = useCallback(async () => {
    // Check if all required fields are present and valid
    if (!selectedProductId || !width || !height || !quantity) {
      setCalculatedPrice(null);
      setCalcError(null);
      return;
    }

    const widthNum = parseFloat(width);
    const heightNum = parseFloat(height);
    const quantityNum = parseInt(quantity);

    if (isNaN(widthNum) || widthNum <= 0 || isNaN(heightNum) || heightNum <= 0 || isNaN(quantityNum) || quantityNum <= 0) {
      setCalculatedPrice(null);
      setCalcError(null);
      return;
    }

    setIsCalculating(true);
    setCalcError(null);

    try {
      const response = await apiRequest("POST", "/api/quotes/calculate", {
        productId: selectedProductId,
        variantId: selectedVariantId,
        width: widthNum,
        height: heightNum,
        quantity: quantityNum,
        selectedOptions: {},
      });
      const data = await response.json();
      setCalculatedPrice(data.price);
    } catch (error) {
      setCalcError(error instanceof Error ? error.message : "Calculation failed");
      setCalculatedPrice(null);
    } finally {
      setIsCalculating(false);
    }
  }, [selectedProductId, selectedVariantId, width, height, quantity]);

  // Debounced auto-calculation effect
  useEffect(() => {
    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new timer for 500ms debounce
    debounceTimerRef.current = setTimeout(() => {
      triggerAutoCalculate();
    }, 500);

    // Cleanup
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [triggerAutoCalculate]);

  const calculateMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/quotes/calculate", {
        productId: selectedProductId,
        variantId: selectedVariantId,
        width: parseFloat(width),
        height: parseFloat(height),
        quantity: parseInt(quantity),
        selectedOptions: {},
      });
      return await response.json();
    },
    onSuccess: (data: any) => {
      setCalculatedPrice(data.price);
    },
    onError: (error: Error) => {
      toast({
        title: "Calculation Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveQuoteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCustomerId) {
        throw new Error("Please select a customer");
      }
      if (lineItems.length === 0) {
        throw new Error("Please add at least one line item");
      }

      const quoteData = {
        customerId: selectedCustomerId,
        contactId: selectedContactId || undefined,
        customerName: customerName || undefined,
        source: 'internal',
        lineItems: lineItems.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          variantId: item.variantId || undefined,
          variantName: item.variantName || undefined,
          productType: item.productType,
          width: item.width,
          height: item.height,
          quantity: item.quantity,
          specsJson: item.specsJson,
          selectedOptions: item.selectedOptions,
          linePrice: item.linePrice,
          priceBreakdown: item.priceBreakdown,
          displayOrder: item.displayOrder,
        })),
      };

      if (isNewQuote) {
        const response = await apiRequest("POST", "/api/quotes", quoteData);
        return await response.json();
      } else {
        // For existing quotes, update header and handle line items separately
        const response = await apiRequest("PATCH", `/api/quotes/${quoteId}`, {
          customerName,
        });
        return await response.json();
      }
    },
    onSuccess: (data) => {
      toast({
        title: "Success",
        description: isNewQuote ? "Quote created successfully" : "Quote updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      navigate("/quotes");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAddLineItem = () => {
    if (!calculatedPrice || !selectedProductId) return;

    const product = products?.find(p => p.id === selectedProductId);
    const variant = productVariants?.find(v => v.id === selectedVariantId);

    const newItem: QuoteLineItemDraft = {
      tempId: `temp-${Date.now()}`,
      productId: selectedProductId,
      productName: product?.name || "",
      variantId: selectedVariantId,
      variantName: variant?.name || null,
      productType: 'wide_roll',
      width: parseFloat(width),
      height: parseFloat(height),
      quantity: parseInt(quantity),
      specsJson: {},
      selectedOptions: [],
      linePrice: calculatedPrice,
      priceBreakdown: { basePrice: calculatedPrice, optionsPrice: 0, total: calculatedPrice, formula: "" },
      displayOrder: lineItems.length,
    };

    setLineItems([...lineItems, newItem]);
    
    // Reset form
    setSelectedProductId("");
    setSelectedVariantId(null);
    setWidth("");
    setHeight("");
    setQuantity("1");
    setCalculatedPrice(null);
    setCalcError(null);
    setQuantity("1");
    setCalculatedPrice(null);

    toast({
      title: "Line Item Added",
      description: "Item added to quote",
    });
  };

  const handleRemoveLineItem = (tempId: string) => {
    setLineItems(lineItems.filter(item => item.tempId !== tempId && item.id !== tempId));
  };

  if (!isInternalUser) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="py-16 text-center">
            <p className="text-muted-foreground">Access denied. This page is for internal staff only.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (quoteLoading && !isNewQuote) {
    return (
      <div className="container mx-auto p-6 space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const total = lineItems.reduce((sum, item) => sum + item.linePrice, 0);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate("/quotes")}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Quotes
        </Button>
        <div className="flex gap-2">
          <Button
            onClick={() => saveQuoteMutation.mutate()}
            disabled={saveQuoteMutation.isPending || lineItems.length === 0 || !selectedCustomerId}
          >
            <Save className="w-4 h-4 mr-2" />
            {saveQuoteMutation.isPending ? "Saving..." : isNewQuote ? "Create Quote" : "Update Quote"}
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Left Column - Quote Header */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{isNewQuote ? "New Internal Quote" : "Edit Quote"}</CardTitle>
              <CardDescription>Enter customer information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="customerSearch">Customer *</Label>
                <Input
                  id="customerSearch"
                  placeholder="Search customers..."
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                />
                {customers && customers.length > 0 && (
                  <div className="border rounded-md max-h-48 overflow-y-auto">
                    {customers.map((customer: any) => (
                      <button
                        key={customer.id}
                        type="button"
                        className={`w-full text-left px-3 py-2 hover:bg-accent ${selectedCustomerId === customer.id ? 'bg-accent' : ''}`}
                        onClick={() => {
                          setSelectedCustomerId(customer.id);
                          setCustomerName(customer.companyName);
                          setCustomerSearch("");
                        }}
                      >
                        <div className="font-medium">{customer.companyName}</div>
                        <div className="text-sm text-muted-foreground">{customer.email}</div>
                      </button>
                    ))}
                  </div>
                )}
                {selectedCustomerId && (
                  <div className="text-sm text-muted-foreground">
                    Selected: {customerName}
                  </div>
                )}
              </div>

              {selectedCustomerId && contacts && contacts.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="contact">Contact (Optional)</Label>
                  <Select value={selectedContactId || ""} onValueChange={setSelectedContactId}>
                    <SelectTrigger id="contact">
                      <SelectValue placeholder="Select a contact" />
                    </SelectTrigger>
                    <SelectContent>
                      {contacts.map((contact: any) => (
                        <SelectItem key={contact.id} value={contact.id}>
                          {contact.name} - {contact.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Add Line Item Card */}
          <Card>
            <CardHeader>
              <CardTitle>Add Line Item</CardTitle>
              <CardDescription>Configure product and calculate price</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="product">Product</Label>
                <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                  <SelectTrigger id="product">
                    <SelectValue placeholder="Select a product" />
                  </SelectTrigger>
                  <SelectContent>
                    {products?.filter(p => p.isActive).map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {productVariants && productVariants.filter(v => v.isActive).length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="variant">Variant</Label>
                  <Select value={selectedVariantId || ""} onValueChange={setSelectedVariantId}>
                    <SelectTrigger id="variant">
                      <SelectValue placeholder="Select a variant" />
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

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="width">Width (in)</Label>
                  <Input
                    id="width"
                    type="number"
                    step="0.01"
                    value={width}
                    onChange={(e) => setWidth(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="height">Height (in)</Label>
                  <Input
                    id="height"
                    type="number"
                    step="0.01"
                    value={height}
                    onChange={(e) => setHeight(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="quantity">Quantity</Label>
                <Input
                  id="quantity"
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>

              {/* Live price display */}
              {isCalculating && (
                <div className="p-4 bg-muted rounded-md text-center">
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <p className="text-sm text-muted-foreground">Calculating price...</p>
                  </div>
                </div>
              )}

              {calcError && (
                <div className="p-4 bg-destructive/10 rounded-md text-center">
                  <p className="text-sm text-destructive">{calcError}</p>
                </div>
              )}

              {calculatedPrice !== null && !isCalculating && (
                <div className="p-4 bg-primary/10 rounded-md text-center">
                  <p className="text-sm text-muted-foreground">Price</p>
                  <p className="text-2xl font-bold font-mono">${calculatedPrice.toFixed(2)}</p>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  onClick={handleAddLineItem}
                  disabled={!calculatedPrice || isCalculating}
                  className="flex-1"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Item
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Line Items */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Quote Line Items</CardTitle>
              <CardDescription>{lineItems.length} item{lineItems.length !== 1 ? 's' : ''}</CardDescription>
            </CardHeader>
            <CardContent>
              {lineItems.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground">
                  No line items yet. Add items using the form on the left.
                </div>
              ) : (
                <div className="space-y-3">
                  {lineItems.map((item, idx) => (
                    <div key={item.tempId || item.id} className="flex items-start justify-between p-4 border rounded-lg">
                      <div className="flex-1">
                        <div className="font-medium">{item.productName}</div>
                        {item.variantName && (
                          <div className="text-sm text-muted-foreground">Variant: {item.variantName}</div>
                        )}
                        <div className="text-sm text-muted-foreground mt-1">
                          {item.width}" × {item.height}" • Qty: {item.quantity}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 ml-4">
                        <div className="text-right">
                          <div className="font-mono font-medium">${item.linePrice.toFixed(2)}</div>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleRemoveLineItem(item.tempId || item.id || '')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  <div className="mt-4 pt-4 border-t">
                    <div className="flex justify-between items-center">
                      <span className="font-medium">Quote Total:</span>
                      <span className="text-2xl font-bold font-mono">${total.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
