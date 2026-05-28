import { createElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ToastAction, type ToastActionElement } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { buildProofingLineItemPath, PROOF_APPROVAL_REQUIRED_ROUTING_REASON } from "@/lib/proofingNavigation";

export type ProductionConfig = {
  enabledViews: string[];
  defaultView: string;
  finishingMode?: "integrated_with_print" | "dedicated_finishing_queue";
  printerOptionsByStation?: Record<string, string[]>;
};

export type ProductionAlertType =
  | "color_match"
  | "pms_match"
  | "customer_specific"
  | "machine_setting"
  | "finishing_instruction"
  | "registration_instruction"
  | "general_warning";

export type ProductionAlertSeverity = "info" | "warning" | "critical";
export type ProductionAlertStation = "prepress" | "roll" | "flatbed" | "fulfillment" | "all";
export type ProductionAlertStatus = "active" | "acknowledged" | "resolved" | "cancelled" | "archived";

export type ProductionAlertSummary = {
  id: string;
  orderId: string;
  orderLineItemId: string | null;
  productionJobId: string | null;
  title: string;
  message: string | null;
  alertType: ProductionAlertType;
  severity: ProductionAlertSeverity;
  visibleStations: ProductionAlertStation[];
  status: ProductionAlertStatus;
  createdByUserId: string | null;
  createdAt: string | null;
  acknowledgedByUserId: string | null;
  acknowledgedAt: string | null;
  resolvedByUserId: string | null;
  resolvedAt: string | null;
  metadata?: Record<string, unknown> | null;
  updatedAt?: string | null;
};

export type ProductionAlertPreset = {
  id: string;
  name: string;
  title: string;
  message: string | null;
  alertType: ProductionAlertType;
  severity: ProductionAlertSeverity;
  visibleStations: ProductionAlertStation[];
  isActive: boolean;
  sortOrder: number;
  createdByUserId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  metadata?: Record<string, unknown> | null;
};

export type ProductionDisplayOptionRow = {
  groupLabel?: string | null;
  optionLabel: string;
  selectedLabel: string;
  isDefault?: boolean;
};

export type ProductionTimerSummary = {
  isRunning: boolean;
  runningSince: string | null;
  currentSeconds: number;
};

export type ProductionOrderLineItemSummary = {
  id: string;
  description: string;
  quantity: number;
  width: string | null;
  height: string | null;
  materialId: string | null;
  materialName: string | null;
  productType: string;
  status: string;
  productionNotes?: string | null; // Line-item production/finish notes
  optionSelectionsJson?: any; // PBV2 options (lamination, etc.)
  pbv2SnapshotJson?: any;
  specsJson?: any;
  optionRows?: ProductionDisplayOptionRow[];
  selectedOptions?: Array<{ // Legacy options format
    optionId: string;
    optionName: string;
    value: string | number | boolean;
    note?: string;
    setupCost: number;
    calculatedCost: number;
  }>;
};

export type ProductionOrderArtworkSummary = {
  id: string;
  orderLineItemId: string | null;
  fileName: string;
  fileUrl: string;
  thumbKey: string | null;
  previewKey: string | null;
  thumbnailUrl: string | null;
  side: string;
  isPrimary: boolean;
  thumbStatus: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
};

export type ProductionJobListItem = {
  id: string;
  view: string;
  stationKey?: string | null;
  stepKey?: string | null;
  routingReason?: string | null;
  routingSource?: string | null;
  idempotencyNote?: string | null;
  lineItemId?: string | null;
  status: "queued" | "in_progress" | "paused" | "done";
  startedAt: string | null;
  completedAt: string | null;
  completedByUserId?: string | null;
  previousStatus?: string | null;
  previousStation?: string | null;
  previousStationLabel?: string | null;
  restoreUntil?: string | null;
  restoredAt?: string | null;
  restoredByUserId?: string | null;
  restoreReason?: string | null;
  undoAllowed?: boolean;
  totalSeconds: number;
  timer: ProductionTimerSummary;
  reprintCount: number;
  // LIVE LINE ITEM FIELDS (top-level, synced from current line item state)
  qty?: number; // Current quantity from line item
  jobDescription?: string; // Line item description or fallback
  size?: string; // Formatted "W × H" or "—"
  sides?: string; // "Single", "Double", or "—" (parsed from selectedOptions)
  media?: string; // Material name or "—"
  mediaLabel?: string; // Alias for media (legacy)
  optionRows?: ProductionDisplayOptionRow[];
  finishingRequirements?: string[];
  productionAlerts?: ProductionAlertSummary[];
  lamination?: {
    label: string;
    source: "option" | "none";
  };
  finishingMode?: "integrated_with_print" | "dedicated_finishing_queue";
  printerOptions?: string[];
  assignedPrinterId?: string | null;
  assignedPrinterName?: string | null;
  assignedPrinterByUserId?: string | null;
  assignedPrinterAt?: string | null;
  // Explicit preview URLs for fast Overview thumbnails
  frontPreviewUrl?: string;
  backPreviewUrl?: string;
  frontFileUrl?: string;
  backFileUrl?: string;
  // Artwork at job level (for Production Overview)
  artwork?: ProductionOrderArtworkSummary[];
  notes?: Array<{ id: string; text: string; createdAt: string; actorUserId?: string | null; edited?: boolean }>;
  // Production ticket fields (top-level, populated by job detail endpoint)
  contactName?: string | null;
  assignedTo?: string | null;
  internalNotes?: string | null;
  productionNotes?: string | null;
  poNumber?: string | null;
  fulfillment?: string | null;
  orderNumber?: string;
  displayNumber?: string | null;
  numberCore?: number | null;
  order: {
    id: string;    customerId: string;    orderNumber: string;
    displayNumber?: string | null;
    numberCore?: number | null;
    customerName: string;
    contactName?: string | null;
    internalNotes?: string | null;
    poNumber?: string | null;
    fulfillment?: string | null;
    dueDate: string | null;
    priority: string;
    fulfillmentStatus?: string | null;
    routingTarget?: string | null;
    lineItems?: {
      count: number;
      totalQuantity: number;
      primary: ProductionOrderLineItemSummary | null;
      items: ProductionOrderLineItemSummary[];
    };
    artwork?: ProductionOrderArtworkSummary[];
    sides?: number | null; // Legacy: artwork-based count
  };
  createdAt: string;
  updatedAt: string;
};

export type RecentlyCompletedProductionJob = {
  id: string;
  orderId: string;
  lineItemId: string | null;
  orderNumber: string;
  customerName: string;
  itemName: string;
  stationKey: string;
  stationLabel: string;
  previousStatus: string | null;
  previousStation: string | null;
  previousStationLabel: string;
  completedAt: string | null;
  completedByUserId: string | null;
  completedBy: string | null;
  restoreUntil: string | null;
  restoredAt: string | null;
  restoreReason: string | null;
  undoAllowed: boolean;
};

export type ProductionEvent = {
  id: string;
  type:
    | "timer_started"
    | "timer_stopped"
    | "note"
    | "reprint_incremented"
    | "media_used_set"
    | "intake"
    | "routing_override"
    | "ticket_printed"
    | "printer_assigned"
    | "production_alert_acknowledged";
  payload: any;
  actorUserId?: string | null;
  createdAt: string;
};

export type ProductionOtherJobInOrder = {
  id: string;
  jobId: string;
  lineItemId: string | null;
  stationKey: string | null;
  stepKey: string | null;
  status: "queued" | "in_progress" | "done" | (string & {});
  qty: number;
  size: string;
  sides: string;
  media: string;
  jobDescription: string;
  dueDate: string | null;
  createdAt: string;
};

export type ProductionJobDetail = Omit<ProductionJobListItem, "view"> & {
  events: ProductionEvent[];
  otherJobsInOrder?: ProductionOtherJobInOrder[];
};

export function useProductionConfig() {
  return useQuery<ProductionConfig>({
    queryKey: ["/api/production/config"],
    queryFn: async () => {
      const res = await fetch("/api/production/config", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch production config");
      const json = await res.json();
      return json.data;
    },
  });
}

export function useProductionJobs(
  filters?: {
    status?: string;
    view?: string;
    station?: string;
    orderId?: string;
    search?: string;
    sortBy?: string;
    sortDirection?: string;
  },
  options?: { enabled?: boolean }
) {
  return useQuery<ProductionJobListItem[]>({
    queryKey: ["/api/production/jobs", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      if (filters?.station) params.set("station", filters.station);
      else if (filters?.view) params.set("view", filters.view);
      if (filters?.orderId) params.set("orderId", filters.orderId);
      if (filters?.search?.trim()) params.set("search", filters.search.trim());
      if (filters?.sortBy) params.set("sortBy", filters.sortBy);
      if (filters?.sortDirection) params.set("sortDirection", filters.sortDirection);
      const url = `/api/production/jobs${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch production jobs");
      const json = await res.json();
      return json.data || [];
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: options?.enabled !== false,
  });
}

export function useProductionJob(jobId: string | undefined) {
  return useQuery<ProductionJobDetail>({
    queryKey: ["/api/production/jobs", jobId],
    queryFn: async () => {
      if (!jobId) throw new Error("jobId required");
      const res = await fetch(`/api/production/jobs/${jobId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch production job");
      const json = await res.json();
      return json.data;
    },
    enabled: !!jobId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useCreateProductionJobFromOrder() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (orderId: string) => {
      const res = await fetch(`/api/production/jobs/from-order/${orderId}`, {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to create production job");
      return json.data as { id: string; orderId: string; status: string };
    },
    onSuccess: (_data, orderId) => {
      qc.invalidateQueries({ queryKey: ["/api/production/jobs"] });
      toast({ title: "Production job ready" });
      qc.invalidateQueries({ queryKey: ["/api/orders", orderId] as any });
    },
    onError: (e: Error) => {
      toast({ title: "Create job failed", description: e.message, variant: "destructive" });
    },
  });
}

export type ScheduleProductionResult = {
  success: boolean;
  data: {
    createdJobCount: number;
    existingJobCount: number;
    skippedNonProductionCount: number;
    affectedLineItemIds: string[];
    lineItemDiagnostics?: Record<string, {
      stationKey: string;
      stepKey: string;
      routingReason: string;
      routingSource?: string;
      idempotencyNote?: string;
    }>;
  };
  message: string;
};

export function useScheduleOrderLineItemsForProduction(orderId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async (lineItemIds?: string[]) => {
      const res = await fetch(`/api/orders/${orderId}/production/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineItemIds }),
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to schedule line items for production");
      return json as ScheduleProductionResult;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/production/jobs"] });
      qc.invalidateQueries({ queryKey: ["/api/orders", orderId] as any });
      const diagnosticEntries = data?.data?.lineItemDiagnostics
        ? Object.entries(data.data.lineItemDiagnostics)
        : [];
      const diagnostics = diagnosticEntries.map(([, diagnostic]) => diagnostic);
      const proofBlocked = diagnosticEntries.filter(
        ([, diagnostic]) => diagnostic.routingReason === PROOF_APPROVAL_REQUIRED_ROUTING_REASON,
      );
      const firstDiagnostic = diagnostics[0] ?? null;
      const firstBlockedLineItemId = proofBlocked[0]?.[0] ?? null;
      const hasScheduledJobs = (data?.data?.createdJobCount ?? 0) + (data?.data?.existingJobCount ?? 0) > 0;

      if (!hasScheduledJobs && proofBlocked.length > 0) {
        toast({
          title: "Approved proof required",
          description: data.message,
          variant: "destructive",
          action: firstBlockedLineItemId
            ? (createElement(
                ToastAction,
                {
                  altText: "Open proofing",
                  onClick: () => navigate(buildProofingLineItemPath(firstBlockedLineItemId)),
                },
                "Open Proofing",
              ) as unknown as ToastActionElement)
            : undefined,
        });
        return;
      }

      const details = firstDiagnostic
        ? `${data.message}${firstDiagnostic.idempotencyNote ? ` • ${firstDiagnostic.idempotencyNote}` : ""}`
        : data.message;
      toast({
        title: "Production scheduling complete",
        description: details,
      });
    },
    onError: (e: Error) => {
      toast({ 
        title: "Scheduling failed", 
        description: e.message, 
        variant: "destructive" 
      });
    },
  });
}

export function useProductionAlerts(
  filters?: {
    orderId?: string;
    lineItemId?: string;
    productionJobId?: string;
    station?: ProductionAlertStation;
    status?: ProductionAlertStatus;
  },
  options?: { enabled?: boolean },
) {
  return useQuery<ProductionAlertSummary[]>({
    queryKey: ["/api/production-alerts", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.orderId) params.set("orderId", filters.orderId);
      if (filters?.lineItemId) params.set("lineItemId", filters.lineItemId);
      if (filters?.productionJobId) params.set("productionJobId", filters.productionJobId);
      if (filters?.station) params.set("station", filters.station);
      if (filters?.status) params.set("status", filters.status);
      const res = await fetch(`/api/production-alerts${params.toString() ? `?${params.toString()}` : ""}`, {
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.success === false) throw new Error(json?.error || "Failed to fetch production alerts");
      return json.data || [];
    },
    enabled: options?.enabled !== false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useProductionAlertPresets(options?: { includeInactive?: boolean; enabled?: boolean }) {
  return useQuery<ProductionAlertPreset[]>({
    queryKey: ["/api/production-alert-presets", { includeInactive: options?.includeInactive === true }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options?.includeInactive) params.set("includeInactive", "true");
      const res = await fetch(`/api/production-alert-presets${params.toString() ? `?${params.toString()}` : ""}`, {
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.success === false) throw new Error(json?.error || "Failed to fetch production alert presets");
      return json.data || [];
    },
    enabled: options?.enabled !== false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

function invalidateProduction(qc: ReturnType<typeof useQueryClient>, jobId?: string) {
  qc.invalidateQueries({ queryKey: ["/api/production/jobs"] });
  qc.invalidateQueries({ queryKey: ["/api/production/jobs/recently-completed"] });
  if (jobId) qc.invalidateQueries({ queryKey: ["/api/production/jobs", jobId] });
  qc.invalidateQueries({ queryKey: ["/api/production-alerts"] });
  qc.invalidateQueries({ queryKey: ["dashboardSummary"] });
  qc.invalidateQueries({ queryKey: ["/api/operational-summary"] });
  qc.invalidateQueries({ queryKey: ["fulfillment"] });
  qc.invalidateQueries({ queryKey: ["/api/fulfillment/queue"] });
  qc.invalidateQueries({ queryKey: ["/api/orders"] });
}

export function useRecentlyCompletedProductionJobs(
  filters?: { station?: string; view?: string },
  options?: { enabled?: boolean },
) {
  return useQuery<RecentlyCompletedProductionJob[]>({
    queryKey: ["/api/production/jobs/recently-completed", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.station) params.set("station", filters.station);
      else if (filters?.view) params.set("view", filters.view);
      const res = await fetch(`/api/production/jobs/recently-completed${params.toString() ? `?${params.toString()}` : ""}`, {
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.success === false) throw new Error(json?.message || json?.error || "Failed to fetch recently completed jobs");
      return json.data || [];
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: options?.enabled !== false,
  });
}

export function useCreateProductionAlert() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: {
      orderId?: string;
      orderLineItemId?: string;
      lineItemId?: string;
      productionJobId?: string;
      title: string;
      message?: string | null;
      alertType: ProductionAlertType;
      severity: ProductionAlertSeverity;
      visibleStations: ProductionAlertStation[];
      presetId?: string | null;
      metadata?: Record<string, unknown> | null;
    }) => {
      const res = await fetch("/api/production-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.success === false) throw new Error(json?.error || "Failed to create production alert");
      return json.data as ProductionAlertSummary;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/production-alerts"] });
      qc.invalidateQueries({ queryKey: ["/api/production/jobs"] });
      qc.invalidateQueries({ queryKey: ["/api/prepress/queue"] });
      toast({ title: "Production alert added" });
    },
    onError: (e: Error) => {
      toast({ title: "Alert failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useCreateProductionAlertPreset() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: {
      name: string;
      title: string;
      message?: string | null;
      alertType: ProductionAlertType;
      severity: ProductionAlertSeverity;
      visibleStations: ProductionAlertStation[];
      isActive?: boolean;
      sortOrder?: number;
      metadata?: Record<string, unknown> | null;
    }) => {
      const res = await fetch("/api/production-alert-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.success === false) throw new Error(json?.error || "Failed to create production alert preset");
      return json.data as ProductionAlertPreset;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/production-alert-presets"] });
      toast({ title: "Production alert preset created" });
    },
    onError: (e: Error) => {
      toast({ title: "Preset failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useUpdateProductionAlertPreset() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, ...data }: Partial<ProductionAlertPreset> & { id: string }) => {
      const res = await fetch(`/api/production-alert-presets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.success === false) throw new Error(json?.error || "Failed to update production alert preset");
      return json.data as ProductionAlertPreset;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/production-alert-presets"] });
      toast({ title: "Production alert preset updated" });
    },
    onError: (e: Error) => {
      toast({ title: "Preset update failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useArchiveProductionAlertPreset() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/production-alert-presets/${id}/archive`, {
        method: "PATCH",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.success === false) throw new Error(json?.error || "Failed to archive production alert preset");
      return json.data as ProductionAlertPreset;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/production-alert-presets"] });
      toast({ title: "Production alert preset archived" });
    },
    onError: (e: Error) => {
      toast({ title: "Archive failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useAcknowledgeProductionAlert(productionJobId?: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (alertId: string) => {
      const res = await fetch(`/api/production-alerts/${alertId}/acknowledge`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productionJobId }),
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.success === false) throw new Error(json?.error || "Failed to acknowledge alert");
      return json.data as ProductionAlertSummary;
    },
    onSuccess: () => {
      invalidateProduction(qc, productionJobId);
      toast({ title: "Alert acknowledged" });
    },
    onError: (e: Error) => {
      toast({ title: "Acknowledge failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useResolveProductionAlert(productionJobId?: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (alertId: string) => {
      const res = await fetch(`/api/production-alerts/${alertId}/resolve`, {
        method: "PATCH",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.success === false) throw new Error(json?.error || "Failed to resolve alert");
      return json.data as ProductionAlertSummary;
    },
    onSuccess: () => {
      invalidateProduction(qc, productionJobId);
      toast({ title: "Alert resolved" });
    },
    onError: (e: Error) => {
      toast({ title: "Resolve failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useStartProductionTimer(jobId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/production/jobs/${jobId}/start`, {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to start timer");
      return json.data;
    },
    onSuccess: () => {
      invalidateProduction(qc, jobId);
      toast({ title: "Timer started" });
    },
    onError: (e: Error) => {
      toast({ title: "Start failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useStopProductionTimer(jobId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/production/jobs/${jobId}/stop`, {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to stop timer");
      return json.data;
    },
    onSuccess: () => {
      invalidateProduction(qc, jobId);
      toast({ title: "Timer stopped" });
    },
    onError: (e: Error) => {
      toast({ title: "Stop failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useCompleteProductionJob(jobId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (opts?: { skipProduction?: boolean }) => {
      const res = await fetch(`/api/production/jobs/${jobId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skipProduction: opts?.skipProduction === true }),
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to complete job");
      return json.data;
    },
    onSuccess: (data) => {
      invalidateProduction(qc, jobId);
      // Completing a job may route the line item to proofing — update proofing queue immediately.
      qc.invalidateQueries({ queryKey: ["/api/proofing/queue"] });
      const isFulfillment = (data as any)?.stationKey === "fulfillment";
      toast({ title: isFulfillment ? "Fulfillment complete — item marked done" : "Job completed" });
    },
    onError: (e: Error) => {
      toast({ title: "Complete failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useReopenProductionJob(jobId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/production/jobs/${jobId}/reopen`, {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to reopen job");
      return json.data;
    },
    onSuccess: () => {
      invalidateProduction(qc, jobId);
      // Reopening pulls the job back from done/proofing into production boards.
      qc.invalidateQueries({ queryKey: ["/api/proofing/queue"] });
      toast({ title: "Job reopened" });
    },
    onError: (e: Error) => {
      toast({ title: "Reopen failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useUndoCompleteProductionJob(jobId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (payload?: { reason?: string | null }) => {
      const res = await fetch(`/api/production/jobs/${jobId}/undo-complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: payload?.reason ?? null }),
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.success === false) throw new Error(json?.message || json?.error || "Failed to undo completion");
      return json.data;
    },
    onSuccess: () => {
      invalidateProduction(qc, jobId);
      qc.invalidateQueries({ queryKey: ["/api/proofing/queue"] });
      toast({ title: "Job restored" });
    },
    onError: (e: Error) => {
      toast({ title: "Undo failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useReprintProductionJob(jobId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/production/jobs/${jobId}/reprint`, {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to record reprint");
      return json.data;
    },
    onSuccess: () => {
      invalidateProduction(qc, jobId);
      toast({ title: "Reprint recorded" });
    },
    onError: (e: Error) => {
      toast({ title: "Reprint failed", description: e.message, variant: "destructive" });
    },
  });
}

/**
 * Best-effort print-history logging for production tickets. Records a
 * `ticket_printed` production event with optional print-snapshot metadata
 * (from the Print Options modal). Failures are intentionally swallowed —
 * logging must never block an operator from printing.
 */
export type TicketPrintReason =
  | "print"
  | "standard"
  | "reprint"
  | "completion"
  | "partial"
  | "test";

export interface TicketPrintLogMeta {
  reason: TicketPrintReason;
  /** Printer destination label chosen in the Print Options modal. */
  destination?: string | null;
  /** Quantity string actually printed (e.g. "150 of 200"). */
  quantityDisplay?: string | null;
  /** Fulfillment override applied for this print. */
  fulfillment?: string | null;
  /** Station/route override applied for this print. */
  route?: string | null;
  /** Ad-hoc ticket note printed. */
  note?: string | null;
}

export async function logTicketPrint(
  jobId: string,
  meta: TicketPrintReason | TicketPrintLogMeta,
): Promise<void> {
  if (!jobId) return;
  const body: TicketPrintLogMeta = typeof meta === "string" ? { reason: meta } : meta;
  try {
    await fetch(`/api/production/jobs/${jobId}/ticket-print`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // Non-fatal: ticket already printed; history logging is opportunistic.
  }
}

/**
 * Best-effort print-history logging for an order traveler. Order travelers are
 * not tied to a production job, so the server records this in the generic
 * `audit_logs` table. Failures are swallowed — logging never blocks printing.
 */
export async function logTravelerPrint(orderId: string): Promise<void> {
  if (!orderId) return;
  try {
    await fetch(`/api/orders/${orderId}/traveler-print`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // Non-fatal: traveler already printed; history logging is opportunistic.
  }
}

export function useSetProductionMediaUsed(jobId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: { text: string; qty?: number; unit?: string; comment: string }) => {
      const res = await fetch(`/api/production/jobs/${jobId}/media-used`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to set media used");
      return json.data;
    },
    onSuccess: () => {
      invalidateProduction(qc, jobId);
      toast({ title: "Waste logged" });
    },
    onError: (e: Error) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useAddProductionNote(jobId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (text: string) => {
      const res = await fetch(`/api/production/jobs/${jobId}/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to add note");
      return json.data;
    },
    onSuccess: () => {
      invalidateProduction(qc, jobId);
      toast({ title: "Note added" });
    },
    onError: (e: Error) => {
      toast({ title: "Note failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useEditProductionNote(jobId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ noteId, text }: { noteId: string; text: string }) => {
      const res = await fetch(`/api/production/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to edit note");
      return json.data;
    },
    onSuccess: () => {
      invalidateProduction(qc, jobId);
      toast({ title: "Note updated" });
    },
    onError: (e: Error) => {
      toast({ title: "Edit failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useDeleteProductionNote(jobId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (noteId: string) => {
      const res = await fetch(`/api/production/notes/${noteId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to delete note");
      return json.data;
    },
    onSuccess: () => {
      invalidateProduction(qc, jobId);
      toast({ title: "Note deleted" });
    },
    onError: (e: Error) => {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useUpdateProductionJobStatus(jobId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (status: "queued" | "in_progress" | "done") => {
      const res = await fetch(`/api/production/jobs/${jobId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to update status");
      return json.data;
    },
    onSuccess: () => {
      invalidateProduction(qc, jobId);
      // Don't show toast for drag/drop updates - too noisy
    },
    onError: (e: Error) => {
      toast({ title: "Status update failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useAssignProductionPrinter(jobId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: { assignedPrinterId?: string | null; assignedPrinterName: string }) => {
      const res = await fetch(`/api/production/jobs/${jobId}/printer-assignment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to save printer assignment");
      return json.data;
    },
    onSuccess: () => {
      invalidateProduction(qc, jobId);
      toast({ title: "Printer / Machine saved" });
    },
    onError: (e: Error) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useSendLineItemToPrepress() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (args: { lineItemId: string; jobId?: string; note: string; noPrintsCompletedYet?: boolean }) => {
      const res = await fetch(`/api/production/line-item/${args.lineItemId}/send-to-prepress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: args.note, noPrintsCompletedYet: args.noPrintsCompletedYet ?? false }),
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to send to prepress");
      return json;
    },
    onSuccess: (_data, args) => {
      // Invalidate production boards so the job disappears
      qc.invalidateQueries({ queryKey: ["/api/production/jobs"] });
      if (args.jobId) {
        qc.invalidateQueries({ queryKey: ["/api/production/jobs", args.jobId] });
      }
      // Invalidate prepress queue so the item appears
      qc.invalidateQueries({ queryKey: ["/api/prepress/queue"] });
      toast({ title: "Sent to prepress", description: "Job moved to prepress queue for editing" });
    },
    onError: (e: Error) => {
      toast({ title: "Send to prepress failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useSubmitReprintRequest(jobId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (args: {
      lineItemId: string;
      filename: string;
      quantity: number;
      units: string;
      reason: string;
      noPrintsCompletedYet?: boolean;
      fileId?: string;
    }) => {
      const res = await fetch(`/api/production/line-item/${args.lineItemId}/reprint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: args.fileId,
          filename: args.filename,
          quantity: args.quantity,
          units: args.units,
          reason: args.reason,
          noPrintsCompletedYet: args.noPrintsCompletedYet ?? false,
        }),
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to create reprint request");
      return json;
    },
    onSuccess: () => {
      invalidateProduction(qc, jobId);
      toast({ title: "Reprint request created" });
    },
    onError: (e: Error) => {
      toast({ title: "Reprint request failed", description: e.message, variant: "destructive" });
    },
  });
}

export function useOverrideProductionJobRouting() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (args: { jobId: string; stationKey: string; stepKey: string; reason?: string }) => {
      const res = await fetch(`/api/production/jobs/${args.jobId}/routing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stationKey: args.stationKey, stepKey: args.stepKey, reason: args.reason }),
        credentials: "include",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to override routing");
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ["/api/production/jobs"] });
      qc.invalidateQueries({ queryKey: ["/api/production/jobs", variables.jobId] });
    },
  });
}
