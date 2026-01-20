import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

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

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export type Order = {
  id: string;
  orderNumber: string;
  quoteId: string | null;
  customerId: string;
  contactId: string | null;
  status: string;
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
  status: string;
  nestingConfigSnapshot: any;
  specsJson?: any;
  createdAt: string;
  updatedAt: string;
};

export type OrderWithRelations = Order & {
  customer: any;
  contact?: any;
  quote?: any;
  createdByUser: any;
  lineItems: (OrderLineItem & {
    product: any;
    productVariant?: any;
  })[];
};

// Order row for list views (matches Quotes pattern)
export type OrderRow = Order & {
  customer: any;
  contact?: any;
  lineItemsCount?: number;
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
  statusPillValue?: string | null;
  paymentStatus?: string;
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

export function useCreateOrder() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        const error = await response.json();
        throw new Error(error.message || "Failed to update order");
      }
      return response.json();
    },
    onSuccess: (updatedOrder) => {
      // Invalidate list queries
      queryClient.invalidateQueries({ queryKey: ["orders", "list"] });
      
      // Invalidate specific order detail
      queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(id) });
      
      // Invalidate timeline
      queryClient.invalidateQueries({ queryKey: orderTimelineQueryKey(id) });
      
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
    mutationFn: async (data: { quoteId?: string; dueDate?: string; promisedDate?: string; priority?: string; notesInternal?: string; customerId?: string; contactId?: string }) => {
      const targetQuoteId = data.quoteId ?? quoteId;
      if (!targetQuoteId) throw new Error("Missing quote id");
      const { quoteId: _omit, ...rest } = data;
      const response = await fetch(`/api/quotes/${targetQuoteId}/convert-to-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      // Ensure numeric values are sent as numbers, not strings
      const payload = {
        ...data,
        unitPrice: data.unitPrice ? Number(data.unitPrice) : undefined,
        totalPrice: data.totalPrice ? Number(data.totalPrice) : undefined,
        quantity: data.quantity ? Number(data.quantity) : undefined,
        width: data.width ? Number(data.width) : undefined,
        height: data.height ? Number(data.height) : undefined,
        sqft: data.sqft ? Number(data.sqft) : undefined,
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
      // Invalidate order detail to refresh line items
      queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(orderId) });
      
      // Invalidate list queries
      queryClient.invalidateQueries({ queryKey: ["orders", "list"] });
      
      // Invalidate timeline
      queryClient.invalidateQueries({ queryKey: orderTimelineQueryKey(orderId) });
      
      // CRITICAL: Invalidate production jobs to sync live fields (qty/sides/media/description)
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return Array.isArray(key) && key[0] === "/api/production/jobs";
        },
      });
      
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
        const error = await response.json();
        throw new Error(error.message || "Failed to create line item");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(orderId) });
      queryClient.invalidateQueries({ queryKey: ["orders", "list"] });
      toast({
        title: "Success",
        description: "Line item added successfully",
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
      queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(orderId) });
      queryClient.invalidateQueries({ queryKey: ["orders", "list"] });
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
      // Invalidate order detail
      queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(orderId) });
      
      // Invalidate list queries
      queryClient.invalidateQueries({ queryKey: ["orders", "list"] });
      
      // Invalidate timeline
      queryClient.invalidateQueries({ queryKey: orderTimelineQueryKey(orderId) });
      
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
      // Invalidate order detail (contains line items)
      queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(orderId) });
      
      // Invalidate order timeline
      queryClient.invalidateQueries({ queryKey: orderTimelineQueryKey(orderId) });
      
      // Invalidate orders list
      queryClient.invalidateQueries({ queryKey: ["orders", "list"] });
      
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

// Order State Transition Hook
export function useTransitionOrderStatus(orderId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ toStatus, reason }: { toStatus: string; reason?: string }) => {
      const response = await fetch(`/api/orders/${orderId}/transition`, {
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
      
      // BUGFIX: Invalidate production queries so scheduled jobs appear immediately
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return Array.isArray(key) && key[0] === "/api/production/jobs";
        },
      });
      
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
