import { Fragment, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Archive,
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Brain,
  Bug,
  ChevronDown,
  ClipboardList,
  Eye,
  FileUp,
  History,
  Kanban,
  LayoutDashboard,
  Link2,
  ListFilter,
  Map as MapIcon,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
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
type DependencyType = "blocks" | "requires" | "relates_to";
type ReleaseStatus = "planned" | "in_progress" | "released" | "archived";
type AiSuggestionStatus = "pending" | "accepted" | "rejected";
type ProductPlanningAiSource = "live_ai" | "rule_based_fallback";
type AiSuggestionType =
  | "priority"
  | "business_value"
  | "complexity"
  | "phase"
  | "module"
  | "work_item_type"
  | "parent_epic"
  | "duplicate_candidate"
  | "release_recommendation"
  | "implementation_notes";

type WorkItemSummary = {
  id: string;
  reference: string;
  title: string;
  workItemType: WorkItemType;
  planningStatus: PlanningStatus;
  priority?: Priority;
};

type ProductPlanningEvent = {
  id: string;
  eventType: string;
  message: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  createdByUserId: string | null;
};

type ProductPlanningSourceBugReport = {
  id: string;
  referenceNumber: string | null;
  title: string;
  status: string;
  severity: string;
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
  importedBatchId: string | null;
  parentId: string | null;
  parent?: WorkItemSummary | null;
  children?: WorkItemSummary[];
  requestedBy: string | null;
  ownerUserId: string | null;
  dueDate: string | null;
  releaseTarget: string | null;
  releaseId: string | null;
  userImpact: number | null;
  revenueImpact: number | null;
  operationalImpact: number | null;
  riskReduction: number | null;
  confidence: number | null;
  priorityScore: number | null;
  priorityScoreExplanation: Record<string, unknown>;
  notes: string | null;
  updatedAt: string;
  createdAt: string;
  archivedAt: string | null;
};

type ProductPlanningRelease = {
  id: string;
  name: string;
  description: string | null;
  targetDate: string | null;
  status: ReleaseStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

type ProductPlanningDependency = {
  id: string;
  workItemId: string;
  dependsOnWorkItemId: string;
  dependencyType: DependencyType;
  dependsOnWorkItem: WorkItemSummary | null;
  createdAt: string;
};

type ProductPlanningBlockedBy = {
  id: string;
  workItemId: string;
  dependsOnWorkItemId: string;
  dependencyType: DependencyType;
  workItem: WorkItemSummary | null;
  createdAt: string;
};

type ProductPlanningAiSuggestion = {
  id: string;
  workItemId: string | null;
  suggestionType: AiSuggestionType;
  currentValue: unknown;
  suggestedValue: unknown;
  confidence: number | string | null;
  reasoning: string | null;
  status: AiSuggestionStatus;
  createdAt: string;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  source?: ProductPlanningAiSource;
  fallbackReason?: string | null;
};

type WorkItemDetail = WorkItem & {
  release?: ProductPlanningRelease | null;
  sourceBugReport?: ProductPlanningSourceBugReport | null;
  importBatch?: ImportBatch | null;
  dependencies?: ProductPlanningDependency[];
  blockedBy?: ProductPlanningBlockedBy[];
  events?: ProductPlanningEvent[];
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
  topPriorityScoreFeatures: WorkItem[];
  majorBugsBlockingGoLive: WorkItem[];
  releaseProgress: Array<{ id: string; name: string; status: ReleaseStatus; targetDate: string | null; totalCount: number; releasedCount: number; openCount: number }>;
  itemsStalledInValidation: WorkItem[];
  itemsWithUnresolvedDependencies: WorkItem[];
  byModuleWorkload: Array<{ key: string | null; count: number }>;
  cleanupOpportunities: Array<{ key: string; label: string; count: number; href: string }>;
  byStatus: Array<{ key: string; count: number }>;
  byPhase: Array<{ key: string | null; count: number }>;
  byModule: Array<{ key: string | null; count: number }>;
};

type ProductPlanningBacklogAnalysis = {
  source?: ProductPlanningAiSource;
  fallbackReason?: string | null;
  executiveSummary?: string;
  recommendedGoLiveFocus?: string[];
  goLiveBlockers?: Array<{ title: string; reasoning: string; priority?: Priority; relatedItemReferences?: string[] }>;
  topNextActions?: Array<{ title: string; reasoning: string; priority?: Priority; relatedItemReferences?: string[] }>;
  quickWins?: Array<{ title: string; reasoning: string; priority?: Priority; relatedItemReferences?: string[] }>;
  futureCandidates?: Array<{ title: string; reasoning: string; priority?: Priority; relatedItemReferences?: string[] }>;
  highestRoiFeatures?: Array<{ title: string; reasoning: string; priority?: Priority; relatedItemReferences?: string[] }>;
  lowestPriorityFeatures?: Array<{ title: string; reasoning: string; priority?: Priority; relatedItemReferences?: string[] }>;
  suggestedEpics?: ProductPlanningEpicAnalysis["epics"];
  missingWork?: Array<{ title: string; reasoning: string; priority?: Priority; relatedItemReferences?: string[] }>;
  riskAreas?: Array<{ title: string; severity: "low" | "medium" | "high"; reasoning: string }>;
  readinessAssessment?: {
    readinessScore: number;
    criticalBlockers: string[];
    highPriorityActions: string[];
    recommendedSequence: string[];
    recommendedNextStep: string;
  };
  counts: {
    totalItems: number;
    missingModules: number;
    missingPhases: number;
    missingOwners: number;
    missingReleases: number;
    missingDescriptions: number;
    potentialDuplicates: number;
    potentialEpicGroups: number;
  };
  healthScore: number;
  issues: Array<{ label: string; count: number; severity: "low" | "medium" | "high" }>;
  nextActions: string[];
  goLiveReadiness: {
    blockers: WorkItem[];
    highValueFeatures: WorkItem[];
    quickWins: WorkItem[];
    futureItems: WorkItem[];
    reasoning: string;
  };
  epicGroups: Array<{ epicName: string; module: string; relatedItems: WorkItem[]; confidence: number; reasoning: string }>;
  suggestions: ProductPlanningAiSuggestion[];
  liveAi?: {
    goLiveBlockers?: Array<{ title: string; reasoning: string; relatedItemReferences: string[] }>;
    topNextActions?: Array<{ title: string; reasoning: string; priority: Priority }>;
    quickWins?: Array<{ title: string; reasoning: string }>;
    futureItems?: Array<{ title: string; reasoning: string }>;
    healthFindings?: Array<{ label: string; count: number; severity: "low" | "medium" | "high"; recommendation: string }>;
    highestRoiFeatures?: Array<{ title: string; reasoning: string; priority?: Priority; relatedItemReferences?: string[] }>;
    lowestPriorityFeatures?: Array<{ title: string; reasoning: string; priority?: Priority; relatedItemReferences?: string[] }>;
    suggestedEpics?: ProductPlanningEpicAnalysis["epics"];
    missingWork?: Array<{ title: string; reasoning: string; priority?: Priority; relatedItemReferences?: string[] }>;
    riskAreas?: Array<{ title: string; severity: "low" | "medium" | "high"; reasoning: string }>;
    readinessAssessment?: {
      readinessScore: number;
      criticalBlockers: string[];
      highPriorityActions: string[];
      recommendedSequence: string[];
      recommendedNextStep: string;
    };
  };
};

type ProductPlanningRoadmapAnalysis = {
  source?: ProductPlanningAiSource;
  fallbackReason?: string | null;
  summary?: string;
  overloadedPhases?: Array<{ phase: string; reasoning: string }>;
  moveRecommendations?: Array<{ reference: string; currentPhase: string | null; recommendedPhase: Phase; confidence: number; reasoning: string }>;
  deferRecommendations?: Array<{ reference: string; currentPhase: string | null; recommendedPhase: Phase; confidence: number; reasoning: string }>;
  sequenceRecommendations?: Array<{ title: string; reasoning: string }>;
  recommendations: Array<{ phase: string; action: string; count: number; reasoning: string }>;
  suggestions: ProductPlanningAiSuggestion[];
};

type ProductPlanningWorkItemAiAnalysis = {
  summary: string;
  concerns: Array<{ label: string; severity: "low" | "medium" | "high"; reasoning: string }>;
  suggestions: ProductPlanningAiSuggestion[];
  nextActions: string[];
  source?: ProductPlanningAiSource;
  fallbackReason?: string | null;
};

type ProductPlanningEpicAnalysis = {
  source?: ProductPlanningAiSource;
  fallbackReason?: string | null;
  epics: Array<{
    name: string;
    description: string;
    confidence: number;
    businessValue: BusinessValue;
    recommendedPhase: Phase;
    relatedItemReferences: string[];
    relatedItems?: Array<{ reference: string; title: string; priority?: Priority | null; phase?: Phase | null; module?: string | null; reasonIncluded: string }>;
    reasoning: string;
  }>;
  suggestions: ProductPlanningAiSuggestion[];
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

type ImportCommitResult = {
  batch: ImportBatch;
  importedItems: WorkItem[];
  skippedRows: Array<{ rowNumber: number; title: string | null; reason: string }>;
};

type ProductPlanningResetResult = {
  counts: {
    productPlanningAiSuggestions: number;
    productPlanningEvents: number;
    productPlanningDependencies: number;
    productPlanningWorkItems: number;
    productPlanningImportBatches: number;
    productPlanningReleases: number;
    productPlanningReferenceCounters: number;
  };
  referenceCounterReset: boolean;
};

type ProductPlanningAiReadiness = {
  status:
    | "live_ai_configured"
    | "rule_based_fallback"
    | "missing_org_ai_settings"
    | "missing_provider_env"
    | "missing_encrypted_api_key"
    | "feature_review_disabled";
  label: string;
  message: string;
  mode: "disabled" | "printershero_managed" | "bring_your_own";
  provider: string | null;
  model: string | null;
  settingsPresent: boolean;
  featureReviewEnabled: boolean;
  hasEncryptedApiKey: boolean;
  managedProviderEnv: {
    configured: boolean;
    endpointPresent: boolean;
    apiKeyPresent: boolean;
    modelPresent: boolean;
  };
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

const PRODUCT_PLANNING_RESET_CONFIRMATION = "RESET PRODUCT PLANNING";
const PRODUCT_PLANNING_TEMPLATE_COLUMNS = [
  "External ID",
  "Module",
  "Submodule",
  "Work Item Type",
  "Title",
  "Rich Description",
  "Business Value",
  "Priority",
  "Complexity",
  "Phase",
  "Planning Status",
  "Requested By",
  "Dependencies",
  "Suggested Epic",
  "Release Target",
  "Rich Notes",
  "Tags",
];

const COMPLEXITIES: Array<{ value: Complexity; label: string }> = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
  { value: "massive", label: "Massive" },
];

const DEPENDENCY_TYPES: Array<{ value: DependencyType; label: string }> = [
  { value: "requires", label: "Requires" },
  { value: "blocks", label: "Blocks" },
  { value: "relates_to", label: "Relates To" },
];

const RELEASE_STATUSES: Array<{ value: ReleaseStatus; label: string }> = [
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In Progress" },
  { value: "released", label: "Released" },
  { value: "archived", label: "Archived" },
];

const SCORE_OPTIONS = [
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
  { value: "5", label: "5" },
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

function metricToString(value: number | null | undefined): string {
  return value == null ? "" : String(value);
}

function parseMetric(value: string): number | null {
  return value ? Number(value) : null;
}

function priorityBadge(priority: Priority) {
  if (priority === "critical") return "destructive";
  if (priority === "high") return "default";
  return "secondary";
}

function workItemPath(itemOrId: Pick<WorkItem, "id"> | string) {
  return ROUTES.productPlanning.workItemDetail(typeof itemOrId === "string" ? itemOrId : itemOrId.id);
}

function displayDate(value: string | null | undefined, includeTime = false) {
  if (!value) return "-";
  return format(new Date(value), includeTime ? "MMM d, yyyy HH:mm" : "MMM d, yyyy");
}

function releaseName(item: WorkItem, releases?: ProductPlanningRelease[]) {
  return (item as WorkItemDetail).release?.name ?? releases?.find((release) => release.id === item.releaseId)?.name ?? item.releaseTarget ?? "";
}

function displayAiValue(value: unknown): string {
  if (value == null || value === "") return "-";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        return displayAiValue(JSON.parse(trimmed));
      } catch {
        return value.replace(/_/g, " ");
      }
    }
    return value.replace(/_/g, " ");
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value).replace(/_/g, " ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.notes === "string") return record.notes;
    if (typeof record.reference === "string" && typeof record.title === "string") return `${record.reference}: ${record.title}`;
    if (typeof record.value === "string") return record.value.replace(/_/g, " ");
    if (typeof record.field === "string" && typeof record.value === "string") return `${record.field}: ${record.value}`;
    if (typeof record.action === "string") return record.action.replace(/_/g, " ");
  }
  return JSON.stringify(value);
}

function suggestionTypeLabel(type: AiSuggestionType) {
  return type.replace(/_/g, " ");
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
            const active = activePath === tab.path || (activePath.startsWith("/product-planning/work-items/") && tab.path === ROUTES.productPlanning.backlog);
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

function CompactItemList({
  title,
  items,
  icon,
  emptyMessage,
  actionLabel,
  actionTo,
}: {
  title: string;
  items: WorkItem[];
  icon: React.ReactNode;
  emptyMessage?: string;
  actionLabel?: string;
  actionTo?: string;
}) {
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
          <div className="space-y-3 rounded-md border border-dashed border-border p-4">
            <p className="text-sm text-muted-foreground">{emptyMessage ?? "No items yet."}</p>
            {actionLabel && actionTo && (
              <Link to={actionTo}>
                <Button variant="outline" size="sm">{actionLabel}</Button>
              </Link>
            )}
          </div>
        ) : items.map((item) => (
          <Link key={item.id} to={workItemPath(item)} className="block rounded-md border border-border p-3 hover:bg-muted/40">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-xs text-muted-foreground">{item.reference}</div>
                <div className="truncate text-sm font-medium">{item.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{item.module || "No module"} {item.phase ? `- ${labelFor(PHASES, item.phase)}` : ""}</div>
              </div>
              <Badge variant={priorityBadge(item.priority)} className="shrink-0 capitalize">{item.priority}</Badge>
            </div>
            {item.priorityScore != null && <div className="mt-2 text-xs text-muted-foreground">Score {item.priorityScore}</div>}
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

function ReleaseProgressList({ releases }: { releases: DashboardData["releaseProgress"] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Release Progress</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {releases.length === 0 ? (
          <div className="space-y-3 rounded-md border border-dashed border-border p-4">
            <p className="text-sm text-muted-foreground">No releases planned.</p>
            <Link to={ROUTES.productPlanning.backlog}>
              <Button variant="outline" size="sm">Create Release</Button>
            </Link>
          </div>
        ) : releases.map((release) => {
          const percent = release.totalCount > 0 ? Math.round((release.releasedCount / release.totalCount) * 100) : 0;
          return (
            <div key={release.id} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">{release.name}</span>
                <Badge variant="secondary">{labelFor(RELEASE_STATUSES, release.status)}</Badge>
              </div>
              <div className="mt-2 h-2 rounded-full bg-muted">
                <div className="h-2 rounded-full bg-primary" style={{ width: `${percent}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                <span>{release.releasedCount}/{release.totalCount} released</span>
                <span>{release.targetDate ? format(new Date(release.targetDate), "MMM d, yyyy") : "No target date"}</span>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function CleanupOpportunitiesList({ opportunities }: { opportunities: DashboardData["cleanupOpportunities"] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Brain className="h-4 w-4 text-primary" />
          Backlog Cleanup Opportunities
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {opportunities.length === 0 || opportunities.every((opportunity) => opportunity.count === 0) ? (
          <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">No cleanup opportunities detected yet.</div>
        ) : opportunities.map((opportunity) => (
          <Link key={opportunity.key} to={opportunity.href} className="flex items-center justify-between rounded-md border border-border p-3 hover:bg-muted/40">
            <span className="text-sm">{opportunity.label}</span>
            <Badge variant={opportunity.count > 0 ? "default" : "secondary"}>{opportunity.count}</Badge>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

function AiSourceIndicator({ source, fallbackReason }: { source?: ProductPlanningAiSource; fallbackReason?: string | null }) {
  if (!source) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <Badge variant={source === "live_ai" ? "secondary" : "outline"}>{source === "live_ai" ? "Live AI" : "Rule-based fallback"}</Badge>
      {fallbackReason && <span>{fallbackReason}</span>}
    </div>
  );
}

function ProductPlanningAiReadinessCard({ readiness, isLoading }: { readiness?: ProductPlanningAiReadiness; isLoading: boolean }) {
  const isLive = readiness?.status === "live_ai_configured";
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Product Planning AI</span>
            <Badge variant={isLive ? "default" : "outline"}>
              {isLoading ? "Checking..." : readiness?.label ?? "Rule-based fallback"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {isLoading ? "Checking provider readiness." : readiness?.message ?? "Live AI readiness could not be checked."}
          </p>
        </div>
        {readiness ? (
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">{readiness.mode.replace(/_/g, " ")}</Badge>
            {readiness.provider ? <Badge variant="secondary">{readiness.provider}</Badge> : null}
            {readiness.model ? <Badge variant="secondary">{readiness.model}</Badge> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function BacklogAiAnalysisPanel({ analysis }: { analysis: ProductPlanningBacklogAnalysis }) {
  const readiness = analysis.goLiveReadiness;
  const live = analysis.liveAi;
  const readinessAssessment = analysis.readinessAssessment ?? live?.readinessAssessment;
  const topNextActions = analysis.topNextActions ?? live?.topNextActions ?? [];
  const goLiveBlockers = analysis.goLiveBlockers ?? live?.goLiveBlockers ?? [];
  const quickWins = analysis.quickWins ?? live?.quickWins ?? [];
  const futureCandidates = analysis.futureCandidates ?? live?.futureItems ?? [];
  const highestRoi = analysis.highestRoiFeatures ?? live?.highestRoiFeatures ?? [];
  const lowestPriority = analysis.lowestPriorityFeatures ?? live?.lowestPriorityFeatures ?? [];
  const suggestedEpics = analysis.suggestedEpics ?? live?.suggestedEpics ?? [];
  const missingWork = analysis.missingWork ?? live?.missingWork ?? [];
  const riskAreas = analysis.riskAreas ?? live?.riskAreas ?? [];
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Brain className="h-4 w-4 text-primary" />
            Backlog Health Score
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <AiSourceIndicator source={analysis.source} fallbackReason={analysis.fallbackReason} />
          {analysis.executiveSummary && <p className="text-sm text-muted-foreground">{analysis.executiveSummary}</p>}
          <div className="text-3xl font-semibold">{analysis.healthScore}</div>
          {(analysis.recommendedGoLiveFocus?.length ?? 0) > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-medium uppercase text-muted-foreground">Recommended Go-Live Focus</div>
              <ol className="list-inside list-decimal space-y-1 text-xs">
                {analysis.recommendedGoLiveFocus!.slice(0, 5).map((focus) => <li key={focus}>{focus}</li>)}
              </ol>
            </div>
          )}
          {(live?.healthFindings ?? analysis.issues).length === 0 ? (
            <p className="text-sm text-muted-foreground">No major backlog health issues found.</p>
          ) : (live?.healthFindings ?? analysis.issues).slice(0, 6).map((issue) => (
            <div key={issue.label} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
              <span>{issue.label}</span>
              <Badge variant={issue.severity === "high" ? "destructive" : "secondary"}>{issue.count}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Top Next Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {topNextActions.length > 0 ? topNextActions.slice(0, 10).map((action) => (
            <div key={action.title} className="rounded-md border border-border p-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{action.title}</span>
                {action.priority && <Badge variant={priorityBadge(action.priority)}>{action.priority}</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{action.reasoning}</p>
            </div>
          )) : analysis.nextActions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No immediate cleanup actions detected.</p>
          ) : analysis.nextActions.map((action) => (
            <div key={action} className="rounded-md border border-border p-2 text-sm">{action}</div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Suggested Epics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {suggestedEpics.length > 0 ? suggestedEpics.slice(0, 5).map((epic) => (
            <div key={epic.name} className="rounded-md border border-border p-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{epic.name}</span>
                <Badge variant="secondary">{epic.relatedItemReferences.length}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{epic.reasoning}</p>
            </div>
          )) : analysis.epicGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No epic groupings found yet.</p>
          ) : analysis.epicGroups.slice(0, 5).map((group) => (
            <div key={`${group.epicName}-${group.module}`} className="rounded-md border border-border p-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{group.epicName}</span>
                <Badge variant="secondary">{group.relatedItems.length}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{group.reasoning}</p>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card className="lg:col-span-3">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Go-Live Readiness Assessment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {readinessAssessment ? (
            <div className="grid gap-3 md:grid-cols-[140px_1fr_1fr]">
              <div className="rounded-md border border-border p-3">
                <div className="text-xs uppercase text-muted-foreground">Current Readiness</div>
                <div className="mt-1 text-3xl font-semibold">{readinessAssessment.readinessScore}%</div>
              </div>
              <MiniTextList title="Critical Blockers" items={readinessAssessment.criticalBlockers} />
              <MiniTextList title="Recommended Sequence" items={readinessAssessment.recommendedSequence} />
              <div className="rounded-md border border-border p-3 text-sm md:col-span-3">
                <div className="text-xs font-medium uppercase text-muted-foreground">Recommended Next Step</div>
                <p className="mt-1">{readinessAssessment.recommendedNextStep}</p>
              </div>
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-3">
            {goLiveBlockers.length ? <MiniNarrativeList title="Go-Live Blockers" items={goLiveBlockers} /> : <MiniReadinessList title="Go-Live Blockers" items={readiness.blockers} />}
            {highestRoi.length ? <MiniNarrativeList title="Highest ROI Features" items={highestRoi} /> : <MiniReadinessList title="High Value Features" items={readiness.highValueFeatures} />}
            {quickWins.length ? <MiniNarrativeList title="Quick Wins" items={quickWins} /> : <MiniReadinessList title="Quick Wins" items={readiness.quickWins} />}
            {futureCandidates.length ? <MiniNarrativeList title="Future / Defer Candidates" items={futureCandidates} /> : <MiniReadinessList title="Future / Defer Candidates" items={readiness.futureItems} />}
            {lowestPriority.length ? <MiniNarrativeList title="Lowest Priority Features" items={lowestPriority} /> : null}
            {missingWork.length ? <MiniNarrativeList title="Missing Work" items={missingWork} /> : null}
            {riskAreas.length ? <MiniNarrativeList title="Risk Areas" items={riskAreas.map((risk) => ({ title: risk.title, reasoning: risk.reasoning }))} /> : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MiniTextList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs font-medium uppercase text-muted-foreground">{title}</div>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">No items found.</p>
      ) : (
        <ol className="mt-2 list-inside list-decimal space-y-1 text-xs">
          {items.slice(0, 6).map((item) => <li key={item}>{item}</li>)}
        </ol>
      )}
    </div>
  );
}

function MiniNarrativeList({ title, items }: { title: string; items: Array<{ title: string; reasoning: string }> }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase text-muted-foreground">{title}</div>
      {items.slice(0, 5).map((item) => (
        <div key={item.title} className="rounded-md border border-border p-2 text-xs">
          <div className="font-medium">{item.title}</div>
          <p className="mt-1 text-muted-foreground">{item.reasoning}</p>
        </div>
      ))}
    </div>
  );
}

function MiniReadinessList({ title, items }: { title: string; items: WorkItem[] }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase text-muted-foreground">{title}</div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No items found.</p>
      ) : items.slice(0, 5).map((item) => (
        <Link key={item.id} to={workItemPath(item)} className="block rounded-md border border-border p-2 text-xs hover:bg-muted/40">
          <span className="mr-2 font-mono text-muted-foreground">{item.reference}</span>
          {item.title}
        </Link>
      ))}
    </div>
  );
}

function SuggestedEpicCards({ analysis, onDismiss }: { analysis: ProductPlanningEpicAnalysis; onDismiss: () => void }) {
  const [expandedEpic, setExpandedEpic] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-3 text-sm">
          <span>Suggested Epics</span>
          <AiSourceIndicator source={analysis.source} fallbackReason={analysis.fallbackReason} />
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {analysis.epics.slice(0, 9).map((epic) => {
          const isExpanded = expandedEpic === epic.name;
          const relatedItems = epic.relatedItems ?? epic.relatedItemReferences.map((reference) => ({
            reference,
            title: "Planning item",
            priority: null,
            phase: null,
            module: null,
            reasonIncluded: epic.reasoning,
          }));
          return (
            <div key={epic.name} className="space-y-2 rounded-md border border-border p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium">{epic.name}</div>
              <Badge variant="secondary">{epic.relatedItemReferences.length}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{epic.description}</p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{labelFor(BUSINESS_VALUES, epic.businessValue)}</Badge>
              <Badge variant="secondary">{labelFor(PHASES, epic.recommendedPhase)}</Badge>
              <Badge variant="secondary">{epic.confidence}%</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{epic.reasoning}</p>
            {epic.relatedItemReferences.length > 0 && (
              <div className="text-xs text-muted-foreground">Refs: {epic.relatedItemReferences.slice(0, 6).join(", ")}</div>
            )}
            {isExpanded && (
              <div className="space-y-2 rounded-md bg-muted/30 p-2">
                <div className="text-xs font-medium uppercase text-muted-foreground">Included Items</div>
                {relatedItems.map((item) => (
                  <div key={item.reference} className="rounded-md border border-border bg-background p-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-muted-foreground">{item.reference}</span>
                      <span className="font-medium">{item.title}</span>
                      {item.priority && <Badge variant={priorityBadge(item.priority)}>{item.priority}</Badge>}
                      {item.phase && <Badge variant="secondary">{labelFor(PHASES, item.phase)}</Badge>}
                      {item.module && <Badge variant="outline">{item.module}</Badge>}
                    </div>
                    <p className="mt-1 text-muted-foreground">{item.reasonIncluded}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setExpandedEpic(isExpanded ? null : epic.name)}>
                {isExpanded ? "Hide Items" : "View Items"}
              </Button>
              <Button variant="outline" size="sm" onClick={onDismiss}>Dismiss</Button>
              <Button variant="outline" size="sm" onClick={() => window.confirm(`Create epic draft for ${epic.name}?`)}>
                Create Epic Draft
              </Button>
            </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function ProductPlanningDashboardPage() {
  const { toast } = useToast();
  const [backlogAnalysis, setBacklogAnalysis] = useState<ProductPlanningBacklogAnalysis | null>(null);
  const [epicAnalysis, setEpicAnalysis] = useState<ProductPlanningEpicAnalysis | null>(null);
  const { data, isLoading, refetch, isRefetching } = useQuery<DashboardData>({
    queryKey: ["/api/product-planning/dashboard"],
    queryFn: () => fetchJson<DashboardData>("/api/product-planning/dashboard"),
  });
  const { data: aiReadiness, isLoading: aiReadinessLoading } = useQuery<ProductPlanningAiReadiness>({
    queryKey: ["/api/product-planning/ai/readiness"],
    queryFn: () => fetchJson<ProductPlanningAiReadiness>("/api/product-planning/ai/readiness"),
  });
  const analyzeBacklogMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/product-planning/ai/analyze-backlog", {});
      return (await res.json()).data as ProductPlanningBacklogAnalysis;
    },
    onSuccess: (analysis) => {
      setBacklogAnalysis(analysis);
      toast({ title: "Backlog analysis ready", description: `${analysis.suggestions.length} suggestion(s) stored for review.` });
    },
    onError: (error: Error) => toast({ title: "Backlog analysis failed", description: error.message, variant: "destructive" }),
  });
  const suggestEpicsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/product-planning/ai/suggest-epics", {});
      return (await res.json()).data as ProductPlanningEpicAnalysis;
    },
    onSuccess: (data) => {
      setEpicAnalysis(data);
      toast({ title: "Epic suggestions ready", description: `${data.suggestions.length} epic suggestion(s) stored.` });
    },
    onError: (error: Error) => toast({ title: "Epic suggestions failed", description: error.message, variant: "destructive" }),
  });

  return (
    <ProductPlanningShell>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => analyzeBacklogMutation.mutate()} disabled={analyzeBacklogMutation.isPending} className="gap-2">
          <Brain className="h-4 w-4" />
          {analyzeBacklogMutation.isPending ? "Analyzing..." : "Analyze Backlog"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => suggestEpicsMutation.mutate()} disabled={suggestEpicsMutation.isPending} className="gap-2">
          <ClipboardList className="h-4 w-4" />
          Suggest Epics
        </Button>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
      <ProductPlanningAiReadinessCard readiness={aiReadiness} isLoading={aiReadinessLoading} />
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
          {backlogAnalysis && <BacklogAiAnalysisPanel analysis={backlogAnalysis} />}
          {epicAnalysis && <SuggestedEpicCards analysis={epicAnalysis} onDismiss={() => setEpicAnalysis(null)} />}
          <div className="grid gap-4 lg:grid-cols-2">
            <CompactItemList title="Major Bugs" items={data.majorBugs} icon={<Bug className="h-4 w-4 text-destructive" />} emptyMessage="No prioritized bugs yet." actionLabel="Push Bug Reports" actionTo={ROUTES.admin.bugReports} />
            <CompactItemList title="Prioritized Features" items={data.topPrioritizedFeatures} icon={<ClipboardList className="h-4 w-4 text-primary" />} emptyMessage="No prioritized features yet." actionLabel="Create Work Item" actionTo={ROUTES.productPlanning.backlog} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <CompactItemList title="Top Score Features" items={data.topPriorityScoreFeatures} icon={<ClipboardList className="h-4 w-4 text-primary" />} emptyMessage="No scored features yet." actionLabel="Import Backlog" actionTo={ROUTES.productPlanning.imports} />
            <CompactItemList title="Go-Live Bug Blockers" items={data.majorBugsBlockingGoLive} icon={<Bug className="h-4 w-4 text-destructive" />} emptyMessage="No go-live bug blockers yet." actionLabel="Push Bug Reports" actionTo={ROUTES.admin.bugReports} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <ReleaseProgressList releases={data.releaseProgress} />
            <CompactItemList title="Stalled Validation" items={data.itemsStalledInValidation} icon={<RefreshCw className="h-4 w-4 text-muted-foreground" />} emptyMessage="No validation items look stalled." actionLabel="Open Kanban" actionTo={ROUTES.productPlanning.kanban} />
            <CompactItemList title="Unresolved Dependencies" items={data.itemsWithUnresolvedDependencies} icon={<Link2 className="h-4 w-4 text-muted-foreground" />} emptyMessage="No unresolved dependencies." actionLabel="Open Backlog" actionTo={ROUTES.productPlanning.backlog} />
          </div>
          <CleanupOpportunitiesList opportunities={data.cleanupOpportunities ?? []} />
          <div className="grid gap-4 lg:grid-cols-3">
            <SummaryBreakdown title="By Status" rows={data.byStatus} />
            <SummaryBreakdown title="By Phase" rows={data.byPhase.map((row) => ({ ...row, key: labelFor(PHASES, row.key as Phase | null) || "Unassigned" }))} />
            <SummaryBreakdown title="By Module Workload" rows={(data.byModuleWorkload ?? data.byModule).map((row) => ({ ...row, key: row.key || "Unassigned" }))} />
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
  releaseId: string;
  userImpact: string;
  revenueImpact: string;
  operationalImpact: string;
  riskReduction: string;
  confidence: string;
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
  releaseId: "",
  userImpact: "",
  revenueImpact: "",
  operationalImpact: "",
  riskReduction: "",
  confidence: "",
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
    releaseId: item.releaseId ?? "",
    userImpact: metricToString(item.userImpact),
    revenueImpact: metricToString(item.revenueImpact),
    operationalImpact: metricToString(item.operationalImpact),
    riskReduction: metricToString(item.riskReduction),
    confidence: metricToString(item.confidence),
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
    releaseId: normalizeOptional(form.releaseId),
    userImpact: parseMetric(form.userImpact),
    revenueImpact: parseMetric(form.revenueImpact),
    operationalImpact: parseMetric(form.operationalImpact),
    riskReduction: parseMetric(form.riskReduction),
    confidence: parseMetric(form.confidence),
    notes: normalizeOptional(form.notes),
  };
}

export function ProductPlanningBacklogPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState({
    search: "",
    workItemType: "all",
    planningStatus: "all",
    priority: "all",
    module: "",
    phase: "all",
    sourceType: "all",
    importedBatchId: searchParams.get("importedBatchId") ?? "",
    sortBy: "updatedAt",
    sortDirection: "desc",
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<WorkItemFormState>(EMPTY_FORM);
  const [releaseDraft, setReleaseDraft] = useState({ name: "", targetDate: "" });
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
  const { data: releases = [] } = useQuery<ProductPlanningRelease[]>({
    queryKey: ["/api/product-planning/releases"],
    queryFn: () => fetchJson<ProductPlanningRelease[]>("/api/product-planning/releases"),
  });
  const parentById = useMemo(() => new Map(rows.map((item) => [item.id, item])), [rows]);
  const releaseById = useMemo(() => new Map(releases.map((release) => [release.id, release])), [releases]);

  const createReleaseMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/product-planning/releases", {
        name: releaseDraft.name,
        targetDate: normalizeOptional(releaseDraft.targetDate),
        status: "planned",
      });
      return (await res.json()).data as ProductPlanningRelease;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/product-planning/releases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/product-planning/dashboard"] });
      setReleaseDraft({ name: "", targetDate: "" });
      toast({ title: "Release created" });
    },
    onError: (error: Error) => toast({ title: "Release create failed", description: error.message, variant: "destructive" }),
  });

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
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Release Planning</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
          <Input value={releaseDraft.name} onChange={(event) => setReleaseDraft({ ...releaseDraft, name: event.target.value })} placeholder="Release name" className="h-9" />
          <Input type="date" value={releaseDraft.targetDate} onChange={(event) => setReleaseDraft({ ...releaseDraft, targetDate: event.target.value })} className="h-9" />
          <Button size="sm" disabled={!releaseDraft.name.trim() || createReleaseMutation.isPending} onClick={() => createReleaseMutation.mutate()}>
            Create Release
          </Button>
          {releases.length > 0 && (
            <div className="flex flex-wrap gap-2 md:col-span-3">
              {releases.slice(0, 8).map((release) => (
                <Badge key={release.id} variant="secondary">
                  {release.name}{release.targetDate ? ` - ${format(new Date(release.targetDate), "MMM d")}` : ""}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
            {filters.importedBatchId && (
              <Button variant="outline" size="sm" onClick={() => setFilters({ ...filters, importedBatchId: "" })}>
                Clear Import Filter
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Select value={filters.sortBy} onValueChange={(value) => setFilters({ ...filters, sortBy: value })}>
                <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="reference">Reference</SelectItem>
                  <SelectItem value="priority">Priority</SelectItem>
                  <SelectItem value="priorityScore">Priority score</SelectItem>
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
                <TableHead>Score</TableHead>
                <TableHead>Module</TableHead>
                <TableHead>Phase</TableHead>
                <TableHead>Release</TableHead>
                <TableHead>Epic</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? Array.from({ length: 6 }).map((_, index) => (
                <TableRow key={index}><TableCell colSpan={14}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
              )) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={14} className="py-8 text-center text-sm text-muted-foreground">No planning work items found.</TableCell></TableRow>
              ) : rows.map((item) => (
                <Fragment key={item.id}>
                  <TableRow>
                    <TableCell className="font-mono text-xs font-semibold">
                      <Link to={workItemPath(item)} className="text-primary hover:underline">{item.reference}</Link>
                    </TableCell>
                    <TableCell>
                      <Link to={workItemPath(item)} className="block max-w-[360px] truncate text-sm font-medium text-primary hover:underline">{item.title}</Link>
                      {item.sourceReference && <div className="text-xs text-muted-foreground">{item.sourceReference}</div>}
                    </TableCell>
                    <TableCell><Badge variant="outline">{labelFor(WORK_ITEM_TYPES, item.workItemType)}</Badge></TableCell>
                    <TableCell>
                      <InlineSelect value={item.planningStatus} options={STATUSES} onChange={(value) => quickUpdateMutation.mutate({ id: item.id, patch: { planningStatus: value as PlanningStatus } })} />
                    </TableCell>
                    <TableCell>
                      <InlineSelect value={item.priority} options={PRIORITIES} onChange={(value) => quickUpdateMutation.mutate({ id: item.id, patch: { priority: value as Priority } })} />
                    </TableCell>
                    <TableCell>{item.priorityScore == null ? "" : <Badge variant="outline">{item.priorityScore}</Badge>}</TableCell>
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
                      {releaseName(item, releases) && <Badge variant="secondary">{releaseName(item, releases)}</Badge>}
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
                        <Link to={workItemPath(item)}>
                          <Button variant="ghost" size="icon" title="Quick view">
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                        <Button variant="ghost" size="icon" title="Expand" onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}>
                          <ChevronDown className={`h-4 w-4 transition-transform ${expandedId === item.id ? "rotate-180" : ""}`} />
                        </Button>
                        <Button variant="ghost" size="icon" title="Edit" onClick={() => { setForm(formFromItem(item)); setModalOpen(true); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Archive" onClick={() => archiveMutation.mutate(item.id)}>
                          <Archive className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {expandedId === item.id && (
                    <TableRow>
                      <TableCell colSpan={14} className="bg-muted/20 p-0">
                        <BacklogExpandedRow item={item} release={releaseById.get(item.releaseId ?? "") ?? null} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
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
        releases={releases}
        workItems={rows}
        currentItem={form.id ? rows.find((item) => item.id === form.id) : undefined}
        children={form.id ? rows.filter((item) => item.parentId === form.id) : []}
        onOpenChange={setModalOpen}
        onSave={() => saveMutation.mutate(form)}
        isSaving={saveMutation.isPending}
      />
    </ProductPlanningShell>
  );
}

export function BacklogExpandedRow({ item, release }: { item: WorkItem; release: ProductPlanningRelease | null }) {
  const { data: dependencies = [], isLoading } = useQuery<ProductPlanningDependency[]>({
    queryKey: ["/api/product-planning/work-items", item.id, "dependencies", "backlog-row"],
    queryFn: () => fetchJson<ProductPlanningDependency[]>(`/api/product-planning/work-items/${item.id}/dependencies`),
  });

  return (
    <div className="grid gap-4 p-4 text-sm md:grid-cols-2 xl:grid-cols-4">
      <div>
        <div className="text-xs font-medium uppercase text-muted-foreground">Description</div>
        <p className="mt-1 whitespace-pre-wrap text-sm">{item.description || "No description yet."}</p>
      </div>
      <div>
        <div className="text-xs font-medium uppercase text-muted-foreground">Notes</div>
        <p className="mt-1 whitespace-pre-wrap text-sm">{item.notes || "No notes yet."}</p>
      </div>
      <div>
        <div className="text-xs font-medium uppercase text-muted-foreground">Dependencies</div>
        <div className="mt-1 space-y-1">
          {isLoading ? <Skeleton className="h-5 w-32" /> : dependencies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No dependencies linked.</p>
          ) : dependencies.slice(0, 4).map((dependency) => (
            <Link key={dependency.id} to={dependency.dependsOnWorkItem ? workItemPath(dependency.dependsOnWorkItem.id) : "#"} className="block truncate text-primary hover:underline">
              {labelFor(DEPENDENCY_TYPES, dependency.dependencyType)} {dependency.dependsOnWorkItem?.reference ?? dependency.dependsOnWorkItemId}
            </Link>
          ))}
        </div>
      </div>
      <div>
        <div className="text-xs font-medium uppercase text-muted-foreground">Source & Release</div>
        <div className="mt-1 space-y-1 text-sm">
          <div>Release: {release?.name ?? item.releaseTarget ?? "Unassigned"}</div>
          <div>Source: {item.sourceType ? item.sourceType.replace("_", " ") : "Manual"}</div>
          {item.sourceReference && <div>Source ref: {item.sourceReference}</div>}
        </div>
      </div>
    </div>
  );
}

function PlanningItemCard({
  item,
  releases,
  compact,
  children,
}: {
  item: WorkItem;
  releases?: ProductPlanningRelease[];
  compact?: boolean;
  children?: React.ReactNode;
}) {
  const itemReleaseName = releaseName(item, releases);
  return (
    <div className="rounded-md border border-border bg-background p-3 shadow-sm">
      <Link to={workItemPath(item)} className="block">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-xs text-primary">{item.reference}</div>
            <div className="line-clamp-2 text-sm font-medium hover:underline">{item.title}</div>
          </div>
          <Badge variant={priorityBadge(item.priority)} className="shrink-0 capitalize">{item.priority}</Badge>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          <Badge variant="outline" className="text-[11px]">{labelFor(WORK_ITEM_TYPES, item.workItemType)}</Badge>
          <Badge variant="secondary" className="text-[11px]">{labelFor(STATUSES, item.planningStatus)}</Badge>
          {item.module && <Badge variant="secondary" className="text-[11px]">{item.module}</Badge>}
          {item.phase && <Badge variant="secondary" className="text-[11px]">{labelFor(PHASES, item.phase)}</Badge>}
          {itemReleaseName && <Badge variant="secondary" className="text-[11px]">{itemReleaseName}</Badge>}
          {item.sourceType && item.sourceType !== "manual" && <Badge variant="outline" className="text-[11px]">{item.sourceType.replace("_", " ")}</Badge>}
        </div>
      </Link>
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
  const { data: releases = [] } = useQuery<ProductPlanningRelease[]>({
    queryKey: ["/api/product-planning/releases"],
    queryFn: () => fetchJson<ProductPlanningRelease[]>("/api/product-planning/releases"),
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
                    <PlanningItemCard key={item.id} item={item} releases={releases}>
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
  const [roadmapSuggestions, setRoadmapSuggestions] = useState<ProductPlanningAiSuggestion[]>([]);
  const [roadmapAnalysis, setRoadmapAnalysis] = useState<ProductPlanningRoadmapAnalysis | null>(null);
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
  const { data: releases = [] } = useQuery<ProductPlanningRelease[]>({
    queryKey: ["/api/product-planning/releases"],
    queryFn: () => fetchJson<ProductPlanningRelease[]>("/api/product-planning/releases"),
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

  const roadmapSuggestionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/product-planning/roadmap/suggest-grouping", {});
      return (await res.json()).data as ProductPlanningAiSuggestion[];
    },
    onSuccess: (suggestions) => {
      setRoadmapSuggestions(suggestions);
      toast({ title: "Roadmap suggestions ready", description: `${suggestions.length} recommendation(s) generated.` });
    },
    onError: (error: Error) => toast({ title: "Roadmap suggestions failed", description: error.message, variant: "destructive" }),
  });

  const roadmapAnalysisMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/product-planning/roadmap/analyze", {});
      return (await res.json()).data as ProductPlanningRoadmapAnalysis;
    },
    onSuccess: (analysis) => {
      setRoadmapAnalysis(analysis);
      setRoadmapSuggestions(analysis.suggestions);
      toast({ title: "Roadmap analysis ready", description: `${analysis.recommendations.length} recommendation(s) generated.` });
    },
    onError: (error: Error) => toast({ title: "Roadmap analysis failed", description: error.message, variant: "destructive" }),
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
        <CardContent className="grid gap-3 p-4 md:grid-cols-[repeat(4,minmax(0,1fr))_auto_auto]">
          <FilterSelect value={filters.workItemType} onChange={(value) => setFilters({ ...filters, workItemType: value })} options={WORK_ITEM_TYPES} placeholder="Type" />
          <FilterSelect value={filters.priority} onChange={(value) => setFilters({ ...filters, priority: value })} options={PRIORITIES} placeholder="Priority" />
          <FilterSelect value={filters.planningStatus} onChange={(value) => setFilters({ ...filters, planningStatus: value })} options={STATUSES} placeholder="Status" />
          <Input value={filters.module} onChange={(event) => setFilters({ ...filters, module: event.target.value })} placeholder="Module" className="h-9" />
          <Button variant="outline" size="sm" onClick={() => roadmapSuggestionMutation.mutate()} disabled={roadmapSuggestionMutation.isPending} className="gap-2">
            <Brain className="h-4 w-4" />
            Suggest Grouping
          </Button>
          <Button variant="outline" size="sm" onClick={() => roadmapAnalysisMutation.mutate()} disabled={roadmapAnalysisMutation.isPending} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${roadmapAnalysisMutation.isPending ? "animate-spin" : ""}`} />
            Analyze Roadmap
          </Button>
        </CardContent>
      </Card>
      {roadmapAnalysis && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between gap-3 text-sm">
              <span>Roadmap Analysis</span>
              <AiSourceIndicator source={roadmapAnalysis.source} fallbackReason={roadmapAnalysis.fallbackReason} />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {roadmapAnalysis.summary && <p className="text-sm text-muted-foreground">{roadmapAnalysis.summary}</p>}
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {roadmapAnalysis.recommendations.map((recommendation) => (
                <div key={recommendation.phase} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{labelFor(PHASES, recommendation.phase as Phase) || recommendation.phase}</span>
                    <Badge variant={recommendation.action === "Balanced" ? "secondary" : "outline"}>{recommendation.action}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{recommendation.reasoning}</p>
                </div>
              ))}
            </div>
            {(roadmapAnalysis.moveRecommendations?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase text-muted-foreground">What Should Move</div>
                {roadmapAnalysis.moveRecommendations!.slice(0, 8).map((move) => (
                  <div key={`${move.reference}-${move.recommendedPhase}`} className="rounded-md border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{move.reference}: {labelFor(PHASES, move.currentPhase as Phase | null) || "Unassigned"} {"->"} {labelFor(PHASES, move.recommendedPhase)}</span>
                      <Badge variant="secondary">{move.confidence}%</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{move.reasoning}</p>
                  </div>
                ))}
              </div>
            )}
            {(roadmapAnalysis.deferRecommendations?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase text-muted-foreground">What Should Wait</div>
                {roadmapAnalysis.deferRecommendations!.slice(0, 8).map((move) => (
                  <div key={`${move.reference}-${move.recommendedPhase}-defer`} className="rounded-md border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{move.reference}: {labelFor(PHASES, move.currentPhase as Phase | null) || "Unassigned"} {"->"} {labelFor(PHASES, move.recommendedPhase)}</span>
                      <Badge variant="outline">{move.confidence}%</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{move.reasoning}</p>
                  </div>
                ))}
              </div>
            )}
            {(roadmapAnalysis.sequenceRecommendations?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase text-muted-foreground">What Should Happen First</div>
                {roadmapAnalysis.sequenceRecommendations!.slice(0, 6).map((sequence) => (
                  <div key={sequence.title} className="rounded-md border border-border p-3 text-sm">
                    <div className="font-medium">{sequence.title}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{sequence.reasoning}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {roadmapSuggestions.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Roadmap Suggestions</CardTitle></CardHeader>
          <CardContent className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {roadmapSuggestions.slice(0, 9).map((suggestion) => (
              <div key={suggestion.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline">{suggestion.confidence ?? 0}%</Badge>
                  <Badge variant="secondary">{displayAiValue(suggestion.suggestedValue)}</Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{suggestion.reasoning}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
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
                  <PlanningItemCard key={item.id} item={item} releases={releases}>
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
  releases,
  workItems,
  currentItem,
  children,
  onOpenChange,
  onSave,
  isSaving,
}: {
  open: boolean;
  form: WorkItemFormState;
  setForm: (form: WorkItemFormState) => void;
  availableParents: WorkItem[];
  releases: ProductPlanningRelease[];
  workItems: WorkItem[];
  currentItem?: WorkItem;
  children: WorkItemSummary[];
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  isSaving: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dependencyTarget, setDependencyTarget] = useState("");
  const [dependencyType, setDependencyType] = useState<DependencyType>("requires");
  const update = <K extends keyof WorkItemFormState>(key: K, value: WorkItemFormState[K]) => setForm({ ...form, [key]: value });
  const scoreComponents = (currentItem?.priorityScoreExplanation?.components ?? {}) as Record<string, number>;
  const dependencyQueryKey = ["/api/product-planning/work-items", form.id, "dependencies"];
  const { data: dependencies = [] } = useQuery<ProductPlanningDependency[]>({
    queryKey: dependencyQueryKey,
    queryFn: () => fetchJson<ProductPlanningDependency[]>(`/api/product-planning/work-items/${form.id}/dependencies`),
    enabled: open && Boolean(form.id),
  });
  const addDependencyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/product-planning/work-items/${form.id}/dependencies`, {
        dependsOnWorkItemId: dependencyTarget,
        dependencyType,
      });
      return (await res.json()).data as ProductPlanningDependency;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dependencyQueryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/product-planning/dashboard"] });
      setDependencyTarget("");
      toast({ title: "Dependency added" });
    },
    onError: (error: Error) => toast({ title: "Dependency failed", description: error.message, variant: "destructive" }),
  });
  const removeDependencyMutation = useMutation({
    mutationFn: async (dependencyId: string) => {
      const res = await apiRequest("DELETE", `/api/product-planning/work-items/${form.id}/dependencies/${dependencyId}`, {});
      return (await res.json()).data as ProductPlanningDependency;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dependencyQueryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/product-planning/dashboard"] });
      toast({ title: "Dependency removed" });
    },
    onError: (error: Error) => toast({ title: "Dependency remove failed", description: error.message, variant: "destructive" }),
  });
  const availableDependencies = workItems.filter((item) => item.id !== form.id);
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
          <div className="space-y-2">
            <Label>Release</Label>
            <Select value={form.releaseId || "none"} onValueChange={(value) => update("releaseId", value === "none" ? "" : value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {releases.map((release) => (
                  <SelectItem key={release.id} value={release.id}>{release.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Priority Score</Label>
            <div className="rounded-md border border-border p-3">
              <div className="grid gap-3 md:grid-cols-5">
                <SelectField label="User Impact" value={form.userImpact || "none"} includeNone options={SCORE_OPTIONS} onChange={(value) => update("userImpact", value === "none" ? "" : value)} />
                <SelectField label="Revenue" value={form.revenueImpact || "none"} includeNone options={SCORE_OPTIONS} onChange={(value) => update("revenueImpact", value === "none" ? "" : value)} />
                <SelectField label="Operations" value={form.operationalImpact || "none"} includeNone options={SCORE_OPTIONS} onChange={(value) => update("operationalImpact", value === "none" ? "" : value)} />
                <SelectField label="Risk Reduction" value={form.riskReduction || "none"} includeNone options={SCORE_OPTIONS} onChange={(value) => update("riskReduction", value === "none" ? "" : value)} />
                <SelectField label="Confidence" value={form.confidence || "none"} includeNone options={SCORE_OPTIONS} onChange={(value) => update("confidence", value === "none" ? "" : value)} />
              </div>
              {currentItem?.priorityScore != null && (
                <div className="mt-3 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                  <div className="font-medium text-foreground">Score {currentItem.priorityScore}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {Object.entries(scoreComponents).map(([key, value]) => (
                      <span key={key}>{key}: {value}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} className="min-h-[90px]" />
          </div>
          {form.id && (
            <div className="space-y-2 md:col-span-2">
              <Label>Dependencies</Label>
              <div className="space-y-3 rounded-md border border-border p-3">
                <div className="grid gap-2 md:grid-cols-[150px_minmax(0,1fr)_auto]">
                  <Select value={dependencyType} onValueChange={(value) => setDependencyType(value as DependencyType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DEPENDENCY_TYPES.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={dependencyTarget || "none"} onValueChange={(value) => setDependencyTarget(value === "none" ? "" : value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Select work item</SelectItem>
                      {availableDependencies.map((item) => (
                        <SelectItem key={item.id} value={item.id}>{item.reference} - {item.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" disabled={!dependencyTarget || addDependencyMutation.isPending} onClick={() => addDependencyMutation.mutate()} className="gap-2">
                    <Link2 className="h-4 w-4" />
                    Add
                  </Button>
                </div>
                {dependencies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No dependencies linked.</p>
                ) : dependencies.map((dependency) => (
                  <div key={dependency.id} className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-3 py-2 text-sm">
                    <div className="min-w-0 truncate">
                      <Badge variant="outline" className="mr-2">{labelFor(DEPENDENCY_TYPES, dependency.dependencyType)}</Badge>
                      <span className="font-mono text-xs text-muted-foreground">{dependency.dependsOnWorkItem?.reference}</span>
                      <span className="ml-2">{dependency.dependsOnWorkItem?.title ?? dependency.dependsOnWorkItemId}</span>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => removeDependencyMutation.mutate(dependency.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
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

export function ProductPlanningWorkItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [workItemAnalysis, setWorkItemAnalysis] = useState<ProductPlanningWorkItemAiAnalysis | null>(null);

  const { data: item, isLoading } = useQuery<WorkItemDetail>({
    queryKey: ["/api/product-planning/work-items", id, "detail"],
    queryFn: () => fetchJson<WorkItemDetail>(`/api/product-planning/work-items/${id}`),
    enabled: Boolean(id),
  });
  const { data: releases = [] } = useQuery<ProductPlanningRelease[]>({
    queryKey: ["/api/product-planning/releases"],
    queryFn: () => fetchJson<ProductPlanningRelease[]>("/api/product-planning/releases"),
  });
  const { data: workItems = [] } = useQuery<WorkItem[]>({
    queryKey: ["/api/product-planning/work-items", "detail-parent-options"],
    queryFn: () => fetchJson<WorkItem[]>("/api/product-planning/work-items?limit=250"),
  });
  const { data: aiSuggestions = [] } = useQuery<ProductPlanningAiSuggestion[]>({
    queryKey: ["/api/product-planning/work-items", id, "ai-suggestions"],
    queryFn: () => fetchJson<ProductPlanningAiSuggestion[]>(`/api/product-planning/work-items/${id}/ai-suggestions`),
    enabled: Boolean(id),
  });
  const [form, setForm] = useState<WorkItemFormState>(EMPTY_FORM);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/product-planning/work-items"] });
    queryClient.invalidateQueries({ queryKey: ["/api/product-planning/dashboard"] });
    if (id) queryClient.invalidateQueries({ queryKey: ["/api/product-planning/work-items", id, "detail"] });
    if (id) queryClient.invalidateQueries({ queryKey: ["/api/product-planning/work-items", id, "ai-suggestions"] });
  };

  const saveMutation = useMutation({
    mutationFn: async (next: WorkItemFormState) => {
      const res = await apiRequest("PATCH", `/api/product-planning/work-items/${next.id}`, payloadFromForm(next));
      return (await res.json()).data as WorkItem;
    },
    onSuccess: () => {
      invalidate();
      setModalOpen(false);
      toast({ title: "Work item saved" });
    },
    onError: (error: Error) => toast({ title: "Save failed", description: error.message, variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/product-planning/work-items/${id}/archive`, {});
      return (await res.json()).data as WorkItem;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Work item archived" });
    },
    onError: (error: Error) => toast({ title: "Archive failed", description: error.message, variant: "destructive" }),
  });

  const moveStatusMutation = useMutation({
    mutationFn: async (planningStatus: PlanningStatus) => {
      const res = await apiRequest("POST", `/api/product-planning/work-items/${id}/move-status`, { planningStatus });
      return (await res.json()).data as WorkItem;
    },
    onSuccess: invalidate,
    onError: (error: Error) => toast({ title: "Status move failed", description: error.message, variant: "destructive" }),
  });

  const movePhaseMutation = useMutation({
    mutationFn: async (phase: Phase | null) => {
      const res = await apiRequest("POST", `/api/product-planning/work-items/${id}/move-phase`, { phase });
      return (await res.json()).data as WorkItem;
    },
    onSuccess: invalidate,
    onError: (error: Error) => toast({ title: "Phase move failed", description: error.message, variant: "destructive" }),
  });

  const aiReviewMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/product-planning/work-items/${id}/ai/analyze`, {});
      return (await res.json()).data as ProductPlanningWorkItemAiAnalysis;
    },
    onSuccess: (analysis) => {
      setWorkItemAnalysis(analysis);
      invalidate();
      toast({ title: "AI review complete", description: `${analysis.suggestions.length} suggestion(s) ready for review.` });
    },
    onError: (error: Error) => toast({ title: "AI review failed", description: error.message, variant: "destructive" }),
  });

  const findSimilarMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/product-planning/work-items/${id}/find-duplicates`, {});
      return (await res.json()).data as { suggestions: ProductPlanningAiSuggestion[] };
    },
    onSuccess: (data) => {
      invalidate();
      toast({ title: "Duplicate review complete", description: `${data.suggestions.length} possible duplicate(s) stored.` });
    },
    onError: (error: Error) => toast({ title: "Duplicate review failed", description: error.message, variant: "destructive" }),
  });

  const implementationNotesMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/product-planning/work-items/${id}/generate-implementation-notes`, {});
      return (await res.json()).data as ProductPlanningAiSuggestion;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Implementation notes suggestion ready" });
    },
    onError: (error: Error) => toast({ title: "Notes generation failed", description: error.message, variant: "destructive" }),
  });

  const suggestEpicMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/product-planning/work-items/${id}/suggest-epic`, {});
      return (await res.json()).data as ProductPlanningAiSuggestion[];
    },
    onSuccess: (suggestions) => {
      invalidate();
      toast({ title: "Epic suggestion ready", description: `${suggestions.length} suggestion(s) stored.` });
    },
    onError: (error: Error) => toast({ title: "Epic suggestion failed", description: error.message, variant: "destructive" }),
  });

  const suggestRoadmapMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/product-planning/work-items/${id}/suggest-roadmap-placement`, {});
      return (await res.json()).data as ProductPlanningAiSuggestion[];
    },
    onSuccess: (suggestions) => {
      invalidate();
      toast({ title: "Roadmap suggestion ready", description: `${suggestions.length} suggestion(s) stored.` });
    },
    onError: (error: Error) => toast({ title: "Roadmap suggestion failed", description: error.message, variant: "destructive" }),
  });

  const acceptSuggestionMutation = useMutation({
    mutationFn: async (suggestionId: string) => {
      const res = await apiRequest("POST", `/api/product-planning/ai-suggestions/${suggestionId}/accept`, {});
      return (await res.json()).data as { suggestion: ProductPlanningAiSuggestion; workItem: WorkItem | null };
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "AI suggestion accepted" });
    },
    onError: (error: Error) => toast({ title: "Accept failed", description: error.message, variant: "destructive" }),
  });

  const rejectSuggestionMutation = useMutation({
    mutationFn: async (suggestionId: string) => {
      const res = await apiRequest("POST", `/api/product-planning/ai-suggestions/${suggestionId}/reject`, {});
      return (await res.json()).data as ProductPlanningAiSuggestion;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "AI suggestion rejected" });
    },
    onError: (error: Error) => toast({ title: "Reject failed", description: error.message, variant: "destructive" }),
  });

  if (isLoading || !item) {
    return (
      <ProductPlanningShell>
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </ProductPlanningShell>
    );
  }

  const relatedDependencies = [
    ...(item.dependencies ?? []).filter((dependency) => dependency.dependencyType === "relates_to").map((dependency) => dependency.dependsOnWorkItem),
    ...(item.blockedBy ?? []).filter((dependency) => dependency.dependencyType === "relates_to").map((dependency) => dependency.workItem),
  ].filter(Boolean) as WorkItemSummary[];
  const dependsOn = (item.dependencies ?? []).filter((dependency) => dependency.dependencyType !== "relates_to");
  const blockedBy = (item.blockedBy ?? []).filter((dependency) => dependency.dependencyType !== "relates_to");

  return (
    <ProductPlanningShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate(ROUTES.productPlanning.backlog)} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Backlog
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => { setForm(formFromItem(item)); setModalOpen(true); }} className="gap-2">
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
          <Button variant="outline" size="sm" onClick={() => archiveMutation.mutate()} className="gap-2">
            <Archive className="h-4 w-4" />
            Archive
          </Button>
          <InlineSelect value={item.planningStatus} options={STATUSES} onChange={(value) => moveStatusMutation.mutate(value as PlanningStatus)} />
          <InlineSelect value={item.phase ?? ""} includeNone options={PHASES} onChange={(value) => movePhaseMutation.mutate((value || null) as Phase | null)} />
        </div>
      </div>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="font-mono text-sm font-semibold text-primary">{item.reference}</div>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <h2 className="max-w-4xl text-2xl font-semibold">{item.title}</h2>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{labelFor(STATUSES, item.planningStatus)}</Badge>
              <Badge variant={priorityBadge(item.priority)}>{item.priority}</Badge>
              <Badge variant="outline">{labelFor(WORK_ITEM_TYPES, item.workItemType)}</Badge>
              {item.phase && <Badge variant="secondary">{labelFor(PHASES, item.phase)}</Badge>}
              {releaseName(item) && <Badge variant="secondary">{releaseName(item)}</Badge>}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <div className="space-y-4">
          <ReadOnlySection title="Description" emptyText="No description has been added.">
            {item.description}
          </ReadOnlySection>
          <ReadOnlySection title="Notes" emptyText="No notes have been added.">
            {item.notes}
          </ReadOnlySection>
          <DetailDependencies dependsOn={dependsOn} blockedBy={blockedBy} related={relatedDependencies} />
          <DetailHierarchy parent={item.parent ?? null} children={item.children ?? []} />
          <DetailTimeline events={item.events ?? []} />
        </div>
        <div className="space-y-4">
          <AiSuggestionsPanel
            suggestions={aiSuggestions}
            analysis={workItemAnalysis}
            onReview={() => aiReviewMutation.mutate()}
            onFindSimilar={() => findSimilarMutation.mutate()}
            onGenerateNotes={() => implementationNotesMutation.mutate()}
            onSuggestEpic={() => suggestEpicMutation.mutate()}
            onSuggestRoadmap={() => suggestRoadmapMutation.mutate()}
            onAccept={(suggestionId) => acceptSuggestionMutation.mutate(suggestionId)}
            onReject={(suggestionId) => rejectSuggestionMutation.mutate(suggestionId)}
            isBusy={aiReviewMutation.isPending || findSimilarMutation.isPending || implementationNotesMutation.isPending || suggestEpicMutation.isPending || suggestRoadmapMutation.isPending || acceptSuggestionMutation.isPending || rejectSuggestionMutation.isPending}
          />
          <DetailGrid item={item} />
          <DetailSource item={item} />
        </div>
      </div>

      <WorkItemDialog
        open={modalOpen}
        form={form}
        setForm={setForm}
        availableParents={workItems.filter((candidate) => candidate.workItemType === "epic" && candidate.id !== item.id)}
        releases={releases}
        workItems={workItems}
        currentItem={item}
        children={item.children ?? []}
        onOpenChange={setModalOpen}
        onSave={() => saveMutation.mutate(form)}
        isSaving={saveMutation.isPending}
      />
    </ProductPlanningShell>
  );
}

function AiSuggestionsPanel({
  suggestions,
  analysis,
  onReview,
  onFindSimilar,
  onGenerateNotes,
  onSuggestEpic,
  onSuggestRoadmap,
  onAccept,
  onReject,
  isBusy,
}: {
  suggestions: ProductPlanningAiSuggestion[];
  analysis: ProductPlanningWorkItemAiAnalysis | null;
  onReview: () => void;
  onFindSimilar: () => void;
  onGenerateNotes: () => void;
  onSuggestEpic: () => void;
  onSuggestRoadmap: () => void;
  onAccept: (suggestionId: string) => void;
  onReject: (suggestionId: string) => void;
  isBusy: boolean;
}) {
  const pending = suggestions.filter((suggestion) => suggestion.status === "pending");
  const history = suggestions.filter((suggestion) => suggestion.status !== "pending").slice(0, 5);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Brain className="h-4 w-4 text-primary" />
          AI Suggestions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {analysis && (
          <div className="space-y-2 rounded-md border border-border p-3 text-sm">
            <AiSourceIndicator source={analysis.source} fallbackReason={analysis.fallbackReason} />
            <p>{analysis.summary}</p>
            {analysis.nextActions.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-medium uppercase text-muted-foreground">Next Actions</div>
                {analysis.nextActions.slice(0, 5).map((action) => <div key={action} className="text-xs text-muted-foreground">{action}</div>)}
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onReview} disabled={isBusy}>Analyze Work Item</Button>
          <Button variant="outline" size="sm" onClick={onFindSimilar} disabled={isBusy}>Find Similar Items</Button>
          <Button variant="outline" size="sm" onClick={onGenerateNotes} disabled={isBusy}>Implementation Notes</Button>
          <Button variant="outline" size="sm" onClick={onSuggestEpic} disabled={isBusy}>Suggest Epic</Button>
          <Button variant="outline" size="sm" onClick={onSuggestRoadmap} disabled={isBusy}>Suggest Roadmap Placement</Button>
        </div>
        {pending.length === 0 ? (
          <div className="space-y-2 rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            <div>No pending AI suggestions.</div>
            <div>AI suggestions require review before anything changes.</div>
            <div>Run an analysis action above to generate priority, module, phase, epic, duplicate, release, or implementation-note suggestions for review.</div>
          </div>
        ) : pending.map((suggestion) => (
          <div key={suggestion.id} className="space-y-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant="outline" className="capitalize">{suggestionTypeLabel(suggestion.suggestionType)}</Badge>
              <Badge variant="secondary">{suggestion.confidence ?? 0}% confidence</Badge>
            </div>
            <div className="grid gap-2 text-xs sm:grid-cols-2">
              <div>
                <div className="font-medium uppercase text-muted-foreground">Current</div>
                <div className="mt-1 whitespace-pre-wrap text-sm">{displayAiValue(suggestion.currentValue)}</div>
              </div>
              <div>
                <div className="font-medium uppercase text-muted-foreground">Suggested</div>
                <div className="mt-1 whitespace-pre-wrap text-sm">{displayAiValue(suggestion.suggestedValue)}</div>
              </div>
            </div>
            {suggestion.reasoning && <p className="text-xs text-muted-foreground">{suggestion.reasoning}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => onReject(suggestion.id)} disabled={isBusy}>Reject</Button>
              <Button size="sm" onClick={() => onAccept(suggestion.id)} disabled={isBusy}>Accept</Button>
            </div>
          </div>
        ))}
        {history.length > 0 && (
          <div className="space-y-1 border-t border-border pt-3">
            <div className="text-xs font-medium uppercase text-muted-foreground">Reviewed</div>
            {history.map((suggestion) => (
              <div key={suggestion.id} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="capitalize">{suggestionTypeLabel(suggestion.suggestionType)}</span>
                <Badge variant="secondary">{suggestion.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReadOnlySection({ title, emptyText, children }: { title: string; emptyText: string; children?: string | null }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent>
        <p className="whitespace-pre-wrap text-sm text-foreground">{children || <span className="text-muted-foreground">{emptyText}</span>}</p>
      </CardContent>
    </Card>
  );
}

function DetailGrid({ item }: { item: WorkItemDetail }) {
  const rows = [
    ["Priority", item.priority],
    ["Business Value", labelFor(BUSINESS_VALUES, item.businessValue)],
    ["Complexity", labelFor(COMPLEXITIES, item.complexity)],
    ["Priority Score", item.priorityScore == null ? "-" : String(item.priorityScore)],
    ["Phase", labelFor(PHASES, item.phase) || "-"],
    ["Release", releaseName(item) || "-"],
    ["Module", item.module || "-"],
    ["Submodule", item.submodule || "-"],
    ["Owner", item.ownerUserId || "-"],
    ["Requested By", item.requestedBy || "-"],
    ["Due Date", displayDate(item.dueDate)],
    ["Created", displayDate(item.createdAt)],
    ["Updated", displayDate(item.updatedAt)],
  ];
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Planning Details</CardTitle></CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-md border border-border p-3">
            <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
            <div className="mt-1 text-sm">{value}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function DetailSource({ item }: { item: WorkItemDetail }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Source</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div>Source Type: <Badge variant="secondary">{item.sourceType ? item.sourceType.replace("_", " ") : "Manual"}</Badge></div>
        {item.sourceBugReport && (
          <div className="rounded-md border border-border p-3">
            <div className="font-mono text-xs text-muted-foreground">{item.sourceBugReport.referenceNumber}</div>
            <div className="mt-1 font-medium">{item.sourceBugReport.title}</div>
            <Link to={ROUTES.admin.bugReports} className="mt-2 inline-block text-xs text-primary hover:underline">Open Bug Reports</Link>
          </div>
        )}
        {item.importBatch && (
          <div className="rounded-md border border-border p-3">
            <div className="font-medium">{item.importBatch.filename || "CSV import"}</div>
            <div className="mt-1 text-xs text-muted-foreground">{item.importBatch.importedCount} imported, {item.importBatch.skippedCount} skipped</div>
          </div>
        )}
        {item.sourceReference && <div>Original Reference: {item.sourceReference}</div>}
      </CardContent>
    </Card>
  );
}

export function DetailDependencies({ dependsOn, blockedBy, related }: { dependsOn: ProductPlanningDependency[]; blockedBy: ProductPlanningBlockedBy[]; related: WorkItemSummary[] }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Dependencies</CardTitle></CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3">
        <DependencyList title="Depends On" items={dependsOn.map((dependency) => dependency.dependsOnWorkItem).filter(Boolean) as WorkItemSummary[]} />
        <DependencyList title="Blocked By" items={blockedBy.map((dependency) => dependency.workItem).filter(Boolean) as WorkItemSummary[]} />
        <DependencyList title="Related Items" items={related} />
      </CardContent>
    </Card>
  );
}

function DependencyList({ title, items }: { title: string; items: WorkItemSummary[] }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase text-muted-foreground">{title}</div>
      <div className="mt-2 space-y-2">
        {items.length === 0 ? <p className="text-sm text-muted-foreground">No items linked.</p> : items.map((item) => (
          <Link key={item.id} to={workItemPath(item.id)} className="block rounded-md border border-border p-2 text-sm hover:bg-muted/40">
            <span className="mr-2 font-mono text-xs text-muted-foreground">{item.reference}</span>
            {item.title}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function DetailHierarchy({ parent, children }: { parent: WorkItemSummary | null; children: WorkItemSummary[] }) {
  if (!parent && children.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Epic / Hierarchy</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {parent && <DependencyList title="Parent Epic" items={[parent]} />}
        {children.length > 0 && <DependencyList title="Child Items" items={children} />}
      </CardContent>
    </Card>
  );
}

export function DetailTimeline({ events }: { events: ProductPlanningEvent[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <History className="h-4 w-4" />
          Activity Timeline
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {events.length === 0 ? <p className="text-sm text-muted-foreground">No activity recorded yet.</p> : events.map((event) => (
          <div key={event.id} className="border-l-2 border-border pl-3">
            <div className="text-sm font-medium">{event.message || event.eventType.replace(/_/g, " ")}</div>
            <div className="text-xs text-muted-foreground">{displayDate(event.createdAt, true)}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function ProductPlanningImportsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filename, setFilename] = useState<string | null>(null);
  const [csv, setCsv] = useState("");
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [lastImportResult, setLastImportResult] = useState<ImportCommitResult | null>(null);
  const [importSuggestions, setImportSuggestions] = useState<ProductPlanningAiSuggestion[]>([]);
  const [importAnalysis, setImportAnalysis] = useState<ProductPlanningBacklogAnalysis | null>(null);
  const [importReviewSource, setImportReviewSource] = useState<{ source?: ProductPlanningAiSource; fallbackReason?: string | null; summary?: string } | null>(null);
  const [bulkImportReviewStatus, setBulkImportReviewStatus] = useState<AiSuggestionStatus | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetResult, setResetResult] = useState<ProductPlanningResetResult | null>(null);

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
      return (await res.json()).data as ImportCommitResult;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/product-planning/imports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/product-planning/work-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/product-planning/dashboard"] });
      toast({ title: "Import completed", description: `${data.importedItems?.length ?? 0} rows imported.` });
      setLastImportResult(data);
      setImportAnalysis(null);
      setImportReviewSource(null);
      setPreview(null);
      setCsv("");
      setFilename(null);
    },
    onError: (error: Error) => toast({ title: "Import failed", description: error.message, variant: "destructive" }),
  });

  const importAiReviewMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/product-planning/import/csv/ai-review", { csv, filename });
      return (await res.json()).data as { suggestions: ProductPlanningAiSuggestion[]; source?: ProductPlanningAiSource; fallbackReason?: string | null; summary?: string };
    },
    onSuccess: (data) => {
      setImportSuggestions(data.suggestions);
      setImportReviewSource({ source: data.source, fallbackReason: data.fallbackReason, summary: data.summary });
      toast({ title: "Import AI review complete", description: `${data.suggestions.length} suggestion(s) ready.` });
    },
    onError: (error: Error) => toast({ title: "Import AI review failed", description: error.message, variant: "destructive" }),
  });

  const analyzeImportedBacklogMutation = useMutation({
    mutationFn: async (batchId: string) => {
      const res = await apiRequest("POST", `/api/product-planning/imports/${batchId}/analyze`, {});
      return (await res.json()).data as ProductPlanningBacklogAnalysis;
    },
    onSuccess: (analysis) => {
      setImportAnalysis(analysis);
      setImportSuggestions(analysis.suggestions);
      toast({ title: "Imported backlog analysis ready", description: `${analysis.suggestions.length} suggestion(s) stored.` });
    },
    onError: (error: Error) => toast({ title: "Imported backlog analysis failed", description: error.message, variant: "destructive" }),
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/product-planning/admin/reset", { confirmation: resetConfirmation });
      return (await res.json()).data as ProductPlanningResetResult;
    },
    onSuccess: (data) => {
      setResetResult(data);
      setResetDialogOpen(false);
      setResetConfirmation("");
      setPreview(null);
      setLastImportResult(null);
      setImportSuggestions([]);
      setImportAnalysis(null);
      setImportReviewSource(null);
      queryClient.invalidateQueries({ queryKey: ["/api/product-planning/imports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/product-planning/work-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/product-planning/dashboard"] });
      toast({ title: "Product Planning reset complete", description: `${data.counts.productPlanningWorkItems} work item(s) deleted.` });
    },
    onError: (error: Error) => toast({ title: "Reset failed", description: error.message, variant: "destructive" }),
  });

  const updateImportSuggestionStatus = (suggestionId: string, status: AiSuggestionStatus) => {
    setImportSuggestions((current) => current.map((suggestion) => (
      suggestion.id === suggestionId
        ? { ...suggestion, status, reviewedAt: new Date().toISOString() }
        : suggestion
    )));
  };

  const reviewImportSuggestionMutation = useMutation({
    mutationFn: async ({ suggestionId, status }: { suggestionId: string; status: "accepted" | "rejected" }) => {
      const action = status === "accepted" ? "accept" : "reject";
      await apiRequest("POST", `/api/product-planning/ai-suggestions/${suggestionId}/${action}`, {});
      return { suggestionId, status };
    },
    onSuccess: ({ suggestionId, status }) => updateImportSuggestionStatus(suggestionId, status),
    onError: (error: Error) => toast({ title: "Import suggestion review failed", description: error.message, variant: "destructive" }),
  });

  async function reviewAllImportSuggestions(status: "accepted" | "rejected") {
    const pending = importSuggestions.filter((suggestion) => suggestion.status === "pending");
    if (pending.length === 0) return;
    setBulkImportReviewStatus(status);
    try {
      const action = status === "accepted" ? "accept" : "reject";
      await Promise.all(pending.map((suggestion) => (
        apiRequest("POST", `/api/product-planning/ai-suggestions/${suggestion.id}/${action}`, {})
      )));
      setImportSuggestions((current) => current.map((suggestion) => (
        suggestion.status === "pending"
          ? { ...suggestion, status, reviewedAt: new Date().toISOString() }
          : suggestion
      )));
      toast({ title: "Import suggestions reviewed", description: `${pending.length} suggestion(s) ${status}.` });
    } catch (error) {
      toast({
        title: "Bulk review failed",
        description: error instanceof Error ? error.message : "Failed to review import suggestions.",
        variant: "destructive",
      });
    } finally {
      setBulkImportReviewStatus(null);
    }
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    setFilename(file.name);
    setCsv(await file.text());
    setPreview(null);
    setLastImportResult(null);
    setImportSuggestions([]);
    setImportAnalysis(null);
    setImportReviewSource(null);
  }

  function downloadTemplate() {
    const csvTemplate = `${PRODUCT_PLANNING_TEMPLATE_COLUMNS.join(",")}\n`;
    const blob = new Blob([csvTemplate], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "product-planning-template.csv";
    link.click();
    window.URL.revokeObjectURL(url);
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
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Seed CSV Template</div>
                  <p className="mt-1 text-xs text-muted-foreground">Use richer planning context so AI can reason about operational readiness, not just categorize rows.</p>
                </div>
                <Button variant="outline" size="sm" onClick={downloadTemplate}>Download Template</Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {PRODUCT_PLANNING_TEMPLATE_COLUMNS.map((column) => (
                  <Badge key={column} variant="outline">{column}</Badge>
                ))}
              </div>
            </div>
            <Input type="file" accept=".csv,text/csv" onChange={(event) => handleFile(event.target.files?.[0] ?? null)} />
            {filename && <p className="text-sm text-muted-foreground">{filename}</p>}
            <Textarea value={csv} onChange={(event) => { setCsv(event.target.value); setPreview(null); setImportSuggestions([]); }} placeholder="CSV contents" className="min-h-[180px] font-mono text-xs" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={allowDuplicates} onChange={(event) => setAllowDuplicates(event.target.checked)} />
                Allow duplicates
              </label>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => previewMutation.mutate()} disabled={!csv.trim() || previewMutation.isPending}>
                  {previewMutation.isPending ? "Previewing..." : "Preview"}
                </Button>
                <Button variant="outline" onClick={() => importAiReviewMutation.mutate()} disabled={!preview || importAiReviewMutation.isPending}>
                  {importAiReviewMutation.isPending ? "Reviewing..." : "AI Review Import"}
                </Button>
                <Button onClick={() => commitMutation.mutate()} disabled={!preview || preview.counts.valid === 0 || commitMutation.isPending}>
                  {commitMutation.isPending ? "Importing..." : "Confirm Import"}
                </Button>
              </div>
            </div>
            {lastImportResult && (
              <div className="rounded-md border border-border bg-muted/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">Import result</div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <Badge variant="secondary">{lastImportResult.batch.importedCount} imported</Badge>
                      <Badge variant={lastImportResult.batch.skippedCount > 0 ? "outline" : "secondary"}>{lastImportResult.batch.skippedCount} skipped</Badge>
                      <Badge variant={lastImportResult.skippedRows.length > 0 ? "outline" : "secondary"}>{lastImportResult.skippedRows.length} warnings</Badge>
                      <Badge variant={allowDuplicates ? "outline" : "secondary"}>{allowDuplicates ? "Duplicates allowed" : "Duplicates skipped"}</Badge>
                    </div>
                  </div>
                  <Link to={`${ROUTES.productPlanning.backlog}?importedBatchId=${lastImportResult.batch.id}`}>
                    <Button variant="outline" size="sm">View Imported Items</Button>
                  </Link>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => analyzeImportedBacklogMutation.mutate(lastImportResult.batch.id)}
                    disabled={analyzeImportedBacklogMutation.isPending}
                  >
                    {analyzeImportedBacklogMutation.isPending ? "Analyzing..." : "Analyze Imported Backlog"}
                  </Button>
                </div>
                {lastImportResult.skippedRows.length > 0 && (
                  <div className="mt-3 max-h-28 overflow-auto text-xs text-muted-foreground">
                    {lastImportResult.skippedRows.slice(0, 5).map((row) => (
                      <div key={row.rowNumber}>Row {row.rowNumber}: {row.reason}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {importAnalysis && <BacklogAiAnalysisPanel analysis={importAnalysis} />}
            {preview && <ImportPreviewTable preview={preview} />}
            {importSuggestions.length > 0 && (
              <ImportAiSuggestions
                suggestions={importSuggestions}
                onAccept={(suggestionId) => reviewImportSuggestionMutation.mutate({ suggestionId, status: "accepted" })}
                onReject={(suggestionId) => reviewImportSuggestionMutation.mutate({ suggestionId, status: "rejected" })}
                onBulkAccept={() => reviewAllImportSuggestions("accepted")}
                onBulkReject={() => reviewAllImportSuggestions("rejected")}
                isReviewing={reviewImportSuggestionMutation.isPending || Boolean(bulkImportReviewStatus)}
                source={importReviewSource?.source}
                fallbackReason={importReviewSource?.fallbackReason}
                summary={importReviewSource?.summary}
              />
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm text-destructive">
                <Trash2 className="h-4 w-4" />
                Danger Zone
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                This will clear Product Planning work items, AI suggestions, planning events, import batches, releases, and dependencies for the current organization only. It will not delete Bug Reports or operational app data.
              </p>
              <Button variant="outline" onClick={() => setResetDialogOpen(true)} className="border-destructive/50 text-destructive hover:text-destructive">
                Reset Product Planning Data
              </Button>
              {resetResult && (
                <div className="rounded-md border border-border p-3 text-sm">
                  <div className="font-medium">Reset completed</div>
                  <div className="mt-2 grid gap-2">
                    <ResetCount label="Work items" value={resetResult.counts.productPlanningWorkItems} />
                    <ResetCount label="AI suggestions" value={resetResult.counts.productPlanningAiSuggestions} />
                    <ResetCount label="Events" value={resetResult.counts.productPlanningEvents} />
                    <ResetCount label="Dependencies" value={resetResult.counts.productPlanningDependencies} />
                    <ResetCount label="Import batches" value={resetResult.counts.productPlanningImportBatches} />
                    <ResetCount label="Releases" value={resetResult.counts.productPlanningReleases} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Reference counter reset: {resetResult.referenceCounterReset ? "Yes" : "No existing counter found"}. Re-import a clean CSV when ready.
                  </p>
                </div>
              )}
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
      </div>
      <Dialog open={resetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Product Planning Data</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This will clear Product Planning work items, AI suggestions, planning events, import batches, releases, and dependencies for the current organization only. It will not delete Bug Reports or operational app data.
            </p>
            <div className="space-y-2">
              <Label htmlFor="product-planning-reset-confirmation">Type {PRODUCT_PLANNING_RESET_CONFIRMATION} to confirm</Label>
              <Input
                id="product-planning-reset-confirmation"
                value={resetConfirmation}
                onChange={(event) => setResetConfirmation(event.target.value)}
                placeholder={PRODUCT_PLANNING_RESET_CONFIRMATION}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResetDialogOpen(false); setResetConfirmation(""); }} disabled={resetMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="outline"
              className="border-destructive/50 text-destructive hover:text-destructive"
              onClick={() => resetMutation.mutate()}
              disabled={resetConfirmation !== PRODUCT_PLANNING_RESET_CONFIRMATION || resetMutation.isPending}
            >
              {resetMutation.isPending ? "Resetting..." : "Reset Product Planning Data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ProductPlanningShell>
  );
}

function ResetCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Badge variant="secondary">{value}</Badge>
    </div>
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

function ImportAiSuggestions({
  suggestions,
  onAccept,
  onReject,
  onBulkAccept,
  onBulkReject,
  isReviewing,
  source,
  fallbackReason,
  summary,
}: {
  suggestions: ProductPlanningAiSuggestion[];
  onAccept: (suggestionId: string) => void;
  onReject: (suggestionId: string) => void;
  onBulkAccept: () => void;
  onBulkReject: () => void;
  isReviewing: boolean;
  source?: ProductPlanningAiSource;
  fallbackReason?: string | null;
  summary?: string;
}) {
  const pendingCount = suggestions.filter((suggestion) => suggestion.status === "pending").length;
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Brain className="h-4 w-4 text-primary" />
          AI Import Review
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onBulkReject} disabled={pendingCount === 0 || isReviewing}>
            Bulk Reject
          </Button>
          <Button variant="outline" size="sm" onClick={onBulkAccept} disabled={pendingCount === 0 || isReviewing}>
            Bulk Accept
          </Button>
        </div>
      </div>
      <AiSourceIndicator source={source} fallbackReason={fallbackReason} />
      {summary && <p className="text-xs text-muted-foreground">{summary}</p>}
      <div className="grid gap-2 md:grid-cols-2">
        {suggestions.map((suggestion) => (
          <div key={suggestion.id} className="rounded-md border border-border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant="outline">{suggestionTypeLabel(suggestion.suggestionType)}</Badge>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{suggestion.confidence ?? 0}%</Badge>
                <Badge variant={suggestion.status === "pending" ? "outline" : "secondary"}>{suggestion.status}</Badge>
              </div>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">{suggestion.reasoning}</div>
            <div className="mt-2 text-xs">
              <span className="font-medium">Suggest: </span>{displayAiValue(suggestion.suggestedValue)}
            </div>
            {suggestion.status === "pending" && (
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => onReject(suggestion.id)} disabled={isReviewing}>
                  Reject
                </Button>
                <Button size="sm" onClick={() => onAccept(suggestion.id)} disabled={isReviewing}>
                  Accept
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProductPlanningIndexRedirect() {
  return <Navigate to={ROUTES.productPlanning.dashboard} replace />;
}
