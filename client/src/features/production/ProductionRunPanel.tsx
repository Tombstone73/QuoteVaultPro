import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useAuth } from "@/hooks/useAuth";
import {
  useReconcileCanceledProductionRun,
  useRepairCompletedProductionRunFulfillmentHandoff,
  useReopenCompletedProductionRun,
  useRecordProductionRunOutcome,
  useProductionJob,
  useTransitionProductionRun,
  type CanceledProductionRunReconciliationResult,
  type ProductionRunListItem,
} from "@/hooks/useProduction";
import { ProductionRunFilesPanel } from "./ProductionRunFilesPanel";
import { PrinterMachineAssignment } from "@/components/production/PrinterMachineAssignment";
import { ProductionAlertsPanel } from "@/components/production/ProductionAlertsPanel";
import { ProductionNotesSection } from "@/components/production/ProductionNotesSection";
export { isProductionRunItem, productionRunToBoardItem } from "@/lib/productionRuns";

function runAction(runStatus: ProductionRunListItem["runStatus"]): "release" | "start" | "complete" | null {
  if (runStatus === "draft") return "release";
  if (runStatus === "ready_for_production") return "start";
  if (runStatus === "in_production") return "complete";
  return null;
}

function designQuantityLabel(file: ProductionRunListItem["files"][number]) {
  const quantity = Number(file.productionQuantity);
  return Number.isInteger(quantity) && quantity > 0 ? `QTY ${quantity}` : "QTY unresolved";
}

export function ProductionRunPanel({ run, focusNestedFileUpload = false, onNestedFileUploadFocused, onCanceled, onViewRestoredJobs }: {
  run: ProductionRunListItem;
  focusNestedFileUpload?: boolean;
  onNestedFileUploadFocused?: () => void;
  onCanceled?: (result: { restoredMemberCount?: number; alreadyRestoredMemberCount?: number; unresolvedMemberJobIds?: string[] }) => void;
  onViewRestoredJobs?: () => void;
}) {
  const { user, isAdmin } = useAuth();
  const transition = useTransitionProductionRun();
  const recordOutcome = useRecordProductionRunOutcome();
  const reconcileCanceledRun = useReconcileCanceledProductionRun();
  const reopenCompletedRun = useReopenCompletedProductionRun();
  const repairFulfillmentHandoff = useRepairCompletedProductionRunFulfillmentHandoff();
  const action = runAction(run.runStatus);
  const isActiveRun = run.runStatus === "in_production" || run.runStatus === "partially_completed";
  const leadMember = run.members[0] ?? null;
  const { data: leadJob } = useProductionJob(isActiveRun ? leadMember?.productionJobId : undefined);
  const [recordingResults, setRecordingResults] = useState(isActiveRun);
  const resultsSectionRef = useRef<HTMLDivElement | null>(null);
  const [reconcileConfirmationOpen, setReconcileConfirmationOpen] = useState(false);
  const [reopenConfirmationOpen, setReopenConfirmationOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reconciliationResult, setReconciliationResult] = useState<CanceledProductionRunReconciliationResult | null>(null);
  const initialDrafts = useMemo(() => Object.fromEntries(run.members.map((member) => [member.id, {
    successfulQuantity: member.successfulQuantity || member.completedQuantity || 0,
    damagedQuantity: member.damagedQuantity || 0,
    recoveryDisposition: member.recoveryDisposition || "none",
    operatorNote: member.operatorNote || "",
  }])), [run.members]);
  const [drafts, setDrafts] = useState(initialDrafts);
  useEffect(() => setDrafts(initialDrafts), [initialDrafts]);
  useEffect(() => { if (isActiveRun) setRecordingResults(true); }, [isActiveRun]);
  const placements = (Number(run.plannedSheetCount) || 0) * (Number(run.nominalPiecesPerSheet) || 0);
  const mismatch = placements > 0 && placements !== run.totalAllocatedQuantity;
  const activeFileCount = run.fileCount ?? run.files?.filter((file) => file.status === "active").length ?? 0;
  const reopened = run.members.some((member) => String(member.operatorNote || "").startsWith("Completion reopened:"));
  const replacementRequired = run.replacementRequired ?? activeFileCount === 0;
  const unfinishedMembers = run.members.filter((member) => member.remainingQuantity > 0);
  const resultRows = run.members.map((member) => {
    const draft = drafts[member.id] ?? initialDrafts[member.id];
    const successfulQuantity = Number(draft.successfulQuantity) || 0;
    const damagedQuantity = Number(draft.damagedQuantity) || 0;
    const remainingQuantity = member.allocatedQuantity - successfulQuantity - damagedQuantity;
    return { member, draft, successfulQuantity, damagedQuantity, remainingQuantity };
  });
  const invalidResultRows = resultRows.filter(({ member, successfulQuantity, damagedQuantity, remainingQuantity }) => (
    !Number.isInteger(successfulQuantity)
    || !Number.isInteger(damagedQuantity)
    || successfulQuantity < Number(member.successfulQuantity || member.completedQuantity || 0)
    || damagedQuantity < Number(member.damagedQuantity || 0)
    || remainingQuantity < 0
  ));
  const unresolvedResultRows = resultRows.filter(({ remainingQuantity }) => remainingQuantity !== 0);
  const resultsComplete = resultRows.length > 0 && invalidResultRows.length === 0 && unresolvedResultRows.length === 0;
  const totalGood = resultRows.reduce((sum, row) => sum + row.successfulQuantity, 0);
  const totalDamaged = resultRows.reduce((sum, row) => sum + row.damagedQuantity, 0);
  const totalRemaining = resultRows.reduce((sum, row) => sum + Math.max(0, row.remainingQuantity), 0);
  const completedSheetEstimate = run.nominalPiecesPerSheet ? Math.floor((totalGood + totalDamaged) / Number(run.nominalPiecesPerSheet)) : null;
  const completionBlockedReason = replacementRequired
    ? "A required nested production file is missing."
    : invalidResultRows.length
      ? "Correct invalid good or damaged quantities before completion."
      : unresolvedResultRows.length
        ? `Record results for ${unresolvedResultRows.length} member${unresolvedResultRows.length === 1 ? "" : "s"}.`
        : null;
  const isAdminOrOwner = Boolean(isAdmin || user?.isAdmin || user?.role === "admin" || user?.role === "owner");
  const canReconcileCanceledRun = isAdminOrOwner
    && run.runStatus === "canceled"
    && unfinishedMembers.length > 0
    && reconciliationResult?.reconciliationRequired !== false;
  const canReopenCompletedRun = isAdminOrOwner && run.runStatus === "completed" && run.members.every((member) => member.outcomeStatus === "completed" && member.remainingQuantity === 0);
  const releaseBlockedReason = action === "release" && replacementRequired
    ? "Nested production file required before release."
    : null;
  const updateDraft = (memberId: string, patch: Partial<typeof initialDrafts[string]>) => setDrafts((current) => ({
    ...current,
    [memberId]: { ...(current[memberId] ?? initialDrafts[memberId]), ...patch },
  }));
  const submitResults = () => {
    recordOutcome.mutate({
      runId: run.id,
      idempotencyKey: `operator-results:${run.id}:${Date.now()}`,
      members: run.members.map((member) => {
        const draft = drafts[member.id] ?? initialDrafts[member.id];
        const successfulQuantity = Number(draft.successfulQuantity) || 0;
        const damagedQuantity = Number(draft.damagedQuantity) || 0;
        const remainingQuantity = member.allocatedQuantity - successfulQuantity - damagedQuantity;
        const recoveryDisposition = draft.recoveryDisposition === "none" ? "none" : draft.recoveryDisposition as any;
        return {
          memberId: member.id,
          successfulQuantity,
          damagedQuantity,
          remainingQuantity,
          recoveryDisposition,
          outcomeStatus: remainingQuantity <= 0 && successfulQuantity >= member.allocatedQuantity ? "completed" as const : recoveryDisposition === "return_to_prepress" ? "return_to_prepress" as const : recoveryDisposition === "requires_reprint" || recoveryDisposition === "return_to_production_queue" ? "requires_reprint" as const : "partially_completed" as const,
          operatorNote: draft.operatorNote,
        };
      }),
    }, { onSuccess: () => setRecordingResults(false) });
  };
  const markAllRunQuantitiesGood = () => {
    setDrafts(Object.fromEntries(run.members.map((member) => [member.id, {
      successfulQuantity: member.allocatedQuantity,
      damagedQuantity: 0,
      recoveryDisposition: "none",
      operatorNote: drafts[member.id]?.operatorNote ?? member.operatorNote ?? "",
    }])));
  };
  const focusResults = () => {
    setRecordingResults(true);
    requestAnimationFrame(() => resultsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const restoreCanceledRunMembers = () => {
    reconcileCanceledRun.mutate({ runId: run.id }, {
      onSuccess: (result) => {
        setReconciliationResult(result);
        setReconcileConfirmationOpen(false);
      },
    });
  };

  return (
    <div className="rounded-md border border-titan-border-subtle bg-titan-bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{run.displayNumber}</h3>
            <Badge variant="secondary">{run.runStatus.replace(/_/g, " ")}</Badge>
            {reopened ? <Badge variant="outline">Reopened</Badge> : null}
          </div>
          <div className="mt-1 text-xs text-titan-text-muted">
            Order {run.orderNumber} - {run.customerName} - {run.memberCount} line items
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {action && action !== "complete" ? (
            <Button
              size="sm"
              onClick={() => transition.mutate({ runId: run.id, action })}
              disabled={transition.isPending || !!releaseBlockedReason}
              title={releaseBlockedReason ?? undefined}
            >
              {action === "release" ? "Release" : action === "start" ? "Start" : "Complete"}
            </Button>
          ) : null}
          {run.runStatus === "draft" || run.runStatus === "ready_for_production" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => transition.mutate(
                { runId: run.id, action: "cancel", reason: "Canceled from production board" },
                { onSuccess: (result) => onCanceled?.(result as any) },
              )}
              disabled={transition.isPending}
            >
              Cancel
            </Button>
          ) : null}
          {isActiveRun ? (
            <Button size="sm" variant="outline" onClick={focusResults}>
              {resultsComplete ? "Results complete" : `Record Production Results${unresolvedResultRows.length ? ` (${unresolvedResultRows.length})` : ""}`}
            </Button>
          ) : null}
          {canReconcileCanceledRun ? (
            <Button size="sm" variant="outline" onClick={() => setReconcileConfirmationOpen(true)} disabled={reconcileCanceledRun.isPending}>
              {reconcileCanceledRun.isPending ? "Restoring Members…" : "Restore Members to Prepress"}
            </Button>
          ) : null}
          {canReopenCompletedRun ? (
            <Button size="sm" variant="outline" onClick={() => setReopenConfirmationOpen(true)} disabled={reopenCompletedRun.isPending}>
              Reopen Mistaken Completion
            </Button>
          ) : null}
          {isAdminOrOwner && run.runStatus === "completed" ? (
            <Button size="sm" variant="outline" onClick={() => repairFulfillmentHandoff.mutate({ runId: run.id })} disabled={repairFulfillmentHandoff.isPending}>
              {repairFulfillmentHandoff.isPending ? "Repairing Handoff…" : "Repair Fulfillment Handoff"}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
        <div className="rounded border border-violet-400/40 bg-violet-500/10 px-2 py-1"><span className="block text-[10px] font-bold tracking-wide text-violet-200">SHEETS REQUIRED</span><span className="text-lg font-black text-white">{run.plannedSheetCount ?? "Not planned"}</span></div>
        <div>Sheets: <span className="font-semibold">{run.plannedSheetCount ?? "—"}</span></div>
        <div>Pieces/sheet: <span className="font-semibold">{run.nominalPiecesPerSheet ?? "—"}</span></div>
        <div>Allocated: <span className="font-semibold">{run.totalAllocatedQuantity}</span></div>
        <div>Files: <span className="font-semibold">{activeFileCount}</span></div>
        <div>Target station: <span className="font-semibold">{run.stationKey}</span></div>
        <div>Started: <span className="font-semibold">{leadJob?.startedAt ? new Date(leadJob.startedAt).toLocaleString() : "Not recorded"}</span></div>
        <div>Progress: <span className="font-semibold">{totalGood + totalDamaged} / {run.totalAllocatedQuantity} pieces</span></div>
      </div>
      {isActiveRun ? (
        <div className="mt-3 grid gap-3 rounded-md border border-titan-border-subtle bg-black/10 p-3 md:grid-cols-2">
          <div>
            <div className="text-xs font-semibold">Machine assignment</div>
            <div className="mt-1 text-[11px] text-titan-text-muted">Assigned through the canonical production-job machine endpoint on the run’s lead member.</div>
            {leadMember ? <div className="mt-2"><PrinterMachineAssignment jobId={leadMember.productionJobId} stationKey={run.stationKey} assignedPrinterName={(leadJob as any)?.assignedPrinterName} assignedPrinterId={(leadJob as any)?.assignedPrinterId} assignedPrinterAt={(leadJob as any)?.assignedPrinterAt} printerOptions={(leadJob as any)?.printerOptions} compact /></div> : null}
          </div>
          <div className="rounded border border-titan-border-subtle p-2">
            <div className="text-xs font-semibold">Sheet progress</div>
            <div className="mt-1 text-sm">{run.plannedSheetCount ?? "—"} sheets required · {completedSheetEstimate ?? "—"} result-derived sheets completed</div>
            <div className="mt-1 text-[11px] text-titan-text-muted">Sheet completion is calculated from recorded pieces. The current run lifecycle has no persisted sheet-progress field, so this workspace does not fabricate a separate sheet counter.</div>
          </div>
        </div>
      ) : null}
      {mismatch ? (
        <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
          {placements} expected placements differs from {run.totalAllocatedQuantity} allocated pieces.
        </div>
      ) : null}
      {run.sheetPlanOverrideReason ? (
        <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
          Authorized manual sheet plan: {run.sheetPlanOverrideReason}
        </div>
      ) : null}
      {replacementRequired ? (
        <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
          {releaseBlockedReason ?? "Nested production file required before this run can be completed."}
        </div>
      ) : null}
      {run.runStatus === "canceled" && isAdminOrOwner && unfinishedMembers.length > 0 && reconciliationResult?.reconciliationRequired === false ? (
        <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
          No stranded members require reconciliation.
        </div>
      ) : null}
      <div className="mt-3">
        {isActiveRun ? <div className="mb-2 text-xs font-bold uppercase tracking-wide text-emerald-200">Primary production file — PRINT THIS FILE</div> : null}
        <ProductionRunFilesPanel run={run} focusUpload={focusNestedFileUpload} onUploadFocused={onNestedFileUploadFocused} />
      </div>
      <div className="mt-3 divide-y divide-titan-border-subtle rounded-md border border-titan-border-subtle">
        {run.members.map((member) => (
          <div key={member.id} className="grid gap-2 px-3 py-2 text-xs sm:grid-cols-[1fr_auto_auto_auto]">
            <div className="min-w-0 truncate">
              <div>{member.lineNumber ? `Line ${member.lineNumber}: ` : ""}{member.description}</div>
              <div className="text-[11px] text-titan-text-muted">
                Order {member.orderNumber || "unknown"} - {member.customerName} - {member.outcomeStatus.replace(/_/g, " ")}
                {member.recoveryDisposition && member.recoveryDisposition !== "none" ? ` - ${member.recoveryDisposition.replace(/_/g, " ")}` : ""}
              </div>
              {run.files?.filter((file) => file.lineItemId === member.orderLineItemId && file.status === "active").length ? (
                <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-titan-text-muted">
                  {run.files
                    .filter((file) => file.lineItemId === member.orderLineItemId && file.status === "active")
                    .map((file) => (
                      <span key={file.id} className="rounded border border-titan-border-subtle px-1.5 py-0.5">
                        {file.fileName}: {designQuantityLabel(file)}
                      </span>
                    ))}
                </div>
              ) : null}
            </div>
            <div>Ordered {member.orderedQuantity}</div>
            <div>Run {member.allocatedQuantity} / Good {member.successfulQuantity} / Damaged {member.damagedQuantity}</div>
            <div>Remaining {member.remainingQuantity}</div>
          </div>
        ))}
      </div>
      {isActiveRun ? (
        <div className="mt-3 rounded-md border border-titan-border-subtle bg-titan-bg-subtle p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">Completion summary</div>
            <Badge variant={resultsComplete ? "secondary" : "outline"}>{resultsComplete ? "Results complete" : `${unresolvedResultRows.length} unresolved member results`}</Badge>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-4">
            <div>Total good: <span className="font-semibold">{totalGood}</span></div>
            <div>Total damaged: <span className="font-semibold">{totalDamaged}</span></div>
            <div>Total remaining: <span className="font-semibold">{totalRemaining}</span></div>
            <div>Sheets planned: <span className="font-semibold">{run.plannedSheetCount ?? "—"}</span></div>
          </div>
          {completionBlockedReason ? <div className="mt-2 text-amber-200">Complete blocked: {completionBlockedReason}</div> : <div className="mt-2 text-emerald-200">Results reconcile. Completion will use the canonical server-side validation and fulfillment handoff.</div>}
        </div>
      ) : null}
      {recordingResults ? (
        <div ref={resultsSectionRef} className="mt-3 rounded-md border border-titan-border-subtle p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold">Production Results by Member</div>
            <Button size="sm" variant="outline" onClick={markAllRunQuantitiesGood}>Mark all run quantities good</Button>
          </div>
          <div className="space-y-3">
            {run.members.map((member) => {
              const draft = drafts[member.id] ?? initialDrafts[member.id];
              const successfulQuantity = Number(draft.successfulQuantity) || 0;
              const damagedQuantity = Number(draft.damagedQuantity) || 0;
              const remainingQuantity = member.allocatedQuantity - successfulQuantity - damagedQuantity;
              return (
                <div key={`outcome-${member.id}`} className="grid gap-2 rounded border border-titan-border-subtle p-2 text-xs md:grid-cols-[1.4fr_0.6fr_0.6fr_0.9fr_1.2fr]">
                  <div>
                    <div className="font-medium">{member.orderNumber ? `Order ${member.orderNumber} - ` : ""}{member.description}</div>
                    <div className="text-titan-text-muted">Ordered {member.orderedQuantity}; run {member.allocatedQuantity}; remaining after entry {remainingQuantity}</div>
                  </div>
                  <label className="grid gap-1">
                    <span>Successful</span>
                    <input
                      type="number"
                      min={member.successfulQuantity}
                      max={member.allocatedQuantity}
                      value={draft.successfulQuantity}
                      onChange={(event) => updateDraft(member.id, { successfulQuantity: Number(event.target.value) })}
                      className="rounded border border-titan-border-subtle bg-transparent px-2 py-1"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span>Damaged</span>
                    <input
                      type="number"
                      min={member.damagedQuantity}
                      max={member.allocatedQuantity}
                      value={draft.damagedQuantity}
                      onChange={(event) => updateDraft(member.id, { damagedQuantity: Number(event.target.value) })}
                      className="rounded border border-titan-border-subtle bg-transparent px-2 py-1"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span>Recovery</span>
                    <select
                      value={draft.recoveryDisposition}
                      onChange={(event) => updateDraft(member.id, { recoveryDisposition: event.target.value as any })}
                      className="rounded border border-titan-border-subtle bg-titan-bg-card px-2 py-1"
                    >
                      <option value="none">None</option>
                      <option value="return_to_prepress">Return to prepress</option>
                      <option value="return_to_production_queue">Production queue</option>
                      <option value="requires_reprint">Requires reprint</option>
                      <option value="hold_for_review">Hold for review</option>
                      <option value="cancel_remaining">Cancel remaining</option>
                    </select>
                  </label>
                  <label className="grid gap-1">
                    <span>Note</span>
                    <input
                      value={draft.operatorNote}
                      onChange={(event) => updateDraft(member.id, { operatorNote: event.target.value })}
                      className="rounded border border-titan-border-subtle bg-transparent px-2 py-1"
                    />
                  </label>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setRecordingResults(false)}>Collapse Results</Button>
            <Button size="sm" onClick={submitResults} disabled={recordOutcome.isPending || invalidResultRows.length > 0}>Save Results</Button>
            <Button size="sm" onClick={submitResults} disabled={recordOutcome.isPending || !!completionBlockedReason} title={completionBlockedReason ?? undefined}>
              {recordOutcome.isPending ? "Saving…" : "Complete Run"}
            </Button>
          </div>
        </div>
      ) : null}
      {isActiveRun && leadMember ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <ProductionNotesSection jobId={leadMember.productionJobId} notes={(leadJob as any)?.notes ?? []} title="Run production notes" />
          <div className="rounded-md border border-titan-border-subtle p-3"><div className="mb-2 text-xs font-semibold">Production alerts</div><ProductionAlertsPanel alerts={(leadJob as any)?.productionAlerts ?? []} productionJobId={leadMember.productionJobId} compact empty={<div className="text-xs text-titan-text-muted">No active production alerts.</div>} /></div>
        </div>
      ) : null}
      {isActiveRun ? (
        <div className="sticky bottom-3 z-10 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-violet-400/40 bg-slate-950/95 px-3 py-2 shadow-lg backdrop-blur">
          <div className="text-xs"><span className="font-semibold">{run.displayNumber}</span> · {resultsComplete ? "Results complete" : `${unresolvedResultRows.length} results unresolved`}</div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={focusResults}>Record Results</Button>
            <Button size="sm" onClick={submitResults} disabled={recordOutcome.isPending || !!completionBlockedReason} title={completionBlockedReason ?? undefined}>Complete Run</Button>
          </div>
        </div>
      ) : null}
      {run.notes ? <div className="mt-3 text-xs text-titan-text-muted">{run.notes}</div> : null}
      {reconciliationResult ? (
        <div className="mt-3 rounded-md border border-titan-border-subtle p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">Canceled-run reconciliation result</div>
            {reconciliationResult.restoredMemberCount > 0 && onViewRestoredJobs ? (
              <Button size="sm" variant="outline" onClick={onViewRestoredJobs}>View Restored Jobs in Prepress</Button>
            ) : null}
          </div>
          <div className="mt-2 grid gap-1 sm:grid-cols-3">
            <div>Restored: <span className="font-semibold">{reconciliationResult.restoredMemberJobIds.join(", ") || "None"}</span></div>
            <div>Already in Prepress: <span className="font-semibold">{reconciliationResult.alreadyRestoredMemberJobIds.join(", ") || "None"}</span></div>
            <div>Requires review: <span className="font-semibold">{reconciliationResult.unresolvedMemberJobIds.join(", ") || "None"}</span></div>
          </div>
          <div className="mt-3 space-y-2">
            {reconciliationResult.memberResults.map((memberResult) => (
              <div key={memberResult.productionRunMemberId} className="rounded border border-titan-border-subtle px-2 py-1.5">
                <div className="font-medium">Job {memberResult.productionJobId} · {memberResult.action.replace(/_/g, " ")}</div>
                <div className="text-titan-text-muted">{memberResult.reason}</div>
                <div className="mt-1 text-titan-text-muted">Owner: {memberResult.finalWorkflowOwner ?? "unresolved"} · Destination: {memberResult.productionDestination} · Active Prepress sessions: {memberResult.activePrepressSessionCount}{memberResult.duplicateActivePrepressSession ? " (duplicate sessions require review)" : ""}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <AlertDialog open={reconcileConfirmationOpen} onOpenChange={setReconcileConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore members to Prepress?</AlertDialogTitle>
            <AlertDialogDescription>
              Restore eligible unfinished members from {run.displayNumber} to Prepress? The canceled run and its files will remain in History.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 text-sm">
            <div><span className="font-medium">Run:</span> {run.displayNumber} · {unfinishedMembers.length} unfinished member{unfinishedMembers.length === 1 ? "" : "s"}</div>
            <div><span className="font-medium">Current run station:</span> {run.stationKey} (the server revalidates each member's active workflow owner)</div>
            <div><span className="font-medium">Preserved run files:</span> {run.files.filter((file) => file.status === "active").map((file) => file.fileName).join(", ") || "None"}</div>
            <div className="rounded border border-titan-border-subtle p-2 text-xs text-titan-text-muted">
              {unfinishedMembers.map((member) => `Job ${member.productionJobId} (Line ${member.lineNumber ?? "?"}, owner: ${member.currentWorkflowOwner ?? "unresolved"}, station: ${member.currentWorkflowStation ?? "unresolved"}, ${member.remainingQuantity} remaining)`).join(" · ")}
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reconcileCanceledRun.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); restoreCanceledRunMembers(); }} disabled={reconcileCanceledRun.isPending}>
              {reconcileCanceledRun.isPending ? "Restoring…" : "Restore Members"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={reopenConfirmationOpen} onOpenChange={setReopenConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reopen completed run?</AlertDialogTitle>
            <AlertDialogDescription>
              This admin recovery restores this run’s members only when its fulfillment successors have not started. It preserves the run and member audit history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Recovery reason</span>
            <input value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} maxLength={2000} className="rounded border border-titan-border-subtle bg-transparent px-2 py-1" />
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reopenCompletedRun.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={reopenCompletedRun.isPending || !reopenReason.trim()}
              onClick={(event) => {
                event.preventDefault();
                reopenCompletedRun.mutate({ runId: run.id, reason: reopenReason.trim() }, {
                  onSuccess: () => { setReopenConfirmationOpen(false); setReopenReason(""); },
                });
              }}
            >
              {reopenCompletedRun.isPending ? "Reopening…" : "Reopen Run"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
