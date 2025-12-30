import { useState, useMemo, useEffect, useRef, Fragment } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AttachmentViewerDialog } from "@/components/AttachmentViewerDialog";
import { ArrowLeft, Plus, Search, Calendar, DollarSign, Package, Check, X, Eye, ChevronUp, ChevronDown, Copy, Edit, Printer, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useOrders, type OrderRow, type OrdersListResponse } from "@/hooks/useOrders";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { OrderStatusBadge, OrderPriorityBadge } from "@/components/order-status-badge";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Page, PageHeader, ContentLayout, DataCard, ColumnConfig, useColumnSettings, isColumnVisible, getColumnOrder, getColumnDisplayName, type ColumnDefinition } from "@/components/titan";
import { ROUTES } from "@/config/routes";

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

  // Fetch orders with pagination support
  const { data: ordersData, isLoading, error } = useOrders({
    page,
    pageSize,
    includeThumbnails,
    sortBy: sortKey,
    sortDir: sortDirection,
  });

  // Determine if paginated response
  const isPaginated = ordersData && typeof ordersData === 'object' && 'items' in ordersData;
  const orders = isPaginated ? (ordersData as OrdersListResponse).items : (ordersData as any[] || []);
  const totalCount = isPaginated ? (ordersData as OrdersListResponse).totalCount : orders.length;
  const totalPages = isPaginated ? (ordersData as OrdersListResponse).totalPages : 1;
  const hasNext = isPaginated ? (ordersData as OrdersListResponse).hasNext : false;
  const hasPrev = isPaginated ? (ordersData as OrdersListResponse).hasPrev : false;

  const isAdminOrOwner = user?.isAdmin || user?.role === 'owner' || user?.role === 'admin';

  // Filter orders by search, status, priority (client-side for Phase 1)
  const filteredOrders = useMemo(() => {
    let filtered = orders;
    
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api', 'orders'] });
      toast({ title: "Success", description: "List note updated" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update list note", variant: "destructive" });
    },
  });

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
        />
      );
    }

    return (
      <div
        onClick={() => setIsEditing(true)}
        className="cursor-pointer hover:bg-accent/50 px-2 py-1 rounded min-h-[28px] flex items-center"
        title="Click to edit list note"
      >
        {row.listLabel || <span className="text-muted-foreground italic text-xs">Add note...</span>}
      </div>
    );
  };

  // Helper to render cell content based on column key (matches Quotes pattern)
  const renderCell = (row: OrderRow, columnKey: string) => {
    switch (columnKey) {
      case "orderNumber":
        return (
          <Link to={ROUTES.orders.detail(row.id)} className="text-blue-600 hover:underline font-medium">
            {row.orderNumber || `#${row.id.slice(0, 8)}`}
          </Link>
        );

      case "listLabel":
        return <ListLabelCell row={row} />;

      case "label":
        return row.label || <span className="text-muted-foreground italic">—</span>;

      case "thumbnails": {
        const thumbs = row.previewThumbnails || [];
        const thumbsCount = row.thumbsCount || 0;
        if (thumbsCount === 0) {
          return <span className="text-muted-foreground italic text-xs">No attachments</span>;
        }
        return (
          <div className="flex items-center gap-1">
            {thumbs.slice(0, 3).map((url, idx) => (
              <img
                key={idx}
                src={url}
                alt={`Preview ${idx + 1}`}
                className="w-8 h-8 object-cover rounded border border-border cursor-pointer hover:ring-2 hover:ring-primary"
                onClick={() => {
                  // TODO: Open AttachmentViewerDialog (Checkpoint 5)
                }}
              />
            ))}
            {thumbsCount > 3 && (
              <span className="text-xs text-muted-foreground">+{thumbsCount - 3}</span>
            )}
          </div>
        );
      }

      case "poNumber":
        return row.poNumber || <span className="text-muted-foreground italic">—</span>;

      case "customer":
        return row.customer?.companyName || <span className="text-muted-foreground italic">No customer</span>;

      case "status":
        return <OrderStatusBadge status={row.status} />;

      case "priority":
        return <OrderPriorityBadge priority={row.priority} />;

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
    const setting = columnSettings?.[key];
    const def = ORDER_COLUMNS.find((c) => c.key === key);
    // Check if setting is a ColumnState (not the _columnOrder array)
    const width = (setting && typeof setting === 'object' && 'width' in setting) ? setting.width : (def?.defaultWidth || 150);
    return { width: `${width}px`, minWidth: `${def?.minWidth || 80}px`, maxWidth: `${def?.maxWidth || 300}px` };
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
                      onClick={() => navigate(ROUTES.orders.detail(order.id))}
                    >
                      {orderedColumns.map((col) => {
                        if (!isVisible(col.key)) return null;
                        return (
                          <TableCell 
                            key={col.key}
                            style={getColStyle(col.key)}
                            className={col.align === "right" ? "text-right" : ""}
                            onClick={(e) => {
                              // Allow inline editing for listLabel without triggering row click
                              if (col.key === "listLabel") {
                                e.stopPropagation();
                              }
                            }}
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
    </Page>
  );
}

