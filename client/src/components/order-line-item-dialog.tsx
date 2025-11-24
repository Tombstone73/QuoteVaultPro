import { useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Calculator } from "lucide-react";
import type { OrderLineItem } from "@/hooks/useOrders";

interface OrderLineItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lineItem?: OrderLineItem & { product: any; productVariant?: any };
  orderId: string;
  onSave: (data: any) => Promise<void>;
  mode: "add" | "edit";
}

export function OrderLineItemDialog({
  open,
  onOpenChange,
  lineItem,
  orderId,
  onSave,
  mode,
}: OrderLineItemDialogProps) {
  const [formData, setFormData] = useState({
    productId: "",
    productVariantId: "",
    description: "",
    width: "",
    height: "",
    quantity: "1",
    unitPrice: "",
    totalPrice: "",
    status: "queued",
    specsJson: "",
  });

  const [isSaving, setIsSaving] = useState(false);
  const [calculatedPrice, setCalculatedPrice] = useState<number | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [priceOverrideMode, setPriceOverrideMode] = useState<'unit' | 'total' | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch products for selection
  const { data: products = [] } = useQuery({
    queryKey: ["/api/products"],
    queryFn: async () => {
      const response = await fetch("/api/products", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch products");
      return response.json();
    },
    enabled: open,
  });

  // Fetch variants for selected product
  const { data: variants = [], isLoading: isLoadingVariants } = useQuery({
    queryKey: ["/api/products", formData.productId, "variants"],
    queryFn: async () => {
      const response = await fetch(`/api/products/${formData.productId}/variants`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch variants");
      const data = await response.json();
      console.log("Variants loaded for product", formData.productId, ":", data);
      console.log("Current formData.productVariantId:", formData.productVariantId);
      return data;
    },
    enabled: open && !!formData.productId,
  });

  // Initialize form data when dialog opens
  useEffect(() => {
    if (!open) {
      setIsInitialized(false);
      return;
    }

    if (isInitialized) return;
    
    // Wait for products to load in edit mode
    if (mode === "edit" && products.length === 0) {
      console.log("Waiting for products to load...");
      return;
    }

    if (mode === "edit" && lineItem) {
      console.log("Initializing edit mode with lineItem:", {
        productId: lineItem.productId,
        productVariantId: lineItem.productVariantId,
        productVariantIdType: typeof lineItem.productVariantId,
        description: lineItem.description,
        width: lineItem.width,
        height: lineItem.height,
        quantity: lineItem.quantity,
        unitPrice: lineItem.unitPrice,
        totalPrice: lineItem.totalPrice,
        status: lineItem.status,
        product: lineItem.product,
        productVariant: lineItem.productVariant
      });
      console.log("Available products:", products.length);
      
      const variantId = lineItem.productVariantId ? lineItem.productVariantId : "_none";
      console.log("Setting productVariantId to:", variantId, "Type:", typeof variantId);
      console.log("Original lineItem.productVariantId:", lineItem.productVariantId, "is null?", lineItem.productVariantId === null, "is undefined?", lineItem.productVariantId === undefined);
      
      setFormData({
        productId: lineItem.productId || "",
        productVariantId: variantId,
        description: lineItem.description || "",
        width: lineItem.width || "",
        height: lineItem.height || "",
        quantity: lineItem.quantity?.toString() || "1",
        unitPrice: lineItem.unitPrice || "",
        totalPrice: lineItem.totalPrice || "",
        status: lineItem.status || "queued",
        specsJson: lineItem.specsJson ? JSON.stringify(lineItem.specsJson, null, 2) : "",
      });
      // For editing, keep prices but allow recalculation if dimensions change
      setPriceOverrideMode(null);
      setIsInitialized(true);
    } else if (mode === "add") {
      setFormData({
        productId: "",
        productVariantId: "",
        description: "",
        width: "",
        height: "",
        quantity: "1",
        unitPrice: "",
        totalPrice: "",
        status: "queued",
        specsJson: "",
      });
      setCalculatedPrice(null);
      setPriceOverrideMode(null);
      setIsInitialized(true);
    }
  }, [mode, lineItem, open, isInitialized, products.length]);

  // Auto-select default variant when variants load
  useEffect(() => {
    if (variants.length > 0 && formData.productId && formData.productVariantId === "_none" && mode === "add") {
      const defaultVariant = variants.find((v: any) => v.isDefault);
      if (defaultVariant) {
        console.log("Auto-selecting default variant:", defaultVariant.id, defaultVariant.name);
        setFormData(prev => ({ ...prev, productVariantId: defaultVariant.id }));
      } else {
        console.log("No default variant found for product:", formData.productId);
      }
    }
  }, [variants.length, formData.productId, mode]);

  // Debug formData
  useEffect(() => {
    console.log("Current formData:", formData);
  }, [formData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      const quantity = parseInt(formData.quantity) || 1;
      const unitPrice = parseFloat(formData.unitPrice) || 0;
      const totalPrice = parseFloat(formData.totalPrice) || 0;
      const width = formData.width ? parseFloat(formData.width) : null;
      const height = formData.height ? parseFloat(formData.height) : null;
      
      // Calculate sqft if width and height are provided
      let sqft = null;
      if (width && height) {
        sqft = (width * height) / 144; // Convert sq inches to sq ft
      }

      // Parse specs JSON
      let specsJson = null;
      if (formData.specsJson.trim()) {
        try {
          specsJson = JSON.parse(formData.specsJson);
        } catch {
          // If not valid JSON, store as plain object
          specsJson = { specs: formData.specsJson };
        }
      }

      const data: any = {
        productId: formData.productId,
        productVariantId: (formData.productVariantId && formData.productVariantId !== "_none") ? formData.productVariantId : null,
        description: formData.description,
        width,
        height,
        quantity,
        sqft,
        unitPrice,
        totalPrice,
        status: formData.status,
        specsJson,
      };

      if (mode === "add") {
        data.orderId = orderId;
      }

      console.log("Submitting line item data:", data);

      await onSave(data);
      onOpenChange(false);
    } catch (error) {
      console.error("Error saving line item:", error);
    } finally {
      setIsSaving(false);
    }
  };

  // Handle unit price override
  const handleUnitPriceChange = (value: string) => {
    setPriceOverrideMode('unit');
    const unitPrice = parseFloat(value) || 0;
    const quantity = parseInt(formData.quantity) || 1;
    setFormData(prev => ({
      ...prev,
      unitPrice: value,
      totalPrice: (unitPrice * quantity).toFixed(2),
    }));
  };

  // Handle total price override
  const handleTotalPriceChange = (value: string) => {
    setPriceOverrideMode('total');
    const totalPrice = parseFloat(value) || 0;
    const quantity = parseInt(formData.quantity) || 1;
    const unitPrice = quantity > 0 ? totalPrice / quantity : 0;
    setFormData(prev => ({
      ...prev,
      totalPrice: value,
      unitPrice: unitPrice.toFixed(2),
    }));
  };

  // Update prices when quantity changes
  useEffect(() => {
    const quantity = parseInt(formData.quantity) || 1;
    
    if (priceOverrideMode === 'unit' && formData.unitPrice) {
      const unitPrice = parseFloat(formData.unitPrice) || 0;
      setFormData(prev => ({
        ...prev,
        totalPrice: (unitPrice * quantity).toFixed(2),
      }));
    } else if (priceOverrideMode === 'total' && formData.totalPrice) {
      const totalPrice = parseFloat(formData.totalPrice) || 0;
      const unitPrice = quantity > 0 ? totalPrice / quantity : 0;
      setFormData(prev => ({
        ...prev,
        unitPrice: unitPrice.toFixed(2),
      }));
    }
  }, [formData.quantity, priceOverrideMode]);

  // Update description when product/variant changes
  useEffect(() => {
    if (mode === "add" && formData.productId) {
      const product = products.find((p: any) => p.id === formData.productId);
      if (product) {
        let desc = product.name;
        if (formData.productVariantId) {
          const variant = variants.find((v: any) => v.id === formData.productVariantId);
          if (variant) {
            desc += ` - ${variant.name}`;
          }
        }
        setFormData(prev => ({ ...prev, description: desc }));
      }
    }
  }, [formData.productId, formData.productVariantId, products, variants, mode]);

  // Auto-calculate price with debounce
  const triggerAutoCalculate = useCallback(async () => {
    if (!formData.productId || !formData.width || !formData.height || !formData.quantity || priceOverrideMode) {
      if (!priceOverrideMode) {
        setCalculatedPrice(null);
      }
      return;
    }

    const widthNum = parseFloat(formData.width);
    const heightNum = parseFloat(formData.height);
    const quantityNum = parseInt(formData.quantity);

    if (isNaN(widthNum) || widthNum <= 0 || isNaN(heightNum) || heightNum <= 0 || isNaN(quantityNum) || quantityNum <= 0) {
      setCalculatedPrice(null);
      return;
    }

    setIsCalculating(true);

    try {
      const product = products.find((p: any) => p.id === formData.productId);
      const variant = formData.productVariantId 
        ? variants.find((v: any) => v.id === formData.productVariantId) 
        : null;

      const specsJson = {
        width: widthNum,
        height: heightNum,
        material: variant?.material || product?.defaultMaterial || "Vinyl",
        finish: variant?.finish || product?.defaultFinish || "Matte",
      };

      const response = await fetch("/api/quotes/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          productId: formData.productId,
          variantId: formData.productVariantId || undefined,
          productType: product?.type || "flatbed",
          specsJson,
          quantity: quantityNum,
          width: widthNum,
          height: heightNum,
        }),
      });

      if (!response.ok) throw new Error("Failed to calculate price");

      const data = await response.json();
      
      console.log("API Response:", data);
      console.log("Quantity:", quantityNum);
      
      // The API returns 'price' which is the TOTAL price for all items
      // We need to calculate the unit price by dividing by quantity
      if (data.price !== undefined) {
        const totalPrice = parseFloat(data.price);
        const unitPrice = quantityNum > 0 ? totalPrice / quantityNum : 0;
        
        console.log("Total Price from API:", totalPrice);
        console.log("Calculated Unit Price:", unitPrice);
        
        setCalculatedPrice(unitPrice);
        
        // Only auto-fill if user hasn't manually overridden
        if (!priceOverrideMode) {
          setFormData(prev => ({
            ...prev,
            unitPrice: unitPrice.toFixed(2),
            totalPrice: totalPrice.toFixed(2),
          }));
        }
      }
    } catch (error) {
      console.error("Failed to calculate price:", error);
      setCalculatedPrice(null);
    } finally {
      setIsCalculating(false);
    }
  }, [formData.productId, formData.productVariantId, formData.width, formData.height, formData.quantity, products, variants, priceOverrideMode]);

  // Debounced auto-calculation
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      triggerAutoCalculate();
    }, 500);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [triggerAutoCalculate]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "add" ? "Add Line Item" : "Edit Line Item"}</DialogTitle>
          <DialogDescription>
            {mode === "add" ? "Add a new item to this order" : "Update the line item details"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="product">Product *</Label>
                <Select
                  value={formData.productId}
                  onValueChange={(value) => {
                    console.log("Product changed to:", value);
                    setFormData(prev => ({ ...prev, productId: value, productVariantId: "_none" }));
                  }}
                >
                  <SelectTrigger id="product">
                    <SelectValue placeholder="Select product" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((product: any) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="variant">Variant {variants && variants.length > 0 && "*"}</Label>
                <Select
                  key={`variant-${formData.productId}-${variants.length}`}
                  value={formData.productVariantId && formData.productVariantId !== "_none" ? formData.productVariantId : "_none"}
                  onValueChange={(value) => {
                    console.log("Variant changed to:", value);
                    setFormData(prev => ({ ...prev, productVariantId: value === "_none" ? "_none" : value }));
                  }}
                  disabled={!formData.productId || isLoadingVariants}
                >
                  <SelectTrigger id="variant">
                    <SelectValue placeholder="Select variant" />
                  </SelectTrigger>
                  <SelectContent>
                    {(!variants || variants.length === 0) && <SelectItem value="_none">None</SelectItem>}
                    {variants.map((variant: any) => {
                      const isSelected = formData.productVariantId === variant.id;
                      console.log("Rendering variant:", variant.id, variant.name, "Selected:", formData.productVariantId, "Match:", isSelected);
                      return (
                        <SelectItem key={variant.id} value={variant.id}>
                          {variant.name}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description *</Label>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                required
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="width">Width (inches)</Label>
                <Input
                  id="width"
                  type="number"
                  step="0.01"
                  value={formData.width}
                  onChange={(e) => setFormData({ ...formData, width: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="height">Height (inches)</Label>
                <Input
                  id="height"
                  type="number"
                  step="0.01"
                  value={formData.height}
                  onChange={(e) => setFormData({ ...formData, height: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="quantity">Quantity *</Label>
                <Input
                  id="quantity"
                  type="number"
                  min="1"
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                  required
                />
              </div>
            </div>

            {/* Calculated Price Display */}
            {calculatedPrice !== null && !priceOverrideMode && (
              <div className="rounded-lg border p-4 bg-muted/50">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium flex items-center gap-2">
                    <Calculator className="w-4 h-4" />
                    Calculated Unit Price:
                  </span>
                  <span className="text-xl font-bold">${calculatedPrice.toFixed(2)}</span>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  Total for {formData.quantity} item(s): ${(calculatedPrice * parseInt(formData.quantity || "1")).toFixed(2)}
                </div>
              </div>
            )}

            {isCalculating && (
              <div className="rounded-lg border p-4 bg-muted/50">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Calculating price...</span>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select
                value={formData.status}
                onValueChange={(value) => setFormData({ ...formData, status: value })}
              >
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="queued">Queued</SelectItem>
                  <SelectItem value="printing">Printing</SelectItem>
                  <SelectItem value="finishing">Finishing</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                  <SelectItem value="canceled">Canceled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Price Override Section */}
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium mb-3">Price Override (optional)</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="unitPrice">Unit Price (each)</Label>
                    {priceOverrideMode === 'unit' && (
                      <Badge variant="secondary" className="text-xs">
                        Manual Override
                      </Badge>
                    )}
                  </div>
                  <Input
                    id="unitPrice"
                    type="number"
                    step="0.01"
                    placeholder={calculatedPrice ? calculatedPrice.toFixed(2) : "0.00"}
                    value={formData.unitPrice}
                    onChange={(e) => handleUnitPriceChange(e.target.value)}
                    className={priceOverrideMode === 'unit' ? 'border-amber-500 bg-amber-50' : ''}
                  />
                  <p className="text-xs text-muted-foreground">
                    Override calculated price per piece
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="totalPrice">Total Price (all items)</Label>
                    {priceOverrideMode === 'total' && (
                      <Badge variant="secondary" className="text-xs">
                        Manual Override
                      </Badge>
                    )}
                  </div>
                  <Input
                    id="totalPrice"
                    type="number"
                    step="0.01"
                    placeholder={calculatedPrice ? (calculatedPrice * parseInt(formData.quantity || "1")).toFixed(2) : "0.00"}
                    value={formData.totalPrice}
                    onChange={(e) => handleTotalPriceChange(e.target.value)}
                    className={priceOverrideMode === 'total' ? 'border-amber-500 bg-amber-50' : ''}
                  />
                  <p className="text-xs text-muted-foreground">
                    Override total price (recalculates unit price)
                  </p>
                </div>
              </div>

              {/* Display current pricing */}
              <div className="mt-3 p-3 bg-muted rounded-md">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Unit Price:</span>
                  <span className="font-medium">${parseFloat(formData.unitPrice || "0").toFixed(2)} each</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-muted-foreground">Quantity:</span>
                  <span className="font-medium">{formData.quantity} item(s)</span>
                </div>
                <div className="flex justify-between text-sm font-semibold mt-2 pt-2 border-t">
                  <span>Line Total:</span>
                  <span>${parseFloat(formData.totalPrice || "0").toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="specs">Specs (JSON)</Label>
              <Textarea
                id="specs"
                value={formData.specsJson}
                onChange={(e) => setFormData({ ...formData, specsJson: e.target.value })}
                placeholder='{"material": "Vinyl", "finish": "Matte"}'
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                Optional: Enter specs as JSON or plain text
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving..." : mode === "add" ? "Add Item" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
