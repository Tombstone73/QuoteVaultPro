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
  useCompleteProductionRunReturnToPrepress,
  useRepairCompletedProductionRunFulfillmentHandoff,
  useReopenCompletedProductionRun,
  useRecordProductionRunOutcome,
  useReturnProductionRunToPrepress,
  useProductionJob,
  useSubmitReprintRequest,
  useTransitionProductionRun,
  type CanceledProductionRunReconciliationResult,
  type ProductionRunListItem,
} from "@/hooks/useProduction";
import { ProductionRunFilesPanel } from "./ProductionRunFilesPanel";
import { PrinterMachineAssignment } from "@/components/production/PrinterMachineAssignment";
import { ProductionAlertsPanel } from "@/components/production/ProductionAlertsPanel";
import { ProductionNotesSection } from "@/components/production/ProductionNotesSection";
import {
  buildInitialProductionRunSheetProgressSnapshot,
  summarizeProductionRunSheetProgress,
  type ProductionRunSheetProgressSnapshot,
} from "@shared/productionRunSheetProgress";
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
  const completeCanceledReturn = useCompleteProductionRunReturnToPrepress();
  const reopenCompletedRun = useReopenCompletedProductionRun();
  const repairFulfillmentHandoff = useRepairCompletedProductionRunFulfillmentHandoff();
  const returnRunToPrepress = useReturnProductionRunToPrepress();
  const action = runAction(run.runStatus);
  const isStartedRun = (run.runStatus === "in_production" || run.runStatus === "partially_completed") && Boolean(run.startedAt);
  const isPausedRun = run.runStatus === "ready_for_production" && Boolean(run.startedAt);
  const isOperationalRun = run.runStatus === "ready_for_production" || run.runStatus === "in_production" || run.runStatus === "partially_completed";
  const isActiveRun = isStartedRun;
  const leadMember = run.members[0] ?? null;
  const { data: leadJob } = useProductionJob(leadMember?.productionJobId);
  const [recordingResults, setRecordingResults] = useState(false);
  const initialSheetProgress = useMemo(() => buildInitialProductionRunSheetProgressSnapshot({
    existing: run.sheetProgressSnapshot,
    files: run.files,
    plannedSheetCount: run.plannedSheetCount,
    defaultRequiredImpressions: null,
  }), [run.files, run.plannedSheetCount, run.sheetProgressSnapshot]);
  const [sheetProgressDraft, setSheetProgressDraft] = useState<ProductionRunSheetProgressSnapshot | null>(initialSheetProgress);
  const [currentSheetIndex, setCurrentSheetIndex] = useState(0);
  const resultsSectionRef = useRef<HTMLDivElement | null>(null);
  const [reconcileConfirmationOpen, setReconcileConfirmationOpen] = useState(false);
  const [reopenConfirmationOpen, setReopenConfirmationOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [returnConfirmationOpen, setReturnConfirmationOpen] = useState(false);
  const [returnReason, setReturnReason] = useState("Nesting requires revision");
  const [reconciliationResult, setReconciliationResult] = useState<CanceledProductionRunReconciliationResult | null>(null);
  const [shortageMember, setShortageMember] = useState<ProductionRunListItem["members"][number] | null>(null);
  const [shortageQuantity, setShortageQuantity] = useState("1");
  const [shortageReason, setShortageReason] = useState("");
  const submitShortageReprint = useSubmitReprintRequest(shortageMember?.productionJobId ?? leadMember?.productionJobId ?? "");
  const initialDrafts = useMemo(() => Object.fromEntries(run.members.map((member) => [member.id, {
    successfulQuantity: member.successfulQuantity || member.completedQuantity || 0,
    damagedQuantity: member.damagedQuantity || 0,
    recoveryDisposition: member.recoveryDisposition || "none",
    operatorNote: member.operatorNote || "",
  }])), [run.members]);
  const [drafts, setDrafts] = useState(initialDrafts);
  useEffect(() => setDrafts(initialDrafts), [initialDrafts]);
  useEffect(() => {
    setSheetProgressDraft(initialSheetProgress);
    setCurrentSheetIndex(0);
  }, [initialSheetProgress]);
  const sheetProgressSummary = useMemo(() => summarizeProductionRunSheetProgress(sheetProgressDraft), [sheetProgressDraft]);
  const currentSheet = sheetProgressDraft?.sheets[currentSheetIndex] ?? sheetProgressDraft?.sheets[0] ?? null;
  const currentSheetFile = currentSheet?.fileId ? run.files.find((file) => file.id === currentSheet.fileId) ?? null : null;
  const sheetQuantityLabel = sheetProgressSummary.sheetCount === 1
    ? `Run quantity: ${currentSheet?.requiredImpressions || run.totalAllocatedQuantity || "-"}`
    : sheetProgressSummary.requiredImpressions > 0 && sheetProgressSummary.requiredImpressions === sheetProgressSummary.sheetCount
      ? "1 copy each"
      : sheetProgressSummary.requiredImpressions > 0
        ? `${sheetProgressSummary.requiredImpressions} planned impressions`
        : "Quantity planned by allocation";
  const placements = (Number(run.plannedSheetCount) || 0) * (Number(run.nominalPiecesPerSheet) || 0);
  const mismatch = placements > 0 && placements !== run.totalAllocatedQuantity;
  const activeFileCount = run.fileCount ?? run.files?.filter((file) => file.status === "active").length ?? 0;
  const reopened = run.members.some((member) => String(member.operatorNote || "").startsWith("Completion reopened:"));
  const recoveryReasons = Array.from(new Set(run.members
    .map((member) => String(member.operatorNote || "").replace(/^Completion reopened:\s*/, "").trim())
    .filter(Boolean)));
  const replacementRequired = run.replacementRequired ?? activeFileCount === 0;
  const unfinishedMembers = run.members.filter((member) => member.remainingQuantity > 0);
  const resultRows = run.members.map((member) => {
    const draft = drafts[member.id] ?? initialDrafts[member.id];
    const successfulQuantity = Number(draft.successfulQuantity) || 0;
    const damagedQuantity = Number(draft.damagedQuantity) || 0;
    const remainingQuantity = member.allocatedQuantity - successfulQuantity;
    return { member, draft, successfulQuantity, damagedQuantity, remainingQuantity };
  });
  const invalidResultRows = resultRows.filter(({ member, successfulQuantity, damagedQuantity, remainingQuantity }) => (
    !Number.isInteger(successfulQuantity)
    || !Number.isInteger(damagedQuantity)
    || successfulQuantity < Number(member.successfulQuantity || member.completedQuantity || 0)
    || damagedQuantity < Number(member.damagedQuantity || 0)
      || remainingQuantity < 0
      || successfulQuantity > Number(member.allocatedQuantity || 0)
  ));
  const normalCompletionBlockedReason = !isStartedRun
    ? "Start the run first."
    : replacementRequired
    ? "A required nested production file is missing."
    : null;
  const exceptionBlockedReason = invalidResultRows.length
    ? "Correct invalid good or damaged quantities before saving."
    : null;
  const isAdminOrOwner = Boolean(isAdmin || user?.isAdmin || user?.role === "admin" || user?.role === "owner");
  const canReturnEntireRun = isAdminOrOwner && isOperationalRun && run.members.length > 0 && run.members.every((member) => member.successfulQuantity === 0 && member.completedQuantity === 0 && member.damagedQuantity === 0 && member.remainingQuantity === member.allocatedQuantity && member.outcomeStatus === "pending");
  const strandedCanceledMembers = unfinishedMembers.filter((member) => member.currentWorkflowOwner !== "prepress");
  const canReconcileCanceledRun = isAdminOrOwner
    && run.runStatus === "canceled"
    && unfinishedMembers.length > 0
    && strandedCanceledMembers.length > 0;
  const canceledRunFullyRestored = isAdminOrOwner && run.runStatus === "canceled" && unfinishedMembers.length > 0 && strandedCanceledMembers.length === 0;
  const returnError = (returnRunToPrepress.error || completeCanceledReturn.error) as (Error & { code?: string | null; details?: { memberId?: string; productionJobId?: string; lineItemId?: string; members?: Array<{ productionJobId?: string }> } | null }) | null;
  const canReopenCompletedRun = isAdminOrOwner && run.runStatus === "completed" && run.members.every((member) => member.outcomeStatus === "completed" && member.remainingQuantity === 0);
  const canReportPostProductionShortage = run.runStatus === "completed" || run.runStatus === "completed_with_exceptions";
  const releaseBlockedReason = action === "release" && replacementRequired
    ? "Nested production file required before release."
    : null;
  const updateDraft = (memberId: string, patch: Partial<typeof initialDrafts[string]>) => setDrafts((current) => ({
    ...current,
    [memberId]: { ...(current[memberId] ?? initialDrafts[memberId]), ...patch },
  }));
  const completeRunAsPlanned = () => {
    transition.mutate({ runId: run.id, action: "complete", reason: "Completed as planned from production board" });
  };
  const submitResults = () => {
    recordOutcome.mutate({
      runId: run.id,
      idempotencyKey: `operator-results:${run.id}:${Date.now()}`,
      members: run.members.map((member) => {
        const draft = drafts[member.id] ?? initialDrafts[member.id];
        const successfulQuantity = Number(draft.successfulQuantity) || 0;
        const damagedQuantity = Number(draft.damagedQuantity) || 0;
        const remainingQuantity = member.allocatedQuantity - successfulQuantity;
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
  const focusResults = () => {
    setRecordingResults(true);
    requestAnimationFrame(() => resultsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const openShortageReport = (member: ProductionRunListItem["members"][number]) => {
    setShortageMember(member);
    setShortageQuantity("1");
    setShortageReason("");
  };
  const submitShortageReport = () => {
    if (!shortageMember) return;
    const quantity = Number(shortageQuantity);
    const filename = run.files.find((file) => file.lineItemId === shortageMember.orderLineItemId && file.status === "active")?.fileName
      ?? run.files.find((file) => file.status === "active")?.fileName
      ?? shortageMember.description
      ?? run.displayNumber;
    submitShortageReprint.mutate({
      lineItemId: shortageMember.orderLineItemId,
      filename,
      quantity,
      units: "pieces",
      reason: `Post-production shortage from ${run.displayNumber}: ${shortageReason.trim()}`,
      noPrintsCompletedYet: false,
    }, {
      onSuccess: () => {
        setShortageMember(null);
        setShortageReason("");
        setShortageQuantity("1");
      },
    });
  };
  const restoreCanceledRunMembers = () => {
    completeCanceledReturn.mutate({ runId: run.id }, {
      onSuccess: (result) => {
        setReconciliationResult({
          restoredMemberCount: result.restoredMemberJobIds.length,
          restoredMemberJobIds: result.restoredMemberJobIds,
          alreadyRestoredMemberCount: result.alreadyReturned ? run.members.length : 0,
          alreadyRestoredMemberJobIds: [],
          returnedToExistingQueueMemberCount: 0,
          returnedToExistingQueueMemberJobIds: [],
          unresolvedMemberJobIds: [],
          reconciliationRequired: false,
          memberResults: result.finalOwners.map((owner) => ({ productionRunMemberId: owner.lineItemId, productionJobId: owner.productionJobId, orderLineItemId: owner.lineItemId, action: "restored" as const, reason: "Completed return to Prepress.", finalWorkflowOwner: owner.owner, productionDestination: run.stationKey, activePrepressSessionCount: 1, duplicateActivePrepressSession: false })),
        });
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
          {reopened && recoveryReasons.length ? <div className="mt-1 text-xs text-amber-200">Recovery reason: {recoveryReasons.join(" · ")}</div> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {action && action !== "complete" ? (
            <Button
              size="sm"
              onClick={() => transition.mutate({ runId: run.id, action })}
              disabled={transition.isPending || !!releaseBlockedReason}
              title={releaseBlockedReason ?? undefined}
            >
              {action === "release" ? "Release" : action === "start" ? (isPausedRun ? "Resume Run" : "Start Run") : "Complete"}
            </Button>
          ) : null}
          {isStartedRun ? (
            <Button size="sm" variant="outline" onClick={() => transition.mutate({ runId: run.id, action: "pause" })} disabled={transition.isPending}>
              Pause Run
            </Button>
          ) : null}
          {canReturnEntireRun ? (
            <Button size="sm" variant="outline" onClick={() => setReturnConfirmationOpen(true)} disabled={returnRunToPrepress.isPending}>
              Return Run to Prepress
            </Button>
          ) : null}
          {run.runStatus === "draft" || (run.runStatus === "ready_for_production" && !run.startedAt) ? (
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
              Report Problem
            </Button>
          ) : null}
          {canReconcileCanceledRun ? (
            <Button size="sm" variant="outline" onClick={() => setReconcileConfirmationOpen(true)} disabled={completeCanceledReturn.isPending}>
              {completeCanceledReturn.isPending ? "Completing Return…" : "Complete Return to Prepress"}
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
      {isOperationalRun ? (
        <div className="mt-3 rounded-md border border-violet-400/40 bg-violet-500/10 px-3 py-2 text-xs">
          <div className="font-semibold">Current state: {run.lifecycleState === "in_progress" ? `${run.stationKey} in progress` : run.lifecycleState === "paused" ? `${run.stationKey} paused` : `Ready for ${run.stationKey}`}</div>
          <div className="mt-1 text-titan-text-muted">Next: {run.nextAction}</div>
        </div>
      ) : null}
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
        <div className="rounded border border-violet-400/40 bg-violet-500/10 px-2 py-1"><span className="block text-[10px] font-bold tracking-wide text-violet-200">SHEETS REQUIRED</span><span className="text-lg font-black text-white">{run.plannedSheetCount ?? "Not planned"}</span></div>
        <div>Sheets: <span className="font-semibold">{run.plannedSheetCount ?? "—"}</span></div>
        <div>Pieces/sheet: <span className="font-semibold">{run.nominalPiecesPerSheet ?? "—"}</span></div>
        <div>Allocated: <span className="font-semibold">{run.totalAllocatedQuantity}</span></div>
        <div>Files: <span className="font-semibold">{activeFileCount}</span></div>
        <div>Target station: <span className="font-semibold">{run.stationKey}</span></div>
        <div>Started: <span className="font-semibold">{run.startedAt ? new Date(run.startedAt).toLocaleString() : "Not recorded"}</span></div>
        <div>Planned output: <span className="font-semibold">{run.totalAllocatedQuantity} pieces</span></div>
      </div>
      {isOperationalRun ? (
        <div className="mt-3 grid gap-3 rounded-md border border-titan-border-subtle bg-black/10 p-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.8fr)]">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-200">Nested production artwork</div>
                <div className="text-[11px] text-titan-text-muted">
                  {currentSheet ? `${currentSheet.label} of ${sheetProgressDraft?.sheets.length ?? 0}` : "No nested sheet progress target"}
                  {currentSheetFile ? ` - ${currentSheetFile.fileName}` : ""}
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="outline" disabled={!sheetProgressDraft || currentSheetIndex <= 0} onClick={() => setCurrentSheetIndex((index) => Math.max(0, index - 1))}>Previous</Button>
                <Button size="sm" variant="outline" disabled={!sheetProgressDraft || currentSheetIndex >= (sheetProgressDraft.sheets.length - 1)} onClick={() => setCurrentSheetIndex((index) => Math.min((sheetProgressDraft?.sheets.length ?? 1) - 1, index + 1))}>Next</Button>
              </div>
            </div>
            <div className="flex min-h-[280px] items-center justify-center overflow-hidden rounded-md border border-titan-border-subtle bg-titan-bg-card">
              {currentSheetFile?.previewUrl || currentSheetFile?.thumbnailUrl ? (
                <img src={currentSheetFile.previewUrl ?? currentSheetFile.thumbnailUrl ?? ""} alt={currentSheetFile.fileName} className="max-h-[420px] w-full object-contain" />
              ) : (
                <div className="p-6 text-center text-sm text-titan-text-muted">
                  {currentSheetFile ? "Preview unavailable. Open the run production file below for inspection." : "Upload or select run-owned nested artwork before release, or use the RIP-managed workflow."}
                </div>
              )}
            </div>
            {sheetProgressDraft && sheetProgressDraft.sheets.length > 1 ? (
              <div className="mt-2 flex gap-1 overflow-x-auto pb-1">
                {sheetProgressDraft.sheets.map((sheet, index) => (
                  <button
                    key={sheet.id}
                    type="button"
                    className={`min-w-[76px] rounded border px-2 py-1 text-left text-[11px] ${index === currentSheetIndex ? "border-emerald-400 bg-emerald-500/10" : "border-titan-border-subtle bg-transparent"}`}
                    onClick={() => setCurrentSheetIndex(index)}
                  >
                    <span className="block font-semibold">{sheet.label}</span>
                    <span className="text-titan-text-muted">{sheet.requiredImpressions || 1} planned</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="space-y-3">
            <div className="rounded-md border border-titan-border-subtle p-3">
              <div className="text-xs font-semibold">Production reference</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div>Nested sheets: <span className="font-semibold">{sheetProgressSummary.sheetCount || run.plannedSheetCount || "-"}</span></div>
                <div>{sheetQuantityLabel}</div>
                <div>Planned pieces: <span className="font-semibold">{run.totalAllocatedQuantity}</span></div>
                <div>Child items: <span className="font-semibold">{run.memberCount}</span></div>
              </div>
              <div className="mt-2 text-xs text-titan-text-muted">No per-sheet checkoff required. Use Report Problem for damage, shortage, or reprint needs.</div>
            </div>
            <div className="rounded-md border border-titan-border-subtle p-3 text-xs">
              <div className="font-semibold">Planned run output</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>Nested sheets: <span className="font-semibold">{sheetProgressSummary.sheetCount || run.plannedSheetCount || "-"}</span></div>
                <div>Sheet quantity: <span className="font-semibold">{sheetProgressSummary.requiredImpressions || "-"}</span></div>
                <div>Allocated pieces: <span className="font-semibold">{run.totalAllocatedQuantity}</span></div>
                <div>Completion mode: <span className="font-semibold">Planned success</span></div>
              </div>
              <div className="mt-2 text-titan-text-muted">Completing the run records the planned allocated quantities through the existing production result workflow.</div>
            </div>
            <div className="rounded-md border border-titan-border-subtle p-3">
              <div className="text-xs font-semibold">Machine assignment</div>
              <div className="mt-1 text-[11px] text-titan-text-muted">Assigned through the canonical production-job machine endpoint on the run's lead member.</div>
              {leadMember ? <div className="mt-2"><PrinterMachineAssignment jobId={leadMember.productionJobId} stationKey={run.stationKey} assignedPrinterName={(leadJob as any)?.assignedPrinterName} assignedPrinterId={(leadJob as any)?.assignedPrinterId} assignedPrinterAt={(leadJob as any)?.assignedPrinterAt} printerOptions={(leadJob as any)?.printerOptions} compact /></div> : null}
            </div>
          </div>
        </div>
      ) : null}
      {isOperationalRun ? (
        <div className="hidden">
          <div>
            <div className="text-xs font-semibold">Machine assignment</div>
            <div className="mt-1 text-[11px] text-titan-text-muted">Assigned through the canonical production-job machine endpoint on the run’s lead member.</div>
            {leadMember ? <div className="mt-2"><PrinterMachineAssignment jobId={leadMember.productionJobId} stationKey={run.stationKey} assignedPrinterName={(leadJob as any)?.assignedPrinterName} assignedPrinterId={(leadJob as any)?.assignedPrinterId} assignedPrinterAt={(leadJob as any)?.assignedPrinterAt} printerOptions={(leadJob as any)?.printerOptions} compact /></div> : null}
          </div>
          <div className="rounded border border-titan-border-subtle p-2">
            <div className="text-xs font-semibold">Sheet reference</div>
            <div className="mt-1 text-sm">{run.plannedSheetCount ?? "—"} sheets required</div>
            <div className="mt-1 text-[11px] text-titan-text-muted">Sheet progress metadata is retained for reference, but normal completion uses planned allocations.</div>
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
      {canceledRunFullyRestored ? (
        <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
          No stranded members. All unfinished work is already owned by Prepress.
        </div>
      ) : null}
      {returnError ? (
        <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
          <div className="font-semibold">Return to Prepress blocked{returnError.code ? ` (${returnError.code})` : ""}</div>
          <div className="mt-1">{returnError.message}</div>
          {returnError.details?.productionJobId ? <div className="mt-1">Affected job: {returnError.details.productionJobId}</div> : null}
          {returnError.details?.members?.length ? <div className="mt-1">Affected jobs: {returnError.details.members.map((member) => member.productionJobId).filter(Boolean).join(", ")}</div> : null}
        </div>
      ) : null}
      <div className="mt-3">
        {isActiveRun ? <div className="mb-2 text-xs font-bold uppercase tracking-wide text-emerald-200">Primary production file — PRINT THIS FILE</div> : null}
        <ProductionRunFilesPanel run={run} focusUpload={focusNestedFileUpload} onUploadFocused={onNestedFileUploadFocused} />
      </div>
      <div className="mt-3">
        <div className="mb-2 flex items-center justify-between text-xs">
          <div className="font-semibold">Items in this Run</div>
          <div className="text-titan-text-muted">{run.memberCount} child line item{run.memberCount === 1 ? "" : "s"}</div>
        </div>
        <div className="divide-y divide-titan-border-subtle rounded-md border border-titan-border-subtle">
        {run.members.map((member) => (
          <div key={member.id} className="grid gap-2 px-3 py-2 text-xs sm:grid-cols-[1fr_auto_auto_auto_auto]">
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
            {canReportPostProductionShortage ? (
              <Button size="sm" variant="outline" onClick={() => openShortageReport(member)}>Report Shortage</Button>
            ) : null}
          </div>
        ))}
        </div>
      </div>
      {isActiveRun ? (
        <div className="mt-3 rounded-md border border-titan-border-subtle bg-titan-bg-subtle p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">Completion summary</div>
            <Badge variant="secondary">Planned success</Badge>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-4">
            <div>Expected good: <span className="font-semibold">{run.totalAllocatedQuantity}</span></div>
            <div>Child items: <span className="font-semibold">{run.memberCount}</span></div>
            <div>Nested sheets: <span className="font-semibold">{sheetProgressSummary.sheetCount || run.plannedSheetCount || "—"}</span></div>
            <div>Sheets planned: <span className="font-semibold">{run.plannedSheetCount ?? "—"}</span></div>
          </div>
          {normalCompletionBlockedReason ? <div className="mt-2 text-amber-200">Complete blocked: {normalCompletionBlockedReason}</div> : <div className="mt-2 text-emerald-200">Normal completion records planned run quantities as successful through canonical production logic.</div>}
        </div>
      ) : null}
      {recordingResults ? (
        <div ref={resultsSectionRef} className="mt-3 rounded-md border border-titan-border-subtle p-3">
          <div className="mb-3">
            <div className="text-xs font-semibold">Report Problem by child item</div>
            <div className="mt-1 text-[11px] text-titan-text-muted">Enter only the damaged, short, or unresolved quantities that need recovery.</div>
          </div>
          <div className="space-y-3">
            {run.members.map((member) => {
              const draft = drafts[member.id] ?? initialDrafts[member.id];
              const successfulQuantity = Number(draft.successfulQuantity) || 0;
              const damagedQuantity = Number(draft.damagedQuantity) || 0;
              const remainingQuantity = member.allocatedQuantity - successfulQuantity;
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
            <Button size="sm" onClick={submitResults} disabled={recordOutcome.isPending || !!exceptionBlockedReason} title={exceptionBlockedReason ?? undefined}>
              {recordOutcome.isPending ? "Saving…" : "Save Problem Report"}
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
      {isOperationalRun ? (
        <div className="sticky bottom-3 z-10 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-violet-400/40 bg-slate-950/95 px-3 py-2 shadow-lg backdrop-blur">
          <div className="text-xs"><span className="font-semibold">{run.displayNumber}</span> · Start, print, complete as planned</div>
          <div className="flex flex-wrap gap-2">
            {isStartedRun ? <Button size="sm" variant="outline" onClick={focusResults}>Report Problem</Button> : null}
            {isStartedRun ? <Button size="sm" variant="outline" onClick={() => transition.mutate({ runId: run.id, action: "pause" })} disabled={transition.isPending}>Pause Run</Button> : null}
            {canReturnEntireRun ? <Button size="sm" variant="outline" onClick={() => setReturnConfirmationOpen(true)} disabled={returnRunToPrepress.isPending}>Return Run to Prepress</Button> : null}
            <Button size="sm" onClick={completeRunAsPlanned} disabled={transition.isPending || !!normalCompletionBlockedReason} title={normalCompletionBlockedReason ?? undefined}>Complete Run</Button>
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
      <AlertDialog open={returnConfirmationOpen} onOpenChange={setReturnConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Return {run.displayNumber} and all {run.memberCount} members to Prepress?</AlertDialogTitle>
            <AlertDialogDescription>
              This preserves the nested production file and run history, ends the zero-progress production session, returns unfinished members to Prepress, and keeps {run.stationKey} as their future production destination.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Reason</span>
            <select value={returnReason} onChange={(event) => setReturnReason(event.target.value)} className="rounded border border-titan-border-subtle bg-titan-bg-card px-2 py-1">
              <option>Nesting requires revision</option>
              <option>Artwork correction</option>
              <option>Incorrect production setup</option>
              <option>Run reopened by mistake</option>
              <option>Machine/setup issue</option>
              <option>Other</option>
            </select>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={returnRunToPrepress.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={returnRunToPrepress.isPending || !returnReason.trim()} onClick={(event) => {
              event.preventDefault();
              returnRunToPrepress.mutate({ runId: run.id, reason: returnReason.trim() }, { onSuccess: () => setReturnConfirmationOpen(false) });
            }}>
              {returnRunToPrepress.isPending ? "Returning…" : "Return Run to Prepress"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={Boolean(shortageMember)} onOpenChange={(open) => { if (!open) setShortageMember(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Report shortage for {shortageMember?.orderNumber ? `Order ${shortageMember.orderNumber}` : run.displayNumber}</AlertDialogTitle>
            <AlertDialogDescription>
              This keeps {run.displayNumber} completed and creates recovery production only for the replacement quantity.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded border border-titan-border-subtle p-2 text-xs text-titan-text-muted">
              {shortageMember ? `${shortageMember.description} · original line quantity ${shortageMember.orderedQuantity} · run allocation ${shortageMember.allocatedQuantity}` : "No child item selected."}
            </div>
            <label className="grid gap-1">
              <span className="font-medium">Replacement quantity</span>
              <input type="number" min={1} value={shortageQuantity} onChange={(event) => setShortageQuantity(event.target.value)} className="rounded border border-titan-border-subtle bg-transparent px-2 py-1" />
            </label>
            <label className="grid gap-1">
              <span className="font-medium">Reason</span>
              <textarea value={shortageReason} onChange={(event) => setShortageReason(event.target.value)} maxLength={2000} className="min-h-[88px] rounded border border-titan-border-subtle bg-transparent px-2 py-1" />
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitShortageReprint.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitShortageReprint.isPending || !shortageMember || !(Number(shortageQuantity) > 0) || !shortageReason.trim()}
              onClick={(event) => {
                event.preventDefault();
                submitShortageReport();
              }}
            >
              {submitShortageReprint.isPending ? "Creating…" : "Create Recovery"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={reconcileConfirmationOpen} onOpenChange={setReconcileConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Complete return of {run.displayNumber} to Prepress?</AlertDialogTitle>
            <AlertDialogDescription>
              This repairs a previously canceled run only after every unfinished member passes ownership and session validation. The run and its files remain in History.
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
            <AlertDialogCancel disabled={completeCanceledReturn.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); restoreCanceledRunMembers(); }} disabled={completeCanceledReturn.isPending}>
              {completeCanceledReturn.isPending ? "Completing…" : "Complete Return to Prepress"}
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
