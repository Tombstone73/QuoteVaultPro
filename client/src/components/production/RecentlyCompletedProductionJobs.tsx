import { useMemo, useState } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import {
  RecentlyCompletedProductionJob,
  useRecentlyCompletedProductionJobs,
  useUndoCompleteProductionJob,
} from "@/hooks/useProduction";

function formatCompletedAt(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function RecentlyCompletedRow({
  job,
  onUndo,
}: {
  job: RecentlyCompletedProductionJob;
  onUndo: (job: RecentlyCompletedProductionJob) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-3 border-t border-titan-border-subtle px-3 py-3 first:border-t-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-semibold text-titan-text-primary">{job.customerName}</span>
          <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
            {job.orderNumber}
          </Badge>
          <Badge variant={job.undoAllowed ? "secondary" : "outline"} className="text-[10px] uppercase tracking-wide">
            {job.undoAllowed ? "Undo available" : "Locked"}
          </Badge>
        </div>
        <div className="mt-1 truncate text-sm text-titan-text-muted">{job.itemName}</div>
        <div className="mt-1 text-xs text-titan-text-muted">
          {job.stationLabel} completed {formatCompletedAt(job.completedAt)}
          {job.completedBy ? ` by ${job.completedBy}` : ""}
        </div>
        <div className="mt-1 text-xs text-titan-text-muted">
          Restores to {job.previousStationLabel || "previous station"} as {job.previousStatus || "in_progress"}
        </div>
      </div>
      <div className="flex items-center">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!job.undoAllowed}
          onClick={() => onUndo(job)}
        >
          <Undo2 className="h-4 w-4" />
          Undo
        </Button>
      </div>
    </div>
  );
}

export function RecentlyCompletedProductionJobs({ station }: { station: string }) {
  const query = useRecentlyCompletedProductionJobs({ station });
  const [selectedJob, setSelectedJob] = useState<RecentlyCompletedProductionJob | null>(null);
  const [reason, setReason] = useState("");
  const undo = useUndoCompleteProductionJob(selectedJob?.id ?? "");

  const rows = useMemo(() => query.data ?? [], [query.data]);

  const handleUndo = () => {
    if (!selectedJob) return;
    undo.mutate(
      { reason: reason.trim() || null },
      {
        onSuccess: () => {
          setSelectedJob(null);
          setReason("");
        },
      },
    );
  };

  return (
    <>
      <Card className="bg-titan-bg-card border-titan-border-subtle">
        <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-titan-border-subtle px-3 py-3">
          <div>
            <div className="text-sm font-semibold text-titan-text-primary">Recently Completed</div>
            <div className="text-xs text-titan-text-muted">Completed in the last 24 hours</div>
          </div>
          <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
            {rows.length}
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          {query.isLoading ? (
            <div className="px-3 py-4 text-sm text-titan-text-muted">Loading recently completed jobs...</div>
          ) : query.error ? (
            <div className="px-3 py-4 text-sm text-red-400">Failed to load recently completed jobs.</div>
          ) : rows.length === 0 ? (
            <div className="px-3 py-4 text-sm text-titan-text-muted">No jobs completed in the last 24 hours.</div>
          ) : (
            rows.map((job) => <RecentlyCompletedRow key={job.id} job={job} onUndo={setSelectedJob} />)
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!selectedJob} onOpenChange={(open) => !open && setSelectedJob(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo completed job?</AlertDialogTitle>
            <AlertDialogDescription>
              This job will move back to its previous production station.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason (optional)"
            className="min-h-20"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={undo.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                handleUndo();
              }}
              disabled={undo.isPending || !selectedJob?.undoAllowed}
            >
              Undo Complete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
