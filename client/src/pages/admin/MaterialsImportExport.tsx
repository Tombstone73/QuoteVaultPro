/**
 * MaterialsImportExport.tsx
 *
 * Admin-only CSV import/export manager for materials.
 *
 * Workflow:
 *   1. Download CSV template or export current materials
 *   2. Upload a CSV → data is STAGED, not committed
 *   3. Review the staged rows (create / update / conflict / invalid)
 *   4. Skip invalid rows if needed, then commit
 *   5. View import history (last 20 batches)
 *
 * Route: /admin/materials/import-export
 */

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  History,
  Loader2,
  Package,
  RefreshCw,
  SkipForward,
  Upload,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type BatchStatus =
  | "uploaded"
  | "parsed"
  | "validated"
  | "review_ready"
  | "committed"
  | "failed"
  | "cancelled";

type RowStatus =
  | "pending"
  | "valid"
  | "invalid"
  | "conflict"
  | "ready_to_apply"
  | "applied"
  | "skipped";

type RowAction = "create" | "update" | "skip" | null;

interface ImportBatch {
  id: string;
  status: BatchStatus;
  sourceFilename: string | null;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  conflictRows: number;
  skippedRows: number;
  errorMessage: string | null;
  summaryJson: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

type MatchedBy = "material_id" | "sku" | "vendor_lookup" | "name" | "new" | "conflict" | null;

interface ImportRow {
  id: string;
  rowNumber: number;
  status: RowStatus;
  action: RowAction;
  existingMaterialId: string | null;
  rawJson: Record<string, string> | null;
  normalizedJson: Record<string, any> | null;
  validationErrors: string[] | null;
  matchedBy: MatchedBy;
}

interface BatchDetail {
  batch: ImportBatch;
  rows: ImportRow[];
}

// ─── Display helpers ──────────────────────────────────────────────────────────

const BATCH_STATUS_META: Record<BatchStatus, { label: string; className: string }> = {
  uploaded:     { label: "Uploaded",     className: "bg-blue-500/15 text-blue-400 border-blue-500/20" },
  parsed:       { label: "Parsed",       className: "bg-blue-500/15 text-blue-400 border-blue-500/20" },
  validated:    { label: "Validated",    className: "bg-blue-500/15 text-blue-400 border-blue-500/20" },
  review_ready: { label: "Review ready", className: "bg-amber-500/15 text-amber-400 border-amber-500/20" },
  committed:    { label: "Committed",    className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" },
  failed:       { label: "Failed",       className: "bg-red-500/15 text-red-400 border-red-500/20" },
  cancelled:    { label: "Cancelled",    className: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20" },
};

const ROW_STATUS_META: Record<RowStatus, { label: string; className: string }> = {
  pending:        { label: "Pending",       className: "text-titan-text-muted" },
  valid:          { label: "Ready",         className: "text-emerald-400" },
  invalid:        { label: "Invalid",       className: "text-red-400" },
  conflict:       { label: "Conflict",      className: "text-amber-400" },
  ready_to_apply: { label: "Ready",         className: "text-emerald-400" },
  applied:        { label: "Applied",       className: "text-emerald-400" },
  skipped:        { label: "Skipped",       className: "text-titan-text-muted" },
};

const ROW_ACTION_META: Record<string, { label: string; className: string }> = {
  create: { label: "Create", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" },
  update: { label: "Update", className: "bg-blue-500/15 text-blue-400 border-blue-500/20" },
  skip:   { label: "Skip",   className: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20" },
};

function BatchStatusBadge({ status }: { status: BatchStatus }) {
  const m = BATCH_STATUS_META[status] ?? BATCH_STATUS_META.uploaded;
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border", m.className)}>
      {m.label}
    </span>
  );
}

function ActionBadge({ action }: { action: RowAction }) {
  if (!action) return <span className="text-xs text-titan-text-muted">—</span>;
  const m = ROW_ACTION_META[action];
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border", m.className)}>
      {m.label}
    </span>
  );
}

const MATCHED_BY_META: Record<NonNullable<MatchedBy>, { label: string; title: string; className: string }> = {
  material_id:   { label: "by ID",     title: "Matched by material_id column",        className: "text-blue-400" },
  sku:           { label: "by SKU",    title: "Matched by sku column",                className: "text-blue-400" },
  vendor_lookup: { label: "by vendor", title: "Matched by vendor name + vendor SKU",  className: "text-blue-400" },
  name:          { label: "by name",   title: "Matched by material name (weakest)",   className: "text-titan-text-muted" },
  new:           { label: "new",       title: "No match found — will be created",     className: "text-emerald-400" },
  conflict:      { label: "conflict",  title: "Multiple identity signals disagree",   className: "text-amber-400" },
};

function MatchedByBadge({ matchedBy }: { matchedBy: MatchedBy }) {
  if (!matchedBy) return <span className="text-xs text-titan-text-muted">—</span>;
  const m = MATCHED_BY_META[matchedBy];
  return (
    <span className={cn("text-xs font-medium", m.className)} title={m.title}>
      {m.label}
    </span>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ─── Download helper ──────────────────────────────────────────────────────────

async function downloadFile(url: string, fallbackFilename: string) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("Download failed");
  const blob = await res.blob();
  const disp = res.headers.get("Content-Disposition") ?? "";
  const match = disp.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] ?? fallbackFilename;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── Review section ───────────────────────────────────────────────────────────

function ReviewSection({
  detail,
  onSkipInvalid,
  onCommit,
  onCancel,
  isSkipping,
  isCommitting,
  isCancelling,
}: {
  detail: BatchDetail;
  onSkipInvalid: () => void;
  onCommit: () => void;
  onCancel: () => void;
  isSkipping: boolean;
  isCommitting: boolean;
  isCancelling: boolean;
}) {
  const { batch, rows } = detail;
  const [showAll, setShowAll] = useState(false);

  const hasBlocking = batch.invalidRows > 0 || batch.conflictRows > 0;
  const canCommit =
    !hasBlocking &&
    batch.validRows > 0 &&
    batch.status !== "committed" &&
    batch.status !== "cancelled" &&
    batch.status !== "failed";

  const displayRows = showAll ? rows : rows.slice(0, 50);

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex flex-wrap gap-4 text-sm">
        <span>
          <span className="font-medium text-titan-text-primary">{batch.totalRows}</span>
          <span className="text-titan-text-muted ml-1">total rows</span>
        </span>
        <span className="text-emerald-400">
          <span className="font-medium">{batch.validRows}</span> valid
        </span>
        {batch.invalidRows > 0 && (
          <span className="text-red-400">
            <span className="font-medium">{batch.invalidRows}</span> invalid
          </span>
        )}
        {batch.conflictRows > 0 && (
          <span className="text-amber-400">
            <span className="font-medium">{batch.conflictRows}</span> conflict
          </span>
        )}
        {batch.skippedRows > 0 && (
          <span className="text-titan-text-muted">
            <span className="font-medium">{batch.skippedRows}</span> skipped
          </span>
        )}
      </div>

      {/* Blocking warning */}
      {hasBlocking && batch.status !== "committed" && (
        <Alert className="border-amber-500/30 bg-amber-500/5">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <AlertTitle className="text-amber-400 text-sm">Rows need attention</AlertTitle>
          <AlertDescription className="text-xs text-titan-text-secondary mt-1">
            {batch.invalidRows > 0 && `${batch.invalidRows} row(s) failed validation. `}
            {batch.conflictRows > 0 && `${batch.conflictRows} row(s) have identity conflicts (duplicate SKU/name within the CSV, or multiple identity fields pointing to different materials). `}
            Fix them in the CSV and re-upload, or click{" "}
            <strong>Skip all invalid / conflict</strong> to commit only the unambiguous rows.
          </AlertDescription>
        </Alert>
      )}

      {/* Committed result */}
      {batch.status === "committed" && batch.summaryJson && (
        <Alert className="border-emerald-500/30 bg-emerald-500/5">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <AlertTitle className="text-emerald-400 text-sm">Committed</AlertTitle>
          <AlertDescription className="text-xs text-titan-text-secondary mt-1">
            {(batch.summaryJson as any).created ?? 0} created,{" "}
            {(batch.summaryJson as any).updated ?? 0} updated.
          </AlertDescription>
        </Alert>
      )}

      {/* Failed result */}
      {batch.status === "failed" && (
        <Alert className="border-red-500/30 bg-red-500/5">
          <XCircle className="w-4 h-4 text-red-400" />
          <AlertTitle className="text-red-400 text-sm">Commit failed</AlertTitle>
          <AlertDescription className="text-xs text-titan-text-secondary mt-1">
            {batch.errorMessage ?? "An error occurred. No permanent changes were made."}
          </AlertDescription>
        </Alert>
      )}

      {/* Actions */}
      {batch.status !== "committed" && batch.status !== "cancelled" && batch.status !== "failed" && (
        <div className="flex flex-wrap gap-2">
          {hasBlocking && (
            <Button
              variant="outline"
              size="sm"
              onClick={onSkipInvalid}
              disabled={isSkipping || isCommitting}
            >
              {isSkipping ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <SkipForward className="w-4 h-4 mr-2" />
              )}
              Skip all invalid / conflict
            </Button>
          )}
          <Button
            size="sm"
            onClick={onCommit}
            disabled={!canCommit || isCommitting || isSkipping}
            className="bg-titan-accent hover:bg-titan-accent/90 text-white"
          >
            {isCommitting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4 mr-2" />
            )}
            Commit {batch.validRows} valid row{batch.validRows !== 1 ? "s" : ""}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={isCancelling || isCommitting}
            className="text-titan-text-muted hover:text-red-400"
          >
            Cancel
          </Button>
        </div>
      )}

      {/* Row table */}
      <div className="rounded-md border border-titan-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-titan-border">
              <TableHead className="text-xs text-titan-text-muted w-16">Row</TableHead>
              <TableHead className="text-xs text-titan-text-muted">Material Name</TableHead>
              <TableHead className="text-xs text-titan-text-muted">SKU</TableHead>
              <TableHead className="text-xs text-titan-text-muted">Type</TableHead>
              <TableHead className="text-xs text-titan-text-muted">Action</TableHead>
              <TableHead className="text-xs text-titan-text-muted">Matched by</TableHead>
              <TableHead className="text-xs text-titan-text-muted">Status</TableHead>
              <TableHead className="text-xs text-titan-text-muted">Validation</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayRows.map((row) => {
              const isError = row.status === "invalid" || row.status === "conflict";
              return (
                <TableRow
                  key={row.id}
                  className={cn(
                    "border-titan-border",
                    isError && "bg-red-500/5",
                    row.status === "applied" && "opacity-60"
                  )}
                >
                  <TableCell className="text-xs text-titan-text-muted py-2">
                    {row.rowNumber}
                  </TableCell>
                  <TableCell className="py-2 font-medium text-sm text-titan-text-primary">
                    {(row.rawJson?.["material_name"] || row.normalizedJson?.["name"] || "—")}
                  </TableCell>
                  <TableCell className="py-2 text-xs text-titan-text-secondary font-mono">
                    {row.rawJson?.["sku"] || row.normalizedJson?.["sku"] || "—"}
                  </TableCell>
                  <TableCell className="py-2 text-xs text-titan-text-secondary">
                    {row.rawJson?.["material_type"] || row.normalizedJson?.["type"] || "—"}
                  </TableCell>
                  <TableCell className="py-2">
                    <ActionBadge action={row.action} />
                  </TableCell>
                  <TableCell className="py-2">
                    <MatchedByBadge matchedBy={row.matchedBy ?? (row.normalizedJson?.["matchedBy"] as MatchedBy ?? null)} />
                  </TableCell>
                  <TableCell className="py-2">
                    <span className={cn("text-xs font-medium", ROW_STATUS_META[row.status]?.className)}>
                      {ROW_STATUS_META[row.status]?.label ?? row.status}
                    </span>
                  </TableCell>
                  <TableCell className="py-2 text-xs text-red-400 max-w-[280px]">
                    {row.validationErrors && row.validationErrors.length > 0
                      ? row.validationErrors.join(" · ")
                      : null}
                    {row.normalizedJson?.["vendorWillBeCreated"] && (
                      <span className="text-amber-400 text-xs block mt-0.5">
                        ⚠ Vendor "{row.normalizedJson["vendorName"]}" not found — will be created on commit
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {rows.length > 50 && !showAll && (
          <div className="p-3 text-center">
            <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
              Show all {rows.length} rows
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── History section ──────────────────────────────────────────────────────────

function HistorySection({
  batches,
  onSelect,
  selectedId,
}: {
  batches: ImportBatch[];
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  if (!batches.length) {
    return (
      <p className="text-sm text-titan-text-muted py-4 text-center">
        No import history yet.
      </p>
    );
  }
  return (
    <div className="rounded-md border border-titan-border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent border-titan-border">
            <TableHead className="text-xs text-titan-text-muted">Date</TableHead>
            <TableHead className="text-xs text-titan-text-muted">File</TableHead>
            <TableHead className="text-xs text-titan-text-muted">Status</TableHead>
            <TableHead className="text-xs text-titan-text-muted text-right">Rows</TableHead>
            <TableHead className="text-xs text-titan-text-muted text-right">Valid</TableHead>
            <TableHead className="text-xs text-titan-text-muted text-right">Invalid</TableHead>
            <TableHead className="text-xs text-titan-text-muted"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {batches.map((b) => (
            <TableRow
              key={b.id}
              className={cn(
                "border-titan-border cursor-pointer hover:bg-titan-surface-2",
                selectedId === b.id && "bg-titan-surface-2"
              )}
              onClick={() => onSelect(b.id)}
            >
              <TableCell className="py-2 text-xs text-titan-text-secondary">
                {fmtDate(b.createdAt)}
              </TableCell>
              <TableCell className="py-2 text-sm text-titan-text-secondary max-w-[180px] truncate">
                {b.sourceFilename ?? <span className="italic text-titan-text-muted">unnamed</span>}
              </TableCell>
              <TableCell className="py-2">
                <BatchStatusBadge status={b.status} />
              </TableCell>
              <TableCell className="py-2 text-xs text-right text-titan-text-secondary">{b.totalRows}</TableCell>
              <TableCell className="py-2 text-xs text-right text-emerald-400">{b.validRows}</TableCell>
              <TableCell className="py-2 text-xs text-right text-red-400">
                {(b.invalidRows || 0) + (b.conflictRows || 0) > 0
                  ? (b.invalidRows || 0) + (b.conflictRows || 0)
                  : <span className="text-titan-text-muted">0</span>}
              </TableCell>
              <TableCell className="py-2">
                {selectedId === b.id ? (
                  <ChevronDown className="w-3.5 h-3.5 text-titan-text-muted" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-titan-text-muted" />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MaterialsImportExport() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeSection, setActiveSection] = useState<"upload" | "history">("upload");
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const [isDownloadingExport, setIsDownloadingExport] = useState(false);

  // ── Queries ────────────────────────────────────────────────────────────────

  const batchesQuery = useQuery<{ success: boolean; data: ImportBatch[] }>({
    queryKey: ["admin", "materials-import-batches"],
    queryFn: () =>
      fetch("/api/admin/data/materials/imports", { credentials: "include" }).then((r) => {
        if (!r.ok) throw new Error("Failed to load import history");
        return r.json();
      }),
    staleTime: 30_000,
  });

  const detailQuery = useQuery<{ success: boolean; data: BatchDetail }>({
    queryKey: ["admin", "materials-import-batch", activeBatchId],
    queryFn: () =>
      fetch(`/api/admin/data/materials/imports/${activeBatchId}`, { credentials: "include" }).then(
        (r) => {
          if (!r.ok) throw new Error("Failed to load batch");
          return r.json();
        }
      ),
    enabled: !!activeBatchId,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const uploadMutation = useMutation({
    mutationFn: async ({ csvData, sourceFilename }: { csvData: string; sourceFilename: string }) => {
      const res = await fetch("/api/admin/data/materials/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvData, sourceFilename }),
        credentials: "include",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "Upload failed");
      return body as { success: boolean; data: { batchId: string; totalRows: number; validRows: number; invalidRows: number; conflictRows: number }; message: string };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "materials-import-batches"] });
      setActiveBatchId(result.data.batchId);
      setActiveSection("upload");
      toast({
        title: "CSV staged for review",
        description: result.message,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  const commitMutation = useMutation({
    mutationFn: async (batchId: string) => {
      const res = await fetch(`/api/admin/data/materials/imports/${batchId}/commit`, {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "Commit failed");
      return body;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "materials-import-batches"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "materials-import-batch", activeBatchId] });
      // Refresh materials list so inventory/procurement pages update
      queryClient.invalidateQueries({ queryKey: ["/api/materials"] });
      queryClient.invalidateQueries({ queryKey: ["materials"] });
      toast({ title: "Import committed", description: result.message });
    },
    onError: (err: Error) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "materials-import-batches"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "materials-import-batch", activeBatchId] });
      toast({ title: "Commit failed", description: err.message, variant: "destructive" });
    },
  });

  const skipInvalidMutation = useMutation({
    mutationFn: async (batchId: string) => {
      const res = await fetch(`/api/admin/data/materials/imports/${batchId}/skip-invalid`, {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "Skip failed");
      return body;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "materials-import-batches"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "materials-import-batch", activeBatchId] });
      toast({ title: "Rows skipped", description: result.message });
    },
    onError: (err: Error) => {
      toast({ title: "Skip failed", description: err.message, variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (batchId: string) => {
      const res = await fetch(`/api/admin/data/materials/imports/${batchId}/cancel`, {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "Cancel failed");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "materials-import-batches"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "materials-import-batch", activeBatchId] });
      setActiveBatchId(null);
      toast({ title: "Import cancelled" });
    },
    onError: (err: Error) => {
      toast({ title: "Cancel failed", description: err.message, variant: "destructive" });
    },
  });

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const csvData = ev.target?.result as string;
      uploadMutation.mutate({ csvData, sourceFilename: file.name });
    };
    reader.readAsText(file);

    // Reset input so the same file can be re-uploaded
    e.target.value = "";
  }

  async function handleTemplateDownload() {
    setIsDownloadingTemplate(true);
    try {
      await downloadFile(
        "/api/admin/data/materials/template.csv",
        "materials_template.csv"
      );
    } catch {
      toast({ title: "Download failed", variant: "destructive" });
    } finally {
      setIsDownloadingTemplate(false);
    }
  }

  async function handleExportDownload() {
    setIsDownloadingExport(true);
    try {
      await downloadFile(
        "/api/admin/data/materials/export.csv",
        "materials_export.csv"
      );
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setIsDownloadingExport(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const batches = batchesQuery.data?.data ?? [];
  const detail = detailQuery.data?.data ?? null;

  return (
    <div className="space-y-6 p-6 max-w-[1200px] mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-titan-text-primary flex items-center gap-2">
          <Package className="w-5 h-5 text-titan-accent" />
          Materials Data Manager
        </h1>
        <p className="text-sm text-titan-text-muted mt-1">
          CSV-based bulk import and export for materials.
        </p>
      </div>

      {/* Upload staging notice */}
      <Alert className="border-blue-500/20 bg-blue-500/5">
        <FileText className="w-4 h-4 text-blue-400" />
        <AlertTitle className="text-blue-400 text-sm">Safe staging workflow</AlertTitle>
        <AlertDescription className="text-xs text-titan-text-secondary mt-1">
          Uploading a CSV <strong>only stages the data for review</strong> — it does not change
          live materials. You must review and explicitly commit to apply changes.
          Existing materials are matched by ID, SKU, or vendor+vendor SKU before falling back to name.
          Invalid and conflicting rows must be fixed or skipped before committing.
        </AlertDescription>
      </Alert>

      {/* Action cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Template */}
        <Card className="border-titan-border bg-titan-bg-card-elevated">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="h-4 w-4 text-titan-accent" />
              <CardTitle className="text-titan-sm">CSV Template</CardTitle>
            </div>
            <CardDescription className="text-titan-xs">
              Download a blank template with all supported columns and an example row.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={handleTemplateDownload}
              disabled={isDownloadingTemplate}
            >
              {isDownloadingTemplate ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              Download Template
            </Button>
          </CardContent>
        </Card>

        {/* Export */}
        <Card className="border-titan-border bg-titan-bg-card-elevated">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Download className="h-4 w-4 text-titan-accent" />
              <CardTitle className="text-titan-sm">Export Materials</CardTitle>
            </div>
            <CardDescription className="text-titan-xs">
              Export all active materials as a CSV. Use as a starting point for bulk edits.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={handleExportDownload}
              disabled={isDownloadingExport}
            >
              {isDownloadingExport ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              Export CSV
            </Button>
          </CardContent>
        </Card>

        {/* Upload */}
        <Card className="border-titan-border bg-titan-bg-card-elevated">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Upload className="h-4 w-4 text-titan-accent" />
              <CardTitle className="text-titan-sm">Upload CSV</CardTitle>
            </div>
            <CardDescription className="text-titan-xs">
              Upload a CSV to stage rows for review. No changes until you commit.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMutation.isPending}
            >
              {uploadMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              {uploadMutation.isPending ? "Staging…" : "Choose CSV File"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-titan-border pb-0">
        <button
          className={cn(
            "px-4 py-2 text-sm font-medium rounded-t border-b-2 -mb-px transition-colors",
            activeSection === "upload"
              ? "border-titan-accent text-titan-text-primary"
              : "border-transparent text-titan-text-muted hover:text-titan-text-primary"
          )}
          onClick={() => setActiveSection("upload")}
        >
          Review
          {activeBatchId && (
            <span className="ml-2 w-2 h-2 rounded-full bg-amber-400 inline-block" />
          )}
        </button>
        <button
          className={cn(
            "px-4 py-2 text-sm font-medium rounded-t border-b-2 -mb-px transition-colors",
            activeSection === "history"
              ? "border-titan-accent text-titan-text-primary"
              : "border-transparent text-titan-text-muted hover:text-titan-text-primary"
          )}
          onClick={() => {
            setActiveSection("history");
            batchesQuery.refetch();
          }}
        >
          <History className="w-3.5 h-3.5 inline mr-1.5" />
          History
        </button>
      </div>

      {/* Review tab */}
      {activeSection === "upload" && (
        <div>
          {!activeBatchId ? (
            <div className="py-10 text-center text-titan-text-muted text-sm">
              Upload a CSV above to begin the import review.
            </div>
          ) : detailQuery.isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-10 rounded" />
              ))}
            </div>
          ) : detail ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <BatchStatusBadge status={detail.batch.status} />
                  <span className="text-xs text-titan-text-muted">
                    {detail.batch.sourceFilename ?? "Uploaded CSV"} · {fmtDate(detail.batch.createdAt)}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => detailQuery.refetch()}
                  className="text-titan-text-muted"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </Button>
              </div>
              <ReviewSection
                detail={detail}
                onSkipInvalid={() => skipInvalidMutation.mutate(activeBatchId)}
                onCommit={() => commitMutation.mutate(activeBatchId)}
                onCancel={() => cancelMutation.mutate(activeBatchId)}
                isSkipping={skipInvalidMutation.isPending}
                isCommitting={commitMutation.isPending}
                isCancelling={cancelMutation.isPending}
              />
            </>
          ) : (
            <div className="py-10 text-center text-sm text-titan-text-muted">
              Could not load batch details.
            </div>
          )}
        </div>
      )}

      {/* History tab */}
      {activeSection === "history" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => batchesQuery.refetch()}
              disabled={batchesQuery.isFetching}
            >
              <RefreshCw
                className={cn("w-3.5 h-3.5 mr-1", batchesQuery.isFetching && "animate-spin")}
              />
              Refresh
            </Button>
          </div>

          {batchesQuery.isLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-10 rounded" />
              ))}
            </div>
          ) : (
            <>
              <HistorySection
                batches={batches}
                onSelect={(id) => {
                  setActiveBatchId(id);
                  setActiveSection("upload");
                }}
                selectedId={activeBatchId}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
