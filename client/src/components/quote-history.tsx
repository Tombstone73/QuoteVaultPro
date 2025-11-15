import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { FileText, Search } from "lucide-react";
import { format } from "date-fns";
import type { Quote, Product, QuoteWithRelations } from "@shared/schema";

export default function QuoteHistory() {
  const [searchCustomer, setSearchCustomer] = useState("");
  const [searchProduct, setSearchProduct] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");

  const { data: quotes, isLoading } = useQuery<QuoteWithRelations[]>({
    queryKey: [
      "/api/quotes",
      { searchCustomer, searchProduct, startDate, endDate, minPrice, maxPrice }
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchCustomer) params.set("searchCustomer", searchCustomer);
      if (searchProduct && searchProduct !== "all") params.set("searchProduct", searchProduct);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (minPrice) params.set("minPrice", minPrice);
      if (maxPrice) params.set("maxPrice", maxPrice);

      const url = `/api/quotes${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await fetch(url, { credentials: "include" });
      
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text}`);
      }
      
      return response.json();
    },
  });

  const { data: products } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const handleClearFilters = () => {
    setSearchCustomer("");
    setSearchProduct("all");
    setStartDate("");
    setEndDate("");
    setMinPrice("");
    setMaxPrice("");
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card data-testid="card-filters">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="w-5 h-5" />
            Filter Quotes
          </CardTitle>
          <CardDescription>Search and filter your quote history</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="searchCustomer" data-testid="label-filter-customer">Customer Name</Label>
              <Input
                id="searchCustomer"
                placeholder="Search by customer"
                value={searchCustomer}
                onChange={(e) => setSearchCustomer(e.target.value)}
                data-testid="input-filter-customer"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="searchProduct" data-testid="label-filter-product">Product Type</Label>
              <Select value={searchProduct} onValueChange={setSearchProduct}>
                <SelectTrigger id="searchProduct" data-testid="select-filter-product">
                  <SelectValue placeholder="All products" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" data-testid="option-filter-all-products">All products</SelectItem>
                  {products?.map((product) => (
                    <SelectItem key={product.id} value={product.id} data-testid={`option-filter-product-${product.id}`}>
                      {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="startDate" data-testid="label-filter-start-date">Start Date</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                data-testid="input-filter-start-date"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="endDate" data-testid="label-filter-end-date">End Date</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                data-testid="input-filter-end-date"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="minPrice" data-testid="label-filter-min-price">Min Price</Label>
              <Input
                id="minPrice"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                data-testid="input-filter-min-price"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxPrice" data-testid="label-filter-max-price">Max Price</Label>
              <Input
                id="maxPrice"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                data-testid="input-filter-max-price"
              />
            </div>
          </div>

          <Button variant="outline" onClick={handleClearFilters} data-testid="button-clear-filters">
            Clear Filters
          </Button>
        </CardContent>
      </Card>

      <Card data-testid="card-quote-list">
        <CardHeader>
          <CardTitle>Your Quotes</CardTitle>
          <CardDescription>
            {quotes?.length ?? 0} quote{quotes?.length !== 1 ? 's' : ''} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!quotes || quotes.length === 0 ? (
            <div className="py-16 text-center" data-testid="empty-state-quotes">
              <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground mb-2">No quotes found</p>
              <p className="text-sm text-muted-foreground">
                {searchCustomer || searchProduct || startDate || endDate || minPrice || maxPrice
                  ? "Try adjusting your filters"
                  : "Create your first quote using the calculator"}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead data-testid="header-date">Date</TableHead>
                    <TableHead data-testid="header-customer">Customer</TableHead>
                    <TableHead data-testid="header-product">Product</TableHead>
                    <TableHead data-testid="header-dimensions">Dimensions</TableHead>
                    <TableHead data-testid="header-quantity">Quantity</TableHead>
                    <TableHead data-testid="header-options">Options</TableHead>
                    <TableHead data-testid="header-price" className="text-right">Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quotes.map((quote) => (
                    <TableRow key={quote.id} data-testid={`row-quote-${quote.id}`}>
                      <TableCell data-testid={`cell-date-${quote.id}`}>
                        {format(new Date(quote.createdAt), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell data-testid={`cell-customer-${quote.id}`}>
                        {quote.customerName || (
                          <span className="text-muted-foreground italic">Not specified</span>
                        )}
                      </TableCell>
                      <TableCell data-testid={`cell-product-${quote.id}`}>
                        <div className="space-y-0.5">
                          <div>{quote.product.name}</div>
                          {quote.variantName && (
                            <div className="text-xs text-muted-foreground" data-testid={`text-variant-${quote.id}`}>
                              {quote.product.variantLabel || "Variant"}: {quote.variantName}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell data-testid={`cell-dimensions-${quote.id}`}>
                        {quote.width}" × {quote.height}"
                      </TableCell>
                      <TableCell data-testid={`cell-quantity-${quote.id}`}>
                        {quote.quantity}
                      </TableCell>
                      <TableCell data-testid={`cell-options-${quote.id}`}>
                        {quote.selectedOptions && quote.selectedOptions.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {quote.selectedOptions.map((opt: any, idx: number) => {
                              const cost = opt.calculatedCost ?? 0;
                              const displayValue = typeof opt.value === 'boolean' ? (opt.value ? 'Yes' : 'No') : opt.value;
                              return (
                                <Badge 
                                  key={idx} 
                                  variant="secondary" 
                                  className="text-xs"
                                  data-testid={`badge-option-${quote.id}-${idx}`}
                                >
                                  {opt.optionName}: {displayValue} (+${cost.toFixed(2)})
                                </Badge>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm italic">None</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono" data-testid={`cell-price-${quote.id}`}>
                        ${parseFloat(quote.calculatedPrice).toFixed(2)}
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
  );
}
