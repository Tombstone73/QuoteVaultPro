import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Calculator as CalcIcon, ExternalLink, Save } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Product, InsertQuote } from "@shared/schema";

const ADD_ON_OPTIONS = [
  { id: "rush", label: "Rush Processing (+$25)" },
  { id: "glossy", label: "Glossy Finish (+$15)" },
  { id: "premium", label: "Premium Paper (+$20)" },
];

export default function CalculatorComponent() {
  const { toast } = useToast();
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [width, setWidth] = useState<string>("");
  const [height, setHeight] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("");
  const [customerName, setCustomerName] = useState<string>("");
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const [calculatedPrice, setCalculatedPrice] = useState<number | null>(null);
  const [priceBreakdown, setPriceBreakdown] = useState<any>(null);

  const { data: products, isLoading: productsLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const selectedProduct = products?.find(p => p.id === selectedProductId);

  const calculateMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/quotes/calculate", {
        productId: selectedProductId,
        width: parseFloat(width),
        height: parseFloat(height),
        quantity: parseInt(quantity),
        addOns: selectedAddOns,
      });
      return response;
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
      if (!calculatedPrice || !priceBreakdown) return;
      
      const quoteData: Omit<InsertQuote, 'userId'> = {
        productId: selectedProductId,
        customerName: customerName || undefined,
        width: width,
        height: height,
        quantity: quantity,
        addOns: selectedAddOns,
        calculatedPrice: calculatedPrice.toString(),
        priceBreakdown,
      };

      return await apiRequest("POST", "/api/quotes", quoteData);
    },
    onSuccess: () => {
      toast({
        title: "Quote Saved",
        description: "Your quote has been saved successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      setCustomerName("");
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
    if (!selectedProductId || !width || !height || !quantity) {
      toast({
        title: "Missing Information",
        description: "Please fill in all required fields.",
        variant: "destructive",
      });
      return;
    }
    calculateMutation.mutate();
  };

  const handleAddOnToggle = (addOnId: string) => {
    setSelectedAddOns(prev =>
      prev.includes(addOnId)
        ? prev.filter(id => id !== addOnId)
        : [...prev, addOnId]
    );
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
            <div className="space-y-2">
              <Label htmlFor="product" data-testid="label-product">Product Type</Label>
              <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                <SelectTrigger id="product" data-testid="select-product">
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
            </div>

            {selectedProduct && (
              <div className="p-4 bg-muted rounded-md space-y-2" data-testid="product-description">
                <p className="text-sm text-muted-foreground">{selectedProduct.description}</p>
                {selectedProduct.storeUrl && (
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
                  onChange={(e) => setWidth(e.target.value)}
                  data-testid="input-width"
                />
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
                  onChange={(e) => setHeight(e.target.value)}
                  data-testid="input-height"
                />
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
                onChange={(e) => setQuantity(e.target.value)}
                data-testid="input-quantity"
              />
            </div>

            <div className="space-y-2">
              <Label data-testid="label-addons">Add-ons (Optional)</Label>
              <div className="space-y-3">
                {ADD_ON_OPTIONS.map((addOn) => (
                  <div key={addOn.id} className="flex items-center gap-2">
                    <Checkbox
                      id={addOn.id}
                      checked={selectedAddOns.includes(addOn.id)}
                      onCheckedChange={() => handleAddOnToggle(addOn.id)}
                      data-testid={`checkbox-addon-${addOn.id}`}
                    />
                    <Label
                      htmlFor={addOn.id}
                      className="text-sm font-normal cursor-pointer"
                      data-testid={`label-addon-${addOn.id}`}
                    >
                      {addOn.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <Button
              onClick={handleCalculate}
              disabled={calculateMutation.isPending}
              className="w-full"
              data-testid="button-calculate"
            >
              {calculateMutation.isPending ? "Calculating..." : "Calculate Price"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
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
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Base Price:</span>
                    <span className="font-mono" data-testid="text-base-price">
                      ${priceBreakdown.basePrice.toFixed(2)}
                    </span>
                  </div>
                  {priceBreakdown.addOnsPrice > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Add-ons:</span>
                      <span className="font-mono" data-testid="text-addons-price">
                        ${priceBreakdown.addOnsPrice.toFixed(2)}
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
              <CardFooter>
                <Button
                  onClick={() => saveQuoteMutation.mutate()}
                  disabled={saveQuoteMutation.isPending}
                  className="w-full"
                  data-testid="button-save-quote"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {saveQuoteMutation.isPending ? "Saving..." : "Save Quote"}
                </Button>
              </CardFooter>
            </Card>
          </>
        )}

        {calculatedPrice === null && (
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
