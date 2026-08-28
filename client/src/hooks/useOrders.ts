import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import type { LineItemProofSummary, OrderProofCounts, OrderProofStatus } from "@shared/orderProofStatus";
import type { CancelOrderRequest } from "@shared/orderCancellation";
import type { OrderInvoiceStateSummary } from "@shared/orderInvoiceState";
import type { MediaFitSnapshot } from "@shared/mediaFit";

// ============================================================
// QUERY KEY FACTORIES (Single Source of Truth)
// ============================================================

/**
 * Query key for orders list (with filters/pagination)
 * Pattern: ["orders", "list", filters]
 * Note: Backend handles org scoping via tenantContext middleware
 */
export const ordersListQueryKey = (filters?: OrdersQueryParams) => {
  // Ensure stable key by stringifying params in consistent order
  const stableFilters = filters ? {
    page: filters.page,
    pageSize: filters.pageSize,
    includeThumbnails: filters.includeThumbnails,
    sortBy: filters.sortBy,
    sortDir: filters.sortDir,
    search: filters.search,
    status: filters.status,
    state: filters.state,
    statusPillId: filters.statusPillId,
    statusPillIds: filters.statusPillIds ? [...filters.statusPillIds].sort() : filters.statusPillIds,
    priority: filters.priority,
    customerId: filters.customerId,
    startDate: filters.startDate,
    endDate: filters.endDate,
  } : undefined;
  return ["orders", "list", stableFilters] as const;
};

/**
 * Query key for single order detail
 * Pattern: ["orders", "detail", orderId]
 */
export const orderDetailQueryKey = (orderId: string) => 
  ["orders", "detail", orderId] as const;

/**
 * Query key for order audit/timeline
 * Pattern: ["orders", "timeline", orderId]
 */
export const orderTimelineQueryKey = (orderId: string) => 
  ["orders", "timeline", orderId] as const;

export const orderWorkflowQueryKey = () =>
  ["orders", "workflow"] as const;

export const orderCancellationEligibilityQueryKey = (orderId: string) =>
  ["orders", "cancellation-eligibility", orderId] as const;

function invalidateOrderOperationalQueries(queryClient: QueryClient, orderId?: string) {
  if (orderId) {
    queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(orderId) });
    queryClient.invalidateQueries({ queryKey: orderTimelineQueryKey(orderId) });
  }

  queryClient.invalidateQueries({ queryKey: ["orders", "list"] });
  queryClient.invalidateQueries({ queryKey: ["/api/operational-summary"] });
  queryClient.invalidateQueries({ queryKey: ["/api/prepress/queue"] });
  queryClient.invalidateQueries({ queryKey: ["/api/design/queue"] });
  queryClient.invalidateQueries({ queryKey: ["/api/proofing/queue"] });
  queryClient.invalidateQueries({ queryKey: ["/api/fulfillment/queue"] });
  queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      if (!Array.isArray(key)) return false;
      return key[0] === "/api/production/jobs" || key[0] === "production";
    },
  });
}

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export type Order = {
  id: string;
  orderNumber: string;
  quoteId: string | null;
  sourceQuoteNumber: number | null;
  customerId: string;
  contactId: string | null;
  status: string;
  workflowStatusId?: string | null;
  canonicalState?: "new" | "active" | "ready" | "completed" | "canceled" | "on_hold" | string | null;
  // Billing readiness (persisted)
  billingStatus?: "not_ready" | "ready" | "billed" | string;
  billingReadyAt?: string | null;
  billingReadyPolicy?: "all_line_items_done" | "manual" | "none" | null;
  billingReadyOverride?: boolean;
  billingReadyOverrideNote?: string | null;
  billingReadyOverrideAt?: string | null;
  priority: string;
  dueDate: string | null;
  promisedDate: string | null;
  subtotal: string;
  tax: string;
  total: string;
  discount: string;
  shippingCents: number;
  notesInternal: string | null;
  fulfillmentStatus: "pending" | "packed" | "shipped" | "delivered" | null;
  shippingAddress: any;
  packingSlipHtml: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  canceledAt?: string | null;
  canceledByUserId?: string | null;
  cancellationReason?: string | null;
  cancellationNotes?: string | null;
  label?: string | null; // Job label
  poNumber?: string | null; // PO number
};

export type OrderLineItem = {
  id: string;
  orderId: string;
  quoteLineItemId: string | null;
  productId: string;
  productVariantId: string | null;
  description: string;
  width: string | null;
  height: string | null;
  quantity: number;
  sqft: string | null;
  unitPrice: string;
  totalPrice: string;
  baseCalculatedUnitPriceCents?: number;
  baseCalculatedTotalCents?: number;
  effectiveUnitPriceCents?: number;
  effectiveTotalCents?: number;
  priceOverrideMode?: string | null;
  priceOverrideValueCents?: number | null;
  priceOverrideValuePercent?: number | null;
  hasPriceOverride?: boolean;
  overridePriceCents?: number | null;
  status: string;
  workflowState?: string;
  designStatus?: "needs_design" | "in_design" | "design_complete" | null;
  requiresDesign?: boolean;
  requiresPrepress?: boolean;
  requiresProofApproval?: boolean;
  approvedProofVersionId?: string | null;
  nestingConfigSnapshot: any;
  specsJson?: any;
  createdAt: string;
  updatedAt: string;
  sortOrder: number;
  proofSummary?: LineItemProofSummary;
};

export type LineItemWorkflowState =
  | "new"
  | "needs_design"
  | "in_design"
  | "awaiting_proof_approval"
  | "ready_for_prepress"
  | "in_prepress"
  | "ready_for_production"
  | "in_production"
  | "completed"
  | "on_hold"
  | "canceled";

export type LineItemWorkflowTransitionResult = {
  lineItemId: string;
  fromState: LineItemWorkflowState;
  toState: LineItemWorkflowState;
  lifecycleStatus: string;
  activeOwnerJobId: string | null;
  activeOwnerStationKey: string | null;
  activeOwnerStepKey: string | null;
  ownershipAction: "created" | "reused" | "transitioned" | "completed" | "none";
};

export type DesignQueueWorkflowState = Extract<LineItemWorkflowState, "needs_design" | "in_design">;

export type PrepressQueueWorkflowState = Extract<LineItemWorkflowState, "ready_for_prepress" | "in_prepress">;

export type DesignQueueItem = {
  lineItemId: string;
  orderId: string;
  jobNumber: string;
  customerName: string;
  productName: string;
  printType: string | null;
  media: string | null;
  dueDate: string | null;
  status: string;
  workflowState: DesignQueueWorkflowState;
  designStatus: DesignQueueWorkflowState;
  designStage: DesignQueueWorkflowState;
  rush: boolean;
  quantity: number;
  width: number | null;
  height: number | null;
  sqFootage: number | null;
  requiresDesign: boolean | null;
  requiresProofApproval: boolean | null;
  requiresPrepress: boolean | null;
  activeOwnerJobId: string | null;
  activeOwnerStationKey: string | null;
  activeOwnerStepKey: string | null;
  fileCounts: {
    originals: number;
    proofs: number;
  };
};

export type PrepressQueueItem = {
  lineItemId: string;
  lineNumber?: number | null;
  orderId: string;
  jobNumber: string;
  customerName: string;
  productName: string;
  printType: string | null;
  suggestedProductionDestination?: "roll" | "flatbed" | null;
  selectedProductionDestination?: "roll" | "flatbed" | null;
  destinationOverrideActive?: boolean;
  productionDestinationLabel?: string | null;
  materialId?: string | null;
  materialName?: string | null;
  media: string | null;
  dueDate: string | null;
  status: string;
  workflowState: PrepressQueueWorkflowState;
  requiresProofApproval?: boolean | null;
  approvedProofVersionId?: string | null;
  proofApprovalPolicyOverride?: "inherit_default" | "force_required" | "bypass";
  proofBypassed?: boolean;
  proofBypassReason?: string | null;
  proofBypassedAt?: string | null;
  proofBypassedByUserId?: string | null;
  productionReleaseBlockedReason?: string | null;
  hasCompletedSession: boolean;
  rush: boolean;
  assignedTo: string | null;
  sessionId: string | null;
  sessionStartedAt: string | null;
  sessionStartedByUserId: string | null;
  prepressNotes: string | null;
  lineItemNotes?: string | null;
  priorityLabel?: string | null;
  issueFlag: boolean;
  issueType: string | null;
  hasDownstreamActiveJob: boolean;
  hasAnyProductionJob: boolean;
  activeOwnerJobId: string | null;
  activeOwnerStationKey: string | null;
  activeOwnerStepKey: string | null;
  isActivelyOwnedByPrepress: boolean;
  thumbFileId: string | null;
  thumbSelectionReason: "thumbFileId" | "original_fallback" | "final_fallback" | "none" | null;
  thumbCandidateMimeType: string | null;
  thumbnailUrl: string | null;
  fileCounts: {
    originals: number;
    finals: number;
  };
  quantity: number;
  width: number | null;
  height: number | null;
  sqFootage: number | null;
  bleed: string | null;
  finishing: string | null;
  finishingBullets?: string[];
  optionsRows?: Array<{
    groupLabel?: string | null;
    optionLabel: string;
    selectedLabel: string;
    isDefault?: boolean;
  }>;
  printSides?: "Single-sided" | "Double-sided" | "Unknown";
  /**
   * Frozen at the time the line item was priced. Production must not infer
   * media fit from the current catalog because the catalog can change later.
   */
  mediaFit?: MediaFitSnapshot | null;
  productionLayout?: {
    sheetUsageMethod: "layout_yield" | string;
    sheetWidthIn: number;
    sheetHeightIn: number;
    allowRotation: boolean;
    sideCount: number;
    normalPiecesPerSheet: number;
    rotatedPiecesPerSheet: number;
    mixedPiecesPerSheet: number;
    piecesPerSheet: number;
    fullSheets: number;
    partialSheetPieces: number;
    sheetsToPrint: number;
    totalSheetCount: number;
    printPasses: number;
    orientation: "normal" | "rotated" | "mixed";
    mixedLayoutDescription: string | null;
  } | null;
  productionLayoutUnavailableReason?: "not_sheet_job" | "missing_dimensions" | "missing_sheet_configuration" | "layout_error" | string | null;
  artworkProductionBreakdown?: {
    source: "final_production" | "customer_artwork" | "none";
    productionArtStatus: string;
    allocatedTotal: number;
    requiredQuantity: number | null;
    valid: boolean;
    issue: string | null;
    relationshipInconsistency?: string | null;
    designs: Array<{
      id: string;
      source: "final_production" | "customer_artwork";
      filename: string;
      thumbnailUrl: string | null;
      productionArtStatus: string;
      side: "front" | "back" | "both" | "na" | string | null;
      productionQuantity: number | null;
      productionGroupId: string | null;
      tag?: string | null;
      mimeType?: string | null;
      sizeBytes?: number | null;
    }>;
  };
  useSameArtworkBothSides?: boolean;
  sameArtworkFileId?: string | null;
};

export type OrderWithRelations = Order & {
  customer: any;
  contact?: any;
  quote?: any;
  createdByUser: any;
  proofStatus?: OrderProofStatus;
  proofStatusLabel?: string;
  proofActionRequired?: boolean;
  proofCounts?: OrderProofCounts;
  proofLineItemId?: string | null;
  lineItems: (OrderLineItem & {
    product: any;
    productVariant?: any;
    lineNumber?: number;
    activeOwnerJobId?: string | null;
    activeOwnerStationKey?: string | null;
    activeOwnerStepKey?: string | null;
    activeOwnerStatus?: string | null;
  })[];
};

// Order row for list views (matches Quotes pattern)
export type OrderRow = Order & {
  customer: any;
  contact?: any;
  lineItemsCount?: number;
  proofStatus?: OrderProofStatus;
  proofStatusLabel?: string;
  proofActionRequired?: boolean;
  proofCounts?: OrderProofCounts;
  proofLineItemId?: string | null;
  productionSummary?: {
    requiredCount: number;
    handedOffCount: number;
    pendingHandoffCount: number;
    inProductionCount: number;
    completeCount: number;
    status: "none" | "clear" | "needs_handoff" | "partial" | "in_production" | "complete";
    printerNames?: string[];
    stationKeys?: string[];
    stationLabel?: string;
  };
  listLabel?: string | null; // List-only note (always editable)
  previewThumbnails?: string[]; // GCS thumbnail keys
  thumbsCount?: number; // Total attachment count
  previewThumbnailUrl?: string | null; // Signed URL for list preview image thumbnail
  previewThumbnailUrls?: string[]; // Up to 3 preview thumbnails for list row
  previewThumbnailCount?: number; // Total available items count for +N indicator
  previewImageUrl?: string | null; // Back-compat: older field name
  attachmentsSummary?: {
    totalCount: number;
    previews: Array<{
      id: string;
      filename: string;
      mimeType?: string | null;
      thumbnailUrl?: string | null;
    }>;
  };
  // TitanOS State Architecture fields
  state?: string;
  statusPillId?: string | null;
  statusPillValue?: string | null;
  statusPillKey?: string | null;
  statusPillColor?: string | null;
  statusPillAssignedAt?: string | Date | null;
  statusPillAssignedByUserId?: string | null;
  paymentStatus?: string;
  invoiceState?: OrderInvoiceStateSummary;
  routingTarget?: string | null;
};

// Paginated response (matches Quotes pattern)
export type OrdersListResponse = {
  items: OrderRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

// Query params type for non-paginated queries
export interface OrdersFilterParams {
  search?: string;
  status?: string;
  state?: string;
  statusPillId?: string;
  statusPillIds?: string[];
  priority?: string;
  customerId?: string;
  startDate?: string;
  endDate?: string;
}

// Query params type for paginated queries (includes pagination fields)
export interface OrdersQueryParams extends OrdersFilterParams {
  page?: number;
  pageSize?: number;
  includeThumbnails?: boolean;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

// Function overloads for backward compatibility
// Legacy: no args or only filter params (no pagination) -> returns Order[]
export function useOrders(): ReturnType<typeof useQuery<Order[], Error>>;
export function useOrders(filters: OrdersFilterParams): ReturnType<typeof useQuery<Order[], Error>>;
// Paginated: includes page/pageSize -> returns OrdersListResponse
export function useOrders(filters: OrdersQueryParams & { page: number }): ReturnType<typeof useQuery<OrdersListResponse, Error>>;
export function useOrders(filters: OrdersQueryParams & { pageSize: number }): ReturnType<typeof useQuery<OrdersListResponse, Error>>;

// Implementation
export function useOrders(filters?: OrdersQueryParams): any {
  // Determine if paginated request
  const isPaginated = filters?.page !== undefined || filters?.pageSize !== undefined;

  return useQuery({
    queryKey: ordersListQueryKey(filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.search) params.append("search", filters.search);
      if (filters?.status) params.append("status", filters.status);
      if (filters?.state) params.append("state", filters.state);
      if (filters?.statusPillId) params.append("statusPillId", filters.statusPillId);
      if (filters?.statusPillIds !== undefined) params.append("statusPillIds", filters.statusPillIds.join(","));
      if (filters?.priority) params.append("priority", filters.priority);
      if (filters?.customerId) params.append("customerId", filters.customerId);
      if (filters?.startDate) params.append("startDate", filters.startDate);
      if (filters?.endDate) params.append("endDate", filters.endDate);
      
      // Pagination params
      if (filters?.page !== undefined) params.append("page", String(filters.page));
      if (filters?.pageSize !== undefined) params.append("pageSize", String(filters.pageSize));
      if (filters?.includeThumbnails !== undefined) params.append("includeThumbnails", filters.includeThumbnails ? 'true' : 'false');
      if (filters?.sortBy) params.append("sortBy", filters.sortBy);
      if (filters?.sortDir) params.append("sortDir", filters.sortDir);

      const url = `/api/orders${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch orders");
      const data = await response.json();
      
      // If legacy call (no pagination params) and server returns paginated shape, extract items
      if (!isPaginated && data && typeof data === 'object' && 'items' in data) {
        return data.items as Order[];
      }
      
      return data;
    },
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useOrder(id: string | undefined) {
  return useQuery<OrderWithRelations>({
    queryKey: id ? orderDetailQueryKey(id) : ["orders", "detail", "undefined"],
    queryFn: async () => {
      if (!id) throw new Error("Order ID is required");
      const response = await fetch(`/api/orders/${id}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch order");
      return response.json();
    },
    enabled: !!id,
  });
}

export type OrderWorkflowStatus = {
  id: string;
  workflowVersionId: string;
  key: string;
  label: string;
  category: "new" | "active" | "ready" | "completed" | "canceled" | "on_hold";
  color?: string | null;
  sortOrder: number;
  isDefaultForNew: boolean;
  isActive: boolean;
};

export type OrderWorkflowResponse = {
  version: {
    id: string;
    name: string;
    isActive: boolean;
    publishedAt?: string | null;
    createdAt: string;
  };
  statuses: OrderWorkflowStatus[];
  transitions: Array<{ id: string; fromStatusId: string; toStatusId: string }>;
};

export function useOrderWorkflow() {
  return useQuery<OrderWorkflowResponse>({
    queryKey: orderWorkflowQueryKey(),
    queryFn: async () => {
      const response = await fetch("/api/workflow/order", { credentials: "include" });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || "Failed to load order workflow");
      }
      return data.data as OrderWorkflowResponse;
    },
    staleTime: 60_000,
  });
}

export function useSaveOrderWorkflowDraft() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (payload: { name?: string; statuses?: Array<Partial<OrderWorkflowStatus>> }) => {
      const response = await fetch("/api/workflow/order/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || "Failed to save draft workflow");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderWorkflowQueryKey() });
      toast({ title: "Success", description: "Workflow draft saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
}

export function usePublishOrderWorkflow() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/workflow/order/publish", {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || "Failed to publish workflow");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderWorkflowQueryKey() });
      queryClient.invalidateQueries({ queryKey: ["orders", "list"] });
      toast({ title: "Success", description: "Workflow published" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
}

export function useCreateOrder() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(data?.idempotencyKey ? { "Idempotency-Key": data.idempotencyKey } : {}),
        },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create order");
      }
      return response.json();
    },
    onSuccess: () => {
      // Invalidate all orders list queries (all filter combinations)
      queryClient.invalidateQueries({ queryKey: ["orders", "list"] });
      toast({
        title: "Success",
        description: "Order created successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useUpdateOrder(id: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.message || error?.error || "Failed to update order");
      }
      return response.json();
    },
    onSuccess: (updatedOrder) => {
      invalidateOrderOperationalQueries(queryClient, id);
      
      // Optimistically update the detail cache
      queryClient.setQueryData(orderDetailQueryKey(id), (old: any) => {
        if (!old) return updatedOrder;
        return { ...old, ...updatedOrder };
      });
      
      toast({
        title: "Success",
        description: "Order updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useCancelOrder(orderId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (payload: CancelOrderRequest) => {
      const response = await fetch(`/api/orders/${orderId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || "Failed to cancel order");
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(orderId) });
      queryClient.invalidateQueries({ queryKey: orderCancellationEligibilityQueryKey(orderId) });
      queryClient.invalidateQueries({ queryKey: orderTimelineQueryKey(orderId) });
      queryClient.invalidateQueries({ queryKey: ["orders", "list"] });
      queryClient.invalidateQueries({ queryKey: ["orders", "internalNotes", orderId] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["shipments", orderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/shipments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/prepress/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/design/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/proofing/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fulfillment/queue"] });
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          if (!Array.isArray(key)) return false;
          return key[0] === "/api/production/jobs" || key[0] === "production";
        },
      });

      const warnings = Array.isArray(data?.warnings) ? data.warnings : [];
      toast({
        title: "Order cancelled",
        description: warnings.length ? warnings.join(" ") : "The order is now operationally terminal.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Cancellation blocked",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useOrderCancellationEligibility(orderId?: string | null) {
  return useQuery<{
    canCancel: boolean;
    code: string | null;
    message: string | null;
    details: Record<string, unknown> | null;
  }>({
    queryKey: orderCancellationEligibilityQueryKey(orderId || ""),
    enabled: Boolean(orderId),
    queryFn: async () => {
      const response = await fetch(`/api/orders/${orderId}/cancellation-eligibility`, {
        credentials: "include",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || "Failed to check cancellation eligibility");
      }
      return data.data;
    },
  });
}

export function useDeleteOrder() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/orders/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to delete order");
      }
      return response.json();
    },
    onSuccess: () => {
      // Invalidate all list queries
      queryClient.invalidateQueries({ queryKey: ["orders", "list"] });
      
      toast({
        title: "Success",
        description: "Order deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useConvertQuoteToOrder(quoteId?: string | null) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: async (data: { quoteId?: string; poNumber?: string; dueDate?: string; promisedDate?: string; priority?: string; notesInternal?: string; customerId?: string; contactId?: string; idempotencyKey?: string }) => {
      const targetQuoteId = data.quoteId ?? quoteId;
      if (!targetQuoteId) throw new Error("Missing quote id");
      const { quoteId: _omit, ...rest } = data;
      const response = await fetch(`/api/quotes/${targetQuoteId}/convert-to-order`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(data.idempotencyKey ? { "Idempotency-Key": data.idempotencyKey } : {}),
        },
        body: JSON.stringify(rest),
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to convert quote to order");
      }
      const result: {
        success: boolean;
        data?: { order?: { id: string; orderNumber?: string | null } };
        message?: string;
      } = await response.json();
      if (!result.success || !result.data?.order) {
        throw new Error(result?.message || "Failed to convert quote to order");
      }
      return result;
    },
    onSuccess: (result) => {
      const order = result?.data?.order;
      const orderId = order?.id;
      const orderNumber = order?.orderNumber;
      
      // Invalidate order queries
      queryClient.invalidateQueries({ queryKey: ["orders", "list"] });
      if (orderId) {
        queryClient.invalidateQueries({ queryKey: ["/api/orders", orderId] });
        queryClient.invalidateQueries({ queryKey: ["orders", "timeline", orderId] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/operational-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/prepress/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/design/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/proofing/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fulfillment/queue"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      
      // Invalidate quote list queries (still using old keys for quotes)
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      
      // CRITICAL: Invalidate the specific quote detail query to update badge and lock state
      if (quoteId) {
        queryClient.invalidateQueries({ queryKey: ["/api/quotes", quoteId] });
      }
      
      toast({
        title: "Order created",
        description: orderNumber
          ? `Order ${orderNumber} was created from this quote.`
          : "Order was created from this quote.",
      });
      if (orderId) {
        navigate(`/orders/${orderId}`);
      } else {
        navigate("/orders");
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useUpdateOrderLineItem(
  orderId: string,
  options?: {
    toast?: boolean;
  }
) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const shouldToast = options?.toast !== false;

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const coerceOptionalNumber = (value: unknown) => {
        if (value === null) return null;
        if (value === undefined || value === "") return undefined;
        return Number(value);
      };
      // Ensure numeric values are sent as numbers, not strings
      const payload = {
        ...data,
        unitPrice: coerceOptionalNumber(data.unitPrice),
        totalPrice: coerceOptionalNumber(data.totalPrice),
        quantity: coerceOptionalNumber(data.quantity),
        width: coerceOptionalNumber(data.width),
        height: coerceOptionalNumber(data.height),
        sqft: coerceOptionalNumber(data.sqft),
      };

      console.log("useUpdateOrderLineItem - Input data:", data);
      console.log("useUpdateOrderLineItem - Payload to API:", payload);

      const response = await fetch(`/api/order-line-items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update line item");
      }
      return response.json();
    },
    onSuccess: (updatedLineItem) => {
      invalidateOrderOperationalQueries(queryClient, orderId);
      
      if (shouldToast) {
        toast({
          title: "Success",
          description: "Line item updated successfully",
        });
      }
    },
    onError: (error: Error) => {
      if (shouldToast) {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive",
        });
      }
    },
  });
}

export function useCreateOrderLineItem(orderId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: any) => {
      // Ensure numeric values are sent as numbers, not strings
      const payload = {
        ...data,
        unitPrice: data.unitPrice ? Number(data.unitPrice) : 0,
        totalPrice: data.totalPrice ? Number(data.totalPrice) : 0,
        quantity: data.quantity ? Number(data.quantity) : 1,
        width: data.width ? Number(data.width) : undefined,
        height: data.height ? Number(data.height) : undefined,
        sqft: data.sqft ? Number(data.sqft) : undefined,
      };

      console.log("useCreateOrderLineItem - Input data:", data);
      console.log("useCreateOrderLineItem - Payload to API:", payload);

      const response = await fetch("/api/order-line-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.message || "Failed to create line item");
      }
      return response.json();
    },
    onSuccess: (_created: any, variables: any) => {
      invalidateOrderOperationalQueries(queryClient, orderId);
      toast({
        title: variables?.duplicateSourceLineItemId ? "Item duplicated" : "Success",
        description: variables?.duplicateSourceLineItemId
          ? "Commercial details were copied. Artwork remains on the original item."
          : "Line item added successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useDeleteOrderLineItem(orderId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/order-line-items/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to delete line item");
      }
      return response.json();
    },
    onSuccess: () => {
      invalidateOrderOperationalQueries(queryClient, orderId);
      toast({
        title: "Success",
        description: "Line item deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

// Update line item status (allowed even when order is locked)
export function useUpdateOrderLineItemStatus(orderId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ lineItemId, status }: { lineItemId: string; status: string }) => {
      const response = await fetch(`/api/orders/${orderId}/line-items/${lineItemId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
        credentials: "include",
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update line item status");
      }
      
      return response.json();
    },
    onSuccess: (updatedLineItem) => {
      invalidateOrderOperationalQueries(queryClient, orderId);

      toast({
        title: "Success",
        description: "Line item status updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

// Bulk update line item statuses
export function useBulkUpdateOrderLineItemStatus(orderId: string) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ status, lineItemIds }: { status: string; lineItemIds?: string[] }) => {
      const response = await fetch(`/api/orders/${orderId}/line-items/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, lineItemIds }),
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Failed to bulk update line item statuses");
      }
      return data;
    },
    onSuccess: (data) => {
      invalidateOrderOperationalQueries(queryClient, orderId);
      
      toast({
        title: "Success",
        description: data.message || `Updated ${data.updatedCount} line item(s)`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useTransitionLineItemWorkflow(orderId: string) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      lineItemId,
      toState,
      note,
      action,
    }: {
      lineItemId: string;
      toState?: LineItemWorkflowState;
      note?: string;
      action?: "complete-design";
    }) => {
      const endpoint = action === "complete-design"
        ? `/api/design/line-item/${lineItemId}/complete`
        : `/api/line-items/${lineItemId}/workflow-transition`;

      const body = action === "complete-design"
        ? { note }
        : { toState, note };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || data.message || "Failed to transition workflow");
      }
      return data.data as LineItemWorkflowTransitionResult;
    },
    onSuccess: (data) => {
      invalidateOrderOperationalQueries(queryClient, orderId);
      toast({
        title: "Workflow updated",
        description: `${data.fromState.replace(/_/g, " ")} -> ${data.toState.replace(/_/g, " ")}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Workflow update failed", description: error.message, variant: "destructive" });
    },
  });
}

export function useDesignQueue() {
  return useQuery<DesignQueueItem[]>({
    queryKey: ["/api/design/queue"],
    queryFn: async () => {
      const response = await fetch("/api/design/queue", { credentials: "include" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to fetch design queue");
      }
      const data = await response.json();
      return (data.data || []) as DesignQueueItem[];
    },
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
}

// Order State Transition Hook
export function useTransitionOrderStatus(orderId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ toStatus, reason }: { toStatus: string; reason?: string }) => {
      const response = await fetch(`/api/orders/${orderId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toStatus, reason }),
        credentials: "include",
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || "Failed to transition order status");
      }
      
      return data;
    },
    onSuccess: (response) => {
      const updatedOrder = response?.data;
      
      // Optimistically update all list caches
      queryClient.setQueriesData<OrdersListResponse | Order[]>(
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
                order.id === orderId 
                  ? { ...order, status: updatedOrder.status, updatedAt: updatedOrder.updatedAt }
                  : order
              ),
            };
          }
          
          // Handle non-paginated array response
          if (Array.isArray(old)) {
            return old.map((order) =>
              order.id === orderId
                ? { ...order, status: updatedOrder.status, updatedAt: updatedOrder.updatedAt }
                : order
            );
          }
          
          return old;
        }
      );
      
      // Invalidate detail and timeline for full refresh
      queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(orderId) });
      queryClient.invalidateQueries({ queryKey: orderTimelineQueryKey(orderId) });
      
      // Invalidate all queue domains — order status transitions (cancel, hold, etc.)
      // remove items from production, prepress, and proofing queues simultaneously.
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return Array.isArray(key) && key[0] === "/api/production/jobs";
        },
      });
      queryClient.invalidateQueries({ queryKey: ["/api/prepress/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/proofing/queue"] });
      
      // Show success message with any warnings
      const warnings = response.warnings?.length ? `\n\nWarnings: ${response.warnings.join(', ')}` : '';
      toast({
        title: "Success",
        description: response.message + warnings,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

// Helper to get allowed next statuses based on current status (client-side mirror of server rules)
export function getAllowedNextStatuses(currentStatus: string): string[] {
  switch (currentStatus) {
    case 'new':
      return ['in_production', 'on_hold', 'canceled'];
    case 'in_production':
      return ['ready_for_shipment', 'completed', 'on_hold', 'canceled'];
    case 'on_hold':
      return ['in_production', 'canceled'];
    case 'ready_for_shipment':
      return ['completed', 'on_hold'];
    case 'completed':
      return []; // Terminal
    case 'canceled':
      return []; // Terminal
    default:
      return [];
  }
}

// Helper to check if order is editable (terminal states are locked)
export function isOrderEditable(status: string): boolean {
  return status !== 'completed' && status !== 'canceled';
}

// Helper to check if line items can be edited (only in 'new' status)
export function areLineItemsEditable(status: string): boolean {
  return status === 'new';
}
