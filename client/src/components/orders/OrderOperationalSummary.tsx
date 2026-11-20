import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WorkspaceLink as Link } from "@/contexts/WorkspaceContext";
import { getOrderProofBadgeClass } from "@/lib/orderProofUi";
import { buildProofingLineItemPath } from "@/lib/proofingNavigation";
import { cn } from "@/lib/utils";
import type { OrderReadinessLights } from "@shared/orderReadinessLights";

export function OrderOperationalSummary({ summary, showProductionHandoffHint }: {
  summary: OrderReadinessLights;
  showProductionHandoffHint: boolean;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-4 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Operational Summary</span>
          <Badge variant="outline" className="h-6 px-2 text-xs">
            {summary.totalItems} {summary.totalItems === 1 ? "item" : "items"}
          </Badge>
          {summary.productionRequiredCount > 0 ? (
            <Badge variant="secondary" className="h-6 px-2 text-xs">
              {summary.productionRequiredCount} production items
            </Badge>
          ) : null}
          <Badge variant="outline" className={cn("h-6 px-2 text-xs", getOrderProofBadgeClass(summary.proof.status))}>
            {summary.proof.label}
          </Badge>
          {summary.actionNeededCount > 0 ? (
            <Badge className="h-6 px-2 text-xs bg-amber-100 text-amber-900 hover:bg-amber-100">
              {summary.actionNeededCount} action needed
            </Badge>
          ) : (
            <Badge variant="outline" className="h-6 px-2 text-xs border-emerald-300 text-emerald-800">
              No immediate action needed
            </Badge>
          )}
          {summary.inProgressCount > 0 ? (
            <Badge variant="outline" className="h-6 px-2 text-xs border-sky-300 text-sky-800">
              {summary.inProgressCount} in progress
            </Badge>
          ) : null}
        </div>
        {showProductionHandoffHint && summary.productionRequiredCount > 0 ? (
          <div className="text-xs text-muted-foreground">Bulk production handoff is available below in Line Items.</div>
        ) : null}
        {summary.proof.openProofingAvailable && summary.proof.lineItemId ? (
          <Button asChild type="button" variant="outline" size="sm" className="h-8">
            <Link to={buildProofingLineItemPath(summary.proof.lineItemId)}>Open Proofing</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
