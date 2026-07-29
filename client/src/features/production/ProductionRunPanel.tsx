import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
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

export function ProductionRunPanel({ run }: { run: ProductionRunListItem }) {
  const transition = useTransitionProductionRun();
  const action = runAction(run.runStatus);
  const placements = (Number(run.plannedSheetCount) || 0) * (Number(run.nominalPiecesPerSheet) || 0);
  const mismatch = placements > 0 && placements !== run.totalAllocatedQuantity;
  const activeFileCount = run.fileCount ?? run.files?.filter((file) => file.status === "active").length ?? 0;
  const replacementRequired = run.replacementRequired ?? activeFileCount === 0;
  const releaseBlockedReason = action === "release" && replacementRequired
    ? "Upload the shared nested final production file before releasing this run."
    : null;

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
              onClick={() => transition.mutate({ runId: run.id, action: "cancel", reason: "Canceled from production board" })}
              disabled={transition.isPending}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
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
      {replacementRequired ? (
        <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
          {releaseBlockedReason ?? "Shared nested final production file required before this run can be completed."}
        </div>
      ) : null}
      <div className="mt-3">
        <ProductionRunFilesPanel run={run} />
      </div>
      <div className="mt-3 divide-y divide-titan-border-subtle rounded-md border border-titan-border-subtle">
        {run.members.map((member) => (
          <div key={member.id} className="grid gap-2 px-3 py-2 text-xs sm:grid-cols-[1fr_auto_auto_auto]">
            <div className="min-w-0 truncate">
              {member.lineNumber ? `Line ${member.lineNumber}: ` : ""}{member.description}
            </div>
            <div>Ordered {member.orderedQuantity}</div>
            <div>Run {member.allocatedQuantity}</div>
            <div>Remaining {member.remainingAfterRun}</div>
          </div>
        ))}
      </div>
      {run.notes ? <div className="mt-3 text-xs text-titan-text-muted">{run.notes}</div> : null}
    </div>
  );
}
