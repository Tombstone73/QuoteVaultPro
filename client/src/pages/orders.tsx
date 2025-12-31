import { useState, useMemo, useEffect, useRef, Fragment } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AttachmentViewerDialog } from "@/components/AttachmentViewerDialog";
import { ArrowLeft, Plus, Search, Calendar, DollarSign, Package, Check, X, Eye, ChevronUp, ChevronDown, Copy, Edit, Printer, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useOrders, type OrderRow, type OrdersListResponse, getAllowedNextStatuses, ordersListQueryKey, orderDetailQueryKey, orderTimelineQueryKey } from "@/hooks/useOrders";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { OrderStatusBadge, OrderPriorityBadge } from "@/components/order-status-badge";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Page, PageHeader, ContentLayout, DataCard, ColumnConfig, useColumnSettings, isColumnVisible, getColumnOrder, getColumnDisplayName, type ColumnDefinition, type ColumnState } from "@/components/titan";
import { ROUTES } from "@/config/routes";
import { getDisplayOrderNumber } from "@/lib/orderUtils";

type SortKey = "date" | "orderNumber" | "poNumber" | "customer" | "total" | "dueDate" | "status" | "priority" | "items" | "label" | "listLabel";

// Column definitions for orders table (matches Quotes pattern)
const ORDER_COLUMNS: ColumnDefinition[] = [
  { key: "orderNumber", label: "Order #", defaultVisible: true, defaultWidth: 100, minWidth: 80, maxWidth: 150, sortable: true },
  { key: "listLabel", label: "List Note", defaultVisible: true, defaultWidth: 150, minWidth: 100, maxWidth: 250, sortable: true },
  { key: "label", label: "Job Label", defaultVisible: true, defaultWidth: 150, minWidth: 100, maxWidth: 250, sortable: true },
  { key: "thumbnails", label: "Preview", defaultVisible: true, defaultWidth: 140, minWidth: 120, maxWidth: 200 },
  { key: "poNumber", label: "PO #", defaultVisible: true, defaultWidth: 120, minWidth: 80, maxWidth: 180, sortable: true },
  { key: "customer", label: "Customer", defaultVisible: true, defaultWidth: 180, minWidth: 120, maxWidth: 300, sortable: true },
  { key: "status", label: "Status", defaultVisible: true, defaultWidth: 130, minWidth: 100, maxWidth: 180, sortable: true },
  { key: "priority", label: "Priority", defaultVisible: true, defaultWidth: 100, minWidth: 80, maxWidth: 150, sortable: true },
  { key: "dueDate", label: "Due Date", defaultVisible: true, defaultWidth: 120, minWidth: 100, maxWidth: 180, sortable: true },
  { key: "items", label: "Items", defaultVisible: true, defaultWidth: 80, minWidth: 60, maxWidth: 120, sortable: true },
  { key: "total", label: "Total", defaultVisible: true, defaultWidth: 110, minWidth: 80, maxWidth: 150, sortable: true, align: "right" },
  { key: "created", label: "Created", defaultVisible: true, defaultWidth: 110, minWidth: 90, maxWidth: 150, sortable: true },
  { key: "actions", label: "Actions", defaultVisible: true, defaultWidth: 200, minWidth: 150, maxWidth: 280 },
];

export default function Orders() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  
  // Pagination + performance controls (persisted per org+user, matching Quotes)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [includeThumbnails, setIncludeThumbnails] = useState(true);
  
  // Attachment viewer state (matches Quotes pattern)
  const [attachmentViewerOpen, setAttachmentViewerOpen] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<any>(null);
  const [loadingAttachments, setLoadingAttachments] = useState<string | null>(null);
  
  // Inline editing state
  const [editingStatusOrderId, setEditingStatusOrderId] = useState<string | null>(null);
  const [editingPriorityOrderId, setEditingPriorityOrderId] = useState<string | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [pendingStatusChange, setPendingStatusChange] = useState<{ orderId: string; toStatus: string } | null>(null);
  
  // Column settings - scoped per user (matches Quotes pattern)
  const storageKey = user?.id 
    ? `titan:listview:orders:user_${user.id}` 
    : "orders_column_settings"; // fallback for loading state
  const [columnSettings, setColumnSettings] = useColumnSettings(ORDER_COLUMNS, storageKey);
  
  // Sorting state
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

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

  // Determine if paginated response
  const isPaginated = ordersData && typeof ordersData === 'object' && 'items' in ordersData;
  const orders: OrderRow[] = isPaginated 
    ? (ordersData as OrdersListResponse).items 
    : (ordersData ? (ordersData as OrderRow[]) : []);
  const totalCount = isPaginated ? (ordersData as OrdersListResponse).totalCount : orders.length;
  const totalPages = isPaginated ? (ordersData as OrdersListResponse).totalPages : 1;
  const hasNext = isPaginated ? (ordersData as OrdersListResponse).hasNext : false;
  const hasPrev = isPaginated ? (ordersData as OrdersListResponse).hasPrev : false;

  const isAdminOrOwner = user?.isAdmin || user?.role === 'owner' || user?.role === 'admin';

  // Helper to determine if a click event should prevent row navigation
  const shouldIgnoreRowNav = (e: React.MouseEvent): boolean => {
    const target = e.target as HTMLElement;
    // Check if click originated from interactive element or marked container
    return !!target.closest('button, a, input, select, textarea, [data-stop-row-nav="true"]');
  };

  // Filter orders by search, status, priority (client-side for Phase 1)
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
    
    if (statusFilter !== "all") {
      filtered = filtered.filter((order: any) => order.status === statusFilter);
    }
    
    if (priorityFilter !== "all") {
      filtered = filtered.filter((order: any) => order.priority === priorityFilter);
    }
    
    return filtered;
  }, [orders, search, statusFilter, priorityFilter]);

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

  // Status transition mutation
  const transitionStatusMutation = useMutation({
    mutationFn: async ({ orderId, toStatus }: { orderId: string; toStatus: string }) => {
      const response = await fetch(`/api/orders/${orderId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStatus }),
        credentials: 'include',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to transition status');
      }
      return data;
    },
    onSuccess: (response, variables) => {
      const updatedOrder = response?.data;
      
      // Optimistically update all list caches
      queryClient.setQueriesData<OrdersListResponse | OrderRow[]>(
        { predicate: (query) => {
          const key = query.queryKey;
          return Array.isArray(key) && key[0] === "orders" && key[1] === "list";
        }},
        (old) => {
          if (!old || !updatedOrder) return old;
          
          // Handle paginated response
          if ('items' in old && Array.isArray(old.items)) {
            return {
              ...old,
              items: old.items.map((order) => 
                order.id === variables.orderId 
                  ? { ...order, status: updatedOrder.status, updatedAt: updatedOrder.updatedAt }
                  : order
              ),
            };
          }
          
          // Handle non-paginated array
          if (Array.isArray(old)) {
            return old.map((order) =>
              order.id === variables.orderId
                ? { ...order, status: updatedOrder.status, updatedAt: updatedOrder.updatedAt }
                : order
            );
          }
          
          return old;
        }
      );
      
      // Invalidate detail and timeline
      queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(variables.orderId) });
      queryClient.invalidateQueries({ queryKey: orderTimelineQueryKey(variables.orderId) });
      
      setEditingStatusOrderId(null);
      toast({ title: "Success", description: "Order status updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
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

  // Handle status change with confirmation for terminal states
  const handleStatusChange = (orderId: string, toStatus: string) => {
    if (toStatus === 'canceled' || toStatus === 'completed') {
      setPendingStatusChange({ orderId, toStatus });
      setConfirmDialogOpen(true);
    } else {
      transitionStatusMutation.mutate({ orderId, toStatus });
    }
  };

  const confirmStatusChange = () => {
    if (pendingStatusChange) {
      transitionStatusMutation.mutate(pendingStatusChange);
      setPendingStatusChange(null);
      setConfirmDialogOpen(false);
    }
  };

  // Handle thumbnail click - fetch attachment details and open viewer (matches Quotes pattern)
  const handleThumbnailClick = async (orderId: string, thumbKey: string) => {
    setLoadingAttachments(orderId);
    
    try {
      // Fetch all attachments for the order (including line item attachments)
      const response = await fetch(`/api/orders/${orderId}/attachments?includeLineItems=true`, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch attachments');
      }
      
      const result = await response.json();
      const attachments = result.data || [];
      
      // Find the attachment matching this thumbnail
      // thumbKey format: "uploads/org_xxx/orders/order_xxx/attachment_xxx.thumb.jpg"
      let matchedAttachment = attachments.find((att: any) => att.thumbKey === thumbKey);
      
      // Fallback: if no exact match, try finding by attachment ID in thumbKey
      if (!matchedAttachment && thumbKey.includes('attachment_')) {
        const attachmentIdMatch = thumbKey.match(/attachment_([^.\/]+)/);
        if (attachmentIdMatch) {
          const attachmentId = attachmentIdMatch[1];
          matchedAttachment = attachments.find((att: any) => att.id.includes(attachmentId));
        }
      }
      
      // If still no match, use first attachment as fallback
      if (!matchedAttachment && attachments.length > 0) {
        matchedAttachment = attachments[0];
      }
      
      if (matchedAttachment) {
        // Ensure orderId is available for download
        setSelectedAttachment({ ...matchedAttachment, orderId });
        setAttachmentViewerOpen(true);
      } else {
        toast({
          title: "No attachment found",
          description: "Could not locate the attachment details.",
          variant: "destructive"
        });
      }
    } catch (error: any) {
      console.error('[handleThumbnailClick] Error:', error);
      toast({
        title: "Failed to load attachment",
        description: error.message || "Could not fetch attachment details.",
        variant: "destructive"
      });
    } finally {
      setLoadingAttachments(null);
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
        const thumbs = row.previewThumbnails || [];
        const thumbsCount = row.thumbsCount || 0;
        const isLoadingThis = loadingAttachments === row.id;
        
        if (thumbsCount === 0) {
          return <span className="text-muted-foreground italic text-xs">No attachments</span>;
        }
        
        return (
          <div className="flex items-center gap-1">
            {isLoadingThis && (
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
            )}
            {thumbs.slice(0, 3).map((thumbKey, idx) => (
              <button
                key={idx}
                type="button"
                className="w-8 h-8 rounded border border-border overflow-hidden hover:ring-2 hover:ring-primary transition-all disabled:opacity-50"
                onClick={(e) => {
                  e.stopPropagation();
                  handleThumbnailClick(row.id, thumbKey);
                }}
                disabled={isLoadingThis}
              >
                <img
                  src={thumbKey}
                  alt={`Preview ${idx + 1}`}
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
            {thumbsCount > 3 && (
              <span className="text-xs text-muted-foreground ml-1">+{thumbsCount - 3}</span>
            )}
          </div>
        );
      }

      case "poNumber":
        return row.poNumber || <span className="text-muted-foreground italic">—</span>;

      case "customer":
        return row.customer?.companyName || <span className="text-muted-foreground italic">No customer</span>;

      case "status": {
        if (!isAdminOrOwner) {
          return <OrderStatusBadge status={row.status} />;
        }

        const allowedStatuses = getAllowedNextStatuses(row.status);
        const isTerminal = allowedStatuses.length === 0;

        return (
          <Popover 
            open={editingStatusOrderId === row.id} 
            onOpenChange={(open) => setEditingStatusOrderId(open ? row.id : null)}
          >
            <PopoverTrigger asChild>
              <div 
                className="cursor-pointer hover:opacity-80 transition-opacity"
                data-stop-row-nav="true"
                onClick={(e) => e.stopPropagation()}
              >
                <OrderStatusBadge status={row.status} />
              </div>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-2" align="start">
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground px-2 py-1">Change Status</div>
                {isTerminal ? (
                  <div className="text-xs text-muted-foreground px-2 py-1">No transitions available</div>
                ) : (
                  <>
                    <button
                      className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-accent transition-colors"
                      onClick={() => {
                        setEditingStatusOrderId(null);
                      }}
                    >
                      <OrderStatusBadge status={row.status} /> (current)
                    </button>
                    {allowedStatuses.map((status) => (
                      <button
                        key={status}
                        className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-accent transition-colors"
                        onClick={() => handleStatusChange(row.id, status)}
                      >
                        <OrderStatusBadge status={status} />
                      </button>
                    ))}
                  </>
                )}
              </div>
            </PopoverContent>
          </Popover>
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
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px] h-9">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
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

      {/* Attachment Viewer Dialog (matches Quotes pattern) */}
      {attachmentViewerOpen && selectedAttachment && (
        <AttachmentViewerDialog
          open={attachmentViewerOpen}
          onOpenChange={setAttachmentViewerOpen}
          attachment={selectedAttachment}
          onDownload={async (att) => {
            // Simple download - open URL in new tab
            if (att.originalUrl) {
              window.open(att.originalUrl, '_blank');
            }
          }}
        />
      )}

      {/* Confirmation Dialog for Terminal Status Changes */}
      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Status Change</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingStatusChange?.toStatus === 'canceled' 
                ? 'Are you sure you want to cancel this order? This action marks the order as canceled and cannot be reversed.'
                : 'Are you sure you want to mark this order as completed? This action finalizes the order and cannot be reversed.'
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setPendingStatusChange(null);
              setEditingStatusOrderId(null);
            }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmStatusChange}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

