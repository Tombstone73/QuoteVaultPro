import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  ArrowLeft, Plus, Trash2, Loader2, Truck, Store, Building2, 
  Users, FileText, Shield, DollarSign, Pencil, Calculator 
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { CustomerSelect, type CustomerWithContacts } from "@/components/CustomerSelect";
import { apiRequest } from "@/lib/queryClient";
import type { Product, ProductVariant, ProductOptionItem, Organization } from "@shared/schema";
import { profileRequiresDimensions, getProfile } from "@shared/pricingProfiles";
import { cn } from "@/lib/utils";

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

type OrderLineItemDraft = {
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
  unitPrice: number;
  linePrice: number;
  priceBreakdown: any;
  displayOrder: number;
  notes?: string;
};

export default function CreateOrder() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Customer state
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerWithContacts | undefined>();
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);

  // Fulfillment state
  const [deliveryMethod, setDeliveryMethod] = useState<'pickup' | 'ship' | 'deliver'>('ship');
  const [shippingInstructions, setShippingInstructions] = useState("");
  
  // Order meta state
  const [orderDescription, setOrderDescription] = useState("");
  const [requestedDueDate, setRequestedDueDate] = useState("");
  const [productionDueDate, setProductionDueDate] = useState("");
  const [orderStatus, setOrderStatus] = useState("new");
  const [priority, setPriority] = useState("normal");

  // Line items state
  const [lineItems, setLineItems] = useState<OrderLineItemDraft[]>([]);
  const [nextTempId, setNextTempId] = useState(1);

  // Current line item being built
  const [currentProductId, setCurrentProductId] = useState("");
  const [currentVariantId, setCurrentVariantId] = useState<string | null>(null);
  const [currentWidth, setCurrentWidth] = useState("");
  const [currentHeight, setCurrentHeight] = useState("");
  const [currentQuantity, setCurrentQuantity] = useState("1");
  const [currentNotes, setCurrentNotes] = useState("");
  const [currentOptions, setCurrentOptions] = useState<Record<string, any>>({});
  const [isCalculating, setIsCalculating] = useState(false);
  const [calculatedPrice, setCalculatedPrice] = useState<number | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch organization
  const { data: organization } = useQuery<Organization>({
    queryKey: ["/api/organization"],
    queryFn: async () => {
      const response = await fetch("/api/organization", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch organization");
      return response.json();
    },
  });

  // Fetch products
  const { data: products, isLoading: productsLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
    queryFn: async () => {
      const response = await fetch("/api/products", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch products");
      return response.json();
    },
  });

  // Fetch variants for selected product
  const { data: variants } = useQuery<ProductVariant[]>({
    queryKey: ["/api/products", currentProductId, "variants"],
    queryFn: async () => {
      if (!currentProductId) return [];
      const response = await fetch(`/api/products/${currentProductId}/variants`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch variants");
      return response.json();
    },
    enabled: !!currentProductId,
  });

  // Get current product and options
  const currentProduct = products?.find(p => p.id === currentProductId);
  const productOptionsInline = currentProduct?.optionsJson as ProductOptionItem[] | undefined;
  const contacts = selectedCustomer?.contacts || [];

  // Auto-select default variant
  useEffect(() => {
    if (variants && variants.length > 0 && currentProductId) {
      const defaultVariant = variants.find(v => v.isDefault);
      if (defaultVariant) {
        setCurrentVariantId(defaultVariant.id);
      }
    }
  }, [variants, currentProductId]);

  // Reset current options when product changes
  useEffect(() => {
    setCurrentOptions({});
  }, [currentProductId]);

  // Build selected options payload for pricing API
  const buildSelectedOptionsPayload = useCallback(() => {
    const payload: Record<string, any> = {};
    Object.entries(currentOptions).forEach(([optionId, selection]) => {
      payload[optionId] = selection;
    });
    return payload;
  }, [currentOptions]);

  // Auto-calculate price with debounce
  const triggerAutoCalculate = useCallback(async () => {
    if (!currentProductId || !currentWidth || !currentHeight || !currentQuantity) {
      setCalculatedPrice(null);
      return;
    }

    const widthNum = parseFloat(currentWidth);
    const heightNum = parseFloat(currentHeight);
    const quantityNum = parseInt(currentQuantity);

    if (isNaN(widthNum) || widthNum <= 0 || isNaN(heightNum) || heightNum <= 0 || isNaN(quantityNum) || quantityNum <= 0) {
      setCalculatedPrice(null);
      return;
    }

    setIsCalculating(true);

    try {
      const response = await apiRequest("POST", "/api/quotes/calculate", {
        productId: currentProductId,
        variantId: currentVariantId,
        width: widthNum,
        height: heightNum,
        quantity: quantityNum,
        selectedOptions: buildSelectedOptionsPayload(),
      });
      const data = await response.json();
      setCalculatedPrice(data.price || 0);
    } catch (error) {
      setCalculatedPrice(null);
    } finally {
      setIsCalculating(false);
    }
  }, [currentProductId, currentVariantId, currentWidth, currentHeight, currentQuantity, buildSelectedOptionsPayload]);

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

  // Add line item
  const handleAddLineItem = () => {
    if (!currentProductId || calculatedPrice === null) {
      toast({
        title: "Missing Information",
        description: "Please select a product and wait for price calculation",
        variant: "destructive",
      });
      return;
    }

    const product = products?.find(p => p.id === currentProductId);
    const variant = variants?.find(v => v.id === currentVariantId);

    const widthNum = parseFloat(currentWidth) || 0;
    const heightNum = parseFloat(currentHeight) || 0;
    const quantityNum = parseInt(currentQuantity) || 1;

    const newItem: OrderLineItemDraft = {
      tempId: `temp-${nextTempId}`,
      productId: currentProductId,
      productName: product?.name || "",
      variantId: currentVariantId,
      variantName: variant?.name || null,
      productType: product?.productType || "wide_roll",
      width: widthNum,
      height: heightNum,
      quantity: quantityNum,
      specsJson: {
        width: widthNum,
        height: heightNum,
      },
      selectedOptions: buildSelectedOptionsPayload(),
      unitPrice: calculatedPrice / quantityNum,
      linePrice: calculatedPrice,
      priceBreakdown: {},
      displayOrder: lineItems.length,
      notes: currentNotes,
    };

    setLineItems([...lineItems, newItem]);
    setNextTempId(nextTempId + 1);

    // Reset form
    setCurrentProductId("");
    setCurrentVariantId(null);
    setCurrentWidth("");
    setCurrentHeight("");
    setCurrentQuantity("1");
    setCurrentNotes("");
    setCurrentOptions({});
    setCalculatedPrice(null);
  };

  // Delete line item
  const handleDeleteLineItem = (tempId: string) => {
    setLineItems(lineItems.filter(item => item.tempId !== tempId));
  };

  // Calculate pricing summary
  const subtotal = lineItems.reduce((sum, item) => sum + item.linePrice, 0);
  
  // Get effective tax rate
  const effectiveTaxRate = selectedCustomer?.isTaxExempt 
    ? 0 
    : selectedCustomer?.taxRateOverride != null 
      ? Number(selectedCustomer.taxRateOverride)
      : Number(organization?.defaultTaxRate || 0);
  
  const taxAmount = subtotal * effectiveTaxRate;
  const grandTotal = subtotal + taxAmount;

  // Customer info computed values
  const pricingTier = selectedCustomer?.pricingTier || 'default';
  const discountPercent = selectedCustomer?.defaultDiscountPercent ? Number(selectedCustomer.defaultDiscountPercent) : null;
  const markupPercent = selectedCustomer?.defaultMarkupPercent ? Number(selectedCustomer.defaultMarkupPercent) : null;
  const marginPercent = selectedCustomer?.defaultMarginPercent ? Number(selectedCustomer.defaultMarginPercent) : null;

  // Create order mutation
  const createOrderMutation = useMutation({
    mutationFn: async (orderData: any) => {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderData),
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create order");
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Success",
        description: "Order created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      navigate(`/orders/${data.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Submit order
  const handleSaveOrder = () => {
    if (!selectedCustomerId) {
      toast({
        title: "Validation Error",
        description: "Please select a customer",
        variant: "destructive",
      });
      return;
    }

    if (lineItems.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please add at least one line item",
        variant: "destructive",
      });
      return;
    }

    const orderData = {
      customerId: selectedCustomerId,
      contactId: selectedContactId,
      status: orderStatus,
      priority,
      shippingMethod: deliveryMethod,
      shippingMode: 'single_shipment',
      shippingInstructions,
      requestedDueDate: requestedDueDate || null,
      productionDueDate: productionDueDate || null,
      description: orderDescription,
      subtotal,
      taxRate: effectiveTaxRate,
      taxAmount,
      total: grandTotal,
      lineItems: lineItems.map(item => ({
        productId: item.productId,
        variantId: item.variantId,
        description: `${item.productName}${item.variantName ? ` - ${item.variantName}` : ''}`,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        linePrice: item.linePrice,
        productType: item.productType,
        width: item.width,
        height: item.height,
        specsJson: item.specsJson,
        selectedOptions: item.selectedOptions,
        priceBreakdown: item.priceBreakdown,
        displayOrder: item.displayOrder,
        notes: item.notes,
      })),
    };

    createOrderMutation.mutate(orderData);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-3 px-4">
      {/* Header with navigation */}
      <div className="flex items-center justify-between py-2">
        <Button variant="ghost" onClick={() => navigate("/orders")} className="gap-2 h-9">
          <ArrowLeft className="w-4 h-4" />
          Back to Orders
        </Button>
        <h1 className="text-xl font-semibold">New Order</h1>
        <div className="w-32" /> {/* Spacer for centering */}
      </div>

      {/* 3-Column Command Station Layout */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)_minmax(280px,340px)]">
        
        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* LEFT COLUMN: Customer & Fulfillment */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="space-y-3 order-1 xl:order-1">
          {/* Customer Card */}
          <Card className="rounded-xl bg-card/80 border-border/60 shadow-md">
            <CardHeader className="pb-2 px-5 pt-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Users className="w-4 h-4" />
                Customer
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-5 pb-4">
              <div className="space-y-1.5">
                <CustomerSelect
                  value={selectedCustomerId}
                  onChange={(customerId, customer, contactId) => {
                    setSelectedCustomerId(customerId);
                    setSelectedCustomer(customer);
                    setSelectedContactId(contactId || null);
                  }}
                  autoFocus={true}
                  label=""
                  placeholder="Search customers..."
                />
                {selectedCustomer && (
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    {selectedCustomer.phone && <div>{selectedCustomer.phone}</div>}
                    {selectedCustomer.email && <div>{selectedCustomer.email}</div>}
                  </div>
                )}
              </div>

              {/* Customer info badges */}
              {selectedCustomer && (
                <div className="space-y-3">
                  {/* Tier badge */}
                  <div className="flex items-center gap-2">
                    <Badge variant={pricingTier === 'wholesale' ? 'default' : pricingTier === 'retail' ? 'secondary' : 'outline'}>
                      {pricingTier.charAt(0).toUpperCase() + pricingTier.slice(1)}
                    </Badge>
                    
                    {/* Pricing modifiers */}
                    {discountPercent && discountPercent > 0 && (
                      <Badge variant="outline" className="text-green-600 border-green-300">
                        -{discountPercent}% disc
                      </Badge>
                    )}
                    {markupPercent && markupPercent > 0 && (
                      <Badge variant="outline" className="text-blue-600 border-blue-300">
                        +{markupPercent}% markup
                      </Badge>
                    )}
                    {marginPercent && marginPercent > 0 && (
                      <Badge variant="outline" className="text-purple-600 border-purple-300">
                        {marginPercent}% margin
                      </Badge>
                    )}
                  </div>

                  {/* Tax status */}
                  <div className="flex items-center gap-2 text-sm">
                    <Shield className="w-3.5 h-3.5 text-muted-foreground" />
                    {selectedCustomer.isTaxExempt ? (
                      <span className="text-green-600 font-medium">Tax Exempt</span>
                    ) : selectedCustomer.taxRateOverride != null ? (
                      <span>Tax: {(Number(selectedCustomer.taxRateOverride) * 100).toFixed(2)}% (override)</span>
                    ) : (
                      <span className="text-muted-foreground">Tax: {(effectiveTaxRate * 100).toFixed(2)}% (default)</span>
                    )}
                  </div>

                  {/* Contact selector */}
                  {contacts && contacts.length > 0 && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Contact</Label>
                      <Select value={selectedContactId || ""} onValueChange={setSelectedContactId}>
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder="Select contact" />
                        </SelectTrigger>
                        <SelectContent>
                          {contacts.map((contact: any) => (
                            <SelectItem key={contact.id} value={contact.id}>
                              {contact.firstName} {contact.lastName}
                              {contact.isPrimary && " ★"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Fulfillment Card */}
          <Card className="rounded-xl bg-card/80 border-border/60 shadow-md">
            <CardHeader className="pb-2 px-5 pt-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Truck className="w-4 h-4" />
                Fulfillment
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-5 pb-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Delivery Method</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={deliveryMethod === 'pickup' ? 'default' : 'outline'}
                    onClick={() => setDeliveryMethod('pickup')}
                    className="flex-1"
                  >
                    <Store className="w-3.5 h-3.5 mr-1.5" />
                    Pickup
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={deliveryMethod === 'ship' ? 'default' : 'outline'}
                    onClick={() => setDeliveryMethod('ship')}
                    className="flex-1"
                  >
                    <Truck className="w-3.5 h-3.5 mr-1.5" />
                    Ship
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={deliveryMethod === 'deliver' ? 'default' : 'outline'}
                    onClick={() => setDeliveryMethod('deliver')}
                    className="flex-1"
                  >
                    <Building2 className="w-3.5 h-3.5 mr-1.5" />
                    Deliver
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Special Instructions</Label>
                <Textarea
                  value={shippingInstructions}
                  onChange={(e) => setShippingInstructions(e.target.value)}
                  placeholder="Internal notes, special instructions..."
                  className="min-h-[80px] text-sm"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* CENTER COLUMN: Line Item Builder & List */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="space-y-3 order-3 xl:order-2">
          {/* Add Line Item Card */}
          <Card className="rounded-xl bg-card/80 border-border/60 shadow-md">
            <CardHeader className="pb-2 px-5 pt-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Plus className="w-4 h-4" />
                Add Line Item
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-5 pb-4">
              {/* Product selection */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Product</Label>
                <Select value={currentProductId} onValueChange={setCurrentProductId}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Select product..." />
                  </SelectTrigger>
                  <SelectContent>
                    {productsLoading ? (
                      <SelectItem value="loading" disabled>Loading products...</SelectItem>
                    ) : products && products.length > 0 ? (
                      products.map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.name}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="none" disabled>No products available</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Variant selection */}
              {currentProductId && variants && variants.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Variant</Label>
                  <Select value={currentVariantId || ""} onValueChange={setCurrentVariantId}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Select variant..." />
                    </SelectTrigger>
                    <SelectContent>
                      {variants.map((variant) => (
                        <SelectItem key={variant.id} value={variant.id}>
                          {variant.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Dimensions */}
              {currentProductId && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Width (in)</Label>
                    <Input
                      type="number"
                      value={currentWidth}
                      onChange={(e) => setCurrentWidth(e.target.value)}
                      placeholder="0"
                      className="h-9 text-sm"
                      step="0.01"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Height (in)</Label>
                    <Input
                      type="number"
                      value={currentHeight}
                      onChange={(e) => setCurrentHeight(e.target.value)}
                      placeholder="0"
                      className="h-9 text-sm"
                      step="0.01"
                    />
                  </div>
                </div>
              )}

              {/* Quantity */}
              {currentProductId && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Quantity</Label>
                  <Input
                    type="number"
                    value={currentQuantity}
                    onChange={(e) => setCurrentQuantity(e.target.value)}
                    placeholder="1"
                    className="h-9 text-sm"
                    min="1"
                  />
                </div>
              )}

              {/* Calculated price display */}
              {currentProductId && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Calculated Price</Label>
                  <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md">
                    {isCalculating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Calculating...</span>
                      </>
                    ) : calculatedPrice !== null ? (
                      <>
                        <Calculator className="w-4 h-4 text-green-600" />
                        <span className="text-sm font-semibold text-green-600">
                          ${calculatedPrice.toFixed(2)}
                        </span>
                      </>
                    ) : (
                      <span className="text-sm text-muted-foreground">Enter dimensions to calculate</span>
                    )}
                  </div>
                </div>
              )}

              {/* Notes */}
              {currentProductId && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Notes (optional)</Label>
                  <Textarea
                    value={currentNotes}
                    onChange={(e) => setCurrentNotes(e.target.value)}
                    placeholder="Line item notes..."
                    className="min-h-[60px] text-sm"
                  />
                </div>
              )}

              {/* Add button */}
              <Button
                onClick={handleAddLineItem}
                disabled={!currentProductId || calculatedPrice === null || isCalculating}
                className="w-full"
                size="sm"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Line Item
              </Button>
            </CardContent>
          </Card>

          {/* Line Items List Card */}
          <Card className="rounded-xl bg-card/80 border-border/60 shadow-md">
            <CardHeader className="pb-2 px-5 pt-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Line Items ({lineItems.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              {lineItems.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No line items added yet
                </div>
              ) : (
                <div className="space-y-2">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Product</TableHead>
                        <TableHead className="text-xs text-right">Size</TableHead>
                        <TableHead className="text-xs text-right">Qty</TableHead>
                        <TableHead className="text-xs text-right">Price</TableHead>
                        <TableHead className="w-[50px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lineItems.map((item) => (
                        <TableRow key={item.tempId}>
                          <TableCell className="text-sm">
                            <div className="font-medium">{item.productName}</div>
                            {item.variantName && (
                              <div className="text-xs text-muted-foreground">{item.variantName}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-right">
                            {item.width}" × {item.height}"
                          </TableCell>
                          <TableCell className="text-sm text-right">{item.quantity}</TableCell>
                          <TableCell className="text-sm text-right font-medium">
                            ${item.linePrice.toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteLineItem(item.tempId!)}
                              className="h-8 w-8 p-0"
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
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* RIGHT COLUMN: Summary & Actions */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="space-y-3 order-2 xl:order-3">
          {/* Order Summary Card */}
          <Card className="rounded-xl bg-card/80 border-border/60 shadow-md">
            <CardHeader className="pb-2 px-5 pt-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                Order Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 px-5 pb-4">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium">${subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Tax ({(effectiveTaxRate * 100).toFixed(2)}%)
                </span>
                <span className="font-medium">${taxAmount.toFixed(2)}</span>
              </div>
              <Separator />
              <div className="flex justify-between text-base">
                <span className="font-semibold">Grand Total</span>
                <span className="font-bold text-lg">${grandTotal.toFixed(2)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Meta Card */}
          <Card className="rounded-xl bg-card/80 border-border/60 shadow-md">
            <CardHeader className="pb-2 px-5 pt-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Order Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-5 pb-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Description / Job Name</Label>
                <Input
                  value={orderDescription}
                  onChange={(e) => setOrderDescription(e.target.value)}
                  placeholder="Order description..."
                  className="h-9 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Requested Due Date</Label>
                <Input
                  type="date"
                  value={requestedDueDate}
                  onChange={(e) => setRequestedDueDate(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Production Due Date</Label>
                <Input
                  type="date"
                  value={productionDueDate}
                  onChange={(e) => setProductionDueDate(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Status</Label>
                <Select value={orderStatus} onValueChange={setOrderStatus}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">New</SelectItem>
                    <SelectItem value="in_production">In Production</SelectItem>
                    <SelectItem value="on_hold">On Hold</SelectItem>
                    <SelectItem value="ready_for_shipment">Ready for Shipment</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="rush">Rush</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="space-y-2">
            <Button
              onClick={handleSaveOrder}
              disabled={createOrderMutation.isPending || !selectedCustomerId || lineItems.length === 0}
              className="w-full"
            >
              {createOrderMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Order"
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate("/orders")}
              disabled={createOrderMutation.isPending}
              className="w-full"
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
