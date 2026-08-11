import fs from "node:fs";
import path from "node:path";

describe("prepress production run creation contract", () => {
  const root = process.cwd();
  const service = fs.readFileSync(path.join(root, "server/services/productionRunService.ts"), "utf8");
  const routes = fs.readFileSync(path.join(root, "server/routes/productionRuns.routes.ts"), "utf8");

  test("exposes a dedicated prepress endpoint without replacing the existing create-run route", () => {
    expect(routes).toContain('app.post("/api/production/runs"');
    expect(routes).toContain('app.post("/api/production/runs/prepress"');
    expect(routes).toContain("createPrepressProductionRun");
    expect(routes).toContain("createProductionRun");
  });

  test("prepress creation routes selected line items and creates run membership transactionally", () => {
    expect(service).toContain("export async function createPrepressProductionRun");
    expect(service).toContain("return db.transaction(async (tx)");
    expect(service).toContain("transitionLineItemWorkflowState(tx");
    expect(service).toContain("toState: \"ready_for_production\"");
    expect(service).toContain("createProductionRunInTransaction(tx");
  });

  test("prepress creation keeps core eligibility and allocation guards", () => {
    expect(service).toContain("PRODUCTION_RUN_DUPLICATE_MEMBER");
    expect(service).toContain("PRODUCTION_RUN_MEMBER_INELIGIBLE");
    expect(service).toContain("PRODUCTION_RUN_FINAL_FILE_REQUIRED");
    expect(service).toContain("PRODUCTION_RUN_ALLOCATION_INVALID");
    expect(service).toContain("inArray(lineItemFiles.lineItemId, uniqueLineItemIds)");
    expect(service).toContain("buildArtworkAllocationStatus");
    expect(service).toContain("Resolve production artwork allocation");
  });

  test("prepress creation no longer requires one order to own the combined run", () => {
    expect(routes).toContain("orderId: z.string().min(1).nullable().optional()");
    expect(service).toContain("orderId?: string | null");
    expect(service).toContain("inArray(orderLineItems.id, uniqueLineItemIds)");
    expect(service).not.toContain("eq(orderLineItems.orderId, input.orderId), inArray(orderLineItems.id, uniqueLineItemIds)");
    expect(service).toContain("const runOrderId = orderIds.length === 1 ? orderIds[0] : null");
    expect(service).toContain("orderId: runOrderId");
  });

  test("run members preserve per-order identity and per-member outcomes", () => {
    expect(service).toContain("memberOrderId: orderLineItems.orderId");
    expect(service).toContain("memberOrderNumber: orders.orderNumber");
    expect(service).toContain("memberCustomerName: customers.companyName");
    expect(service).toContain("successfulQuantity");
    expect(service).toContain("damagedQuantity");
    expect(service).toContain("remainingQuantity");
    expect(service).toContain("outcomeStatus");
    expect(service).toContain("recoveryDisposition");
  });

  test("run outcomes are recorded per member with idempotency and correct order events", () => {
    expect(routes).toContain('app.post("/api/production/runs/:runId/outcomes"');
    expect(routes).toContain("recordProductionRunOutcome");
    expect(service).toContain("recordProductionRunOutcomeInTransaction");
    expect(service).toContain("lastOutcomeIdempotencyKey");
    expect(service).toContain("PRODUCTION_RUN_OUTCOME_CONFIRMED");
    expect(service).toContain("successfulQuantity + remainingQuantity > allocatedQuantity");
    expect(service).toContain("orderId: line.orderId");
    expect(service).toContain("production_run_member_outcome_recorded");
    expect(service).toContain("completed_with_exceptions");
  });
});
