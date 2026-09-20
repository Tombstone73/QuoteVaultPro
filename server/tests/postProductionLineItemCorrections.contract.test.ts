import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

describe("post-production line-item correction contracts", () => {
  test("keeps normal completed-history protection while exposing a dedicated record-correction operation", () => {
    const routes = source("server/routes/orders.routes.ts");

    expect(routes).toContain('"COMPLETED_LINE_ITEM_REPLACEMENT_REQUIRED"');
    expect(routes).toContain('app.post("/api/order-line-items/:id/record-correction"');
    expect(routes).toContain('matchesActualCompletedWork: z.literal(true)');
    expect(routes).toContain('priceLineItem');
    expect(routes).toContain('recalculateEditableOrderFinancialsInTransaction(tx');
    expect(routes).toContain('line_item.record_corrected_after_completion');
    expect(routes).toContain('productionReopened: false');
  });

  test("cancels only a standalone active job before commercially removing its historical line", () => {
    const routes = source("server/routes/orders.routes.ts");

    expect(routes).toContain('app.post("/api/order-line-items/:id/corrective-remove"');
    expect(routes).toContain('"CORRECTIVE_REMOVAL_COMBINED_RUN_BLOCKED"');
    expect(routes).toContain('status: "canceled"');
    expect(routes).toContain('action: "corrective_line_removal"');
    expect(routes).toContain('line_item.correctively_removed_with_active_workflow');
    expect(routes).toContain('productionCompletionFaked: false');
  });

  test("turns the structured safety responses into corrective dialogs instead of dead-end toasts", () => {
    const [section, hooks] = [
      source("client/src/components/orders/OrderLineItemsSection.tsx"),
      source("client/src/hooks/useOrders.ts"),
    ];

    expect(section).toContain('error.code === "COMPLETED_LINE_ITEM_REPLACEMENT_REQUIRED"');
    expect(section).toContain("Post-production change");
    expect(section).toContain("Correct the Record");
    expect(section).toContain('err.code === "LINE_ITEM_ACTIVE_WORKFLOW_REMOVE_BLOCKED"');
    expect(section).toContain("Cancel Work & Remove Line");
    expect(hooks).toContain("useRecordCompletedOrderLineItemCorrection");
    expect(hooks).toContain("useCorrectiveRemoveOrderLineItem");
  });
});
