import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

import {
  buildInitialOrderStatusFields,
  CANONICAL_NEW_ORDER_STATUS,
  CANONICAL_NEW_ORDER_STATUS_PILL_KEY,
  CANONICAL_NEW_ORDER_STATUS_PILL_LABEL,
} from "../services/orders/initialOrderStatus";

const assignedAt = new Date("2026-09-03T12:00:00.000Z");
const newPill = {
  id: "pill-new",
  key: CANONICAL_NEW_ORDER_STATUS_PILL_KEY,
  name: CANONICAL_NEW_ORDER_STATUS_PILL_LABEL,
  isActive: true,
};

describe("initial native Order status", () => {
  test.each([
    ["manual New Order", undefined],
    ["Quote conversion", "new"],
    ["Inbound Order conversion", "new"],
    ["Order duplication", "new"],
    ["assistant Order creation", "new"],
  ])("defaults %s to the canonical New lifecycle and status pill", (_path, requestedStatus) => {
    expect(buildInitialOrderStatusFields({ requestedStatus, canonicalNewPill: newPill, actorUserId: "user-1", assignedAt })).toEqual({
      status: "new",
      statusPillId: "pill-new",
      statusPillValue: "New",
      statusPillAssignedByUserId: "user-1",
      statusPillAssignedAt: assignedAt,
      statusPillReason: "Initial order status",
    });
  });

  test("persists a visible New label even if a legacy tenant is missing the canonical pill row", () => {
    expect(buildInitialOrderStatusFields({ actorUserId: "user-1", assignedAt })).toMatchObject({
      status: "new",
      statusPillId: null,
      statusPillValue: "New",
    });
  });

  test("does not couple payment, production, fulfillment, invoice, or proof state to Order status", () => {
    const fields = buildInitialOrderStatusFields({ canonicalNewPill: newPill, actorUserId: "user-1", assignedAt });
    expect(fields).not.toHaveProperty("paymentStatus");
    expect(fields).not.toHaveProperty("workflowState");
    expect(fields).not.toHaveProperty("fulfillmentStatus");
    expect(fields).not.toHaveProperty("billingStatus");
    expect(fields).not.toHaveProperty("proofStatus");
  });

  test("preserves an explicit specialized non-new lifecycle without assigning the New pill", () => {
    expect(buildInitialOrderStatusFields({ requestedStatus: "in_production", canonicalNewPill: newPill, actorUserId: "user-1", assignedAt })).toEqual({
      status: "in_production",
    });
  });

  test("all current canonical native creation paths converge on OrdersRepository.createOrder", () => {
    const source = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");
    const repository = source("server/storage/orders.repo.ts");
    const routes = source("server/routes/orders.routes.ts");
    const inbound = source("server/services/inboundOrders/InboundOrderService.ts");
    const duplication = source("server/services/orderDuplicationService.ts");
    const assistant = source("server/services/assistant/orderIntakeService.ts");

    expect(repository).toContain("buildInitialOrderStatusFields({");
    expect(repository).toContain("const createdOrder = await this.createOrder(organizationId, orderData);");
    expect(routes).toContain("canonicalOrderOperations.create({");
    expect(inbound).toContain("await orderRepository.createOrder(args.organizationId");
    expect(duplication).toContain("await repository.createOrder(input.organizationId");
    expect(assistant).toContain("canonicalOrderOperations.create({ organizationId, actorUserId");
  });
});
