import { useMemo, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Bug,
  ClipboardList,
  FileUp,
  Kanban,
  LayoutDashboard,
  ListFilter,
  Map as MapIcon,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Upload,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { canUseProductPlanning } from "@/lib/productPlanningAccess";
import { movePlanningItem, sortPlanningItems, toSequentialPlanningOrder } from "@/lib/productPlanningBoard";
import { apiRequest } from "@/lib/queryClient";
import { ROUTES } from "@/config/routes";

type WorkItemType = "bug" | "feature" | "enhancement" | "epic" | "task" | "technical_debt" | "research";
type PlanningStatus = "idea" | "backlog" | "planned" | "ready" | "in_progress" | "testing" | "dev_validation" | "main_validation" | "released" | "archived";
type Priority = "critical" | "high" | "medium" | "low";
type BusinessValue = "very_high" | "high" | "medium" | "low";
type Complexity = "small" | "medium" | "large" | "massive";
type Phase = "go_live" | "v1_1" | "v1_5" | "v2_0" | "future" | "research";
type SourceType = "manual" | "csv_import" | "bug_report";

type WorkItemSummary = {
  id: string;
  reference: string;
  title: string;
  workItemType: WorkItemType;
  planningStatus: PlanningStatus;
  priority?: Priority;
};

type WorkItem = {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  workItemType: WorkItemType;
  planningStatus: PlanningStatus;
  priority: Priority;
  businessValue: BusinessValue | null;
  complexity: Complexity | null;
  phase: Phase | null;
  module: string | null;
  submodule: string | null;
  tags: string[];
  sortOrder: number | null;
  roadmapOrder: number | null;
  sourceType: SourceType | null;
  sourceBugReportId: string | null;
  sourceReference: string | null;
  parentId: string | null;
  parent?: WorkItemSummary | null;
  children?: WorkItemSummary[];
  requestedBy: string | null;
  ownerUserId: string | null;
  dueDate: string | null;
  releaseTarget: string | null;
  notes: string | null;
  updatedAt: string;
  createdAt: string;
  archivedAt: string | null;
};

type DashboardData = {
  totalBacklogCount: number;
  criticalOpenBugCount: number;
  highOpenBugCount: number;
  openBugCount: number;
  itemsInTesting: number;
  itemsInDevValidation: number;
  itemsInMainValidation: number;
  topPrioritizedFeatures: WorkItem[];
  majorBugs: WorkItem[];
  byStatus: Array<{ key: string; count: number }>;
  byPhase: Array<{ key: string | null; count: number }>;
  byModule: Array<{ key: string | null; count: number }>;
};

type ImportPreview = {
  mappedRows: Array<{
    rowNumber: number;
    title: string;
    module: string | null;
    priority: Priority;
    planningStatus: PlanningStatus;
    phase: Phase | null;
    sourceReference: string | null;
    warnings: string[];
    errors: string[];
  }>;
  duplicateWarnings: Array<{ rowNumber: number; message: string; existingReference?: string }>;
  counts: { parsed: number; valid: number; invalid: number; warnings: number };
};

type ImportBatch = {
  id: string;
  filename: string | null;
  rowCount: number;
  importedCount: number;
  skippedCount: number;
  errorCount: number;
  status: string;
  createdAt: string;
};

const WORK_ITEM_TYPES: Array<{ value: WorkItemType; label: string }> = [
  { value: "bug", label: "Bug" },
  { value: "feature", label: "Feature" },
  { value: "enhancement", label: "Enhancement" },
  { value: "epic", label: "Epic" },
  { value: "task", label: "Task" },
  { value: "technical_debt", label: "Technical Debt" },
  { value: "research", label: "Research" },
];

const STATUSES: Array<{ value: PlanningStatus; label: string }> = [
  { value: "idea", label: "Idea" },
  { value: "backlog", label: "Backlog" },
  { value: "planned", label: "Planned" },
  { value: "ready", label: "Ready" },
  { value: "in_progress", label: "In Progress" },
  { value: "testing", label: "Testing" },
  { value: "dev_validation", label: "DEV Validation" },
  { value: "main_validation", label: "MAIN Validation" },
  { value: "released", label: "Released" },
  { value: "archived", label: "Archived" },
];

const PRIORITIES: Array<{ value: Priority; label: string }> = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const PHASES: Array<{ value: Phase; label: string }> = [
  { value: "go_live", label: "Go Live" },
  { value: "v1_1", label: "Version 1.1" },
  { value: "v1_5", label: "Version 1.5" },
  { value: "v2_0", label: "Version 2.0" },
  { value: "future", label: "Future" },
  { value: "research", label: "Research" },
];

const KANBAN_STATUSES = STATUSES.filter((status) => status.value !== "archived");

const BUSINESS_VALUES: Array<{ value: BusinessValue; label: string }> = [
  { value: "very_high", label: "Very High" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const COMPLEXITIES: Array<{ value: Complexity; label: string }> = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
  { value: "massive", label: "Massive" },
];

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "include" });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message || "Request failed");
  return json.data as T;
}

function labelFor<T extends string>(options: Array<{ value: T; label: string }>, value: T | null | undefined): string {
  if (!value) return "";
  return options.find((option) => option.value === value)?.label ?? value;
}

function normalizeOptional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function priorityBadge(priority: Priority) {
  if (priority === "critical") return "destructive";
  if (priority === "high") return "default";
  return "secondary";
}

function ProductPlanningShell({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  const activePath = location.pathname;

  if (isLoading) return <div className="p-6"><Skeleton className="h-8 w-64" /></div>;
  if (!canUseProductPlanning(user)) {
    return <div className="p-6 text-sm text-muted-foreground">Access denied. Product Planning requires developer or admin access.</div>;
  }

  const tabs = [
    { path: ROUTES.productPlanning.dashboard, label: "Dashboard", icon: LayoutDashboard },
    { path: ROUTES.productPlanning.backlog, label: "Backlog", icon: ClipboardList },
    { path: ROUTES.productPlanning.kanban, label: "Kanban", icon: Kanban },
    { path: ROUTES.productPlanning.roadmap, label: "Roadmap", icon: MapIcon },
    { path: ROUTES.productPlanning.imports, label: "Imports", icon: FileUp },
  ];

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Product Planning</h1>
          <p className="text-sm text-muted-foreground">Internal planning backlog for bugs, feature ideas, enhancements, and imports</p>
        </div>
        <div className="flex items-center gap-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activePath === tab.path;
            return (
              <Link key={tab.path} to={tab.path}>
                <Button variant={active ? "default" : "outline"} size="sm" className="gap-2">
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </Button>
              </Link>
            );
          })}
        </div>
      </div>
      {children}
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase text-muted-foreground">{title}</div>
        <div className="mt-2 text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function CompactItemList({ title, items, icon }: { title: string; items: WorkItem[]; icon: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No items yet.</p>
        ) : items.map((item) => (
          <Link key={item.id} to={ROUTES.productPlanning.backlog} className="block rounded-md border border-border p-3 hover:bg-muted/40">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-xs text-muted-foreground">{item.reference}</div>
                <div className="truncate text-sm font-medium">{item.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{item.module || "No module"} {item.phase ? `- ${labelFor(PHASES, item.phase)}` : ""}</div>
              </div>
              <Badge variant={priorityBadge(item.priority)} className="shrink-0 capitalize">{item.priority}</Badge>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

export function ProductPlanningDashboardPage() {
  const { data, isLoading, refetch, isRefetching } = useQuery<DashboardData>({
    queryKey: ["/api/product-planning/dashboard"],
    queryFn: () => fetchJson<DashboardData>("/api/product-planning/dashboard"),
  });

  return (
    <ProductPlanningShell>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
      {isLoading || !data ? (
        <div className="grid gap-3 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-24" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard title="Total backlog" value={data.totalBacklogCount} />
            <StatCard title="Critical bugs" value={data.criticalOpenBugCount} />
            <StatCard title="High bugs" value={data.highOpenBugCount} />
            <StatCard title="Testing" value={data.itemsInTesting} />
            <StatCard title="DEV validation" value={data.itemsInDevValidation} />
            <StatCard title="MAIN validation" value={data.itemsInMainValidation} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <CompactItemList title="Major Bugs" items={data.majorBugs} icon={<Bug className="h-4 w-4 text-destructive" />} />
            <CompactItemList title="Prioritized Features" items={data.topPrioritizedFeatures} icon={<ClipboardList className="h-4 w-4 text-primary" />} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <SummaryBreakdown title="By Status" rows={data.byStatus} />
            <SummaryBreakdown title="By Phase" rows={data.byPhase.map((row) => ({ ...row, key: labelFor(PHASES, row.key as Phase | null) || "Unassigned" }))} />
            <SummaryBreakdown title="By Module" rows={data.byModule.map((row) => ({ ...row, key: row.key || "Unassigned" }))} />
          </div>
        </>
      )}
    </ProductPlanningShell>
  );
}

function SummaryBreakdown({ title, rows }: { title: string; rows: Array<{ key: string | null; count: number }> }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">No data.</p> : rows.map((row) => (
          <div key={row.key || "none"} className="flex items-center justify-between text-sm">
            <span className="truncate">{row.key || "Unassigned"}</span>
            <Badge variant="secondary">{row.count}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

type WorkItemFormState = {
  id?: string;
  title: string;
  description: string;
  workItemType: WorkItemType;
  planningStatus: PlanningStatus;
  priority: Priority;
  businessValue: BusinessValue | "";
  complexity: Complexity | "";
  phase: Phase | "";
  module: string;
  submodule: string;
  parentId: string;
  tags: string;
  requestedBy: string;
  ownerUserId: string;
  dueDate: string;
  releaseTarget: string;
  notes: string;
};

const EMPTY_FORM: WorkItemFormState = {
  title: "",
  description: "",
  workItemType: "feature",
  planningStatus: "backlog",
  priority: "medium",
  businessValue: "",
  complexity: "",
  phase: "",
  module: "",
  submodule: "",
  parentId: "",
  tags: "",
  requestedBy: "",
  ownerUserId: "",
  dueDate: "",
  releaseTarget: "",
  notes: "",
};

function formFromItem(item: WorkItem): WorkItemFormState {
  return {
    id: item.id,
    title: item.title,
    description: item.description ?? "",
    workItemType: item.workItemType,
    planningStatus: item.planningStatus,
    priority: item.priority,
    businessValue: item.businessValue ?? "",
    complexity: item.complexity ?? "",
    phase: item.phase ?? "",
    module: item.module ?? "",
    submodule: item.submodule ?? "",
    parentId: item.parentId ?? "",
    tags: item.tags?.join(", ") ?? "",
    requestedBy: item.requestedBy ?? "",
    ownerUserId: item.ownerUserId ?? "",
    dueDate: item.dueDate ?? "",
    releaseTarget: item.releaseTarget ?? "",
    notes: item.notes ?? "",
  };
}

function payloadFromForm(form: WorkItemFormState) {
  return {
    title: form.title,
    description: normalizeOptional(form.description),
    workItemType: form.workItemType,
    planningStatus: form.planningStatus,
    priority: form.priority,
    businessValue: form.businessValue || null,
    complexity: form.complexity || null,
    phase: form.phase || null,
    module: normalizeOptional(form.module),
    submodule: normalizeOptional(form.submodule),
    parentId: normalizeOptional(form.parentId),
    tags: form.tags.split(/[;,]/).map((tag) => tag.trim()).filter(Boolean),
    requestedBy: normalizeOptional(form.requestedBy),
    ownerUserId: normalizeOptional(form.ownerUserId),
    dueDate: normalizeOptional(form.dueDate),
    releaseTarget: normalizeOptional(form.releaseTarget),
    notes: normalizeOptional(form.notes),
  };
}

export function ProductPlanningBacklogPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({
    search: "",
    workItemType: "all",
    planningStatus: "all",
    priority: "all",
    module: "",
    phase: "all",
    sourceType: "all",
    sortBy: "updatedAt",
    sortDirection: "desc",
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<WorkItemFormState>(EMPTY_FORM);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (!value || value === "all") return;
      params.set(key, value);
    });
    return params.toString();
  }, [filters]);

  const { data: rows = [], isLoading } = useQuery<WorkItem[]>({
    queryKey: ["/api/product-planning/work-items", queryString],
    queryFn: () => fetchJson<WorkItem[]>(`/api/product-planning/work-items?${queryString}`),
  });
  const parentById = useMemo(() => new Map(rows.map((item) => [item.id, item])), [rows]);

  const saveMutation = useMutation({
    mutationFn: async (next: WorkItemFormState) => {
      const payload = payloadFromForm(next);
      if (next.id) {
        const res = await apiRequest("PATCH", `/api/product-planning/work-items/${next.id}`, payload);
        return (await res.json()).data as WorkItem;
      }
      const res = await apiRequest("POST", "/api/product-planning/work-items", payload);
      return (await res.json()).data as WorkItem;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/product-planning/work-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/product-planning/dashboard"] });
      setModalOpen(false);
      setForm(EMPTY_FORM);
      toast({ title: "Work item saved" });
    },
    onError: (error: Error) => toast({ title: "Save failed", description: error.message, variant: "destructive" }),
  });

  const quickUpdateMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<WorkItem> }) => {
      const res = await apiRequest("PATCH", `/api/product-planning/work-items/${id}`, patch);
      return (await res.json()).data as WorkItem;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/product-planning/work-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/product-planning/dashboard"] });
    },
    onError: (error: Error) => toast({ title: "Update failed", description: error.message, variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/product-planning/work-items/${id}/archive`, {});
      return (await res.json()).data as WorkItem;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/product-planning/work-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/product-planning/dashboard"] });
      toast({ title: "Work item archived" });
    },
    onError: (error: Error) => toast({ title: "Archive failed", description: error.message, variant: "destructive" }),
  });

  return (
    <ProductPlanningShell>
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
            <ListFilter className="h-4 w-4" />
            Filters
          </div>
          <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Search" className="h-9 xl:col-span-2" />
            <FilterSelect value={filters.workItemType} onChange={(value) => setFilters({ ...filters, workItemType: value })} options={WORK_ITEM_TYPES} placeholder="Type" />
            <FilterSelect value={filters.planningStatus} onChange={(value) => setFilters({ ...filters, planningStatus: value })} options={STATUSES} placeholder="Status" />
            <FilterSelect value={filters.priority} onChange={(value) => setFilters({ ...filters, priority: value })} options={PRIORITIES} placeholder="Priority" />
            <Input value={filters.module} onChange={(event) => setFilters({ ...filters, module: event.target.value })} placeholder="Module" className="h-9" />
            <FilterSelect value={filters.phase} onChange={(value) => setFilters({ ...filters, phase: value })} options={PHASES} placeholder="Phase" />
            <Select value={filters.sourceType} onValueChange={(value) => setFilters({ ...filters, sourceType: value })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="csv_import">CSV Import</SelectItem>
                <SelectItem value="bug_report">Bug Report</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Select value={filters.sortBy} onValueChange={(value) => setFilters({ ...filters, sortBy: value })}>
                <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="reference">Reference</SelectItem>
                  <SelectItem value="priority">Priority</SelectItem>
                  <SelectItem value="createdAt">Created date</SelectItem>
                  <SelectItem value="updatedAt">Updated date</SelectItem>
                  <SelectItem value="module">Module</SelectItem>
                  <SelectItem value="phase">Phase</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filters.sortDirection} onValueChange={(value) => setFilters({ ...filters, sortDirection: value })}>
                <SelectTrigger className="h-9 w-[110px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="asc">Asc</SelectItem>
                  <SelectItem value="desc">Desc</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" className="gap-2" onClick={() => { setForm(EMPTY_FORM); setModalOpen(true); }}>
              <Plus className="h-4 w-4" />
              New Work Item
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead className="min-w-[280px]">Title</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Module</TableHead>
                <TableHead>Phase</TableHead>
                <TableHead>Epic</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? Array.from({ length: 6 }).map((_, index) => (
                <TableRow key={index}><TableCell colSpan={12}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
              )) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={12} className="py-8 text-center text-sm text-muted-foreground">No planning work items found.</TableCell></TableRow>
              ) : rows.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-xs font-semibold">{item.reference}</TableCell>
                  <TableCell>
                    <div className="max-w-[360px] truncate text-sm font-medium">{item.title}</div>
                    {item.sourceReference && <div className="text-xs text-muted-foreground">{item.sourceReference}</div>}
                  </TableCell>
                  <TableCell><Badge variant="outline">{labelFor(WORK_ITEM_TYPES, item.workItemType)}</Badge></TableCell>
                  <TableCell>
                    <InlineSelect value={item.planningStatus} options={STATUSES} onChange={(value) => quickUpdateMutation.mutate({ id: item.id, patch: { planningStatus: value as PlanningStatus } })} />
                  </TableCell>
                  <TableCell>
                    <InlineSelect value={item.priority} options={PRIORITIES} onChange={(value) => quickUpdateMutation.mutate({ id: item.id, patch: { priority: value as Priority } })} />
                  </TableCell>
                  <TableCell>
                    <Input
                      defaultValue={item.module ?? ""}
                      onBlur={(event) => {
                        const next = normalizeOptional(event.target.value);
                        if (next !== item.module) quickUpdateMutation.mutate({ id: item.id, patch: { module: next } });
                      }}
                      className="h-8 w-[140px]"
                    />
                  </TableCell>
                  <TableCell>
                    <InlineSelect value={item.phase ?? ""} includeNone options={PHASES} onChange={(value) => quickUpdateMutation.mutate({ id: item.id, patch: { phase: (value || null) as Phase | null } })} />
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground">
                    {item.parentId ? (parentById.get(item.parentId)?.reference ?? "Linked epic") : ""}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{item.sourceType ? item.sourceType.replace("_", " ") : "manual"}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{format(new Date(item.updatedAt), "MMM d, yyyy")}</TableCell>
                  <TableCell className="max-w-[120px] truncate text-xs text-muted-foreground">{item.ownerUserId || ""}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" title="Edit" onClick={() => { setForm(formFromItem(item)); setModalOpen(true); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Archive" onClick={() => archiveMutation.mutate(item.id)}>
                        <Archive className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <WorkItemDialog
        open={modalOpen}
        form={form}
        setForm={setForm}
        availableParents={rows.filter((item) => item.workItemType === "epic" && item.id !== form.id)}
        children={form.id ? rows.filter((item) => item.parentId === form.id) : []}
        onOpenChange={setModalOpen}
        onSave={() => saveMutation.mutate(form)}
        isSaving={saveMutation.isPending}
      />
    </ProductPlanningShell>
  );
}

function PlanningItemCard({
  item,
  compact,
  children,
}: {
  item: WorkItem;
  compact?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-xs text-muted-foreground">{item.reference}</div>
          <div className="line-clamp-2 text-sm font-medium">{item.title}</div>
        </div>
        <Badge variant={priorityBadge(item.priority)} className="shrink-0 capitalize">{item.priority}</Badge>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <Badge variant="outline" className="text-[11px]">{labelFor(WORK_ITEM_TYPES, item.workItemType)}</Badge>
        {item.module && <Badge variant="secondary" className="text-[11px]">{item.module}</Badge>}
        {item.phase && <Badge variant="secondary" className="text-[11px]">{labelFor(PHASES, item.phase)}</Badge>}
        {item.sourceType && item.sourceType !== "manual" && <Badge variant="outline" className="text-[11px]">{item.sourceType.replace("_", " ")}</Badge>}
      </div>
      {!compact && children && <div className="mt-3">{children}</div>}
    </div>
  );
}

function sortByBoardOrder(items: WorkItem[]) {
  return sortPlanningItems(items, "sortOrder");
}

function sortByRoadmapOrder(items: WorkItem[]) {
  return sortPlanningItems(items, "roadmapOrder");
}

export function ProductPlanningKanbanPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: rows = [], isLoading } = useQuery<WorkItem[]>({
    queryKey: ["/api/product-planning/work-items", "kanban"],
    queryFn: () => fetchJson<WorkItem[]>("/api/product-planning/work-items?sortBy=sortOrder&sortDirection=asc&limit=250"),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/product-planning/work-items"] });
    queryClient.invalidateQueries({ queryKey: ["/api/product-planning/dashboard"] });
  };

  const moveStatusMutation = useMutation({
    mutationFn: async ({ item, planningStatus }: { item: WorkItem; planningStatus: PlanningStatus }) => {
      const targetCount = rows.filter((row) => row.planningStatus === planningStatus && row.id !== item.id).length;
      const res = await apiRequest("POST", `/api/product-planning/work-items/${item.id}/move-status`, {
        planningStatus,
        sortOrder: (targetCount + 1) * 10,
      });
      return (await res.json()).data as WorkItem;
    },
    onSuccess: invalidate,
    onError: (error: Error) => toast({ title: "Move failed", description: error.message, variant: "destructive" }),
  });

  const reorderMutation = useMutation({
    mutationFn: async ({ items }: { items: Array<{ id: string; sortOrder: number; planningStatus: PlanningStatus }> }) => {
      const res = await apiRequest("POST", "/api/product-planning/work-items/reorder", { items });
      return (await res.json()).data as WorkItem[];
    },
    onSuccess: invalidate,
    onError: (error: Error) => toast({ title: "Reorder failed", description: error.message, variant: "destructive" }),
  });

  function moveWithinColumn(status: PlanningStatus, itemId: string, direction: -1 | 1) {
    const items = sortByBoardOrder(rows.filter((item) => item.planningStatus === status));
    const index = items.findIndex((item) => item.id === itemId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return;
    const next = movePlanningItem(items, itemId, direction);
    reorderMutation.mutate({
      items: toSequentialPlanningOrder(next, "sortOrder").map((item) => ({
        ...item,
        planningStatus: status,
      })),
    });
  }

  return (
    <ProductPlanningShell>
      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[1320px] grid-cols-9 gap-3">
          {KANBAN_STATUSES.map((status) => {
            const items = sortByBoardOrder(rows.filter((item) => item.planningStatus === status.value));
            return (
              <section key={status.value} className="min-h-[520px] rounded-md border border-border bg-muted/20">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <h2 className="text-sm font-semibold">{status.label}</h2>
                  <Badge variant="secondary">{items.length}</Badge>
                </div>
                <div className="space-y-2 p-2">
                  {isLoading ? (
                    Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-28 w-full" />)
                  ) : items.length === 0 ? (
                    <p className="py-6 text-center text-xs text-muted-foreground">No items</p>
                  ) : items.map((item, index) => (
                    <PlanningItemCard key={item.id} item={item}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex gap-1">
                          <Button variant="outline" size="icon" className="h-7 w-7" disabled={index === 0} onClick={() => moveWithinColumn(status.value, item.id, -1)}>
                            <ArrowUp className="h-3 w-3" />
                          </Button>
                          <Button variant="outline" size="icon" className="h-7 w-7" disabled={index === items.length - 1} onClick={() => moveWithinColumn(status.value, item.id, 1)}>
                            <ArrowDown className="h-3 w-3" />
                          </Button>
                        </div>
                        <Select value={item.planningStatus} onValueChange={(value) => moveStatusMutation.mutate({ item, planningStatus: value as PlanningStatus })}>
                          <SelectTrigger className="h-7 w-[116px] text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {KANBAN_STATUSES.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </PlanningItemCard>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </ProductPlanningShell>
  );
}

export function ProductPlanningRoadmapPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({
    workItemType: "all",
    priority: "all",
    planningStatus: "all",
    module: "",
  });
  const queryString = useMemo(() => {
    const params = new URLSearchParams({ sortBy: "roadmapOrder", sortDirection: "asc", limit: "250" });
    Object.entries(filters).forEach(([key, value]) => {
      if (!value || value === "all") return;
      params.set(key, value);
    });
    return params.toString();
  }, [filters]);

  const { data: rows = [], isLoading } = useQuery<WorkItem[]>({
    queryKey: ["/api/product-planning/work-items", "roadmap", queryString],
    queryFn: () => fetchJson<WorkItem[]>(`/api/product-planning/work-items?${queryString}`),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/product-planning/work-items"] });
    queryClient.invalidateQueries({ queryKey: ["/api/product-planning/dashboard"] });
  };

  const movePhaseMutation = useMutation({
    mutationFn: async ({ item, phase }: { item: WorkItem; phase: Phase | null }) => {
      const targetCount = rows.filter((row) => row.phase === phase && row.id !== item.id).length;
      const res = await apiRequest("POST", `/api/product-planning/work-items/${item.id}/move-phase`, {
        phase,
        roadmapOrder: (targetCount + 1) * 10,
      });
      return (await res.json()).data as WorkItem;
    },
    onSuccess: invalidate,
    onError: (error: Error) => toast({ title: "Phase move failed", description: error.message, variant: "destructive" }),
  });

  const reorderMutation = useMutation({
    mutationFn: async ({ items }: { items: Array<{ id: string; roadmapOrder: number; phase: Phase | null }> }) => {
      const res = await apiRequest("POST", "/api/product-planning/work-items/reorder", { items });
      return (await res.json()).data as WorkItem[];
    },
    onSuccess: invalidate,
    onError: (error: Error) => toast({ title: "Roadmap reorder failed", description: error.message, variant: "destructive" }),
  });

  function moveWithinPhase(phase: Phase | null, itemId: string, direction: -1 | 1) {
    const items = sortByRoadmapOrder(rows.filter((item) => item.phase === phase));
    const index = items.findIndex((item) => item.id === itemId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return;
    const next = movePlanningItem(items, itemId, direction);
    reorderMutation.mutate({
      items: toSequentialPlanningOrder(next, "roadmapOrder").map((item) => ({
        ...item,
        phase,
      })),
    });
  }

  const groups: Array<{ value: Phase | null; label: string }> = [...PHASES, { value: null, label: "Unassigned" }];

  return (
    <ProductPlanningShell>
      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-4">
          <FilterSelect value={filters.workItemType} onChange={(value) => setFilters({ ...filters, workItemType: value })} options={WORK_ITEM_TYPES} placeholder="Type" />
          <FilterSelect value={filters.priority} onChange={(value) => setFilters({ ...filters, priority: value })} options={PRIORITIES} placeholder="Priority" />
          <FilterSelect value={filters.planningStatus} onChange={(value) => setFilters({ ...filters, planningStatus: value })} options={STATUSES} placeholder="Status" />
          <Input value={filters.module} onChange={(event) => setFilters({ ...filters, module: event.target.value })} placeholder="Module" className="h-9" />
        </CardContent>
      </Card>
      <div className="space-y-4">
        {groups.map((group) => {
          const items = sortByRoadmapOrder(rows.filter((item) => item.phase === group.value));
          return (
            <section key={group.value ?? "unassigned"} className="rounded-md border border-border">
              <div className="flex items-center justify-between border-b border-border bg-muted/20 px-4 py-3">
                <h2 className="text-sm font-semibold">{group.label}</h2>
                <Badge variant="secondary">{items.length}</Badge>
              </div>
              <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-32 w-full" />)
                ) : items.length === 0 ? (
                  <p className="col-span-full py-4 text-center text-sm text-muted-foreground">No items in this phase.</p>
                ) : items.map((item, index) => (
                  <PlanningItemCard key={item.id} item={item}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex gap-1">
                        <Button variant="outline" size="icon" className="h-7 w-7" disabled={index === 0} onClick={() => moveWithinPhase(group.value, item.id, -1)}>
                          <ArrowUp className="h-3 w-3" />
                        </Button>
                        <Button variant="outline" size="icon" className="h-7 w-7" disabled={index === items.length - 1} onClick={() => moveWithinPhase(group.value, item.id, 1)}>
                          <ArrowDown className="h-3 w-3" />
                        </Button>
                      </div>
                      <Select value={item.phase ?? "none"} onValueChange={(value) => movePhaseMutation.mutate({ item, phase: value === "none" ? null : value as Phase })}>
                        <SelectTrigger className="h-7 w-[140px] text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Unassigned</SelectItem>
                          {PHASES.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </PlanningItemCard>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </ProductPlanningShell>
  );
}

function FilterSelect<T extends string>({ value, onChange, options, placeholder }: { value: string; onChange: (value: string) => void; options: Array<{ value: T; label: string }>; placeholder: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All {placeholder.toLowerCase()}</SelectItem>
        {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function InlineSelect<T extends string>({ value, options, onChange, includeNone }: { value: T | ""; options: Array<{ value: T; label: string }>; onChange: (value: string) => void; includeNone?: boolean }) {
  return (
    <Select value={value || "none"} onValueChange={(next) => onChange(next === "none" ? "" : next)}>
      <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>
        {includeNone && <SelectItem value="none">None</SelectItem>}
        {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function WorkItemDialog({
  open,
  form,
  setForm,
  availableParents,
  children,
  onOpenChange,
  onSave,
  isSaving,
}: {
  open: boolean;
  form: WorkItemFormState;
  setForm: (form: WorkItemFormState) => void;
  availableParents: WorkItem[];
  children: WorkItem[];
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  isSaving: boolean;
}) {
  const update = <K extends keyof WorkItemFormState>(key: K, value: WorkItemFormState[K]) => setForm({ ...form, [key]: value });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{form.id ? "Edit Work Item" : "Create Work Item"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label>Title</Label>
            <Input value={form.title} onChange={(event) => update("title", event.target.value)} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Description</Label>
            <Textarea value={form.description} onChange={(event) => update("description", event.target.value)} className="min-h-[90px]" />
          </div>
          <SelectField label="Type" value={form.workItemType} options={WORK_ITEM_TYPES} onChange={(value) => update("workItemType", value as WorkItemType)} />
          <SelectField label="Status" value={form.planningStatus} options={STATUSES} onChange={(value) => update("planningStatus", value as PlanningStatus)} />
          <SelectField label="Priority" value={form.priority} options={PRIORITIES} onChange={(value) => update("priority", value as Priority)} />
          <SelectField label="Business Value" value={form.businessValue || "none"} includeNone options={BUSINESS_VALUES} onChange={(value) => update("businessValue", value === "none" ? "" : value as BusinessValue)} />
          <SelectField label="Complexity" value={form.complexity || "none"} includeNone options={COMPLEXITIES} onChange={(value) => update("complexity", value === "none" ? "" : value as Complexity)} />
          <SelectField label="Phase" value={form.phase || "none"} includeNone options={PHASES} onChange={(value) => update("phase", value === "none" ? "" : value as Phase)} />
          <TextField label="Module" value={form.module} onChange={(value) => update("module", value)} />
          <TextField label="Submodule" value={form.submodule} onChange={(value) => update("submodule", value)} />
          <div className="space-y-2 md:col-span-2">
            <Label>Epic Parent</Label>
            <Select value={form.parentId || "none"} onValueChange={(value) => update("parentId", value === "none" ? "" : value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {availableParents.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.reference} - {item.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <TextField label="Tags" value={form.tags} onChange={(value) => update("tags", value)} />
          <TextField label="Requested By" value={form.requestedBy} onChange={(value) => update("requestedBy", value)} />
          <TextField label="Owner User ID" value={form.ownerUserId} onChange={(value) => update("ownerUserId", value)} />
          <TextField label="Due Date" value={form.dueDate} onChange={(value) => update("dueDate", value)} type="date" />
          <TextField label="Release Target" value={form.releaseTarget} onChange={(value) => update("releaseTarget", value)} />
          <div className="space-y-2 md:col-span-2">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} className="min-h-[90px]" />
          </div>
          {children.length > 0 && (
            <div className="space-y-2 md:col-span-2">
              <Label>Children</Label>
              <div className="space-y-2 rounded-md border border-border p-3">
                {children.map((child) => (
                  <div key={child.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="mr-2 font-mono text-xs text-muted-foreground">{child.reference}</span>
                      {child.title}
                    </span>
                    <Badge variant="outline">{labelFor(STATUSES, child.planningStatus)}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSave} disabled={!form.title.trim() || isSaving} className="gap-2">
            <Save className="h-4 w-4" />
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TextField({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function SelectField<T extends string>({ label, value, options, onChange, includeNone }: { label: string; value: string; options: Array<{ value: T; label: string }>; onChange: (value: string) => void; includeNone?: boolean }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {includeNone && <SelectItem value="none">None</SelectItem>}
          {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ProductPlanningImportsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filename, setFilename] = useState<string | null>(null);
  const [csv, setCsv] = useState("");
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  const { data: imports = [] } = useQuery<ImportBatch[]>({
    queryKey: ["/api/product-planning/imports"],
    queryFn: () => fetchJson<ImportBatch[]>("/api/product-planning/imports"),
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/product-planning/import/csv/preview", { csv, filename });
      return (await res.json()).data as ImportPreview;
    },
    onSuccess: (data) => setPreview(data),
    onError: (error: Error) => toast({ title: "Preview failed", description: error.message, variant: "destructive" }),
  });

  const commitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/product-planning/import/csv/commit", { csv, filename, allowDuplicates });
      return (await res.json()).data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/product-planning/imports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/product-planning/work-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/product-planning/dashboard"] });
      toast({ title: "Import completed", description: `${data.importedItems?.length ?? 0} rows imported.` });
      setPreview(null);
      setCsv("");
      setFilename(null);
    },
    onError: (error: Error) => toast({ title: "Import failed", description: error.message, variant: "destructive" }),
  });

  async function handleFile(file: File | null) {
    if (!file) return;
    setFilename(file.name);
    setCsv(await file.text());
    setPreview(null);
  }

  return (
    <ProductPlanningShell>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Upload className="h-4 w-4" />
              CSV Import
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input type="file" accept=".csv,text/csv" onChange={(event) => handleFile(event.target.files?.[0] ?? null)} />
            {filename && <p className="text-sm text-muted-foreground">{filename}</p>}
            <Textarea value={csv} onChange={(event) => { setCsv(event.target.value); setPreview(null); }} placeholder="CSV contents" className="min-h-[180px] font-mono text-xs" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={allowDuplicates} onChange={(event) => setAllowDuplicates(event.target.checked)} />
                Allow duplicates
              </label>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => previewMutation.mutate()} disabled={!csv.trim() || previewMutation.isPending}>
                  {previewMutation.isPending ? "Previewing..." : "Preview"}
                </Button>
                <Button onClick={() => commitMutation.mutate()} disabled={!preview || preview.counts.valid === 0 || commitMutation.isPending}>
                  {commitMutation.isPending ? "Importing..." : "Confirm Import"}
                </Button>
              </div>
            </div>
            {preview && <ImportPreviewTable preview={preview} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Import History</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {imports.length === 0 ? <p className="text-sm text-muted-foreground">No imports yet.</p> : imports.map((batch) => (
              <div key={batch.id} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-sm font-medium">{batch.filename || "CSV import"}</div>
                  <Badge variant={batch.status === "completed" ? "secondary" : "outline"}>{batch.status.replace(/_/g, " ")}</Badge>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {batch.importedCount} imported, {batch.skippedCount} skipped, {batch.errorCount} errors
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{format(new Date(batch.createdAt), "MMM d, yyyy HH:mm")}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </ProductPlanningShell>
  );
}

function ImportPreviewTable({ preview }: { preview: ImportPreview }) {
  const duplicateRows = new Map(preview.duplicateWarnings.map((warning) => [warning.rowNumber, warning.message]));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{preview.counts.valid} valid</Badge>
        <Badge variant={preview.counts.invalid > 0 ? "destructive" : "secondary"}>{preview.counts.invalid} invalid</Badge>
        <Badge variant={preview.duplicateWarnings.length > 0 ? "outline" : "secondary"}>{preview.duplicateWarnings.length} duplicates</Badge>
      </div>
      <div className="max-h-[360px] overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Row</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Module</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Phase</TableHead>
              <TableHead>Warnings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.mappedRows.map((row) => {
              const duplicate = duplicateRows.get(row.rowNumber);
              return (
                <TableRow key={row.rowNumber}>
                  <TableCell>{row.rowNumber}</TableCell>
                  <TableCell className="min-w-[220px]">{row.title || <span className="text-destructive">Missing title</span>}</TableCell>
                  <TableCell>{row.module}</TableCell>
                  <TableCell>{row.priority}</TableCell>
                  <TableCell>{row.planningStatus}</TableCell>
                  <TableCell>{row.phase ? labelFor(PHASES, row.phase) : ""}</TableCell>
                  <TableCell className="max-w-[260px] text-xs text-muted-foreground">
                    {[...row.errors, ...row.warnings, duplicate].filter(Boolean).join(" | ")}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function ProductPlanningIndexRedirect() {
  return <Navigate to={ROUTES.productPlanning.dashboard} replace />;
}
