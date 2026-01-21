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
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  Search,
  X,
  Eye,
  EyeOff,
  Maximize2,
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
import { productionCardTheme, computeUrgency, statusColors } from "../theme/productionCardTheme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  { id: "queued", label: "Queued", stepKey: null },
  { id: "prepress", label: "Prepress", stepKey: "prepress" },
  { id: "printing", label: "Printing", stepKey: "printing" },
  { id: "finishing", label: "Finishing", stepKey: "finishing" },
  { id: "fulfillment", label: "Fulfillment", stepKey: "fulfillment" },
  { id: "production_complete", label: "Production Complete", stepKey: "production_complete" },
] as const;

// Column width constraints for fit mode
const MIN_COLUMN_WIDTH = 320;
const MAX_COLUMN_WIDTH = 520;
const DEFAULT_COLUMN_WIDTH = 420;
const BOARD_GAP = 16; // gap-4 = 16px

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
  station: true,
  status: true,
};

// Board column visibility configuration
type BoardColumnVisibility = Record<string, boolean>;

const DEFAULT_BOARD_COLUMN_VISIBILITY: BoardColumnVisibility = {
  queued: true,
  prepress: true,
  printing: true,
  finishing: true,
  fulfillment: true,
  production_complete: true,
};

// Board sorting configuration
type BoardSortKey = "dueDate" | "customer" | "orderNumber" | "status";

type BoardSortConfig = {
  key: BoardSortKey;
  direction: "asc" | "desc";
};

const DEFAULT_BOARD_SORT: BoardSortConfig = {
  key: "dueDate",
  direction: "asc",
};

// Search result type
type SearchResult = {
  id: string;
  title: string;
  subtitle?: string;
  url: string;
  type: string;
};

type GlobalSearchResults = {
  customers: SearchResult[];
  contacts: SearchResult[];
  orders: SearchResult[];
  quotes: SearchResult[];
  invoices: SearchResult[];
  jobs: SearchResult[];
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

  // Global collapsed state for board cards
  const [globalCollapsed, setGlobalCollapsed] = useState<boolean>(() => {
    const saved = localStorage.getItem("production_board_collapsed");
    return saved === "true";
  });
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  const toggleGlobalCollapsed = () => {
    const newValue = !globalCollapsed;
    setGlobalCollapsed(newValue);
    localStorage.setItem("production_board_collapsed", String(newValue));
    // Clear individual card states when changing global
    setExpandedCards(new Set());
  };

  const toggleCardExpanded = (jobId: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  };

  const isCardExpanded = (jobId: string) => {
    // If global is collapsed, check if this specific card is expanded
    // If global is expanded, check if this specific card is NOT collapsed
    return globalCollapsed ? expandedCards.has(jobId) : !expandedCards.has(jobId);
  };

  const saveBoardCardConfig = (newConfig: BoardCardConfig) => {
    setBoardCardConfig(newConfig);
    localStorage.setItem("productionOverviewBoardCardConfig", JSON.stringify(newConfig));
  };

  // Board column visibility state
  const [boardColumnVisibility, setBoardColumnVisibility] = useState<BoardColumnVisibility>(() => {
    const saved = localStorage.getItem("productionBoardColumnVisibility");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return DEFAULT_BOARD_COLUMN_VISIBILITY;
      }
    }
    return DEFAULT_BOARD_COLUMN_VISIBILITY;
  });

  const saveBoardColumnVisibility = (newConfig: BoardColumnVisibility) => {
    setBoardColumnVisibility(newConfig);
    localStorage.setItem("productionBoardColumnVisibility", JSON.stringify(newConfig));
  };

  const showAllColumns = () => {
    const allVisible = KANBAN_COLUMNS.reduce((acc, col) => ({ ...acc, [col.id]: true }), {} as BoardColumnVisibility);
    saveBoardColumnVisibility(allVisible);
  };

  const hiddenColumnCount = useMemo(() => {
    return Object.values(boardColumnVisibility).filter(v => !v).length;
  }, [boardColumnVisibility]);

  // Board sorting state
  const [boardSort, setBoardSort] = useState<BoardSortConfig>(() => {
    const saved = localStorage.getItem("productionBoardSort");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return DEFAULT_BOARD_SORT;
      }
    }
    return DEFAULT_BOARD_SORT;
  });

  const saveBoardSort = (newSort: BoardSortConfig) => {
    setBoardSort(newSort);
    localStorage.setItem("productionBoardSort", JSON.stringify(newSort));
  };

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOnlyProduction, setSearchOnlyProduction] = useState(true);
  const [globalSearchResults, setGlobalSearchResults] = useState<GlobalSearchResults | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout>();

  // Fit columns state
  const [fitColumns, setFitColumns] = useState<boolean>(() => {
    const saved = localStorage.getItem("titan.production.board.fitColumns");
    return saved === "true";
  });
  const [boardWidth, setBoardWidth] = useState<number>(0);
  const boardContainerRef = useRef<HTMLDivElement>(null);

  const toggleFitColumns = () => {
    const newValue = !fitColumns;
    setFitColumns(newValue);
    localStorage.setItem("titan.production.board.fitColumns", String(newValue));
  };

  // Measure board container width with ResizeObserver
  useEffect(() => {
    const container = boardContainerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Use contentRect for the inner dimensions
        setBoardWidth(entry.contentRect.width);
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Calculate column width when fit mode is enabled
  const visibleColumnsCount = useMemo(() => {
    return KANBAN_COLUMNS.filter(col => boardColumnVisibility[col.id] !== false).length;
  }, [boardColumnVisibility]);

  const calculatedColumnWidth = useMemo(() => {
    if (!fitColumns || visibleColumnsCount === 0 || boardWidth === 0) {
      return DEFAULT_COLUMN_WIDTH;
    }

    // Available width = total width - gaps between columns
    const totalGapWidth = BOARD_GAP * (visibleColumnsCount - 1);
    const availableWidth = boardWidth - totalGapWidth;
    
    // Divide by number of columns and clamp
    const width = availableWidth / visibleColumnsCount;
    return Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.floor(width)));
  }, [fitColumns, visibleColumnsCount, boardWidth]);

  const resetBoardCardConfig = () => {
    saveBoardCardConfig(DEFAULT_BOARD_CARD_CONFIG);
  };

  // Search handlers
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    
    if (!value) {
      setGlobalSearchResults(null);
      return;
    }

    // If searching production only, no API call needed (local filter)
    if (searchOnlyProduction) {
      return;
    }

    // Global search with debounce
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(value)}`, {
          credentials: "include",
        });
        if (response.ok) {
          const data = await response.json();
          setGlobalSearchResults(data);
        }
      } catch (error) {
        console.error("Search failed:", error);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  };

  const clearSearch = () => {
    setSearchQuery("");
    setGlobalSearchResults(null);
  };

  // Sort comparator for board cards
  const sortBoardJobs = (jobs: ProductionJobListItem[]): ProductionJobListItem[] => {
    const sorted = [...jobs].sort((a, b) => {
      let comparison = 0;
      
      switch (boardSort.key) {
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
        case "status":
          comparison = (a.status || "").localeCompare(b.status || "");
          break;
      }
      
      // Stable sort: tie-break by orderNumber then jobId
      if (comparison === 0) {
        comparison = (a.order.orderNumber || "").localeCompare(b.order.orderNumber || "");
      }
      if (comparison === 0) {
        comparison = (a.id || "").localeCompare(b.id || "");
      }
      
      return boardSort.direction === "asc" ? comparison : -comparison;
    });
    return sorted;
  };

  // Filter jobs for production-only search
  const matchesSearchQuery = (job: ProductionJobListItem, query: string): boolean => {
    if (!query) return true;
    const lowerQuery = query.toLowerCase();
    return (
      (job.order.customerName || "").toLowerCase().includes(lowerQuery) ||
      (job.order.orderNumber || "").toLowerCase().includes(lowerQuery) ||
      (job.jobDescription || "").toLowerCase().includes(lowerQuery) ||
      (job.mediaLabel || "").toLowerCase().includes(lowerQuery) ||
      (job.media || "").toLowerCase().includes(lowerQuery)
    );
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
  
  // Track in-flight mutations to prevent duplicates
  const inFlightMutations = useRef<Set<string>>(new Set());

  // Drag and drop state
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before drag starts
      },
      // Exclude interactive elements from starting drag
      onActivation: (event) => {
        const target = event.event.target as HTMLElement;
        // Don't start drag if clicking on interactive elements
        if (target.closest('[data-no-dnd="true"]')) {
          return false;
        }
        return true;
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
      if (import.meta.env.DEV) console.debug('[DnD] Drag ended with no drop target');
      return;
    }

    const jobId = active.id as string;
    const overId = over.id as string;
    
    // Determine target column from over.id
    let targetColumnId: string | null = null;
    
    // Check if dropped directly on a column
    const targetColumn = KANBAN_COLUMNS.find(col => col.id === overId);
    if (targetColumn) {
      targetColumnId = targetColumn.id;
    } else {
      // If dropped over another job card, infer column from that card
      const targetJob = jobs.find(j => j.id === overId);
      if (targetJob) {
        targetColumnId = getJobColumn(targetJob);
      }
    }
    
    if (!targetColumnId) {
      if (import.meta.env.DEV) console.debug('[DnD] Could not resolve target column', { activeId: jobId, overId });
      return;
    }
    
    // Find the job and check if column would change
    const job = jobs.find(j => j.id === jobId);
    if (!job) {
      if (import.meta.env.DEV) console.debug('[DnD] Job not found', { jobId });
      return;
    }
    
    const currentColumn = getJobColumn(job);
    if (currentColumn === targetColumnId) {
      if (import.meta.env.DEV) console.debug('[DnD] No change needed - same column', { jobId, column: currentColumn });
      return;
    }
    
    // Determine status and stepKey based on target column
    const column = KANBAN_COLUMNS.find(col => col.id === targetColumnId)!;
    let targetStatus: "queued" | "in_progress" | "done";
    let targetStepKey: string | null = column.stepKey;
    
    if (targetColumnId === "queued") {
      targetStatus = "queued";
    } else if (targetColumnId === "production_complete") {
      targetStatus = "done";
    } else {
      targetStatus = "in_progress";
    }
    
    // Prevent duplicate in-flight mutations for the same job
    if (inFlightMutations.current.has(jobId)) {
      if (import.meta.env.DEV) console.debug('[DnD] Skipping duplicate mutation - already in flight', { jobId });
      return;
    }
    
    if (import.meta.env.DEV) {
      console.debug('[DnD] Initiating column change', {
        jobId,
        fromColumn: currentColumn,
        toColumn: targetColumnId,
        fromStatus: job.status,
        toStatus: targetStatus,
        fromStepKey: job.stepKey,
        toStepKey: targetStepKey,
      });
    }

    // Mark mutation as in-flight
    inFlightMutations.current.add(jobId);

    // OPTIMISTIC UPDATE: update all production job list queries (any filters)
    const rollback = queryClient.getQueriesData<ProductionJobListItem[]>({
      queryKey: ["/api/production/jobs"],
    });

    queryClient.setQueriesData<ProductionJobListItem[]>(
      { queryKey: ["/api/production/jobs"] },
      (old) => {
        // Shape-safe update: handle array, envelope, or undefined
        if (!old) return old;
        
        // Case 1: Direct array (expected shape)
        if (Array.isArray(old)) {
          return old.map((j) =>
            j.id === jobId ? { ...j, status: targetStatus, stepKey: targetStepKey } : j
          );
        }
        
        // Case 2: Envelope { success, data: array }
        if (typeof old === 'object' && old !== null && 'data' in old && Array.isArray((old as any).data)) {
          return {
            ...(old as object),
            data: (old as any).data.map((j: ProductionJobListItem) =>
              j.id === jobId ? { ...j, status: targetStatus, stepKey: targetStepKey } : j
            ),
          } as any;
        }
        
        // Case 3: Unknown shape - log warning and return unchanged (fail-soft)
        if (process.env.NODE_ENV === 'development') {
          console.warn('[ProductionOverview] Unexpected cache shape in optimistic update:', {
            type: typeof old,
            keys: typeof old === 'object' && old !== null ? Object.keys(old) : [],
            isArray: Array.isArray(old),
          });
        }
        return old;
      }
    );

    // MUTATION: Call API directly
    fetch(`/api/production/jobs/${jobId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: targetStatus, stepKey: targetStepKey }),
      credentials: "include",
    })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Failed to update status");
        return json.data;
      })
      .then(() => {
        // Success - invalidate queries
        queryClient.invalidateQueries({ queryKey: ["/api/production/jobs"] });
        queryClient.invalidateQueries({ queryKey: ["/api/production/jobs", jobId] });
      })
      .catch((error) => {
        // Error - rollback optimistic update
        console.error('[DnD] Status update failed:', error);
        for (const [queryKey, data] of rollback) {
          queryClient.setQueryData(queryKey as any, data);
        }
      })
      .finally(() => {
        // Clear in-flight flag
        inFlightMutations.current.delete(jobId);
      });
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

  // Helper: Determine which column a job belongs to (SAFE fallback guaranteed)
  const getJobColumn = (job: ProductionJobListItem): string => {
    // Normalize stepKey to known column IDs
    const stepKey = job.stepKey || job.stationKey;
    if (stepKey) {
      const normalizedKey = stepKey.toLowerCase().trim();
      // Match to known column IDs
      const knownColumns = ["queued", "prepress", "printing", "finishing", "fulfillment", "production_complete"];
      if (knownColumns.includes(normalizedKey)) {
        return normalizedKey;
      }
    }
    
    // Fallback based on status (guaranteed assignment)
    if (job.status === "queued") return "queued";
    if (job.status === "done") return "production_complete";
    // Default to printing for in_progress jobs without stepKey
    return "printing";
  };

  // Group jobs by column (using stepKey-based routing)
  const jobsByStatus = useMemo(() => {
    const grouped = new Map<string, ProductionJobListItem[]>();
    KANBAN_COLUMNS.forEach(col => grouped.set(col.id, []));
    
    // Apply search filter if production-only mode
    const filteredJobs = searchOnlyProduction && searchQuery 
      ? jobs.filter(job => matchesSearchQuery(job, searchQuery))
      : jobs;
    
    filteredJobs.forEach(job => {
      const columnId = getJobColumn(job);
      const column = grouped.get(columnId);
      if (column) {
        column.push(job);
      }
    });
    
    // Apply sorting within each column
    grouped.forEach((columnJobs, columnId) => {
      const sorted = sortBoardJobs(columnJobs);
      grouped.set(columnId, sorted);
    });
    
    // Dev logging
    if (import.meta.env.DEV) {
      const counts: Record<string, number> = {};
      grouped.forEach((jobs, columnId) => {
        counts[columnId] = jobs.length;
      });
      console.log('[ProductionBoard] Job grouping:', { 
        total: filteredJobs.length, 
        byColumn: counts,
        searchActive: searchOnlyProduction && !!searchQuery,
      });
    }
    
    return grouped;
  }, [jobs, searchQuery, searchOnlyProduction, boardSort]);

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

        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[280px] max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search production jobs..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9 pr-9 h-9"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearSearch}
                className="absolute right-1 top-1/2 transform -translate-y-1/2 h-7 w-7 p-0"
              >
                <X className="w-4 h-4" />
              </Button>
            )}

            {/* Global search results dropdown */}
            {!searchOnlyProduction && globalSearchResults && searchQuery && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-[400px] overflow-y-auto z-50">
                {/* Results sections */}
                {Object.entries(globalSearchResults).map(([category, results]) => {
                  if (!results || results.length === 0) return null;
                  return (
                    <div key={category} className="p-2">
                      <div className="text-xs font-semibold text-muted-foreground uppercase px-2 py-1">
                        {category}
                      </div>
                      {results.map((result: SearchResult) => (
                        <Link
                          key={result.id}
                          to={result.url}
                          className="block px-3 py-2 hover:bg-accent rounded-md transition-colors"
                          onClick={clearSearch}
                        >
                          <div className="font-medium text-sm">{result.title}</div>
                          {result.subtitle && (
                            <div className="text-xs text-muted-foreground">{result.subtitle}</div>
                          )}
                        </Link>
                      ))}
                    </div>
                  );
                })}
                {Object.values(globalSearchResults).every(arr => arr.length === 0) && (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    No results found
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Search mode toggle */}
          <div className="flex items-center gap-2 border rounded-md px-3 h-9">
            <Checkbox
              id="search-production-only"
              checked={searchOnlyProduction}
              onCheckedChange={(checked) => setSearchOnlyProduction(checked === true)}
            />
            <Label htmlFor="search-production-only" className="text-sm cursor-pointer whitespace-nowrap">
              Only production
            </Label>
          </div>

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

          {/* Board-specific controls */}
          {viewMode === "board" && (
            <>
              {/* Board sorting */}
              <Select
                value={`${boardSort.key}-${boardSort.direction}`}
                onValueChange={(value) => {
                  const [key, direction] = value.split('-') as [BoardSortKey, 'asc' | 'desc'];
                  saveBoardSort({ key, direction });
                }}
              >
                <SelectTrigger className="w-[180px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dueDate-asc">Due Date (Earliest)</SelectItem>
                  <SelectItem value="dueDate-desc">Due Date (Latest)</SelectItem>
                  <SelectItem value="customer-asc">Customer (A-Z)</SelectItem>
                  <SelectItem value="customer-desc">Customer (Z-A)</SelectItem>
                  <SelectItem value="orderNumber-asc">Order # (Asc)</SelectItem>
                  <SelectItem value="orderNumber-desc">Order # (Desc)</SelectItem>
                  <SelectItem value="status-asc">Status (A-Z)</SelectItem>
                  <SelectItem value="status-desc">Status (Z-A)</SelectItem>
                </SelectContent>
              </Select>

              {/* Collapse all toggle */}
              <Button
                variant="outline"
                size="sm"
                onClick={toggleGlobalCollapsed}
                className="gap-2 h-9"
              >
                {globalCollapsed ? (
                  <>
                    <ChevronsUpDown className="w-4 h-4" />
                    Expand All
                  </>
                ) : (
                  <>
                    <ChevronsUpDown className="w-4 h-4" />
                    Collapse All
                  </>
                )}
              </Button>

              {/* Fit columns toggle */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={fitColumns ? "secondary" : "outline"}
                      size="sm"
                      onClick={toggleFitColumns}
                      className="gap-2 h-9"
                    >
                      <Maximize2 className="w-4 h-4" />
                      Fit Columns
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Fit all columns to screen width</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {/* Board settings dropdown */}
              <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8">
                  <Settings2 className="w-4 h-4 mr-1.5" />
                  Settings
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="end">
                <div className="space-y-4">
                  {/* Column visibility */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-medium">Column Visibility</h4>
                      {hiddenColumnCount > 0 && (
                        <Button variant="ghost" size="sm" onClick={showAllColumns} className="h-7 text-xs">
                          Show All
                        </Button>
                      )}
                    </div>
                    <div className="space-y-2">
                      {KANBAN_COLUMNS.map((column) => (
                        <div key={column.id} className="flex items-center justify-between">
                          <Label htmlFor={`col-${column.id}`} className="text-sm cursor-pointer">
                            {column.label}
                          </Label>
                          <Switch
                            id={`col-${column.id}`}
                            checked={boardColumnVisibility[column.id] ?? true}
                            onCheckedChange={(checked) => {
                              saveBoardColumnVisibility({ ...boardColumnVisibility, [column.id]: checked });
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Card display fields */}
                  <div className="space-y-3 pt-3 border-t">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-medium">Card Display</h4>
                      <Button variant="ghost" size="sm" onClick={resetBoardCardConfig} className="h-7 text-xs">
                        Reset
                      </Button>
                    </div>
                    <div className="space-y-2">
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
                </div>
              </PopoverContent>
            </Popover>
            </>
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
        <>
          {/* Hidden columns banner */}
          {hiddenColumnCount > 0 && (
            <div className="bg-muted/50 border rounded-md p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <EyeOff className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {hiddenColumnCount} {hiddenColumnCount === 1 ? 'column is' : 'columns are'} hidden
                </span>
              </div>
              <Button variant="outline" size="sm" onClick={showAllColumns} className="h-8">
                <Eye className="w-4 h-4 mr-1.5" />
                Show All Columns
              </Button>
            </div>
          )}

          {/* Search results indicator */}
          {searchOnlyProduction && searchQuery && (
            <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-md p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span className="text-sm text-blue-900 dark:text-blue-100">
                  Showing {jobs.filter(j => matchesSearchQuery(j, searchQuery)).length} matching jobs
                </span>
              </div>
              <Button variant="ghost" size="sm" onClick={clearSearch} className="h-8">
                Clear Filter
              </Button>
            </div>
          )}

          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div 
              ref={boardContainerRef}
              className={cn(
                "flex gap-4 pb-4",
                fitColumns ? "overflow-x-hidden" : "overflow-x-auto"
              )}
            >
              {KANBAN_COLUMNS.filter(col => boardColumnVisibility[col.id] !== false).map(column => {
                const columnJobs = jobsByStatus.get(column.id) ?? [];
                return (
                  <KanbanColumn
                    key={column.id}
                    column={column}
                    jobs={columnJobs}
                    boardCardConfig={boardCardConfig}
                    onArtworkClick={openArtworkModal}
                    isCardExpanded={isCardExpanded}
                    toggleCardExpanded={toggleCardExpanded}
                    width={fitColumns ? calculatedColumnWidth : DEFAULT_COLUMN_WIDTH}
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
        </>
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
  isCardExpanded,
  toggleCardExpanded,
  width = DEFAULT_COLUMN_WIDTH,
}: {
  column: typeof KANBAN_COLUMNS[number];
  jobs: ProductionJobListItem[];
  boardCardConfig: BoardCardConfig;
  onArtworkClick: (job: ProductionJobListItem) => void;
  isCardExpanded: (jobId: string) => boolean;
  toggleCardExpanded: (jobId: string) => void;
  width?: number;
}) {
  const { setNodeRef } = useDroppable({ id: column.id });

  return (
    <Card 
      className="flex flex-col flex-shrink-0" 
      style={{ width: `${width}px`, flex: `0 0 ${width}px` }}
    >
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
              isExpanded={isCardExpanded(job.id)}
              toggleExpanded={() => toggleCardExpanded(job.id)}
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

// Status bullet component for production card header
function StatusBullet({
  status,
  disabled,
  onChange,
}: {
  status: "queued" | "in_progress" | "done";
  disabled: boolean;
  onChange: (status: "queued" | "in_progress" | "done") => void;
}) {
  const [open, setOpen] = useState(false);
  const colors = statusColors[status];
  
  const statusLabels = {
    queued: "Queued",
    in_progress: "In Progress",
    done: "Done",
  };
  
  // Map current status to display label
  const getCurrentLabel = () => {
    if (status === "queued") return "Queued";
    if (status === "done") return "Production Complete";
    // For in_progress, we don't have stepKey here, so show generic label
    return "In Progress";
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        disabled={disabled}
        data-no-dnd="true"
        onPointerDownCapture={(e) => e.stopPropagation()}
        onMouseDownCapture={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10px] font-semibold transition-all cursor-pointer",
          "bg-muted/30 hover:bg-muted/50 border border-border/40",
          "shadow-sm hover:shadow-md",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <div className={cn("w-2 h-2 rounded-full shadow-sm", colors.dot)} />
        <span className={colors.label}>{getCurrentLabel()}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-40">
        <DropdownMenuItem
          onClick={() => {
            onChange("queued");
            setOpen(false);
          }}
          className="text-xs"
        >
          <div className={cn("w-1.5 h-1.5 rounded-full mr-2", statusColors.queued.dot)} />
          Queued
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            onChange("in_progress");
            setOpen(false);
          }}
          className="text-xs"
        >
          <div className={cn("w-1.5 h-1.5 rounded-full mr-2", statusColors.in_progress.dot)} />
          Prepress
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            onChange("in_progress");
            setOpen(false);
          }}
          className="text-xs"
        >
          <div className={cn("w-1.5 h-1.5 rounded-full mr-2", statusColors.in_progress.dot)} />
          Printing
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            onChange("in_progress");
            setOpen(false);
          }}
          className="text-xs"
        >
          <div className={cn("w-1.5 h-1.5 rounded-full mr-2", statusColors.in_progress.dot)} />
          Finishing
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            onChange("in_progress");
            setOpen(false);
          }}
          className="text-xs"
        >
          <div className={cn("w-1.5 h-1.5 rounded-full mr-2", statusColors.in_progress.dot)} />
          Fulfillment
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            onChange("done");
            setOpen(false);
          }}
          className="text-xs"
        >
          <div className={cn("w-1.5 h-1.5 rounded-full mr-2", statusColors.done.dot)} />
          Production Complete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Job card component for Kanban board
function JobCard({ 
  job, 
  boardCardConfig,
  onArtworkClick,
  isDragOverlay = false,
  isExpanded = true,
  toggleExpanded,
}: { 
  job: ProductionJobListItem; 
  boardCardConfig: BoardCardConfig;
  onArtworkClick: (job: ProductionJobListItem) => void;
  isDragOverlay?: boolean;
  isExpanded?: boolean;
  toggleExpanded?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: job.id,
  });
  const navigate = useNavigate();
  const updateStatus = useUpdateProductionJobStatus(job.id);
  const sides = job.sides || "single";
  const urgency = computeUrgency(job.order.dueDate);
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
      {...attributes}
      {...listeners}
      className={cn(
        "relative cursor-grab active:cursor-grabbing",
        "hover:shadow-md transition-all",
        (isDragging && !isDragOverlay) && "opacity-50",
        isDragOverlay && "shadow-lg rotate-3",
        // Urgency styling
        urgency === 'overdue' && cn(productionCardTheme.overdue.outline, "shadow-lg", productionCardTheme.overdue.glow),
        urgency === 'due_today' && cn(productionCardTheme.dueToday.outline, "shadow-lg", productionCardTheme.dueToday.glow),
      )}
    >
      <CardContent className="p-5 space-y-3">
        {/* Header Row: Customer | Status Bullet | Order # | Expand/Collapse */}
        <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-3">
          {/* Left: Customer */}
          {boardCardConfig.customer && (
            <div className="justify-self-start min-w-0" data-no-dnd="true">
              {customerId ? (
                <Link
                  to={ROUTES.customers.detail(customerId)}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline inline-flex max-w-full truncate uppercase tracking-wide"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDownCapture={(e) => e.stopPropagation()}
                  onMouseDownCapture={(e) => e.stopPropagation()}
                >
                  {job.order.customerName}
                </Link>
              ) : (
                <span className="text-xs font-semibold truncate block uppercase tracking-wide">
                  {job.order.customerName}
                </span>
              )}
            </div>
          )}

          {/* Center: Status Bullet */}
          {boardCardConfig.status && (
            <div className="justify-self-center">
              <StatusBullet
                status={job.status}
                disabled={updateStatus.isPending || isDragOverlay}
                onChange={(nextStatus) => {
                  if (nextStatus !== job.status) {
                    updateStatus.mutate(nextStatus);
                  }
                }}
              />
            </div>
          )}

          {/* Right: Order # */}
          {boardCardConfig.orderNumber && orderId && (
            <div className="justify-self-end" data-no-dnd="true">
              <Link
                to={ROUTES.orders.detail(orderId)}
                className="text-xs text-muted-foreground hover:text-foreground hover:underline shrink-0 font-medium"
                onClick={(e) => e.stopPropagation()}
                onPointerDownCapture={(e) => e.stopPropagation()}
                onMouseDownCapture={(e) => e.stopPropagation()}
              >
                #{job.order.orderNumber}
              </Link>
            </div>
          )}

          {/* Expand/Collapse Button */}
          {toggleExpanded && (
            <div className="justify-self-end" data-no-dnd="true">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpanded();
                }}
                onPointerDownCapture={(e) => e.stopPropagation()}
                onMouseDownCapture={(e) => e.stopPropagation()}
              >
                {isExpanded ? (
                  <ChevronsUpDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronsUpDown className="w-3.5 h-3.5" />
                )}
              </Button>
            </div>
          )}
        </div>

        {/* Collapsed View */}
        {!isExpanded && (
          <>
            {/* Title */}
            {boardCardConfig.jobDescription && (
              <div className="text-sm font-medium truncate">
                {job.jobDescription || "Untitled Job"}
              </div>
            )}
            {/* Material + Due Date compact row */}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{job.media || "—"}</span>
              {job.order.dueDate ? (
                <span className={cn(
                  "font-medium",
                  urgency === 'overdue' && "text-red-500",
                  urgency === 'due_today' && "text-amber-500"
                )}>
                  {format(parseISO(job.order.dueDate), "MMM d")}
                </span>
              ) : (
                <span>—</span>
              )}
            </div>
          </>
        )}

        {/* Expanded View */}
        {isExpanded && (
          <>
            {/* Title: Job Description */}
            {boardCardConfig.jobDescription && (
              <h3 
                className="text-lg font-semibold leading-tight cursor-pointer"
                onClick={handleCardClick}
              >
                {job.jobDescription || "Untitled Job"}
          </h3>
        )}

        {/* Metadata Grid: 2 columns */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          {/* Material */}
          {boardCardConfig.media && (
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Material
              </div>
              <div className="text-sm font-medium">
                {job.media || "—"}
              </div>
            </div>
          )}

          {/* Quantity */}
          {boardCardConfig.qty && (
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Quantity
              </div>
              <div className="text-sm font-medium">
                {job.qty ? `${job.qty} Units` : "—"}
              </div>
            </div>
          )}

          {/* Machine/Station */}
          {boardCardConfig.station && job.stationKey && (
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Machine
              </div>
              <div className="text-sm font-medium flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                <span className="capitalize">{job.stationKey}</span>
              </div>
            </div>
          )}

          {/* Due Date - Always show with fallback */}
          {boardCardConfig.dueDate && (
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Due Date
              </div>
              {job.order.dueDate ? (
                <div className={cn(
                  "text-sm font-semibold",
                  urgency === 'overdue' && "text-red-500",
                  urgency === 'due_today' && "text-amber-500",
                  urgency === 'normal' && "text-foreground"
                )}>
                  {format(parseISO(job.order.dueDate), "EEEE, h:mmaaa").replace("AM", "AM").replace("PM", "PM")}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  —
                </div>
              )}
            </div>
          )}
        </div>

        {/* Thumbnail + Badges Row */}
        <div className="flex items-center gap-2">
          {/* Thumbnail */}
          <button
            type="button"
            data-no-dnd="true"
            onClick={(e) => {
              e.stopPropagation();
              onArtworkClick(job);
            }}
            onPointerDownCapture={(e) => e.stopPropagation()}
            onMouseDownCapture={(e) => e.stopPropagation()}
            className="shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
          >
            <ThumbnailGroup job={job} sides={sides} />
          </button>

          {/* Badges */}
          <div className="flex items-center flex-wrap gap-1.5">
            {boardCardConfig.sides && (
              <Badge variant="outline" className="text-[10px] px-2 py-0.5 font-semibold uppercase">
                {sides.toLowerCase().includes("double") ? "Double Side" : "Single Side"}
              </Badge>
            )}
            {urgency === 'overdue' && (
              <Badge variant="destructive" className="text-[10px] px-2 py-0.5 font-semibold uppercase">
                Overdue
              </Badge>
            )}
            {urgency === 'due_today' && (
              <Badge variant="default" className="text-[10px] px-2 py-0.5 font-semibold uppercase bg-amber-500">
                Due Today
              </Badge>
            )}
            {/* Show PRIORITY badge for demo - can be made conditional later */}
            <Badge variant="default" className="text-[10px] px-2 py-0.5 font-semibold uppercase bg-blue-600">
              Priority
            </Badge>
          </div>
        </div>
          </>
        )}
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
      <div className="w-12 h-12 rounded border border-dashed border-muted-foreground/30 bg-muted/20 flex items-center justify-center">
        <FileText className="w-4 h-4 text-muted-foreground/50" />
      </div>
    );
  }

  return (
    <div className="w-12 h-12 rounded border border-border overflow-hidden bg-muted">
      <img
        src={src}
        alt={alt}
        className="w-full h-full object-cover"
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
