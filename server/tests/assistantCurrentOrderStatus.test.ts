import { expect, jest, test } from "@jest/globals";
import { assistantContextEnvelopeSchema, assistantCurrentOrderStatusResultSchema } from "@shared/assistantContracts";
import { createCurrentOrderStatusTool } from "../services/assistant/currentOrderStatusTool";
import { AssistantOrchestrationService } from "../services/assistant/orchestration";
import { AssistantOperatorRuntime } from "../services/assistant/operatorRuntime";

const name = "orders.current_status";
const goal = "What is the status of this order?";
const trusted = {
  scope: { organizationId: "org_fixture", userId: "staff_fixture" },
  actor: { userId: "staff_fixture", email: null }, permissions: ["assistant.internal_staff"],
  conversationId: "conversation_fixture", correlationId: "turn_fixture", goal,
  context: assistantContextEnvelopeSchema.parse({ contextVersion: "v1", route: "/orders/order_fixture", pageTitle: "Order",
    entityType: "order", entityId: "order_fixture", unsavedChanges: false, capturedAt: new Date().toISOString() }),
};

const row = { id: "order_fixture", orderNumber: "103", displayNumber: "O-103", state: "open", statusPillValue: "Awaiting stock" };

test("an order-page turn answers from the scoped PH result, not model arguments", async () => {
  const read = jest.fn(async (_org: string, _id: string) => row);
  const service = new AssistantOrchestrationService({ [name]: createCurrentOrderStatusTool(read) });
  const runtime = new AssistantOperatorRuntime({ decide: async ({ observations }) => {
    if (!observations.length) return { kind: "call_tools", calls: [{ toolName: name, arguments: {} }] };
    const data = assistantCurrentOrderStatusResultSchema.parse(observations[0].result?.data);
    return { kind: "complete", response: `Order ${data.orderNumber}: ${data.state} (${data.statusPillValue}).` };
  } }, { catalog: ctx => service.catalog(ctx), execute: ({ toolName, arguments: args, context }) => service.executeTool(toolName, args, context) });
  const result = await runtime.run({ goal, taskId: "task_fixture", trustedContext: trusted });
  expect(read).toHaveBeenCalledWith("org_fixture", row.id);
  expect(result.response).toBe("Order O-103: open (Awaiting stock).");
  expect(result.observations[0].result?.provenance?.sourceLinks[0].href).toBe("/orders/order_fixture");
});

test("denied, ambiguous and foreign context cannot yield order data", async () => {
  const read = jest.fn(async (_org: string, _id: string) => undefined);
  const service = new AssistantOrchestrationService({ [name]: createCurrentOrderStatusTool(read) });
  expect((await service.executeTool(name, {}, { ...trusted, permissions: [] })).status).toBe("permission_denied");
  expect((await service.executeTool(name, { orderId: "different" }, trusted)).status).toBe("rejected");
  expect((await service.executeTool(name, {}, { ...trusted, context: { ...trusted.context, entityType: "quote" } })).status).toBe("not_found");
  expect(read).not.toHaveBeenCalled();
  // Orchestration strips model-supplied authority before parsing business inputs.
  await service.executeTool(name, { organizationId: "foreign" }, trusted);
  expect(read).toHaveBeenCalledWith("org_fixture", row.id);
  const result = await service.executeTool(name, {}, { ...trusted, context: { ...trusted.context, entityId: "foreign" } });
  expect(read).toHaveBeenCalledWith("org_fixture", "foreign");
  expect(result.result).toMatchObject({ status: "not_found", data: null });
});
