import { useState, useMemo, useEffect, useRef, Fragment } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Plus, Search, Calendar, DollarSign, Package, Check, X, Eye, ChevronUp, ChevronDown, Copy, Edit, Printer, Loader2, FileText, Download } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useOrders, type OrderRow, type OrdersListResponse, orderDetailQueryKey, orderTimelineQueryKey } from "@/hooks/useOrders";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { OrderPriorityBadge } from "@/components/order-status-badge";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Page, PageHeader, ContentLayout, DataCard, ColumnConfig, useColumnSettings, isColumnVisible, getColumnOrder, getColumnDisplayName, type ColumnDefinition, type ColumnState } from "@/components/titan";
import { ROUTES } from "@/config/routes";
import { getDisplayOrderNumber } from "@/lib/orderUtils";
// TitanOS State Architecture
import { Badge } from "@/components/ui/badge";
import type { OrderState } from "@/hooks/useOrderState";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAssignOrderStatusPill, useOrderStatusPills } from "@/hooks/useOrderStatusPills";
import { getThumbSrc } from "@/lib/getThumbSrc";
import { AttachmentViewerDialog } from "@/components/AttachmentViewerDialog";
import { downloadFileFromUrl } from "@/lib/downloadFile";

type SortKey = "date" | "orderNumber" | "poNumber" | "customer" | "total" | "dueDate" | "status" | "priority" | "items" | "label" | "listLabel" | "paymentStatus";

function OrderStatusPillCell({
  orderId,
  state,
  value,
}: {
  orderId: string;
  state: OrderState;
  value: string | null;
}) {
  // Never allow selection in canceled state
  if (state === 'canceled') {
    return value ? (
      <Badge variant="outline" className="text-xs">
        {value}
      </Badge>
    ) : null;
  }

  const { data: pills, isLoading } = useOrderStatusPills(state);
  const assignPill = useAssignOrderStatusPill(orderId);

  if (isLoading) {
    return <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />;
  }

  if (!pills || pills.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">No status pills configured…</span>
    );
  }

  const currentColor = value ? pills.find((p) => p.name === value)?.color : undefined;

  return (
    <Select
      value={value || ''}
      onValueChange={(next) => {
        assignPill.mutate(next || null);
      }}
      disabled={assignPill.isPending}
    >
      <SelectTrigger
        className="h-7 w-[160px]"
        onClick={(e) => e.stopPropagation()}
      >
        <SelectValue placeholder="Select status">
          {value ? (
            <div className="flex items-center gap-2">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: currentColor || '#3b82f6' }}
              />
              <span className="text-xs">{value}</span>
            </div>
          ) : null}
        </SelectValue>
      </SelectTrigger>
      <SelectContent onClick={(e) => e.stopPropagation()}>
        {pills.map((pill) => (
          <SelectItem key={pill.id} value={pill.name}>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: pill.color }} />
              {pill.name}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Column definitions for orders table (matches Quotes pattern)
const ORDER_COLUMNS: ColumnDefinition[] = [
  { key: "orderNumber", label: "Order #", defaultVisible: true, defaultWidth: 100, minWidth: 80, maxWidth: 150, sortable: true },
  { key: "listLabel", label: "List Note", defaultVisible: true, defaultWidth: 150, minWidth: 100, maxWidth: 250, sortable: true },
  { key: "label", label: "Job Label", defaultVisible: true, defaultWidth: 150, minWidth: 100, maxWidth: 250, sortable: true },
  { key: "thumbnails", label: "Preview", defaultVisible: true, defaultWidth: 140, minWidth: 120, maxWidth: 200 },
  { key: "poNumber", label: "PO #", defaultVisible: true, defaultWidth: 120, minWidth: 80, maxWidth: 180, sortable: true },
  { key: "customer", label: "Customer", defaultVisible: true, defaultWidth: 180, minWidth: 120, maxWidth: 300, sortable: true },
  { key: "status", label: "Status", defaultVisible: true, defaultWidth: 130, minWidth: 100, maxWidth: 180, sortable: true },
  { key: "paymentStatus", label: "Payment", defaultVisible: false, defaultWidth: 110, minWidth: 90, maxWidth: 150, sortable: true },
  { key: "priority", label: "Priority", defaultVisible: true, defaultWidth: 100, minWidth: 80, maxWidth: 150, sortable: true },
  { key: "dueDate", label: "Due Date", defaultVisible: true, defaultWidth: 120, minWidth: 100, maxWidth: 180, sortable: true },
  { key: "items", label: "Items", defaultVisible: true, defaultWidth: 80, minWidth: 60, maxWidth: 120, sortable: true },
  { key: "total", label: "Total", defaultVisible: true, defaultWidth: 110, minWidth: 80, maxWidth: 150, sortable: true, align: "right" },
  { key: "created", label: "Created", defaultVisible: true, defaultWidth: 110, minWidth: 90, maxWidth: 150, sortable: true },
  { key: "actions", label: "Actions", defaultVisible: true, defaultWidth: 200, minWidth: 150, maxWidth: 280 },
];

export default function Orders() {
  console.log('[PAGE_MOUNT] Orders');
  
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  useEffect(() => {
    return () => console.log('[PAGE_UNMOUNT] Orders');
  }, []);
  
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<OrderState | "all">("open"); // TitanOS: Default to open (WIP)
  const [statusPillFilter, setStatusPillFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  
  // Pagination + performance controls (persisted per org+user, matching Quotes)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [includeThumbnails, setIncludeThumbnails] = useState(true);
  
  // Attachments dialog state (list of files for an order)
  const [attachmentsDialogOpen, setAttachmentsDialogOpen] = useState(false);
  const [attachmentsDialogOrderId, setAttachmentsDialogOrderId] = useState<string | null>(null);
  const [attachmentsDialogItems, setAttachmentsDialogItems] = useState<any[]>([]);
  const [attachmentsDialogLoading, setAttachmentsDialogLoading] = useState(false);
  const [loadingAttachments, setLoadingAttachments] = useState<string | null>(null);

  const [attachmentViewerOpen, setAttachmentViewerOpen] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<any | null>(null);

  // Inline editing state
  const [editingPriorityOrderId, setEditingPriorityOrderId] = useState<string | null>(null);

  // Column settings - scoped per user (matches Quotes pattern)
  const storageKey = user?.id
    ? `titan:listview:orders:user_${user.id}`
    : "orders_column_settings"; // fallback for loading state
  const [columnSettings, setColumnSettings] = useColumnSettings(ORDER_COLUMNS, storageKey);

  // Sorting state
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  // Auto-show Payment Status column for closed/canceled views
  useEffect(() => {
    const shouldShowPayment = stateFilter === 'closed' || stateFilter === 'canceled';
    const currentSettings = columnSettings['paymentStatus'];
    const isCurrentlyVisible = currentSettings && typeof currentSettings === 'object' && 'visible' in currentSettings
      ? (currentSettings as any).visible
      : false;

    if (shouldShowPayment !== isCurrentlyVisible) {
      setColumnSettings(prev => ({
        ...prev,
        paymentStatus: {
          ...(typeof prev['paymentStatus'] === 'object' ? (prev['paymentStatus'] as any) : {}),
          visible: shouldShowPayment,
        },
      }));
    }
  }, [stateFilter, columnSettings, setColumnSettings]);

  // Reset pill filter when switching state tab (keeps filters consistent)
  useEffect(() => {
    setStatusPillFilter('all');
  }, [stateFilter]);

  const pillFilterEnabled = stateFilter === 'open' || stateFilter === 'production_complete' || stateFilter === 'closed';
  const pillFilterScope: OrderState = pillFilterEnabled ? (stateFilter as OrderState) : 'open';
  const { data: pillsForFilter, isLoading: pillsForFilterLoading } = useOrderStatusPills(pillFilterScope);

  // Computed ordered columns (ensures Actions column always last)
  const orderedColumns = useMemo(() => getColumnOrder(ORDER_COLUMNS, columnSettings), [columnSettings]);

  // Stable filters object for query key consistency
  const ordersFilters = useMemo(() => ({
    page,
    pageSize,
    includeThumbnails,
    sortBy: sortKey,
    sortDir: sortDirection,
  }), [page, pageSize, includeThumbnails, sortKey, sortDirection]);

  // Fetch orders with pagination support
  const { data: ordersData, isLoading, error } = useOrders(ordersFilters);

  const isOrdersListResponse = (data: unknown): data is OrdersListResponse => {
    return !!data && typeof data === 'object' && !Array.isArray(data) && 'items' in data;
  };

  const isPaginated = isOrdersListResponse(ordersData);
  const orders: OrderRow[] = isPaginated
    ? (ordersData.items as OrderRow[])
    : ((ordersData as OrderRow[] | undefined) ?? []);
  const totalCount = isPaginated ? ordersData.totalCount : orders.length;
  const totalPages = isPaginated ? ordersData.totalPages : 1;
  const hasNext = isPaginated ? ordersData.hasNext : false;
  const hasPrev = isPaginated ? ordersData.hasPrev : false;

  const isAdminOrOwner = user?.isAdmin || user?.role === 'owner' || user?.role === 'admin';

  // Helper to determine if a click event should prevent row navigation
  const shouldIgnoreRowNav = (e: React.MouseEvent): boolean => {
    const target = e.target as HTMLElement;
    // Check if click originated from interactive element or marked container
    return !!target.closest('button, a, input, select, textarea, [data-stop-row-nav="true"]');
  };

  // Filter orders by search, state, status, priority (client-side for Phase 1)
  const filteredOrders = useMemo(() => {
    let filtered: OrderRow[] = orders || [];
    
    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter((order: any) =>
        order.orderNumber?.toLowerCase().includes(searchLower) ||
        order.label?.toLowerCase().includes(searchLower) ||
        order.poNumber?.toLowerCase().includes(searchLower) ||
        order.customer?.companyName?.toLowerCase().includes(searchLower)
      );
    }
    
    // TitanOS: Filter by state
    if (stateFilter !== "all") {
      filtered = filtered.filter((order: any) => order.state === stateFilter);
    }

    // TitanOS: Filter by status pill within the active state scope
    if (pillFilterEnabled && statusPillFilter !== 'all') {
      filtered = filtered.filter((order: any) => (order.statusPillValue || null) === statusPillFilter);
    }
    
    if (priorityFilter !== "all") {
      filtered = filtered.filter((order: any) => order.priority === priorityFilter);
    }
    
    return filtered;
  }, [orders, search, stateFilter, pillFilterEnabled, statusPillFilter, priorityFilter]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection(key === "customer" || key === "orderNumber" || key === "status" || key === "priority" || key === "label" || key === "listLabel" ? "asc" : "desc");
    }
  };

  const SortIcon = ({ columnKey }: { columnKey: SortKey }) => {
    if (sortKey !== columnKey) return null;
    return sortDirection === "asc" 
      ? <ChevronUp className="inline w-4 h-4 ml-1" />
      : <ChevronDown className="inline w-4 h-4 ml-1" />;
  };

  // List-Label mutation (updates order_list_notes table)
  const updateListLabelMutation = useMutation({
    mutationFn: async ({ orderId, listLabel }: { orderId: string; listLabel: string }) => {
      const response = await fetch(`/api/orders/${orderId}/list-note`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listLabel }),
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to update list note');
      return response.json();
    },
    onSuccess: (_data, variables) => {
      // Optimistically update list caches
      queryClient.setQueriesData<OrdersListResponse | OrderRow[]>(
        { predicate: (query) => {
          const key = query.queryKey;
          return Array.isArray(key) && key[0] === "orders" && key[1] === "list";
        }},
        (old) => {
          if (!old) return old;
          
          // Handle paginated response
          if ('items' in old && Array.isArray(old.items)) {
            return {
              ...old,
              items: old.items.map((order) => 
                order.id === variables.orderId 
                  ? { ...order, listLabel: variables.listLabel }
                  : order
              ),
            };
          }
          
          // Handle non-paginated array
          if (Array.isArray(old)) {
            return old.map((order) =>
              order.id === variables.orderId
                ? { ...order, listLabel: variables.listLabel }
                : order
            );
          }
          
          return old;
        }
      );
      
      toast({ title: "Success", description: "List note updated" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update list note", variant: "destructive" });
    },
  });

  // Priority update mutation
  const updatePriorityMutation = useMutation({
    mutationFn: async ({ orderId, priority }: { orderId: string; priority: string }) => {
      const response = await fetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority }),
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to update priority');
      return response.json();
    },
    onSuccess: (updatedOrder, variables) => {
      // Optimistically update all list caches
      queryClient.setQueriesData<OrdersListResponse | OrderRow[]>(
        { predicate: (query) => {
          const key = query.queryKey;
          return Array.isArray(key) && key[0] === "orders" && key[1] === "list";
        }},
        (old) => {
          if (!old) return old;
          
          // Handle paginated response
          if ('items' in old && Array.isArray(old.items)) {
            return {
              ...old,
              items: old.items.map((order) => 
                order.id === variables.orderId 
                  ? { ...order, priority: variables.priority, updatedAt: updatedOrder?.updatedAt || order.updatedAt }
                  : order
              ),
            };
          }
          
          // Handle non-paginated array
          if (Array.isArray(old)) {
            return old.map((order) =>
              order.id === variables.orderId
                ? { ...order, priority: variables.priority, updatedAt: updatedOrder?.updatedAt || order.updatedAt }
                : order
            );
          }
          
          return old;
        }
      );
      
      // Invalidate detail and timeline
      queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(variables.orderId) });
      queryClient.invalidateQueries({ queryKey: orderTimelineQueryKey(variables.orderId) });
      
      setEditingPriorityOrderId(null);
      toast({ title: "Success", description: "Priority updated" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update priority", variant: "destructive" });
    },
  });

  // Open attachments dialog - fetch all attachments for the order in one call
  const openAttachmentsDialog = async (orderId: string) => {
    setAttachmentsDialogOrderId(orderId);
    setAttachmentsDialogOpen(true);
    setAttachmentsDialogItems([]);
    setAttachmentsDialogLoading(true);
    setLoadingAttachments(orderId);

    try {
      const response = await fetch(`/api/orders/${orderId}/attachments-unified`, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch attachments");
      }

      const result = await response.json();
      const attachments = result.data || [];
      setAttachmentsDialogItems(Array.isArray(attachments) ? attachments : []);
    } catch (error: any) {
      console.error("[openAttachmentsDialog] Error:", error);
      toast({
        title: "Failed to load attachments",
        description: error?.message || "Could not fetch attachment details.",
        variant: "destructive",
      });
      setAttachmentsDialogItems([]);
    } finally {
      setLoadingAttachments(null);
      setAttachmentsDialogLoading(false);
    }
  };

  // List-Label Inline Edit Cell Component (extracted to use hooks properly)
  const ListLabelCell = ({ row }: { row: OrderRow }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [localValue, setLocalValue] = useState(row.listLabel || "");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      if (isEditing && inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, [isEditing]);

    const handleSave = () => {
      if (localValue !== (row.listLabel || "")) {
        updateListLabelMutation.mutate({ orderId: row.id, listLabel: localValue });
      }
      setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleSave();
      if (e.key === 'Escape') {
        setLocalValue(row.listLabel || "");
        setIsEditing(false);
      }
    };

    if (isEditing) {
      return (
        <Input
          ref={inputRef}
          type="text"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          className="h-7 text-sm"
          data-stop-row-nav="true"
        />
      );
    }

    return (
      <div
        onClick={() => setIsEditing(true)}
        className="cursor-pointer hover:bg-accent/50 px-2 py-1 rounded min-h-[28px] flex items-center"
        title="Click to edit list note"
        data-stop-row-nav="true"
      >
        {row.listLabel || <span className="text-muted-foreground italic text-xs">Add note...</span>}
      </div>
    );
  };

  // Helper to render cell content based on column key (matches Quotes pattern)
  const renderCell = (row: OrderRow, columnKey: string) => {
    switch (columnKey) {
      case "orderNumber": {
        const { displayNumber, isTest } = getDisplayOrderNumber(row);
        return (
          <Link to={ROUTES.orders.detail(row.id)} className="text-blue-600 hover:underline font-medium flex items-center gap-1.5">
            <span>{displayNumber}</span>
            {isTest && (
              <span className="text-[10px] bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded font-medium">Test</span>
            )}
          </Link>
        );
      }

      case "listLabel":
        return <ListLabelCell row={row} />;

      case "label":
        return row.label || <span className="text-muted-foreground italic">—</span>;

      case "thumbnails": {
        const summary = row.attachmentsSummary;
        const previews = summary?.previews ?? [];
        const totalCount = summary?.totalCount ?? 0;

        const rowPreviewThumbnailUrls = Array.isArray((row as any).previewThumbnailUrls)
          ? ((row as any).previewThumbnailUrls as any[])
              .map((u) => getThumbSrc({ thumbnailUrl: u }))
              .filter((u): u is string => typeof u === 'string' && u.length > 0)
              .slice(0, 3)
          : [];

        const rowThumbSrc = getThumbSrc(row);

        if (!includeThumbnails) {
          return (
            <div className="flex items-center h-8">
              <span className="text-muted-foreground">—</span>
            </div>
          );
        }

        if ((!summary || totalCount === 0) && !rowThumbSrc) {
          return (
            <div className="flex items-center h-8">
              <span className="text-muted-foreground">—</span>
            </div>
          );
        }

        // If we have explicit preview thumbnails (attachments or line-item assets), show up to 3.
        // Keep the existing attachmentsSummary UI when attachments exist (it includes +N count).
        if ((!summary || totalCount === 0) && rowPreviewThumbnailUrls.length > 0) {
          const totalForOverflow =
            typeof (row as any).previewThumbnailCount === 'number'
              ? ((row as any).previewThumbnailCount as number)
              : rowPreviewThumbnailUrls.length;
          const extra = Math.max(0, totalForOverflow - rowPreviewThumbnailUrls.length);

          return (
            <div className="flex items-center gap-1.5 h-8" data-stop-row-nav="true">
              {rowPreviewThumbnailUrls.map((src, idx) => (
                <button
                  key={`${row.id}-preview-${idx}`}
                  type="button"
                  className="w-8 h-8 rounded overflow-hidden border border-border bg-muted/30 flex items-center justify-center"
                  onClick={(e) => {
                    e.stopPropagation();
                    openAttachmentsDialog(row.id);
                  }}
                  disabled={loadingAttachments === row.id}
                  aria-label="Open attachments"
                >
                  {loadingAttachments === row.id ? (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  ) : (
                    <img src={src} alt="Preview" className="w-full h-full object-cover" />
                  )}
                </button>
              ))}

              {extra > 0 && (
                <button
                  type="button"
                  className="h-8 px-2 rounded border border-border text-xs text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    openAttachmentsDialog(row.id);
                  }}
                  disabled={loadingAttachments === row.id}
                  aria-label={`View ${extra} more attachments`}
                >
                  +{extra}
                </button>
              )}
            </div>
          );
        }

        // If we only have a single preview thumbnail URL, keep the compact UI.
        if ((!summary || totalCount === 0) && rowThumbSrc) {
          return (
            <button
              type="button"
              className="flex items-center h-8"
              onClick={(e) => {
                e.stopPropagation();
                openAttachmentsDialog(row.id);
              }}
              disabled={loadingAttachments === row.id}
              data-stop-row-nav="true"
              aria-label="Open attachments"
            >
              {loadingAttachments === row.id ? (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              ) : (
                <img
                  src={rowThumbSrc}
                  alt="Preview"
                  className="w-8 h-8 rounded object-cover"
                />
              )}
            </button>
          );
        }

        const shown = previews.slice(0, 3);
        const extraCount = Math.max(0, totalCount - shown.length);

        return (
          <div className="flex items-center gap-1.5 h-8" data-stop-row-nav="true">
            {shown.map((p) => (
              <button
                key={p.id}
                type="button"
                className="w-8 h-8 rounded overflow-hidden border border-border bg-muted/30 flex items-center justify-center"
                onClick={(e) => {
                  e.stopPropagation();
                  openAttachmentsDialog(row.id);
                }}
                disabled={loadingAttachments === row.id}
                aria-label={`View attachment ${p.filename}`}
              >
                {getThumbSrc(p) ? (
                  <img
                    src={getThumbSrc(p) as string}
                    alt={p.filename}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <FileText className="w-4 h-4 text-muted-foreground" />
                )}
              </button>
            ))}

            {extraCount > 0 && (
              <button
                type="button"
                className="h-8 px-2 rounded border border-border text-xs text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  openAttachmentsDialog(row.id);
                }}
                disabled={loadingAttachments === row.id}
                aria-label={`View ${extraCount} more attachments`}
              >
                +{extraCount}
              </button>
            )}
          </div>
        );
      }

      case "poNumber":
        return row.poNumber || <span className="text-muted-foreground italic">—</span>;

      case "customer":
        return row.customer?.companyName || <span className="text-muted-foreground italic">No customer</span>;

      case "status": {
        // TitanOS: Editable status pill (org-configured)
        return (
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <OrderStatusPillCell
              orderId={row.id}
              state={row.state as OrderState}
              value={row.statusPillValue ?? null}
            />
          </div>
        );
      }

      case "paymentStatus": {
        const paymentStatus = (row as any).paymentStatus || "unpaid";
        const statusColors: Record<string, string> = {
          unpaid: "bg-red-100 text-red-700 border-red-200",
          partial: "bg-yellow-100 text-yellow-700 border-yellow-200",
          paid: "bg-green-100 text-green-700 border-green-200",
        };
        const statusLabels: Record<string, string> = {
          unpaid: "Unpaid",
          partial: "Partial",
          paid: "Paid",
        };
        return (
          <Badge 
            variant="outline" 
            className={`text-xs ${statusColors[paymentStatus] || statusColors.unpaid}`}
            onClick={(e) => e.stopPropagation()}
          >
            {statusLabels[paymentStatus] || paymentStatus}
          </Badge>
        );
      }

      case "priority": {
        if (!isAdminOrOwner) {
          return <OrderPriorityBadge priority={row.priority} />;
        }

        const priorities = ['rush', 'normal', 'low'];

        return (
          <Popover 
            open={editingPriorityOrderId === row.id} 
            onOpenChange={(open) => setEditingPriorityOrderId(open ? row.id : null)}
          >
            <PopoverTrigger asChild>
              <div 
                className="cursor-pointer hover:opacity-80 transition-opacity"
                data-stop-row-nav="true"
                onClick={(e) => e.stopPropagation()}
              >
                <OrderPriorityBadge priority={row.priority} />
              </div>
            </PopoverTrigger>
            <PopoverContent className="w-40 p-2" align="start">
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground px-2 py-1">Change Priority</div>
                {priorities.map((priority) => (
                  <button
                    key={priority}
                    className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-accent transition-colors"
                    onClick={() => {
                      updatePriorityMutation.mutate({ orderId: row.id, priority });
                    }}
                  >
                    <OrderPriorityBadge priority={priority} />
                    {priority === row.priority && <span className="ml-2 text-xs text-muted-foreground">(current)</span>}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        );
      }

      case "dueDate":
        return row.dueDate ? format(new Date(row.dueDate), "MMM d, yyyy") : <span className="text-muted-foreground italic">—</span>;

      case "items":
        return row.lineItemsCount || 0;

      case "total":
        return `$${parseFloat(row.total || "0").toFixed(2)}`;

      case "created":
        return format(new Date(row.createdAt), "MMM d, yyyy");

      case "actions":
        return (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate(ROUTES.orders.detail(row.id))}
            >
              <Eye className="w-4 h-4" />
            </Button>
            {isAdminOrOwner && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigate(`${ROUTES.orders.detail(row.id)}/edit`)}
              >
                <Edit className="w-4 h-4" />
              </Button>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  // Helper functions
  const getColStyle = (key: string) => {
    const raw = columnSettings[key];
    const settings: ColumnState | undefined =
      raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as ColumnState) : undefined;
    if (!settings?.visible) return { display: "none" as const };
    return { width: settings.width, minWidth: settings.width };
  };

  const isVisible = (key: string) => isColumnVisible(columnSettings, key);

  const visibleColumnCount = orderedColumns.filter((col) => isVisible(col.key)).length;

  // Format helpers
  const formatDate = (date: string | Date) => format(new Date(date), "MMM d, yyyy");
  const formatCurrency = (amount: string | number) => `$${parseFloat(String(amount) || "0").toFixed(2)}`;

  return (
    <Page maxWidth="full">
      <PageHeader
        title="Orders"
        subtitle="Manage production orders and track fulfillment"
        className="pb-3"
        backButton={
          <Button variant="ghost" size="sm" onClick={() => navigate(ROUTES.dashboard)}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
        }
        actions={
          <Link to={ROUTES.orders.new}>
            <Button size="sm">
              <Plus className="w-4 h-4 mr-2" />
              New Order
            </Button>
          </Link>
        }
      />

      <ContentLayout className="space-y-3">
        {/* TitanOS State Tabs */}
        <Tabs value={stateFilter} onValueChange={(value) => setStateFilter(value as OrderState | "all")}>
          <TabsList>
            <TabsTrigger value="open">
              Open
              {stateFilter === "open" && (
                <Badge variant="secondary" className="ml-2">
                  {filteredOrders.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="production_complete">
              Prod Complete
            </TabsTrigger>
            <TabsTrigger value="closed">
              Closed
            </TabsTrigger>
            <TabsTrigger value="canceled">
              Canceled
            </TabsTrigger>
            <TabsTrigger value="all">
              All States
            </TabsTrigger>
          </TabsList>
        </Tabs>
        
        {/* Inline Filters */}
        <div className="flex flex-row items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search orders..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          {pillFilterEnabled && (
            <Select value={statusPillFilter} onValueChange={setStatusPillFilter}>
              <SelectTrigger className="w-[200px] h-9">
                <SelectValue
                  placeholder={
                    pillsForFilterLoading
                      ? 'Loading status pills…'
                      : (!pillsForFilter || pillsForFilter.length === 0)
                      ? 'No status pills configured…'
                      : 'All Status Pills'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status Pills</SelectItem>
                {(pillsForFilter || []).map((pill) => (
                  <SelectItem key={pill.id} value={pill.name}>
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: pill.color }} />
                      {pill.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue placeholder="All Priorities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priorities</SelectItem>
              <SelectItem value="rush">Rush</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-3 whitespace-nowrap">
            <Label className="text-sm text-muted-foreground">Rows per page</Label>
            <Select value={String(pageSize)} onValueChange={(v) => setPageSize(parseInt(v, 10))}>
              <SelectTrigger className="w-[100px] h-9">
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

        {/* Orders Table */}
        <DataCard
          title="Orders"
          description={`${filteredOrders.length} order${filteredOrders.length !== 1 ? 's' : ''} found • ${totalCount} total orders`}
          className="mt-0"
          headerActions={
            <ColumnConfig
              columns={ORDER_COLUMNS}
              storageKey={storageKey}
              settings={columnSettings}
              onSettingsChange={setColumnSettings}
            />
          }
          noPadding
        >
          <div className="overflow-x-auto">
            <Table className="table-dense">
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
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={visibleColumnCount} className="text-center py-8 text-muted-foreground">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="w-6 h-6 animate-spin text-primary" />
                        <span>Loading orders...</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filteredOrders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={visibleColumnCount} className="text-center py-6 text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <Package className="w-8 h-8 text-muted-foreground" />
                        <p>No orders found</p>
                        <Link to={ROUTES.orders.new}>
                          <Button variant="outline" size="sm">
                            <Plus className="w-4 h-4 mr-2" />
                            Create first order
                          </Button>
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredOrders.map((order: any) => (
                    <TableRow 
                      key={order.id} 
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={(e) => {
                        if (!shouldIgnoreRowNav(e)) {
                          navigate(ROUTES.orders.detail(order.id));
                        }
                      }}
                    >
                      {orderedColumns.map((col) => {
                        if (!isVisible(col.key)) return null;
                        return (
                          <TableCell 
                            key={col.key}
                            style={getColStyle(col.key)}
                            className={col.align === "right" ? "text-right" : ""}
                          >
                            {renderCell(order, col.key)}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination Controls */}
          {filteredOrders.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-t">
              <div className="flex items-center gap-3">
                <div className="text-sm text-muted-foreground">
                  Showing {((page - 1) * pageSize) + 1}-{Math.min(page * pageSize, filteredOrders.length)} of {filteredOrders.length}
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="includeThumbnails"
                    checked={includeThumbnails}
                    onCheckedChange={(checked) => setIncludeThumbnails(checked === true)}
                  />
                  <Label htmlFor="includeThumbnails" className="text-sm text-muted-foreground cursor-pointer">
                    Show thumbnails
                  </Label>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </Button>
                <div className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </DataCard>
      </ContentLayout>

      {/* Attachments Dialog (reuses existing /api/orders/:orderId/attachments endpoint) */}
      <Dialog
        open={attachmentsDialogOpen}
        onOpenChange={(open) => {
          setAttachmentsDialogOpen(open);
          if (!open) {
            setAttachmentsDialogOrderId(null);
            setAttachmentsDialogItems([]);
            setAttachmentsDialogLoading(false);
            setAttachmentViewerOpen(false);
            setSelectedAttachment(null);
          }
        }}
      >
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Attachments</DialogTitle>
          </DialogHeader>

          {attachmentsDialogLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading…
            </div>
          ) : attachmentsDialogOrderId && attachmentsDialogItems.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No attachments</div>
          ) : (
            <div className="space-y-2">
              {attachmentsDialogItems.map((att: any) => {
                const filename = att?.filename || att?.originalFilename || att?.fileName || "Attachment";
                const thumbUrl = getThumbSrc(att);
                const downloadUrl = att?.downloadUrl || att?.originalUrl || null;
                const originalUrl = att?.originalUrl || null;
                const hasThumb = typeof thumbUrl === "string" && (thumbUrl.startsWith("http") || thumbUrl.startsWith("/"));

                const viewerItem = {
                  id: String(att?.id || filename),
                  fileName: filename,
                  originalFilename: att?.originalFilename || null,
                  mimeType: att?.mimeType || null,
                  fileSize: att?.fileSize ?? att?.sizeBytes ?? null,
                  originalUrl: typeof originalUrl === "string" ? originalUrl : null,
                  downloadUrl: typeof downloadUrl === "string" ? downloadUrl : null,
                  previewThumbnailUrl: att?.previewThumbnailUrl ?? null,
                  thumbnailUrl: att?.thumbnailUrl ?? null,
                  thumbUrl: att?.thumbUrl ?? null,
                  previewUrl: att?.previewUrl ?? null,
                  pages: att?.pages ?? null,
                };

                return (
                  <button
                    key={att?.id || filename}
                    type="button"
                    className="w-full text-left flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 hover:bg-muted/20"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedAttachment(viewerItem);
                      setAttachmentViewerOpen(true);
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded overflow-hidden border border-border bg-muted/30 flex items-center justify-center shrink-0">
                        {hasThumb ? (
                          <img src={thumbUrl as string} alt={filename} className="w-full h-full object-cover" />
                        ) : (
                          <FileText className="w-5 h-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{filename}</div>
                        {att?.mimeType ? (
                          <div className="text-xs text-muted-foreground truncate">{att.mimeType}</div>
                        ) : null}
                      </div>
                    </div>

                    <div className="shrink-0">
                      {typeof downloadUrl === "string" && (downloadUrl.startsWith("http") || downloadUrl.startsWith("/")) ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            void downloadFileFromUrl(downloadUrl, filename);
                          }}
                        >
                          <Download className="w-4 h-4 mr-2" />
                          Download
                        </Button>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AttachmentViewerDialog
        attachment={selectedAttachment}
        open={attachmentViewerOpen}
        onOpenChange={setAttachmentViewerOpen}
      />
    </Page>
  );
}

