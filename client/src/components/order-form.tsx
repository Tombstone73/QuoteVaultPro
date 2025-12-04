import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Plus, Calculator, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { CustomerSelect, type CustomerWithContacts } from "@/components/CustomerSelect";
import type { ProductOptionItem } from "@shared/schema";

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

interface OrderLineItemDraft {
  tempId: string;
  productId: string;
  productName: string;
  productVariantId: string | null;
  productType: string;
  description: string;
  width: number | null;
  height: number | null;
  quantity: number;
  sqft: number | null;
  unitPrice: number;
  totalPrice: number;
  status: string;
  specsJson: Record<string, any>;
}

interface OrderFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (orderId: string) => void;
}

export default function OrderForm({ open, onOpenChange, onSuccess }: OrderFormProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  // Customer selection
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [selectedContactId, setSelectedContactId] = useState<string>("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerWithContacts | undefined>(undefined);

  // Order details
  const [status, setStatus] = useState("new");
  const [priority, setPriority] = useState("normal");
  const [dueDate, setDueDate] = useState("");
  const [promisedDate, setPromisedDate] = useState("");
  const [discount, setDiscount] = useState(0);
  const [notesInternal, setNotesInternal] = useState("");

  // Line items
  const [lineItems, setLineItems] = useState<OrderLineItemDraft[]>([]);

  // Item being added/edited
  const [showItemDialog, setShowItemDialog] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [calculatedPrice, setCalculatedPrice] = useState<number | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [priceOverrideMode, setPriceOverrideMode] = useState<'unit' | 'total' | null>(null);
  const [unitPrice, setUnitPrice] = useState("");
  const [totalPrice, setTotalPrice] = useState("");
  const [optionSelections, setOptionSelections] = useState<Record<string, {
    value: boolean | number | string;
    grommetsLocation?: string;
    grommetsSpacingCount?: number;
    grommetsSpacingInches?: number;
    grommetsPerSign?: number;
    customPlacementNote?: string;
    hemsType?: string;
    polePocket?: string;
  }>>({});
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Get contacts from selected customer
  const contacts = selectedCustomer?.contacts || [];

  // Fetch products
  const { data: products } = useQuery<any[]>({
    queryKey: ["/api/products"],
    queryFn: async () => {
      const response = await fetch("/api/products", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch products");
      return response.json();
    },
  });

  // Fetch variants for selected product
  const { data: variants } = useQuery<any[]>({
    queryKey: ["/api/products", selectedProductId, "variants"],
    queryFn: async () => {
      if (!selectedProductId) return [];
      const response = await fetch(`/api/products/${selectedProductId}/variants`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch variants");
      return response.json();
    },
    enabled: !!selectedProductId,
  });

  // Get inline options from selected product
  const selectedProduct = products?.find(p => p.id === selectedProductId);
  const productOptionsInline = selectedProduct?.optionsJson as ProductOptionItem[] | undefined;

  // Build selectedOptions payload for API
  const buildSelectedOptionsPayload = useCallback(() => {
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
  }, [optionSelections]);

  // Auto-calculate price with debounce
  const triggerAutoCalculate = useCallback(async () => {
    if (!selectedProductId || !width || !height || !quantity || priceOverrideMode) {
      if (!priceOverrideMode) {
        setCalculatedPrice(null);
      }
      return;
    }

    const widthNum = parseFloat(width);
    const heightNum = parseFloat(height);
    const quantityNum = parseInt(quantity);

    if (isNaN(widthNum) || widthNum <= 0 || isNaN(heightNum) || heightNum <= 0 || isNaN(quantityNum) || quantityNum <= 0) {
      setCalculatedPrice(null);
      return;
    }

    setIsCalculating(true);

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
      
      // The API returns 'price' which is the TOTAL price for all items
      // We need to calculate the unit price by dividing by quantity
      const totalPrice = data.price;
      const unitPrice = quantityNum > 0 ? totalPrice / quantityNum : 0;
      setCalculatedPrice(unitPrice);
      
      // Only auto-fill if user hasn't manually overridden
      if (!priceOverrideMode) {
        setUnitPrice(unitPrice.toFixed(2));
        setTotalPrice(totalPrice.toFixed(2));
      }
    } catch (error) {
      setCalculatedPrice(null);
    } finally {
      setIsCalculating(false);
    }
  }, [selectedProductId, selectedVariantId, width, height, quantity, priceOverrideMode, buildSelectedOptionsPayload]);

  // Reset options when product changes
  useEffect(() => {
    setOptionSelections({});
  }, [selectedProductId]);

  // Handle unit price override
  const handleUnitPriceChange = (value: string) => {
    setPriceOverrideMode('unit');
    const unitPriceNum = parseFloat(value) || 0;
    const quantityNum = parseInt(quantity) || 1;
    setUnitPrice(value);
    setTotalPrice((unitPriceNum * quantityNum).toFixed(2));
  };

  // Handle total price override
  const handleTotalPriceChange = (value: string) => {
    setPriceOverrideMode('total');
    const totalPriceNum = parseFloat(value) || 0;
    const quantityNum = parseInt(quantity) || 1;
    const unitPriceNum = quantityNum > 0 ? totalPriceNum / quantityNum : 0;
    setTotalPrice(value);
    setUnitPrice(unitPriceNum.toFixed(2));
  };

  // Update prices when quantity changes
  useEffect(() => {
    const quantityNum = parseInt(quantity) || 1;
    
    if (priceOverrideMode === 'unit' && unitPrice) {
      const unitPriceNum = parseFloat(unitPrice) || 0;
      setTotalPrice((unitPriceNum * quantityNum).toFixed(2));
    } else if (priceOverrideMode === 'total' && totalPrice) {
      const totalPriceNum = parseFloat(totalPrice) || 0;
      const unitPriceNum = quantityNum > 0 ? totalPriceNum / quantityNum : 0;
      setUnitPrice(unitPriceNum.toFixed(2));
    }
  }, [quantity, priceOverrideMode]);

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

  // Auto-select default variant when product changes
  useEffect(() => {
    if (variants && variants.length > 0 && selectedProductId && !editingItemId) {
      const defaultVariant = variants.find((v: any) => v.isDefault);
      if (defaultVariant) {
        console.log("Auto-selecting default variant:", defaultVariant.id, defaultVariant.name);
        setSelectedVariantId(defaultVariant.id);
      }
    }
  }, [variants?.length, selectedProductId, editingItemId]);

  const handleAddLineItem = () => {
    // Allow saving with either calculated price or manual override
    const finalUnitPrice = parseFloat(unitPrice) || calculatedPrice;
    const finalTotalPrice = parseFloat(totalPrice) || (finalUnitPrice ? finalUnitPrice * parseInt(quantity || "1") : 0);
    
    if (!selectedProductId || (!finalUnitPrice && !finalTotalPrice)) {
      toast({
        title: "Missing Information",
        description: "Please select a product and enter/calculate a price",
        variant: "destructive",
      });
      return;
    }

    const product = products?.find(p => p.id === selectedProductId);
    const variant = variants?.find(v => v.id === selectedVariantId);
    
    const widthNum = parseFloat(width) || 0;
    const heightNum = parseFloat(height) || 0;
    const quantityNum = parseInt(quantity) || 1;
    const sqft = widthNum && heightNum ? (widthNum * heightNum * quantityNum) / 144 : null;

    const newItem: OrderLineItemDraft = {
      tempId: editingItemId || `temp-${Date.now()}`,
      productId: selectedProductId,
      productName: product?.name || "",
      productVariantId: selectedVariantId,
      productType: product?.productType || "wide_roll",
      description: `${product?.name}${variant ? ` - ${variant.name}` : ""}`,
      width: widthNum || null,
      height: heightNum || null,
      quantity: quantityNum,
      sqft,
      unitPrice: finalUnitPrice || 0,
      totalPrice: finalTotalPrice || 0,
      status: "queued",
      specsJson: {
        width: widthNum,
        height: heightNum,
      },
    };

    if (editingItemId) {
      setLineItems(lineItems.map(item => item.tempId === editingItemId ? newItem : item));
    } else {
      setLineItems([...lineItems, newItem]);
    }

    // Reset form
    setSelectedProductId("");
    setSelectedVariantId(null);
    setWidth("");
    setHeight("");
    setQuantity("1");
    setCalculatedPrice(null);
    setPriceOverrideMode(null);
    setUnitPrice("");
    setTotalPrice("");
    setOptionSelections({});
    setEditingItemId(null);
    setShowItemDialog(false);
  };

  const handleEditLineItem = (item: OrderLineItemDraft) => {
    setEditingItemId(item.tempId);
    setSelectedProductId(item.productId);
    setSelectedVariantId(item.productVariantId);
    setWidth(item.width?.toString() || "");
    setHeight(item.height?.toString() || "");
    setQuantity(item.quantity.toString());
    setCalculatedPrice(item.unitPrice);
    setUnitPrice(item.unitPrice.toString());
    setTotalPrice(item.totalPrice.toString());
    setPriceOverrideMode(null);
    setShowItemDialog(true);
  };

  const handleDeleteLineItem = (tempId: string) => {
    setLineItems(lineItems.filter(item => item.tempId !== tempId));
  };

  const createOrderMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
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
      onOpenChange(false);
      if (onSuccess && data?.id) {
        onSuccess(data.id);
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

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

    const subtotal = lineItems.reduce((sum, item) => sum + item.totalPrice, 0);
    const tax = 0; // Calculate tax if needed
    const total = subtotal + tax - discount;

    const orderData = {
      customerId: selectedCustomerId,
      contactId: selectedContactId || null,
      status,
      priority,
      dueDate: dueDate ? new Date(dueDate) : null,
      promisedDate: promisedDate ? new Date(promisedDate) : null,
      discount: Number(discount),
      notesInternal: notesInternal || null,
      lineItems: lineItems.map(item => ({
        productId: item.productId,
        productVariantId: item.productVariantId,
        productType: item.productType,
        description: item.description,
        width: item.width,
        height: item.height,
        quantity: item.quantity,
        sqft: item.sqft,
        unitPrice: Number(item.unitPrice),
        totalPrice: Number(item.totalPrice),
        status: item.status,
        specsJson: item.specsJson,
      })),
    };

    createOrderMutation.mutate(orderData);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  const subtotal = lineItems.reduce((sum, item) => sum + item.totalPrice, 0);
  const tax = 0;
  const total = subtotal + tax - discount;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Order</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Customer Selection */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Customer Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <CustomerSelect
                      value={selectedCustomerId}
                      onChange={(customerId, customer, contactId) => {
                        setSelectedCustomerId(customerId || "");
                        setSelectedCustomer(customer);
                        setSelectedContactId(contactId || "");
                      }}
                      autoFocus={true}
                      label="Customer *"
                      placeholder="Search customers by name, email, or contact..."
                    />
                  </div>

                  <div>
                    <Label htmlFor="contactId">Contact</Label>
                    <Select value={selectedContactId} onValueChange={setSelectedContactId} disabled={!selectedCustomerId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select contact (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        {contacts?.map((contact) => (
                          <SelectItem key={contact.id} value={contact.id}>
                            {contact.firstName} {contact.lastName}
                            {contact.email && ` - ${contact.email}`}
                            {contact.isPrimary && " (Primary)"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Order Details */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Order Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="status">Status</Label>
                    <Select value={status} onValueChange={setStatus}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new">New</SelectItem>
                        <SelectItem value="scheduled">Scheduled</SelectItem>
                        <SelectItem value="in_production">In Production</SelectItem>
                        <SelectItem value="ready_for_pickup">Ready for Pickup</SelectItem>
                        <SelectItem value="shipped">Shipped</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="on_hold">On Hold</SelectItem>
                        <SelectItem value="canceled">Canceled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="priority">Priority</Label>
                    <Select value={priority} onValueChange={setPriority}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rush">Rush</SelectItem>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="dueDate">Due Date</Label>
                    <Input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                    />
                  </div>

                  <div>
                    <Label htmlFor="promisedDate">Promised Date</Label>
                    <Input
                      type="date"
                      value={promisedDate}
                      onChange={(e) => setPromisedDate(e.target.value)}
                    />
                  </div>

                  <div>
                    <Label htmlFor="discount">Discount Amount</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={discount}
                      onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="notesInternal">Internal Notes</Label>
                  <Textarea
                    value={notesInternal}
                    onChange={(e) => setNotesInternal(e.target.value)}
                    placeholder="Add internal notes about this order..."
                    rows={3}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Line Items */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Line Items</CardTitle>
                  <Button type="button" size="sm" onClick={() => setShowItemDialog(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Item
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {lineItems.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>No line items added yet</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => setShowItemDialog(true)} className="mt-2">
                      <Plus className="w-4 h-4 mr-2" />
                      Add First Item
                    </Button>
                  </div>
                ) : (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product</TableHead>
                          <TableHead>Specs</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Unit Price</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lineItems.map((item) => (
                          <TableRow key={item.tempId}>
                            <TableCell>{item.description}</TableCell>
                            <TableCell>
                              {item.width && item.height ? (
                                <span>{item.width}" × {item.height}"</span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">{item.quantity}</TableCell>
                            <TableCell className="text-right">{formatCurrency(item.unitPrice)}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(item.totalPrice)}</TableCell>
                            <TableCell className="text-right">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditLineItem(item)}
                                className="mr-1"
                              >
                                Edit
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteLineItem(item.tempId)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>

                    {/* Totals */}
                    <div className="mt-4 space-y-2 text-right">
                      <div className="flex justify-end gap-4">
                        <span className="text-muted-foreground">Subtotal:</span>
                        <span className="font-medium">{formatCurrency(subtotal)}</span>
                      </div>
                      {discount > 0 && (
                        <div className="flex justify-end gap-4 text-red-500">
                          <span>Discount:</span>
                          <span>-{formatCurrency(discount)}</span>
                        </div>
                      )}
                      <div className="flex justify-end gap-4">
                        <span className="text-muted-foreground">Tax:</span>
                        <span className="font-medium">{formatCurrency(tax)}</span>
                      </div>
                      <div className="flex justify-end gap-4 text-lg font-bold border-t pt-2">
                        <span>Total:</span>
                        <span>{formatCurrency(total)}</span>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Form Actions */}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createOrderMutation.isPending || lineItems.length === 0}>
                {createOrderMutation.isPending ? "Creating..." : "Create Order"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Line Item Dialog */}
      <Dialog open={showItemDialog} onOpenChange={setShowItemDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingItemId ? "Edit Line Item" : "Add Line Item"}</DialogTitle>
            <CardDescription>Configure product and pricing will calculate automatically</CardDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Product *</Label>
                <Select value={selectedProductId} onValueChange={(value) => {
                  setSelectedProductId(value);
                  setSelectedVariantId(null);
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select product" />
                  </SelectTrigger>
                  <SelectContent>
                    {products?.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Variant {variants && variants.length > 0 && "*"}</Label>
                <Select 
                  value={selectedVariantId || "_none"} 
                  onValueChange={(value) => setSelectedVariantId(value === "_none" ? null : value)}
                  disabled={!selectedProductId || !variants?.length}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select variant" />
                  </SelectTrigger>
                  <SelectContent>
                    {(!variants || variants.length === 0) && <SelectItem value="_none">None</SelectItem>}
                    {variants?.map((variant) => (
                      <SelectItem key={variant.id} value={variant.id}>
                        {variant.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Width (inches) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={width}
                  onChange={(e) => setWidth(e.target.value)}
                  placeholder="0.00"
                />
              </div>

              <div>
                <Label>Height (inches) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                  placeholder="0.00"
                />
              </div>

              <div>
                <Label>Quantity *</Label>
                <Input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
            </div>

            {/* Product Options Selection - Inline options from product.optionsJson */}
            {selectedProduct && productOptionsInline && productOptionsInline.length > 0 && (
              <div className="space-y-3 border-t pt-4">
                <Label className="text-base font-semibold">Product Options</Label>
                {[...productOptionsInline]
                  .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
                  .map((option) => {
                    const selection = optionSelections[option.id];
                    const isSelected = !!selection;

                    return (
                      <div key={option.id} className="space-y-2 p-3 border rounded-md">
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
                            {/* Spacing selector for banners (if spacingOptions defined) */}
                            {option.config.spacingOptions && option.config.spacingOptions.length > 0 && (
                              <div className="space-y-1">
                                <Label className="text-sm">Grommet Spacing</Label>
                                <Select
                                  value={String(selection?.grommetsSpacingInches || option.config.defaultSpacingInches || 24)}
                                  onValueChange={(val) => {
                                    const inches = parseInt(val);
                                    setOptionSelections(prev => ({
                                      ...prev,
                                      [option.id]: {
                                        ...prev[option.id],
                                        grommetsSpacingInches: inches
                                      }
                                    }));
                                  }}
                                >
                                  <SelectTrigger className="w-48">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {option.config.spacingOptions.map((opt: { value: number; label: string }) => (
                                      <SelectItem key={opt.value} value={String(opt.value)}>
                                        {opt.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}

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
                            </div>

                            <Label className="text-sm">Grommet Location</Label>
                            <Select
                              value={selection?.grommetsLocation || option.config.defaultLocation || "all_corners"}
                              onValueChange={(val) => {
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
                              <SelectTrigger className="w-48">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all_corners">All Corners</SelectItem>
                                <SelectItem value="top_corners">Top Corners Only</SelectItem>
                                <SelectItem value="top_even">Top Edge (Even Spacing)</SelectItem>
                                <SelectItem value="custom">Custom Placement</SelectItem>
                              </SelectContent>
                            </Select>

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
                              </div>
                            )}
                          </div>
                        )}

                        {/* Hems option (banner finishing) */}
                        {option.config?.kind === "hems" && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label>{option.label}</Label>
                              {option.amount !== undefined && option.amount !== null && (
                                <Badge variant="secondary">
                                  {formatOptionPriceLabel(option)}
                                </Badge>
                              )}
                            </div>
                            <Select
                              value={selection?.hemsType || option.config.defaultHems || "none"}
                              onValueChange={(val) => {
                                setOptionSelections(prev => ({
                                  ...prev,
                                  [option.id]: { 
                                    ...prev[option.id],
                                    value: val !== "none",
                                    hemsType: val
                                  }
                                }));
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {option.config.hemsChoices?.map((choice: { value: string; label: string }) => (
                                  <SelectItem key={choice.value} value={choice.value}>
                                    {choice.label}
                                  </SelectItem>
                                )) || (
                                  <>
                                    <SelectItem value="none">None</SelectItem>
                                    <SelectItem value="all_sides">All Sides</SelectItem>
                                    <SelectItem value="top_bottom">Top & Bottom Only</SelectItem>
                                    <SelectItem value="left_right">Left & Right Only</SelectItem>
                                  </>
                                )}
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {/* Pole Pockets option (banner finishing) */}
                        {option.config?.kind === "pole_pockets" && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label>{option.label}</Label>
                              {option.amount !== undefined && option.amount !== null && (
                                <Badge variant="secondary">
                                  {formatOptionPriceLabel(option)}
                                </Badge>
                              )}
                            </div>
                            <Select
                              value={selection?.polePocket || option.config.defaultPolePocket || "none"}
                              onValueChange={(val) => {
                                setOptionSelections(prev => ({
                                  ...prev,
                                  [option.id]: { 
                                    ...prev[option.id],
                                    value: val !== "none",
                                    polePocket: val
                                  }
                                }));
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {option.config.polePocketChoices?.map((choice: { value: string; label: string }) => (
                                  <SelectItem key={choice.value} value={choice.value}>
                                    {choice.label}
                                  </SelectItem>
                                )) || (
                                  <>
                                    <SelectItem value="none">None</SelectItem>
                                    <SelectItem value="top">Top Only</SelectItem>
                                    <SelectItem value="bottom">Bottom Only</SelectItem>
                                    <SelectItem value="top_bottom">Top & Bottom</SelectItem>
                                  </>
                                )}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}

            {/* Calculated Price Display */}
            {calculatedPrice !== null && !priceOverrideMode && (
              <div className="rounded-lg border p-4 bg-muted/50">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium flex items-center gap-2">
                    <Calculator className="w-4 h-4" />
                    Calculated Unit Price:
                  </span>
                  <span className="text-xl font-bold">{formatCurrency(calculatedPrice)}</span>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  Total for {quantity} item(s): {formatCurrency(calculatedPrice * parseInt(quantity || "1"))}
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
                    value={unitPrice}
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
                    placeholder={calculatedPrice ? (calculatedPrice * parseInt(quantity || "1")).toFixed(2) : "0.00"}
                    value={totalPrice}
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
                  <span className="font-medium">${parseFloat(unitPrice || "0").toFixed(2)} each</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-muted-foreground">Quantity:</span>
                  <span className="font-medium">{quantity} item(s)</span>
                </div>
                <div className="flex justify-between text-sm font-semibold mt-2 pt-2 border-t">
                  <span>Line Total:</span>
                  <span>${parseFloat(totalPrice || "0").toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowItemDialog(false);
                setEditingItemId(null);
                setSelectedProductId("");
                setSelectedVariantId(null);
                setWidth("");
                setHeight("");
                setQuantity("1");
                setCalculatedPrice(null);
                setPriceOverrideMode(null);
                setUnitPrice("");
                setTotalPrice("");
                setOptionSelections({});
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleAddLineItem}
              disabled={!selectedProductId}
            >
              {editingItemId ? "Update Item" : "Add Item"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
