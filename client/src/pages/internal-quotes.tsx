import { useState, useMemo, useEffect, Fragment } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Badge } from "@/components/ui/badge";
import { ConvertQuoteToOrderDialog } from "@/components/convert-quote-to-order-dialog";
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
  Loader2,
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useConvertQuoteToOrder } from "@/hooks/useOrders";
import { QuoteSourceBadge } from "@/components/quote-source-badge";
import { QuoteWorkflowBadge } from "@/components/QuoteWorkflowBadge";
import { useQuoteWorkflowState } from "@/hooks/useQuoteWorkflowState";
import { useAuth } from "@/hooks/useAuth";
import { useOrgPreferences } from "@/hooks/useOrgPreferences";
import {
  Page,
  PageHeader,
  ContentLayout,
  FilterPanel,
  DataCard,
  ColumnConfig,
  useColumnSettings,
  isColumnVisible,
  getColumnOrder,
  type ColumnDefinition,
  type ColumnState,
} from "@/components/titan";
import type { QuoteWithRelations, Product } from "@shared/schema";
import type { QuoteWorkflowState } from "@shared/quoteWorkflow";

type SortKey = "date" | "quoteNumber" | "customer" | "total" | "items" | "source" | "createdBy" | "label";

type QuoteRow = QuoteWithRelations & {
  label?: string | null;
  previewThumbnails?: string[];
  thumbsCount?: number;
};

// Column definitions for quotes table
const QUOTE_COLUMNS: ColumnDefinition[] = [
  { key: "quoteNumber", label: "Quote #", defaultVisible: true, defaultWidth: 100, minWidth: 80, maxWidth: 150, sortable: true },
  { key: "label", label: "Label", defaultVisible: true, defaultWidth: 150, minWidth: 100, maxWidth: 250, sortable: true },
  { key: "thumbnails", label: "Preview", defaultVisible: true, defaultWidth: 140, minWidth: 120, maxWidth: 200 },
  { key: "status", label: "Status", defaultVisible: true, defaultWidth: 110, minWidth: 90, maxWidth: 150 },
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

  return (
    <Button
      size="sm"
      onClick={() => {
        navigate(ROUTES.quotes.new);
      }}
    >
      <Plus className="mr-2 h-4 w-4" />
      New Quote
    </Button>
  );
}

export default function InternalQuotes() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { preferences, isLoading: prefsLoading } = useOrgPreferences();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [searchCustomer, setSearchCustomer] = useState("");
  const [searchProduct, setSearchProduct] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [statusFilter, setStatusFilter] = useState<QuoteWorkflowState | "all">("all");
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [orderDueDate, setOrderDueDate] = useState("");
  const [orderPromisedDate, setOrderPromisedDate] = useState("");
  const [orderPriority, setOrderPriority] = useState<"normal" | "rush" | "low">("normal");
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

  // Check if user is internal staff
  const isInternalUser =
    user && ["admin", "owner", "manager", "employee"].includes(user.role || "");
  
  // Check if approval workflow is enabled
  const requireApproval = preferences?.quotes?.requireApproval || false;
  
  // Helper to get column width style
  const getColStyle = (key: string) => {
    const raw = columnSettings[key];
    const settings: ColumnState | undefined =
      raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as ColumnState) : undefined;
    if (!settings?.visible) return { display: "none" as const };
    return { width: settings.width, minWidth: settings.width };
  };
  
  // Helper to check column visibility
  const isVisible = (key: string) => isColumnVisible(columnSettings, key);
  
  // Get ordered columns based on settings
  const orderedColumns = useMemo(
    () => getColumnOrder(QUOTE_COLUMNS, columnSettings),
    [columnSettings]
  );
  
  // Count visible columns for colspan
  const visibleColumnCount = orderedColumns.filter(col => isVisible(col.key)).length;

  const {
    data: quotes,
    isLoading,
    isFetching,
    error,
  } = useQuery<QuoteWithRelations[], Error>({
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
    enabled: !!user,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    retry: false,
    // @ts-expect-error onError is supported at runtime but not in this type version
    onError: (err: Error) => {
      console.error("[InternalQuotes] failed to load quotes", err);
    },
  });

  const [hasEverLoaded, setHasEverLoaded] = useState(false);

  useEffect(() => {
    if (!hasEverLoaded && quotes !== undefined) {
      setHasEverLoaded(true);
    }
  }, [quotes, hasEverLoaded]);

  const quotesList: QuoteRow[] = (quotes ?? []) as QuoteRow[];
  const { data: products } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const hasQuotes = quotesList.length > 0;
  const isInitialLoading = isLoading && !hasQuotes;
  const isRefreshing = isFetching && hasQuotes;

  console.log("[InternalQuotes] state", {
    isLoading,
    isFetching,
    hasQuotes,
    isInitialLoading,
    isRefreshing,
    hasError: !!error,
  });

  // Filter and sort quotes
  const filteredAndSortedQuotes = useMemo(() => {
    if (!quotesList.length) return [];
    
    // Apply status filter
    let filtered = quotesList;
    if (statusFilter !== "all") {
      filtered = quotesList.filter((q: QuoteRow) => {
        const state = useQuoteWorkflowState(q);
        return state === statusFilter;
      });
    }
    
    // Sort filtered results
    return [...filtered].sort((a: QuoteRow, b: QuoteRow) => {
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
          const userA =
            a.user
              ? `${a.user.firstName || ""} ${a.user.lastName || ""}`.trim() ||
                (a.user.email ?? "")
              : "";
          const userB =
            b.user
              ? `${b.user.firstName || ""} ${b.user.lastName || ""}`.trim() ||
                (b.user.email ?? "")
              : "";
          comparison = userA.localeCompare(userB);
          break;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [quotesList, sortKey, sortDirection, statusFilter]);

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

  // Render cell content based on column key
  const renderCell = (quote: QuoteRow, columnKey: string) => {
    const workflowState = useQuoteWorkflowState(quote);
    const isApprovedLocked = workflowState === 'approved' || workflowState === 'converted';
    const lockedHint = workflowState === 'approved'
      ? "Approved quotes are locked. Revise to change."
      : workflowState === 'converted'
      ? "This quote has been converted to an order."
      : "";

    switch (columnKey) {
      case "quoteNumber":
        return (
          <TableCell style={getColStyle("quoteNumber")}>
            <span className="font-mono text-titan-accent hover:text-titan-accent-hover hover:underline cursor-pointer">
              {quote.quoteNumber || "N/A"}
            </span>
          </TableCell>
        );
      
      case "label":
        return (
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
                  disabled={isApprovedLocked}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={(updateLabelMutation.isPending && editingQuoteId === quote.id) || isApprovedLocked}
                  onClick={() => handleSaveLabel(quote.id)}
                  title={isApprovedLocked ? lockedHint : undefined}
                >
                  {updateLabelMutation.isPending && editingQuoteId === quote.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCancelLabelEdit}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <div 
                className={
                  isApprovedLocked
                    ? "px-2 py-1 rounded opacity-70 cursor-not-allowed"
                    : "cursor-pointer px-2 py-1 rounded hover:bg-muted/30"
                }
                onClick={() => {
                  if (isApprovedLocked) return;
                  handleStartLabelEdit(quote.id, quote.label || "");
                }}
                title={isApprovedLocked ? lockedHint : "Edit label"}
              >
                {quote.label ? (
                  <span className="text-sm">{quote.label}</span>
                ) : (
                  <span className="text-muted-foreground text-sm italic">
                    {isApprovedLocked ? "—" : "Click to add..."}
                  </span>
                )}
              </div>
            )}
          </TableCell>
        );
      
      case "thumbnails":
        return (
          <TableCell 
            style={getColStyle("thumbnails")}
            onClick={(e) => e.stopPropagation()}
          >
            {quote.previewThumbnails && quote.previewThumbnails.length > 0 ? (
              <div className="flex items-center gap-1">
                {quote.previewThumbnails.slice(0, 3).map((thumbKey, idx) => (
                  <div
                    key={idx}
                    className="w-10 h-10 rounded border border-border bg-muted overflow-hidden hover:ring-2 hover:ring-primary cursor-pointer"
                    title={`Preview ${idx + 1}`}
                  >
                    <img
                      src={`/objects/${thumbKey}`}
                      alt={`Thumbnail ${idx + 1}`}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => {
                        // Fallback to file icon on error
                        e.currentTarget.style.display = 'none';
                        const parent = e.currentTarget.parentElement;
                        if (parent) {
                          parent.innerHTML = '<div class="w-full h-full flex items-center justify-center"><svg class="w-5 h-5 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg></div>';
                        }
                      }}
                    />
                  </div>
                ))}
                {quote.thumbsCount && quote.thumbsCount > 3 && (
                  <span className="text-xs text-muted-foreground">
                    +{quote.thumbsCount - 3}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </TableCell>
        );
      
      case "date":
        return (
          <TableCell style={getColStyle("date")}>
            {format(new Date(quote.createdAt), "MMM d, yyyy")}
          </TableCell>
        );
      
      case "customer":
        return (
          <TableCell
            style={getColStyle("customer")}
            onClick={(e) => e.stopPropagation()}
          >
            {quote.customerId ? (
              <Link to={ROUTES.customers.detail(quote.customerId)}>
                <Button variant="link" className="h-auto p-0 font-normal">
                  {quote.customerName?.trim()
                    ? quote.customerName
                    : "View Customer"}
                </Button>
              </Link>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </TableCell>
        );
      
      case "status":
        const workflowState = useQuoteWorkflowState(quote);
        return (
          <TableCell style={getColStyle("status")}>
            {workflowState && <QuoteWorkflowBadge state={workflowState} />}
          </TableCell>
        );
      
      case "items":
        return (
          <TableCell style={getColStyle("items")}>
            <Badge variant="secondary">
              {quote.lineItems?.length || 0} items
            </Badge>
          </TableCell>
        );
      
      case "source":
        return (
          <TableCell style={getColStyle("source")}>
            <QuoteSourceBadge source={quote.source} />
          </TableCell>
        );
      
      case "createdBy":
        return (
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
        );
      
      case "total":
        return (
          <TableCell className="text-right font-mono font-medium" style={getColStyle("total")}>
            ${parseFloat(quote.totalPrice).toFixed(2)}
          </TableCell>
        );
      
      case "actions":
        return (
          <TableCell
            style={getColStyle("actions")}
            onClick={(e) => e.stopPropagation()}
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
                onClick={() => navigate(ROUTES.quotes.edit(quote.id))}
                disabled={isApprovedLocked}
                title={isApprovedLocked ? lockedHint : "Edit quote"}
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
        );
      
      default:
        return <TableCell key={columnKey}>—</TableCell>;
    }
  };

  // Handle label edit
  const handleStartLabelEdit = (quoteId: string, currentLabel: string) => {
    setEditingQuoteId(quoteId);
    setTempLabel(currentLabel || "");
  };

  const updateLabelMutation = useMutation({
    mutationFn: async ({ quoteId, label }: { quoteId: string; label: string }) => {
      const response = await fetch(`/api/quotes/${quoteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
        credentials: "include",
      });

      if (!response.ok) {
        const json = await response.json().catch(() => null);
        const message =
          (json && (json.error || json.message)) ||
          (await response.text().catch(() => "")) ||
          "Failed to update quote";
        throw new Error(message);
      }
      return response.json();
    },
    onSuccess: async (_data, variables) => {
      // Update list without a full reload
      await queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      toast({
        title: "Success",
        description: "Quote label updated",
      });
      setEditingQuoteId(null);
      setTempLabel("");
    },
    onError: (error: any) => {
      console.error("[InternalQuotes] label update failed", error);
      toast({
        title: "Error",
        description: error?.message || "Failed to update quote label",
        variant: "destructive",
      });
    },
  });

  const handleSaveLabel = async (quoteId: string) => {
    await updateLabelMutation.mutateAsync({ quoteId, label: tempLabel });
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

  const handleConfirmConvert = async (values: { dueDate: string; promisedDate: string; priority: string; notes: string }) => {
    if (!selectedQuoteId) return;

    const quote = quotesList.find((q) => q.id === selectedQuoteId);
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
        dueDate: values.dueDate || undefined,
        promisedDate: values.promisedDate || undefined,
        priority: values.priority,
        notesInternal: values.notes || undefined,
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
        description: result?.data?.order?.orderNumber
          ? `Quote ${quote?.quoteNumber} converted to order ${result.data.order.orderNumber}`
          : `Quote ${quote?.quoteNumber} converted to order.`,
      });

      const orderId = result?.data?.order?.id;
      if (orderId) {
        navigate(ROUTES.orders.detail(orderId));
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

  if (error) {
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
          actions={<NewQuoteButton />}
        />
        <ContentLayout className="space-y-3">
          <DataCard
            title="Internal Quotes"
            description="There was a problem loading quotes."
            className="mt-0"
          >
            <div className="text-sm text-destructive">
              Failed to load quotes. Please refresh the page or try again later.
            </div>
          </DataCard>
        </ContentLayout>
      </Page>
    );
  }

  if (!hasEverLoaded && isInitialLoading) {
    return (
      <Page>
        <PageHeader
          title="Quotes"
          subtitle="Loading internal quotes..."
          className="pb-3"
          backButton={
            <Button variant="ghost" size="sm" onClick={() => navigate(ROUTES.dashboard)}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          }
          actions={<NewQuoteButton />}
        />
        <ContentLayout className="space-y-3">
          <div className="flex flex-row items-center gap-3 flex-wrap mb-4">
            <Skeleton className="flex-1 min-w-[200px] h-9" />
            <Skeleton className="w-[180px] h-9" />
            <Skeleton className="w-[140px] h-9" />
            <Skeleton className="w-[140px] h-9" />
          </div>

          <DataCard
            title="Internal Quotes"
            description="Loading quotes…"
            className="mt-0"
            headerActions={<Skeleton className="h-8 w-24" />}
          >
            <div className="space-y-2">
              {[...Array(6)].map((_, idx) => (
                <Skeleton key={idx} className="h-12 w-full" />
              ))}
            </div>
          </DataCard>
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

        {/* Status Filter Chips (only for internal users) */}
        {isInternalUser && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Status:</span>
            <Button
              variant={statusFilter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter("all")}
            >
              All
            </Button>
            <Button
              variant={statusFilter === "draft" ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter("draft")}
            >
              Draft
            </Button>
            {requireApproval && (
              <Button
                variant={statusFilter === "pending_approval" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("pending_approval")}
              >
                Pending Approval
              </Button>
            )}
            <Button
              variant={statusFilter === "sent" ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter("sent")}
            >
              Sent
            </Button>
            <Button
              variant={statusFilter === "approved" ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter("approved")}
            >
              Approved
            </Button>
            <Button
              variant={statusFilter === "converted" ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter("converted")}
            >
              Converted
            </Button>
          </div>
        )}
        
        {/* Approval Indicators (only when requireApproval is enabled) */}
        {/* Note: Org-level approval means ALL drafts need approval before sending */}
        {isInternalUser && requireApproval && (() => {
          // Compute workflow states once for efficiency
          const draftCount = quotesList.filter((q: QuoteRow) => {
            const state = useQuoteWorkflowState(q);
            return state === "draft";
          }).length;
          
          const pendingApprovalCount = quotesList.filter((q: QuoteRow) => {
            const state = useQuoteWorkflowState(q);
            return state === "pending_approval";
          }).length;
          
          return (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {draftCount > 0 && (
                <div className="flex items-center gap-1.5 text-amber-600">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  <span>{draftCount} needs approval</span>
                </div>
              )}
              {pendingApprovalCount > 0 && (
                <div className="flex items-center gap-1.5 text-blue-600">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  <span>{pendingApprovalCount} pending approval</span>
                </div>
              )}
            </div>
          );
        })()}

        {/* Quotes List */}
        <DataCard
          title="Internal Quotes"
          description={`${quotesList.length ?? 0} quote${
            quotesList.length !== 1 ? "s" : ""
          } found`}
          className="mt-0"
          headerActions={
            <div className="flex items-center gap-2">
              {isRefreshing && (
                <span className="text-xs text-muted-foreground">Refreshing…</span>
              )}
              <ColumnConfig
                columns={QUOTE_COLUMNS}
                storageKey="quotes_column_settings"
                settings={columnSettings}
                onSettingsChange={setColumnSettings}
              />
            </div>
          }
        >
          {quotesList.length === 0 ? (
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
                    {orderedColumns.map((col) => {
                      if (!isVisible(col.key)) return null;
                      
                      const isSortable = col.sortable !== false;
                      const isRightAligned = col.align === "right";
                      
                      return (
                        <TableHead
                          key={col.key}
                          className={`${isSortable ? "cursor-pointer hover:bg-muted/50 select-none" : ""} ${isRightAligned ? "text-right" : ""}`}
                          style={getColStyle(col.key)}
                          onClick={isSortable ? () => handleSort(col.key as SortKey) : undefined}
                        >
                          {col.label}
                          {isSortable && <SortIcon columnKey={col.key as SortKey} />}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedQuotes.map((quote) => (
                    <TableRow
                      key={quote.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(ROUTES.quotes.detail(quote.id))}
                    >
                      {orderedColumns.map((col) => {
                        if (!isVisible(col.key)) return null;
                        return <Fragment key={col.key}>{renderCell(quote, col.key)}</Fragment>;
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DataCard>
      </ContentLayout>

      <ConvertQuoteToOrderDialog
        open={convertDialogOpen}
        onOpenChange={(open) => {
          setConvertDialogOpen(open);
          if (!open) {
            setSelectedQuoteId(null);
            setOrderDueDate("");
            setOrderPromisedDate("");
            setOrderPriority("normal");
            setOrderNotes("");
          }
        }}
        isLoading={convertToOrder.isPending}
        onSubmit={(values) => {
          handleConfirmConvert(values);
        }}
        defaultValues={{
          dueDate: orderDueDate,
          promisedDate: orderPromisedDate,
          priority: orderPriority,
          notes: orderNotes,
        }}
      />
    </Page>
  );
}
