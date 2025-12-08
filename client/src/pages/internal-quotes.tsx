import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { ROUTES } from "@/config/routes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FileText,
  Plus,
  Edit,
  Package,
  Eye,
  User,
  ArrowLeft,
  ChevronUp,
  ChevronDown,
  Check,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useConvertQuoteToOrder } from "@/hooks/useOrders";
import { QuoteSourceBadge } from "@/components/quote-source-badge";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import {
  Page,
  PageHeader,
  ContentLayout,
  FilterPanel,
  DataCard,
  ColumnConfig,
  useColumnSettings,
  isColumnVisible,
  type ColumnDefinition,
} from "@/components/titan";
import type { QuoteWithRelations, Product } from "@shared/schema";

type SortKey = "date" | "quoteNumber" | "customer" | "total" | "items" | "source" | "createdBy" | "label";

// Column definitions for quotes table
const QUOTE_COLUMNS: ColumnDefinition[] = [
  { key: "quoteNumber", label: "Quote #", defaultVisible: true, defaultWidth: 100, minWidth: 80, maxWidth: 150, sortable: true },
  { key: "label", label: "Label", defaultVisible: true, defaultWidth: 150, minWidth: 100, maxWidth: 250, sortable: true },
  { key: "date", label: "Date", defaultVisible: true, defaultWidth: 110, minWidth: 90, maxWidth: 150, sortable: true },
  { key: "customer", label: "Customer", defaultVisible: true, defaultWidth: 180, minWidth: 120, maxWidth: 300, sortable: true },
  { key: "items", label: "Items", defaultVisible: true, defaultWidth: 80, minWidth: 60, maxWidth: 120, sortable: true },
  { key: "source", label: "Source", defaultVisible: true, defaultWidth: 100, minWidth: 80, maxWidth: 150, sortable: true },
  { key: "createdBy", label: "Created By", defaultVisible: true, defaultWidth: 140, minWidth: 100, maxWidth: 200, sortable: true },
  { key: "total", label: "Total", defaultVisible: true, defaultWidth: 110, minWidth: 80, maxWidth: 150, sortable: true, align: "right" },
  { key: "actions", label: "Actions", defaultVisible: true, defaultWidth: 200, minWidth: 150, maxWidth: 280 },
];

function NewQuoteButton() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const createDraftQuote = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/quotes", { status: "draft" });
      return res.json();
    },
    onError: (err: any) => {
      toast({
        title: "Failed to create draft quote",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <Button
      size="sm"
      disabled={createDraftQuote.isPending}
      onClick={async () => {
        try {
          const result = await createDraftQuote.mutateAsync();
          const id = result?.id || result?.data?.id;
          if (!id) throw new Error("Draft quote creation did not return an id");
          navigate(ROUTES.quotes.edit(id));
        } catch (err) {
          console.error("Create draft quote failed", err);
          // toast handled in onError
        }
      }}
    >
      {createDraftQuote.isPending ? (
        <span className="flex items-center gap-2">
          <Plus className="mr-2 h-4 w-4 animate-spin" />
          Creating...
        </span>
      ) : (
        <>
          <Plus className="mr-2 h-4 w-4" />
          New Quote
        </>
      )}
    </Button>
  );
}

export default function InternalQuotes() {
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [searchCustomer, setSearchCustomer] = useState("");
  const [searchProduct, setSearchProduct] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [orderDueDate, setOrderDueDate] = useState("");
  const [orderPromisedDate, setOrderPromisedDate] = useState("");
  const [orderPriority, setOrderPriority] =
    useState<"normal" | "rush" | "low">("normal");
  const [orderNotes, setOrderNotes] = useState("");
  
  // Column settings
  const [columnSettings, setColumnSettings] = useColumnSettings(QUOTE_COLUMNS, "quotes_column_settings");
  
  // Sorting state
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  
  // Inline editing state for label
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [tempLabel, setTempLabel] = useState("");

  const convertToOrder = useConvertQuoteToOrder();

  const createDraftQuote = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/quotes", { status: "draft" });
      return res.json();
    },
    onError: (err: any) => {
      toast({
        title: "Failed to create draft quote",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  // Check if user is internal staff
  const isInternalUser =
    user && ["admin", "owner", "manager", "employee"].includes(user.role || "");
  
  // Helper to get column width style
  const getColStyle = (key: string) => {
    const settings = columnSettings[key];
    if (!settings?.visible) return { display: "none" as const };
    return { width: settings.width, minWidth: settings.width };
  };
  
  // Helper to check column visibility
  const isVisible = (key: string) => isColumnVisible(columnSettings, key);
  
  // Count visible columns for colspan
  const visibleColumnCount = QUOTE_COLUMNS.filter(col => isVisible(col.key)).length;

  const { data: quotes, isLoading } = useQuery<QuoteWithRelations[]>({
    queryKey: [
      "/api/quotes",
      { source: "internal", searchCustomer, searchProduct, startDate, endDate },
    ],
    queryFn: async () => {
      const params = new URLSearchParams({ source: "internal" });
      if (searchCustomer) params.set("searchCustomer", searchCustomer);
      if (searchProduct && searchProduct !== "all")
        params.set("searchProduct", searchProduct);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);

      const url = `/api/quotes${
        params.toString() ? `?${params.toString()}` : ""
      }`;
      const response = await fetch(url, { credentials: "include" });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text}`);
      }

      return response.json();
    },
    enabled: isInternalUser,
  });

  const { data: products } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  // Sorted quotes
  const sortedQuotes = useMemo(() => {
    if (!quotes) return [];
    return [...quotes].sort((a: any, b: any) => {
      let comparison = 0;
      switch (sortKey) {
        case "date":
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case "quoteNumber":
          comparison = (a.quoteNumber || "").toString().localeCompare((b.quoteNumber || "").toString(), undefined, { numeric: true });
          break;
        case "label":
          comparison = (a.label || "").localeCompare(b.label || "");
          break;
        case "customer":
          const customerA = a.customerName || "";
          const customerB = b.customerName || "";
          comparison = customerA.localeCompare(customerB);
          break;
        case "total":
          comparison = parseFloat(a.totalPrice || "0") - parseFloat(b.totalPrice || "0");
          break;
        case "items":
          const itemsA = a.lineItems?.length || 0;
          const itemsB = b.lineItems?.length || 0;
          comparison = itemsA - itemsB;
          break;
        case "source":
          const sourceA = a.source || "";
          const sourceB = b.source || "";
          comparison = sourceA.localeCompare(sourceB);
          break;
        case "createdBy":
          const userA = a.user ? `${a.user.firstName || ""} ${a.user.lastName || ""}`.trim() || a.user.email : "";
          const userB = b.user ? `${b.user.firstName || ""} ${b.user.lastName || ""}`.trim() || b.user.email : "";
          comparison = userA.localeCompare(userB);
          break;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [quotes, sortKey, sortDirection]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      // Default direction based on column type
      setSortDirection(key === "customer" || key === "quoteNumber" || key === "source" || key === "createdBy" || key === "label" ? "asc" : "desc");
    }
  };

  const SortIcon = ({ columnKey }: { columnKey: SortKey }) => {
    if (sortKey !== columnKey) return null;
    return sortDirection === "asc" 
      ? <ChevronUp className="inline w-4 h-4 ml-1" />
      : <ChevronDown className="inline w-4 h-4 ml-1" />;
  };

  // Handle label edit
  const handleStartLabelEdit = (quoteId: string, currentLabel: string) => {
    setEditingQuoteId(quoteId);
    setTempLabel(currentLabel || "");
  };

  const handleSaveLabel = async (quoteId: string) => {
    try {
      const response = await fetch(`/api/quotes/${quoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: tempLabel }),
        credentials: 'include',
      });

      if (!response.ok) throw new Error('Failed to update quote');

      toast({
        title: "Success",
        description: "Quote label updated",
      });

      // Refresh quotes list
      window.location.reload();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update quote label",
        variant: "destructive",
      });
    } finally {
      setEditingQuoteId(null);
      setTempLabel("");
    }
  };

  const handleCancelLabelEdit = () => {
    setEditingQuoteId(null);
    setTempLabel("");
  };

  const handleClearFilters = () => {
    setSearchCustomer("");
    setSearchProduct("all");
    setStartDate("");
    setEndDate("");
  };

  const handleConvertToOrder = (quoteId: string) => {
    setSelectedQuoteId(quoteId);
    setConvertDialogOpen(true);
  };

  const handleConfirmConvert = async () => {
    if (!selectedQuoteId) return;

    const quote = quotes?.find((q) => q.id === selectedQuoteId);
    console.log("[INTERNAL QUOTES] Converting quote to order:", {
      quoteId: selectedQuoteId,
      quoteNumber: quote?.quoteNumber,
      customerId: quote?.customerId,
      contactId: quote?.contactId,
      source: quote?.source,
    });

    try {
      const result = await convertToOrder.mutateAsync({
        quoteId: selectedQuoteId,
        dueDate: orderDueDate || undefined,
        promisedDate: orderPromisedDate || undefined,
        priority: orderPriority,
        notesInternal: orderNotes || undefined,
      });

      console.log("[INTERNAL QUOTES] Quote converted successfully:", result);

      setConvertDialogOpen(false);
      setSelectedQuoteId(null);
      setOrderDueDate("");
      setOrderPromisedDate("");
      setOrderPriority("normal");
      setOrderNotes("");

      toast({
        title: "Success",
        description: `Quote ${quote?.quoteNumber} converted to order ${result?.orderNumber}`,
      });

      if (result?.id) {
        navigate(ROUTES.orders.detail(result.id));
      }
    } catch (error) {
      console.error("[INTERNAL QUOTES] Conversion error:", error);
      toast({
        title: "Error Converting Quote",
        description:
          error instanceof Error
            ? error.message
            : "Failed to convert quote to order. Please try again.",
        variant: "destructive",
      });
    }
  };

  if (!isInternalUser) {
    return (
      <Page>
        <DataCard>
          <div className="py-16 text-center">
            <p className="text-muted-foreground">
              Access denied. This page is for internal staff only.
            </p>
          </div>
        </DataCard>
      </Page>
    );
  }

  if (isLoading) {
    return (
      <Page>
        <ContentLayout>
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-96 w-full" />
        </ContentLayout>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Internal Quotes"
        subtitle="Manage internal quotes and convert them to orders"
        className="pb-3"
        backButton={
          <Button variant="ghost" size="sm" onClick={() => navigate(ROUTES.dashboard)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        }
        actions={
          <NewQuoteButton />
        }
      />

      <ContentLayout className="space-y-3">
        {/* Inline Filters */}
        <div className="flex flex-row items-center gap-3 flex-wrap">
          <Input
            placeholder="Search customers..."
            value={searchCustomer}
            onChange={(e) => setSearchCustomer(e.target.value)}
            className="flex-1 min-w-[200px] h-9"
          />
          <Select value={searchProduct} onValueChange={setSearchProduct}>
            <SelectTrigger className="w-[180px] h-9">
              <SelectValue placeholder="All Products" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Products</SelectItem>
              {products?.map((product) => (
                <SelectItem key={product.id} value={product.id}>
                  {product.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            placeholder="Start date"
            className="w-[140px] h-9"
          />
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            placeholder="End date"
            className="w-[140px] h-9"
          />
        </div>

        {/* Quotes List */}
        <DataCard
          title="Internal Quotes"
          description={`${quotes?.length ?? 0} quote${
            quotes?.length !== 1 ? "s" : ""
          } found`}
          className="mt-0"
          headerActions={
            <ColumnConfig
              columns={QUOTE_COLUMNS}
              storageKey="quotes_column_settings"
              settings={columnSettings}
              onSettingsChange={setColumnSettings}
            />
          }
        >
          {!quotes || quotes.length === 0 ? (
            <div className="py-8 text-center">
              <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <p className="mb-2 text-muted-foreground">No quotes found</p>
              <p className="mb-4 text-sm text-muted-foreground">
                {searchCustomer || searchProduct || startDate || endDate
                  ? "Try adjusting your filters"
                  : "Create your first internal quote"}
              </p>
              <NewQuoteButton />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="table-dense">
                <TableHeader>
                  <TableRow>
                    {isVisible("quoteNumber") && (
                      <TableHead 
                        className="cursor-pointer hover:bg-muted/50 select-none"
                        style={getColStyle("quoteNumber")}
                        onClick={() => handleSort("quoteNumber")}
                      >
                        Quote #<SortIcon columnKey="quoteNumber" />
                      </TableHead>
                    )}
                    {isVisible("label") && (
                      <TableHead 
                        className="cursor-pointer hover:bg-muted/50 select-none"
                        style={getColStyle("label")}
                        onClick={() => handleSort("label")}
                      >
                        Label<SortIcon columnKey="label" />
                      </TableHead>
                    )}
                    {isVisible("date") && (
                      <TableHead 
                        className="cursor-pointer hover:bg-muted/50 select-none"
                        style={getColStyle("date")}
                        onClick={() => handleSort("date")}
                      >
                        Date<SortIcon columnKey="date" />
                      </TableHead>
                    )}
                    {isVisible("customer") && (
                      <TableHead 
                        className="cursor-pointer hover:bg-muted/50 select-none"
                        style={getColStyle("customer")}
                        onClick={() => handleSort("customer")}
                      >
                        Customer<SortIcon columnKey="customer" />
                      </TableHead>
                    )}
                    {isVisible("items") && (
                      <TableHead 
                        className="cursor-pointer hover:bg-muted/50 select-none"
                        style={getColStyle("items")}
                        onClick={() => handleSort("items")}
                      >
                        Items<SortIcon columnKey="items" />
                      </TableHead>
                    )}
                    {isVisible("source") && (
                      <TableHead 
                        className="cursor-pointer hover:bg-muted/50 select-none"
                        style={getColStyle("source")}
                        onClick={() => handleSort("source")}
                      >
                        Source<SortIcon columnKey="source" />
                      </TableHead>
                    )}
                    {isVisible("createdBy") && (
                      <TableHead 
                        className="cursor-pointer hover:bg-muted/50 select-none"
                        style={getColStyle("createdBy")}
                        onClick={() => handleSort("createdBy")}
                      >
                        Created By<SortIcon columnKey="createdBy" />
                      </TableHead>
                    )}
                    {isVisible("total") && (
                      <TableHead 
                        className="text-right cursor-pointer hover:bg-muted/50 select-none"
                        style={getColStyle("total")}
                        onClick={() => handleSort("total")}
                      >
                        Total<SortIcon columnKey="total" />
                      </TableHead>
                    )}
                    {isVisible("actions") && (
                      <TableHead style={getColStyle("actions")}>Actions</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedQuotes.map((quote) => (
                    <TableRow
                      key={quote.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(ROUTES.quotes.detail(quote.id))}
                    >
                      {isVisible("quoteNumber") && (
                        <TableCell style={getColStyle("quoteNumber")}>
                          <span className="font-mono text-titan-accent hover:text-titan-accent-hover hover:underline cursor-pointer">
                            {quote.quoteNumber || "N/A"}
                          </span>
                        </TableCell>
                      )}
                      {isVisible("label") && (
                        <TableCell 
                          style={getColStyle("label")}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {editingQuoteId === quote.id ? (
                            <div className="flex items-center gap-1">
                              <Input
                                value={tempLabel}
                                onChange={(e) => setTempLabel(e.target.value)}
                                className="h-8 w-[130px]"
                                placeholder="Enter label..."
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveLabel(quote.id);
                                  if (e.key === 'Escape') handleCancelLabelEdit();
                                }}
                              />
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleSaveLabel(quote.id)}>
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCancelLabelEdit}>
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <div 
                              className="cursor-pointer px-2 py-1 rounded hover:bg-muted/30"
                              onClick={() => handleStartLabelEdit(quote.id, (quote as any).label || '')}
                            >
                              {(quote as any).label ? (
                                <span className="text-sm">{(quote as any).label}</span>
                              ) : (
                                <span className="text-muted-foreground text-sm italic">
                                  Click to add...
                                </span>
                              )}
                            </div>
                          )}
                        </TableCell>
                      )}
                      {isVisible("date") && (
                        <TableCell style={getColStyle("date")}>
                          {format(new Date(quote.createdAt), "MMM d, yyyy")}
                        </TableCell>
                      )}
                      {isVisible("customer") && (
                        <TableCell
                          style={getColStyle("customer")}
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          {quote.customerId ? (
                            <Link to={ROUTES.customers.detail(quote.customerId)}>
                              <Button
                                variant="link"
                                className="h-auto p-0 font-normal"
                              >
                                {quote.customerName || "View Customer"}
                              </Button>
                            </Link>
                          ) : quote.customerName ? (
                            <span>{quote.customerName}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      )}
                      {isVisible("items") && (
                        <TableCell style={getColStyle("items")}>
                          <Badge variant="secondary">
                            {quote.lineItems?.length || 0} items
                          </Badge>
                        </TableCell>
                      )}
                      {isVisible("source") && (
                        <TableCell style={getColStyle("source")}>
                          <QuoteSourceBadge source={quote.source} />
                        </TableCell>
                      )}
                      {isVisible("createdBy") && (
                        <TableCell style={getColStyle("createdBy")}>
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm">
                              {quote.user
                                ? (
                                    `${quote.user.firstName || ""} ${
                                      quote.user.lastName || ""
                                    }`.trim() || quote.user.email
                                  )
                                : "—"}
                            </span>
                          </div>
                        </TableCell>
                      )}
                      {isVisible("total") && (
                        <TableCell className="text-right font-mono font-medium" style={getColStyle("total")}>
                          ${parseFloat(quote.totalPrice).toFixed(2)}
                        </TableCell>
                      )}
                      {isVisible("actions") && (
                        <TableCell
                          style={getColStyle("actions")}
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          <div className="flex gap-1 flex-nowrap">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => navigate(ROUTES.quotes.detail(quote.id))}
                              title="View quote"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                navigate(ROUTES.quotes.edit(quote.id))
                              }
                              title="Edit quote"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleConvertToOrder(quote.id)}
                              title="Convert to order"
                            >
                              <Package className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DataCard>
      </ContentLayout>

      {/* Convert to Order Dialog */}
      <Dialog open={convertDialogOpen} onOpenChange={setConvertDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert Quote to Order</DialogTitle>
            <DialogDescription>
              This will create a new order from the selected quote.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="dueDate">Due Date (Optional)</Label>
              <Input
                id="dueDate"
                type="date"
                value={orderDueDate}
                onChange={(e) => setOrderDueDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="promisedDate">Promised Date (Optional)</Label>
              <Input
                id="promisedDate"
                type="date"
                value={orderPromisedDate}
                onChange={(e) => setOrderPromisedDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select
                value={orderPriority}
                onValueChange={(value: any) => setOrderPriority(value)}
              >
                <SelectTrigger id="priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="rush">Rush</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Internal Notes (Optional)</Label>
              <Input
                id="notes"
                placeholder="Production notes, special instructions..."
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConvertDialogOpen(false);
                setSelectedQuoteId(null);
                setOrderDueDate("");
                setOrderPromisedDate("");
                setOrderPriority("normal");
                setOrderNotes("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmConvert}
              disabled={convertToOrder.isPending}
            >
              {convertToOrder.isPending ? "Creating..." : "Create Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
