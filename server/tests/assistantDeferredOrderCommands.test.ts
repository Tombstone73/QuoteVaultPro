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
    orderIntakeSessionId: "order_intake_1", proposalFingerprint: fingerprint, kind: "direct", customerName: "Acme", totalCents: 12_500,
    lines: [{ productName: "Banner", quantity: 2, width: 24, height: 36, totalCents: 12_500 }], warnings: [],
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
    expect(prepared.arguments).not.toHaveProperty("organizationId");
    expect(prepared.arguments).not.toHaveProperty("productionIntakePolicy");
  });
});
