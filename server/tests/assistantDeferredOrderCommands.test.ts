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

  it("shows source PO, selling-price difference, and address review before GO", async () => {
    const poService = {
      ...service,
      revalidateCreateProposal: async () => ({ valid: true as const, proposal: {
        ...(await service.revalidateCreateProposal()).proposal,
        purchaseOrder: { poNumber: "00042", fileName: "customer-po.pdf", address: "123 Main St", instructions: "Deliver Friday" },
        lines: [{ ...(await service.revalidateCreateProposal()).proposal.lines[0], poUnitPriceCents: 5_900, poPriceDifferenceCents: 350 }],
        warnings: ["Confirm shipping destination in Order editor."],
      } }),
    };
    const command = createDeferredOrderExecutionCommand(assistantOrderCreateCommandName, poService);
    const prepared = await command.buildPreview({
      scope: { organizationId: "org_1", userId: "user_1", permissions: ["assistant.orders.create"], environment: "test" },
      context: { version: "v1", route: "/orders", entity: null, selection: [], filters: {}, capturedAt: new Date().toISOString() },
      arguments: { orderIntakeSessionId: "order_intake_1", proposalFingerprint: fingerprint },
    });
    expect(prepared.preview.sideEffects.join(" ")).toContain("Customer PO 00042");
    expect(prepared.preview.sideEffects.join(" ")).toContain("PO $59.00 per unit, difference $3.50 per unit");
    expect(prepared.preview.sideEffects.join(" ")).toContain("canonical reference $125.00");
    expect(prepared.preview.sideEffects.join(" ")).toContain("Confirm shipping destination");
  });

  it("returns the persisted Order number and link from GO execution", async () => {
    const command = createDeferredOrderExecutionCommand(assistantOrderCreateCommandName, service);
    const executed = await command.execute({
      plan: { id: "plan_42", idempotencyKey: "operation_42", correlationId: "correlation_42", sanitizedArguments: { orderIntakeSessionId: "order_intake_1", proposalFingerprint: fingerprint } } as any,
      scope: { organizationId: "org_1", userId: "user_1", permissions: ["assistant.orders.create"], environment: "test" },
    });
    expect(executed.details?.order).toEqual({ id: "order_1", displayNumber: "O-20015", sourceLink: "/orders/order_1" });
  });

  it("post-GO conversion retries preserve the canonical same-Order result", async () => {
    const conversionService = {
      ...service,
      createConfirmedOrder: async () => ({ id: "order_existing", displayNumber: "O-20016", totalCents: 12_500, sourceLink: "/orders/order_existing" }),
    };
    const command = createQuoteConvertOrderCommandDefinition(conversionService);
    const context = { organizationId: "org_1", actorUserId: "user_1", planId: "plan_1", idempotencyKey: "retry_1", correlationId: "correlation_1", signal: new AbortController().signal };
    const args = { orderIntakeSessionId: "order_intake_1", proposalFingerprint: fingerprint };

    const first = await command.adapter.execute(args, context);
    const retried = await command.adapter.execute(args, { ...context, idempotencyKey: "retry_2" });
    expect(retried).toEqual(first);
    expect(retried.id).toBe("order_existing");
  });
});
