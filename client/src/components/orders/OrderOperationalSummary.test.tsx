import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { buildOrderReadinessLights, type OrderReadinessLightsInput } from "@shared/orderReadinessLights";
import { orderProofStatusValues, canOpenProofingFromOrderStatus } from "@shared/orderProofStatus";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getOrderProofBadgeClass } from "@/lib/orderProofUi";
import { buildProofingLineItemPath } from "@/lib/proofingNavigation";
import { cn } from "@/lib/utils";
import { OrderOperationalSummary } from "./OrderOperationalSummary";

// Keep routing out of this presentation test; preserve the native Link's target.
jest.mock("@/contexts/WorkspaceContext", () => ({
  WorkspaceLink: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a>,
}));

// Frozen pre-extraction OrderDetail formula and markup (0e504b5c). This is
// deliberately independent of the shared builder so a moved-rule regression
// cannot pass simply by rendering the same new function twice.
function legacyCounts(input: OrderReadinessLightsInput) {
  const lineItems = (input.lineItems ?? []).filter((lineItem) =>
    !["canceled", "cancelled", "void", "voided"].includes(String(lineItem?.status ?? "").trim().toLowerCase()),
  );
  return {
    totalItems: lineItems.length,
    productionRequiredCount: lineItems.filter((lineItem) => lineItem?.product?.requiresProductionJob === true && lineItem?.product?.workflowIntent !== "service_fee").length,
    actionNeededCount: lineItems.filter((lineItem) => ["new", "needs_design", "ready_for_prepress", "ready_for_production", "on_hold"].includes(String(lineItem?.workflowState || lineItem?.status || "new").trim().toLowerCase())).length,
    inProgressCount: lineItems.filter((lineItem) => ["in_design", "in_prepress", "in_production"].includes(String(lineItem?.workflowState || lineItem?.status || "").trim().toLowerCase())).length,
  };
}

function LegacySummary({ input, showHint }: { input: OrderReadinessLightsInput; showHint: boolean }) {
  const summary = legacyCounts(input);
  return <div className="rounded-md border border-border/60 bg-muted/20 px-4 py-2.5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Operational Summary</span>
        <Badge variant="outline" className="h-6 px-2 text-xs">{summary.totalItems} {summary.totalItems === 1 ? "item" : "items"}</Badge>
        {summary.productionRequiredCount > 0 ? <Badge variant="secondary" className="h-6 px-2 text-xs">{summary.productionRequiredCount} production items</Badge> : null}
        <Badge variant="outline" className={cn("h-6 px-2 text-xs", getOrderProofBadgeClass(input.proofStatus ?? "no_proof_required"))}>{input.proofStatusLabel ?? "No Proof Needed"}</Badge>
        {summary.actionNeededCount > 0 ? <Badge className="h-6 px-2 text-xs bg-amber-100 text-amber-900 hover:bg-amber-100">{summary.actionNeededCount} action needed</Badge> : <Badge variant="outline" className="h-6 px-2 text-xs border-emerald-300 text-emerald-800">No immediate action needed</Badge>}
        {summary.inProgressCount > 0 ? <Badge variant="outline" className="h-6 px-2 text-xs border-sky-300 text-sky-800">{summary.inProgressCount} in progress</Badge> : null}
      </div>
      {showHint && summary.productionRequiredCount > 0 ? <div className="text-xs text-muted-foreground">Bulk production handoff is available below in Line Items.</div> : null}
      {input.proofLineItemId && canOpenProofingFromOrderStatus(input.proofStatus ?? "no_proof_required") ? <Button asChild type="button" variant="outline" size="sm" className="h-8"><a href={buildProofingLineItemPath(input.proofLineItemId)}>Open Proofing</a></Button> : null}
    </div>
  </div>;
}

describe("native Order readiness presentation extraction", () => {
  it("preserves missing-data fallbacks without asserting operational readiness", () => {
    expect(buildOrderReadinessLights({})).toEqual({
      totalItems: 0, productionRequiredCount: 0, actionNeededCount: 0, inProgressCount: 0,
      proof: { status: "no_proof_required", label: "No Proof Needed", lineItemId: null, openProofingAvailable: false },
    });
    expect(buildOrderReadinessLights({ lineItems: null })).toEqual(buildOrderReadinessLights({}));
    expect(buildOrderReadinessLights({})).not.toHaveProperty("readyToShip");
    expect(buildOrderReadinessLights({})).not.toHaveProperty("canOverride");
  });

  it.each(["canceled", "cancelled", "void", "voided", " CANCELED "])("excludes %s by persisted status even when workflow is active", (status) => {
    expect(buildOrderReadinessLights({ lineItems: [{ status, workflowState: "in_production", product: { requiresProductionJob: true } }] }).totalItems).toBe(0);
  });

  it("preserves native product, status and workflow precedence without mutating historical data", () => {
    const input = {
      lineItems: [
        { status: "new", workflowState: "in_design", product: { requiresProductionJob: true } },
        { status: "new", workflowState: "ready_for_production", product: { requiresProductionJob: true, workflowIntent: "service_fee" } },
        { status: "complete", workflowState: "in_prepress", product: null },
        { status: "done", workflowState: "" },
        {},
        { status: "new", workflowState: "canceled" },
      ],
    };
    const before = JSON.stringify(input);
    for (const line of input.lineItems) { if (line.product) Object.freeze(line.product); Object.freeze(line); }
    Object.freeze(input.lineItems);
    Object.freeze(input);
    const { proof, ...counts } = buildOrderReadinessLights(input);
    expect(counts).toEqual({ totalItems: 6, productionRequiredCount: 1, actionNeededCount: 2, inProgressCount: 2 });
    expect(JSON.stringify(input)).toBe(before);
    expect(buildOrderReadinessLights(input)).toEqual(buildOrderReadinessLights(input));
  });

  it("matches frozen native count rules across status/workflow/product combinations", () => {
    const statuses = [undefined, null, "", "new", "canceled", " CANCELLED ", "void", "voided", "complete", "completed", "in_design", "unknown"];
    const workflows = [undefined, null, "", " NEW ", "needs_design", "ready_for_prepress", "ready_for_production", "on_hold", "in_design", "in_prepress", "in_production", "completed", "unknown"];
    const products = [undefined, null, {}, { requiresProductionJob: true }, { requiresProductionJob: false }, { requiresProductionJob: true, workflowIntent: "service_fee" }];
    for (const status of statuses) for (const workflowState of workflows) for (const product of products) {
      const input = { lineItems: [{ status, workflowState, product }] };
      const { proof, ...counts } = buildOrderReadinessLights(input);
      expect(counts).toEqual(legacyCounts(input));
    }
  });

  it.each(orderProofStatusValues)("renders identical native markup for %s with all optional indicators and navigation", (proofStatus) => {
    for (const proofLineItemId of [undefined, "", "synthetic-line-1"]) for (const showHint of [false, true]) {
      const input: OrderReadinessLightsInput = {
        lineItems: [
          { status: "new", product: { requiresProductionJob: true } },
          { status: "new", workflowState: "in_design" },
          { status: "void", workflowState: "on_hold" },
        ],
        proofStatus, proofStatusLabel: `Server label: ${proofStatus}`, proofLineItemId,
      };
      const actual = renderToStaticMarkup(<OrderOperationalSummary summary={buildOrderReadinessLights(input)} showProductionHandoffHint={showHint} />);
      expect(actual).toBe(renderToStaticMarkup(<LegacySummary input={input} showHint={showHint} />));
      expect(actual).not.toContain("ready to ship");
    }
  });

  it.each([{}, { lineItems: [] }, { lineItems: [{}] }, { lineItems: [{ status: "complete" }] }, { lineItems: [{ workflowState: "in_production" }] }])("keeps empty/singular/no-action rendering unchanged: %j", (input) => {
    expect(renderToStaticMarkup(<OrderOperationalSummary summary={buildOrderReadinessLights(input)} showProductionHandoffHint />))
      .toBe(renderToStaticMarkup(<LegacySummary input={input} showHint />));
  });

  it("does not replace an absent or intentionally blank native proof label with inferred state", () => {
    expect(buildOrderReadinessLights({ proofStatus: "proof_issue" }).proof.label).toBe("No Proof Needed");
    expect(buildOrderReadinessLights({ proofStatus: "approved", proofStatusLabel: "" }).proof.label).toBe("");
    expect(buildOrderReadinessLights({ proofStatus: "proof_issue", proofLineItemId: "synthetic-line" }).proof.openProofingAvailable).toBe(true);
  });
});
