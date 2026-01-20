import { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { LayoutGrid, List, FileText, ArrowUp, ArrowDown, Settings2, GripVertical, ChevronsUpDown } from "lucide-react";
import { useProductionJobs, type ProductionJobListItem } from "@/hooks/useProduction";
import { format, isPast, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

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

      {/* Board view */}
      {viewMode === "board" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {KANBAN_COLUMNS.map(column => {
            const columnJobs = jobsByStatus.get(column.status) ?? [];
            return (
              <Card key={column.id} className="flex flex-col">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center justify-between">
                    <span>{column.label}</span>
                    <Badge variant="secondary" className="ml-2">
                      {columnJobs.length}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 space-y-2 pt-0">
                  {columnJobs.length === 0 ? (
                    <div className="text-xs text-muted-foreground text-center py-4">
                      No jobs
                    </div>
                  ) : (
                    columnJobs.map(job => <JobCard key={job.id} job={job} />)
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
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
                    <JobRow key={job.id} job={job} visibleColumns={visibleColumns} />
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
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
function JobCard({ job }: { job: ProductionJobListItem }) {
  const navigate = useNavigate();
  const sides = job.sides || "single";
  const isDueOverdue = job.order.dueDate ? isPast(parseISO(job.order.dueDate)) : false;

  const handleClick = () => {
    navigate(`/production/jobs/${job.id}`);
  };

  return (
    <Card 
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={handleClick}
    >
      <CardContent className="p-3 space-y-2">
        {/* Top row: customer + due date */}
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-medium truncate flex-1">
            {job.order.customerName}
          </span>
          {job.order.dueDate && (
            <Badge 
              variant={isDueOverdue ? "destructive" : "secondary"}
              className="text-[10px] px-1.5 py-0.5 shrink-0"
            >
              {format(parseISO(job.order.dueDate), "MMM d")}
            </Badge>
          )}
        </div>

        {/* Middle: thumbnails + job number */}
        <div className="flex items-center gap-2">
          <ThumbnailGroup job={job} sides={sides} />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground truncate">
              {job.order.orderNumber}
            </div>
          </div>
        </div>

        {/* Bottom: media + sides + status */}
        <div className="flex items-center justify-between gap-2 text-[10px]">
          <span className="text-muted-foreground truncate flex-1">
            {job.media || "—"}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
              {sides.toLowerCase().includes("double") ? "DS" : "SS"}
            </Badge>
            <Badge 
              variant={job.status === "done" ? "default" : "secondary"}
              className="text-[10px] px-1.5 py-0.5"
            >
              {job.status === "in_progress" ? "Printing" : job.status}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Job row component for list view
function JobRow({ job, visibleColumns }: { job: ProductionJobListItem; visibleColumns: ColumnConfig[] }) {
  const navigate = useNavigate();
  const sides = job.sides || "single";
  const isDueOverdue = job.order.dueDate ? isPast(parseISO(job.order.dueDate)) : false;

  const handleClick = () => {
    navigate(`/production/jobs/${job.id}`);
  };

  const getCellContent = (colId: ColumnId) => {
    switch (colId) {
      case "artwork":
        return <ThumbnailGroup job={job} sides={sides} />;
      
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
        return <span className="font-medium text-sm">{job.order.customerName}</span>;
      
      case "orderNumber":
        return <span className="text-sm text-muted-foreground">{job.order.orderNumber}</span>;
      
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
          <Badge 
            variant={job.status === "done" ? "default" : "secondary"}
            className="text-xs"
          >
            {job.status === "in_progress" ? "Printing" : job.status}
          </Badge>
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
      <div className="w-8 h-8 rounded border border-dashed border-muted-foreground/30 bg-muted/20 flex items-center justify-center">
        <FileText className="w-3 h-3 text-muted-foreground/50" />
      </div>
    );
  }

  return (
    <div className="w-8 h-8 rounded border border-border overflow-hidden bg-muted">
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
    <div className="flex items-center gap-1">
      <PreviewThumb src={front} alt={`Job ${job.id} front preview`} />
      {isDoubleSided && <PreviewThumb src={back} alt={`Job ${job.id} back preview`} />}
    </div>
  );
}
