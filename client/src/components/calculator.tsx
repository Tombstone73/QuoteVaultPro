import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Calculator as CalcIcon, ExternalLink, Save, Plus, X, Trash2, Grid3x3, List } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import type { Product, InsertQuote, ProductVariant, InsertQuoteLineItem, ProductOptionItem } from "@shared/schema";

/**
 * Helper function to format option price label based on priceMode
 */
function formatOptionPriceLabel(option: ProductOptionItem): string {
  const amount = option.amount || 0;
  
  switch (option.priceMode) {
    case "percent_of_base":
      return `+${amount}%`;
    case "flat_per_item":
      return `+$${amount.toFixed(2)} ea`;
    case "per_sqft":
      return `+$${amount.toFixed(2)}/sqft`;
    case "per_qty":
      return `+$${amount.toFixed(2)}/qty`;
    case "flat":
    default:
      return `+$${amount.toFixed(2)}`;
  }
}

// Line item draft type (before saving to server)
type LineItemDraft = {
  tempId: string;
  productId: string;
  productName: string;
  variantId: string | null;
  variantName: string | null;
  width: number;
  height: number;
  quantity: number;
  selectedOptions: any[];
  linePrice: number;
  priceBreakdown: any;
};

export default function CalculatorComponent() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [width, setWidth] = useState<string>("");
  const [height, setHeight] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("1");
  const [customerName, setCustomerName] = useState<string>("");
  // Enhanced option selections state (matches quote-editor structure)
  const [optionSelections, setOptionSelections] = useState<Record<string, {
    value: string | number | boolean;
    grommetsLocation?: string;
    grommetsSpacingCount?: number;
    grommetsSpacingInches?: number;
    grommetsPerSign?: number;
    customPlacementNote?: string;
    hemsType?: string;
    polePocket?: string;
  }>>({});
  const [calculatedPrice, setCalculatedPrice] = useState<number | null>(null);
  const [priceBreakdown, setPriceBreakdown] = useState<any>(null);
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([]);
  const [productViewMode, setProductViewMode] = useState<"dropdown" | "gallery">("dropdown");
  const [fieldErrors, setFieldErrors] = useState<{
    product?: boolean;
    width?: boolean;
    height?: boolean;
    quantity?: boolean;
  }>({});

  const { data: products, isLoading: productsLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const { data: productVariants } = useQuery<ProductVariant[]>({
    queryKey: ["/api/products", selectedProductId, "variants"],
    enabled: !!selectedProductId,
  });

  const selectedProduct = products?.find(p => p.id === selectedProductId);

  // Get inline options from product
  const productOptionsInline = selectedProduct?.optionsJson as ProductOptionItem[] | undefined;

  // Reset option selections and variant when product changes
  useEffect(() => {
    setOptionSelections({});
    setSelectedVariant(null);
  }, [selectedProductId]);

  // Auto-select default variant when variants load
  useEffect(() => {
    if (productVariants && productVariants.length > 0 && !selectedVariant) {
      const defaultVariant = productVariants.find(v => v.isDefault && v.isActive);
      if (defaultVariant) {
        setSelectedVariant(defaultVariant.id);
      }
    }
  }, [productVariants, selectedVariant]);

  // Set default values when product options load (inline optionsJson)
  useEffect(() => {
    if (productOptionsInline && productOptionsInline.length > 0) {
      const defaults: Record<string, { value: string | number | boolean; grommetsLocation?: string; grommetsSpacingCount?: number; grommetsPerSign?: number; }> = {};

      // Sort by sortOrder before processing defaults
      const sortedOptions = [...productOptionsInline].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

      sortedOptions.forEach(option => {
        if (option.defaultSelected) {
          if (option.type === "checkbox") {
            defaults[option.id] = { value: true };
          } else if (option.type === "toggle" && option.config?.kind === "sides") {
            defaults[option.id] = { value: option.config.defaultSide || "single" };
          } else if (option.type === "toggle") {
            defaults[option.id] = { value: true };
          } else if (option.type === "select") {
            if (option.config?.kind === "thickness") {
              defaults[option.id] = { value: option.config.defaultThicknessKey || "" };
            }
          }
        }
      });

      setOptionSelections(defaults);
    }
  }, [productOptionsInline]);

  // Helper to build selectedOptions payload from optionSelections state (for API calls)
  const buildSelectedOptionsPayload = () => {
    const payload: Record<string, any> = {};
    Object.entries(optionSelections).forEach(([optionId, selection]) => {
      payload[optionId] = {
        value: selection.value,
        grommetsLocation: selection.grommetsLocation,
        grommetsSpacingCount: selection.grommetsSpacingCount,
        grommetsSpacingInches: selection.grommetsSpacingInches,
        grommetsPerSign: selection.grommetsPerSign,
        customPlacementNote: selection.customPlacementNote,
        hemsType: selection.hemsType,
        polePocket: selection.polePocket,
      };
    });
    return payload;
  };

  // Auto-calculate price when inputs change
  useEffect(() => {
    // Only auto-calculate if all required fields are filled
    if (!selectedProductId || !width || !height || !quantity) {
      return;
    }

    const widthNum = parseFloat(width);
    const heightNum = parseFloat(height);
    const quantityNum = parseInt(quantity);

    // Only calculate if all values are valid positive numbers
    if (!Number.isFinite(widthNum) || widthNum <= 0 ||
        !Number.isFinite(heightNum) || heightNum <= 0 ||
        !Number.isFinite(quantityNum) || quantityNum <= 0) {
      return;
    }

    // Clear any field errors since we have valid inputs
    setFieldErrors({});

    // Trigger the calculation
    calculateMutation.mutate();
  }, [selectedProductId, selectedVariant, width, height, quantity, optionSelections]);

  const calculateMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/quotes/calculate", {
        productId: selectedProductId,
        variantId: selectedVariant,
        width: parseFloat(width),
        height: parseFloat(height),
        quantity: parseInt(quantity),
        selectedOptions: buildSelectedOptionsPayload(),
      });
      return await response.json();
    },
    onSuccess: (data: any) => {
      setCalculatedPrice(data.price);
      setPriceBreakdown(data.breakdown);
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
      if (lineItems.length === 0) {
        throw new Error("Please add at least one item to the quote");
      }
      
      const quoteData = {
        customerName: customerName || undefined,
        source: 'customer_quick_quote', // Mark as customer-originated
        lineItems: lineItems.map((item, idx) => ({
          productId: item.productId,
          productName: item.productName,
          variantId: item.variantId || undefined,
          variantName: item.variantName || undefined,
          productType: 'wide_roll', // Default, adjust based on product if needed
          width: item.width,
          height: item.height,
          quantity: item.quantity,
          specsJson: {}, // Could store additional config if needed
          selectedOptions: item.selectedOptions,
          linePrice: item.linePrice,
          priceBreakdown: item.priceBreakdown,
          displayOrder: idx,
        })),
      };

      const response = await apiRequest("POST", "/api/quotes", quoteData);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      
      toast({
        title: "Quote Saved!",
        description: "Your quote has been saved successfully.",
      });
      
      // Navigate to my quotes after a brief delay
      setTimeout(() => {
        navigate("/my-quotes");
      }, 1000);
      
      // Clear everything after successful save
      setLineItems([]);
      setCustomerName("");
      setSelectedProductId("");
      setSelectedVariant(null);
      setWidth("");
      setHeight("");
      setQuantity("1");
      setOptionSelections({});
      setCalculatedPrice(null);
      setPriceBreakdown(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCalculate = () => {
    const errors: typeof fieldErrors = {};
    let hasErrors = false;

    if (!selectedProductId) {
      errors.product = true;
      hasErrors = true;
    }
    if (width.trim() === "") {
      errors.width = true;
      hasErrors = true;
    }
    if (height.trim() === "") {
      errors.height = true;
      hasErrors = true;
    }
    if (quantity.trim() === "") {
      errors.quantity = true;
      hasErrors = true;
    }

    if (hasErrors) {
      setFieldErrors(errors);
      toast({
        title: "Missing Information",
        description: "Please fill in all required fields (highlighted in red).",
        variant: "destructive",
      });
      return;
    }

    const widthNum = parseFloat(width);
    const heightNum = parseFloat(height);
    const quantityNum = parseInt(quantity);
    if (!Number.isFinite(widthNum) || widthNum <= 0 || !Number.isFinite(heightNum) || heightNum <= 0 || !Number.isFinite(quantityNum) || quantityNum <= 0) {
      const invalidErrors: typeof fieldErrors = {};
      if (!Number.isFinite(widthNum) || widthNum <= 0) invalidErrors.width = true;
      if (!Number.isFinite(heightNum) || heightNum <= 0) invalidErrors.height = true;
      if (!Number.isFinite(quantityNum) || quantityNum <= 0) invalidErrors.quantity = true;
      
      setFieldErrors(invalidErrors);
      toast({
        title: "Invalid Values",
        description: "Please enter valid positive numbers for all fields (highlighted in red).",
        variant: "destructive",
      });
      return;
    }
    
    setFieldErrors({});
    calculateMutation.mutate();
  };

  const handleAddToQuote = () => {
    if (!calculatedPrice || !priceBreakdown || !selectedProduct) {
      toast({
        title: "Calculate First",
        description: "Please calculate the price before adding to quote.",
        variant: "destructive",
      });
      return;
    }

    const variant = productVariants?.find(v => v.id === selectedVariant);
    
    const newLineItem: LineItemDraft = {
      tempId: `temp-${Date.now()}-${Math.random()}`,
      productId: selectedProductId,
      productName: selectedProduct.name,
      variantId: selectedVariant,
      variantName: variant?.name || null,
      width: parseFloat(width),
      height: parseFloat(height),
      quantity: parseInt(quantity),
      selectedOptions: priceBreakdown.selectedOptions || [],
      linePrice: calculatedPrice,
      priceBreakdown,
    };

    setLineItems(prev => [...prev, newLineItem]);
    
    // Reset configuration for next item
    setSelectedProductId("");
    setSelectedVariant(null);
    setWidth("");
    setHeight("");
    setQuantity("1");
    setOptionSelections({});
    setCalculatedPrice(null);
    setPriceBreakdown(null);
    
    toast({
      title: "Added to Quote",
      description: "Item added successfully. Add more items or save the quote.",
    });
  };

  const handleRemoveLineItem = (tempId: string) => {
    setLineItems(prev => prev.filter(item => item.tempId !== tempId));
    toast({
      title: "Item Removed",
      description: "Line item removed from quote.",
    });
  };

  const handleClearQuote = () => {
    setLineItems([]);
    setCustomerName("");
    toast({
      title: "Quote Cleared",
      description: "All line items have been removed.",
    });
  };

  if (productsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-6">
        <Card data-testid="card-product-selection">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalcIcon className="w-5 h-5" />
              Product Selection
            </CardTitle>
            <CardDescription>Choose a product and enter specifications</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <Label htmlFor={productViewMode === "dropdown" ? "product" : undefined} data-testid="label-product">
                Product Type
              </Label>
              <div className="flex items-center gap-2">
                <Button
                  variant={productViewMode === "dropdown" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setProductViewMode("dropdown")}
                  data-testid="button-view-dropdown"
                >
                  <List className="w-4 h-4 mr-2" />
                  List
                </Button>
                <Button
                  variant={productViewMode === "gallery" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setProductViewMode("gallery")}
                  data-testid="button-view-gallery"
                >
                  <Grid3x3 className="w-4 h-4 mr-2" />
                  Gallery
                </Button>
              </div>
            </div>

            {productViewMode === "dropdown" ? (
              <div className="space-y-2">
                <Select 
                  value={selectedProductId} 
                  onValueChange={(value) => {
                    setSelectedProductId(value);
                    setFieldErrors(prev => ({ ...prev, product: false }));
                  }}
                >
                  <SelectTrigger 
                    id="product" 
                    data-testid="select-product"
                    className={fieldErrors.product ? "border-red-500 focus:border-red-500" : ""}
                  >
                    <SelectValue placeholder="Select a product" />
                  </SelectTrigger>
                  <SelectContent>
                    {products?.filter(p => p.isActive).map((product) => (
                      <SelectItem key={product.id} value={product.id} data-testid={`option-product-${product.id}`}>
                        {product.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldErrors.product && (
                  <p className="text-sm text-red-500">Please select a product</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div
                  role="listbox"
                  aria-label="Product gallery"
                  className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[500px] overflow-y-auto pr-2"
                  data-testid="product-gallery"
                >
                  {products?.filter(p => p.isActive).map((product) => {
                    const isSelected = selectedProductId === product.id;
                    const thumbnailUrl = product.thumbnailUrls?.[0];
                    
                    return (
                      <button
                        key={product.id}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        className={`text-left rounded-md border bg-card transition-all hover-elevate active-elevate-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          isSelected 
                            ? "ring-2 ring-primary" 
                            : fieldErrors.product 
                            ? "ring-2 ring-red-500" 
                            : ""
                        }`}
                        onClick={() => {
                          setSelectedProductId(product.id);
                          setFieldErrors(prev => ({ ...prev, product: false }));
                        }}
                        data-testid={`product-card-${product.id}`}
                      >
                        <div className="overflow-hidden rounded-t-md">
                          <div className="aspect-square relative bg-muted">
                            {thumbnailUrl ? (
                              <img
                                src={thumbnailUrl}
                                alt={product.name}
                                className="w-full h-full object-cover"
                                data-testid={`product-image-${product.id}`}
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                                <CalcIcon className="w-12 h-12" />
                              </div>
                            )}
                            {isSelected && (
                              <Badge className="absolute top-2 right-2 pointer-events-none" data-testid={`badge-selected-${product.id}`}>
                                Selected
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="p-3">
                          <div className="font-medium text-sm line-clamp-2" title={product.name}>
                            {product.name}
                          </div>
                          {product.category && (
                            <div className="text-xs text-muted-foreground mt-1">
                              {product.category}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {fieldErrors.product && (
                  <p className="text-sm text-red-500">Please select a product</p>
                )}
              </div>
            )}

            {productVariants && productVariants.filter(v => v.isActive).length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="variant" data-testid="label-variant">
                  Select {selectedProduct?.variantLabel ?? "Variant"}
                </Label>
                <Select value={selectedVariant || ""} onValueChange={(value) => setSelectedVariant(value || null)}>
                  <SelectTrigger id="variant" data-testid="select-variant">
                    <SelectValue placeholder={`Select a ${(selectedProduct?.variantLabel ?? "variant").toLowerCase()}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {productVariants
                      .filter(v => v.isActive)
                      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
                      .map((variant) => (
                        <SelectItem key={variant.id} value={variant.id} data-testid={`option-variant-${variant.id}`}>
                          {variant.name} (${parseFloat(variant.basePricePerSqft).toFixed(2)}/sqft)
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {selectedProduct && (
              <div className="p-4 bg-muted rounded-md space-y-2" data-testid="product-description">
                <p className="text-sm text-muted-foreground">{selectedProduct.description}</p>
                {selectedProduct.storeUrl && selectedProduct.showStoreLink && (
                  <Button variant="outline" size="sm" asChild data-testid="button-view-store">
                    <a href={selectedProduct.storeUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-4 h-4 mr-2" />
                      View in Store
                    </a>
                  </Button>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="width" data-testid="label-width">Width (inches)</Label>
                <Input
                  id="width"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={width}
                  onChange={(e) => {
                    setWidth(e.target.value);
                    setFieldErrors(prev => ({ ...prev, width: false }));
                  }}
                  data-testid="input-width"
                  className={fieldErrors.width ? "border-red-500 focus-visible:ring-red-500" : ""}
                />
                {fieldErrors.width && (
                  <p className="text-sm text-red-500">Please enter a valid width</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="height" data-testid="label-height">Height (inches)</Label>
                <Input
                  id="height"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={height}
                  onChange={(e) => {
                    setHeight(e.target.value);
                    setFieldErrors(prev => ({ ...prev, height: false }));
                  }}
                  data-testid="input-height"
                  className={fieldErrors.height ? "border-red-500 focus-visible:ring-red-500" : ""}
                />
                {fieldErrors.height && (
                  <p className="text-sm text-red-500">Please enter a valid height</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="quantity" data-testid="label-quantity">Quantity</Label>
              <Input
                id="quantity"
                type="number"
                min="1"
                placeholder="1"
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value);
                  setFieldErrors(prev => ({ ...prev, quantity: false }));
                }}
                data-testid="input-quantity"
                className={fieldErrors.quantity ? "border-red-500 focus-visible:ring-red-500" : ""}
              />
              {fieldErrors.quantity && (
                <p className="text-sm text-red-500">Please enter a valid quantity</p>
              )}
            </div>

            {/* Product Options Selection - Inline options from product.optionsJson */}
            {selectedProduct && productOptionsInline && productOptionsInline.length > 0 && (
              <div className="space-y-3 border-t pt-4">
                <Label className="text-base font-semibold" data-testid="label-options">Product Options</Label>
                {[...productOptionsInline]
                  .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
                  .map((option) => {
                    const selection = optionSelections[option.id];
                    const isSelected = !!selection;

                    return (
                      <div key={option.id} className="space-y-2 p-3 border rounded-md" data-testid={`option-container-${option.id}`}>
                        {/* Checkbox type */}
                        {option.type === "checkbox" && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Switch
                                id={`option-${option.id}`}
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
                                data-testid={`switch-option-${option.id}`}
                              />
                              <Label htmlFor={`option-${option.id}`} className="cursor-pointer">{option.label}</Label>
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
                              <Label htmlFor={`option-${option.id}`}>{option.label}</Label>
                              {option.amount !== undefined && option.amount !== null && (
                                <Badge variant="secondary">
                                  {formatOptionPriceLabel(option)}
                                </Badge>
                              )}
                            </div>
                            <Input
                              id={`option-${option.id}`}
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
                              data-testid={`input-option-${option.id}`}
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
                                data-testid={`button-option-${option.id}-single`}
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
                                data-testid={`button-option-${option.id}-double`}
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

                        {/* Generic toggle (not sides) */}
                        {option.type === "toggle" && option.config?.kind !== "sides" && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Switch
                                id={`option-${option.id}`}
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
                                data-testid={`switch-option-${option.id}`}
                              />
                              <Label htmlFor={`option-${option.id}`} className="cursor-pointer">{option.label}</Label>
                            </div>
                            {option.amount !== undefined && option.amount !== null && (
                              <Badge variant="secondary">
                                {formatOptionPriceLabel(option)}
                              </Badge>
                            )}
                          </div>
                        )}

                        {/* Grommets with location selector */}
                        {option.config?.kind === "grommets" && isSelected && (
                          <div className="space-y-3 mt-2 pl-6 border-l-2 border-orange-500">
                            {/* Spacing options selector (12", 24", etc.) */}
                            {option.config.spacingOptions && option.config.spacingOptions.length > 0 && (
                              <div className="space-y-1">
                                <Label className="text-sm">Grommet Spacing</Label>
                                <Select
                                  value={String(selection?.grommetsSpacingInches || option.config.defaultSpacingInches || option.config.spacingOptions[0])}
                                  onValueChange={(val) => {
                                    setOptionSelections(prev => ({
                                      ...prev,
                                      [option.id]: {
                                        ...prev[option.id],
                                        grommetsSpacingInches: parseInt(val)
                                      }
                                    }));
                                  }}
                                >
                                  <SelectTrigger data-testid={`select-grommets-spacing-inches-${option.id}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {option.config.spacingOptions.map((sp: number) => (
                                      <SelectItem key={sp} value={String(sp)}>{sp}" spacing</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}

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
                                data-testid={`input-grommets-per-sign-${option.id}`}
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
                              <SelectTrigger data-testid={`select-grommets-location-${option.id}`}>
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
                                        grommetsPerSign: count
                                      }
                                    }));
                                  }}
                                  data-testid={`input-grommets-spacing-${option.id}`}
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
                                  data-testid={`textarea-grommets-custom-${option.id}`}
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

                        {/* Hems option with dropdown */}
                        {option.config?.kind === "hems" && isSelected && (
                          <div className="space-y-2 mt-2 pl-6 border-l-2 border-blue-500">
                            <Label className="text-sm">Hem Style</Label>
                            <Select
                              value={selection?.hemsType || option.config.defaultHems || "none"}
                              onValueChange={(val) => {
                                setOptionSelections(prev => ({
                                  ...prev,
                                  [option.id]: {
                                    ...prev[option.id],
                                    hemsType: val
                                  }
                                }));
                              }}
                            >
                              <SelectTrigger data-testid={`select-hems-${option.id}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(option.config.hemsChoices || ["none", "all_sides", "top_bottom", "left_right"]).map((choice: string) => (
                                  <SelectItem key={choice} value={choice}>
                                    {choice === "none" ? "None" :
                                     choice === "all_sides" ? "All Sides" :
                                     choice === "top_bottom" ? "Top & Bottom" :
                                     choice === "left_right" ? "Left & Right" : choice}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {/* Pole Pockets option with dropdown */}
                        {option.config?.kind === "pole_pockets" && isSelected && (
                          <div className="space-y-2 mt-2 pl-6 border-l-2 border-green-500">
                            <Label className="text-sm">Pole Pocket Location</Label>
                            <Select
                              value={selection?.polePocket || option.config.defaultPolePocket || "none"}
                              onValueChange={(val) => {
                                setOptionSelections(prev => ({
                                  ...prev,
                                  [option.id]: {
                                    ...prev[option.id],
                                    polePocket: val
                                  }
                                }));
                              }}
                            >
                              <SelectTrigger data-testid={`select-pole-pocket-${option.id}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(option.config.polePocketChoices || ["none", "top", "bottom", "top_bottom"]).map((choice: string) => (
                                  <SelectItem key={choice} value={choice}>
                                    {choice === "none" ? "None" :
                                     choice === "top" ? "Top" :
                                     choice === "bottom" ? "Bottom" :
                                     choice === "top_bottom" ? "Top & Bottom" : choice}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}

            {/* Show message when no options for selected product */}
            {selectedProduct && (!productOptionsInline || productOptionsInline.length === 0) && (
              <div className="text-sm text-muted-foreground italic pt-2">
                No additional options for this product.
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={handleCalculate}
                disabled={calculateMutation.isPending}
                variant="outline"
                className="flex-1"
                data-testid="button-calculate"
              >
                {calculateMutation.isPending ? "Calculating..." : "Recalculate"}
              </Button>
              <Button
                onClick={handleAddToQuote}
                disabled={!calculatedPrice || calculateMutation.isPending}
                className="flex-1"
                data-testid="button-add-to-quote"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add to Quote
              </Button>
            </div>
            {selectedProductId && width && height && quantity && (
              <p className="text-xs text-muted-foreground text-center">
                💡 Price updates automatically as you change options
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6 lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
        {/* Quick Actions Card - Always visible at top of right column */}
        <Card data-testid="card-quick-actions">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>
              {selectedProductId && width && height && quantity
                ? "Price updates automatically"
                : "Calculate and add items to your quote"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2">
              <Button
                onClick={handleCalculate}
                disabled={calculateMutation.isPending}
                variant="outline"
                className="w-full"
                data-testid="button-calculate-right"
              >
                {calculateMutation.isPending ? "Calculating..." : "Recalculate"}
              </Button>
              <Button
                onClick={handleAddToQuote}
                disabled={!calculatedPrice || calculateMutation.isPending}
                className="w-full"
                data-testid="button-add-to-quote-right"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add to Quote
              </Button>
            </div>
          </CardContent>
        </Card>

        {lineItems.length > 0 && (
          <Card data-testid="card-line-items">
            <CardHeader>
              <CardTitle>Quote Items ({lineItems.length})</CardTitle>
              <CardDescription>Items added to this quote</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {lineItems.map((item, index) => (
                  <div
                    key={item.tempId}
                    className="flex items-start justify-between p-4 border rounded-lg"
                    data-testid={`line-item-${index}`}
                  >
                    <div className="flex-1">
                      <div className="font-medium" data-testid={`line-item-product-${index}`}>
                        {item.productName}
                        {item.variantName && (
                          <span className="text-sm text-muted-foreground ml-2">
                            ({item.variantName})
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {item.width}" × {item.height}" • Qty: {item.quantity}
                      </div>
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
                    </div>
                    <div className="flex items-center gap-3 ml-4">
                      <div className="text-right">
                        <div className="font-mono font-medium" data-testid={`line-item-price-${index}`}>
                          ${item.linePrice.toFixed(2)}
                        </div>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleRemoveLineItem(item.tempId)}
                        data-testid={`button-remove-item-${index}`}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t">
                <div className="flex justify-between items-center">
                  <span className="font-medium">Quote Total:</span>
                  <span className="text-2xl font-bold font-mono" data-testid="text-quote-total">
                    ${lineItems.reduce((sum, item) => sum + item.linePrice, 0).toFixed(2)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {calculatedPrice !== null && priceBreakdown && (
          <>
            <Card data-testid="card-price-display">
              <CardHeader>
                <CardTitle>Calculated Price</CardTitle>
                <CardDescription>Price breakdown for your quote</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-primary/10 p-6 rounded-lg text-center">
                  <p className="text-sm text-muted-foreground mb-1">Total Price</p>
                  <p className="text-4xl font-bold font-mono" data-testid="text-total-price">
                    ${calculatedPrice.toFixed(2)}
                  </p>
                </div>

                <div className="space-y-2">
                  {priceBreakdown.variantInfo && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{selectedProduct?.variantLabel ?? "Variant"}:</span>
                      <span data-testid="text-variant-info">
                        {priceBreakdown.variantInfo}
                      </span>
                    </div>
                  )}
                  
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Base Price:</span>
                    <span className="font-mono" data-testid="text-base-price">
                      ${priceBreakdown.basePrice.toFixed(2)}
                    </span>
                  </div>
                  
                  {priceBreakdown.selectedOptions && priceBreakdown.selectedOptions.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-muted-foreground">Options:</div>
                      {priceBreakdown.selectedOptions.map((opt: any) => (
                        <div key={opt.optionId} className="flex justify-between text-sm pl-4">
                          <span className="text-muted-foreground">
                            {opt.optionName}
                            {typeof opt.value === 'boolean' ? '' : ` (${opt.value})`}:
                          </span>
                          <span className="font-mono" data-testid={`text-option-cost-${opt.optionId}`}>
                            ${opt.calculatedCost.toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {priceBreakdown.optionsPrice > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total Options:</span>
                      <span className="font-mono" data-testid="text-options-price">
                        ${priceBreakdown.optionsPrice.toFixed(2)}
                      </span>
                    </div>
                  )}

                  {priceBreakdown.nestingDetails && (
                    <div className="space-y-2 border-t pt-2 mt-2">
                      <div className="text-sm font-medium text-muted-foreground">Nesting Details:</div>
                      <div className="pl-4 space-y-1 text-sm">
                        {/* Sheet information */}
                        {priceBreakdown.nestingDetails.piecesPerSheet && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Max pieces per sheet:</span>
                            <span className="font-medium">
                              {priceBreakdown.nestingDetails.piecesPerSheet}
                            </span>
                          </div>
                        )}

                        {/* Nesting pattern */}
                        {priceBreakdown.nestingDetails.nestingPattern && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Pattern:</span>
                            <span className="text-xs font-medium text-blue-600">
                              {priceBreakdown.nestingDetails.nestingPattern}
                            </span>
                          </div>
                        )}

                        {/* Full sheets */}
                        {priceBreakdown.nestingDetails.fullSheets !== undefined && priceBreakdown.nestingDetails.fullSheets > 0 && (
                          <div className="flex justify-between border-t pt-1 mt-1">
                            <span className="text-muted-foreground">Full sheets:</span>
                            <span className="font-medium">
                              {priceBreakdown.nestingDetails.fullSheets} × ${(priceBreakdown.nestingDetails.fullSheetsCost / priceBreakdown.nestingDetails.fullSheets).toFixed(2)} = ${priceBreakdown.nestingDetails.fullSheetsCost.toFixed(2)}
                            </span>
                          </div>
                        )}

                        {/* Partial sheet with waste */}
                        {priceBreakdown.nestingDetails.partialSheet && (
                          <div className="space-y-1 border-t pt-1 mt-1">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Partial sheet:</span>
                              <span className="font-medium">{priceBreakdown.nestingDetails.partialSheet.pieces} pieces</span>
                            </div>
                            {priceBreakdown.nestingDetails.partialSheet.pattern && (
                              <div className="flex justify-between pl-2">
                                <span className="text-muted-foreground text-xs">Layout:</span>
                                <span className="text-xs text-blue-600">
                                  {priceBreakdown.nestingDetails.partialSheet.pattern}
                                </span>
                              </div>
                            )}
                            <div className="flex justify-between pl-2">
                              <span className="text-muted-foreground text-xs">Material used:</span>
                              <span className="text-xs">
                                {priceBreakdown.nestingDetails.partialSheet.chargeWidth}" × {priceBreakdown.nestingDetails.partialSheet.chargeHeight || priceBreakdown.nestingDetails.partialSheet.roundedHeight}"
                                ({priceBreakdown.nestingDetails.partialSheet.materialUsedSqft} sqft)
                              </span>
                            </div>
                            {priceBreakdown.nestingDetails.partialSheet.wasteSqft > 0 && (
                              <div className="flex justify-between pl-2">
                                <span className="text-muted-foreground text-xs">Waste:</span>
                                <span className={`text-xs ${priceBreakdown.nestingDetails.partialSheet.usableWaste ? 'text-green-600' : 'text-amber-600'}`}>
                                  {priceBreakdown.nestingDetails.partialSheet.wasteWidth}" × {priceBreakdown.nestingDetails.partialSheet.wasteHeight}"
                                  ({priceBreakdown.nestingDetails.partialSheet.wasteSqft} sqft)
                                  {priceBreakdown.nestingDetails.partialSheet.usableWaste && (
                                    <span className="ml-1">✓ Sellable</span>
                                  )}
                                </span>
                              </div>
                            )}
                            <div className="flex justify-between pl-2">
                              <span className="text-muted-foreground text-xs">Cost:</span>
                              <span className="text-xs font-medium">
                                ${priceBreakdown.nestingDetails.partialSheet.cost.toFixed(2)}
                                (${priceBreakdown.nestingDetails.partialSheet.costPerPiece.toFixed(2)}/pc)
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Average cost per piece */}
                        {priceBreakdown.nestingDetails.averageCostPerPiece && (
                          <div className="flex justify-between border-t pt-1 mt-1 font-medium">
                            <span className="text-muted-foreground">Average per piece:</span>
                            <span className="font-mono">${priceBreakdown.nestingDetails.averageCostPerPiece.toFixed(2)}</span>
                          </div>
                        )}

                        {/* Roll materials (legacy support) */}
                        {priceBreakdown.nestingDetails.linearFeet && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Linear feet:</span>
                            <span className="font-medium">{priceBreakdown.nestingDetails.linearFeet} ft</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="pt-2 border-t">
                    <div className="flex justify-between font-medium">
                      <span>Total:</span>
                      <span className="font-mono" data-testid="text-breakdown-total">
                        ${priceBreakdown.total.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

          </>
        )}

        {lineItems.length > 0 && (
          <Card data-testid="card-save-quote">
            <CardHeader>
              <CardTitle>Save Quote</CardTitle>
              <CardDescription>
                {user ? "Save this quote to your account" : "Log in to save quotes"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="customerName" data-testid="label-customer-name">
                  {user?.role === 'admin' || user?.role === 'owner' ? 'Customer Name (Optional)' : 'Reference Name (Optional)'}
                </Label>
                <Input
                  id="customerName"
                  placeholder={user?.role === 'admin' || user?.role === 'owner' ? 'Enter customer name' : 'Enter a name for this quote'}
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  data-testid="input-customer-name"
                />
              </div>
            </CardContent>
            <CardFooter className="flex gap-2">
              {user && !['admin', 'owner', 'manager'].includes(user.role || '') && (
                <Button
                  onClick={() => saveQuoteMutation.mutate()}
                  disabled={saveQuoteMutation.isPending}
                  className="flex-1"
                  data-testid="button-save-quote"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {saveQuoteMutation.isPending ? "Saving..." : "Save Quote"}
                </Button>
              )}
              {(!user || ['admin', 'owner', 'manager'].includes(user.role || '')) && (
                <Button
                  onClick={() => saveQuoteMutation.mutate()}
                  disabled={saveQuoteMutation.isPending}
                  variant="outline"
                  className="flex-1"
                  data-testid="button-save-quote-staff"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {saveQuoteMutation.isPending ? "Saving..." : "Quick Save"}
                </Button>
              )}
              <Button
                onClick={handleClearQuote}
                disabled={saveQuoteMutation.isPending}
                variant="outline"
                className="flex-1"
                data-testid="button-clear-quote"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Clear Quote
              </Button>
            </CardFooter>
          </Card>
        )}

        {calculatedPrice === null && lineItems.length === 0 && (
          <Card data-testid="card-price-empty">
            <CardContent className="py-16 text-center">
              <CalcIcon className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">
                Fill in the product details and click Calculate to see the price
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
