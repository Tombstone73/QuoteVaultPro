import { useMemo, useRef, useState } from "react";
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
  useBulkAssignProductionPrinter,
  useBulkStartProductionJobs,
  useBulkUpdateProductionJobStatus,
  useCreateProductionRun,
  useReturnProductionJobsToPrepress,
} from "@/hooks/useProduction";
import type { ProductionBoardTab } from "@/lib/productionBoard";
import { getProductionMachineOptions } from "@shared/productionMachineOptions";
import { MAX_PRODUCTION_BULK_ITEMS } from "@shared/productionBulk";
import { rollProductionTransitionBlocker, type RollBulkTransition } from "./views/rollProductionSelection";

type Props = {
  station: BulkProductionStation;
  status: ProductionBoardTab;
  /** All jobs still visible to this tenant in the active board tab. */
  eligibleJobs: ProductionJobListItem[];
  /** Jobs matching the current local filter; used only by Select all visible. */
  visibleEligibleJobs?: ProductionJobListItem[];
  returnToPrepressEligibleJobs?: ProductionJobListItem[];
  visibleReturnToPrepressEligibleJobs?: ProductionJobListItem[];
  machineOptions?: string[];
  selectedJobIds: Set<string>;
  onSelectedJobIdsChange: (ids: Set<string>) => void;
};

function uniqueJobs(jobs: ProductionJobListItem[]): ProductionJobListItem[] {
  return Array.from(new Map(jobs.map((job) => [job.id, job])).values());
}

function jobLabel(job: ProductionJobListItem): string {
  const orderNumber = String((job as any).orderNumber || job.order?.orderNumber || "").trim();
  const description = String((job as any).jobDescription || job.order?.lineItems?.primary?.description || "").trim();
  return [orderNumber ? `Order ${orderNumber}` : null, description || `Job ${job.id}`].filter(Boolean).join(" — ");
}

export function ProductionBulkActions({
  station,
  status,
  eligibleJobs,
  visibleEligibleJobs = eligibleJobs,
  returnToPrepressEligibleJobs = [],
  visibleReturnToPrepressEligibleJobs = returnToPrepressEligibleJobs,
  machineOptions = [],
  selectedJobIds,
  onSelectedJobIdsChange,
}: Props) {
  const bulkStart = useBulkStartProductionJobs();
  const bulkStatus = useBulkUpdateProductionJobStatus();
  const bulkPrinterAssignment = useBulkAssignProductionPrinter();
  const createRun = useCreateProductionRun();
  const returnToPrepress = useReturnProductionJobsToPrepress();
  const [targetStatus, setTargetStatus] = useState<BulkProductionStatus>("done");
  const [allAction, setAllAction] = useState<RollBulkTransition>("start");
  const [statusError, setStatusError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [machineOpen, setMachineOpen] = useState(false);
  const [returnReason, setReturnReason] = useState("Re-nesting required");
  const [machineName, setMachineName] = useState("");
  const [plannedSheetCount, setPlannedSheetCount] = useState("");
  const [nominalPiecesPerSheet, setNominalPiecesPerSheet] = useState("");
  const [sheetWidth, setSheetWidth] = useState("");
  const [sheetHeight, setSheetHeight] = useState("");
  const [notes, setNotes] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const submittingAction = useRef(false);

  const visibleSelectableJobs = useMemo(() => uniqueJobs([...visibleEligibleJobs, ...visibleReturnToPrepressEligibleJobs]), [visibleEligibleJobs, visibleReturnToPrepressEligibleJobs]);
  const selectedIds = useMemo(() => visibleSelectableJobs.filter((job) => selectedJobIds.has(job.id)).map((job) => job.id), [visibleSelectableJobs, selectedJobIds]);
  const selectedProductionJobs = useMemo(() => visibleEligibleJobs.filter((job) => selectedIds.includes(job.id)), [visibleEligibleJobs, selectedIds]);
  const selectedReturnJobs = useMemo(() => visibleReturnToPrepressEligibleJobs.filter((job) => selectedIds.includes(job.id)), [visibleReturnToPrepressEligibleJobs, selectedIds]);
  const selectedOrderIds = useMemo(
    () => Array.from(new Set(selectedProductionJobs.map((job) => (job as any).orderId || job.order?.id).filter(Boolean))),
    [selectedProductionJobs],
  );
  const active = status === "in_progress" || status === "paused";
  const mixedRollView = station === "roll" && status === "all";
  const action: RollBulkTransition = mixedRollView ? allAction : status === "queued" ? "start" : targetStatus;
  const transitionBlockers = station === "roll" ? selectedProductionJobs.flatMap((job) => {
    const reason = rollProductionTransitionBlocker(job, action);
    return reason ? [{ job, reason }] : [];
  }) : [];
  const batchTooLarge = selectedProductionJobs.length > MAX_PRODUCTION_BULK_ITEMS;
  const hasIncompatibleProductionSelection = selectedIds.length !== selectedProductionJobs.length;
  const hasIncompatibleReturnSelection = selectedIds.length !== selectedReturnJobs.length;
  const canCreateRun = status === "queued" && selectedProductionJobs.length > 1 && selectedOrderIds.length === 1 && !hasIncompatibleProductionSelection;
  const isPending = bulkStart.isPending || bulkStatus.isPending || bulkPrinterAssignment.isPending || createRun.isPending || returnToPrepress.isPending;
  const totalSelectedQuantity = selectedProductionJobs.reduce((sum, job) => sum + (Number((job as any).qty ?? job.order?.lineItems?.primary?.quantity ?? 0) || 0), 0);
  const expectedPlacements = (Number(plannedSheetCount) || 0) * (Number(nominalPiecesPerSheet) || 0);
  const visibleIds = visibleSelectableJobs.map((job) => job.id);
  const selectedVisibleCount = visibleIds.filter((id) => selectedJobIds.has(id)).length;
  const machineSuggestions = useMemo(() => {
    const configured = eligibleJobs.filter(job => Array.isArray(job.printerOptions));
    // Per-job options come from the same tenant configuration as row assignment.
    // Existing assignment labels remain available for manual historical use.
    const choices = configured.length ? [...configured.flatMap(job => job.printerOptions ?? []), ...machineOptions] : machineOptions.length ? machineOptions : undefined;
    return getProductionMachineOptions(station, choices);
  }, [eligibleJobs, machineOptions, station]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedJobIds.has(id));
  const actionLabel = action === "start" ? "Put selected into production" : `Update selected to ${action === "done" ? "completed" : action.replace("_", " ")}`;
  const targetLabel = action === "start" ? "in production" : action === "done" ? "completed" : action.replace("_", " ");
  const productionSelectionReason = hasIncompatibleProductionSelection ? "Selection includes jobs that are only eligible for Return to Prepress." : undefined;
  const returnSelectionReason = hasIncompatibleReturnSelection ? "Selection includes jobs that cannot safely return to Prepress." : undefined;
  const combinedRunReason = productionSelectionReason || (selectedProductionJobs.length > 1 && selectedOrderIds.length > 1 ? "Combined runs must use one order." : undefined);

  const toggleAllVisible = (checked: boolean) => {
    onSelectedJobIdsChange(new Set(
      checked
        ? Array.from(selectedJobIds).concat(visibleIds)
        : Array.from(selectedJobIds).filter((id) => !visibleIds.includes(id)),
    ));
  };

  const clearSelection = () => onSelectedJobIdsChange(new Set());

  const confirmStatusUpdate = async () => {
    if (selectedIds.length === 0 || hasIncompatibleProductionSelection || transitionBlockers.length > 0 || batchTooLarge || isPending || submittingAction.current) return;
    submittingAction.current = true;
    setStatusError(null);
    try {
      const requestedIds = selectedProductionJobs.map((job) => job.id);
      let result: { updatedItemCount?: number; updatedJobIds?: string[] };
      if (action === "start") {
        result = await bulkStart.mutateAsync({ station, jobIds: requestedIds });
      } else {
        result = await bulkStatus.mutateAsync({ station, jobIds: requestedIds, status: action });
      }
      const updatedIds = Array.isArray(result?.updatedJobIds) ? result.updatedJobIds : requestedIds;
      onSelectedJobIdsChange(new Set(Array.from(selectedJobIds).filter((id) => !updatedIds.includes(id))));
      setConfirmOpen(false);
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "The batch was rejected. Refresh and review the selected jobs before retrying.");
      // The mutation hook owns the user-facing, server-provided error message.
    } finally {
      submittingAction.current = false;
    }
  };

  const createCombinedRun = async () => {
    if (!canCreateRun || batchTooLarge || isPending || submittingAction.current) return;
    submittingAction.current = true;
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
      clearSelection();
      setRunOpen(false);
      setPlannedSheetCount("");
      setNominalPiecesPerSheet("");
      setSheetWidth("");
      setSheetHeight("");
      setNotes("");
      setOverrideReason("");
    } catch {
      // The mutation hook owns the user-facing, server-provided error message.
    } finally {
      submittingAction.current = false;
    }
  };

  const confirmReturnToPrepress = async () => {
    if (selectedIds.length === 0 || hasIncompatibleReturnSelection || selectedReturnJobs.length > MAX_PRODUCTION_BULK_ITEMS || isPending || submittingAction.current) return;
    submittingAction.current = true;
    try {
      await returnToPrepress.mutateAsync({
        station,
        jobIds: selectedReturnJobs.map((job) => job.id),
        reason: returnReason.trim() || "Return to Prepress requested from production board",
      });
      clearSelection();
      setReturnOpen(false);
    } catch {
      // The mutation hook owns the user-facing, server-provided error message.
    } finally {
      submittingAction.current = false;
    }
  };

  const assignMachine = async () => {
    if (!machineName.trim() || selectedIds.length === 0 || hasIncompatibleProductionSelection || batchTooLarge || isPending || submittingAction.current) return;
    submittingAction.current = true;
    try {
      await bulkPrinterAssignment.mutateAsync({
        station,
        jobIds: selectedProductionJobs.map((job) => job.id),
        assignedPrinterId: null,
        assignedPrinterName: machineName.trim(),
      });
      clearSelection();
      setMachineName("");
      setMachineOpen(false);
    } catch {
      // The mutation hook owns the user-facing, server-provided error message.
    } finally {
      submittingAction.current = false;
    }
  };

  const selectionControl = (
    <>
      <Checkbox
        checked={allVisibleSelected}
        onCheckedChange={(checked) => toggleAllVisible(checked === true)}
        aria-label="Select all eligible jobs currently visible"
        disabled={visibleIds.length === 0 || isPending}
      />
      <span className="text-xs text-titan-text-muted">Select all visible ({visibleIds.length})</span>
    </>
  );

  if (status !== "queued" && !active && !mixedRollView) return null;

  if (selectedIds.length === 0) {
    return <div className="mt-3 flex items-center gap-2"><span className="text-xs text-titan-text-muted">0 selected</span>{selectionControl}</div>;
  }

  return (
    <div className="sticky bottom-3 z-20 mt-3 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-titan-bg-card/95 px-3 py-2 shadow-lg backdrop-blur">
      {selectionControl}
      <span className="border-l border-titan-border-subtle pl-2 text-sm font-semibold text-titan-text-primary">{selectedIds.length} selected{selectedVisibleCount !== selectedIds.length ? ` (${selectedVisibleCount} visible)` : ""}</span>
      <Button size="sm" variant="ghost" onClick={clearSelection} disabled={isPending}>Clear selection</Button>
      {mixedRollView ? <select value={allAction} onChange={(event) => setAllAction(event.target.value as RollBulkTransition)} aria-label="Bulk production action" className="h-8 rounded-md border border-titan-border-subtle bg-titan-bg-card px-2 text-xs text-titan-text-primary" disabled={isPending}>
        <option value="start">Start queued jobs</option>
        <option value="done">Complete active jobs</option>
        <option value="queued">Return active jobs to queued</option>
        <option value="in_progress">Resume active jobs</option>
      </select> : null}
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
      <Button size="sm" onClick={() => { setStatusError(null); setConfirmOpen(true); }} disabled={hasIncompatibleProductionSelection || isPending || batchTooLarge} title={batchTooLarge ? `Select at most ${MAX_PRODUCTION_BULK_ITEMS} jobs per bulk update.` : productionSelectionReason}>
        {isPending ? "Updating…" : actionLabel}
      </Button>
      {batchTooLarge ? <span className="text-xs text-amber-700 dark:text-amber-300">Bulk updates allow at most {MAX_PRODUCTION_BULK_ITEMS} jobs per batch.</span> : null}
      <Button size="sm" variant="secondary" onClick={() => setMachineOpen(true)} disabled={hasIncompatibleProductionSelection || batchTooLarge || isPending} title={productionSelectionReason}>
        Assign Machine
      </Button>
      {status === "queued" || mixedRollView ? (
        <Button size="sm" variant="secondary" onClick={() => setReturnOpen(true)} disabled={hasIncompatibleReturnSelection || selectedReturnJobs.length > MAX_PRODUCTION_BULK_ITEMS || isPending} title={returnSelectionReason}>
          Return Selected to Prepress
        </Button>
      ) : null}
      {status === "queued" ? (
        <Button size="sm" variant="outline" onClick={() => setRunOpen(true)} disabled={!canCreateRun || isPending} title={combinedRunReason}>
          Create combined run
        </Button>
      ) : null}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm bulk production update</AlertDialogTitle>
            <AlertDialogDescription>
              Requested: update {selectedProductionJobs.length} independent production {selectedProductionJobs.length === 1 ? "job" : "jobs"} to {targetLabel}.
              {" "}Every job is checked again by the server. If any job is blocked, the entire batch is rolled back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <SelectedJobsList jobs={selectedProductionJobs} />
          {transitionBlockers.length > 0 ? <div role="alert" className="text-sm text-destructive"><p>{transitionBlockers.length} blocked; no jobs will be changed. Adjust the selection or action.</p><ul>{transitionBlockers.map(({ job, reason }) => <li key={job.id}>{jobLabel(job)}: {reason}</li>)}</ul></div> : null}
          {statusError ? <p role="alert" className="text-sm text-destructive">Bulk update could not be confirmed: {statusError} Selection is retained. Refresh the board before retrying.</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void confirmStatusUpdate(); }} disabled={isPending || selectedProductionJobs.length === 0 || transitionBlockers.length > 0 || hasIncompatibleProductionSelection || batchTooLarge}>
              {isPending ? "Updating…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={machineOpen} onOpenChange={setMachineOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Assign printer / machine</AlertDialogTitle>
            <AlertDialogDescription>Assign one printer or machine to exactly {selectedProductionJobs.length} selected eligible {selectedProductionJobs.length === 1 ? "job" : "jobs"}.</AlertDialogDescription>
          </AlertDialogHeader>
          <SelectedJobsList jobs={selectedProductionJobs} />
          <label className="block space-y-1 text-sm">
            <span className="text-xs font-medium text-titan-text-muted">Printer / Machine</span>
            <input aria-label="Printer / Machine" className="h-9 w-full rounded-md border border-titan-border-subtle bg-titan-bg-card px-2" list={`bulk-machine-options-${station}`} value={machineName} onChange={(event) => setMachineName(event.target.value)} placeholder="Enter machine used" disabled={isPending} />
            <datalist id={`bulk-machine-options-${station}`}>{machineSuggestions.map((option) => <option key={option} value={option} />)}</datalist>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void assignMachine(); }} disabled={isPending || !machineName.trim()}>
              {bulkPrinterAssignment.isPending ? "Assigning…" : "Assign Machine"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={runOpen} onOpenChange={setRunOpen}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Create combined production run</AlertDialogTitle>
            <AlertDialogDescription>Group {selectedProductionJobs.length} same-order jobs into one physical production run. Line-item quantities, pricing, fulfillment, and invoices stay on the original items.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4 text-sm">
            <SelectedJobsList jobs={selectedProductionJobs} />
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label="Planned sheets" value={plannedSheetCount} onChange={setPlannedSheetCount} />
              <NumberInput label="Pieces per sheet" value={nominalPiecesPerSheet} onChange={setNominalPiecesPerSheet} />
              <NumberInput label="Sheet width" value={sheetWidth} onChange={setSheetWidth} decimal />
              <NumberInput label="Sheet height" value={sheetHeight} onChange={setSheetHeight} decimal />
            </div>
            {plannedSheetCount && nominalPiecesPerSheet ? <div className={`rounded-md border px-3 py-2 text-xs ${expectedPlacements === totalSelectedQuantity ? "border-emerald-500/30 bg-emerald-500/10" : "border-amber-500/30 bg-amber-500/10"}`}>{expectedPlacements} expected placements — {totalSelectedQuantity} allocated pieces</div> : null}
            <TextInput label="Nesting / production notes" value={notes} onChange={setNotes} textarea />
            <TextInput label="Compatibility override reason" value={overrideReason} onChange={setOverrideReason} placeholder="Only needed when routing or material differs" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void createCombinedRun(); }} disabled={!canCreateRun || isPending}>{createRun.isPending ? "Creating…" : "Create draft run"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={returnOpen} onOpenChange={setReturnOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Return selected jobs to Prepress</AlertDialogTitle>
            <AlertDialogDescription>This will move exactly {selectedReturnJobs.length} unstarted standalone {selectedReturnJobs.length === 1 ? "job" : "jobs"} to the Prepress queue. Artwork, allocations, and the future production destination remain unchanged.</AlertDialogDescription>
          </AlertDialogHeader>
          <SelectedJobsList jobs={selectedReturnJobs} />
          <TextInput label="Reason" value={returnReason} onChange={setReturnReason} textarea disabled={isPending} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void confirmReturnToPrepress(); }} disabled={isPending || !returnReason.trim()}>{returnToPrepress.isPending ? "Returning…" : "Return to Prepress"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SelectedJobsList({ jobs }: { jobs: ProductionJobListItem[] }) {
  return <div className="max-h-40 overflow-auto rounded-md border border-titan-border-subtle">{jobs.map((job) => <div key={job.id} className="flex items-center justify-between gap-3 border-b border-titan-border-subtle px-3 py-2 text-xs last:border-b-0"><span>{jobLabel(job)}</span><span className="shrink-0 text-titan-text-muted">{String(job.status || "unknown").replace(/_/g, " ")}</span></div>)}</div>;
}

function NumberInput({ label, value, onChange, decimal = false }: { label: string; value: string; onChange: (value: string) => void; decimal?: boolean }) {
  return <label className="space-y-1"><span className="text-xs font-medium text-titan-text-muted">{label}</span><input className="h-9 w-full rounded-md border border-titan-border-subtle bg-titan-bg-card px-2" value={value} onChange={(event) => onChange(event.target.value)} inputMode={decimal ? "decimal" : "numeric"} /></label>;
}

function TextInput({ label, value, onChange, placeholder, textarea = false, disabled = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; textarea?: boolean; disabled?: boolean }) {
  return <label className="block space-y-1 text-sm"><span className="text-xs font-medium text-titan-text-muted">{label}</span>{textarea ? <textarea className="min-h-20 w-full rounded-md border border-titan-border-subtle bg-titan-bg-card px-2 py-2" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} /> : <input className="h-9 w-full rounded-md border border-titan-border-subtle bg-titan-bg-card px-2" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} disabled={disabled} />}</label>;
}
