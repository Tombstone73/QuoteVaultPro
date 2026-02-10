import { useState, useEffect, useCallback, useRef } from "react";
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
  Users, FileText, Shield, DollarSign, Calculator 
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { CustomerSelect, type CustomerWithContacts } from "@/components/CustomerSelect";
import { AttachmentsPanel } from "@/components/AttachmentsPanel";
import type { Product, ProductVariant, ProductOptionItem } from "@shared/schema";
import { ProductOptionsPanel } from "@/features/quotes/editor/components/ProductOptionsPanel";
import type { OptionSelection } from "@/features/quotes/editor/types";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type DocumentMode = "quote" | "order";

type LineItemDraft = {
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
  selectedOptions: Record<string, any>;
  unitPrice: number;
  linePrice: number;
  priceBreakdown: any;
  displayOrder: number;
  notes?: string;
};

export type DocumentCreateFormProps = {
  mode: DocumentMode;
  products: Product[] | undefined;
  productsLoading: boolean;
  onNavigateBack: () => void;
  onSubmit: (formData: any) => Promise<void>;
  isSubmitting: boolean;
};

export function DocumentCreateForm({
  mode,
  products,
  productsLoading,
  onNavigateBack,
  onSubmit,
  isSubmitting,
}: DocumentCreateFormProps) {
  const { toast } = useToast();

  // ============ Customer State ============
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerWithContacts | undefined>();
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);

  // ============ Document Meta State ============
  const [documentDescription, setDocumentDescription] = useState("");
  const [requestedDueDate, setRequestedDueDate] = useState("");
  const [productionDueDate, setProductionDueDate] = useState("");
  const [priority, setPriority] = useState("normal");
  const [poNumber, setPoNumber] = useState("");
  
  // Order-specific
  const [orderStatus, setOrderStatus] = useState("new");

  // ============ Fulfillment State ============
  const [deliveryMethod, setDeliveryMethod] = useState<'pickup' | 'ship' | 'deliver'>('ship');
  const [shippingInstructions, setShippingInstructions] = useState("");

  // ============ Line Items State ============
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([]);
  const [nextTempId, setNextTempId] = useState(1);

  // ============ Current Line Item Being Built ============
  const [currentProductId, setCurrentProductId] = useState("");
  const [currentVariantId, setCurrentVariantId] = useState<string | null>(null);
  const [currentWidth, setCurrentWidth] = useState("");
  const [currentHeight, setCurrentHeight] = useState("");
  const [currentQuantity, setCurrentQuantity] = useState("1");
  const [currentNotes, setCurrentNotes] = useState("");
  const [optionSelections, setOptionSelections] = useState<Record<string, OptionSelection>>({});
  const [isCalculating, setIsCalculating] = useState(false);
  const [calculatedPrice, setCalculatedPrice] = useState<number | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const contacts = selectedCustomer?.contacts || [];
  const currentProduct = products?.find(p => p.id === currentProductId);
  const productOptionsInline = currentProduct?.optionsJson as ProductOptionItem[] | undefined;

  // Fetch variants for selected product
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);

  useEffect(() => {
    if (!currentProductId) {
      setVariants([]);
      setCurrentVariantId(null);
      return;
    }

    setVariantsLoading(true);
    fetch(`/api/products/${currentProductId}/variants`, { credentials: "include" })
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        setVariants(data);
        const defaultVariant = data.find((v: ProductVariant) => v.isDefault);
        if (defaultVariant) {
          setCurrentVariantId(defaultVariant.id);
        }
      })
      .catch(() => setVariants([]))
      .finally(() => setVariantsLoading(false));
  }, [currentProductId]);

  // Reset options when product changes
  useEffect(() => {
    setOptionSelections({});
  }, [currentProductId]);

  const buildSelectedOptionsPayload = useCallback(() => {
    const payload: Record<string, any> = {};
    Object.entries(optionSelections).forEach(([optionId, selection]) => {
      payload[optionId] = selection;
    });
    return payload;
  }, [optionSelections]);

  const buildSelectedOptionsArray = useCallback((
    productOptions: ProductOptionItem[],
    width: number,
    height: number,
    quantity: number
  ) => {
    const arr: any[] = [];
    for (const [optionId, sel] of Object.entries(optionSelections)) {
      const opt = productOptions.find((o) => o.id === optionId);
      if (!opt) continue;

      const amount = opt.amount || 0;
      let setupCost = 0;
      let calculatedCost = 0;

      if ((opt as any).priceMode === "flat") {
        setupCost = amount;
        calculatedCost = amount;
      } else if ((opt as any).priceMode === "per_qty") {
        calculatedCost = amount * quantity;
      } else if ((opt as any).priceMode === "per_sqft") {
        calculatedCost = amount * width * height * quantity;
      }

      arr.push({
        optionId: opt.id,
        optionName: (opt as any).label || (opt as any).name || "Option",
        value: sel.value,
        note: typeof (sel as any).note === "string" ? (sel as any).note : undefined,
        setupCost,
        calculatedCost,
        grommetsLocation: (sel as any).grommetsLocation,
        grommetsSpacingCount: (sel as any).grommetsSpacingCount,
        grommetsPerSign: (sel as any).grommetsPerSign,
        grommetsSpacingInches: (sel as any).grommetsSpacingInches,
        customPlacementNote: (sel as any).customPlacementNote,
        hemsType: (sel as any).hemsType,
        polePocket: (sel as any).polePocket,
      });
    }
    return arr;
  }, [optionSelections]);

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
      // Detect PBV2 product
      const selectedProduct = products?.find((p: any) => p.id === currentProductId);
      const isPbv2 = selectedProduct?.optionTreeJson && 
        typeof selectedProduct.optionTreeJson === 'object' && 
        (selectedProduct.optionTreeJson as any)?.schemaVersion === 2;

      const payload: any = {
        productId: currentProductId,
        variantId: currentVariantId,
        width: widthNum,
        height: heightNum,
        quantity: quantityNum,
      };

      if (isPbv2) {
        // PBV2: send optionSelectionsJson (DocumentCreateForm doesn't support PBV2 options yet, send empty)
        payload.optionSelectionsJson = { schemaVersion: 2, selected: {} };
      } else {
        // Legacy: send selectedOptions
        payload.selectedOptions = buildSelectedOptionsPayload();
      }

      const response = await apiRequest("POST", "/api/quotes/calculate", payload);
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

    const selectedOptionsArray = buildSelectedOptionsArray(productOptionsInline || [], widthNum, heightNum, quantityNum);

    const newItem: LineItemDraft = {
      tempId: `temp-${nextTempId}`,
      productId: currentProductId,
      productName: product?.name || "",
      variantId: currentVariantId,
      variantName: variant?.name || null,
      productType: product?.productTypeId || "wide_roll",
      width: widthNum,
      height: heightNum,
      quantity: quantityNum,
      specsJson: {
        width: widthNum,
        height: heightNum,
      },
      selectedOptions: selectedOptionsArray,
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
    setOptionSelections({});
    setCalculatedPrice(null);
  };

  // Delete line item
  const handleDeleteLineItem = (tempId: string) => {
    setLineItems(lineItems.filter(item => item.tempId !== tempId));
  };

  // Calculate pricing summary
  const subtotal = lineItems.reduce((sum, item) => sum + item.linePrice, 0);
  
  // Get effective tax rate (stub - would come from organization context)
  const effectiveTaxRate = selectedCustomer?.isTaxExempt 
    ? 0 
    : selectedCustomer?.taxRateOverride != null 
      ? Number(selectedCustomer.taxRateOverride)
      : 0.08; // Default 8%
  
  const taxAmount = subtotal * effectiveTaxRate;
  const grandTotal = subtotal + taxAmount;

  // Customer pricing info
  const pricingTier = selectedCustomer?.pricingTier || 'default';
  const discountPercent = selectedCustomer?.defaultDiscountPercent ? Number(selectedCustomer.defaultDiscountPercent) : null;
  const markupPercent = selectedCustomer?.defaultMarkupPercent ? Number(selectedCustomer.defaultMarkupPercent) : null;
  const marginPercent = selectedCustomer?.defaultMarginPercent ? Number(selectedCustomer.defaultMarginPercent) : null;

  // Submit handler
  const handleSubmit = async () => {
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

    const formData = {
      customerId: selectedCustomerId,
      contactId: selectedContactId,
      description: documentDescription,
      requestedDueDate: requestedDueDate || null,
      productionDueDate: productionDueDate || null,
      priority,
      poNumber: poNumber || null,
      deliveryMethod,
      shippingInstructions,
      lineItems: lineItems.map(item => ({
        productId: item.productId,
        variantId: item.variantId,
        description: `${item.productName}${item.variantName ? ` - ${item.variantName}` : ''}`,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.linePrice,
        productType: item.productType,
        width: item.width,
        height: item.height,
        specsJson: item.specsJson,
        selectedOptions: item.selectedOptions,
        priceBreakdown: item.priceBreakdown,
        displayOrder: item.displayOrder,
        notes: item.notes,
      })),
      subtotal,
      taxRate: effectiveTaxRate,
      taxAmount,
      total: grandTotal,
      // Order-specific
      ...(mode === 'order' && { status: orderStatus }),
    };

    await onSubmit(formData);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1600px] mx-auto px-6 py-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 py-2 border-b border-border/40">
          <Button variant="ghost" size="sm" onClick={onNavigateBack} className="gap-2 -ml-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">
              {mode === 'quote' ? 'New Quote' : 'New Order'}
            </h1>
          </div>
          <div className="w-[72px]" />
        </div>

        <div className="grid gap-6 mt-6 lg:grid-cols-[1fr_400px]">
          {/* LEFT: Main Form */}
          <div className="space-y-6">
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
                      setSelectedCustomerId(customerId ?? "");
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

                {/* PO # */}
                <div className="space-y-1.5 pt-2 border-t">
                  <Label className="text-xs text-muted-foreground">Customer PO #</Label>
                  <Input
                    value={poNumber}
                    onChange={(e) => setPoNumber(e.target.value)}
                    placeholder="Enter PO number..."
                    maxLength={64}
                    className="h-9 text-sm"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Document Details */}
            <Card className="rounded-xl bg-card/80 border-border/60 shadow-md">
              <CardHeader className="pb-2 px-5 pt-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  {mode === 'quote' ? 'Quote' : 'Order'} Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-5 pb-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Description / Job Name</Label>
                  <Input
                    value={documentDescription}
                    onChange={(e) => setDocumentDescription(e.target.value)}
                    placeholder="Document description..."
                    className="h-9 text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Requested Due</Label>
                    <Input
                      type="date"
                      value={requestedDueDate}
                      onChange={(e) => setRequestedDueDate(e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Production Due</Label>
                    <Input
                      type="date"
                      value={productionDueDate}
                      onChange={(e) => setProductionDueDate(e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {/* Status (Order only) */}
                  {mode === 'order' && (
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
                  )}
                  
                  {/* Priority */}
                  <div className={cn("space-y-1.5", mode === 'order' ? '' : 'col-span-2')}>
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
                </div>
              </CardContent>
            </Card>

            {/* Add Line Item */}
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

                {/* Product options */}
                {currentProductId && Array.isArray(productOptionsInline) && productOptionsInline.length > 0 && (
                  <div className="pt-2 border-t">
                    <ProductOptionsPanel
                      product={currentProduct}
                      productOptions={productOptionsInline}
                      optionSelections={optionSelections}
                      onOptionSelectionsChange={setOptionSelections}
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

            {/* Line Items List */}
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

          {/* RIGHT: Sidebar */}
          <div className="space-y-6 lg:sticky lg:top-4 h-fit">
            {/* Fulfillment */}
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
                    placeholder="Shipping notes, delivery instructions..."
                    className="min-h-[60px] text-sm"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Summary */}
            <Card className="rounded-xl bg-card/80 border-border/60 shadow-md">
              <CardHeader className="pb-2 px-5 pt-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <DollarSign className="w-4 h-4" />
                  Summary
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

            {/* Attachments (disabled until save) */}
            <AttachmentsPanel
              ownerType={mode === 'quote' ? 'quote' : 'order'}
              ownerId={undefined}
              title="Attachments"
              compact
            />

            {/* Actions */}
            <div className="space-y-2">
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || !selectedCustomerId || lineItems.length === 0}
                className="w-full"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  `Save ${mode === 'quote' ? 'Quote' : 'Order'}`
                )}
              </Button>
              <Button
                variant="outline"
                onClick={onNavigateBack}
                disabled={isSubmitting}
                className="w-full"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
