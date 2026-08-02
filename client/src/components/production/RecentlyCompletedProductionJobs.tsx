import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronUp, Eye, FileImage, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ROUTES } from "@/config/routes";
import {
  RecentlyCompletedProductionJob,
  useRecoverLegacyProductionCompletion,
  useReopenCompletedProductionRun,
  useRecentlyCompletedProductionJobs,
  useUndoCompleteProductionJob,
} from "@/hooks/useProduction";

type CompletedRange = "24h" | "7d" | "30d";

function formatCompletedAt(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatSide(value: string) {
  const side = String(value || "na").toLowerCase();
  if (side === "both") return "Front and back";
  if (side === "front") return "Front";
  if (side === "back") return "Back";
  return "Side not specified";
}

function CompletedArtworkThumbnail({
  file,
  onOpen,
}: {
  file: RecentlyCompletedProductionJob["artwork"][number];
  onOpen: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const source = file.thumbnailUrl || file.previewUrl;
  if (!source || failed) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded border border-dashed border-titan-border-subtle bg-titan-bg-muted p-1 text-[9px] text-titan-text-muted"
        aria-label={`View artwork details for ${file.fileName}`}
        title={file.previewReason || "Preview unavailable"}
      >
        <FileImage className="h-4 w-4" />
        <span className="mt-0.5 line-clamp-2">No preview</span>
      </button>
    );
  }
  return (
    <button type="button" onClick={onOpen} className="h-14 w-14 shrink-0 overflow-hidden rounded border border-titan-border-subtle bg-white" aria-label={`Preview ${file.fileName}`}>
      <img src={source} alt={`Artwork thumbnail for ${file.fileName}`} className="h-full w-full object-contain" onError={() => setFailed(true)} />
    </button>
  );
}

function CompletedArtworkDetails({ job }: { job: RecentlyCompletedProductionJob }) {
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<RecentlyCompletedProductionJob["artwork"][number] | null>(null);
  const inlineArtwork = job.artwork.slice(0, 4);
  const previewIsPdf = preview?.mimeType?.toLowerCase().includes("pdf");

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {inlineArtwork.map((file) => <CompletedArtworkThumbnail key={file.id} file={file} onOpen={() => setPreview(file)} />)}
        {job.artwork.length > inlineArtwork.length ? <Badge variant="outline">+{job.artwork.length - inlineArtwork.length} more</Badge> : null}
        {job.artwork.length > 0 ? (
          <Button type="button" size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => setExpanded((value) => !value)}>
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {expanded ? "Hide artwork" : "View artwork"}
          </Button>
        ) : (
          <div className="rounded border border-dashed border-amber-500/50 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-900 dark:text-amber-200">
            No artwork assigned to this line item.
          </div>
        )}
      </div>
      {expanded ? (
        <div className="mt-3 space-y-2 rounded-md border border-titan-border-subtle bg-titan-bg-muted/40 p-2">
          {job.artwork.map((file) => (
            <div key={file.id} className="flex items-center gap-2 rounded bg-titan-bg-card p-2 text-xs">
              <CompletedArtworkThumbnail file={file} onOpen={() => setPreview(file)} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-titan-text-primary">{file.fileName}</p>
                <p className="mt-0.5 text-titan-text-muted">{formatSide(file.side)} • {file.allocatedQuantity == null ? "Allocation not specified" : `${file.allocatedQuantity} each`}</p>
                {file.previewStatus !== "available" ? <p className="mt-0.5 text-amber-700 dark:text-amber-300">{file.previewReason || "Preview unavailable"}</p> : null}
              </div>
              <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setPreview(file)}>
                <Eye className="h-3.5 w-3.5" /> View
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{preview?.fileName || "Artwork preview"}</DialogTitle></DialogHeader>
          {preview?.previewUrl || preview?.thumbnailUrl ? (
            previewIsPdf ? <iframe title={preview.fileName} src={preview.previewUrl || preview.thumbnailUrl || undefined} className="h-[65vh] w-full rounded border bg-white" /> : <img src={preview.previewUrl || preview.thumbnailUrl || undefined} alt={`Artwork preview for ${preview.fileName}`} className="max-h-[65vh] w-full object-contain" />
          ) : <div className="rounded border border-dashed p-6 text-sm text-titan-text-muted">{preview?.previewReason || "Production artwork preview is unavailable."}</div>}
        </DialogContent>
      </Dialog>
    </>
  );
}

function RecentlyCompletedRow({
  job,
  onUndo,
  onRecover,
}: {
  job: RecentlyCompletedProductionJob;
  onUndo: (job: RecentlyCompletedProductionJob) => void;
  onRecover: (job: RecentlyCompletedProductionJob) => void;
}) {
  const lineIdentity = [
    job.lineItemSequence ? `Item ${job.lineItemSequence}` : null,
    job.dimensions,
    job.mediaName,
  ].filter(Boolean).join(" • ");
  return (
    <div className="border-t border-titan-border-subtle px-3 py-4 first:border-t-0">
      <div className="flex flex-col justify-between gap-3 lg:flex-row">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-titan-text-primary">{job.customerName}</span>
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">{job.orderNumber}</Badge>
            <Badge variant={job.undoAllowed || job.legacyRecoveryAction ? "secondary" : "outline"} className="text-[10px] uppercase tracking-wide">{job.undoAllowed ? "Undo available" : job.legacyRecoveryAction === "reopen_combined_run" ? "Run recovery available" : job.legacyRecoveryAction === "reopen_production" ? "Recovery available" : "Recovery unavailable"}</Badge>
          </div>
          <div className="mt-1 text-sm font-medium text-titan-text-primary">{job.itemName}</div>
          {lineIdentity ? <div className="mt-0.5 text-xs text-titan-text-muted">{lineIdentity}</div> : null}
          <div className="mt-2 text-xs font-medium text-titan-text-primary">{job.artworkSummary}</div>
          {job.allocationIssue ? <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">{job.allocationIssue}</div> : null}
          <CompletedArtworkDetails job={job} />
          <div className="mt-3 text-xs text-titan-text-muted">
            {job.stationLabel} completed {formatCompletedAt(job.completedAt)}{job.completedBy ? ` by ${job.completedBy}` : ""}
          </div>
          <div className="mt-1 text-xs text-titan-text-muted">{job.undoAllowed ? `Undo restores this exact job to ${job.restoreStatusLabel}.` : job.productionRunDisplayNumber ? `Part of Combined Run ${job.productionRunDisplayNumber}. Recovery is performed for the full run.` : "Legacy recovery restores this standalone job only after server-side safety checks."}</div>
          {!job.undoAllowed && !job.legacyRecoveryAction ? <div className="mt-1 text-xs text-titan-text-muted">{job.undoUnavailableReason || "Recovery is not available."}</div> : null}
        </div>
        <div className="flex shrink-0 items-start gap-2">
          <Button asChild type="button" size="sm" variant="ghost"><Link to={ROUTES.orders.detail(job.orderId)}>View Order</Link></Button>
          {job.undoAllowed ? <Button type="button" size="sm" variant="outline" onClick={() => onUndo(job)}><Undo2 className="h-4 w-4" /> Undo</Button> : null}
          {job.legacyRecoveryAction === "reopen_combined_run" ? <Button type="button" size="sm" variant="outline" onClick={() => onRecover(job)}>Reopen Combined Run</Button> : null}
          {job.legacyRecoveryAction === "reopen_production" ? <Button type="button" size="sm" variant="outline" onClick={() => onRecover(job)}>Reopen Production</Button> : null}
          {!job.undoAllowed && !job.legacyRecoveryAction ? <Button type="button" size="sm" variant="outline" disabled>Recovery unavailable</Button> : null}
        </div>
      </div>
    </div>
  );
}

export function RecentlyCompletedProductionJobs({ station }: { station: string }) {
  const [range, setRange] = useState<CompletedRange>("7d");
  const [search, setSearch] = useState("");
  const query = useRecentlyCompletedProductionJobs({ station, range, search });
  const [selectedJob, setSelectedJob] = useState<RecentlyCompletedProductionJob | null>(null);
  const [reason, setReason] = useState("");
  const undo = useUndoCompleteProductionJob(selectedJob?.id ?? "");
  const recoverLegacyJob = useRecoverLegacyProductionCompletion();
  const recoverRun = useReopenCompletedProductionRun();
  const rows = useMemo(() => query.data ?? [], [query.data]);

  const handleUndo = () => {
    if (!selectedJob) return;
    undo.mutate({ reason: reason.trim() || null }, { onSuccess: () => { setSelectedJob(null); setReason(""); } });
  };
  const handleRecovery = () => {
    if (!selectedJob || !reason.trim()) return;
    if (selectedJob.legacyRecoveryAction === "reopen_combined_run" && selectedJob.productionRunId) {
      recoverRun.mutate({ runId: selectedJob.productionRunId, reason: reason.trim() }, { onSuccess: () => { setSelectedJob(null); setReason(""); } });
      return;
    }
    recoverLegacyJob.mutate({ jobId: selectedJob.id, reason: reason.trim() }, { onSuccess: () => { setSelectedJob(null); setReason(""); } });
  };

  return (
    <>
      <Card className="bg-titan-bg-card border-titan-border-subtle">
        <CardHeader className="space-y-3 border-b border-titan-border-subtle px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><div className="text-sm font-semibold text-titan-text-primary">Completed Production</div><div className="text-xs text-titan-text-muted">Completed history is separate from the safe Undo window.</div></div>
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">{rows.length}</Badge>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search order, line item, artwork, media, or size" className="h-9" aria-label="Search completed production" />
            <Select value={range} onValueChange={(value) => setRange(value as CompletedRange)}><SelectTrigger className="h-9 w-full sm:w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="24h">Last 24 hours</SelectItem><SelectItem value="7d">Last 7 days</SelectItem><SelectItem value="30d">Last 30 days</SelectItem></SelectContent></Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {query.isLoading ? <div className="px-3 py-4 text-sm text-titan-text-muted">Loading completed jobs...</div> : query.error ? <div className="px-3 py-4 text-sm text-red-400">Failed to load completed jobs.</div> : rows.length === 0 ? <div className="px-3 py-4 text-sm text-titan-text-muted">No completed jobs in the selected range.</div> : rows.map((job) => <RecentlyCompletedRow key={job.id} job={job} onUndo={setSelectedJob} onRecover={setSelectedJob} />)}
        </CardContent>
      </Card>

      <AlertDialog open={!!selectedJob} onOpenChange={(open) => !open && setSelectedJob(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{selectedJob?.undoAllowed ? "Undo this completed production job?" : selectedJob?.legacyRecoveryAction === "reopen_combined_run" ? "Reopen completed Combined Run?" : "Reopen legacy production completion?"}</AlertDialogTitle>
            <AlertDialogDescription>This restores only the selected job: {selectedJob?.customerName} • {selectedJob?.orderNumber} • {selectedJob?.itemName} • {selectedJob?.artwork.map((file) => file.fileName).join(", ") || "no artwork assigned"}. Completed {formatCompletedAt(selectedJob?.completedAt)}; restore destination: {selectedJob?.restoreStatusLabel}.</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder={selectedJob?.undoAllowed ? "Reason (optional)" : "Recovery reason (required)"} className="min-h-20" />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={undo.isPending || recoverLegacyJob.isPending || recoverRun.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); selectedJob?.undoAllowed ? handleUndo() : handleRecovery(); }} disabled={undo.isPending || recoverLegacyJob.isPending || recoverRun.isPending || (!selectedJob?.undoAllowed && !reason.trim())}>{selectedJob?.undoAllowed ? "Undo Complete" : "Reopen Production"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
