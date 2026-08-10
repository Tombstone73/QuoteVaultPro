import { describe, expect, it } from "@jest/globals";
import {
  assistantOrderCreateCommandName,
  assistantOrderUpdateEditableCommandName,
  assistantQuoteConvertOrderCommandName,
  createDeferredOrderCommandDefinition,
  createDeferredOrderExecutionCommand,
  createEditableOrderUpdateCommandDefinition,
  createQuoteConvertOrderCommandDefinition,
} from "../services/assistant/execution/deferredOrderCommands";
import { createProductionAssistantCommandRegistry } from "../services/assistant/execution/commandRegistry";

const fingerprint = "b".repeat(64);
const service = {
  revalidateCreateProposal: async () => ({ valid: true as const, proposal: {
    orderIntakeSessionId: "order_intake_1", proposalFingerprint: fingerprint, kind: "direct", customerId: "customer_1", customerName: "Acme", contactName: null, totalCents: 12_500,
    lines: [{ productId: "product_1", productName: "Banner", quantity: 2, measurementMode: "area", dimensions: { widthIn: 24, heightIn: 36, unit: "in" }, pbv2TreeVersionId: "tree_1", selections: [{ groupId: "sides", groupLabel: "Sides", valueId: "single", valueLabel: "Single Sided", source: "explicit" }, { groupId: "contour", groupLabel: "Contour Cutting", valueId: "no", valueLabel: "No", source: "default_accepted" }], unitPriceCents: 6_250, totalCents: 12_500, minimumChargeApplied: false, warnings: [] }], warnings: [],
    summary: "Create one deferred-production order.",
  } }),
  createConfirmedOrder: async () => ({ id: "order_1", displayNumber: "O-20015", totalCents: 12_500, sourceLink: "/orders/order_1" }),
};

describe("assistant deferred-production order commands", () => {
  it("registers only the three reviewed order commands alongside the existing five-command baseline", () => {
    const registry = createProductionAssistantCommandRegistry(
      createDeferredOrderCommandDefinition(service),
      createEditableOrderUpdateCommandDefinition(service),
      createQuoteConvertOrderCommandDefinition(service),
    );
    expect(registry.list().map((command) => command.name).sort()).toEqual([
      assistantOrderCreateCommandName,
      assistantOrderUpdateEditableCommandName,
      assistantQuoteConvertOrderCommandName,
    ].sort());
    expect(registry.list()).toHaveLength(3);
  });

  it("builds a confirmation preview that explicitly excludes production and financial side effects", async () => {
    const command = createDeferredOrderExecutionCommand(assistantOrderCreateCommandName, service);
    const prepared = await command.buildPreview({
      scope: { organizationId: "org_1", userId: "user_1", permissions: ["assistant.orders.create"], environment: "test" },
      context: { version: "v1", route: "/orders", entity: null, selection: [], filters: {}, capturedAt: new Date().toISOString() },
      arguments: { orderIntakeSessionId: "order_intake_1", proposalFingerprint: fingerprint },
    });
    expect(prepared.preview.summary).toContain("No production job");
    expect(prepared.preview.orderCreate).toMatchObject({ customer: { id: "customer_1", name: "Acme" }, orderStatus: "new", productionDeferred: true, totalCents: 12_500, lines: [{ productName: "Banner", quantity: 2, dimensions: { widthIn: 24, heightIn: 36, unit: "in" }, selections: [{ groupLabel: "Sides", valueLabel: "Single Sided", source: "explicit" }, { groupLabel: "Contour Cutting", valueLabel: "No", source: "default_accepted" }], unitPriceCents: 6_250 }] });
    expect(prepared.preview.affectedRecords).toEqual([{ entityType: "assistant_order_intake_session", entityId: "order_intake_1", fingerprint }]);
    expect(prepared.arguments).not.toHaveProperty("organizationId");
    expect(prepared.arguments).not.toHaveProperty("productionIntakePolicy");
  });
});
