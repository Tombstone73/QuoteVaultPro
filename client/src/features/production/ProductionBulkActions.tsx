import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  type BulkProductionStation,
  type BulkProductionStatus,
  type ProductionJobListItem,
  useBulkStartProductionJobs,
  useBulkUpdateProductionJobStatus,
} from "@/hooks/useProduction";
import type { ProductionBoardTab } from "@/lib/productionBoard";

type Props = {
  station: BulkProductionStation;
  status: ProductionBoardTab;
  eligibleJobs: ProductionJobListItem[];
  selectedJobIds: Set<string>;
  onSelectedJobIdsChange: (ids: Set<string>) => void;
};

export function ProductionBulkActions({ station, status, eligibleJobs, selectedJobIds, onSelectedJobIdsChange }: Props) {
  const bulkStart = useBulkStartProductionJobs();
  const bulkStatus = useBulkUpdateProductionJobStatus();
  const [targetStatus, setTargetStatus] = useState<BulkProductionStatus>("done");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const eligibleIds = useMemo(() => eligibleJobs.map((job) => job.id), [eligibleJobs]);
  const selectedIds = useMemo(() => eligibleIds.filter((id) => selectedJobIds.has(id)), [eligibleIds, selectedJobIds]);
  const active = status === "in_progress" || status === "paused";
  const isPending = bulkStart.isPending || bulkStatus.isPending;

  useEffect(() => {
    onSelectedJobIdsChange(new Set());
    setConfirmOpen(false);
  }, [station, status]); // Selection never survives a station or view change.

  if (status !== "queued" && !active) return null;

  const allSelected = eligibleIds.length > 0 && selectedIds.length === eligibleIds.length;
  const actionLabel = status === "queued"
    ? "Put selected into production"
    : `Update selected to ${targetStatus === "done" ? "completed" : targetStatus.replace("_", " ")}`;
  const targetLabel = status === "queued" ? "in production" : targetStatus === "done" ? "completed" : targetStatus.replace("_", " ");

  const toggleAll = (checked: boolean) => onSelectedJobIdsChange(checked ? new Set(eligibleIds) : new Set());

  const confirm = async () => {
    if (selectedIds.length === 0) return;
    try {
      if (status === "queued") {
        await bulkStart.mutateAsync({ station, jobIds: selectedIds });
      } else {
        await bulkStatus.mutateAsync({ station, jobIds: selectedIds, status: targetStatus });
      }
      onSelectedJobIdsChange(new Set());
      setConfirmOpen(false);
    } catch {
      // The mutation hook owns the user-facing, server-provided error message.
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-titan-border-subtle bg-titan-bg-card px-3 py-2">
      <Checkbox
        checked={allSelected}
        onCheckedChange={(checked) => toggleAll(checked === true)}
        aria-label="Select all eligible jobs currently visible"
        disabled={eligibleIds.length === 0 || isPending}
      />
      <span className="text-xs text-titan-text-muted">{selectedIds.length} selected</span>
      {active ? (
        <select
          value={targetStatus}
          onChange={(event) => setTargetStatus(event.target.value as BulkProductionStatus)}
          className="h-8 rounded-md border border-titan-border-subtle bg-titan-bg-card px-2 text-xs text-titan-text-primary"
          aria-label="Bulk production status"
          disabled={isPending}
        >
          <option value="done">Completed</option>
          <option value="queued">Queued</option>
        </select>
      ) : null}
      <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={selectedIds.length === 0 || isPending}>
        {isPending ? "Updating…" : actionLabel}
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm bulk production update</AlertDialogTitle>
            <AlertDialogDescription>
              This will update {selectedIds.length} independent production {selectedIds.length === 1 ? "job" : "jobs"} to {targetLabel}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void confirm(); }} disabled={isPending}>
              {isPending ? "Updating…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
