import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Save, Plus, Calculator, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { CustomerSelect, type CustomerWithContacts } from "@/components/CustomerSelect";
import type { Product, ProductVariant, QuoteWithRelations, ProductOptionItem } from "@shared/schema";
import { profileRequiresDimensions, getProfile } from "@shared/pricingProfiles";
import { Textarea } from "@/components/ui/textarea";

/**
 * Helper function to format option price label based on priceMode
 */
function formatOptionPriceLabel(option: ProductOptionItem): string {
  const amount = option.amount || 0;
  
  switch (option.priceMode) {
    case "percent_of_base":
      // Show as percentage
      return `+${amount}%`;
    case "flat_per_item":
      // Show as per-item price
      return `+$${amount.toFixed(2)} ea`;
    case "per_sqft":
      // Show as per-sqft price
      return `+$${amount.toFixed(2)}/sqft`;
    case "per_qty":
      // Show as per-quantity price
      return `+$${amount.toFixed(2)}/qty`;
    case "flat":
    default:
      // Show as flat amount
      return `+$${amount.toFixed(2)}`;
  }
}

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
  notes?: string;
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

  // Customer selection
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerWithContacts | undefined>(undefined);

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

  // Option selection state
  const [optionSelections, setOptionSelections] = useState<Record<string, {
    value: string | number | boolean;
    grommetsLocation?: string;
    grommetsSpacingCount?: number;
    grommetsPerSign?: number;
    customPlacementNote?: string;
  }>>({});

  // Line item notes
  const [lineItemNotes, setLineItemNotes] = useState<string>("");

  // Helper to build selectedOptions payload from optionSelections state
  const buildSelectedOptionsPayload = useCallback(() => {
    const payload: Record<string, any> = {};
    Object.entries(optionSelections).forEach(([optionId, selection]) => {
      payload[optionId] = {
        value: selection.value,
        grommetsLocation: selection.grommetsLocation,
        grommetsSpacingCount: selection.grommetsSpacingCount,
        grommetsPerSign: selection.grommetsPerSign,
        customPlacementNote: selection.customPlacementNote,
      };
    });
    return payload;
  }, [optionSelections]);

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
        notes: (item.specsJson as any)?.notes || undefined,
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

  // Get selected product and determine if dimensions are required
  const selectedProduct = useMemo(() => {
    return products?.find(p => p.id === selectedProductId);
  }, [products, selectedProductId]);
  
  const requiresDimensions = useMemo(() => {
    if (!selectedProduct) return true; // Default to requiring dimensions
    // Check both new pricingProfileKey and legacy useNestingCalculator
    const profile = getProfile(selectedProduct.pricingProfileKey);
    // Legacy nesting calculator products require dimensions
    if (selectedProduct.useNestingCalculator) return true;
    return profile.requiresDimensions;
  }, [selectedProduct]);

  // Get contacts from selected customer
  const contacts = selectedCustomer?.contacts || [];

  // Fetch customer details with contacts when editing
  const { data: customerData } = useQuery<CustomerWithContacts>({
    queryKey: ["/api/customers", selectedCustomerId],
    queryFn: async () => {
      if (!selectedCustomerId) throw new Error("No customer ID");
      const response = await fetch(`/api/customers/${selectedCustomerId}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch customer");
      return response.json();
    },
    enabled: !!selectedCustomerId && !selectedCustomer,
  });

  // Update selectedCustomer when customerData is fetched
  useEffect(() => {
    if (customerData && !selectedCustomer) {
      setSelectedCustomer(customerData);
    }
  }, [customerData, selectedCustomer]);

  // Auto-calculate price with debounce
  const triggerAutoCalculate = useCallback(async () => {
    // Check if all required fields are present and valid
    // For products that don't require dimensions, only check quantity
    if (!selectedProductId || !quantity) {
      setCalculatedPrice(null);
      setCalcError(null);
      return;
    }
    
    // For dimension-requiring products, also need width/height
    if (requiresDimensions && (!width || !height)) {
      setCalculatedPrice(null);
      setCalcError(null);
      return;
    }

    const widthNum = requiresDimensions ? parseFloat(width) : 1;
    const heightNum = requiresDimensions ? parseFloat(height) : 1;
    const quantityNum = parseInt(quantity);

    if (requiresDimensions && (isNaN(widthNum) || widthNum <= 0 || isNaN(heightNum) || heightNum <= 0)) {
      setCalculatedPrice(null);
      setCalcError(null);
      return;
    }
    
    if (isNaN(quantityNum) || quantityNum <= 0) {
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
        selectedOptions: buildSelectedOptionsPayload(),
      });
      const data = await response.json();
      setCalculatedPrice(data.price);
    } catch (error) {
      setCalcError(error instanceof Error ? error.message : "Calculation failed");
      setCalculatedPrice(null);
    } finally {
      setIsCalculating(false);
    }
  }, [selectedProductId, selectedVariantId, width, height, quantity, requiresDimensions, buildSelectedOptionsPayload]);

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
        width: requiresDimensions ? parseFloat(width) : 1,
        height: requiresDimensions ? parseFloat(height) : 1,
        quantity: parseInt(quantity),
        selectedOptions: buildSelectedOptionsPayload(),
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
        customerName: selectedCustomer?.companyName || undefined,
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
          notes: item.notes || undefined,
        })),
      };

      if (isNewQuote) {
        const response = await apiRequest("POST", "/api/quotes", quoteData);
        return await response.json();
      } else {
        // For existing quotes, update header and handle line items separately
        const response = await apiRequest("PATCH", `/api/quotes/${quoteId}`, {
          customerName: selectedCustomer?.companyName,
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
    
    // For non-dimension products, use 1x1 as placeholder
    const widthVal = requiresDimensions ? parseFloat(width) : 1;
    const heightVal = requiresDimensions ? parseFloat(height) : 1;
    const quantityVal = parseInt(quantity);

    // Build selectedOptions array from optionSelections state
    const selectedOptionsArray: Array<{
      optionId: string;
      optionName: string;
      value: string | number | boolean;
      setupCost: number;
      calculatedCost: number;
    }> = [];

    const productOptions = (product?.optionsJson as ProductOptionItem[]) || [];
    
    productOptions.forEach(option => {
      const selection = optionSelections[option.id];
      if (!selection) return; // Option not selected

      const optionAmount = option.amount || 0;
      let setupCost = 0;
      let calculatedCost = 0;

      // Calculate costs based on priceMode
      if (option.priceMode === "flat") {
        setupCost = optionAmount;
        calculatedCost = optionAmount;
      } else if (option.priceMode === "per_qty") {
        calculatedCost = optionAmount * quantityVal;
      } else if (option.priceMode === "per_sqft") {
        const sqft = widthVal * heightVal;
        calculatedCost = optionAmount * sqft * quantityVal;
      }

      // Handle grommets special pricing
      if (option.config?.kind === "grommets" && selection.grommetsLocation) {
        if (selection.grommetsLocation === "top_even" && selection.grommetsSpacingCount) {
          // Multiply by spacing count for top_even
          calculatedCost *= selection.grommetsSpacingCount;
        }
      }

      // Handle sides multiplier (applied later in pricing engine)
      // For now just record the selection
      selectedOptionsArray.push({
        optionId: option.id,
        optionName: option.label,
        value: selection.value,
        setupCost,
        calculatedCost,
      });
    });

    const newItem: QuoteLineItemDraft = {
      tempId: `temp-${Date.now()}`,
      productId: selectedProductId,
      productName: product?.name || "",
      variantId: selectedVariantId,
      variantName: variant?.name || null,
      productType: 'wide_roll',
      width: widthVal,
      height: heightVal,
      quantity: quantityVal,
      specsJson: lineItemNotes ? { notes: lineItemNotes } : {},
      selectedOptions: selectedOptionsArray,
      linePrice: calculatedPrice,
      priceBreakdown: { basePrice: calculatedPrice, optionsPrice: 0, total: calculatedPrice, formula: "" },
      displayOrder: lineItems.length,
      notes: lineItemNotes || undefined,
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
    setOptionSelections({});
    setLineItemNotes("");

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
              <CustomerSelect
                value={selectedCustomerId}
                onChange={(customerId, customer, contactId) => {
                  setSelectedCustomerId(customerId);
                  setSelectedCustomer(customer);
                  setSelectedContactId(contactId || null);
                }}
                autoFocus={isNewQuote}
                label="Customer *"
                placeholder="Search customers by name, email, or contact..."
              />

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
                          {contact.firstName} {contact.lastName}
                          {contact.email && ` - ${contact.email}`}
                          {contact.isPrimary && " (Primary)"}
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

              {/* Dimensions - only show for products that require them */}
              {requiresDimensions && (
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
              )}
              
              {/* Info badge for non-dimension products */}
              {selectedProductId && !requiresDimensions && (
                <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                  <p>This product doesn't require dimensions. Only quantity is needed.</p>
                </div>
              )}

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

              {/* Product Options Selection */}
              {selectedProduct && (selectedProduct.optionsJson as ProductOptionItem[])?.length > 0 && (
                <div className="space-y-3 border-t pt-4">
                  <Label className="text-base font-semibold">Product Options</Label>
                  {((selectedProduct.optionsJson as ProductOptionItem[]) || []).map((option) => {
                    const selection = optionSelections[option.id];
                    const isSelected = !!selection;

                    return (
                      <div key={option.id} className="space-y-2 p-3 border rounded-md">
                        {/* Checkbox type */}
                        {option.type === "checkbox" && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={isSelected}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setOptionSelections(prev => ({
                                      ...prev,
                                      [option.id]: { value: true }
                                    }));
                                  } else {
                                    const { [option.id]: _, ...rest } = optionSelections;
                                    setOptionSelections(rest);
                                  }
                                }}
                              />
                              <Label className="cursor-pointer">{option.label}</Label>
                            </div>
                            {option.amount !== undefined && option.amount !== null && (
                              <Badge variant="secondary">
                                {formatOptionPriceLabel(option)}
                              </Badge>
                            )}
                          </div>
                        )}

                        {/* Quantity type */}
                        {option.type === "quantity" && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label>{option.label}</Label>
                              {option.amount !== undefined && option.amount !== null && (
                                <Badge variant="secondary">
                                  {formatOptionPriceLabel(option)}
                                </Badge>
                              )}
                            </div>
                            <Input
                              type="number"
                              min="0"
                              value={typeof selection?.value === "number" ? selection.value : 0}
                              onChange={(e) => {
                                const val = parseInt(e.target.value) || 0;
                                if (val > 0) {
                                  setOptionSelections(prev => ({
                                    ...prev,
                                    [option.id]: { value: val }
                                  }));
                                } else {
                                  const { [option.id]: _, ...rest } = optionSelections;
                                  setOptionSelections(rest);
                                }
                              }}
                            />
                          </div>
                        )}

                        {/* Toggle type (for sides: single/double) */}
                        {option.type === "toggle" && option.config?.kind === "sides" && (
                          <div className="space-y-2">
                            <Label>{option.label}</Label>
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                variant={selection?.value === "single" ? "default" : "outline"}
                                className="flex-1"
                                onClick={() => {
                                  setOptionSelections(prev => ({
                                    ...prev,
                                    [option.id]: { value: "single" }
                                  }));
                                }}
                              >
                                {option.config.singleLabel || "Single"}
                              </Button>
                              <Button
                                type="button"
                                variant={selection?.value === "double" ? "default" : "outline"}
                                className="flex-1"
                                onClick={() => {
                                  setOptionSelections(prev => ({
                                    ...prev,
                                    [option.id]: { value: "double" }
                                  }));
                                }}
                              >
                                {option.config.doubleLabel || "Double"}
                                {option.config.pricingMode !== "volume" && option.config.doublePriceMultiplier && (
                                  <span className="ml-1 text-xs">
                                    ({option.config.doublePriceMultiplier}x)
                                  </span>
                                )}
                                {option.config.pricingMode === "volume" && (
                                  <span className="ml-1 text-xs text-muted-foreground">
                                    (Volume)
                                  </span>
                                )}
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* Grommets with location selector */}
                        {option.config?.kind === "grommets" && isSelected && (
                          <div className="space-y-3 mt-2 pl-6 border-l-2 border-orange-500">
                            {/* Grommets per sign input */}
                            <div className="space-y-1">
                              <Label className="text-sm">Grommets per sign</Label>
                              <Input
                                type="number"
                                min="0"
                                value={selection?.grommetsPerSign ?? 4}
                                onChange={(e) => {
                                  const count = parseInt(e.target.value) || 0;
                                  setOptionSelections(prev => ({
                                    ...prev,
                                    [option.id]: {
                                      ...prev[option.id],
                                      grommetsPerSign: count
                                    }
                                  }));
                                }}
                                className="w-24"
                              />
                              <p className="text-xs text-muted-foreground">
                                Total: {(selection?.grommetsPerSign ?? 4) * parseInt(quantity || "1")} grommets × ${(option.amount || 0).toFixed(2)} = ${((selection?.grommetsPerSign ?? 4) * parseInt(quantity || "1") * (option.amount || 0)).toFixed(2)}
                              </p>
                            </div>

                            <Label className="text-sm">Grommet Location</Label>
                            <Select
                              value={selection?.grommetsLocation || option.config.defaultLocation || "all_corners"}
                              onValueChange={(val) => {
                                // Auto-set grommetsPerSign based on location if not already set
                                let defaultCount = selection?.grommetsPerSign;
                                if (!defaultCount) {
                                  if (val === "all_corners") defaultCount = 4;
                                  else if (val === "top_corners") defaultCount = 2;
                                  else defaultCount = 4;
                                }
                                setOptionSelections(prev => ({
                                  ...prev,
                                  [option.id]: { 
                                    ...prev[option.id],
                                    grommetsLocation: val,
                                    grommetsPerSign: defaultCount
                                  }
                                }));
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all_corners">All Corners</SelectItem>
                                <SelectItem value="top_corners">Top Corners Only</SelectItem>
                                <SelectItem value="top_even">Top Edge (Even Spacing)</SelectItem>
                                <SelectItem value="custom">Custom Placement</SelectItem>
                              </SelectContent>
                            </Select>

                            {selection?.grommetsLocation === "top_even" && (
                              <div className="space-y-1">
                                <Label className="text-xs">Spacing Count</Label>
                                <Input
                                  type="number"
                                  min="1"
                                  value={selection?.grommetsSpacingCount || option.config.defaultSpacingCount || 1}
                                  onChange={(e) => {
                                    const count = parseInt(e.target.value) || 1;
                                    setOptionSelections(prev => ({
                                      ...prev,
                                      [option.id]: {
                                        ...prev[option.id],
                                        grommetsSpacingCount: count,
                                        grommetsPerSign: count // Update grommetsPerSign to match
                                      }
                                    }));
                                  }}
                                />
                              </div>
                            )}

                            {selection?.grommetsLocation === "custom" && (
                              <div className="space-y-1">
                                <Label className="text-xs">Custom Placement Notes</Label>
                                <Textarea
                                  placeholder="Enter custom grommet placement instructions..."
                                  value={selection?.customPlacementNote || ""}
                                  onChange={(e) => {
                                    setOptionSelections(prev => ({
                                      ...prev,
                                      [option.id]: {
                                        ...prev[option.id],
                                        customPlacementNote: e.target.value
                                      }
                                    }));
                                  }}
                                  rows={2}
                                  className="text-sm"
                                />
                                {option.config.customNotes && (
                                  <p className="text-xs text-muted-foreground italic">
                                    Default: {option.config.customNotes}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Line Item Notes */}
              <div className="space-y-2 border-t pt-4">
                <Label className="text-base font-semibold">Line Item Notes</Label>
                <Textarea
                  placeholder="Optional notes for production (e.g., special instructions, custom placement details)..."
                  value={lineItemNotes}
                  onChange={(e) => setLineItemNotes(e.target.value)}
                  rows={3}
                  className="text-sm"
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
                        
                        {/* Display selected options */}
                        {item.selectedOptions && item.selectedOptions.length > 0 && (
                          <div className="mt-2 space-y-1">
                            <div className="text-xs font-semibold text-muted-foreground">Options:</div>
                            <div className="flex flex-wrap gap-1.5">
                              {item.selectedOptions.map((opt: any, optIdx: number) => (
                                <Badge key={optIdx} variant="outline" className="text-xs">
                                  {opt.optionName}
                                  {typeof opt.value === "boolean" 
                                    ? "" 
                                    : `: ${opt.value}`
                                  }
                                  {opt.calculatedCost > 0 && (
                                    <span className="ml-1 text-muted-foreground">
                                      (+${opt.calculatedCost.toFixed(2)})
                                    </span>
                                  )}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        {/* Display notes */}
                        {item.notes && (
                          <div className="mt-2 text-sm italic text-muted-foreground">
                            Note: {item.notes}
                          </div>
                        )}
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
