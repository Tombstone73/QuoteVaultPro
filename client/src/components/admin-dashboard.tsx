import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, Download, FileText, Search, TrendingUp, Users, Edit } from "lucide-react";
import { format } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Product, User, QuoteWithRelations } from "@shared/schema";

export default function AdminDashboard() {
  const { toast } = useToast();
  const [searchUser, setSearchUser] = useState("");
  const [searchCustomer, setSearchCustomer] = useState("");
  const [searchProduct, setSearchProduct] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [minQuantity, setMinQuantity] = useState("");
  const [maxQuantity, setMaxQuantity] = useState("");

  const { data: allQuotes, isLoading: quotesLoading } = useQuery<QuoteWithRelations[]>({
    queryKey: [
      "/api/admin/quotes",
      { searchUser, searchCustomer, searchProduct, startDate, endDate, minQuantity, maxQuantity }
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchUser) params.set("searchUser", searchUser);
      if (searchCustomer) params.set("searchCustomer", searchCustomer);
      if (searchProduct && searchProduct !== "all") params.set("searchProduct", searchProduct);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (minQuantity) params.set("minQuantity", minQuantity);
      if (maxQuantity) params.set("maxQuantity", maxQuantity);

      const url = `/api/admin/quotes${params.toString() ? `?${params.toString()}` : ""}`;
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

  const handleExportCSV = async () => {
    try {
      const response = await fetch("/api/admin/quotes/export", {
        credentials: "include",
      });
      
      if (!response.ok) {
        throw new Error("Failed to export quotes");
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quotes-export-${format(new Date(), 'yyyy-MM-dd')}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Export Successful",
        description: "Quote data has been exported to CSV.",
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: error instanceof Error ? error.message : "Failed to export quotes",
        variant: "destructive",
      });
    }
  };

  const handleClearFilters = () => {
    setSearchUser("");
    setSearchCustomer("");
    setSearchProduct("all");
    setStartDate("");
    setEndDate("");
    setMinQuantity("");
    setMaxQuantity("");
  };

  const totalQuotes = allQuotes?.length ?? 0;
  const uniqueUsers = new Set(allQuotes?.map(q => q.userId)).size;
  const totalRevenue = allQuotes?.reduce((sum, q) => sum + parseFloat(q.totalPrice || "0"), 0) ?? 0;
  
  // Aggregate products from all line items across all quotes
  const topProduct = allQuotes?.reduce((acc, quote) => {
    quote.lineItems?.forEach(lineItem => {
      if (lineItem.product?.name) {
        acc[lineItem.product.name] = (acc[lineItem.product.name] || 0) + 1;
      }
    });
    return acc;
  }, {} as Record<string, number>);
  
  const mostPopularProduct = topProduct && Object.keys(topProduct).length > 0
    ? Object.entries(topProduct).sort((a, b) => b[1] - a[1])[0][0]
    : "N/A";

  if (quotesLoading) {
    return (
      <div className="space-y-6">
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card data-testid="card-metric-quotes">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Quotes</CardTitle>
            <FileText className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-quotes">{totalQuotes}</div>
            <p className="text-xs text-muted-foreground">Across all users</p>
          </CardContent>
        </Card>

        <Card data-testid="card-metric-users">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Users</CardTitle>
            <Users className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-active-users">{uniqueUsers}</div>
            <p className="text-xs text-muted-foreground">Users with quotes</p>
          </CardContent>
        </Card>

        <Card data-testid="card-metric-product">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Top Product</CardTitle>
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold truncate" data-testid="text-top-product">
              {mostPopularProduct}
            </div>
            <p className="text-xs text-muted-foreground">Most quoted</p>
          </CardContent>
        </Card>

        <Card data-testid="card-metric-revenue">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Value</CardTitle>
            <BarChart3 className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="text-total-revenue">
              ${totalRevenue.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground">All quotes combined</p>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-admin-filters">
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Search className="w-5 h-5" />
                Filter All Quotes
              </CardTitle>
              <CardDescription>Search across all users and quotes</CardDescription>
            </div>
            <Button onClick={handleExportCSV} data-testid="button-export-csv">
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="searchUser" data-testid="label-filter-user">User Email</Label>
              <Input
                id="searchUser"
                placeholder="Search by user"
                value={searchUser}
                onChange={(e) => setSearchUser(e.target.value)}
                data-testid="input-filter-user"
              />
            </div>

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
              <Label htmlFor="minQuantity" data-testid="label-filter-min-quantity">Min Quantity</Label>
              <Input
                id="minQuantity"
                type="number"
                placeholder="0"
                value={minQuantity}
                onChange={(e) => setMinQuantity(e.target.value)}
                data-testid="input-filter-min-quantity"
              />
            </div>
          </div>

          <Button variant="outline" onClick={handleClearFilters} data-testid="button-clear-filters">
            Clear Filters
          </Button>
        </CardContent>
      </Card>

      <Card data-testid="card-all-quotes">
        <CardHeader>
          <CardTitle>All System Quotes</CardTitle>
          <CardDescription>
            {allQuotes?.length ?? 0} quote{allQuotes?.length !== 1 ? 's' : ''} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!allQuotes || allQuotes.length === 0 ? (
            <div className="py-16 text-center" data-testid="empty-state-quotes">
              <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">No quotes found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead data-testid="header-date">Date</TableHead>
                    <TableHead data-testid="header-user">User</TableHead>
                    <TableHead data-testid="header-customer">Customer</TableHead>
                    <TableHead data-testid="header-products">Products</TableHead>
                    <TableHead data-testid="header-items">Line Items</TableHead>
                    <TableHead data-testid="header-price" className="text-right">Total Price</TableHead>
                    <TableHead data-testid="header-actions" className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allQuotes.map((quote) => {
                    const productNames = quote.lineItems?.map(item => item.product?.name).filter(Boolean) || [];
                    const uniqueProducts = Array.from(new Set(productNames));
                    
                    return (
                      <TableRow key={quote.id} data-testid={`row-quote-${quote.id}`}>
                        <TableCell data-testid={`cell-date-${quote.id}`}>
                          {format(new Date(quote.createdAt), 'MMM d, yyyy')}
                        </TableCell>
                        <TableCell data-testid={`cell-user-${quote.id}`}>
                          <div className="text-sm">
                            {quote.user.email || (
                              <span className="text-muted-foreground italic">No email</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell data-testid={`cell-customer-${quote.id}`}>
                          {quote.customerName || (
                            <span className="text-muted-foreground italic">Not specified</span>
                          )}
                        </TableCell>
                        <TableCell data-testid={`cell-products-${quote.id}`}>
                          <div className="text-sm">
                            {uniqueProducts.length > 0 ? (
                              <div className="space-y-1">
                                {uniqueProducts.slice(0, 2).map((name, idx) => (
                                  <div key={idx}>{name}</div>
                                ))}
                                {uniqueProducts.length > 2 && (
                                  <div className="text-muted-foreground">+{uniqueProducts.length - 2} more</div>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground italic">No items</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell data-testid={`cell-items-${quote.id}`}>
                          {quote.lineItems?.length || 0}
                        </TableCell>
                        <TableCell className="text-right font-mono" data-testid={`cell-price-${quote.id}`}>
                          ${parseFloat(quote.totalPrice || "0").toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right" data-testid={`cell-actions-${quote.id}`}>
                          <Link href={`/quotes/${quote.id}/edit`}>
                            <Button size="sm" variant="ghost" data-testid={`button-edit-quote-${quote.id}`}>
                              <Edit className="w-4 h-4" />
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
