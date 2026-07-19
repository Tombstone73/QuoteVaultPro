import { describe, expect, test } from "@jest/globals";

import type { OrderStatusPill } from "@shared/schema";
import { DEFAULT_WORKFLOW_STATUS_PILL_MAPPINGS } from "@shared/orderStatusWorkflowAutomation";
import {
  assignResolvedWorkflowStatusPill,
  evaluateWorkflowStatusPillTarget,
  planDefaultWorkflowStatusPillMappings,
} from "../services/workflowStatusPillService";

function pill(overrides: Partial<OrderStatusPill> = {}): OrderStatusPill {
  return {
    id: "pill-in-production",
    organizationId: "org-1",
    stateScope: "open",
    key: "in_production",
    name: "Production Floor",
    color: "#C2410C",
    category: "production",
    lifecycleMapping: "production",
    customerVisible: false,
    notificationTriggerEligible: true,
    isDefault: false,
    isActive: true,
    sortOrder: 90,
    createdAt: "2026-07-18",
    updatedAt: "2026-07-18",
    ...overrides,
  };
}

describe("workflow status-pill default mappings", () => {
  test("provides stable-key mappings for production and cancellation", () => {
    expect(DEFAULT_WORKFLOW_STATUS_PILL_MAPPINGS).toEqual(expect.arrayContaining([
      expect.objectContaining({ triggerKey: "sent_to_production", targetStatusKey: "in_production" }),
      expect.objectContaining({ triggerKey: "order_canceled", targetStatusKey: "canceled" }),
    ]));
    expect(DEFAULT_WORKFLOW_STATUS_PILL_MAPPINGS.every((mapping) => !mapping.targetStatusKey.includes(" "))).toBe(true);
  });

  test("seeding is key-idempotent and does not recreate an inactive mapping", () => {
    const existing = [{ triggerKey: "sent_to_production" }, { triggerKey: "order_canceled" }];
    const planned = planDefaultWorkflowStatusPillMappings(existing as any);
    expect(planned.some((mapping) => mapping.triggerKey === "sent_to_production")).toBe(false);
    expect(planned.some((mapping) => mapping.triggerKey === "order_canceled")).toBe(false);
    expect(planned.some((mapping) => mapping.triggerKey === "order_created")).toBe(true);
  });
});

describe("workflow status-pill safeguards", () => {
  const mapping = {
    isActive: true,
    targetStatusKey: "in_production",
    overwriteExceptionStatus: false,
  };

  test("disabled or missing targets skip safely", () => {
    expect(evaluateWorkflowStatusPillTarget({
      mapping,
      currentStatusPillId: null,
      currentStatusKey: null,
      targetPill: null,
    })).toBe("target_missing");
    expect(evaluateWorkflowStatusPillTarget({
      mapping,
      currentStatusPillId: null,
      currentStatusKey: null,
      targetPill: pill({ isActive: false }),
    })).toBe("target_disabled");
  });

  test("normal workflow signals do not overwrite Problem or On Hold", () => {
    for (const currentStatusKey of ["problem", "on_hold"]) {
      expect(evaluateWorkflowStatusPillTarget({
        mapping,
        currentStatusPillId: `pill-${currentStatusKey}`,
        currentStatusKey,
        targetPill: pill(),
      })).toBe("protected_exception_status");
    }
  });

  test("terminal mappings can explicitly resolve an exception", () => {
    expect(evaluateWorkflowStatusPillTarget({
      mapping: { ...mapping, targetStatusKey: "canceled", overwriteExceptionStatus: true },
      currentStatusPillId: "pill-problem",
      currentStatusKey: "problem",
      targetPill: pill({ id: "pill-canceled", key: "canceled", name: "Cancelled by Staff", stateScope: "canceled" }),
    })).toBeNull();
  });

  test("operational pill mappings do not depend on canonical lifecycle scope", () => {
    expect(evaluateWorkflowStatusPillTarget({
      mapping: { ...mapping, targetStatusKey: "fulfillment" },
      currentStatusPillId: null,
      currentStatusKey: null,
      targetPill: pill({ id: "pill-fulfillment", key: "fulfillment", name: "Fulfillment", stateScope: "production_complete" }),
    })).toBeNull();
  });
});

describe("workflow assignment boundary", () => {
  test("sent_to_production assigns by stable key and emits a system-sourced assignment", async () => {
    let captured: any;
    const target = pill({ name: "Renamed Production Label" });
    const result = await assignResolvedWorkflowStatusPill({
      organizationId: "org-1",
      orderId: "order-1",
      triggerKey: "sent_to_production",
      mapping: { id: "mapping-1", source: "system" },
      targetPill: target,
      actorUserId: "user-1",
      metadata: { lineItemId: "line-1" },
      assignFn: async (args: any) => {
        captured = args;
        return { eventId: "event-1", statusPill: target };
      },
    });

    expect(captured).toMatchObject({
      statusPillKey: "in_production",
      source: "system",
      scheduleProductionJobs: false,
      metadata: {
        workflowTriggerKey: "sent_to_production",
        workflowStatusPillMappingId: "mapping-1",
        targetStatusKey: "in_production",
        lineItemId: "line-1",
      },
    });
    expect(result).toMatchObject({ status: "applied", eventId: "event-1", source: "system" });
  });

  test("automation-rule source remains distinguishable from system workflow source", async () => {
    let captured: any;
    const target = pill({ id: "pill-canceled", key: "canceled", stateScope: "canceled" });
    await assignResolvedWorkflowStatusPill({
      organizationId: "org-1",
      orderId: "order-2",
      triggerKey: "order_canceled",
      mapping: { id: "mapping-2", source: "system" },
      targetPill: target,
      actorUserId: "user-1",
      source: "automation",
      assignFn: async (args: any) => {
        captured = args;
        return { eventId: "event-2", statusPill: target };
      },
    });
    expect(captured.source).toBe("automation");
    expect(captured.statusPillKey).toBe("canceled");
  });
});
