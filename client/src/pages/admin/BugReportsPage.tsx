import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Brain, Bug, Download, ExternalLink, FileText, RefreshCw, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { AiReviewPanel } from "@/components/bug-report/AiReviewPanel";
import { getAiReviewPollingInterval } from "@/components/bug-report/aiReviewPolling";
import type { CurrentBugAiReviewResponse } from "@shared/aiReviewContracts";
import type { AiTriageBriefDto, AiTriageBriefListResponse } from "@shared/aiTriageBriefContracts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BugReportListItem {
  id: string;
  type: "bug" | "feature";
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  status: string;
  createdAt: string;
  createdByEmail: string;
  url: string;
}

interface BugReportDetail extends BugReportListItem {
  description: string;
  userAgent: string;
  screenWidth: number | null;
  screenHeight: number | null;
  screenshotUrl: string | null; // DEPRECATED: backward compatibility
  screenshotUrls: string[];
  metadata: Record<string, unknown>;
}

interface BugReportNote {
  id: string;
  bugReportId: string;
  orgId: string;
  createdByUserId: string | null;
  createdByEmail: string;
  note: string;
  createdAt: string;
}

class AiReviewApiError extends Error {
  status: number;
  code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = "AiReviewApiError";
    this.status = status;
    this.code = code;
  }
}

class AiTriageBriefApiError extends Error {
  status: number;
  code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = "AiTriageBriefApiError";
    this.status = status;
    this.code = code;
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "open",      label: "Open" },
  { value: "in_review", label: "In review" },
  { value: "resolved",  label: "Resolved" },
  { value: "closed",    label: "Closed" },
] as const;

const SEVERITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  low:      "secondary",
  medium:   "outline",
  high:     "default",
  critical: "destructive",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  open:      "default",
  in_review: "secondary",
  resolved:  "outline",
  closed:    "outline",
};

const TYPE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  bug: "destructive",
  feature: "secondary",
};

const TYPE_LABELS: Record<string, string> = {
  bug: "Bug",
  feature: "Feature",
};

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchBugReports(params: { status?: string; severity?: string; type?: string }) {
  const qs = new URLSearchParams();
  if (params.status && params.status !== "all")   qs.set("status", params.status);
  if (params.severity && params.severity !== "all") qs.set("severity", params.severity);
  if (params.type && params.type !== "all") qs.set("type", params.type);
  const res = await fetch(`/api/bug-reports?${qs.toString()}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch bug reports");
  const body = await res.json();
  return body.data as BugReportListItem[];
}

async function fetchBugReportDetail(id: string): Promise<BugReportDetail> {
  const res = await fetch(`/api/bug-reports/${id}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch bug report");
  const body = await res.json();
  return body.data as BugReportDetail;
}

async function fetchScreenshotUrls(id: string): Promise<Array<{ path: string; url: string }>> {
  const res = await fetch(`/api/bug-reports/${id}/screenshot-urls`, { credentials: "include" });
  if (!res.ok) {
    console.error("Failed to fetch screenshot URLs");
    return [];
  }
  const body = await res.json();
  return body.data || [];
}

async function patchBugReportStatus(id: string, status: string): Promise<{ id: string; status: string }> {
  const res = await fetch(`/api/bug-reports/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? "Failed to update status");
  }
  const body = await res.json();
  return (body.data ?? {}) as { id: string; status: string };
}

async function fetchNotes(bugReportId: string): Promise<BugReportNote[]> {
  const res = await fetch(`/api/bug-reports/${bugReportId}/notes`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch notes");
  const body = await res.json();
  return body.data as BugReportNote[];
}

async function postNote(bugReportId: string, note: string): Promise<BugReportNote> {
  const res = await fetch(`/api/bug-reports/${bugReportId}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? "Failed to add note");
  }
  const body = await res.json();
  return body.data as BugReportNote;
}

async function fetchAiReview(bugReportId: string): Promise<CurrentBugAiReviewResponse> {
  const res = await fetch(`/api/bug-reports/${bugReportId}/ai-review`, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string; code?: string };
    throw new AiReviewApiError(
      res.status,
      body.message ?? "Failed to fetch AI review",
      body.code ?? null,
    );
  }
  const body = await res.json();
  return body.data as CurrentBugAiReviewResponse;
}

async function createAiReview(bugReportId: string): Promise<{ reviewId: string; status: string }> {
  const res = await fetch(`/api/bug-reports/${bugReportId}/ai-review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? "Failed to queue AI review");
  }
  const body = await res.json();
  return body.data as { reviewId: string; status: string };
}

async function rerunAiReview(reviewId: string): Promise<{ reviewId: string; status: string }> {
  const res = await fetch(`/api/ai-reviews/${reviewId}/rerun`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? "Failed to rerun AI review");
  }
  const body = await res.json();
  return body.data as { reviewId: string; status: string };
}

async function fetchAiTriageBriefs(): Promise<AiTriageBriefListResponse> {
  const res = await fetch("/api/bug-reports/ai-triage-briefs", { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string; code?: string };
    throw new AiTriageBriefApiError(
      res.status,
      body.message ?? "Failed to fetch AI triage briefs",
      body.code ?? null,
    );
  }
  const body = await res.json();
  return body.data as AiTriageBriefListResponse;
}

async function fetchAiTriageBrief(briefId: string): Promise<AiTriageBriefDto> {
  const res = await fetch(`/api/bug-reports/ai-triage-briefs/${briefId}`, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string; code?: string };
    throw new AiTriageBriefApiError(
      res.status,
      body.message ?? "Failed to fetch AI triage brief",
      body.code ?? null,
    );
  }
  const body = await res.json();
  return body.data as AiTriageBriefDto;
}

async function createAiTriageBrief(filters: { status: string; severity: string; type: string }): Promise<{ briefId: string; status: string }> {
  const res = await fetch("/api/bug-reports/ai-triage-brief", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ filters }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? "Failed to queue AI triage brief");
  }
  const body = await res.json();
  return body.data as { briefId: string; status: string };
}

export function hasActiveTriageBrief(data: AiTriageBriefListResponse | undefined): boolean {
  return Boolean(data?.briefs.some((brief) => brief.status === "pending" || brief.status === "processing"));
}

export function canGenerateAiTriageBrief(data: AiTriageBriefListResponse | undefined, isPending: boolean): boolean {
  return Boolean(data?.featureEnabled && data?.canGenerate && !isPending);
}

export function canExportAiTriageBriefPdf(brief: AiTriageBriefDto, isAdminOrOwner: boolean): boolean {
  return isAdminOrOwner && brief.status === "completed";
}

function getAiTriageBriefPdfUrl(briefId: string): string {
  return `/api/bug-reports/ai-triage-briefs/${encodeURIComponent(briefId)}/pdf`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BugReportsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter]     = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [typeFilter, setTypeFilter]         = useState("all");
  const [selectedId, setSelectedId]         = useState<string | null>(null);
  const [selectedBriefId, setSelectedBriefId] = useState<string | null>(null);
  const [noteText, setNoteText]             = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const isAdminOrOwner = user?.role === "admin" || user?.role === "owner";

  const { data: reports, isLoading, refetch, isRefetching } = useQuery<BugReportListItem[]>({
    queryKey: ["/api/bug-reports", statusFilter, severityFilter, typeFilter],
    queryFn: () => fetchBugReports({ status: statusFilter, severity: severityFilter, type: typeFilter }),
    enabled: isAdminOrOwner,
  });

  const { data: detail, isLoading: detailLoading } = useQuery<BugReportDetail>({
    queryKey: ["/api/bug-reports/detail", selectedId],
    queryFn: () => fetchBugReportDetail(selectedId!),
    enabled: !!selectedId,
  });

  const { data: screenshotUrls, isLoading: screenshotsLoading } = useQuery<Array<{ path: string; url: string }>>({
    queryKey: ["/api/bug-reports/screenshots", selectedId],
    queryFn: () => fetchScreenshotUrls(selectedId!),
    enabled: !!selectedId,
  });

  const { data: notes, isLoading: notesLoading } = useQuery<BugReportNote[]>({
    queryKey: ["/api/bug-reports/notes", selectedId],
    queryFn: () => fetchNotes(selectedId!),
    enabled: !!selectedId,
  });

  const { data: triageBriefData, isLoading: triageBriefsLoading } = useQuery<AiTriageBriefListResponse, Error>({
    queryKey: ["/api/bug-reports/ai-triage-briefs"],
    queryFn: fetchAiTriageBriefs,
    enabled: isAdminOrOwner,
    refetchInterval: (query) => hasActiveTriageBrief(query.state.data as AiTriageBriefListResponse | undefined) ? 3000 : false,
  });

  const { data: selectedBrief, isLoading: selectedBriefLoading } = useQuery<AiTriageBriefDto, Error>({
    queryKey: ["/api/bug-reports/ai-triage-briefs", selectedBriefId],
    queryFn: () => fetchAiTriageBrief(selectedBriefId!),
    enabled: Boolean(selectedBriefId),
    refetchInterval: (query) => {
      const brief = query.state.data as AiTriageBriefDto | undefined;
      return brief?.status === "pending" || brief?.status === "processing" ? 3000 : false;
    },
  });

  const { data: aiReviewData, isLoading: aiReviewLoading, error: aiReviewError } = useQuery<CurrentBugAiReviewResponse, Error>({
    queryKey: ["/api/bug-reports/ai-review", selectedId],
    queryFn: () => fetchAiReview(selectedId!),
    enabled: !!selectedId,
    refetchInterval: (query) => {
      return getAiReviewPollingInterval(query.state.data as CurrentBugAiReviewResponse | undefined);
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      patchBugReportStatus(id, status),
    onSuccess: (result) => {
      queryClient.setQueryData<BugReportDetail>(
        ["/api/bug-reports/detail", selectedId],
        (old) => old ? { ...old, status: result.status } : old,
      );
      queryClient.setQueryData<BugReportListItem[]>(
        ["/api/bug-reports", statusFilter, severityFilter, typeFilter],
        (old) => old?.map((r) => r.id === result.id ? { ...r, status: result.status } : r),
      );
      toast({ title: "Status updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const noteMutation = useMutation({
    mutationFn: (note: string) => postNote(selectedId!, note),
    onSuccess: () => {
      setNoteText("");
      queryClient.invalidateQueries({ queryKey: ["/api/bug-reports/notes", selectedId] });
      toast({ title: "Note added" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add note", description: err.message, variant: "destructive" });
    },
  });

  const createAiReviewMutation = useMutation({
    mutationFn: () => createAiReview(selectedId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bug-reports/ai-review", selectedId] });
      toast({ title: "AI review queued" });
    },
    onError: (err: Error) => {
      toast({ title: "AI review failed", description: err.message, variant: "destructive" });
    },
  });

  const rerunAiReviewMutation = useMutation({
    mutationFn: (reviewId: string) => rerunAiReview(reviewId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bug-reports/ai-review", selectedId] });
      toast({ title: "AI review queued" });
    },
    onError: (err: Error) => {
      toast({ title: "AI review failed", description: err.message, variant: "destructive" });
    },
  });

  const createTriageBriefMutation = useMutation({
    mutationFn: () => createAiTriageBrief({ status: statusFilter, severity: severityFilter, type: typeFilter }),
    onSuccess: (result) => {
      setSelectedBriefId(result.briefId);
      queryClient.invalidateQueries({ queryKey: ["/api/bug-reports/ai-triage-briefs"] });
      toast({ title: "AI triage brief queued" });
    },
    onError: (err: Error) => {
      toast({ title: "AI triage brief failed", description: err.message, variant: "destructive" });
    },
  });

  const handleAddNote = () => {
    const trimmed = noteText.trim();
    if (!trimmed) return;
    noteMutation.mutate(trimmed);
  };

  if (!isAdminOrOwner) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground text-sm">Access denied. Admin or Owner role required.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bug className="h-6 w-6 text-destructive" />
          <div>
            <h1 className="text-xl font-semibold text-foreground">Bug Reports</h1>
            <p className="text-sm text-muted-foreground">User-submitted bug reports and feature requests for your organization</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={() => createTriageBriefMutation.mutate()}
            disabled={!canGenerateAiTriageBrief(triageBriefData, createTriageBriefMutation.isPending)}
            className="gap-2"
          >
            <Brain className="h-4 w-4" />
            {createTriageBriefMutation.isPending ? "Generating..." : "Generate AI Triage Brief"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Status</span>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8 w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Severity</span>
              <Select value={severityFilter} onValueChange={setSeverityFilter}>
                <SelectTrigger className="h-8 w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All severities</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Type</span>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-8 w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="bug">Bug Reports</SelectItem>
                  <SelectItem value="feature">Feature Requests</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <AiTriageBriefHistoryPanel
        data={triageBriefData}
        isLoading={triageBriefsLoading}
        onSelect={setSelectedBriefId}
      />

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Created</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead className="w-full">Title</TableHead>
                <TableHead>Submitted by</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : !reports || reports.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    No feedback items found matching current filters.
                  </TableCell>
                </TableRow>
              ) : (
                reports.map((r) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedId(r.id)}
                  >
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {format(new Date(r.createdAt), "MMM d, yyyy HH:mm")}
                    </TableCell>
                    <TableCell>
                      <Badge variant={TYPE_VARIANT[r.type] ?? "outline"} className="text-xs">
                        {TYPE_LABELS[r.type] ?? r.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={SEVERITY_VARIANT[r.severity] ?? "default"} className="capitalize text-xs">
                        {r.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate font-medium text-sm">
                      {r.title}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.createdByEmail}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[r.status] ?? "outline"} className="capitalize text-xs">
                        {r.status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Detail sheet */}
      <Sheet open={!!selectedId} onOpenChange={(o) => { if (!o) { setSelectedId(null); setNoteText(""); } }}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          {detailLoading || !detail ? (
            <div className="space-y-4 pt-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          ) : (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-start gap-2 pr-6 text-wrap">
                  <Bug className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                  {detail.title}
                </SheetTitle>
                <SheetDescription className="flex flex-wrap gap-2 items-center">
                  <Badge variant={TYPE_VARIANT[detail.type] ?? "outline"}>
                    {TYPE_LABELS[detail.type] ?? detail.type}
                  </Badge>
                  <Badge variant={SEVERITY_VARIANT[detail.severity] ?? "default"} className="capitalize">
                    {detail.severity}
                  </Badge>
                  <Select
                    value={detail.status}
                    onValueChange={(val) => statusMutation.mutate({ id: detail.id, status: val })}
                    disabled={statusMutation.isPending}
                  >
                    <SelectTrigger className="h-7 w-[140px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(detail.createdAt), "MMM d, yyyy HH:mm")}
                  </span>
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-5 pt-6">
                {/* Meta */}
                <DetailSection label="Submitted by">
                  <p className="text-sm">{detail.createdByEmail}</p>
                </DetailSection>

                {/* Description */}
                <DetailSection label="Description">
                  <p className="text-sm whitespace-pre-wrap text-foreground">{detail.description}</p>
                </DetailSection>

                {/* URL */}
                <DetailSection label="Page URL">
                  <a
                    href={detail.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-primary hover:underline break-all"
                  >
                    {detail.url} <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </DetailSection>

                {/* Screen size */}
                {(detail.screenWidth || detail.screenHeight) && (
                  <DetailSection label="Screen size">
                    <p className="text-sm">{detail.screenWidth} × {detail.screenHeight}</p>
                  </DetailSection>
                )}

                {/* User agent */}
                <DetailSection label="Browser">
                  <p className="text-xs text-muted-foreground break-all">{detail.userAgent}</p>
                </DetailSection>

                {/* Screenshots */}
                {(() => {
                  if (screenshotsLoading) {
                    return (
                      <DetailSection label="Screenshots">
                        <Skeleton className="h-32 w-full" />
                      </DetailSection>
                    );
                  }

                  if (!screenshotUrls || screenshotUrls.length === 0) return null;

                  return (
                    <DetailSection label={screenshotUrls.length === 1 ? "Screenshot" : `Screenshots (${screenshotUrls.length})`}>
                      <div className={screenshotUrls.length === 1 ? "" : "grid grid-cols-2 gap-2"}>
                        {screenshotUrls.map((item, index) => (
                          <a
                            key={index}
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block"
                          >
                            <img
                              src={item.url}
                              alt={`Screenshot ${index + 1}`}
                              className="max-w-full rounded-md border border-border object-contain hover:opacity-90 transition-opacity"
                              style={{ maxHeight: screenshotUrls.length === 1 ? 320 : 200 }}
                              onError={(e) => {
                                console.error("Failed to load screenshot:", item.path);
                                e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Crect fill='%23f0f0f0' width='200' height='200'/%3E%3Ctext x='50%25' y='50%25' font-family='Arial' font-size='14' fill='%23666' text-anchor='middle' dy='.3em'%3EImage unavailable%3C/text%3E%3C/svg%3E";
                              }}
                            />
                          </a>
                        ))}
                      </div>
                    </DetailSection>
                  );
                })()}

                {/* Metadata */}
                {Object.keys(detail.metadata ?? {}).length > 0 && (
                  <DetailSection label="Metadata">
                    <pre className="rounded-md bg-muted/50 p-3 text-xs overflow-auto">
                      {JSON.stringify(detail.metadata, null, 2)}
                    </pre>
                  </DetailSection>
                )}

                {/* ── Internal Notes ────────────────────────────────────────── */}
                <AiReviewPanel
                  data={aiReviewData}
                  feedbackType={detail.type}
                  canRunFallback={isAdminOrOwner}
                  error={aiReviewError}
                  isLoading={aiReviewLoading}
                  isActionPending={createAiReviewMutation.isPending || rerunAiReviewMutation.isPending}
                  onRun={() => createAiReviewMutation.mutate()}
                  onRerun={(reviewId) => rerunAiReviewMutation.mutate(reviewId)}
                />

                <div className="border-t border-border pt-5 space-y-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Internal Notes
                  </p>

                  {notesLoading ? (
                    <div className="space-y-2">
                      {Array.from({ length: 2 }).map((_, i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                      ))}
                    </div>
                  ) : !notes || notes.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No notes yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {notes.map((n) => (
                        <div
                          key={n.id}
                          className="rounded-md border border-border bg-muted/20 px-3 py-2 space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-foreground">
                              {n.createdByEmail}
                            </span>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {format(new Date(n.createdAt), "MMM d, yyyy HH:mm")}
                            </span>
                          </div>
                          <p className="text-sm whitespace-pre-wrap text-foreground">{n.note}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="space-y-2">
                    <Textarea
                      ref={noteRef}
                      placeholder="Add an internal note…"
                      className="min-h-[80px] resize-none text-sm"
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                          e.preventDefault();
                          handleAddNote();
                        }
                      }}
                      disabled={noteMutation.isPending}
                    />
                    <div className="flex items-center gap-3">
                      <Button
                        size="sm"
                        className="gap-2"
                        onClick={handleAddNote}
                        disabled={!noteText.trim() || noteMutation.isPending}
                      >
                        <Send className="h-3 w-3" />
                        {noteMutation.isPending ? "Adding…" : "Add note"}
                      </Button>
                      <span className="text-xs text-muted-foreground">Ctrl+Enter to submit</span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={!!selectedBriefId} onOpenChange={(open) => { if (!open) setSelectedBriefId(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          {selectedBriefLoading || !selectedBrief ? (
            <div className="space-y-4 pt-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          ) : (
            <AiTriageBriefDetail brief={selectedBrief} canExportPdf={canExportAiTriageBriefPdf(selectedBrief, isAdminOrOwner)} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Small helper component ───────────────────────────────────────────────────

function DetailSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

export function AiTriageBriefHistoryPanel({
  data,
  isLoading,
  onSelect,
}: {
  data: AiTriageBriefListResponse | undefined;
  isLoading: boolean;
  onSelect: (id: string) => void;
}) {
  const disabledMessage = data?.featureEnabled === false
    ? "AI Triage Brief is disabled in AI Settings."
    : data && !data.canGenerate
      ? "AI Triage Brief is available to admins and owners only."
      : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <FileText className="h-4 w-4" />
          AI Triage Brief History
          <Badge variant="outline">AI Advisory</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Normal triage briefs analyze active feedback only: open and in review. Resolved and closed reports are excluded.
        </p>
        {disabledMessage ? (
          <p className="text-sm text-muted-foreground">{disabledMessage}</p>
        ) : null}
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !data?.briefs.length ? (
          <p className="text-sm text-muted-foreground">No AI triage brief has been generated yet.</p>
        ) : (
          <div className="space-y-2">
            {data.briefs.slice(0, 5).map((brief) => (
              <button
                key={brief.id}
                type="button"
                onClick={() => onSelect(brief.id)}
                className="flex w-full items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {brief.summary || "AI Triage Brief"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(brief.createdAt), "MMM d, yyyy HH:mm")} by {brief.requestedByEmail}
                  </p>
                </div>
                <Badge variant={brief.status === "failed" ? "destructive" : brief.status === "completed" ? "default" : "secondary"}>
                  {brief.status}
                </Badge>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AiTriageBriefDetail({ brief, canExportPdf = false }: { brief: AiTriageBriefDto; canExportPdf?: boolean }) {
  const result = brief.result;

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-start justify-between gap-3 pr-6">
          <span className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            AI Triage Brief
          </span>
          {canExportPdf && brief.status === "completed" ? (
            <Button asChild size="sm" variant="outline" className="gap-2">
              <a href={getAiTriageBriefPdfUrl(brief.id)} target="_blank" rel="noreferrer">
                <Download className="h-4 w-4" />
                Export PDF
              </a>
            </Button>
          ) : null}
        </SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">AI Advisory</Badge>
          <Badge variant={brief.status === "failed" ? "destructive" : brief.status === "completed" ? "default" : "secondary"}>
            {brief.status}
          </Badge>
          <Badge variant="secondary">Active reports only</Badge>
          <span>{format(new Date(brief.createdAt), "MMM d, yyyy HH:mm")}</span>
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-5 pt-6">
        {brief.status === "pending" || brief.status === "processing" ? (
          <div className="rounded-md border border-border p-4">
            <p className="text-sm font-medium">Brief is {brief.status}.</p>
            <p className="text-sm text-muted-foreground">The page will refresh while the AI triage brief is being prepared.</p>
          </div>
        ) : null}

        {brief.status === "failed" ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
            <p className="text-sm font-medium text-destructive">AI triage brief failed</p>
            <p className="text-sm text-muted-foreground">{brief.errorMessage || "The provider did not return a valid brief."}</p>
          </div>
        ) : null}

        {result ? (
          <>
            <BriefSection title="Executive Summary">
              <p className="text-sm whitespace-pre-wrap">{result.executiveSummary}</p>
            </BriefSection>
            <BriefSection title="Top Operational Risks">
              <RiskList items={result.topOperationalRisks} />
            </BriefSection>
            <BriefSection title="Top Workflow Risks">
              <RiskList items={result.topWorkflowRisks} />
            </BriefSection>
            <BriefSection title="Top Revenue Risks">
              <RiskList items={result.topRevenueRisks} />
            </BriefSection>
            <BriefSection title="Top Bug Clusters">
              <BugClusterList items={result.topBugClusters} />
            </BriefSection>
            <BriefSection title="Top Feature Requests">
              <FeatureRequestList items={result.topFeatureRequests} />
            </BriefSection>
            <BriefSection title="Duplicate Signals">
              <DuplicateSignalList items={result.duplicateSignals} />
            </BriefSection>
            <BriefSection title="Suggested Priority Order">
              <PriorityList items={result.suggestedPriorityOrder} />
            </BriefSection>
            <BriefSection title="Recommended Next Sprint">
              <PriorityList items={result.recommendedNextSprint} />
            </BriefSection>
            <BriefSection title="Unknowns">
              <SimpleList items={result.unknowns} />
            </BriefSection>
            <BriefSection title="Confidence">
              <p className="text-sm font-medium">{Math.round(result.confidence * 100)}%</p>
            </BriefSection>
          </>
        ) : null}
      </div>
    </>
  );
}

function BriefSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-t border-border pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function RiskList({ items }: { items: NonNullable<AiTriageBriefDto["result"]>["topOperationalRisks"] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">None identified.</p>;
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={`${item.title}-${index}`} className="rounded-md border border-border p-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium">{item.title}</p>
            <Badge variant="outline">{Math.round(item.confidence * 100)}%</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{item.impact}</p>
          <p className="mt-2 text-xs text-muted-foreground">{item.rationale}</p>
        </div>
      ))}
    </div>
  );
}

function BugClusterList({ items }: { items: NonNullable<AiTriageBriefDto["result"]>["topBugClusters"] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">None identified.</p>;
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={`${item.issue}-${index}`} className="rounded-md border border-border p-3">
          <p className="text-sm font-medium">{item.issue}</p>
          <p className="mt-1 text-xs text-muted-foreground">{item.reportCount} report{item.reportCount === 1 ? "" : "s"}</p>
          <p className="mt-2 text-sm text-muted-foreground">{item.impact}</p>
          <p className="mt-2 text-xs text-muted-foreground">Modules: {item.affectedModules.join(", ") || "Unknown"}</p>
        </div>
      ))}
    </div>
  );
}

function FeatureRequestList({ items }: { items: NonNullable<AiTriageBriefDto["result"]>["topFeatureRequests"] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">None identified.</p>;
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={`${item.feature}-${index}`} className="rounded-md border border-border p-3">
          <p className="text-sm font-medium">{item.feature}</p>
          <p className="mt-1 text-xs text-muted-foreground">{item.requestCount} request{item.requestCount === 1 ? "" : "s"}</p>
          <p className="mt-2 text-sm text-muted-foreground">{item.value}</p>
          <p className="mt-2 text-xs text-muted-foreground">Complexity: {item.complexity}</p>
        </div>
      ))}
    </div>
  );
}

function DuplicateSignalList({ items }: { items: NonNullable<AiTriageBriefDto["result"]>["duplicateSignals"] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">None identified.</p>;
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={`${item.theme}-${index}`} className="rounded-md border border-border p-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium">{item.theme}</p>
            <Badge variant="outline">{Math.round(item.confidence * 100)}%</Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{item.rationale}</p>
          <p className="mt-2 text-xs text-muted-foreground">Reports: {item.reportIds.join(", ")}</p>
        </div>
      ))}
    </div>
  );
}

function PriorityList({ items }: { items: NonNullable<AiTriageBriefDto["result"]>["suggestedPriorityOrder"] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">None identified.</p>;
  return (
    <ol className="space-y-2">
      {items.map((item, index) => (
        <li key={`${item.item}-${index}`} className="rounded-md border border-border p-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium">{index + 1}. {item.item}</p>
            <Badge variant={item.urgency === "critical" ? "destructive" : item.urgency === "high" ? "default" : "outline"}>
              {item.urgency}
            </Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{item.rationale}</p>
        </li>
      ))}
    </ol>
  );
}

function SimpleList({ items }: { items: string[] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">None listed.</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
      {items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
    </ul>
  );
}
