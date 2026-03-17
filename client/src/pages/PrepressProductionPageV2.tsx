import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, RefreshCw, History, FileText, Download, ZoomIn, Upload, Image as ImageIcon, Info, Paperclip, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { resolveObjectsPublicUrl } from "@/lib/apiConfig";
import { AttachmentViewerDialog, type AttachmentData } from "@/components/AttachmentViewerDialog";

// API Types
type QueueItem = {
  lineItemId: string;
  orderId?: string;
  jobNumber: string;
  customerName: string;
  productName: string;
  printType: string | null;
  media: string | null;
  dueDate: string | null;
  status: string;
  workflowState?: "ready_for_prepress" | "in_prepress" | "ready_for_production" | "in_production" | "completed" | "on_hold" | "canceled" | string;
  hasCompletedSession?: boolean;
  rush: boolean;
  assignedTo: string | null;
  sessionId: string | null;
  sessionStartedAt?: string | null;
  sessionStartedByUserId?: string | null;
  prepressNotes?: string | null;
  issueFlag?: boolean;
  issueType?: string | null;
  hasDownstreamActiveJob?: boolean;
  hasAnyProductionJob?: boolean;
  activeOwnerJobId?: string | null;
  activeOwnerStationKey?: string | null;
  activeOwnerStepKey?: string | null;
  isActivelyOwnedByPrepress?: boolean;
  thumbFileId?: string | null;
  thumbSelectionReason?: "thumbFileId" | "original_fallback" | "final_fallback" | "none" | null;
  thumbCandidateMimeType?: string | null;
  thumbnailUrl?: string | null;
  fileCounts: {
    originals: number;
    finals: number;
  };
  // Job specs for detail view
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
};

type LineItemFile = {
  id: string;
  role: "original" | "final" | "reference";
  originalFilename: string;
  sizeBytes: number;
  tag: string | null;
  createdAt: string;
  uploadedBy: string;
  computedDisplayFilename?: string;
  originalUrl?: string | null;
  previewUrl?: string | null;
  downloadUrl?: string | null;
  thumbnailUrl?: string | null;
  mimeType?: string;
};

type BridgedOriginalFile = {
  id: string;
  originalFilename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  role: string;
  createdAt: string;
  source: "order_attachment";
  downloadUrl: string;
  thumbnailUrl: string | null;
  uploadedBy: string | null;
};

type LineItemFilesPayload = {
  originals: LineItemFile[];
  finals: LineItemFile[];
  references: LineItemFile[];
  bridgedOriginals: BridgedOriginalFile[];
};

type VisibleFileCategory = "original_customer" | "bridged_original" | "final_production";

type VisibleFileRecord = AttachmentData & {
  category: VisibleFileCategory;
  displayName: string;
  uploadedByLabel: string;
  tagLabel: string;
  downloadUrl: string;
  sizeBytesValue: number | null;
};

type PendingViewerRequest = {
  lineItemId: string;
  preferredFileId?: string | null;
};

function getPrepressWorkflowDisplay(item: Pick<QueueItem, "workflowState" | "hasCompletedSession"> | null | undefined) {
  const workflowState = String(item?.workflowState || "ready_for_prepress").toLowerCase();

  if (workflowState === "in_prepress") {
    return {
      label: "IN PREPRESS",
      bgClass: "bg-[#1773cf]/20",
      textClass: "text-[#1773cf]",
      borderClass: "border-[#1773cf]/30",
      note: item?.hasCompletedSession ? "Session complete" : null,
    };
  }

  return {
    label: "READY FOR PREPRESS",
    bgClass: "bg-slate-700",
    textClass: "text-slate-300",
    borderClass: "border-[#2d3748]",
    note: null,
  };
}

type HistoryEntry = {
  at: string;
  source: string;
  type: string;
  description: string;
};

type SpecSheetData = {
  lineItemId: string;
  jobNumber: string;
  customerName: string;
  productName: string;
  quantity: number;
  width: number | null;
  height: number | null;
  sqFootage: number | null;
  media: string | null;
  printType: string | null;
  bleed: string | null;
  finishingBullets: string[];
  originals: LineItemFile[];
  finals: LineItemFile[];
  references: LineItemFile[];
};

type UploadProgress = {
  id: string;
  filename: string;
  progress: number;
};

type PlannedMaterial = {
  materialId: string;
  materialName?: string;
  qty: number;
  uom: "sqft" | "ft" | "each";
  basis: string;
  sources: Array<{ optionLabel: string; choiceLabel: string }>;
};

type EffectiveMaterial = {
  materialId: string;
  materialName?: string;
  qty: number;
  uom: "sqft" | "ft" | "each";
  isOverridden?: boolean;
};

type MaterialOverrideOp =
  | {
      op: "replace";
      fromMaterialId: string;
      toMaterialId: string;
      reasonNote: string;
      priceImpact: "none" | "potential" | "confirmed";
      createdAt: string;
      createdByUserId?: string;
    }
  | {
      op: "add" | "adjust_qty";
      materialId: string;
      qty: number;
      uom: "sqft" | "ft" | "each";
      reasonNote: string;
      priceImpact: "none" | "potential" | "confirmed";
      createdAt: string;
      createdByUserId?: string;
    }
  | {
      op: "remove";
      materialId: string;
      reasonNote: string;
      priceImpact: "none" | "potential" | "confirmed";
      createdAt: string;
      createdByUserId?: string;
    };

type MaterialsEffectivePayload = {
  plannedMaterials: PlannedMaterial[];
  effectiveMaterials: EffectiveMaterial[];
  effectiveFingerprint: string;
  overrides: MaterialOverrideOp[];
  pricingReviewRequired: boolean;
  overrideMode: "prepress_only" | "prepress_and_production";
  overrideAllowed: boolean;
  overrideBlockedReason?: string | null;
};

type MaterialsAvailabilityPayload = {
  effectiveFingerprint: string;
  allAvailable: boolean;
  items: Array<{
    materialId: string;
    materialName?: string;
    uom: "sqft" | "ft" | "each";
    requiredQty: number;
    availableQty: number;
    shortageQty: number;
    isAvailable: boolean;
  }>;
};

// Utility to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatElapsedDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

const PREPRESS_QUEUE_QUERY_KEY = ["/api/prepress/queue"] as const;

function getPrepressLineItemQueryKey(lineItemId: string | null) {
  return ["/api/prepress/line-item", lineItemId] as const;
}

export default function PrepressProductionPageV2() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // UI State
  const [selectedLineItemId, setSelectedLineItemId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [printTypeFilter, setPrintTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [rushFilter, setRushFilter] = useState(false);
  const [sortBy, setSortBy] = useState("due_date");
  const [sortAsc, setSortAsc] = useState(true);
  const [prepressNotes, setPrepressNotes] = useState("");
  const [flagForQc, setFlagForQc] = useState(false);
  const [issueType, setIssueType] = useState("");
  const [uploadRole, setUploadRole] = useState<"original" | "final">("final");
  const [selectedTag, setSelectedTag] = useState("final_print");
  const [uploadingFiles, setUploadingFiles] = useState<UploadProgress[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [specSheetOpen, setSpecSheetOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [pendingViewerRequest, setPendingViewerRequest] = useState<PendingViewerRequest | null>(null);
  const [materialOverrideOpen, setMaterialOverrideOpen] = useState(false);
  const [materialOverrideMode, setMaterialOverrideMode] = useState<"replace" | "add" | "remove" | "adjust_qty">("replace");
  const [overrideFromMaterialId, setOverrideFromMaterialId] = useState("");
  const [overrideToMaterialId, setOverrideToMaterialId] = useState("");
  const [overrideMaterialId, setOverrideMaterialId] = useState("");
  const [overrideQty, setOverrideQty] = useState("");
  const [overrideUom, setOverrideUom] = useState<"sqft" | "ft" | "each">("sqft");
  const [overrideReasonNote, setOverrideReasonNote] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const normalizedSearchQuery = searchQuery.trim();

  const queueFilters = useMemo(
    () => ({
      printType: printTypeFilter,
      status: statusFilter,
      rush: rushFilter,
      sortBy,
      sortAsc,
      search: normalizedSearchQuery,
    }),
    [normalizedSearchQuery, printTypeFilter, rushFilter, sortAsc, sortBy, statusFilter],
  );

  const refreshPrepressQueue = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: PREPRESS_QUEUE_QUERY_KEY });
    await queryClient.refetchQueries({ queryKey: PREPRESS_QUEUE_QUERY_KEY, type: "active" });
  }, [queryClient]);

  const refreshLineItemQueries = React.useCallback(async (lineItemId: string | null) => {
    if (!lineItemId) return;
    const queryKey = getPrepressLineItemQueryKey(lineItemId);
    await queryClient.invalidateQueries({ queryKey });
    await queryClient.refetchQueries({ queryKey, type: "active" });
  }, [queryClient]);

  // Queue Query
  const { data: queueData, isLoading: queueLoading, isFetching: queueFetching, refetch: refetchQueue } = useQuery({
    queryKey: [...PREPRESS_QUEUE_QUERY_KEY, queueFilters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (queueFilters.printType !== "all") params.set("printType", queueFilters.printType);
      if (queueFilters.status !== "all") params.set("status", queueFilters.status);
      if (queueFilters.rush) params.set("rush", "true");
      if (queueFilters.search) params.set("search", queueFilters.search);
      params.set("sortBy", queueFilters.sortBy);
      params.set("sortOrder", queueFilters.sortAsc ? "asc" : "desc");
      
      const res = await fetch(`/api/prepress/queue?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch queue");
      const data = await res.json();
      if (import.meta.env.DEV) {
        console.log("[Prepress Queue]", data.data?.length || 0, "items");
      }
      return data.data as QueueItem[];
    },
    staleTime: 0,
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    refetchOnReconnect: true,
  });

  // Line Item Files Query
  const { data: filesData } = useQuery({
    queryKey: ["/api/prepress/line-item", selectedLineItemId, "files"],
    queryFn: async () => {
      if (!selectedLineItemId) return null;
      const res = await fetch(`/api/prepress/line-item/${selectedLineItemId}/files`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch files");
      const data = await res.json();
      return data.data as LineItemFilesPayload;
    },
    enabled: !!selectedLineItemId,
  });

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ["/api/prepress/line-item", selectedLineItemId, "history"],
    queryFn: async () => {
      if (!selectedLineItemId) return [] as HistoryEntry[];
      const res = await fetch(`/api/prepress/line-item/${selectedLineItemId}/history`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch history");
      const data = await res.json();
      return (data.data || []) as HistoryEntry[];
    },
    enabled: !!selectedLineItemId && historyOpen,
  });

  const { data: specSheetData, isLoading: specSheetLoading } = useQuery({
    queryKey: ["/api/prepress/line-item", selectedLineItemId, "spec-sheet"],
    queryFn: async () => {
      if (!selectedLineItemId) return null;
      const res = await fetch(`/api/prepress/line-item/${selectedLineItemId}/spec-sheet`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch spec sheet");
      const data = await res.json();
      return data.data as SpecSheetData;
    },
    enabled: !!selectedLineItemId && specSheetOpen,
  });

  const { data: materialsEffectiveData, isLoading: materialsEffectiveLoading } = useQuery({
    queryKey: ["/api/prepress/line-items", selectedLineItemId, "materials-effective"],
    queryFn: async () => {
      if (!selectedLineItemId) {
        return {
          data: {
            plannedMaterials: [] as PlannedMaterial[],
            effectiveMaterials: [] as EffectiveMaterial[],
            effectiveFingerprint: "",
            overrides: [] as MaterialOverrideOp[],
            pricingReviewRequired: false,
            overrideMode: "prepress_and_production" as const,
            overrideAllowed: true,
            overrideBlockedReason: null,
          } as MaterialsEffectivePayload,
          message: undefined as string | undefined,
        };
      }

      const res = await fetch(`/api/prepress/line-items/${selectedLineItemId}/materials-effective`, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Failed to fetch effective materials");
      }
      return {
        data: (data?.data || {
          plannedMaterials: [],
          effectiveMaterials: [],
          effectiveFingerprint: "",
          overrides: [],
          pricingReviewRequired: false,
          overrideMode: "prepress_and_production",
          overrideAllowed: true,
        }) as MaterialsEffectivePayload,
        message: typeof data?.message === "string" ? data.message : undefined,
      };
    },
    enabled: !!selectedLineItemId,
  });

  const { data: materialsAvailabilityData, isLoading: materialsAvailabilityLoading } = useQuery({
    queryKey: ["/api/prepress/line-items", selectedLineItemId, "materials-availability"],
    queryFn: async () => {
      if (!selectedLineItemId) {
        return { effectiveFingerprint: "", allAvailable: true, items: [] } as MaterialsAvailabilityPayload;
      }

      const res = await fetch(`/api/prepress/line-items/${selectedLineItemId}/materials-availability`, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Failed to fetch materials availability");
      }
      return (data?.data || { effectiveFingerprint: "", allAvailable: true, items: [] }) as MaterialsAvailabilityPayload;
    },
    enabled: !!selectedLineItemId,
  });

  // Mutations
  const startSessionMutation = useMutation({
    mutationFn: async (lineItemId: string) => {
      const res = await fetch("/api/prepress/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ lineItemId }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to start session");
      }
      return res.json();
    },
    onSuccess: async (response, lineItemId) => {
      await Promise.all([
        refreshPrepressQueue(),
        refreshLineItemQueries(lineItemId),
      ]);
      toast({
        title: response?.data?.resumed ? "Prepress resumed" : "Prepress started",
        description: response?.data?.resumed ? "Existing session restored" : "Session created successfully",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const saveNoteMutation = useMutation({
    mutationFn: async ({ sessionId, note, flaggedForQc, issueType }: { sessionId: string; note: string; flaggedForQc: boolean; issueType: string }) => {
      const res = await fetch(`/api/prepress/session/${sessionId}/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ note, flaggedForQc, issueType }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || "Failed to save note");
      }
      return res.json();
    },
    onSuccess: async () => {
      await Promise.all([
        refreshPrepressQueue(),
        refreshLineItemQueries(selectedLineItemId),
      ]);
      toast({ title: "Notes saved", description: "Prepress notes updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const completeSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch(`/api/prepress/session/${sessionId}/complete`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to complete prepress");
      }
      return res.json();
    },
    onSuccess: async (response) => {
      const lineItemId = response?.data?.lineItemId ?? selectedLineItemId;
      await Promise.all([
        refreshPrepressQueue(),
        refreshLineItemQueries(lineItemId),
        queryClient.invalidateQueries({ queryKey: ["/api/production/jobs"] }),
        queryClient.refetchQueries({ queryKey: ["/api/production/jobs"], type: "active" }),
      ]);
      toast({ title: "Prepress complete", description: "Prepress is complete. Use Send to Production for handoff." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const uploadFileMutation = useMutation({
    mutationFn: async ({ lineItemId, file, role, tag, sessionId }: { lineItemId: string; file: File; role: string; tag: string; sessionId?: string | null }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("lineItemId", lineItemId);
      formData.append("role", role);
      if (tag) formData.append("tag", tag);
      if (sessionId) formData.append("sessionId", sessionId);

      const uploadId = Math.random().toString();
      setUploadingFiles(prev => [...prev, { id: uploadId, filename: file.name, progress: 0 }]);

      const res = await fetch("/api/prepress/files/upload", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      setUploadingFiles(prev => prev.filter(u => u.id !== uploadId));

      if (!res.ok) throw new Error("Upload failed");
      return res.json();
    },
    onSuccess: async (_response, variables) => {
      await Promise.all([
        refreshLineItemQueries(variables.lineItemId),
        refreshPrepressQueue(),
      ]);
      toast({ title: "Upload complete", description: "File uploaded successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  // PROMPT B: Send to Print Queue mutation
  const sendToPrintMutation = useMutation({
    mutationFn: async (lineItemId: string) => {
      const res = await fetch(`/api/prepress/line-item/${lineItemId}/send-to-print`, {
        method: "POST",
        credentials: "include",
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to send to print");
      }
      
      return res.json();
    },
    onSuccess: async () => {
      await Promise.all([
        refreshPrepressQueue(),
        queryClient.invalidateQueries({ queryKey: ["/api/production/jobs"] }),
        queryClient.refetchQueries({ queryKey: ["/api/production/jobs"], type: "active" }),
      ]);
      // Clear selection since item will move to production boards
      setSelectedLineItemId(null);
      toast({ 
        title: "Sent to print queue", 
        description: "Job is now ready for production boards" 
      });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Error", 
        description: error.message, 
        variant: "destructive" 
      });
    },
  });

  const updatePrintTypeMutation = useMutation({
    mutationFn: async ({ lineItemId, printType }: { lineItemId: string; printType: string }) => {
      const res = await fetch(`/api/prepress/line-item/${lineItemId}/print-type`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ printType }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || "Failed to update print type");
      }
      return res.json();
    },
    onSuccess: async () => {
      await Promise.all([
        refreshPrepressQueue(),
        queryClient.invalidateQueries({ queryKey: ["/api/production/jobs"] }),
        queryClient.refetchQueries({ queryKey: ["/api/production/jobs"], type: "active" }),
      ]);
      toast({ title: "Print type updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const applyMaterialOverrideMutation = useMutation({
    mutationFn: async (op: any) => {
      if (!selectedLineItemId) throw new Error("No line item selected");
      const res = await fetch(`/api/prepress/line-items/${selectedLineItemId}/material-overrides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ op }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Failed to apply material override");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prepress/line-items", selectedLineItemId, "materials-effective"] });
      queryClient.invalidateQueries({ queryKey: ["/api/prepress/line-items", selectedLineItemId, "materials-availability"] });
      toast({ title: "Material override applied" });
      setMaterialOverrideOpen(false);
      setOverrideReasonNote("");
      setOverrideQty("");
      setOverrideToMaterialId("");
      setOverrideMaterialId("");
    },
    onError: (error: Error) => {
      toast({ title: "Material override failed", description: error.message, variant: "destructive" });
    },
  });

  // Derived state
  const queue = queueData || [];
  const filteredQueue = queue;
  const selectedItem = queue.find(q => q.lineItemId === selectedLineItemId) ?? null;
  const originalFiles = filesData?.originals || [];
  const finalFiles = filesData?.finals || [];
  const bridgedOriginalFiles = filesData?.bridgedOriginals || [];
  const toVisiblePrepressFile = (file: LineItemFile, category: VisibleFileCategory, defaultTag: string): VisibleFileRecord => ({
    id: file.id,
    category,
    fileName: file.computedDisplayFilename || file.originalFilename,
    originalFilename: file.originalFilename,
    fileSize: file.sizeBytes,
    mimeType: file.mimeType || null,
    createdAt: file.createdAt,
    originalUrl: file.originalUrl ?? `/api/prepress/files/${file.id}/download`,
    previewUrl: file.previewUrl ?? null,
    thumbUrl: file.thumbnailUrl || null,
    displayName: file.computedDisplayFilename || file.originalFilename,
    uploadedByLabel: file.uploadedBy,
    tagLabel: file.tag || defaultTag,
    downloadUrl: file.downloadUrl ?? `/api/prepress/files/${file.id}/download`,
    sizeBytesValue: file.sizeBytes,
  });
  const toVisibleBridgedFile = (file: BridgedOriginalFile): VisibleFileRecord => ({
    id: file.id,
    category: "bridged_original",
    fileName: file.originalFilename,
    originalFilename: file.originalFilename,
    fileSize: file.sizeBytes,
    mimeType: file.mimeType,
    createdAt: file.createdAt,
    originalUrl: file.downloadUrl,
    previewUrl: file.downloadUrl,
    thumbUrl: file.thumbnailUrl,
    displayName: file.originalFilename,
    uploadedByLabel: file.uploadedBy || "—",
    tagLabel: "order",
    downloadUrl: file.downloadUrl,
    sizeBytesValue: file.sizeBytes,
  });
  const normalizedVisibleFiles = useMemo<VisibleFileRecord[]>(() => {
    return [
      ...originalFiles.map((file) => toVisiblePrepressFile(file, "original_customer", "original")),
      ...bridgedOriginalFiles.map((file) => toVisibleBridgedFile(file)),
      ...finalFiles.map((file) => toVisiblePrepressFile(file, "final_production", "final")),
    ];
  }, [originalFiles, bridgedOriginalFiles, finalFiles]);
  const visibleOriginalFiles = useMemo(
    () => normalizedVisibleFiles.filter((file) => file.category === "original_customer"),
    [normalizedVisibleFiles]
  );
  const visibleBridgedOriginalFiles = useMemo(
    () => normalizedVisibleFiles.filter((file) => file.category === "bridged_original"),
    [normalizedVisibleFiles]
  );
  const visibleFinalFiles = useMemo(
    () => normalizedVisibleFiles.filter((file) => file.category === "final_production"),
    [normalizedVisibleFiles]
  );
  const resolveViewerIndex = React.useCallback((preferredFileId?: string | null) => {
    if (normalizedVisibleFiles.length === 0) return -1;
    if (!preferredFileId) return 0;
    const nextIndex = normalizedVisibleFiles.findIndex((file) => file.id === preferredFileId);
    return nextIndex >= 0 ? nextIndex : 0;
  }, [normalizedVisibleFiles]);
  const hasFinalFiles = finalFiles.length > 0;
  const hasUsableExistingArtwork =
    originalFiles.length > 0 ||
    bridgedOriginalFiles.some((file) => file.role === "artwork" || file.role === "proof" || file.role === "reference");
  const canCompleteWithExistingArtwork = !hasFinalFiles && hasUsableExistingArtwork;
  const materialsPayload = materialsEffectiveData?.data;
  const plannedMaterials = materialsPayload?.plannedMaterials || [];
  const effectiveMaterials = materialsPayload?.effectiveMaterials || [];
  const effectiveFingerprint = materialsPayload?.effectiveFingerprint || "";
  const materialOverrides = materialsPayload?.overrides || [];
  const pricingReviewRequired = materialsPayload?.pricingReviewRequired || false;
  const overrideMode = materialsPayload?.overrideMode || "prepress_and_production";
  const overrideAllowed = materialsPayload?.overrideAllowed ?? true;
  const overrideBlockedReason = materialsPayload?.overrideBlockedReason || null;
  const plannedMaterialsMessage = materialsEffectiveData?.message;
  const materialsAvailability = materialsAvailabilityData?.items || [];
  const materialsAllAvailable = materialsAvailabilityData?.allAvailable ?? true;
  const isOwnedByPrepress = !!selectedItem?.isActivelyOwnedByPrepress;
  const selectedWorkflowState = String(selectedItem?.workflowState || "").toLowerCase();
  const selectedWorkflowDisplay = getPrepressWorkflowDisplay(selectedItem);
  const canStartPrepress =
    !!selectedItem &&
    isOwnedByPrepress &&
    selectedWorkflowState === "ready_for_prepress" &&
    !selectedItem.sessionId;
  const canComplete =
    isOwnedByPrepress &&
    selectedWorkflowState === "in_prepress" &&
    (hasFinalFiles || hasUsableExistingArtwork) &&
    !!selectedItem?.sessionId;
  const canSendToPrint =
    isOwnedByPrepress &&
    selectedWorkflowState === "in_prepress" &&
    !!selectedItem?.hasCompletedSession &&
    !selectedItem?.sessionId &&
    !selectedItem?.hasDownstreamActiveJob &&
    hasFinalFiles;
  const activeSessionStartedAt = selectedItem?.sessionStartedAt ? new Date(selectedItem.sessionStartedAt) : null;
  const activeSessionElapsedSeconds =
    selectedWorkflowState === "in_prepress" && activeSessionStartedAt && Number.isFinite(activeSessionStartedAt.getTime())
      ? Math.max(0, Math.floor((nowMs - activeSessionStartedAt.getTime()) / 1000))
      : 0;

  // Clear selection if selected item is not in queue
  React.useEffect(() => {
    if (selectedLineItemId && !selectedItem) {
      setSelectedLineItemId(null);
    }
  }, [selectedLineItemId, selectedItem]);

  useEffect(() => {
    if (selectedWorkflowState !== "in_prepress" || !selectedItem?.sessionStartedAt) {
      setNowMs(Date.now());
      return;
    }

    setNowMs(Date.now());
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [selectedItem?.sessionStartedAt, selectedWorkflowState]);

  React.useEffect(() => {
    setViewerOpen(false);
    setViewerIndex(0);
  }, [selectedLineItemId]);

  React.useEffect(() => {
    if (!pendingViewerRequest) return;
    if (pendingViewerRequest.lineItemId !== selectedLineItemId) return;
    if (!filesData) return;

    const nextIndex = resolveViewerIndex(pendingViewerRequest.preferredFileId);
    if (nextIndex < 0) {
      setPendingViewerRequest(null);
      return;
    }

    setViewerIndex(nextIndex);
    setViewerOpen(true);
    setPendingViewerRequest(null);
  }, [filesData, pendingViewerRequest, resolveViewerIndex, selectedLineItemId]);

  React.useEffect(() => {
    setPrepressNotes(selectedItem?.prepressNotes || "");
    setFlagForQc(!!selectedItem?.issueFlag);
    setIssueType(selectedItem?.issueType || "");
  }, [selectedItem?.lineItemId, selectedItem?.prepressNotes, selectedItem?.issueFlag, selectedItem?.issueType]);

  React.useEffect(() => {
    if (!import.meta.env.DEV || !selectedItem) return;
    console.log("[Prepress Options]", {
      lineItemId: selectedItem.lineItemId,
      optionsRows: selectedItem.optionsRows?.length ?? 0,
    });
  }, [selectedItem?.lineItemId, selectedItem?.optionsRows]);

  React.useEffect(() => {
    if (!import.meta.env.DEV || !selectedItem) return;
    console.log("[Prepress Materials Needed]", {
      lineItemId: selectedItem.lineItemId,
      plannedMaterials: plannedMaterials.length,
      effectiveMaterials: effectiveMaterials.length,
      overrideCount: materialOverrides.length,
      overrideMode,
      overrideAllowed,
      message: plannedMaterialsMessage || null,
    });
  }, [
    selectedItem?.lineItemId,
    plannedMaterials.length,
    effectiveMaterials.length,
    materialOverrides.length,
    overrideMode,
    overrideAllowed,
    plannedMaterialsMessage,
  ]);

  // Handlers
  const handleRefresh = () => {
    void refetchQueue();
  };

  const handleOpenHistory = () => {
    if (!selectedItem) return;
    setHistoryOpen(true);
  };

  const handleOpenSpecSheet = () => {
    if (!selectedItem) return;
    setSpecSheetOpen(true);
  };

  const handlePrintTypeChange = (value: string) => {
    if (!selectedItem || !selectedLineItemId) return;
    updatePrintTypeMutation.mutate({ lineItemId: selectedLineItemId, printType: value });
  };

  const handleStartPrepress = () => {
    if (selectedItem) {
      startSessionMutation.mutate(selectedItem.lineItemId);
    }
  };

  const handleSaveNotes = () => {
    if (selectedItem?.sessionId) {
      saveNoteMutation.mutate({
        sessionId: selectedItem.sessionId,
        note: prepressNotes,
        flaggedForQc: flagForQc,
        issueType: flagForQc ? issueType : "",
      });
    }
  };

  const handleComplete = () => {
    if (selectedItem?.sessionId && canComplete) {
      completeSessionMutation.mutate(selectedItem.sessionId);
    }
  };

  // PROMPT B: Send to Print Queue handler
  const handleSendToPrint = () => {
    if (selectedLineItemId) {
      sendToPrintMutation.mutate(selectedLineItemId);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || !selectedLineItemId) return;

    Array.from(files).forEach(file => {
      uploadFileMutation.mutate({
        lineItemId: selectedLineItemId,
        file,
        role: uploadRole,
        tag: uploadRole === "final" ? selectedTag : "",
        sessionId: selectedItem?.sessionId ?? null,
      });
    });

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDownloadFile = (fileId: string) => {
    window.open(`/api/prepress/files/${fileId}/download`, "_blank");
  };

  const openSharedViewer = React.useCallback((lineItemId: string, preferredFileId?: string | null) => {
    if (!lineItemId) return;

    if (lineItemId === selectedLineItemId) {
      const nextIndex = resolveViewerIndex(preferredFileId);
      if (nextIndex < 0) return;
      setViewerIndex(nextIndex);
      setViewerOpen(true);
      setPendingViewerRequest(null);
      return;
    }

    setPendingViewerRequest({ lineItemId, preferredFileId: preferredFileId ?? null });
    setSelectedLineItemId(lineItemId);
  }, [resolveViewerIndex, selectedLineItemId]);

  const handleOpenViewer = (fileId: string) => {
    if (!selectedLineItemId) return;
    openSharedViewer(selectedLineItemId, fileId);
  };

  const handleOpenQueuePreview = (item: QueueItem) => {
    openSharedViewer(item.lineItemId, item.thumbFileId || null);
  };

  const handleDownloadAllOriginals = () => {
    if (selectedLineItemId) {
      window.open(`/api/prepress/line-item/${selectedLineItemId}/download-originals-zip`, "_blank");
    }
  };

  const openMaterialOverrideModal = (args: {
    mode: "replace" | "add" | "remove" | "adjust_qty";
    materialId?: string;
    uom?: "sqft" | "ft" | "each";
    qty?: number;
  }) => {
    setMaterialOverrideMode(args.mode);
    setOverrideReasonNote("");

    if (args.mode === "replace") {
      setOverrideFromMaterialId(args.materialId || "");
      setOverrideToMaterialId("");
      setOverrideMaterialId("");
      setOverrideQty("");
    }

    if (args.mode === "add") {
      setOverrideMaterialId("");
      setOverrideQty("");
      setOverrideUom(args.uom || "sqft");
    }

    if (args.mode === "remove") {
      setOverrideMaterialId(args.materialId || "");
      setOverrideQty("");
    }

    if (args.mode === "adjust_qty") {
      setOverrideMaterialId(args.materialId || "");
      setOverrideQty(args.qty != null ? String(args.qty) : "");
      setOverrideUom(args.uom || "sqft");
    }

    setMaterialOverrideOpen(true);
  };

  const handleSubmitMaterialOverride = () => {
    const reasonNote = overrideReasonNote.trim();
    if (!reasonNote) {
      toast({ title: "Reason is required", description: "Provide a reason note for this material override", variant: "destructive" });
      return;
    }

    if (materialOverrideMode === "replace") {
      if (!overrideFromMaterialId.trim() || !overrideToMaterialId.trim()) {
        toast({ title: "Material IDs required", description: "Both source and target material IDs are required", variant: "destructive" });
        return;
      }
      applyMaterialOverrideMutation.mutate({
        op: "replace",
        fromMaterialId: overrideFromMaterialId.trim(),
        toMaterialId: overrideToMaterialId.trim(),
        reasonNote,
        priceImpact: "potential",
      });
      return;
    }

    if (materialOverrideMode === "add") {
      const qty = Number(overrideQty);
      if (!overrideMaterialId.trim() || !Number.isFinite(qty) || qty <= 0) {
        toast({ title: "Invalid material input", description: "Material ID and positive quantity are required", variant: "destructive" });
        return;
      }
      applyMaterialOverrideMutation.mutate({
        op: "add",
        materialId: overrideMaterialId.trim(),
        qty,
        uom: overrideUom,
        reasonNote,
      });
      return;
    }

    if (materialOverrideMode === "remove") {
      if (!overrideMaterialId.trim()) {
        toast({ title: "Material ID required", description: "Select a material to remove", variant: "destructive" });
        return;
      }
      applyMaterialOverrideMutation.mutate({
        op: "remove",
        materialId: overrideMaterialId.trim(),
        reasonNote,
      });
      return;
    }

    const qty = Number(overrideQty);
    if (!overrideMaterialId.trim() || !Number.isFinite(qty) || qty <= 0) {
      toast({ title: "Invalid quantity", description: "Material ID and positive quantity are required", variant: "destructive" });
      return;
    }
    applyMaterialOverrideMutation.mutate({
      op: "adjust_qty",
      materialId: overrideMaterialId.trim(),
      qty,
      uom: overrideUom,
      reasonNote,
    });
  };

  return (
    <div className="flex h-full min-h-0 bg-[#111921] text-slate-100 font-sans overflow-hidden">
      {/* LEFT COLUMN: Prepress Queue */}
      <aside className="w-[400px] min-h-0 flex-shrink-0 border-r border-[#2d3748] flex flex-col h-full bg-[#1a232e]/50">
        {/* Header & Search */}
        <div className="p-4 border-b border-[#2d3748] space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold tracking-tight">Prepress Queue</h1>
            </div>
            <button onClick={handleRefresh} className="p-2 hover:bg-white/10 rounded-lg transition-colors" disabled={queueFetching}>
              <RefreshCw className={cn("w-4 h-4", queueFetching && "animate-spin")} />
            </button>
          </div>

          {/* Filters */}
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#111921] border-[#2d3748] rounded-lg pl-10 text-sm focus:ring-[#1773cf] focus:border-[#1773cf] h-9"
                placeholder="Search Job #, Customer, Product..."
              />
            </div>

            <div className="flex gap-2">
              <Select value={printTypeFilter} onValueChange={setPrintTypeFilter}>
                <SelectTrigger className="flex-1 bg-[#111921] border-[#2d3748] rounded-lg text-xs py-1 h-8 focus:ring-[#1773cf] focus:border-[#1773cf]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Print Type: All</SelectItem>
                  <SelectItem value="flatbed">Flatbed</SelectItem>
                  <SelectItem value="wide_roll">Wide Roll</SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="flex-1 bg-[#111921] border-[#2d3748] rounded-lg text-xs py-1 h-8 focus:ring-[#1773cf] focus:border-[#1773cf]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Status: All</SelectItem>
                  <SelectItem value="ready_for_prepress">Ready for Prepress</SelectItem>
                  <SelectItem value="in_prepress">In Prepress</SelectItem>
                </SelectContent>
              </Select>

              <button
                onClick={() => setRushFilter(!rushFilter)}
                className={cn(
                  "px-2 py-1 bg-[#111921] border rounded-lg text-[10px] font-bold transition-colors flex items-center gap-1 h-8",
                  rushFilter ? "border-[#e53e3e] text-[#e53e3e]" : "border-[#2d3748] text-slate-400 hover:border-[#e53e3e] hover:text-[#e53e3e]"
                )}
              >
                <span className={cn("w-2 h-2 rounded-full", rushFilter ? "bg-[#e53e3e]" : "bg-slate-600")}></span>
                RUSH
              </button>
            </div>
          </div>

          {/* Sort Controls */}
          <div className="flex items-center justify-between pt-2 border-t border-[#2d3748]/30">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-tighter">Sort By:</span>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="bg-transparent border-none text-[11px] font-medium text-slate-300 p-0 focus:ring-0 h-auto w-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="due_date">Due Date</SelectItem>
                  <SelectItem value="job_number">Job #</SelectItem>
                  <SelectItem value="client">Client</SelectItem>
                  <SelectItem value="type">Type</SelectItem>
                  <SelectItem value="material">Material</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <button
              onClick={() => setSortAsc(!sortAsc)}
              className="flex items-center justify-center p-1 text-slate-500 hover:text-[#1773cf] transition-colors hover:bg-white/5 rounded"
            >
              <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </button>
          </div>
        </div>

        {/* Job List */}
        <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-2">
          {queueLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          )}
          {!queueLoading && filteredQueue.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="w-12 h-12 text-slate-600 mb-3" />
              <p className="text-sm font-medium text-slate-400">No jobs in prepress queue</p>
              <p className="text-xs text-slate-600 mt-1">Adjust filters or clear search to see more jobs</p>
            </div>
          )}
          {!queueLoading && filteredQueue.map((item) => (
            <JobCard
              key={item.lineItemId}
              item={item}
              isSelected={selectedLineItemId === item.lineItemId}
              onClick={() => setSelectedLineItemId(item.lineItemId)}
              onPreviewClick={() => handleOpenQueuePreview(item)}
            />
          ))}
        </div>
      </aside>

      {/* RIGHT COLUMN: Main Workspace */}
      <main className="flex-1 min-h-0 flex flex-col h-full overflow-hidden bg-[#111921]">
        {/* Workspace Header */}
        <header className="p-6 border-b border-[#2d3748] bg-[#1a232e]/30 flex justify-between items-center">
          <div className="flex items-center gap-6">
            <div>
              <h2 className="text-2xl font-black text-white">
                {selectedItem ? selectedItem.jobNumber : "Select a line item"}
              </h2>
              {selectedItem && (
                <div className="flex items-center gap-2 mt-1">
                  <span className={cn(
                    "text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-widest",
                    selectedWorkflowDisplay.bgClass,
                    selectedWorkflowDisplay.textClass,
                    selectedWorkflowDisplay.borderClass,
                  )}>
                    {selectedWorkflowDisplay.label}
                  </span>
                  {selectedWorkflowDisplay.note && (
                    <span className="text-emerald-300 text-xs">{selectedWorkflowDisplay.note}</span>
                  )}
                  {selectedItem.assignedTo && (
                    <span className="text-slate-400 text-xs">Assigned to: {selectedItem.assignedTo}</span>
                  )}
                  {(selectedItem.activeOwnerStepKey || selectedItem.activeOwnerStationKey) && (
                    <span className="text-slate-400 text-xs">
                      Owner: {selectedItem.activeOwnerStepKey || selectedItem.activeOwnerStationKey}
                    </span>
                  )}
                  {selectedWorkflowState === "in_prepress" && selectedItem.sessionStartedAt && (
                    <span className="text-[#1773cf] text-xs font-semibold">
                      Timer: {formatElapsedDuration(activeSessionElapsedSeconds)}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="h-10 w-px bg-[#2d3748]"></div>
            <div className="flex gap-8">
              <div>
                <p className="text-[10px] uppercase text-slate-500 font-bold tracking-tighter">Customer</p>
                <p className="text-sm font-semibold">{selectedItem?.customerName || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-slate-500 font-bold tracking-tighter">Due Date</p>
                <p className={cn("text-sm font-semibold", selectedItem?.rush && "text-[#e53e3e]")}>
                  {selectedItem?.dueDate ? new Date(selectedItem.dueDate).toLocaleDateString() : "—"}
                </p>
              </div>
              {selectedWorkflowState === "in_prepress" && selectedItem?.sessionStartedAt ? (
                <div>
                  <p className="text-[10px] uppercase text-slate-500 font-bold tracking-tighter">Started</p>
                  <p className="text-sm font-semibold text-[#1773cf]">
                    {formatDistanceToNow(new Date(selectedItem.sessionStartedAt), { addSuffix: true })}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-50"
              onClick={handleOpenHistory}
              disabled={!selectedItem}
            >
              <History className="w-4 h-4" /> History
            </button>
            <button
              className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-50"
              onClick={handleOpenSpecSheet}
              disabled={!selectedItem}
            >
              <FileText className="w-4 h-4" /> Spec Sheet
            </button>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-8 pb-6">
          {/* Section 1: Job Specifications */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-2">
              <Info className="w-4 h-4" /> Job Specifications
            </h3>
            <div className="grid grid-cols-4 lg:grid-cols-6 gap-4 bg-[#1a232e] p-5 border border-[#2d3748] rounded-lg shadow-sm">
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold">Product</p>
                <p className="text-sm font-medium">{selectedItem?.productName || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold">Size</p>
                <p className="text-sm font-medium">
                  {selectedItem?.width && selectedItem?.height 
                    ? `${selectedItem.width}" x ${selectedItem.height}"` 
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold">Qty</p>
                <p className="text-sm font-medium">{selectedItem?.quantity ? `${selectedItem.quantity} units` : "—"}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold">Sq Footage</p>
                <p className="text-sm font-medium text-[#1773cf]">
                  {selectedItem?.sqFootage ? `${selectedItem.sqFootage.toFixed(1)} sq ft` : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold">Media</p>
                <p className="text-sm font-medium">{selectedItem?.media || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold">Print Type</p>
                <Select
                  value={selectedItem?.printType || "wide_roll"}
                  onValueChange={handlePrintTypeChange}
                  disabled={!selectedItem || updatePrintTypeMutation.isPending}
                >
                  <SelectTrigger className="h-8 bg-[#111921] border-[#2d3748] text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flatbed">flatbed</SelectItem>
                    <SelectItem value="wide_roll">wide_roll</SelectItem>
                    <SelectItem value="roll">roll</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold">Bleed</p>
                <p className="text-sm font-medium">{selectedItem?.bleed || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold">Options</p>
                {(selectedItem?.optionsRows?.length || 0) > 0 ? (
                  <div className="space-y-1.5">
                    {Object.entries(
                      (selectedItem?.optionsRows || []).reduce((acc, row) => {
                        const key = row.groupLabel && row.groupLabel.trim() ? row.groupLabel.trim() : "Options";
                        if (!acc[key]) acc[key] = [];
                        acc[key].push(row);
                        return acc;
                      }, {} as Record<string, NonNullable<QueueItem["optionsRows"]>>)
                    ).map(([groupLabel, rows]) => (
                      <div key={groupLabel}>
                        {groupLabel !== "Options" && (
                          <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">{groupLabel}</p>
                        )}
                        <ul className="text-sm font-medium list-disc pl-4 space-y-0.5">
                          {rows.map((row, index) => (
                            <li key={`${groupLabel}-${row.optionLabel}-${row.selectedLabel}-${index}`} className="flex items-center gap-2 flex-wrap">
                              <span>{row.optionLabel}: {row.selectedLabel}</span>
                              {typeof row.isDefault === "boolean" ? (
                                <span
                                  className={cn(
                                    "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border",
                                    row.isDefault
                                      ? "border-slate-500 text-slate-300 bg-slate-700/40"
                                      : "border-amber-500 text-amber-300 bg-amber-900/20"
                                  )}
                                >
                                  {row.isDefault ? "Default" : "Changed"}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm font-medium text-slate-400">No options selected</p>
                )}
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold">Priority</p>
                <p className={cn("text-sm font-bold", selectedItem?.rush ? "text-[#e53e3e]" : "text-slate-400")}>
                  {selectedItem?.rush ? "RUSH" : "Normal"}
                </p>
              </div>
            </div>

            <div className="mt-4 bg-[#1a232e] p-5 border border-[#2d3748] rounded-lg shadow-sm">
              <div className="flex items-center justify-between mb-2 gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Materials Needed</p>
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-slate-600 text-slate-300 bg-slate-700/40">
                    Effective (including overrides)
                  </span>
                  {materialsAvailabilityLoading ? (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-slate-600 text-slate-300 bg-slate-700/40">
                      Checking Stock...
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border",
                        materialsAllAvailable
                          ? "border-emerald-500 text-emerald-300 bg-emerald-900/20"
                          : "border-amber-500 text-amber-300 bg-amber-900/20"
                      )}
                    >
                      {materialsAllAvailable ? "Stock Available" : "Stock Shortage"}
                    </span>
                  )}
                  {pricingReviewRequired ? (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-amber-500 text-amber-300 bg-amber-900/20">
                      Pricing Review Required
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {materialsEffectiveLoading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!overrideAllowed || !selectedItem}
                    onClick={() => openMaterialOverrideModal({ mode: "add" })}
                  >
                    Add Material
                  </Button>
                </div>
              </div>

              {effectiveMaterials.length > 0 ? (
                <ul className="space-y-2 text-sm">
                  {effectiveMaterials.map((material, index) => (
                    <li key={`${material.materialId}-${material.uom}-${index}`} className="flex items-center justify-between gap-3 border border-slate-700 rounded p-2">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-slate-200 flex items-center gap-2">
                          {material.materialName || `Material ${material.materialId}`}
                          {material.isOverridden ? (
                            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-cyan-500 text-cyan-300 bg-cyan-900/20">
                              Overridden
                            </span>
                          ) : null}
                        </span>
                        <span className="text-xs text-slate-500">ID: {material.materialId}</span>
                        {(() => {
                          const availability = materialsAvailability.find(
                            (a) => a.materialId === material.materialId && a.uom === material.uom
                          );
                          if (!availability) return null;
                          return (
                            <span
                              className={cn(
                                "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border w-fit",
                                availability.isAvailable
                                  ? "border-emerald-600 text-emerald-300 bg-emerald-950/40"
                                  : "border-amber-600 text-amber-300 bg-amber-950/40"
                              )}
                            >
                              {availability.isAvailable
                                ? `In Stock (${availability.availableQty} ${availability.uom})`
                                : `Short ${availability.shortageQty} ${availability.uom}`}
                            </span>
                          );
                        })()}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-300 font-mono min-w-[90px] text-right">
                          {material.qty} {material.uom}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!overrideAllowed}
                          onClick={() => openMaterialOverrideModal({ mode: "replace", materialId: material.materialId, uom: material.uom })}
                        >
                          Swap
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!overrideAllowed}
                          onClick={() => openMaterialOverrideModal({ mode: "adjust_qty", materialId: material.materialId, uom: material.uom, qty: material.qty })}
                        >
                          Adjust Qty
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!overrideAllowed}
                          onClick={() => openMaterialOverrideModal({ mode: "remove", materialId: material.materialId })}
                        >
                          Remove
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="space-y-1">
                  <p className="text-sm text-slate-400">No materials computed</p>
                  <p className="text-xs text-slate-500">Add inventory materials to PBV2 choices or set size/options</p>
                </div>
              )}

              {plannedMaterials.length > 0 ? (
                <details className="mt-3">
                  <summary className="text-xs text-slate-400 cursor-pointer">View planned baseline materials ({plannedMaterials.length})</summary>
                  <ul className="mt-2 space-y-1.5 text-xs">
                    {plannedMaterials.map((material, index) => (
                      <li key={`planned-${material.materialId}-${material.basis}-${index}`} className="flex items-center justify-between gap-2 text-slate-300">
                        <span>{material.materialName || `Material ${material.materialId}`}</span>
                        <span className="font-mono">{material.qty} {material.uom}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {!overrideAllowed ? (
                <p className="text-xs text-amber-300 mt-2">
                  Overrides are disabled by policy ({overrideMode}). {overrideBlockedReason || "Status is beyond allowed stage."}
                </p>
              ) : null}

              {plannedMaterialsMessage ? (
                <p className="text-xs text-amber-300 mt-2">{plannedMaterialsMessage}</p>
              ) : null}

              {effectiveFingerprint ? (
                <p className="text-[10px] text-slate-500 mt-2">Fingerprint: {effectiveFingerprint.slice(0, 12)}…</p>
              ) : null}
            </div>
          </section>

          {/* Section 2: Original Customer Files */}
          <section>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                <Paperclip className="w-4 h-4" /> Original Customer Files
              </h3>
              <div className="flex items-center gap-3">
                {selectedLineItemId && (
                  <button
                    onClick={() => {
                      setUploadRole("original");
                      fileInputRef.current?.click();
                    }}
                    className="text-xs font-bold text-[#1773cf] hover:underline flex items-center gap-1"
                  >
                    <Upload className="w-4 h-4" /> Upload Originals
                  </button>
                )}
                {selectedLineItemId && visibleOriginalFiles.length > 0 && (
                  <button
                    onClick={handleDownloadAllOriginals}
                    className="text-xs font-bold text-[#1773cf] hover:underline flex items-center gap-1"
                  >
                    <Download className="w-4 h-4" /> Download All
                  </button>
                )}
              </div>
            </div>
            <div className="border border-[#2d3748] rounded-lg overflow-hidden bg-[#1a232e]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#111921] border-b border-[#2d3748] text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-semibold w-24">Preview</th>
                    <th className="px-4 py-3 font-semibold">Filename</th>
                    <th className="px-4 py-3 font-semibold">Size</th>
                    <th className="px-4 py-3 font-semibold">Upload Date</th>
                    <th className="px-4 py-3 font-semibold">Uploaded By</th>
                    <th className="px-4 py-3 font-semibold">Tag</th>
                    <th className="px-4 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2d3748]">
                  {visibleOriginalFiles.length === 0 && visibleBridgedOriginalFiles.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                        {selectedLineItemId ? "No original files uploaded" : "Select a line item to view files"}
                      </td>
                    </tr>
                  ) : (
                    <>
                      {visibleOriginalFiles.map((file) => (
                        <tr key={file.id} className="hover:bg-white/5 transition-colors group cursor-pointer" onClick={() => handleOpenViewer(file.id)}>
                          <td className="px-4 py-3">
                            <FileThumbnail
                              fileId={file.id}
                              filename={file.originalFilename || file.fileName}
                              mimeType={file.mimeType || undefined}
                              thumbnailUrl={file.thumbUrl || undefined}
                            />
                          </td>
                          <td className="px-4 py-3 font-medium text-slate-200">{file.displayName}</td>
                          <td className="px-4 py-3 font-mono">{file.sizeBytesValue != null ? formatBytes(file.sizeBytesValue) : "—"}</td>
                          <td className="px-4 py-3">{file.createdAt ? formatDistanceToNow(new Date(file.createdAt), { addSuffix: true }) : "—"}</td>
                          <td className="px-4 py-3">{file.uploadedByLabel}</td>
                          <td className="px-4 py-3">
                            <span className="bg-slate-700 px-2 py-0.5 rounded">{file.tagLabel}</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button 
                              onClick={(event) => {
                                event.stopPropagation();
                                window.open(file.downloadUrl, "_blank");
                              }}
                              className="bg-[#111921] border border-[#2d3748] px-3 py-1 rounded hover:bg-[#1773cf]/20 hover:border-[#1773cf] transition-all"
                            >
                              Download
                            </button>
                          </td>
                        </tr>
                      ))}
                      {/* Bridged files: customer artwork uploaded on the Order page before prepress */}
                      {visibleBridgedOriginalFiles.length > 0 && (
                        <>
                          <tr className="bg-amber-950/20">
                            <td colSpan={7} className="px-4 py-1.5">
                              <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400/80">
                                Pre-submitted by customer (from order)
                              </span>
                            </td>
                          </tr>
                          {visibleBridgedOriginalFiles.map((file) => (
                            <tr key={`bridged-${file.id}`} className="hover:bg-white/5 transition-colors cursor-pointer bg-amber-950/10" onClick={() => handleOpenViewer(file.id)}>
                              <td className="px-4 py-3">
                                <FileThumbnail
                                  filename={file.originalFilename || file.fileName}
                                  mimeType={file.mimeType || undefined}
                                  thumbnailUrl={file.thumbUrl || undefined}
                                />
                              </td>
                              <td className="px-4 py-3 font-medium text-slate-200">{file.displayName}</td>
                              <td className="px-4 py-3 font-mono">{file.sizeBytesValue != null ? formatBytes(file.sizeBytesValue) : "—"}</td>
                              <td className="px-4 py-3">{file.createdAt ? formatDistanceToNow(new Date(file.createdAt), { addSuffix: true }) : "—"}</td>
                              <td className="px-4 py-3">{file.uploadedByLabel}</td>
                              <td className="px-4 py-3">
                                <span className="bg-amber-900/50 text-amber-300 border border-amber-700/40 px-2 py-0.5 rounded text-[9px] font-bold uppercase">{file.tagLabel}</span>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    window.open(file.downloadUrl, "_blank");
                                  }}
                                  className="bg-[#111921] border border-[#2d3748] px-3 py-1 rounded hover:bg-amber-900/30 hover:border-amber-600 transition-all"
                                >
                                  Download
                                </button>
                              </td>
                            </tr>
                          ))}
                        </>
                      )}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 3: Final Production Files */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" /> Final Production Files
            </h3>

            {/* Existing Final Files */}
            <div className="border border-[#2d3748] rounded-lg overflow-hidden bg-[#1a232e] mb-4">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#111921] border-b border-[#2d3748] text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-semibold w-24">Preview</th>
                    <th className="px-4 py-3 font-semibold">File Info</th>
                    <th className="px-4 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2d3748]">
                  {visibleFinalFiles.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-slate-500">
                        {selectedLineItemId ? "No final files uploaded yet" : "Select a line item to upload files"}
                      </td>
                    </tr>
                  ) : (
                    visibleFinalFiles.map((file) => (
                      <tr key={file.id} className="hover:bg-white/5 transition-colors cursor-pointer" onClick={() => handleOpenViewer(file.id)}>
                        <td className="px-4 py-3">
                          <FileThumbnail
                            fileId={file.id}
                            filename={file.originalFilename || file.fileName}
                            mimeType={file.mimeType || undefined}
                            thumbnailUrl={file.thumbUrl || undefined}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            <p className="font-bold text-slate-200">{file.displayName}</p>
                            <div className="flex items-center gap-3">
                              <span className="bg-[#1773cf]/30 text-[#1773cf] border border-[#1773cf]/40 px-2 py-0.5 rounded font-bold uppercase text-[9px]">
                                {file.tagLabel}
                              </span>
                              <span className="text-slate-500 font-mono">{file.sizeBytesValue != null ? formatBytes(file.sizeBytesValue) : "—"}</span>
                              <span className="text-slate-400 italic">
                                Uploaded by {file.uploadedByLabel} ({file.createdAt ? formatDistanceToNow(new Date(file.createdAt), { addSuffix: true }) : "unknown"})
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right space-x-2">
                          <button 
                            onClick={(event) => {
                              event.stopPropagation();
                              window.open(file.downloadUrl, "_blank");
                            }}
                            className="text-slate-400 hover:text-white p-1"
                          >
                            <Download className="w-5 h-5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Drag & Drop Upload Zone */}
            <div className="border-2 border-dashed border-[#2d3748] rounded-xl p-8 bg-[#1a232e]/20 flex flex-col items-center justify-center text-center hover:border-[#1773cf]/50 hover:bg-[#1773cf]/5 transition-all group">
              <div className="w-12 h-12 bg-[#1a232e] border border-[#2d3748] rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Upload className="w-6 h-6 text-[#1773cf]" />
              </div>
              <p className="text-sm font-semibold mb-1">Drag and drop final production files here</p>
              <p className="text-xs text-slate-500 mb-4">PDF, TIF, JPG, or EPS up to 2GB</p>
              
              <div className="mb-4">
                <p className="text-[10px] uppercase font-bold text-slate-500 mb-2 tracking-wider">File Type</p>
                <RadioGroup value={selectedTag} onValueChange={setSelectedTag} className="flex items-center gap-6">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="final_print" id="tag-print" className="border-[#2d3748] text-[#1773cf]" />
                    <Label htmlFor="tag-print" className="text-sm font-medium text-slate-300 cursor-pointer">Print</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="proof_only" id="tag-proof" className="border-[#2d3748] text-[#1773cf]" />
                    <Label htmlFor="tag-proof" className="text-sm font-medium text-slate-300 cursor-pointer">Proof</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="cut_file" id="tag-cut" className="border-[#2d3748] text-[#1773cf]" />
                    <Label htmlFor="tag-cut" className="text-sm font-medium text-slate-300 cursor-pointer">Cut File</Label>
                  </div>
                </RadioGroup>
              </div>
              
              <div className="flex items-center gap-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                  disabled={!selectedLineItemId}
                />
                <Button 
                  onClick={() => {
                    setUploadRole("final");
                    fileInputRef.current?.click();
                  }}
                  disabled={!selectedLineItemId}
                  className="bg-[#1773cf] text-white text-sm font-bold px-6 py-2 rounded-lg hover:bg-[#1773cf]/90 transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Choose File
                </Button>
              </div>

              {/* Recently Uploaded / In Progress */}
              {uploadingFiles.length > 0 && (
                <div className="w-full mt-8 border-t border-[#2d3748]/50 pt-6">
                  <p className="text-[10px] uppercase font-bold text-slate-500 mb-4 text-left">
                    Recently Uploaded / In Progress
                  </p>
                  <div className="flex gap-4">
                    {uploadingFiles.map((upload) => (
                      <div key={upload.id} className="w-24 flex flex-col gap-2">
                        <div className="w-24 h-24 rounded-lg border border-[#1773cf]/50 bg-[#1773cf]/5 flex items-center justify-center relative overflow-hidden">
                          <Upload className="w-6 h-6 text-[#1773cf] animate-pulse" />
                        </div>
                        <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                          <div 
                            className="bg-[#1773cf] h-full transition-all"
                            style={{ width: `${upload.progress}%` }}
                          ></div>
                        </div>
                        <p className="text-[10px] text-slate-400 truncate">{upload.filename}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Section 4: Prepress Notes + QC Flagging */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> Prepress Notes + QC Flagging
            </h3>
            <div className="grid grid-cols-2 gap-6">
              {/* Left: Notes */}
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-2">Production Notes</label>
                  <Textarea
                    value={prepressNotes}
                    onChange={(e) => setPrepressNotes(e.target.value)}
                    className="w-full bg-[#111921] border-[#2d3748] rounded-lg text-sm focus:ring-[#1773cf] focus:border-[#1773cf] min-h-[120px] resize-none"
                    placeholder="Add prepress notes, color corrections, adjustments..."
                  />
                </div>
                <Button 
                  onClick={handleSaveNotes}
                  disabled={!selectedItem?.sessionId || saveNoteMutation.isPending}
                  className="bg-[#1a232e] border border-[#2d3748] text-slate-300 hover:bg-[#2d3748] w-full disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saveNoteMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
                  ) : (
                    "Save Notes"
                  )}
                </Button>
              </div>

              {/* Right: QC Flagging */}
              <div className="space-y-4">
                <div className="flex items-start gap-3 p-4 bg-[#1a232e] border border-[#2d3748] rounded-lg">
                  <Checkbox
                    id="qc-flag"
                    checked={flagForQc}
                    onCheckedChange={(checked) => setFlagForQc(checked as boolean)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <label htmlFor="qc-flag" className="text-sm font-semibold text-white cursor-pointer block">
                      Flag for Quality Control Review
                    </label>
                    <p className="text-xs text-slate-500 mt-1">
                      Mark this job for additional QC inspection before final approval
                    </p>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-2">Issue Type (Optional)</label>
                  <Select value={issueType} onValueChange={setIssueType} disabled={!flagForQc}>
                    <SelectTrigger className="bg-[#111921] border-[#2d3748] rounded-lg text-sm focus:ring-[#1773cf] focus:border-[#1773cf]">
                      <SelectValue placeholder="Select issue type..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="color">Color Mismatch</SelectItem>
                      <SelectItem value="resolution">Resolution Issue</SelectItem>
                      <SelectItem value="artwork">Artwork Problem</SelectItem>
                      <SelectItem value="specs">Spec Clarification Needed</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-slate-600 mt-2">
                    Flagged jobs will appear in the QC queue for manager review
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Sticky Footer */}
        <div className="sticky bottom-0 z-20 shrink-0 border-t border-[#2d3748] bg-[#1a232e] p-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {hasFinalFiles ? (
              <div className="flex items-center gap-2 text-green-500">
                <CheckCircle className="w-4 h-4" />
                <span className="text-xs font-medium">Final file detected</span>
              </div>
            ) : canCompleteWithExistingArtwork ? (
              <div className="flex items-center gap-2 text-green-500">
                <CheckCircle className="w-4 h-4" />
                <span className="text-xs font-medium">Existing artwork ready for completion</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-amber-500">
                <AlertCircle className="w-4 h-4" />
                <span className="text-xs font-medium">No final files uploaded</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleStartPrepress}
              disabled={!canStartPrepress || startSessionMutation.isPending}
              variant="outline"
              className="bg-transparent border-[#2d3748] text-slate-300 hover:bg-[#2d3748] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {startSessionMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Starting...</>
              ) : (
                "Start Prepress"
              )}
            </Button>
            <Button
              onClick={handleComplete}
              disabled={!canComplete || completeSessionMutation.isPending}
              className={cn(
                "font-bold shadow-lg transition-all",
                canComplete
                  ? "bg-[#1773cf] text-white hover:bg-[#1773cf]/90"
                  : "bg-slate-700 text-slate-500 cursor-not-allowed"
              )}
            >
              {completeSessionMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Completing...</>
              ) : (
                <>
                  Mark Prepress Complete
                  <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </>
              )}
            </Button>

            {/* PROMPT B: Send to Print Queue button */}
            <Button
              onClick={handleSendToPrint}
              disabled={!canSendToPrint || sendToPrintMutation.isPending}
              className={cn(
                "font-bold shadow-lg transition-all",
                canSendToPrint
                  ? "bg-green-600 text-white hover:bg-green-700"
                  : "bg-slate-700 text-slate-500 cursor-not-allowed"
              )}
            >
              {sendToPrintMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending...</>
              ) : (
                <>
                  Send to Production
                  <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </>
              )}
            </Button>
          </div>
        </div>
      </main>

      <Dialog open={materialOverrideOpen} onOpenChange={setMaterialOverrideOpen}>
        <DialogContent className="max-w-xl bg-[#111921] border-[#2d3748] text-slate-100">
          <DialogHeader>
            <DialogTitle>
              {materialOverrideMode === "replace" && "Swap Material"}
              {materialOverrideMode === "add" && "Add Material"}
              {materialOverrideMode === "remove" && "Remove Material"}
              {materialOverrideMode === "adjust_qty" && "Adjust Material Quantity"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {materialOverrideMode === "replace" ? (
              <>
                <div>
                  <Label className="text-xs text-slate-400 mb-1 block">From Material ID</Label>
                  <Input value={overrideFromMaterialId} onChange={(e) => setOverrideFromMaterialId(e.target.value)} className="bg-[#0f172a] border-[#2d3748]" />
                </div>
                <div>
                  <Label className="text-xs text-slate-400 mb-1 block">To Material ID</Label>
                  <Input value={overrideToMaterialId} onChange={(e) => setOverrideToMaterialId(e.target.value)} className="bg-[#0f172a] border-[#2d3748]" />
                </div>
                <p className="text-xs text-amber-300">Replace operations auto-set potential price impact and trigger Pricing Review Required.</p>
              </>
            ) : null}

            {materialOverrideMode === "add" ? (
              <>
                <div>
                  <Label className="text-xs text-slate-400 mb-1 block">Material ID</Label>
                  <Input value={overrideMaterialId} onChange={(e) => setOverrideMaterialId(e.target.value)} className="bg-[#0f172a] border-[#2d3748]" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-slate-400 mb-1 block">Qty</Label>
                    <Input type="number" step="0.01" min="0" value={overrideQty} onChange={(e) => setOverrideQty(e.target.value)} className="bg-[#0f172a] border-[#2d3748]" />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-400 mb-1 block">UOM</Label>
                    <Select value={overrideUom} onValueChange={(value) => setOverrideUom(value as "sqft" | "ft" | "each")}>
                      <SelectTrigger className="bg-[#0f172a] border-[#2d3748]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sqft">sqft</SelectItem>
                        <SelectItem value="ft">ft</SelectItem>
                        <SelectItem value="each">each</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            ) : null}

            {materialOverrideMode === "remove" ? (
              <div>
                <Label className="text-xs text-slate-400 mb-1 block">Material ID</Label>
                <Input value={overrideMaterialId} onChange={(e) => setOverrideMaterialId(e.target.value)} className="bg-[#0f172a] border-[#2d3748]" />
              </div>
            ) : null}

            {materialOverrideMode === "adjust_qty" ? (
              <>
                <div>
                  <Label className="text-xs text-slate-400 mb-1 block">Material ID</Label>
                  <Input value={overrideMaterialId} onChange={(e) => setOverrideMaterialId(e.target.value)} className="bg-[#0f172a] border-[#2d3748]" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-slate-400 mb-1 block">Qty</Label>
                    <Input type="number" step="0.01" min="0" value={overrideQty} onChange={(e) => setOverrideQty(e.target.value)} className="bg-[#0f172a] border-[#2d3748]" />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-400 mb-1 block">UOM</Label>
                    <Select value={overrideUom} onValueChange={(value) => setOverrideUom(value as "sqft" | "ft" | "each")}>
                      <SelectTrigger className="bg-[#0f172a] border-[#2d3748]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sqft">sqft</SelectItem>
                        <SelectItem value="ft">ft</SelectItem>
                        <SelectItem value="each">each</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            ) : null}

            <div>
              <Label className="text-xs text-slate-400 mb-1 block">Reason Note *</Label>
              <Textarea
                value={overrideReasonNote}
                onChange={(e) => setOverrideReasonNote(e.target.value)}
                placeholder="Explain why this material override is needed"
                className="bg-[#0f172a] border-[#2d3748] min-h-[90px]"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setMaterialOverrideOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSubmitMaterialOverride} disabled={applyMaterialOverrideMutation.isPending || !overrideAllowed}>
                {applyMaterialOverrideMutation.isPending ? "Saving..." : "Apply Override"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="right" className="w-[520px] bg-[#111921] border-[#2d3748] text-slate-100">
          <SheetHeader>
            <SheetTitle className="text-slate-100">History</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-3 max-h-[85vh] overflow-y-auto pr-2">
            {historyLoading && (
              <div className="text-sm text-slate-400">Loading history...</div>
            )}
            {!historyLoading && (historyData?.length || 0) === 0 && (
              <div className="text-sm text-slate-500">No history found for this line item.</div>
            )}
            {!historyLoading && (historyData || []).map((entry, idx) => (
              <div key={`${entry.at}-${entry.type}-${idx}`} className="border border-[#2d3748] rounded-lg p-3 bg-[#1a232e]">
                <div className="text-[11px] text-slate-500 uppercase tracking-wide">{entry.source.replaceAll("_", " ")}</div>
                <div className="text-xs text-slate-300 mt-1">{entry.type}</div>
                <div className="text-sm text-slate-100 mt-1">{entry.description}</div>
                <div className="text-[11px] text-slate-500 mt-2">{new Date(entry.at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={specSheetOpen} onOpenChange={setSpecSheetOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-[#111921] border-[#2d3748] text-slate-100">
          <DialogHeader>
            <DialogTitle>Spec Sheet</DialogTitle>
          </DialogHeader>
          {specSheetLoading ? (
            <div className="text-sm text-slate-400">Loading spec sheet...</div>
          ) : !specSheetData ? (
            <div className="text-sm text-slate-500">No spec data available.</div>
          ) : (
            <div className="space-y-6 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div><span className="text-slate-500">Job #:</span> {specSheetData.jobNumber || "—"}</div>
                <div><span className="text-slate-500">Customer:</span> {specSheetData.customerName || "—"}</div>
                <div><span className="text-slate-500">Product:</span> {specSheetData.productName || "—"}</div>
                <div><span className="text-slate-500">Size:</span> {specSheetData.width && specSheetData.height ? `${specSheetData.width}" x ${specSheetData.height}"` : "—"}</div>
                <div><span className="text-slate-500">Qty:</span> {specSheetData.quantity || "—"}</div>
                <div><span className="text-slate-500">Sq Ft:</span> {specSheetData.sqFootage != null ? `${specSheetData.sqFootage.toFixed(1)} sq ft` : "—"}</div>
                <div><span className="text-slate-500">Media:</span> {specSheetData.media || "—"}</div>
                <div><span className="text-slate-500">Print Type:</span> {specSheetData.printType || "—"}</div>
              </div>

              <div>
                <div className="text-slate-500 uppercase text-xs mb-2">Finishing</div>
                {(specSheetData.finishingBullets || []).length > 0 ? (
                  <ul className="list-disc pl-5 space-y-1">
                    {specSheetData.finishingBullets.map((bullet, i) => <li key={`${bullet}-${i}`}>{bullet}</li>)}
                  </ul>
                ) : (
                  <div>—</div>
                )}
              </div>

              <div>
                <div className="text-slate-500 uppercase text-xs mb-2">Files</div>
                <div className="space-y-1">
                  {[...specSheetData.originals, ...specSheetData.finals].map((f) => (
                    <div key={f.id} className="text-slate-200">• {f.computedDisplayFilename || f.originalFilename}</div>
                  ))}
                  {[...specSheetData.originals, ...specSheetData.finals].length === 0 && <div>—</div>}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AttachmentViewerDialog
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        attachments={normalizedVisibleFiles}
        initialIndex={viewerIndex}
        showMetaPanel
        hideFilmstrip={false}
      />
    </div>
  );
}

function JobCard({ item, isSelected, onClick, onPreviewClick }: { item: QueueItem; isSelected: boolean; onClick: () => void; onPreviewClick: () => void }) {
  const config = getPrepressWorkflowDisplay(item);

  React.useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.log("[Prepress Queue Thumbnail Selection]", {
      lineItemId: item.lineItemId,
      thumbFileId: item.thumbFileId ?? null,
      reason: item.thumbSelectionReason ?? "none",
      mimeType: item.thumbCandidateMimeType ?? null,
    });
  }, [item.lineItemId, item.thumbFileId, item.thumbSelectionReason, item.thumbCandidateMimeType]);

  return (
    <div
      onClick={onClick}
      className={cn(
        "p-2 rounded-lg flex gap-3 transition-colors relative cursor-pointer",
        isSelected && "bg-[#1773cf]/10 border-l-4 border-[#1773cf] rounded-l-none rounded-r-lg",
        !isSelected && "bg-[#1a232e] border border-[#2d3748] hover:border-[#1773cf]/50"
      )}
    >
      <div
        className="relative w-16 h-16 flex-shrink-0 rounded-lg border border-[#2d3748] overflow-hidden bg-[#111921] flex items-center justify-center group cursor-zoom-in"
        onClick={(event) => {
          event.stopPropagation();
          onPreviewClick();
        }}
        role="button"
        aria-label={`Open preview for ${item.jobNumber}`}
      >
        <FileThumbnail
          fileId={item.thumbFileId || undefined}
          filename={item.productName || "preview"}
          mimeType={item.thumbCandidateMimeType || undefined}
          thumbnailUrl={item.thumbnailUrl || undefined}
          compact
        />
        {item.fileCounts && (item.fileCounts.originals > 0 || item.fileCounts.finals > 0) && (
          <div className="absolute bottom-0 right-0 bg-[#1773cf] text-white text-[9px] font-black px-1 rounded-tl-sm shadow-lg z-20">
            +{item.fileCounts.originals + item.fileCounts.finals}
          </div>
        )}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
          <ZoomIn className="w-5 h-5 text-white" />
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="flex justify-between items-start">
          <span className="text-sm font-bold text-white">
            {item.jobNumber}
          </span>
          <div className="flex flex-col items-end gap-1">
            <span className={cn("text-[8px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider", config.bgClass, config.textClass, config.borderClass)}>
              {config.label}
            </span>
            {config.note && <span className="text-[8px] font-semibold text-emerald-300">{config.note}</span>}
          </div>
        </div>
        <p className="text-xs font-semibold truncate text-slate-200">{item.customerName}</p>
        <p className="text-[10px] truncate text-slate-400">{item.productName}</p>
        <div className="flex items-center justify-between mt-1 text-[9px]">
          {item.assignedTo ? (
            <span className="text-slate-500">Assigned: {item.assignedTo}</span>
          ) : (
            <span className="text-slate-500">Unassigned</span>
          )}
          {item.rush && <span className="text-[#e53e3e] font-bold">RUSH</span>}
          {item.dueDate && !item.rush && <span className="text-slate-400">{new Date(item.dueDate).toLocaleDateString()}</span>}
        </div>
      </div>
    </div>
  );
}

function FileThumbnail({
  fileId,
  filename,
  mimeType,
  thumbnailUrl,
  compact = false,
}: {
  fileId?: string;
  filename: string;
  mimeType?: string;
  thumbnailUrl?: string;
  compact?: boolean;
}) {
  const isImage = !!mimeType?.startsWith("image/");
  const isPdf = !!mimeType?.includes("pdf") || filename.toLowerCase().endsWith(".pdf");
  const [thumbFailed, setThumbFailed] = useState(false);

  const { data: resolvedThumbnailUrl } = useQuery({
    queryKey: ["/api/prepress/files", fileId, "thumbnail"],
    queryFn: async () => {
      if (!fileId) return null as string | null;
      const res = await fetch(`/api/prepress/files/${fileId}/thumbnail`, { credentials: "include" });
      if (!res.ok) return null as string | null;
      const json = await res.json().catch(() => ({}));
      return (json?.data?.thumbnailUrl as string | null) || null;
    },
    enabled: !!fileId && isImage,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });

  const normalizeThumbnailUrl = (value?: string | null): string | undefined => {
    if (!value) return undefined;
    return resolveObjectsPublicUrl(value) ?? undefined;
  };

  const finalThumbnailUrl =
    normalizeThumbnailUrl(thumbnailUrl) ||
    normalizeThumbnailUrl(resolvedThumbnailUrl) ||
    undefined;
  const displayThumbnailUrl = thumbFailed ? undefined : finalThumbnailUrl;
  const baseClass = compact ? "w-16 h-16" : "w-20 h-20";

  React.useEffect(() => {
    setThumbFailed(false);
  }, [finalThumbnailUrl]);

  return (
    <div className={cn("relative rounded-lg border border-[#2d3748] overflow-hidden bg-[#111921] flex items-center justify-center group", baseClass)}>
      {displayThumbnailUrl ? (
        <img
          src={displayThumbnailUrl}
          alt={filename}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
          onError={(e) => {
            setThumbFailed(true);
            if (import.meta.env.DEV) {
              console.info(`[thumb] failed url=${e.currentTarget.src}`);
            }
          }}
        />
      ) : isPdf ? (
        <div className="absolute inset-0 bg-slate-700/60 flex items-center justify-center">
          <svg className={cn(compact ? "w-6 h-6" : "w-8 h-8", "text-white")} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          <span className="absolute bottom-1 text-[9px] font-bold text-white/90">PDF</span>
        </div>
      ) : (
        <svg className={cn(compact ? "w-6 h-6" : "w-8 h-8", "text-slate-500")} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      )}
      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
        <ZoomIn className="w-5 h-5 text-white" />
      </div>
      {import.meta.env.DEV && thumbFailed ? (
        <div className="absolute bottom-1 left-1 rounded bg-black/70 px-1 py-0.5 text-[9px] text-amber-300">thumb failed</div>
      ) : null}
    </div>
  );
}
