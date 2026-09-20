import { expect, test } from "@jest/globals";
import { reconcileParentOrderForHistoricalProductionOverride, requiresParentProductionRecovery } from "../services/orderHistoricalProductionOverrideService";
import { readFileSync } from "node:fs";
import path from "node:path";

function fakeTx() {
  const updates: any[] = [];
  const audits: any[] = [];
  return {
    updates,
    audits,
    update: () => ({ set: (values: any) => ({ where: async () => updates.push(values) }) }),
    insert: () => ({ values: async (values: any) => audits.push(values) }),
  };
}

const staleOrder = { id: "order-1", orderNumber: "20330", state: "open", status: "ready_for_shipment", routingTarget: "fulfillment", productionCompletedAt: null };

test("only recognizes a nonterminal stale parent projection with incomplete production", () => {
  expect(requiresParentProductionRecovery({ ...staleOrder, productionIncomplete: true })).toBe(true);
  expect(requiresParentProductionRecovery({ ...staleOrder, productionIncomplete: false })).toBe(false);
  expect(requiresParentProductionRecovery({ ...staleOrder, state: "production_complete", productionIncomplete: true })).toBe(false);
});

test("Close Job Override recovers ready_for_shipment before canonical production completion", async () => {
  const tx = fakeTx();
  await expect(reconcileParentOrderForHistoricalProductionOverride(tx, {
    organizationId: "org-1", order: staleOrder, productionIncomplete: true, requiresProductionBootstrap: true,
    closeJobOverride: true, confirmBypass: true, confirmProductionBootstrap: true,
    actorUserId: "user-1", actorUserName: "Admin", reconciliationReason: "historical_backlog_cleanup", remainingProductionQuantity: 1110,
  })).resolves.toMatchObject({ recovered: true });
  expect(tx.updates).toEqual([expect.objectContaining({ state: "open", status: "in_production", routingTarget: null, productionCompletedAt: null })]);
  expect(tx.audits).toEqual([expect.objectContaining({
    actionType: "order.production_parent_reconciled_for_close_override",
    metadata: expect.objectContaining({ remainingProductionQuantity: 1110, confirmProductionBootstrap: true }),
  })]);
});

test("does not make the recovery available without the explicit administrative override", async () => {
  const tx = fakeTx();
  await expect(reconcileParentOrderForHistoricalProductionOverride(tx, {
    organizationId: "org-1", order: staleOrder, productionIncomplete: true, requiresProductionBootstrap: true,
    closeJobOverride: false, confirmBypass: true, confirmProductionBootstrap: true, actorUserId: "user-1", actorUserName: "Admin",
  })).resolves.toEqual({ recovered: false });
  expect(tx.updates).toEqual([]);
});

test("does not resurrect terminal Orders", async () => {
  const tx = fakeTx();
  await expect(reconcileParentOrderForHistoricalProductionOverride(tx, {
    organizationId: "org-1", order: { ...staleOrder, state: "canceled", status: "canceled" }, productionIncomplete: true, requiresProductionBootstrap: true,
    closeJobOverride: true, confirmBypass: true, confirmProductionBootstrap: true, actorUserId: "user-1", actorUserName: "Admin",
  })).rejects.toMatchObject({ code: "CLOSE_JOB_OVERRIDE_TERMINAL_ORDER" });
});

test("keeps the ordinary production parent gate and Combined Run guard intact", () => {
  const route = readFileSync(path.join(process.cwd(), "server/routes/orders.routes.ts"), "utf8");
  const gate = readFileSync(path.join(process.cwd(), "server/services/orderProductionGate.ts"), "utf8");
  expect(route).toContain("CLOSE_JOB_OVERRIDE_PARENT_RECOVERY_BLOCKED");
  expect(route).toContain("getHistoricalFulfillmentReconciliationPreview");
  expect(route).toContain("historicalOverridePreview?.remainingProductionQuantity > 0");
  expect(route).toContain("PRODUCTION_RUN_OUTCOME_REQUIRED");
  expect(gate).toContain('order.status !== "in_production"');
  expect(gate).toContain("PARENT_ORDER_NOT_IN_PRODUCTION");
});
