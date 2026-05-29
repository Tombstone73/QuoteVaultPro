import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/apiConfig";

export type FulfillmentQueueTypeFilter = "all" | "ship" | "pickup";

export interface FulfillmentQueueRow {
  orderId: string;
  orderNumber: string;
  customerName: string;
  fulfillmentType: "SHIP" | "PICKUP";
  status: string;
  itemsRemaining: string;
  readySince: string | null;
  shipTo: string;
  overdue: boolean;
  pickupTicketId?: string | null;
  shipmentId?: string | null;
  isArchived: boolean;
  archivedReason?: string | null;
  productionJobs?: Array<{
    id: string;
    lineItemId: string | null;
    quantity: number | null;
  }>;
  productionContext?: {
    primaryPrinterName: string | null;
    printerNames: string[];
    finishingRequirements: string[];
    lamination: string | null;
    registrationMarks: string[];
    productionNotes: string[];
    completedAt: string | null;
  };
}

export interface FulfillmentDetail extends FulfillmentQueueRow {
  permissions?: {
    canRevertStatus: boolean;
    revertPermission: string;
  };
  billingAutomation?: {
    status: string;
    policy: string;
    trigger: string;
    invoice?: {
      id: string;
      invoiceNumber: number;
      status: string;
      totalCents?: number | null;
    } | null;
    message: string;
    code?: string;
  } | null;
  customer: {
    name: string;
    email: string | null;
    phone: string | null;
  };
  lineItems: Array<{
    id: string;
    productName: string | null;
    description: string | null;
    productType: string | null;
    quantity: number | null;
    size: string | null;
    materialName: string | null;
    optionSummary: string[];
    finishing: {
      requirements: string[];
      lamination: string | null;
    };
    production: {
      jobId: string | null;
      stationKey: string | null;
      stationLabel: string | null;
      status: string | null;
      completedAt: string | null;
    };
    artwork: Array<{
      id: string;
      fileName: string;
      fileUrl: string | null;
      originalUrl: string | null;
      downloadUrl: string | null;
      previewUrl: string | null;
      thumbUrl: string | null;
      thumbnailUrl: string | null;
      thumbKey: string | null;
      previewKey: string | null;
      objectPath: string | null;
      mimeType: string | null;
      side: string | null;
      role: string | null;
      source: "order_attachment" | "line_item_file" | "asset";
    }>;
    checklist: {
      id: string;
      checked: boolean;
      checkedByUserId: string | null;
      checkedAt: string | null;
      notes: string | null;
    };
  }>;
  checklistComplete: boolean;
  checklistSummary: {
    total: number;
    checked: number;
    unchecked: number;
  };
  productionSummary: Array<{
    id: string;
    lineItemId: string | null;
    stationKey: string;
    stepKey: string;
    status: string;
    completedAt: string | null;
    assignedPrinterName: string | null;
  }>;
  pickupTicket: {
    id: string;
    status: string;
    readyAt: string | null;
    pickedUpAt: string | null;
    stagingLocation: string | null;
    pickupNotes: string | null;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
  } | null;
  shipments: Array<{
    id: string;
    status: string;
    carrier: string | null;
    serviceLevel: string | null;
    trackingNumber: string | null;
    shippedAt: string | null;
    updatedAt: string | null;
  }>;
  events: Array<{
    id: string;
    entityType: string;
    entityId: string;
    eventType: string;
    actorUserId: string | null;
    payloadJson: Record<string, any>;
    createdAt: string;
  }>;
}

export interface FulfillmentQueueFilters {
  type: FulfillmentQueueTypeFilter;
  status: string;
  overdueOnly: boolean;
  showArchived: boolean;
  search: string;
}

export interface ShipmentDetail {
  id: string;
  status: "DRAFT" | "SHIPPED" | "VOIDED";
  scope: "SINGLE_ORDER" | "MULTI_ORDER";
  orderId: string | null;
  primaryOrderId: string | null;
  carrier: string | null;
  serviceLevel: string | null;
  trackingNumber: string | null;
  shipDate: string | null;
  boxCount: number | null;
  weightLbs: string | null;
  dimLengthIn: string | null;
  dimWidthIn: string | null;
  dimHeightIn: string | null;
  internalNotes: string | null;
  shippedAt: string | null;
  createdAt: string;
  updatedAt: string;
  orders: Array<{
    shipmentOrderId: string;
    orderId: string;
    orderNumber: string;
    customerName: string | null;
  }>;
  items: Array<{
    id: string;
    orderId: string;
    orderLineItemId: string;
    quantity: number;
  }>;
}

export interface FulfillmentApiError {
  code?: string;
  message: string;
  status?: number;
  payload?: unknown;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  message?: string;
  code?: string;
}

class ApiError extends Error implements FulfillmentApiError {
  code?: string;
  status?: number;
  payload?: unknown;

  constructor(message: string, options?: { code?: string; status?: number; payload?: unknown }) {
    super(message);
    this.name = "ApiError";
    this.code = options?.code;
    this.status = options?.status;
    this.payload = options?.payload;
  }
}

async function apiCall<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(getApiUrl(path), {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  let payload: any = null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    payload = await response.json().catch(() => null);
  } else {
    const text = await response.text().catch(() => "");
    payload = text ? { message: text } : null;
  }

  const envelope = payload as ApiEnvelope<T> | null;

  if (!response.ok) {
    throw new ApiError(
      envelope?.message || `Request failed (${response.status})`,
      { code: envelope?.code, status: response.status, payload },
    );
  }

  if (envelope && envelope.success === false) {
    throw new ApiError(envelope.message || "Request failed", {
      code: envelope.code,
      status: response.status,
      payload,
    });
  }

  if (envelope && "data" in envelope) {
    return envelope.data as T;
  }

  return payload as T;
}

export function toFulfillmentError(error: unknown): FulfillmentApiError {
  if (error instanceof ApiError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      payload: error.payload,
    };
  }
  if (error instanceof Error) return { message: error.message };
  return { message: "Unknown error" };
}

export function useFulfillmentQueueQuery(filters: FulfillmentQueueFilters) {
  return useQuery({
    queryKey: ["fulfillment", "queue", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("type", filters.type);
      params.set("status", filters.status);
      params.set("overdueOnly", String(filters.overdueOnly));
      params.set("showArchived", String(filters.showArchived));
      params.set("search", filters.search);
      params.set("page", "1");
      params.set("pageSize", "200");

      return apiCall<{ rows: FulfillmentQueueRow[]; total: number }>(`/api/fulfillment/queue?${params.toString()}`);
    },
    staleTime: 30_000,
  });
}

function invalidateFulfillment(queryClient: ReturnType<typeof useQueryClient>, orderId?: string) {
  queryClient.invalidateQueries({ queryKey: ["fulfillment", "queue"] });
  if (orderId) queryClient.invalidateQueries({ queryKey: ["fulfillment", "order", orderId] });
  queryClient.invalidateQueries({ queryKey: ["dashboardSummary"] });
  queryClient.invalidateQueries({ queryKey: ["/api/operational-summary"] });
}

export function useFulfillmentOrderDetailQuery(orderId: string | undefined) {
  return useQuery({
    queryKey: ["fulfillment", "order", orderId],
    queryFn: () => apiCall<FulfillmentDetail>(`/api/fulfillment/orders/${orderId}`),
    enabled: !!orderId,
  });
}

export function useMarkFulfillmentReadyMutation(orderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiCall<FulfillmentDetail>(`/api/fulfillment/orders/${orderId}/ready`, { method: "POST" }),
    onSuccess: () => invalidateFulfillment(queryClient, orderId),
  });
}

export function useMarkOrderReadyForPickupMutation(orderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload?: {
      stagingLocation?: string | null;
      pickupNotes?: string | null;
      contactName?: string | null;
      contactEmail?: string | null;
      contactPhone?: string | null;
    }) => apiCall<FulfillmentDetail>(`/api/fulfillment/orders/${orderId}/ready-for-pickup`, {
      method: "POST",
      body: JSON.stringify(payload ?? {}),
    }),
    onSuccess: () => invalidateFulfillment(queryClient, orderId),
  });
}

export function useAddFulfillmentNoteMutation(orderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (note: string) => apiCall<FulfillmentDetail>(`/api/fulfillment/orders/${orderId}/note`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),
    onSuccess: () => invalidateFulfillment(queryClient, orderId),
  });
}

export function useUnreadyFulfillmentOrderMutation(orderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { reason: string }) => apiCall<FulfillmentDetail>(`/api/fulfillment/orders/${orderId}/unready`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    onSuccess: () => invalidateFulfillment(queryClient, orderId),
  });
}

export function useUpdateFulfillmentChecklistItemMutation(orderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { lineItemId: string; checked: boolean; notes?: string | null }) =>
      apiCall<FulfillmentDetail>(`/api/fulfillment/orders/${orderId}/checklist/${payload.lineItemId}`, {
        method: "PATCH",
        body: JSON.stringify({ checked: payload.checked, notes: payload.notes ?? null }),
      }),
    onSuccess: () => invalidateFulfillment(queryClient, orderId),
  });
}

export function useCreateShipmentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      scope: "SINGLE_ORDER" | "MULTI_ORDER";
      orderIds: string[];
      primaryOrderId?: string;
    }) => apiCall<{ shipmentId: string; shipment: ShipmentDetail }>("/api/fulfillment/shipments", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    onSuccess: () => {
      invalidateFulfillment(queryClient);
    },
  });
}

export function useShipmentDetailQuery(shipmentId: string | undefined) {
  return useQuery({
    queryKey: ["fulfillment", "shipment", shipmentId],
    queryFn: () => apiCall<ShipmentDetail>(`/api/fulfillment/shipments/${shipmentId}`),
    enabled: !!shipmentId,
  });
}

export function useUpdateShipmentMutation(shipmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      carrier?: string | null;
      serviceLevel?: string | null;
      trackingNumber?: string | null;
      shipDate?: string | null;
      boxCount?: number | null;
      weight?: number | null;
      dims?: { length?: number | null; width?: number | null; height?: number | null };
      internalNotes?: string | null;
      shipmentItems?: Array<{ orderId: string; orderLineItemId: string; quantity: number }>;
    }) => apiCall<ShipmentDetail>(`/api/fulfillment/shipments/${shipmentId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fulfillment", "shipment", shipmentId] });
      invalidateFulfillment(queryClient);
    },
  });
}

export function useMarkShippedMutation(shipmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiCall<ShipmentDetail>(`/api/fulfillment/shipments/${shipmentId}/mark-shipped`, {
      method: "POST",
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fulfillment", "shipment", shipmentId] });
      invalidateFulfillment(queryClient);
    },
  });
}

export function useVoidShipmentMutation(shipmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiCall<ShipmentDetail>(`/api/fulfillment/shipments/${shipmentId}/void`, {
      method: "POST",
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fulfillment", "shipment", shipmentId] });
      invalidateFulfillment(queryClient);
    },
  });
}

export function useCreatePickupTicketMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => apiCall<{ id: string; orderId: string; status: string }>(`/api/fulfillment/pickup/${orderId}`, {
      method: "POST",
    }),
    onSuccess: () => {
      invalidateFulfillment(queryClient);
    },
  });
}

export function useMarkPickupReadyMutation(ticketId: string, orderId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      stagingLocation?: string | null;
      pickupNotes?: string | null;
      contactName?: string | null;
      contactEmail?: string | null;
      contactPhone?: string | null;
    }) => apiCall<any>(`/api/fulfillment/pickup/${ticketId}/ready`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    onSuccess: () => invalidateFulfillment(queryClient, orderId),
  });
}

export function useMarkPickupPickedUpMutation(ticketId: string, orderId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiCall<any>(`/api/fulfillment/pickup/${ticketId}/picked-up`, { method: "POST" }),
    onSuccess: () => invalidateFulfillment(queryClient, orderId),
  });
}

export async function getOrderShipments(orderId: string) {
  return apiCall<Array<{ id: string; status: string; updatedAt?: string }>>(`/api/orders/${orderId}/shipments`);
}

export async function getOrderLineItems(orderId: string) {
  return getOrderDetails(orderId)
    .then((order: any) => Array.isArray(order?.lineItems) ? order.lineItems : []);
}

export async function getOrderDetails(orderId: string) {
  return apiCall<any>(`/api/orders/${orderId}`);
}
