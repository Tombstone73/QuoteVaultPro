import { useState, useMemo, useEffect, Fragment, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { ROUTES } from "@/config/routes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AttachmentViewerDialog } from "@/components/AttachmentViewerDialog";
import { ViewAllAttachmentsDialog } from "@/components/ViewAllAttachmentsDialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
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
import { objectsUrlFromKey } from "@/lib/getThumbSrc";
import {
  FileText,
  Plus,
  Edit,
  Package,
  Eye,
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
import { buildCsv, type CsvValue } from "@shared/csv";
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
  getColumnDisplayName,
  type ColumnDefinition,
  type ColumnState,
} from "@/components/titan";
import type { QuoteWithRelations, Product } from "@shared/schema";
import type { Organization } from "@shared/schema";
import type { QuoteWorkflowState } from "@shared/quoteWorkflow";

type SortKey = "date" | "quoteNumber" | "customer" | "total" | "items" | "source" | "createdBy" | "listLabel" | "jobLabel";

type QuoteRow = QuoteWithRelations & {
  label?: string | null; // This is the job label from quote record
  listLabel?: string | null; // List-only note, always editable
  previewThumbnails?: string[];
  thumbsCount?: number;
  lineItemsCount?: number;
  workflowState?: QuoteWorkflowState | null;
};

type QuotesListResponse = {
  items: QuoteRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

// Column definitions for quotes table
const QUOTE_COLUMNS: ColumnDefinition[] = [
  { key: "quoteNumber", label: "Quote #", defaultVisible: true, defaultWidth: 100, minWidth: 80, maxWidth: 150, sortable: true },
  { key: "listLabel", label: "List Note", defaultVisible: true, defaultWidth: 150, minWidth: 100, maxWidth: 250, sortable: true },
  { key: "jobLabel", label: "Job Label", defaultVisible: true, defaultWidth: 150, minWidth: 100, maxWidth: 250, sortable: true },
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

  const { data: organization } = useQuery<Organization>({
    queryKey: ["/api/organization/current"],
    queryFn: async () => {
      const response = await fetch("/api/organization/current", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch organization");
      return response.json();
    },
    enabled: !!user,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const [searchCustomer, setSearchCustomer] = useState("");
  const [searchProduct, setSearchProduct] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [statusFilter, setStatusFilter] = useState<QuoteWorkflowState | "all">("all");

  // Pagination + performance controls (persisted per org+user)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [includeThumbnails, setIncludeThumbnails] = useState(true);
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [orderDueDate, setOrderDueDate] = useState("");
  const [orderPromisedDate, setOrderPromisedDate] = useState("");
  const [orderPriority, setOrderPriority] = useState<"normal" | "rush" | "low">("normal");
  const [orderNotes, setOrderNotes] = useState("");
  
  // Column settings - scoped per user for multi-tenant safety
  const storageKey = user?.id 
    ? `titan:listview:quotes:user_${user.id}` 
    : "quotes_column_settings"; // fallback for loading state
  const [columnSettings, setColumnSettings] = useColumnSettings(QUOTE_COLUMNS, storageKey);

  // Label editing state
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<'listLabel' | 'jobLabel' | null>(null);
  const [tempLabel, setTempLabel] = useState("");

  // Attachment viewer state (gallery mode)
  const [viewerAttachments, setViewerAttachments] = useState<any[]>([]);
  const [viewerInitialIndex, setViewerInitialIndex] = useState(0);
  const [attachmentViewerOpen, setAttachmentViewerOpen] = useState(false);
  const [attachmentsListOpen, setAttachmentsListOpen] = useState(false);
  const [loadingAttachments, setLoadingAttachments] = useState<string | null>(null);

  const orgIdForPrefs = organization?.id;
  const pageSizeKey = orgIdForPrefs && user?.id ? `titan:list:internalQuotes:pageSize:org_${orgIdForPrefs}:user_${user.id}` : null;
  const includeThumbsKey = orgIdForPrefs && user?.id ? `titan:list:internalQuotes:includeThumbnails:org_${orgIdForPrefs}:user_${user.id}` : null;

  useEffect(() => {
    if (!pageSizeKey || !includeThumbsKey) return;
    try {
      const savedPageSize = window.localStorage.getItem(pageSizeKey);
      const savedThumbs = window.localStorage.getItem(includeThumbsKey);
      if (savedPageSize) {
        const n = parseInt(savedPageSize, 10);
        if (Number.isFinite(n) && n >= 1 && n <= 200) setPageSize(n);
      }
      if (savedThumbs !== null) {
        setIncludeThumbnails(savedThumbs === 'true');
      }
    } catch {
      // ignore
    }
    // Reset paging when org/user changes
    setPage(1);
  }, [pageSizeKey, includeThumbsKey]);

  useEffect(() => {
    if (!pageSizeKey) return;
    try {
      window.localStorage.setItem(pageSizeKey, String(pageSize));
    } catch {
      // ignore
    }
  }, [pageSizeKey, pageSize]);

  useEffect(() => {
    if (!includeThumbsKey) return;
    try {
      window.localStorage.setItem(includeThumbsKey, includeThumbnails ? 'true' : 'false');
    } catch {
      // ignore
    }
  }, [includeThumbsKey, includeThumbnails]);
  
  // Sorting state
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  // Reset page on any filter/sort/perf control changes
  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchCustomer, searchProduct, startDate, endDate, statusFilter, sortKey, sortDirection, pageSize, includeThumbnails]);

  const hasWarnedPerf = useRef(false);
  useEffect(() => {
    if (pageSize === 200 && includeThumbnails && !hasWarnedPerf.current) {
      hasWarnedPerf.current = true;
      toast({
        title: "Performance tip",
        description: "200 rows with thumbnails can be slow. Turn off thumbnails for faster browsing.",
      });
    }
  }, [pageSize, includeThumbnails, toast]);

  // CSV Export
  const [exportOpen, setExportOpen] = useState(false);
  const [exportScope, setExportScope] = useState<"visible" | "all">("visible");
  const [exportIncludeHeaders, setExportIncludeHeaders] = useState(true);
  const defaultExportFilename = `quotes_${format(new Date(), "yyyy-MM-dd")}.csv`;
  const [exportFilename, setExportFilename] = useState(defaultExportFilename);
  const [isExporting, setIsExporting] = useState(false);

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
    data: quotesResponse,
    isLoading,
    isFetching,
    error,
  } = useQuery<QuotesListResponse, Error>({
    queryKey: [
      "/api/quotes",
      {
        source: "internal",
        searchCustomer,
        searchProduct,
        startDate,
        endDate,
        status: statusFilter,
        sortBy: sortKey,
        sortDir: sortDirection,
        page,
        pageSize,
        includeThumbnails,
      },
    ],
    queryFn: async () => {
      const params = new URLSearchParams({ source: "internal" });
      if (searchCustomer) params.set("searchCustomer", searchCustomer);
      if (searchProduct && searchProduct !== "all")
        params.set("searchProduct", searchProduct);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);

      if (statusFilter !== 'all') params.set('status', statusFilter);
      params.set('sortBy', sortKey);
      params.set('sortDir', sortDirection);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      params.set('includeThumbnails', includeThumbnails ? 'true' : 'false');

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
  });

  const [hasEverLoaded, setHasEverLoaded] = useState(false);

  useEffect(() => {
    if (!hasEverLoaded && quotesResponse !== undefined) {
      setHasEverLoaded(true);
    }
  }, [quotesResponse, hasEverLoaded]);

  const quotesList: QuoteRow[] = (quotesResponse?.items ?? []) as QuoteRow[];
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

  // Server already filters by status, so we just use the returned list directly
  const filteredAndSortedQuotes = quotesList;

  const exportableColumns = useMemo(() => {
    // Export ONLY visible columns, in current configured order.
    // Always exclude Actions.
    return orderedColumns.filter((col) => isVisible(col.key) && col.key !== "actions");
  }, [orderedColumns, columnSettings]);

  const getExportValue = (quote: QuoteRow, columnKey: string): CsvValue => {
    switch (columnKey) {
      case "quoteNumber":
        return quote.quoteNumber ?? "";
      case "listLabel":
        return quote.listLabel ?? "";
      case "jobLabel":
        return quote.label ?? "";
      case "thumbnails": {
        if (!includeThumbnails) return "";
        const keys = quote.previewThumbnails ?? [];
        if (!keys.length) return "";
        // Export semicolon-separated URLs for compatibility.
        return keys
          .map((k) => objectsUrlFromKey(k))
          .filter((u): u is string => typeof u === "string" && u.length > 0)
          .join(";");
      }
      case "status": {
        const state = quote.workflowState ?? useQuoteWorkflowState(quote);
        return state ?? "";
      }
      case "date":
        return format(new Date(quote.createdAt), "MM/dd/yy");
      case "customer":
        return quote.customerName ?? "";
      case "items":
        return quote.lineItemsCount ?? quote.lineItems?.length ?? 0;
      case "source":
        return quote.source ?? "";
      case "createdBy": {
        const name = quote.user
          ? `${quote.user.firstName || ""} ${quote.user.lastName || ""}`.trim() || (quote.user.email ?? "")
          : "";
        return name;
      }
      case "total": {
        // Export currency as a number string (no $) for Excel compatibility.
        const n = Number(quote.totalPrice ?? 0);
        return Number.isFinite(n) ? n.toFixed(2) : "";
      }
      default:
        return "";
    }
  };

  const downloadCsv = async () => {
    try {
      setIsExporting(true);
      toast({ title: "Export started…", description: "Preparing CSV download." });

      const filename = (exportFilename || defaultExportFilename).trim();
      const safeFilename = filename.toLowerCase().endsWith(".csv") ? filename : `${filename}.csv`;

      if (exportScope === 'visible') {
        const rowsToExport = filteredAndSortedQuotes;
        const headerRow: CsvValue[] = exportableColumns.map((c) => c.label);
        const dataRows: CsvValue[][] = rowsToExport.map((q) => exportableColumns.map((c) => getExportValue(q, c.key)));
        const csv = buildCsv([headerRow, ...dataRows], { includeHeaders: exportIncludeHeaders });

        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = safeFilename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } else {
        // All matching: server export ignores pagination but uses same filters/sort.
        const params = new URLSearchParams({ source: 'internal' });
        if (searchCustomer) params.set('searchCustomer', searchCustomer);
        if (searchProduct && searchProduct !== 'all') params.set('searchProduct', searchProduct);
        if (startDate) params.set('startDate', startDate);
        if (endDate) params.set('endDate', endDate);
        if (statusFilter !== 'all') params.set('status', statusFilter);
        params.set('sortBy', sortKey);
        params.set('sortDir', sortDirection);
        params.set('includeHeaders', exportIncludeHeaders ? 'true' : 'false');
        params.set('columns', exportableColumns.map((c) => c.key).join(','));

        const url = `/api/quotes/export.csv?${params.toString()}`;
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(text || 'Export failed');
        }
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = safeFilename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(blobUrl);
      }

      toast({ title: "Download ready", description: safeFilename });
      setExportOpen(false);
    } catch (err: any) {
      console.error("[InternalQuotes] export failed", err);
      toast({
        title: "Export failed",
        description: err?.message || "Could not export CSV.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  // Handle thumbnail click - fetch attachment details and open viewer (gallery mode)
  const handleThumbnailClick = async (quoteId: string, thumbKey: string) => {
    setLoadingAttachments(quoteId);
    
    try {
      // Fetch all attachments for the quote (including line item attachments)
      const response = await fetch(`/api/quotes/${quoteId}/attachments?includeLineItems=true`, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch attachments');
      }
      
      const result = await response.json();
      const attachments = result.data || [];
      
      if (attachments.length === 0) {
        toast({
          title: "No attachments found",
          description: "This quote has no attachments.",
          variant: "destructive"
        });
        return;
      }
      
      // Find the index of the clicked thumbnail
      let clickedIndex = attachments.findIndex((att: any) => att.thumbKey === thumbKey);
      
      // Fallback: if no exact match, try finding by attachment ID in thumbKey
      if (clickedIndex === -1 && thumbKey.includes('attachment_')) {
        const attachmentIdMatch = thumbKey.match(/attachment_([^.\/]+)/);
        if (attachmentIdMatch) {
          const attachmentId = attachmentIdMatch[1];
          clickedIndex = attachments.findIndex((att: any) => att.id.includes(attachmentId));
        }
      }
      
      // Default to first attachment if no match found
      if (clickedIndex === -1) {
        clickedIndex = 0;
      }
      
      // Open attachments list modal with all attachments
      setViewerAttachments(attachments);
      setViewerInitialIndex(0); // Reset to list view
      setAttachmentsListOpen(true);
    } catch (error: any) {
      console.error('[handleThumbnailClick] Error:', error);
      toast({
        title: "Failed to load attachments",
        description: error.message || "Could not fetch attachment details.",
        variant: "destructive"
      });
    } finally {
      setLoadingAttachments(null);
    }
  };

  // Handle attachment download
  const handleDownloadAttachment = async (attachment: any, fallbackQuoteId?: string) => {
    try {
      const fileName = attachment.originalFilename || attachment.fileName || 'download';
      const quoteId = attachment.quoteId || fallbackQuoteId;
      
      if (!quoteId || !attachment.id) {
        // Fallback: use originalUrl if available
        if (attachment.originalUrl) {
          const anchor = document.createElement("a");
          anchor.href = attachment.originalUrl;
          anchor.download = fileName;
          anchor.target = "_blank";
          anchor.rel = "noreferrer";
          anchor.style.display = "none";
          document.body.appendChild(anchor);
          anchor.click();
          document.body.removeChild(anchor);
        }
        return;
      }
      
      // Use proxy endpoint for proper download (with intent parameter for future variants)
      const proxyUrl = `/api/quotes/${quoteId}/attachments/${attachment.id}/download/proxy?intent=original`;
      
      const anchor = document.createElement("a");
      anchor.href = proxyUrl;
      anchor.download = fileName;
      anchor.rel = "noreferrer";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } catch (error: any) {
      console.error('[handleDownloadAttachment] Error:', error);
      toast({
        title: "Download failed",
        description: error.message || "Could not download file.",
        variant: "destructive"
      });
    }
  };

  // Handle download all attachments as zip for current quote
  const handleDownloadAllZip = () => {
    if (!viewerAttachments || viewerAttachments.length === 0) return;
    
    // Get quoteId from first attachment or from selected quote
    const quoteId = viewerAttachments[0]?.quoteId;
    if (!quoteId) {
      toast({
        title: "Download Failed",
        description: "Could not determine quote ID.",
        variant: "destructive"
      });
      return;
    }

    const zipUrl = `/api/quotes/${quoteId}/attachments.zip`;
    const anchor = document.createElement("a");
    anchor.href = zipUrl;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      // Default direction based on column type
      setSortDirection(key === "customer" || key === "quoteNumber" || key === "source" || key === "createdBy" || key === "listLabel" || key === "jobLabel" ? "asc" : "desc");
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
    const workflowState = quote.workflowState ?? useQuoteWorkflowState(quote);
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
            <span className="font-mono text-titan-accent hover:text-titan-accent-hover hover:underline cursor-pointer block truncate">
              {quote.quoteNumber || "N/A"}
            </span>
          </TableCell>
        );
      
      case "listLabel":
        return (
          <TableCell 
            style={getColStyle("listLabel")}
            onClick={(e) => e.stopPropagation()}
          >
            {editingQuoteId === quote.id && editingField === 'listLabel' ? (
              <div className="flex items-center gap-1">
                <Input
                  value={tempLabel}
                  onChange={(e) => setTempLabel(e.target.value)}
                  className="h-8 w-[130px]"
                  placeholder="List note..."
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveListLabel(quote.id);
                    if (e.key === 'Escape') handleCancelLabelEdit();
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={updateListLabelMutation.isPending && editingQuoteId === quote.id}
                  onClick={() => handleSaveListLabel(quote.id)}
                >
                  {updateListLabelMutation.isPending && editingQuoteId === quote.id ? (
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
                className="cursor-pointer px-2 py-1 rounded hover:bg-muted/30"
                onClick={() => handleStartLabelEdit(quote.id, quote.listLabel || "", 'listLabel')}
                title="Edit list note (always editable)"
              >
                {quote.listLabel ? (
                  <span className="text-sm">{quote.listLabel}</span>
                ) : (
                  <span className="text-muted-foreground text-sm italic">
                    Click to add...
                  </span>
                )}
              </div>
            )}
          </TableCell>
        );
      
      case "jobLabel":
        return (
          <TableCell 
            style={getColStyle("jobLabel")}
            onClick={(e) => e.stopPropagation()}
          >
            {editingQuoteId === quote.id && editingField === 'jobLabel' ? (
              <div className="flex items-center gap-1">
                <Input
                  value={tempLabel}
                  onChange={(e) => setTempLabel(e.target.value)}
                  className="h-8 w-[130px]"
                  placeholder="Job label..."
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveJobLabel(quote.id);
                    if (e.key === 'Escape') handleCancelLabelEdit();
                  }}
                  disabled={isApprovedLocked}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={(updateJobLabelMutation.isPending && editingQuoteId === quote.id) || isApprovedLocked}
                  onClick={() => handleSaveJobLabel(quote.id)}
                  title={isApprovedLocked ? lockedHint : undefined}
                >
                  {updateJobLabelMutation.isPending && editingQuoteId === quote.id ? (
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
                  handleStartLabelEdit(quote.id, quote.label || "", 'jobLabel');
                }}
                title={isApprovedLocked ? lockedHint : "Edit job label (locks with quote)"}
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
            {!includeThumbnails ? (
              <span className="text-xs text-muted-foreground">Off</span>
            ) : quote.previewThumbnails && quote.previewThumbnails.length > 0 ? (
              <div className="flex items-center gap-1">
                {quote.previewThumbnails.slice(0, 3).map((thumbKey, idx) => {
                  const thumbUrl = objectsUrlFromKey(thumbKey);
                  const isLoading = loadingAttachments === quote.id;
                  
                  return (
                    <button
                      key={idx}
                      type="button"
                      className="w-10 h-10 rounded border border-border bg-muted overflow-hidden hover:ring-2 hover:ring-primary cursor-pointer transition-shadow p-0 disabled:opacity-50 disabled:cursor-wait"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (!isLoading) {
                          handleThumbnailClick(quote.id, thumbKey);
                        }
                      }}
                      disabled={isLoading}
                      title={isLoading ? "Loading attachment..." : "Click to preview attachment"}
                    >
                      {isLoading ? (
                        <div className="w-full h-full flex items-center justify-center">
                          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        </div>
                      ) : thumbUrl ? (
                        <img
                          src={thumbUrl}
                          alt="Preview"
                          className="w-full h-full object-cover"
                          loading="lazy"
                          onError={(e) => {
                            const img = e.currentTarget;
                            img.style.display = 'none';
                            const btn = img.parentElement;
                            if (btn && !btn.querySelector('.fallback-icon')) {
                              const iconDiv = document.createElement('div');
                              iconDiv.className = 'fallback-icon w-full h-full flex items-center justify-center bg-muted';
                              iconDiv.innerHTML = '<svg class="w-5 h-5 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>';
                              btn.appendChild(iconDiv);
                            }
                          }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-muted">
                          <FileText className="w-5 h-5 text-muted-foreground" />
                        </div>
                      )}
                    </button>
                  );
                })}
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
            {format(new Date(quote.createdAt), "MM/dd/yy")}
          </TableCell>
        );
      
      case "customer":
        return (
          <TableCell
            style={getColStyle("customer")}
            onClick={(e) => e.stopPropagation()}
          >
            {quote.customerId ? (
              <Link to={ROUTES.customers.detail(quote.customerId)} className="block min-w-0">
                <Button variant="link" className="h-auto p-0 font-normal max-w-full truncate block" title={quote.customerName || undefined}>
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
        return (
          <TableCell style={getColStyle("status")}>
            {workflowState && <QuoteWorkflowBadge state={workflowState} />}
          </TableCell>
        );
      
      case "items":
        return (
          <TableCell style={getColStyle("items")}>
            <Badge variant="secondary">
              {(quote.lineItemsCount ?? quote.lineItems?.length ?? 0)} items
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
            <span className="text-sm truncate" title={quote.user ? (`${quote.user.firstName || ""} ${quote.user.lastName || ""}`.trim() || quote.user.email || undefined) : undefined}>
              {quote.user
                ? (
                    `${quote.user.firstName || ""} ${
                      quote.user.lastName || ""
                    }`.trim() || quote.user.email
                  )
                : "—"}
            </span>
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
  const handleStartLabelEdit = (quoteId: string, currentLabel: string, field: 'listLabel' | 'jobLabel') => {
    setEditingQuoteId(quoteId);
    setEditingField(field);
    setTempLabel(currentLabel || "");
  };

  // List Label Mutation (always editable, uses separate API)
  const updateListLabelMutation = useMutation({
    mutationFn: async ({ quoteId, listLabel }: { quoteId: string; listLabel: string }) => {
      const response = await fetch(`/api/quotes/${quoteId}/list-note`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listLabel }),
        credentials: "include",
      });

      if (!response.ok) {
        const json = await response.json().catch(() => null);
        const message =
          (json && (json.error || json.message)) ||
          (await response.text().catch(() => "")) ||
          "Failed to update list note";
        throw new Error(message);
      }
      return response.json();
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      toast({
        title: "Success",
        description: "List note updated",
      });
      setEditingQuoteId(null);
      setEditingField(null);
      setTempLabel("");
    },
    onError: (error: any) => {
      console.error("[InternalQuotes] list label update failed", error);
      toast({
        title: "Error",
        description: error?.message || "Failed to update list note",
        variant: "destructive",
      });
    },
  });

  // Job Label Mutation (respects quote lock, uses quote PATCH)
  const updateJobLabelMutation = useMutation({
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
          "Failed to update job label";
        throw new Error(message);
      }
      return response.json();
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      toast({
        title: "Success",
        description: "Job label updated",
      });
      setEditingQuoteId(null);
      setEditingField(null);
      setTempLabel("");
    },
    onError: (error: any) => {
      console.error("[InternalQuotes] job label update failed", error);
      toast({
        title: "Error",
        description: error?.message || "Failed to update job label",
        variant: "destructive",
      });
    },
  });

  const handleSaveListLabel = async (quoteId: string) => {
    await updateListLabelMutation.mutateAsync({ quoteId, listLabel: tempLabel });
  };

  const handleSaveJobLabel = async (quoteId: string) => {
    await updateJobLabelMutation.mutateAsync({ quoteId, label: tempLabel });
  };

  const handleCancelLabelEdit = () => {
    setEditingQuoteId(null);
    setEditingField(null);
    setTempLabel("");
  };

  const handleClearFilters = () => {
    setSearchCustomer("");
    setSearchProduct("all");
    setStartDate("");
    setEndDate("");
    setStatusFilter('all');
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
    <Page maxWidth="full">
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
        {/* Toolbar: 2-Row Grid Layout */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
          {/* Row 1 Left: Filter Controls */}
          <div className="flex flex-wrap items-center gap-3">
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

          {/* Row 1 Right: Show Thumbnails Toggle */}
          <div className="flex items-center justify-end gap-3 whitespace-nowrap md:justify-self-end">
            <Label className="text-sm text-muted-foreground">Show thumbnails</Label>
            <Switch checked={includeThumbnails} onCheckedChange={setIncludeThumbnails} />
          </div>

          {/* Row 2 Left: Status Chips and Approval Indicators */}
          <div className="flex flex-col gap-1">
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
              // CRITICAL: Only pending_approval status indicates quotes that need approval
              // Drafts are not yet submitted and should NOT show approval indicators
              
              // Pending approval quotes (workflow state = pending_approval, submitted for approval)
              const pendingApprovalCount = quotesList.filter((q: QuoteRow) => {
                return q.status === 'pending_approval' && !q.convertedToOrderId;
              }).length;
              
              // Temporary debug log (remove after testing)
              if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development' && quotesList.length > 0) {
                console.log('[InternalQuotes] Approval status check:', {
                  totalRows: quotesList.length,
                  pendingApprovalCount,
                  currentFilter: statusFilter,
                });
              }
              
              return (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  {pendingApprovalCount > 0 && (
                    <button
                      type="button"
                      className="flex items-center gap-1.5 text-amber-600 hover:text-amber-700 transition-colors cursor-pointer"
                      onClick={() => setStatusFilter('pending_approval')}
                      title="Click to filter Pending Approval quotes"
                    >
                      <div className="w-2 h-2 rounded-full bg-amber-500" />
                      <span>{pendingApprovalCount} need{pendingApprovalCount === 1 ? 's' : ''} approval (on this page)</span>
                    </button>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Row 2 Right: Rows Per Page Dropdown */}
          <div className="flex items-center justify-end gap-3 whitespace-nowrap md:justify-self-end">
            <Label className="text-sm text-muted-foreground">Rows per page</Label>
            <Select value={String(pageSize)} onValueChange={(v) => setPageSize(parseInt(v, 10))}>
              <SelectTrigger className="w-[140px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
                <SelectItem value="200">200</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>



        {/* Quotes List */}
        <DataCard
          title="Internal Quotes"
          description={
            quotesResponse
              ? `${quotesResponse.totalCount} quote${quotesResponse.totalCount !== 1 ? "s" : ""} found • Page ${quotesResponse.page} of ${quotesResponse.totalPages}`
              : `${quotesList.length ?? 0} quote${quotesList.length !== 1 ? "s" : ""} found`
          }
          className="-mt-1"
          headerActions={
            <div className="flex items-center gap-2">
              {isRefreshing && (
                <span className="text-xs text-muted-foreground">Refreshing…</span>
              )}
              <ColumnConfig
                columns={QUOTE_COLUMNS}
                storageKey={storageKey}
                settings={columnSettings}
                onSettingsChange={setColumnSettings}
                footerActions={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      setExportFilename(defaultExportFilename);
                      setExportOpen(true);
                    }}
                  >
                    Export CSV
                  </Button>
                }
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
            <>
              <div className="overflow-x-auto -mx-5">
                <div className="min-w-full inline-block align-middle">
                  <Table className="table-dense w-full">
                <TableHeader>
                  <TableRow>
                    {orderedColumns.map((col) => {
                      if (!isVisible(col.key)) return null;
                      
                      const isSortable = col.sortable !== false;
                      const isRightAligned = col.align === "right";
                      const displayName = getColumnDisplayName(columnSettings, col.key, col.label);
                      
                      return (
                        <TableHead
                          key={col.key}
                          className={`${isSortable ? "cursor-pointer hover:bg-muted/50 select-none" : ""} ${isRightAligned ? "text-right" : ""}`}
                          style={getColStyle(col.key)}
                          onClick={isSortable ? () => handleSort(col.key as SortKey) : undefined}
                        >
                          {displayName}
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
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="text-sm text-muted-foreground">
                  Showing {quotesList.length} on this page
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!quotesResponse?.hasPrev}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Prev
                  </Button>
                  {quotesResponse ? (
                    <span className="min-w-[100px] text-center text-sm text-muted-foreground">
                      Page {quotesResponse.page} of {quotesResponse.totalPages}
                    </span>
                  ) : (
                    <span className="min-w-[100px] text-center text-sm text-muted-foreground">
                      Page —
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!quotesResponse?.hasNext}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
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

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Export CSV</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Scope</Label>
              <RadioGroup value={exportScope} onValueChange={(v) => setExportScope(v as any)}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="visible" id="export-scope-visible" />
                  <Label htmlFor="export-scope-visible">Visible rows (current page)</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="all" id="export-scope-all" />
                  <Label htmlFor="export-scope-all">All matching (with current filters)</Label>
                </div>
              </RadioGroup>
              <p className="text-xs text-muted-foreground">
                Export respects current filters, status chips, sort, and visible column order.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="export-headers"
                checked={exportIncludeHeaders}
                onCheckedChange={(v) => setExportIncludeHeaders(v === true)}
              />
              <Label htmlFor="export-headers">Include headers</Label>
            </div>

            <div className="space-y-2">
              <Label htmlFor="export-filename">Filename</Label>
              <Input
                id="export-filename"
                value={exportFilename}
                onChange={(e) => setExportFilename(e.target.value)}
                placeholder={defaultExportFilename}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setExportOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={downloadCsv} disabled={isExporting}>
              {isExporting ? "Exporting…" : "Download CSV"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Attachments List Modal */}
      <ViewAllAttachmentsDialog
        open={attachmentsListOpen}
        onOpenChange={setAttachmentsListOpen}
        orderAttachments={viewerAttachments.map((a) => ({ ...a, source: "order" as const, orderId: a.quoteId }))}
        lineItemAttachments={[]}
        onViewAttachment={(a) => {
          const index = viewerAttachments.findIndex((att) => att.id === a.id);
          setViewerInitialIndex(Math.max(0, index));
          setAttachmentViewerOpen(true);
          setAttachmentsListOpen(false);
        }}
        onDownload={(a) => {
          void handleDownloadAttachment(a);
        }}
        onDownloadAll={viewerAttachments.length > 0 ? handleDownloadAllZip : undefined}
        onDeleteAttachment={undefined}
        canDelete={false}
        orderId={viewerAttachments[0]?.quoteId || null}
        parentType="quote"
      />

      {/* Gallery Attachment Viewer */}
      <AttachmentViewerDialog
        attachments={viewerAttachments}
        initialIndex={viewerInitialIndex}
        open={attachmentViewerOpen}
        onOpenChange={(open) => {
          setAttachmentViewerOpen(open);
          if (!open) {
            setViewerAttachments([]);
            setViewerInitialIndex(0);
          }
        }}
        hideFilmstrip={true}
      />
    </Page>
  );
}
