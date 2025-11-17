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
import type { Product, InsertQuote, ProductOption, ProductVariant, InsertQuoteLineItem } from "@shared/schema";

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
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [width, setWidth] = useState<string>("");
  const [height, setHeight] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("1");
  const [customerName, setCustomerName] = useState<string>("");
  const [optionValues, setOptionValues] = useState<Record<string, any>>({});
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

  const { data: productOptions } = useQuery<ProductOption[]>({
    queryKey: ["/api/products", selectedProductId, "options"],
    enabled: !!selectedProductId,
  });

  const { data: productVariants } = useQuery<ProductVariant[]>({
    queryKey: ["/api/products", selectedProductId, "variants"],
    enabled: !!selectedProductId,
  });

  const selectedProduct = products?.find(p => p.id === selectedProductId);

  // Reset option values and variant when product changes
  useEffect(() => {
    setOptionValues({});
    setSelectedVariant(null);
  }, [selectedProductId]);

  // Set default values when product options load
  useEffect(() => {
    if (productOptions && productOptions.length > 0) {
      const defaults: Record<string, any> = {};
      
      // Build parent-child map
      const childrenByParent = new Map<string, ProductOption[]>();
      productOptions.forEach(opt => {
        if (opt.parentOptionId) {
          if (!childrenByParent.has(opt.parentOptionId)) {
            childrenByParent.set(opt.parentOptionId, []);
          }
          childrenByParent.get(opt.parentOptionId)!.push(opt);
        }
      });
      
      // Set defaults for top-level options first
      productOptions.forEach(option => {
        if (!option.parentOptionId) {
          if (option.type === "toggle") {
            defaults[option.id] = option.isDefaultEnabled ?? false;
          } else if (option.type === "number" && option.defaultValue) {
            defaults[option.id] = parseFloat(option.defaultValue);
          } else if (option.type === "select" && option.defaultSelection) {
            defaults[option.id] = option.defaultSelection;
          } else if (option.defaultValue) {
            defaults[option.id] = option.defaultValue;
          }
        }
      });
      
      // Only set defaults for child options if parent toggle is enabled
      productOptions.forEach(option => {
        if (option.parentOptionId) {
          const parent = productOptions.find(p => p.id === option.parentOptionId);
          // Only set child default if parent is toggle and enabled, or parent is not a toggle
          if (parent && (parent.type !== "toggle" || defaults[parent.id] === true)) {
            if (option.type === "toggle") {
              defaults[option.id] = option.isDefaultEnabled ?? false;
            } else if (option.type === "number" && option.defaultValue) {
              defaults[option.id] = parseFloat(option.defaultValue);
            } else if (option.type === "select" && option.defaultSelection) {
              defaults[option.id] = option.defaultSelection;
            } else if (option.defaultValue) {
              defaults[option.id] = option.defaultValue;
            }
          }
        }
      });
      
      setOptionValues(defaults);
    }
  }, [productOptions]);

  const calculateMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/quotes/calculate", {
        productId: selectedProductId,
        variantId: selectedVariant,
        width: parseFloat(width),
        height: parseFloat(height),
        quantity: parseInt(quantity),
        selectedOptions: optionValues,
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
        lineItems: lineItems.map(item => ({
          productId: item.productId,
          productName: item.productName,
          variantId: item.variantId || undefined,
          variantName: item.variantName || undefined,
          width: item.width,
          height: item.height,
          quantity: item.quantity,
          selectedOptions: item.selectedOptions,
          linePrice: item.linePrice,
          priceBreakdown: item.priceBreakdown,
          displayOrder: 0,
        })),
      };

      const response = await apiRequest("POST", "/api/quotes", quoteData);
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "Quote Saved",
        description: "Your quote has been saved successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      
      // Clear everything after successful save
      setLineItems([]);
      setCustomerName("");
      setSelectedProductId("");
      setSelectedVariant(null);
      setWidth("");
      setHeight("");
      setQuantity("1");
      setOptionValues({});
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
    setOptionValues({});
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

  const handleOptionChange = (optionId: string, value: any, option: ProductOption) => {
    // Coerce number-type options to actual numbers
    let processedValue = value;
    if (option.type === "number" && typeof value === "string") {
      processedValue = value === "" ? null : parseFloat(value);
    }
    
    setOptionValues(prev => {
      const newValues = { ...prev };

      // If this is a toggle being turned off, remove it and all child option values
      if (option.type === "toggle" && !value) {
        delete newValues[optionId];
        if (childOptionsMap[optionId]) {
          childOptionsMap[optionId].forEach(childOption => {
            delete newValues[childOption.id];
          });
        }
      } else {
        // Set the value normally
        newValues[optionId] = processedValue;
      }

      return newValues;
    });
  };

  const renderOption = (option: ProductOption) => {
    const value = optionValues[option.id];

    switch (option.type) {
      case "toggle":
        return (
          <div key={option.id} className="flex items-center justify-between gap-4 p-3 rounded-md border">
            <div className="space-y-0.5 flex-1">
              <Label htmlFor={`option-${option.id}`} data-testid={`label-option-${option.id}`}>
                {option.name}
              </Label>
              {option.description && (
                <p className="text-xs text-muted-foreground">{option.description}</p>
              )}
            </div>
            <Switch
              id={`option-${option.id}`}
              checked={value ?? false}
              onCheckedChange={(checked) => handleOptionChange(option.id, checked, option)}
              data-testid={`switch-option-${option.id}`}
            />
          </div>
        );

      case "number":
        return (
          <div key={option.id} className="space-y-2">
            <Label htmlFor={`option-${option.id}`} data-testid={`label-option-${option.id}`}>
              {option.name}
            </Label>
            {option.description && (
              <p className="text-xs text-muted-foreground">{option.description}</p>
            )}
            <Input
              id={`option-${option.id}`}
              type="number"
              step="0.01"
              min="0"
              value={value ?? ""}
              onChange={(e) => handleOptionChange(option.id, e.target.value, option)}
              placeholder={option.defaultValue || "0"}
              data-testid={`input-option-${option.id}`}
            />
          </div>
        );

      case "select":
        const selectOptions = option.defaultValue?.split(",").map(opt => opt.trim()).filter(Boolean) || [];
        return (
          <div key={option.id} className="space-y-2">
            <Label htmlFor={`option-${option.id}`} data-testid={`label-option-${option.id}`}>
              {option.name}
            </Label>
            {option.description && (
              <p className="text-xs text-muted-foreground">{option.description}</p>
            )}
            <Select value={value || ""} onValueChange={(val) => handleOptionChange(option.id, val, option)}>
              <SelectTrigger id={`option-${option.id}`} data-testid={`select-option-${option.id}`}>
                <SelectValue placeholder="Select an option" />
              </SelectTrigger>
              <SelectContent>
                {selectOptions.map((opt) => (
                  <SelectItem key={opt} value={opt} data-testid={`option-${option.id}-${opt}`}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );

      default:
        return null;
    }
  };

  // Group options by parent
  const topLevelOptions = productOptions?.filter(opt => !opt.parentOptionId && opt.isActive) || [];
  const childOptionsMap = productOptions?.reduce((acc, opt) => {
    if (opt.parentOptionId && opt.isActive) {
      if (!acc[opt.parentOptionId]) acc[opt.parentOptionId] = [];
      acc[opt.parentOptionId].push(opt);
    }
    return acc;
  }, {} as Record<string, ProductOption[]>) || {};

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

            {topLevelOptions.length > 0 && (
              <div className="space-y-3">
                <Label data-testid="label-options">Product Options</Label>
                {topLevelOptions
                  .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
                  .map((option) => {
                    // For toggle parent options, only show children if parent is enabled
                    const showChildren = option.type !== "toggle" || optionValues[option.id] === true;
                    
                    return (
                      <div key={option.id} className="space-y-2">
                        {renderOption(option)}
                        {childOptionsMap[option.id] && showChildren && (
                          <div className="ml-6 space-y-2" data-testid={`child-options-${option.id}`}>
                            {childOptionsMap[option.id]
                              .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
                              .map((childOption) => renderOption(childOption))}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={handleCalculate}
                disabled={calculateMutation.isPending}
                className="flex-1"
                data-testid="button-calculate"
              >
                {calculateMutation.isPending ? "Calculating..." : "Calculate Price"}
              </Button>
              <Button
                onClick={handleAddToQuote}
                disabled={!calculatedPrice || calculateMutation.isPending}
                variant="secondary"
                className="flex-1"
                data-testid="button-add-to-quote"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add to Quote
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
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
                  
                  <div className="pt-2 border-t">
                    <div className="flex justify-between font-medium">
                      <span>Total:</span>
                      <span className="font-mono" data-testid="text-breakdown-total">
                        ${priceBreakdown.total.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground bg-muted p-3 rounded-md">
                  <p className="font-medium mb-1">Formula Used:</p>
                  <code className="font-mono" data-testid="text-formula">{priceBreakdown.formula}</code>
                </div>
              </CardContent>
            </Card>

          </>
        )}

        {lineItems.length > 0 && (
          <Card data-testid="card-save-quote">
            <CardHeader>
              <CardTitle>Save Quote</CardTitle>
              <CardDescription>Save this quote to your history</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="customerName" data-testid="label-customer-name">
                  Customer Name (Optional)
                </Label>
                <Input
                  id="customerName"
                  placeholder="Enter customer name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  data-testid="input-customer-name"
                />
              </div>
            </CardContent>
            <CardFooter className="flex gap-2">
              <Button
                onClick={() => saveQuoteMutation.mutate()}
                disabled={saveQuoteMutation.isPending}
                className="flex-1"
                data-testid="button-save-quote"
              >
                <Save className="w-4 h-4 mr-2" />
                {saveQuoteMutation.isPending ? "Saving..." : "Save Quote"}
              </Button>
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
