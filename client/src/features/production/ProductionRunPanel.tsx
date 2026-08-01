import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useRecordProductionRunOutcome,
  useTransitionProductionRun,
  type ProductionRunListItem,
} from "@/hooks/useProduction";
import { ProductionRunFilesPanel } from "./ProductionRunFilesPanel";
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

export function ProductionRunPanel({ run, focusNestedFileUpload = false, onNestedFileUploadFocused, onCanceled }: {
  run: ProductionRunListItem;
  focusNestedFileUpload?: boolean;
  onNestedFileUploadFocused?: () => void;
  onCanceled?: (result: { restoredMemberCount?: number; alreadyRestoredMemberCount?: number; unresolvedMemberJobIds?: string[] }) => void;
}) {
  const transition = useTransitionProductionRun();
  const recordOutcome = useRecordProductionRunOutcome();
  const action = runAction(run.runStatus);
  const [recordingResults, setRecordingResults] = useState(false);
  const initialDrafts = useMemo(() => Object.fromEntries(run.members.map((member) => [member.id, {
    successfulQuantity: member.successfulQuantity || member.completedQuantity || member.allocatedQuantity,
    damagedQuantity: member.damagedQuantity || 0,
    recoveryDisposition: member.recoveryDisposition || "none",
    operatorNote: member.operatorNote || "",
  }])), [run.members]);
  const [drafts, setDrafts] = useState(initialDrafts);
  const placements = (Number(run.plannedSheetCount) || 0) * (Number(run.nominalPiecesPerSheet) || 0);
  const mismatch = placements > 0 && placements !== run.totalAllocatedQuantity;
  const activeFileCount = run.fileCount ?? run.files?.filter((file) => file.status === "active").length ?? 0;
  const replacementRequired = run.replacementRequired ?? activeFileCount === 0;
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
        const remainingQuantity = Math.max(0, member.allocatedQuantity - successfulQuantity - damagedQuantity);
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

  return (
    <div className="rounded-md border border-titan-border-subtle bg-titan-bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{run.displayNumber}</h3>
            <Badge variant="secondary">{run.runStatus.replace(/_/g, " ")}</Badge>
          </div>
          <div className="mt-1 text-xs text-titan-text-muted">
            Order {run.orderNumber} - {run.customerName} - {run.memberCount} line items
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {action ? (
            <Button
              size="sm"
              onClick={() => transition.mutate({ runId: run.id, action })}
              disabled={transition.isPending || !!releaseBlockedReason}
              title={releaseBlockedReason ?? undefined}
            >
              {action === "release" ? "Release" : action === "start" ? "Start" : "Complete"}
            </Button>
          ) : null}
          {run.runStatus !== "completed" && run.runStatus !== "canceled" ? (
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
          {run.runStatus !== "completed" && run.runStatus !== "completed_with_exceptions" && run.runStatus !== "canceled" ? (
            <Button size="sm" variant="outline" onClick={() => setRecordingResults((value) => !value)}>
              Record Results
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
      </div>
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
      <div className="mt-3">
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
      {recordingResults ? (
        <div className="mt-3 rounded-md border border-titan-border-subtle p-3">
          <div className="mb-3 text-xs font-semibold">Record run results by member</div>
          <div className="space-y-3">
            {run.members.map((member) => {
              const draft = drafts[member.id] ?? initialDrafts[member.id];
              const successfulQuantity = Number(draft.successfulQuantity) || 0;
              const damagedQuantity = Number(draft.damagedQuantity) || 0;
              const remainingQuantity = Math.max(0, member.allocatedQuantity - successfulQuantity - damagedQuantity);
              return (
                <div key={`outcome-${member.id}`} className="grid gap-2 rounded border border-titan-border-subtle p-2 text-xs md:grid-cols-[1.4fr_0.6fr_0.6fr_0.9fr_1.2fr]">
                  <div>
                    <div className="font-medium">{member.orderNumber ? `Order ${member.orderNumber} - ` : ""}{member.description}</div>
                    <div className="text-titan-text-muted">Allocated {member.allocatedQuantity}; remaining after entry {remainingQuantity}</div>
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
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setRecordingResults(false)}>Close</Button>
            <Button size="sm" onClick={submitResults} disabled={recordOutcome.isPending}>Save Results</Button>
          </div>
        </div>
      ) : null}
      {run.notes ? <div className="mt-3 text-xs text-titan-text-muted">{run.notes}</div> : null}
    </div>
  );
}
