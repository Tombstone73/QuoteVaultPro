import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Bug, ExternalLink, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useAuth } from "@/hooks/useAuth";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BugReportListItem {
  id: string;
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
  screenshotUrl: string | null;
  metadata: Record<string, unknown>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

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

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchBugReports(params: { status?: string; severity?: string }) {
  const qs = new URLSearchParams();
  if (params.status && params.status !== "all")   qs.set("status", params.status);
  if (params.severity && params.severity !== "all") qs.set("severity", params.severity);
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function BugReportsPage() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter]   = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [selectedId, setSelectedId]       = useState<string | null>(null);

  const isAdminOrOwner = user?.role === "admin" || user?.role === "owner";

  const { data: reports, isLoading, refetch, isRefetching } = useQuery<BugReportListItem[]>({
    queryKey: ["/api/bug-reports", statusFilter, severityFilter],
    queryFn: () => fetchBugReports({ status: statusFilter, severity: severityFilter }),
    enabled: isAdminOrOwner,
  });

  const { data: detail, isLoading: detailLoading } = useQuery<BugReportDetail>({
    queryKey: ["/api/bug-reports", selectedId],
    queryFn: () => fetchBugReportDetail(selectedId!),
    enabled: !!selectedId,
  });

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
            <p className="text-sm text-muted-foreground">User-submitted bug reports for your organization</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
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
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_review">In review</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
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
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Created</TableHead>
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
                    {Array.from({ length: 5 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : !reports || reports.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    No bug reports found matching current filters.
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
      <Sheet open={!!selectedId} onOpenChange={(o) => { if (!o) setSelectedId(null); }}>
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
                  <Badge variant={SEVERITY_VARIANT[detail.severity] ?? "default"} className="capitalize">
                    {detail.severity}
                  </Badge>
                  <Badge variant={STATUS_VARIANT[detail.status] ?? "outline"} className="capitalize">
                    {detail.status.replace("_", " ")}
                  </Badge>
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

                {/* Screenshot */}
                {detail.screenshotUrl && (
                  <DetailSection label="Screenshot">
                    <a href={detail.screenshotUrl} target="_blank" rel="noopener noreferrer">
                      <img
                        src={detail.screenshotUrl}
                        alt="Bug report screenshot"
                        className="max-w-full rounded-md border border-border object-contain"
                        style={{ maxHeight: 320 }}
                      />
                    </a>
                  </DetailSection>
                )}

                {/* Metadata */}
                {Object.keys(detail.metadata ?? {}).length > 0 && (
                  <DetailSection label="Metadata">
                    <pre className="rounded-md bg-muted/50 p-3 text-xs overflow-auto">
                      {JSON.stringify(detail.metadata, null, 2)}
                    </pre>
                  </DetailSection>
                )}
              </div>
            </>
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
