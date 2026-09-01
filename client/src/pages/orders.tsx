import { useState, useMemo, useEffect, useRef, Fragment } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PrintTicketButton } from "@/components/production/PrintTicketButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Search, Calendar, DollarSign, Package, Check, X, Eye, ChevronUp, ChevronDown, Copy, Edit, Printer, Loader2, FileText, Download, RotateCcw, Ban } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useOrders, type OrderRow, type OrdersListResponse, orderDetailQueryKey, orderTimelineQueryKey } from "@/hooks/useOrders";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { OrderPriorityBadge } from "@/components/order-status-badge";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Page, PageHeader, ContentLayout, DataCard, ColumnConfig, useColumnSettings, isColumnVisible, getColumnOrder, getColumnDisplayName, type ColumnDefinition, type ColumnState } from "@/components/titan";
import { ROUTES } from "@/config/routes";
import { buildReferrer } from "@/lib/nav/smartBack";
import { useSmartBack } from "@/hooks/useSmartBack";
import { getDisplayOrderNumber } from "@/lib/orderUtils";
import { cn } from "@/lib/utils";
// TitanOS State Architecture
import { Badge } from "@/components/ui/badge";
import type { OrderState } from "@/hooks/useOrderState";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOrderStatusPills } from "@/hooks/useOrderStatusPills";
import { getThumbSrc } from "@/lib/getThumbSrc";
import { resolveObjectsPublicUrl } from "@/lib/apiConfig";
import { AttachmentViewerDialog, type AttachmentData } from "@/components/AttachmentViewerDialog";
import { downloadFileFromUrl } from "@/lib/downloadFile";
import { toAttachmentViewerAttachments } from "@/lib/attachmentViewer";
import { normalizeOrderFileRows } from "@/lib/attachments/orderFileRows";
import BackNavControls from "@/components/BackNavControls";
import { buildProofingLineItemPath } from "@/lib/proofingNavigation";
import { getOrderProofBadgeClass } from "@/lib/orderProofUi";
import { canOpenProofingFromOrderStatus, type OrderProofStatus } from "@shared/orderProofStatus";
import { OrdersListStatusCell } from "@/components/orders/OrdersListStatusCell";
import { isOrdersRowNavigationExcluded } from "@/lib/ordersRowNavigation";
import {
  activeOrderStatusPills,
  hideCompleteOrderStatusPill,
  orderStatusPillFilterLabel,
  orderStatusPillIdsForQuery,
  selectedOrderStatusPillIds,
  toggleOrderStatusPillId,
} from "@/lib/orderStatusPillFilter";
import {
  DEFAULT_ORDERS_LIST_PREFERENCES,
  persistOrdersListPreferences,
  readPersistedOrdersListPreferences,
  resolveOrdersListViewPreferences,
  type OrdersListSortKey,
} from "@/lib/ordersListPreferences";

type SortKey = OrdersListSortKey;
type ProductionFilterValue = "all" | "needs_handoff" | "partial" | "action_needed";
type ProofFilterValue = "all" | "needs_action";

function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [delayMs, value]);
  return debouncedValue;
}

function ProductionSummaryBadge({
  summary,
  onClick,
}: {
  summary?: OrderRow["productionSummary"];
  onClick?: () => void;
}) {
  const normalized = summary ?? {
    requiredCount: 0,
    handedOffCount: 0,
    pendingHandoffCount: 0,
    inProductionCount: 0,
    completeCount: 0,
    status: "none" as const,
    printerNames: [],
    stationKeys: [],
    stationLabel: "Unassigned",
  };

  const config: Record<NonNullable<OrderRow["productionSummary"]>["status"], { label: string; className: string }> = {
    none: { label: "None", className: "bg-slate-200 text-slate-500 border-slate-300" },
    clear: { label: "Clear", className: "bg-stone-100 text-stone-700 border-stone-300" },
    needs_handoff: { label: "Needs Production", className: "bg-red-200 text-red-950 border-red-300" },
    partial: { label: "Partial", className: "bg-amber-200 text-amber-950 border-amber-300" },
    in_production: { label: "In Production", className: "bg-sky-200 text-sky-950 border-sky-300" },
    complete: { label: "Complete", className: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  };

  const details = [
    `Required: ${normalized.requiredCount}`,
    `Handed Off: ${normalized.handedOffCount}`,
    `Pending: ${normalized.pendingHandoffCount}`,
    `Active: ${normalized.inProductionCount}`,
    `Complete: ${normalized.completeCount}`,
    `Station: ${normalized.stationLabel || "Unassigned"}`,
    normalized.printerNames?.length ? `Printers: ${normalized.printerNames.join(", ")}` : "Printers: Unassigned",
  ].join(" | ");

  const countSuffix = normalized.pendingHandoffCount > 0 && (normalized.status === "needs_handoff" || normalized.status === "partial")
    ? ` (${normalized.pendingHandoffCount})`
    : "";
  const isActionable = normalized.status === "needs_handoff" || normalized.status === "partial";

  if (normalized.status === "none") {
    return (
      <span className="inline-flex h-5 items-center" title={details} aria-label="No production activity">
        <span className="h-2 w-2 rounded-full border border-slate-300 bg-slate-200" />
      </span>
    );
  }

  const badgeNode = (
    <Badge
      variant="outline"
      className={cn(
        "h-5 px-1.5 text-[11px] font-semibold leading-none whitespace-nowrap shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.25)]",
        config[normalized.status].className,
        isActionable && onClick ? "cursor-pointer hover:brightness-95" : ""
      )}
      title={details}
    >
      {config[normalized.status].label}{countSuffix}
      <span className="ml-1 font-normal opacity-80">/ {normalized.stationLabel || "Unassigned"}</span>
    </Badge>
  );

  if (isActionable && onClick) {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        className="inline-flex items-center"
        title={details}
      >
        {badgeNode}
      </button>
    );
  }

  return badgeNode;
}

function ProofSummaryBadge({
  row,
}: {
  row: OrderRow;
}) {
  const status = row.proofStatus ?? "no_proof_required";
  const label = row.proofStatusLabel ?? "No Proof Needed";
  const canOpenProofing = Boolean(row.proofLineItemId) && canOpenProofingFromOrderStatus(status);

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-stop-row-nav="true">
      <Badge variant="outline" className={cn("h-5 px-1.5 text-[11px] font-semibold whitespace-nowrap", getOrderProofBadgeClass(status))}>
        {label}
      </Badge>
      {canOpenProofing ? (
        <Button asChild type="button" variant="ghost" size="sm" className="h-6 px-2 text-[11px]">
          <Link to={buildProofingLineItemPath(String(row.proofLineItemId))}>Open Proofing</Link>
        </Button>
      ) : null}
    </div>
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
  { key: "production", label: "Production", defaultVisible: true, defaultWidth: 160, minWidth: 120, maxWidth: 200 },
  { key: "proof", label: "Proof", defaultVisible: true, defaultWidth: 210, minWidth: 150, maxWidth: 280 },
  { key: "invoiceStatus", label: "Invoice", defaultVisible: true, defaultWidth: 130, minWidth: 110, maxWidth: 180, sortable: false },
  { key: "paymentStatus", label: "Payment", defaultVisible: false, defaultWidth: 110, minWidth: 90, maxWidth: 150, sortable: true },
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
  const location = useLocation();
  const queryClient = useQueryClient();
  const { onSmartBack } = useSmartBack();
  
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());
  const [stateFilter, setStateFilter] = useState<OrderState | "all">("open"); // TitanOS: Default to open (WIP)
  // null means every active pill is included. An empty array intentionally
  // means no pills are included, producing a server-backed empty result.
  const [statusPillSelection, setStatusPillSelection] = useState<string[] | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [productionFilter, setProductionFilter] = useState<ProductionFilterValue>("all");
  const [proofFilter, setProofFilter] = useState<ProofFilterValue>("all");
  
  // Pagination + performance controls. Page size is persisted independently
  // from sorting; the current page intentionally remains session-only.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [includeThumbnails, setIncludeThumbnails] = useState(false);
  
  // Attachments dialog state (list of files for an order)
  const [attachmentsDialogOpen, setAttachmentsDialogOpen] = useState(false);
  const [attachmentsDialogOrderId, setAttachmentsDialogOrderId] = useState<string | null>(null);
  const [attachmentsDialogItems, setAttachmentsDialogItems] = useState<any[]>([]);
  const [attachmentsDialogLoading, setAttachmentsDialogLoading] = useState(false);
  const [loadingAttachments, setLoadingAttachments] = useState<string | null>(null);
  const [pendingStateAction, setPendingStateAction] = useState<{ order: OrderRow; action: "complete" | "close" | "reopen" | "cancel" } | null>(null);
  const [stateActionNote, setStateActionNote] = useState("");

  const [attachmentViewerOpen, setAttachmentViewerOpen] = useState(false);
  const [selectedAttachmentIndex, setSelectedAttachmentIndex] = useState(0);

  const normalizedAttachmentViewerItems = useMemo(
    () => toAttachmentViewerAttachments(attachmentsDialogItems),
    [attachmentsDialogItems]
  ) as AttachmentData[];

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
  const [stickySorting, setStickySorting] = useState(false);
  const [preferencesLoadedScope, setPreferencesLoadedScope] = useState<string | null>(null);
  const ordersPreferenceScope = user?.id
    ? `${user.lastActiveOrgId ?? "unknown"}:${user.id}`
    : null;

  // Restore only this user's active-organization preference. The status-pill
  // filter belongs to sticky sorting; thumbnails are an independent display
  // preference. Other filters and page number remain session-only.
  useEffect(() => {
    if (!user?.id || !ordersPreferenceScope) {
      setPreferencesLoadedScope(null);
      return;
    }

    const preferences = resolveOrdersListViewPreferences(
      readPersistedOrdersListPreferences(user.id, user.lastActiveOrgId ?? null),
    );
    setStickySorting(preferences.stickySorting);
    setPageSize(preferences.pageSize);
    setSortKey(preferences.sortKey);
    setSortDirection(preferences.sortDirection);
    setStatusPillSelection(preferences.statusPillSelection);
    setIncludeThumbnails(preferences.includeThumbnails);
    setPreferencesLoadedScope(ordersPreferenceScope);
  }, [ordersPreferenceScope, user?.id, user?.lastActiveOrgId]);

  useEffect(() => {
    if (!user?.id || !ordersPreferenceScope || preferencesLoadedScope !== ordersPreferenceScope) return;

    persistOrdersListPreferences(user.id, user.lastActiveOrgId ?? null, {
      version: 1,
      stickySorting,
      // Turning sticky sorting off deliberately clears the remembered sort.
      sortKey: stickySorting ? sortKey : DEFAULT_ORDERS_LIST_PREFERENCES.sortKey,
      sortDirection: stickySorting ? sortDirection : DEFAULT_ORDERS_LIST_PREFERENCES.sortDirection,
      pageSize,
      // Turning sticky sorting off clears only its filter ownership. The
      // thumbnail setting remains a display preference in every mode.
      statusPillSelection: stickySorting ? statusPillSelection : null,
      includeThumbnails,
    });
  }, [includeThumbnails, ordersPreferenceScope, pageSize, preferencesLoadedScope, sortDirection, sortKey, statusPillSelection, stickySorting, user?.id, user?.lastActiveOrgId]);

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

  const pillFilterEnabled = true;
  const { data: pillsForFilter, isLoading: pillsForFilterLoading } = useOrderStatusPills();
  const activeStatusPills = useMemo(() => activeOrderStatusPills(pillsForFilter), [pillsForFilter]);
  const selectedStatusPillIds = useMemo(
    () => selectedOrderStatusPillIds(statusPillSelection, activeStatusPills),
    [statusPillSelection, activeStatusPills],
  );
  const statusPillIdsForQuery = useMemo(
    () => orderStatusPillIdsForQuery(statusPillSelection, activeStatusPills),
    [statusPillSelection, activeStatusPills],
  );
  const statusPillFilterLabel = useMemo(
    () => orderStatusPillFilterLabel(statusPillSelection, activeStatusPills),
    [statusPillSelection, activeStatusPills],
  );
  const completeStatusPill = activeStatusPills.find((pill) =>
    pill.name.trim().toLowerCase() === "complete" || pill.key === "complete",
  );

  // Computed ordered columns (ensures Actions column always last)
  const orderedColumns = useMemo(() => getColumnOrder(ORDER_COLUMNS, columnSettings), [columnSettings]);

  // Stable filters object for query key consistency
  const ordersFilters = useMemo(() => ({
    search: debouncedSearch || undefined,
    state: stateFilter === "all" ? undefined : stateFilter,
    statusPillIds: statusPillIdsForQuery,
    priority: priorityFilter === "all" ? undefined : priorityFilter,
    page,
    pageSize,
    includeThumbnails,
    sortBy: sortKey,
    sortDir: sortDirection,
  }), [debouncedSearch, stateFilter, statusPillIdsForQuery, priorityFilter, page, pageSize, includeThumbnails, sortKey, sortDirection]);

  // Every change to the server query shape starts at the first matching page.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, stateFilter, statusPillIdsForQuery, priorityFilter, productionFilter, proofFilter, pageSize, sortKey, sortDirection]);

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

  // Core identity/state/pill/priority filtering is server-side and paginated.
  // Production/proof summaries are derived list projections for this page.
  const baseFilteredOrders = useMemo(() => {
    return orders || [];
  }, [orders]);

  const filteredOrders = useMemo(() => {
    let filtered = baseFilteredOrders;

    if (productionFilter !== "all") {
      filtered = filtered.filter((order: any) => {
      const productionStatus = order.productionSummary?.status || "none";

      if (productionFilter === "action_needed") {
        return productionStatus === "needs_handoff" || productionStatus === "partial";
      }

      return productionStatus === productionFilter;
      });
    }

    if (proofFilter === "needs_action") {
      filtered = filtered.filter((order) => order.proofActionRequired === true);
    }

    return filtered;
  }, [baseFilteredOrders, productionFilter, proofFilter]);

  const actionNeededCount = useMemo(
    () => baseFilteredOrders.filter((order) => {
      const productionStatus = order.productionSummary?.status || "none";
      return productionStatus === "needs_handoff" || productionStatus === "partial";
    }).length,
    [baseFilteredOrders]
  );

  const handleActionNeededCounterClick = () => {
    setProductionFilter((current) => current === "action_needed" ? "all" : "action_needed");
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection(key === "customer" || key === "orderNumber" || key === "status" || key === "priority" || key === "label" || key === "listLabel" ? "asc" : "desc");
    }
  };

  const handleStickySortingChange = (checked: boolean) => {
    setStickySorting(checked);
    if (!checked) {
      setSortKey(DEFAULT_ORDERS_LIST_PREFERENCES.sortKey);
      setSortDirection(DEFAULT_ORDERS_LIST_PREFERENCES.sortDirection);
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

  const orderStateMutation = useMutation({
    mutationFn: async ({ orderId, action, note }: { orderId: string; action: "complete" | "close" | "reopen" | "cancel"; note: string }) => {
      const request = action === "complete"
        ? { url: `/api/orders/${orderId}/complete`, method: "POST", body: { notes: note || undefined } }
        : action === "close"
        ? { url: `/api/orders/${orderId}/close`, method: "POST", body: { notes: note || undefined, confirmUnpaidInvoices: true } }
        : action === "reopen"
          ? { url: `/api/orders/${orderId}/reopen`, method: "POST", body: { reason: note, targetState: "open" } }
          : { url: `/api/orders/${orderId}/cancel`, method: "POST", body: { reason: "other", internalNote: note || undefined } };
      const response = await fetch(request.url, {
        method: request.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.body),
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || `Failed to ${action} order`);
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["orders", "list"] });
      queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(variables.orderId) });
      queryClient.invalidateQueries({ queryKey: orderTimelineQueryKey(variables.orderId) });
      setPendingStateAction(null);
      setStateActionNote("");
      toast({ title: "Order updated", description: `Order ${variables.action === "complete" ? "completed" : variables.action === "close" ? "closed" : variables.action === "reopen" ? "reopened" : "cancelled"}.` });
    },
    onError: (error: Error) => toast({ title: "Status update failed", description: error.message, variant: "destructive" }),
  });

  // Open attachments dialog - fetch current stabilized order file rows in one call
  const openAttachmentsDialog = async (orderId: string) => {
    setAttachmentsDialogOrderId(orderId);
    setAttachmentsDialogOpen(true);
    setAttachmentsDialogItems([]);
    setAttachmentsDialogLoading(true);
    setLoadingAttachments(orderId);

    try {
      const response = await fetch(`/api/orders/${orderId}/files`, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch attachments");
      }

      const result = await response.json();
      const attachments = normalizeOrderFileRows(
        Array.isArray(result?.data) ? result.data : [],
        Array.isArray(result?.assets) ? result.assets : [],
      );
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
          <Link to={ROUTES.orders.detail(row.id)} state={{ referrer: buildReferrer(location) }} className="text-sm text-blue-600 hover:underline font-medium flex items-center gap-1.5">
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
                    <img
                      src={resolveObjectsPublicUrl(src) ?? src}
                      alt="Preview"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        if (import.meta.env.DEV) {
                          console.info(`[thumb] failed url=${e.currentTarget.src}`);
                        }
                      }}
                    />
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
        return row.customer?.companyName || [row.contact?.firstName, row.contact?.lastName].filter(Boolean).join(" ") || row.contact?.email || <span className="text-muted-foreground italic">No customer or contact</span>;

      case "status": {
        return <OrdersListStatusCell row={row} />;
      }

      case "invoiceStatus": {
        const invoiceState = row.invoiceState;
        const statusKey = invoiceState?.key || "not_invoiced";
        const statusColors: Record<string, string> = {
          not_invoiced: "bg-slate-100 text-slate-700 border-slate-300",
          ready_to_invoice: "bg-blue-100 text-blue-800 border-blue-300",
          invoice_draft: "bg-amber-100 text-amber-800 border-amber-300",
          invoice_finalized: "bg-indigo-100 text-indigo-800 border-indigo-300",
          invoice_sent: "bg-sky-100 text-sky-800 border-sky-300",
          partially_paid: "bg-yellow-100 text-yellow-800 border-yellow-300",
          paid: "bg-green-100 text-green-800 border-green-300",
          overdue: "bg-red-100 text-red-800 border-red-300",
        };
        return (
          <Badge
            variant="outline"
            className={`text-xs ${statusColors[statusKey] || statusColors.not_invoiced}`}
            onClick={(e) => e.stopPropagation()}
          >
            {invoiceState?.label || "Not invoiced"}
          </Badge>
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

      case "production": {
        return (
          <ProductionSummaryBadge
            summary={row.productionSummary}
            onClick={
              row.productionSummary?.status === "needs_handoff" || row.productionSummary?.status === "partial"
                ? () => navigate(`${ROUTES.orders.detail(row.id)}?focusProduction=1&productionStatus=${row.productionSummary?.status}`, {
                    state: { referrer: buildReferrer(location) },
                  })
                : undefined
            }
          />
        );
      }

      case "proof": {
        return <ProofSummaryBadge row={row} />;
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
          <div className="flex gap-1" data-stop-row-nav="true">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate(ROUTES.orders.detail(row.id), { state: { referrer: buildReferrer(location) } })}
            >
              <Eye className="w-4 h-4" />
            </Button>
            <PrintTicketButton orderId={row.id} iconOnly variant="ghost" />
            {isAdminOrOwner && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigate(ROUTES.orders.edit(row.id), { state: { referrer: buildReferrer(location) } })}
                  title="Edit order"
                >
                  <Edit className="w-4 h-4" />
                </Button>
                {row.state === "closed" ? (
                  <Button size="sm" variant="ghost" onClick={() => setPendingStateAction({ order: row, action: "reopen" })} title="Reopen order">
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                ) : row.state !== "canceled" ? (
                  <>
                    {row.state === "production_complete" && row.routingTarget === "fulfillment" && (row.fulfillmentStatus === "shipped" || row.fulfillmentStatus === "delivered") && (
                      <Button size="sm" variant="ghost" onClick={() => setPendingStateAction({ order: row, action: "complete" })} title="Complete order">
                        <Check className="w-4 h-4" />
                      </Button>
                    )}
                    {row.state === "production_complete" && row.routingTarget !== "fulfillment" && row.invoiceState?.key === "paid" && (
                      <Button size="sm" variant="ghost" onClick={() => setPendingStateAction({ order: row, action: "close" })} title="Close order">
                        <Check className="w-4 h-4" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setPendingStateAction({ order: row, action: "cancel" })} title="Cancel order">
                      <Ban className="w-4 h-4" />
                    </Button>
                  </>
                ) : null}
              </>
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
          <BackNavControls onBack={onSmartBack} />
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
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 w-[200px] justify-between font-normal"
                  disabled={pillsForFilterLoading || activeStatusPills.length === 0}
                  aria-label="Filter orders by status pills"
                >
                  <span className="truncate">
                    {pillsForFilterLoading ? "Loading status pills…" : statusPillFilterLabel}
                  </span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[260px] p-2" align="start">
                <div className="mb-2 flex items-center justify-between gap-2 border-b pb-2">
                  <span className="text-sm font-medium">Status Pills</span>
                  <div className="flex items-center gap-1">
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setStatusPillSelection(activeStatusPills.map((pill) => pill.id))}>
                      Select All
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setStatusPillSelection([])}>
                      Clear
                    </Button>
                  </div>
                </div>
                {completeStatusPill && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mb-1 h-8 w-full justify-start px-2 text-xs"
                    onClick={() => setStatusPillSelection((current) => hideCompleteOrderStatusPill(current, activeStatusPills))}
                  >
                    Hide Complete
                  </Button>
                )}
                <div className="max-h-64 space-y-0.5 overflow-y-auto">
                  {activeStatusPills.map((pill) => {
                    const selected = selectedStatusPillIds.includes(pill.id);
                    return (
                      <Button
                        key={pill.id}
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-full justify-start px-2 text-sm font-normal"
                        aria-pressed={selected}
                        onClick={() => setStatusPillSelection((current) => toggleOrderStatusPillId(current, pill.id, activeStatusPills))}
                      >
                        <span className={cn("mr-2 flex h-4 w-4 items-center justify-center rounded border", selected ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background")}>
                          {selected && <Check className="h-3 w-3" />}
                        </span>
                        <span className="mr-2 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: pill.color }} />
                        <span className="truncate">{pill.name}</span>
                      </Button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
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
          <Select value={productionFilter} onValueChange={(value) => setProductionFilter(value as ProductionFilterValue)}>
            <SelectTrigger className="w-[170px] h-9">
              <SelectValue placeholder="All Production" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="needs_handoff">Needs Production</SelectItem>
              <SelectItem value="partial">Partial</SelectItem>
              <SelectItem value="action_needed">Action Needed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={proofFilter} onValueChange={(value) => setProofFilter(value as ProofFilterValue)}>
            <SelectTrigger className="w-[180px] h-9">
              <SelectValue placeholder="All Proof" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Proof</SelectItem>
              <SelectItem value="needs_action">Needs Proof Action</SelectItem>
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={handleActionNeededCounterClick}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium whitespace-nowrap transition-colors",
              productionFilter === "action_needed"
                ? "border-red-300 bg-red-100 text-red-950"
                : "border-border bg-background/40 text-foreground hover:bg-accent"
            )}
            title="Show orders on this loaded list with production status Needs Production or Partial"
          >
            <span>Action Needed:</span>
            <span className={cn(
              "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold",
              actionNeededCount > 0
                ? "bg-red-200 text-red-950"
                : "bg-muted text-muted-foreground"
            )}>
              {actionNeededCount}
            </span>
          </button>
          <div className="flex items-center gap-3 whitespace-nowrap">
            <div
              className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2"
              title="Remember this sort when returning to Orders."
            >
              <Switch
                id="orders-sticky-sorting"
                checked={stickySorting}
                onCheckedChange={(checked) => handleStickySortingChange(checked === true)}
                aria-label="Toggle sticky sorting"
              />
              <Label htmlFor="orders-sticky-sorting" className="cursor-pointer text-sm text-foreground">
                Sticky sorting
              </Label>
              <Badge variant={stickySorting ? "default" : "secondary"} className="pointer-events-none text-[10px] uppercase tracking-wide">
                {stickySorting ? "On" : "Off"}
              </Badge>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2">
              <Switch
                id="orders-include-thumbnails"
                checked={includeThumbnails}
                onCheckedChange={(checked) => setIncludeThumbnails(checked === true)}
                aria-label="Toggle order thumbnails"
              />
              <Label htmlFor="orders-include-thumbnails" className="cursor-pointer text-sm text-foreground">
                Thumbnails
              </Label>
              <Badge variant={includeThumbnails ? "default" : "secondary"} className="pointer-events-none text-[10px] uppercase tracking-wide">
                {includeThumbnails ? "On" : "Off"}
              </Badge>
            </div>
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
          description={`${totalCount} order${totalCount !== 1 ? 's' : ''} found`}
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
                        <p>{debouncedSearch || stateFilter !== "all" || statusPillIdsForQuery !== undefined || priorityFilter !== "all" || productionFilter !== "all" || proofFilter !== "all" ? "No orders match your search" : "No orders yet"}</p>
                        {!debouncedSearch && stateFilter === "all" && statusPillIdsForQuery === undefined && priorityFilter === "all" && productionFilter === "all" && proofFilter === "all" ? (
                          <Link to={ROUTES.orders.new}>
                            <Button variant="outline" size="sm">
                              <Plus className="w-4 h-4 mr-2" />
                              Create first order
                            </Button>
                          </Link>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredOrders.map((order: any) => (
                    <TableRow 
                      key={order.id} 
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={(e) => {
                        if (!isOrdersRowNavigationExcluded(e.target)) {
                          navigate(ROUTES.orders.detail(order.id), { state: { referrer: buildReferrer(location) } });
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
                            data-stop-row-nav={col.key === "status" ? "true" : undefined}
                            data-testid={col.key === "status" ? `order-status-cell-${order.id}` : undefined}
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
                  Showing {totalCount === 0 ? 0 : ((page - 1) * pageSize) + 1}-{Math.min(page * pageSize, totalCount)} of {totalCount}
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
            setSelectedAttachmentIndex(0);
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

                return (
                  <button
                    key={att?.id || filename}
                    type="button"
                    className="w-full text-left flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 hover:bg-muted/20"
                    onClick={(e) => {
                      e.stopPropagation();
                      const clickedIndex = normalizedAttachmentViewerItems.findIndex((item) => item.id === String(att?.id || filename));
                      setSelectedAttachmentIndex(clickedIndex >= 0 ? clickedIndex : 0);
                      setAttachmentViewerOpen(true);
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded overflow-hidden border border-border bg-muted/30 flex items-center justify-center shrink-0">
                        {hasThumb ? (
                          <img
                            src={resolveObjectsPublicUrl(thumbUrl as string) ?? (thumbUrl as string)}
                            alt={filename}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              if (import.meta.env.DEV) {
                                console.info(`[thumb] failed url=${e.currentTarget.src}`);
                              }
                            }}
                          />
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
        attachments={normalizedAttachmentViewerItems}
        initialIndex={selectedAttachmentIndex}
        open={attachmentViewerOpen}
        hideFilmstrip={false}
        showMetaPanel={true}
        onOpenChange={(open) => {
          setAttachmentViewerOpen(open);
          if (!open) {
            setSelectedAttachmentIndex(0);
          }
        }}
      />

      <Dialog open={!!pendingStateAction} onOpenChange={(open) => {
        if (!open) {
          setPendingStateAction(null);
          setStateActionNote("");
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingStateAction?.action === "complete" ? "Complete Order" : pendingStateAction?.action === "close" ? "Close Order" : pendingStateAction?.action === "reopen" ? "Reopen Order" : "Cancel Order"}
            </DialogTitle>
            <DialogDescription>
              {pendingStateAction?.action === "complete"
                ? "Mark operational work complete. Invoicing and payment remain separate and the order will not be closed."
                : pendingStateAction?.action === "close"
                ? "Close this order? If it has unpaid invoices, payment collection remains available after it is closed."
                : pendingStateAction?.action === "reopen"
                  ? "Provide an audit reason before reopening this order."
                  : "Cancel this order? This is a destructive operational change and requires confirmation."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="order-state-action-note">
              {pendingStateAction?.action === "reopen" ? "Reason" : "Internal note (optional)"}
            </Label>
            <Input
              id="order-state-action-note"
              value={stateActionNote}
              onChange={(event) => setStateActionNote(event.target.value)}
              placeholder={pendingStateAction?.action === "reopen" ? "Why is this order being reopened?" : "Optional staff note"}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingStateAction(null)} disabled={orderStateMutation.isPending}>Cancel</Button>
            <Button
              variant={pendingStateAction?.action === "cancel" ? "destructive" : "default"}
              disabled={orderStateMutation.isPending || (pendingStateAction?.action === "reopen" && !stateActionNote.trim())}
              onClick={() => pendingStateAction && orderStateMutation.mutate({
                orderId: pendingStateAction.order.id,
                action: pendingStateAction.action,
                note: stateActionNote.trim(),
              })}
            >
              {orderStateMutation.isPending ? "Saving..." : pendingStateAction?.action === "complete" ? "Complete Order" : pendingStateAction?.action === "close" ? "Close Order" : pendingStateAction?.action === "reopen" ? "Reopen Order" : "Cancel Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}

