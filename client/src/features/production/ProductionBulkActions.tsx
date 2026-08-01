import { useEffect, useMemo, useRef, useState } from "react";
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
  useCreateProductionRun,
  useBulkStartProductionJobs,
  useBulkUpdateProductionJobStatus,
  useReturnProductionJobsToPrepress,
} from "@/hooks/useProduction";
import type { ProductionBoardTab } from "@/lib/productionBoard";

type Props = {
  station: BulkProductionStation;
  status: ProductionBoardTab;
  eligibleJobs: ProductionJobListItem[];
  returnToPrepressEligibleJobs?: ProductionJobListItem[];
  selectedJobIds: Set<string>;
  onSelectedJobIdsChange: (ids: Set<string>) => void;
};

export function ProductionBulkActions({ station, status, eligibleJobs, returnToPrepressEligibleJobs = [], selectedJobIds, onSelectedJobIdsChange }: Props) {
  const bulkStart = useBulkStartProductionJobs();
  const bulkStatus = useBulkUpdateProductionJobStatus();
  const createRun = useCreateProductionRun();
  const returnToPrepress = useReturnProductionJobsToPrepress();
  const [targetStatus, setTargetStatus] = useState<BulkProductionStatus>("done");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState("Re-nesting required");
  const selectionScopeInitialized = useRef(false);
  const [plannedSheetCount, setPlannedSheetCount] = useState("");
  const [nominalPiecesPerSheet, setNominalPiecesPerSheet] = useState("");
  const [sheetWidth, setSheetWidth] = useState("");
  const [sheetHeight, setSheetHeight] = useState("");
  const [notes, setNotes] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const eligibleIds = useMemo(() => eligibleJobs.map((job) => job.id), [eligibleJobs]);
  const selectableJobs = useMemo(() => Array.from(new Map([...eligibleJobs, ...returnToPrepressEligibleJobs].map((job) => [job.id, job])).values()), [eligibleJobs, returnToPrepressEligibleJobs]);
  const selectableIds = useMemo(() => selectableJobs.map((job) => job.id), [selectableJobs]);
  const selectedIds = useMemo(() => selectableIds.filter((id) => selectedJobIds.has(id)), [selectableIds, selectedJobIds]);
  const selectedProductionJobs = useMemo(() => eligibleJobs.filter((job) => selectedIds.includes(job.id)), [eligibleJobs, selectedIds]);
  const selectedReturnJobs = useMemo(() => returnToPrepressEligibleJobs.filter((job) => selectedIds.includes(job.id)), [returnToPrepressEligibleJobs, selectedIds]);
  const selectedOrderIds = useMemo(
    () => Array.from(new Set(selectedProductionJobs.map((job) => (job as any).orderId || job.order?.id).filter(Boolean))),
    [selectedProductionJobs],
  );
  const hasIncompatibleProductionSelection = selectedIds.length !== selectedProductionJobs.length;
  const hasIncompatibleReturnSelection = selectedIds.length !== selectedReturnJobs.length;
  const canCreateRun = status === "queued" && selectedProductionJobs.length > 1 && selectedOrderIds.length === 1 && !hasIncompatibleProductionSelection;
  const active = status === "in_progress" || status === "paused";
  const isPending = bulkStart.isPending || bulkStatus.isPending || createRun.isPending || returnToPrepress.isPending;
  const totalSelectedQuantity = selectedProductionJobs.reduce((sum, job) => sum + (Number((job as any).qty ?? job.order?.lineItems?.primary?.quantity ?? 0) || 0), 0);
  const expectedPlacements = (Number(plannedSheetCount) || 0) * (Number(nominalPiecesPerSheet) || 0);

  useEffect(() => {
    if (!selectionScopeInitialized.current) {
      selectionScopeInitialized.current = true;
      return;
    }
    onSelectedJobIdsChange(new Set());
    setConfirmOpen(false);
    setRunOpen(false);
    setReturnOpen(false);
  }, [station, status]); // Selection never survives a station or view change.

  if (status !== "queued" && !active) return null;

  const allSelected = selectableIds.length > 0 && selectedIds.length === selectableIds.length;
  const actionLabel = status === "queued"
    ? "Put selected into production"
    : `Update selected to ${targetStatus === "done" ? "completed" : targetStatus.replace("_", " ")}`;
  const targetLabel = status === "queued" ? "in production" : targetStatus === "done" ? "completed" : targetStatus.replace("_", " ");

  const toggleAll = (checked: boolean) => onSelectedJobIdsChange(checked ? new Set(selectableIds) : new Set());

  const confirm = async () => {
    if (selectedIds.length === 0 || hasIncompatibleProductionSelection) return;
    try {
      if (status === "queued") {
        await bulkStart.mutateAsync({ station, jobIds: selectedProductionJobs.map((job) => job.id) });
      } else {
        await bulkStatus.mutateAsync({ station, jobIds: selectedProductionJobs.map((job) => job.id), status: targetStatus });
      }
      onSelectedJobIdsChange(new Set());
      setConfirmOpen(false);
    } catch {
      // The mutation hook owns the user-facing, server-provided error message.
    }
  };

  const createCombinedRun = async () => {
    if (!canCreateRun) return;
    try {
      await createRun.mutateAsync({
        orderId: String(selectedOrderIds[0]),
        stationKey: station,
        members: selectedProductionJobs.map((job) => ({
          productionJobId: job.id,
          allocatedQuantity: Number((job as any).qty ?? job.order?.lineItems?.primary?.quantity ?? 0) || undefined,
        })),
        plannedSheetCount: plannedSheetCount ? Number(plannedSheetCount) : null,
        nominalPiecesPerSheet: nominalPiecesPerSheet ? Number(nominalPiecesPerSheet) : null,
        sheetWidth: sheetWidth ? Number(sheetWidth) : null,
        sheetHeight: sheetHeight ? Number(sheetHeight) : null,
        notes: notes.trim() || null,
        compatibilityOverrideReason: overrideReason.trim() || null,
      });
      onSelectedJobIdsChange(new Set());
      setRunOpen(false);
      setPlannedSheetCount("");
      setNominalPiecesPerSheet("");
      setSheetWidth("");
      setSheetHeight("");
      setNotes("");
      setOverrideReason("");
    } catch {
      // The mutation hook owns the user-facing, server-provided error message.
    }
  };

  const confirmReturnToPrepress = async () => {
    if (selectedIds.length === 0 || hasIncompatibleReturnSelection) return;
    try {
      await returnToPrepress.mutateAsync({
        station,
        jobIds: selectedReturnJobs.map((job) => job.id),
        reason: returnReason.trim() || "Return to Prepress requested from production board",
      });
      onSelectedJobIdsChange(new Set());
      setReturnOpen(false);
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
        disabled={selectableIds.length === 0 || isPending}
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
      <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={selectedIds.length === 0 || hasIncompatibleProductionSelection || isPending} title={hasIncompatibleProductionSelection ? "Selection includes jobs that are only eligible for Return to Prepress." : undefined}>
        {isPending ? "Updating…" : actionLabel}
      </Button>
      {status === "queued" ? (
        <Button size="sm" variant="secondary" onClick={() => setReturnOpen(true)} disabled={selectedIds.length === 0 || hasIncompatibleReturnSelection || isPending} title={hasIncompatibleReturnSelection ? "Selection includes jobs that cannot safely return to Prepress." : undefined}>
          Return Selected to Prepress
        </Button>
      ) : null}
      {status === "queued" ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setRunOpen(true)}
          disabled={!canCreateRun || isPending}
          title={hasIncompatibleProductionSelection ? "Selection includes jobs that are only eligible for Return to Prepress." : selectedProductionJobs.length > 1 && selectedOrderIds.length > 1 ? "Combined runs must use one order" : undefined}
        >
          Create combined run
        </Button>
      ) : null}

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

      <AlertDialog open={runOpen} onOpenChange={setRunOpen}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Create combined production run</AlertDialogTitle>
            <AlertDialogDescription>
              Group {selectedProductionJobs.length} same-order jobs into one physical production run. Line-item quantities, pricing, fulfillment, and invoices stay on the original items.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4 text-sm">
            <div className="max-h-48 overflow-auto rounded-md border border-titan-border-subtle">
              {selectedProductionJobs.map((job) => (
                <div key={job.id} className="flex items-center justify-between gap-3 border-b border-titan-border-subtle px-3 py-2 last:border-b-0">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{(job as any).jobDescription || job.order?.lineItems?.primary?.description || job.id}</div>
                    <div className="text-xs text-titan-text-muted">{job.order?.customerName} - Order {(job as any).orderNumber || job.order?.orderNumber}</div>
                  </div>
                  <div className="shrink-0 font-semibold">{Number((job as any).qty ?? job.order?.lineItems?.primary?.quantity ?? 0) || 0}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs font-medium text-titan-text-muted">Planned sheets</span>
                <input className="h-9 w-full rounded-md border border-titan-border-subtle bg-titan-bg-card px-2" value={plannedSheetCount} onChange={(event) => setPlannedSheetCount(event.target.value)} inputMode="numeric" />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-titan-text-muted">Pieces per sheet</span>
                <input className="h-9 w-full rounded-md border border-titan-border-subtle bg-titan-bg-card px-2" value={nominalPiecesPerSheet} onChange={(event) => setNominalPiecesPerSheet(event.target.value)} inputMode="numeric" />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-titan-text-muted">Sheet width</span>
                <input className="h-9 w-full rounded-md border border-titan-border-subtle bg-titan-bg-card px-2" value={sheetWidth} onChange={(event) => setSheetWidth(event.target.value)} inputMode="decimal" />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-titan-text-muted">Sheet height</span>
                <input className="h-9 w-full rounded-md border border-titan-border-subtle bg-titan-bg-card px-2" value={sheetHeight} onChange={(event) => setSheetHeight(event.target.value)} inputMode="decimal" />
              </label>
            </div>
            {plannedSheetCount && nominalPiecesPerSheet ? (
              <div className={`rounded-md border px-3 py-2 text-xs ${expectedPlacements === totalSelectedQuantity ? "border-emerald-500/30 bg-emerald-500/10" : "border-amber-500/30 bg-amber-500/10"}`}>
                {expectedPlacements} expected placements - {totalSelectedQuantity} allocated pieces
              </div>
            ) : null}
            <label className="block space-y-1">
              <span className="text-xs font-medium text-titan-text-muted">Nesting / production notes</span>
              <textarea className="min-h-20 w-full rounded-md border border-titan-border-subtle bg-titan-bg-card px-2 py-2" value={notes} onChange={(event) => setNotes(event.target.value)} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-titan-text-muted">Compatibility override reason</span>
              <input className="h-9 w-full rounded-md border border-titan-border-subtle bg-titan-bg-card px-2" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Only needed when routing or material differs" />
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void createCombinedRun(); }} disabled={!canCreateRun || isPending}>
              {createRun.isPending ? "Creating..." : "Create draft run"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={returnOpen} onOpenChange={setReturnOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Return selected jobs to Prepress</AlertDialogTitle>
            <AlertDialogDescription>
              This will move exactly {selectedReturnJobs.length} unstarted standalone {selectedReturnJobs.length === 1 ? "job" : "jobs"} to the Prepress queue. Artwork, allocations, and the future production destination remain unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="block space-y-1 text-sm">
            <span className="text-xs font-medium text-titan-text-muted">Reason</span>
            <textarea className="min-h-20 w-full rounded-md border border-titan-border-subtle bg-titan-bg-card px-2 py-2" value={returnReason} onChange={(event) => setReturnReason(event.target.value)} disabled={isPending} />
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void confirmReturnToPrepress(); }} disabled={isPending || !returnReason.trim()}>
              {returnToPrepress.isPending ? "Returning..." : "Return to Prepress"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
