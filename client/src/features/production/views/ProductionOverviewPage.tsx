import { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { 
  LayoutGrid, 
  List, 
  FileText, 
  ArrowUp, 
  ArrowDown, 
  Settings2, 
  GripVertical, 
  ChevronsUpDown,
  Download,
  Upload,
} from "lucide-react";
import { 
  useProductionJobs, 
  useUpdateProductionJobStatus,
  type ProductionJobListItem,
  type ProductionOrderArtworkSummary 
} from "@/hooks/useProduction";
import { format, isPast, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/config/routes";
import ZoomPanImageViewer from "@/components/production/ZoomPanImageViewer";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";

type ViewMode = "board" | "list";

// Column configuration with visibility, order, and width management
type ColumnId = "artwork" | "dueDate" | "customer" | "orderNumber" | "jobDescription" | "media" | "qty" | "sides" | "status" | "station";

type ColumnConfig = {
  id: ColumnId;
  label: string;
  visible: boolean;
  width: number; // in pixels
  sortable: boolean;
  sortField?: string; // For backend or client-side sorting
};

type SortState = {
  field: string;
  direction: "asc" | "desc";
};

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: "artwork", label: "Art", visible: true, width: 100, sortable: false },
  { id: "dueDate", label: "Due Date", visible: true, width: 130, sortable: true, sortField: "dueDate" },
  { id: "customer", label: "Customer", visible: true, width: 180, sortable: true, sortField: "customer" },
  { id: "orderNumber", label: "Order #", visible: true, width: 120, sortable: true, sortField: "orderNumber" },
  { id: "jobDescription", label: "Job Description", visible: true, width: 200, sortable: true, sortField: "jobDescription" },
  { id: "media", label: "Media", visible: true, width: 150, sortable: true, sortField: "media" },
  { id: "qty", label: "Qty", visible: true, width: 80, sortable: true, sortField: "qty" },
  { id: "sides", label: "Sides", visible: true, width: 120, sortable: true, sortField: "sides" },
  { id: "status", label: "Status", visible: true, width: 110, sortable: true, sortField: "status" },
  { id: "station", label: "Station", visible: true, width: 110, sortable: true, sortField: "station" },
];

// Kanban column configuration (hardcoded for MVP, future org-config)
const KANBAN_COLUMNS = [
  { id: "queued", label: "Queued", status: "queued" },
  { id: "in_progress", label: "Printing", status: "in_progress" },
  { id: "done", label: "Done", status: "done" },
] as const;

// Board card display configuration
type BoardCardField = "customer" | "orderNumber" | "jobDescription" | "media" | "qty" | "sides" | "dueDate" | "station" | "status";

type BoardCardConfig = {
  [K in BoardCardField]: boolean;
};

const DEFAULT_BOARD_CARD_CONFIG: BoardCardConfig = {
  customer: true,
  orderNumber: true,
  jobDescription: true,
  media: true,
  qty: true,
  sides: true,
  dueDate: true,
  station: false,
  status: false,
};

/**
 * Get the best available image source for artwork
 * Priority: thumbnailUrl > fileUrl (if image) > null
 */
function getBestArtworkImage(artwork: ProductionOrderArtworkSummary | null): string | null {
  if (!artwork) return null;
  
  // 1. Prefer thumbnailUrl (always an image if present)
  if (artwork.thumbnailUrl && artwork.thumbnailUrl.trim()) {
    return artwork.thumbnailUrl;
  }
  
  // 2. Fallback to fileUrl, but ONLY if it's an image file
  if (artwork.fileUrl && artwork.fileUrl.trim()) {
    const fileName = (artwork.fileName || "").toLowerCase();
    const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".tif", ".tiff"];
    const isImageFile = imageExtensions.some((ext) => fileName.endsWith(ext));
    
    if (isImageFile) {
      return artwork.fileUrl;
    }
  }
  
  return null;
}

/**
 * Normalize artwork for DS jobs: 2+ assets = front+back, 1 asset = front only (back null)
 */
function normalizeArtworkForSides(
  sides: string,
  thumbs: { front: ProductionOrderArtworkSummary | null; back: ProductionOrderArtworkSummary | null }
): {
  front: ProductionOrderArtworkSummary | null;
  back: ProductionOrderArtworkSummary | null;
  showBackSlot: boolean;
  backMissingReason: "not_uploaded" | null;
} {
  const isDS = sides.toLowerCase().includes("double");
  
  if (!isDS) {
    // Single-sided: no back slot
    return { front: thumbs.front, back: null, showBackSlot: false, backMissingReason: null };
  }
  
  // Double-sided: always show back slot
  const hasBack = !!thumbs.back;
  return {
    front: thumbs.front,
    back: thumbs.back,
    showBackSlot: true,
    backMissingReason: hasBack ? null : "not_uploaded",
  };
}

/**
 * Extract front/back artwork from job
 */
function artworkThumbs(job: ProductionJobListItem): {
  front: ProductionOrderArtworkSummary | null;
  back: ProductionOrderArtworkSummary | null;
} {
  const artwork = job.artwork;
  
  if (!artwork || artwork.length === 0) {
    return { front: null, back: null };
  }
  
  if (artwork.length === 1) {
    // 1 asset = front only
    return { front: artwork[0], back: null };
  }
  
  // 2+ assets = front=0 back=1
  return { front: artwork[0], back: artwork[1] };
}

function getFileTypeLabel(mimeType: string | null, fileName: string): string {
  if (mimeType?.includes("pdf")) return "PDF";
  if (mimeType?.includes("png")) return "PNG";
  if (mimeType?.includes("jpeg") || mimeType?.includes("jpg")) return "JPG";
  if (mimeType?.includes("svg")) return "SVG";
  if (mimeType?.includes("ai")) return "AI";
  const ext = fileName.split(".").pop()?.toUpperCase();
  return ext || "File";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildDownloadUrl(fileUrl: string, fileName: string): string {
  const url = new URL(fileUrl, window.location.origin);
  url.searchParams.set("download", "true");
  url.searchParams.set("filename", fileName);
  return url.toString();
}

export default function ProductionOverviewPage() {
  // Fetch ALL production jobs (no station/status filter for overview)
  // This shows jobs across all production modules (flatbed, roll, apparel)
  const { data: allJobs, isLoading, error } = useProductionJobs({});
  
  // View mode toggle (persist in localStorage)
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem("productionOverviewViewMode");
    return (saved === "board" || saved === "list") ? saved : "board";
  });

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem("productionOverviewViewMode", mode);
  };

  // Board card display configuration
  const [boardCardConfig, setBoardCardConfig] = useState<BoardCardConfig>(() => {
    const saved = localStorage.getItem("productionOverviewBoardCardConfig");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return DEFAULT_BOARD_CARD_CONFIG;
      }
    }
    return DEFAULT_BOARD_CARD_CONFIG;
  });

  const saveBoardCardConfig = (newConfig: BoardCardConfig) => {
    setBoardCardConfig(newConfig);
    localStorage.setItem("productionOverviewBoardCardConfig", JSON.stringify(newConfig));
  };

  const resetBoardCardConfig = () => {
    saveBoardCardConfig(DEFAULT_BOARD_CARD_CONFIG);
  };

  // Column configuration state (persist in localStorage)
  const [columns, setColumns] = useState<ColumnConfig[]>(() => {
    const saved = localStorage.getItem("productionOverviewColumns");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return DEFAULT_COLUMNS;
      }
    }
    return DEFAULT_COLUMNS;
  });

  const saveColumns = (newColumns: ColumnConfig[]) => {
    setColumns(newColumns);
    localStorage.setItem("productionOverviewColumns", JSON.stringify(newColumns));
  };

  const visibleColumns = useMemo(() => columns.filter(c => c.visible), [columns]);

  // Column management handlers
  const toggleColumnVisibility = (columnId: ColumnId) => {
    const newColumns = columns.map(col =>
      col.id === columnId ? { ...col, visible: !col.visible } : col
    );
    saveColumns(newColumns);
  };

  const moveColumnUp = (columnId: ColumnId) => {
    const idx = columns.findIndex(c => c.id === columnId);
    if (idx > 0) {
      const newColumns = [...columns];
      [newColumns[idx - 1], newColumns[idx]] = [newColumns[idx], newColumns[idx - 1]];
      saveColumns(newColumns);
    }
  };

  const moveColumnDown = (columnId: ColumnId) => {
    const idx = columns.findIndex(c => c.id === columnId);
    if (idx < columns.length - 1) {
      const newColumns = [...columns];
      [newColumns[idx], newColumns[idx + 1]] = [newColumns[idx + 1], newColumns[idx]];
      saveColumns(newColumns);
    }
  };

  const updateColumnWidth = (columnId: ColumnId, width: number) => {
    const newColumns = columns.map(col =>
      col.id === columnId ? { ...col, width: Math.max(60, width) } : col
    );
    saveColumns(newColumns);
  };

  const resetColumns = () => {
    saveColumns(DEFAULT_COLUMNS);
  };

  // Sorting state
  const [sort, setSort] = useState<SortState>({ field: "dueDate", direction: "asc" });

  const handleSort = (field: string) => {
    setSort(prev => ({
      field,
      direction: prev.field === field && prev.direction === "asc" ? "desc" : "asc"
    }));
  };

  // Artwork preview modal state
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<ProductionJobListItem | null>(null);
  const [previewSide, setPreviewSide] = useState<"front" | "back">("front");

  const openArtworkModal = (job: ProductionJobListItem) => {
    setSelectedJob(job);
    setPreviewSide("front");
    setPreviewModalOpen(true);
  };

  // Query client for optimistic updates
  const queryClient = useQueryClient();
  
  // Mutation hook for drag & drop status updates (created dynamically when needed)
  const [pendingStatusUpdate, setPendingStatusUpdate] = useState<{
    jobId: string;
    status: "queued" | "in_progress" | "done";
  } | null>(null);
  
  const statusUpdateMutation = useUpdateProductionJobStatus(pendingStatusUpdate?.jobId || '');
  
  // Execute pending status update
  useEffect(() => {
    if (pendingStatusUpdate && pendingStatusUpdate.jobId) {
      statusUpdateMutation.mutate(pendingStatusUpdate.status, {
        onSettled: () => {
          setPendingStatusUpdate(null);
        }
      });
    }
  }, [pendingStatusUpdate, statusUpdateMutation]);

  // Drag and drop state
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before drag starts
      },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveJobId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveJobId(null);

    if (!over) {
      if (import.meta.env.DEV) console.log('[DnD] Drag ended with no drop target');
      return;
    }

    const jobId = active.id as string;
    const overId = over.id as string;
    
    // Determine target status from over.id
    // over.id should be one of: "queued" | "in_progress" | "done" (droppable column IDs)
    let targetStatus: "queued" | "in_progress" | "done" | null = null;
    
    if (overId === "queued" || overId === "in_progress" || overId === "done") {
      targetStatus = overId;
    } else {
      // If dropped over another job card, infer status from that card's status
      const targetJob = jobs.find(j => j.id === overId);
      if (targetJob) {
        targetStatus = targetJob.status;
      }
    }
    
    if (!targetStatus) {
      if (import.meta.env.DEV) console.log('[DnD] Could not resolve target status', { activeId: jobId, overId });
      return;
    }
    
    // Find the job to check if status changed
    const job = jobs.find(j => j.id === jobId);
    if (!job) {
      if (import.meta.env.DEV) console.log('[DnD] Job not found', { jobId });
      return;
    }
    
    if (job.status === targetStatus) {
      if (import.meta.env.DEV) console.log('[DnD] No status change needed', { jobId, currentStatus: job.status });
      return;
    }
    
    if (import.meta.env.DEV) {
      console.log('[DnD] Status change', {
        jobId,
        overId,
        currentStatus: job.status,
        targetStatus,
        resolvedFrom: overId === targetStatus ? 'column' : 'card'
      });
    }

    // OPTIMISTIC UPDATE: Update cache immediately
    const queryKey = ["/api/production/jobs"];
    const previousData = queryClient.getQueryData<ProductionJobListItem[]>(queryKey);
    
    if (previousData) {
      const optimisticData = previousData.map(j =>
        j.id === jobId ? { ...j, status: targetStatus as "queued" | "in_progress" | "done" } : j
      );
      queryClient.setQueryData(queryKey, optimisticData);
    }
    
    // MUTATION: Call API to persist change
    setPendingStatusUpdate({ jobId, status: targetStatus });
    
    // Note: Rollback on error is handled by React Query's automatic invalidation
    // The mutation hook already calls invalidateProduction on both success and error
  };

  const jobs = useMemo(() => allJobs ?? [], [allJobs]);

  // DEV-only: log sample preview URLs once
  const devLoggedSample = useRef(false);
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (devLoggedSample.current) return;
    if (!jobs || jobs.length === 0) return;
    const j = jobs[0];
    devLoggedSample.current = true;
    // eslint-disable-next-line no-console
    console.log("[ProductionOverview] sample job previews", {
      id: j.id,
      frontPreviewUrl: j.frontPreviewUrl,
      backPreviewUrl: j.backPreviewUrl,
      frontFileUrl: j.frontFileUrl,
      backFileUrl: j.backFileUrl,
    });
  }, [jobs]);

  // Sort jobs for list view
  const sortedJobs = useMemo(() => {
    const sorted = [...jobs];
    sorted.sort((a, b) => {
      let comparison = 0;
      
      switch (sort.field) {
        case "dueDate": {
          const aDate = a.order.dueDate ? parseISO(a.order.dueDate).getTime() : Number.POSITIVE_INFINITY;
          const bDate = b.order.dueDate ? parseISO(b.order.dueDate).getTime() : Number.POSITIVE_INFINITY;
          comparison = aDate - bDate;
          break;
        }
        case "customer":
          comparison = (a.order.customerName || "").localeCompare(b.order.customerName || "");
          break;
        case "orderNumber":
          comparison = (a.order.orderNumber || "").localeCompare(b.order.orderNumber || "");
          break;
        case "jobDescription":
          comparison = (a.jobDescription || "").localeCompare(b.jobDescription || "");
          break;
        case "media":
          comparison = (a.media || "").localeCompare(b.media || "");
          break;
        case "qty": {
          const aQty = a.qty || 0;
          const bQty = b.qty || 0;
          comparison = aQty - bQty;
          break;
        }
        case "sides":
          comparison = (a.sides || "").localeCompare(b.sides || "");
          break;
        case "status":
          comparison = a.status.localeCompare(b.status);
          break;
        case "station":
          comparison = (a.stationKey || "").localeCompare(b.stationKey || "");
          break;
      }
      
      return sort.direction === "asc" ? comparison : -comparison;
    });
    return sorted;
  }, [jobs, sort.field, sort.direction]);

  // Group jobs by status for Kanban board
  const jobsByStatus = useMemo(() => {
    const grouped = new Map<string, ProductionJobListItem[]>();
    KANBAN_COLUMNS.forEach(col => grouped.set(col.status, []));
    
    jobs.forEach(job => {
      const column = grouped.get(job.status);
      if (column) {
        column.push(job);
      }
    });
    
    // Sort within each column by due date
    grouped.forEach(column => {
      column.sort((a, b) => {
        const aDate = a.order.dueDate ? parseISO(a.order.dueDate).getTime() : Number.POSITIVE_INFINITY;
        const bDate = b.order.dueDate ? parseISO(b.order.dueDate).getTime() : Number.POSITIVE_INFINITY;
        return aDate - bDate;
      });
    });
    
    return grouped;
  }, [jobs]);

  const activeJob = activeJobId ? jobs.find(j => j.id === activeJobId) : null;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Production Overview</h2>
        </div>
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Loading production jobs...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Production Overview</h2>
        </div>
        <Card>
          <CardContent className="p-8 text-center text-destructive">
            Failed to load production jobs. Please try again.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with view toggle and controls */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Production Overview</h2>
          {process.env.NODE_ENV === 'development' && (
            <div className="mt-1 space-y-0.5">
              <p className="text-xs text-muted-foreground">
                Jobs loaded: {jobs.length}
              </p>
              {jobs.length === 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  ⚠️ No production jobs found. If orders are marked "in production", check:
                  <br />• Line items have requiresProductionJob=true on their product
                  <br />• Auto-scheduling triggers are firing (check server logs)
                  <br />• Production routing config exists or defaults are used
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center gap-1 border rounded-md p-1">
            <Button
              variant={viewMode === "board" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => handleViewModeChange("board")}
              className="h-8"
            >
              <LayoutGrid className="w-4 h-4 mr-1.5" />
              Board
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => handleViewModeChange("list")}
              className="h-8"
            >
              <List className="w-4 h-4 mr-1.5" />
              List
            </Button>
          </div>

          {/* Board settings */}
          {viewMode === "board" && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8">
                  <Settings2 className="w-4 h-4 mr-1.5" />
                  Board Settings
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="end">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium">Card Display</h4>
                    <Button variant="ghost" size="sm" onClick={resetBoardCardConfig} className="h-7 text-xs">
                      Reset
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {(Object.keys(boardCardConfig) as BoardCardField[]).map((field) => (
                      <div key={field} className="flex items-center justify-between">
                        <Label htmlFor={field} className="text-sm cursor-pointer capitalize">
                          {field === "orderNumber" ? "Order #" : 
                           field === "jobDescription" ? "Job Description" :
                           field === "dueDate" ? "Due Date" :
                           field}
                        </Label>
                        <Switch
                          id={field}
                          checked={boardCardConfig[field]}
                          onCheckedChange={(checked) => {
                            saveBoardCardConfig({ ...boardCardConfig, [field]: checked });
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}

          {/* Column management for list view */}
          {viewMode === "list" && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8">
                  <Settings2 className="w-4 h-4 mr-1.5" />
                  Columns
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="end">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium">Manage Columns</h4>
                    <Button variant="ghost" size="sm" onClick={resetColumns} className="h-7 text-xs">
                      Reset
                    </Button>
                  </div>
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {columns.map((col, idx) => (
                      <div key={col.id} className="flex items-center gap-2 p-2 border rounded-md">
                        <div className="flex flex-col gap-0.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => moveColumnUp(col.id)}
                            disabled={idx === 0}
                            className="h-4 w-4 p-0"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => moveColumnDown(col.id)}
                            disabled={idx === columns.length - 1}
                            className="h-4 w-4 p-0"
                          >
                            <ArrowDown className="w-3 h-3" />
                          </Button>
                        </div>
                        <Checkbox
                          checked={col.visible}
                          onCheckedChange={() => toggleColumnVisibility(col.id)}
                        />
                        <span className="flex-1 text-sm">{col.label}</span>
                        <GripVertical className="w-4 h-4 text-muted-foreground" />
                      </div>
                    ))}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>

      {/* Board view with drag and drop */}
      {viewMode === "board" && (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {KANBAN_COLUMNS.map(column => {
              const columnJobs = jobsByStatus.get(column.status) ?? [];
              return (
                <KanbanColumn
                  key={column.id}
                  column={column}
                  jobs={columnJobs}
                  boardCardConfig={boardCardConfig}
                  onArtworkClick={openArtworkModal}
                />
              );
            })}
          </div>
          <DragOverlay>
            {activeJob && (
              <JobCard
                job={activeJob}
                boardCardConfig={boardCardConfig}
                onArtworkClick={openArtworkModal}
                isDragOverlay
              />
            )}
          </DragOverlay>
        </DndContext>
      )}

      {/* List view */}
      {viewMode === "list" && (
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {visibleColumns.map(col => (
                    <ResizableTableHead
                      key={col.id}
                      column={col}
                      sortState={sort}
                      onSort={handleSort}
                      onResize={(width) => updateColumnWidth(col.id, width)}
                    />
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedJobs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={visibleColumns.length} className="text-center text-muted-foreground py-8">
                      No production jobs found
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedJobs.map(job => (
                    <JobRow 
                      key={job.id} 
                      job={job} 
                      visibleColumns={visibleColumns}
                      onArtworkClick={openArtworkModal}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Artwork Preview Modal */}
      <Dialog open={previewModalOpen} onOpenChange={setPreviewModalOpen}>
        <DialogContent className="max-w-[90vw] w-[90vw] max-h-[90vh] h-[90vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {selectedJob
                ? `${selectedJob.order.customerName} • Order #${selectedJob.order.orderNumber} • Job ${String(selectedJob.id).slice(-6)}`
                : "Artwork Preview"}
            </DialogTitle>
          </DialogHeader>
          {selectedJob && (() => {
            const sidesValue = selectedJob.sides ?? "—";
            const thumbs = artworkThumbs(selectedJob);
            const { front, back, showBackSlot, backMissingReason } = normalizeArtworkForSides(sidesValue, thumbs);
            const currentArtwork = previewSide === "front" ? front : back;
            const imageSrc = getBestArtworkImage(currentArtwork);

            return (
              <div className="flex-1 flex flex-col min-h-0 gap-4">
                {/* Front/Back toggle - only show for double-sided jobs */}
                {showBackSlot && (
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant={previewSide === "front" ? "default" : "outline"}
                      onClick={() => setPreviewSide("front")}
                    >
                      Front
                    </Button>
                    <Button
                      size="sm"
                      variant={previewSide === "back" ? "default" : "outline"}
                      onClick={() => setPreviewSide("back")}
                    >
                      Back
                    </Button>
                    {backMissingReason === "not_uploaded" && previewSide === "back" && (
                      <span className="text-xs text-amber-500 ml-2">(Not uploaded)</span>
                    )}
                  </div>
                )}

                {/* Large artwork preview with zoom/pan controls */}
                {previewSide === "back" && backMissingReason === "not_uploaded" ? (
                  <div className="flex-1 min-h-0 rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center bg-muted/30 p-8 text-center">
                    <FileText className="h-16 w-16 text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-2">Back file not uploaded</h3>
                    <p className="text-sm text-muted-foreground mb-4">This double-sided job only has front artwork. Upload a back file to complete the artwork set.</p>
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => {
                        const orderId = selectedJob.order.id;
                        if (orderId) window.location.href = `/orders/${orderId}`;
                      }}
                      className="gap-1.5"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Upload back file
                    </Button>
                  </div>
                ) : (
                  <ZoomPanImageViewer
                    src={imageSrc}
                    alt={`${previewSide === "front" ? "Front" : "Back"} artwork`}
                    className="flex-1 min-h-0 rounded-lg border-2 border-border"
                  />
                )}

                {/* File info and actions - pinned at bottom */}
                {currentArtwork && (
                  <div className="flex items-center justify-between gap-4 text-sm shrink-0 p-3 bg-card rounded-lg border">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{currentArtwork.fileName}</div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                        <span>{getFileTypeLabel(currentArtwork.mimeType, currentArtwork.fileName)}</span>
                        {currentArtwork.sizeBytes && (
                          <>
                            <span>•</span>
                            <span>{formatFileSize(currentArtwork.sizeBytes)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {currentArtwork.fileUrl && (
                        <>
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => {
                              const downloadUrl = buildDownloadUrl(currentArtwork.fileUrl, currentArtwork.fileName);
                              window.location.href = downloadUrl;
                            }}
                            className="gap-1.5"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Download
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => window.open(currentArtwork.fileUrl, "_blank")}
                            className="gap-1.5"
                          >
                            Open
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Kanban column with droppable functionality
function KanbanColumn({
  column,
  jobs,
  boardCardConfig,
  onArtworkClick,
}: {
  column: typeof KANBAN_COLUMNS[number];
  jobs: ProductionJobListItem[];
  boardCardConfig: BoardCardConfig;
  onArtworkClick: (job: ProductionJobListItem) => void;
}) {
  const { setNodeRef } = useDroppable({ id: column.status });

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <span>{column.label}</span>
          <Badge variant="secondary" className="ml-2">
            {jobs.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent ref={setNodeRef} className="flex-1 space-y-2 pt-0 min-h-[200px]">
        {jobs.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-4">
            No jobs
          </div>
        ) : (
          jobs.map(job => (
            <JobCard
              key={job.id}
              job={job}
              boardCardConfig={boardCardConfig}
              onArtworkClick={onArtworkClick}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

// Resizable table head component
function ResizableTableHead({
  column,
  sortState,
  onSort,
  onResize
}: {
  column: ColumnConfig;
  sortState: SortState;
  onSort: (field: string) => void;
  onResize: (width: number) => void;
}) {
  const thRef = useRef<HTMLTableCellElement>(null);
  const [isResizing, setIsResizing] = useState(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = thRef.current?.offsetWidth || column.width;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      onResize(startWidth + delta);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const isSorted = sortState.field === column.sortField;
  const sortIcon = isSorted ? (
    sortState.direction === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
  ) : null;

  return (
    <TableHead
      ref={thRef}
      style={{ width: column.width }}
      className={cn("relative select-none", isResizing && "bg-muted")}
    >
      <div className="flex items-center justify-between gap-2">
        {column.sortable ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSort(column.sortField!)}
            className="h-7 px-2 -ml-2 hover:bg-transparent"
          >
            <span className="text-xs font-medium">{column.label}</span>
            {sortIcon && <span className="ml-1">{sortIcon}</span>}
            {!sortIcon && <ChevronsUpDown className="w-3 h-3 ml-1 text-muted-foreground" />}
          </Button>
        ) : (
          <span className="text-xs font-medium">{column.label}</span>
        )}
        <div
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/20 active:bg-primary/40"
          onMouseDown={handleMouseDown}
        />
      </div>
    </TableHead>
  );
}

// Job card component for Kanban board
function JobCard({ 
  job, 
  boardCardConfig,
  onArtworkClick,
  isDragOverlay = false,
}: { 
  job: ProductionJobListItem; 
  boardCardConfig: BoardCardConfig;
  onArtworkClick: (job: ProductionJobListItem) => void;
  isDragOverlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: job.id,
  });
  const navigate = useNavigate();
  const sides = job.sides || "single";
  const isDueOverdue = job.order.dueDate ? isPast(parseISO(job.order.dueDate)) : false;
  const customerId = job.order.customerId;
  const orderId = job.order.id;

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : undefined;

  const handleCardClick = () => {
    navigate(`/production/jobs/${job.id}`);
  };

  return (
    <Card 
      ref={setNodeRef}
      style={style}
      className={cn(
        "hover:shadow-md transition-shadow",
        (isDragging && !isDragOverlay) && "opacity-50",
        isDragOverlay && "shadow-lg rotate-3"
      )}
    >
      <CardContent className="p-3 space-y-2">
        {/* Drag handle - separate from click areas */}
        <div 
          {...attributes}
          {...listeners}
          className="absolute top-2 right-2 cursor-grab active:cursor-grabbing p-1 hover:bg-muted/50 rounded"
          title="Drag to move"
        >
          <GripVertical className="w-3 h-3 text-muted-foreground" />
        </div>

        {/* Clickable card body area - navigates to job detail */}
        <div onClick={handleCardClick} className="cursor-pointer">
          {/* Top row: customer (link) + order (link) */}
          {(boardCardConfig.customer || boardCardConfig.orderNumber) && (
            <div className="flex items-start justify-between gap-2 pr-6">
            {boardCardConfig.customer && (
              <div className="flex-1 min-w-0">
                {customerId ? (
                  <Link
                    to={ROUTES.customers.detail(customerId)}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline truncate block"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {job.order.customerName}
                  </Link>
                ) : (
                  <span className="text-xs font-medium truncate block">
                    {job.order.customerName}
                  </span>
                )}
              </div>
            )}
            {boardCardConfig.orderNumber && orderId && (
              <Link
                to={ROUTES.orders.detail(orderId)}
                className="text-xs text-blue-600 hover:text-blue-700 hover:underline shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                #{job.order.orderNumber}
              </Link>
            )}
          </div>
        )}

        {/* Middle: job description */}
        {boardCardConfig.jobDescription && (
          <div className="text-xs text-muted-foreground line-clamp-2">
            {job.jobDescription || "—"}
          </div>
        )}

        {/* Bottom: badges */}
        <div className="flex items-center flex-wrap gap-1.5">
          {boardCardConfig.media && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
              {job.media || "—"}
            </Badge>
          )}
          {boardCardConfig.qty && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
              Qty: {job.qty || 0}
            </Badge>
          )}
          {boardCardConfig.sides && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
              {sides.toLowerCase().includes("double") ? "DS" : "SS"}
            </Badge>
          )}
          {boardCardConfig.dueDate && job.order.dueDate && (
            <Badge 
              variant={isDueOverdue ? "destructive" : "secondary"}
              className="text-[10px] px-1.5 py-0.5"
            >
              {format(parseISO(job.order.dueDate), "MMM d")}
            </Badge>
          )}
          {boardCardConfig.station && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5 capitalize">
              {job.stationKey || "—"}
            </Badge>
          )}
          {boardCardConfig.status && (
            <Badge 
              variant={job.status === "done" ? "default" : "secondary"}
              className="text-[10px] px-1.5 py-0.5 capitalize"
            >
              {job.status.replace("_", " ")}
            </Badge>
          )}
        </div>
      </div>

      {/* Artwork thumbnails - separate click zone for modal */}
      <div 
        onClick={(e) => {
          e.stopPropagation();
          onArtworkClick(job);
        }}
        className="cursor-pointer hover:opacity-80 transition-opacity"
      >
        <ThumbnailGroup job={job} sides={sides} />
      </div>
      </CardContent>
    </Card>
  );
}

// Job row component for list view
function JobRow({ job, visibleColumns, onArtworkClick }: { job: ProductionJobListItem; visibleColumns: ColumnConfig[]; onArtworkClick: (job: ProductionJobListItem) => void }) {
  const navigate = useNavigate();
  const updateStatus = useUpdateProductionJobStatus(job.id);
  const sides = job.sides || "single";
  const isDueOverdue = job.order.dueDate ? isPast(parseISO(job.order.dueDate)) : false;
  const customerId = job.order.customerId;
  const orderId = job.order.id;

  const handleClick = () => {
    navigate(`/production/jobs/${job.id}`);
  };

  const getCellContent = (colId: ColumnId) => {
    switch (colId) {
      case "artwork":
        return (
          <div 
            onClick={(e) => {
              e.stopPropagation();
              onArtworkClick(job);
            }}
            className="cursor-pointer"
          >
            <ThumbnailGroup job={job} sides={sides} />
          </div>
        );
      
      case "dueDate":
        return job.order.dueDate ? (
          <Badge 
            variant={isDueOverdue ? "destructive" : "secondary"}
            className="text-xs"
          >
            {format(parseISO(job.order.dueDate), "MMM d, yyyy")}
          </Badge>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        );
      
      case "customer":
        return (
          <div onClick={(e) => e.stopPropagation()}>
            {customerId ? (
              <Link
                to={ROUTES.customers.detail(customerId)}
                className="font-medium text-sm text-blue-600 hover:text-blue-700 hover:underline"
              >
                {job.order.customerName}
              </Link>
            ) : (
              <span className="font-medium text-sm">{job.order.customerName}</span>
            )}
          </div>
        );
      
      case "orderNumber":
        return (
          <div onClick={(e) => e.stopPropagation()}>
            {orderId ? (
              <Link
                to={ROUTES.orders.detail(orderId)}
                className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
              >
                {job.order.orderNumber}
              </Link>
            ) : (
              <span className="text-sm text-muted-foreground">{job.order.orderNumber}</span>
            )}
          </div>
        );
      
      case "jobDescription":
        return <span className="text-sm text-muted-foreground">{job.jobDescription || "—"}</span>;
      
      case "media":
        return <span className="text-sm text-muted-foreground">{job.media || "—"}</span>;
      
      case "qty":
        return <span className="text-sm text-muted-foreground">{job.qty || "—"}</span>;
      
      case "sides":
        return (
          <Badge variant="outline" className="text-xs">
            {sides.toLowerCase().includes("double") ? "Double Sided" : "Single Sided"}
          </Badge>
        );
      
      case "status":
        return (
          <div onClick={(e) => e.stopPropagation()}>
            <Select
              value={job.status}
              onValueChange={(value) => updateStatus.mutate(value as "queued" | "in_progress" | "done")}
              disabled={updateStatus.isPending}
            >
              <SelectTrigger className="h-7 text-xs w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="queued">Queued</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="done">Done</SelectItem>
              </SelectContent>
            </Select>
          </div>
        );
      
      case "station":
        return <span className="text-sm text-muted-foreground capitalize">{job.stationKey || "—"}</span>;
      
      default:
        return null;
    }
  };

  return (
    <TableRow 
      className="cursor-pointer hover:bg-muted/50"
      onClick={handleClick}
    >
      {visibleColumns.map(col => (
        <TableCell key={col.id} style={{ width: col.width }}>
          {getCellContent(col.id)}
        </TableCell>
      ))}
    </TableRow>
  );
}

function PreviewThumb({ src, alt }: { src?: string; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="w-24 h-24 rounded border border-dashed border-muted-foreground/30 bg-muted/20 flex items-center justify-center">
        <FileText className="w-6 h-6 text-muted-foreground/50" />
      </div>
    );
  }

  return (
    <div className="w-24 h-24 rounded border border-border overflow-hidden bg-muted">
      <img
        src={src}
        alt={alt}
        className="w-full h-full object-contain"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

// Thumbnail group component (shared between card and row)
function ThumbnailGroup({ job, sides }: { job: ProductionJobListItem; sides: string }) {
  const isDoubleSided = sides.toLowerCase().includes("double");
  const front = job.frontPreviewUrl;
  const back = job.backPreviewUrl;

  return (
    <div className="flex items-center gap-2">
      <PreviewThumb src={front} alt={`Job ${job.id} front preview`} />
      {isDoubleSided && <PreviewThumb src={back} alt={`Job ${job.id} back preview`} />}
    </div>
  );
}
