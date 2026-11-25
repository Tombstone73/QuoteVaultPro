import { expect, jest, test } from "@jest/globals";
import { assistantContextEnvelopeSchema } from "@shared/assistantContracts";
import { createCurrentOrderReadinessTool, currentReadinessResult, describeCurrentReadiness } from "../services/assistant/currentOrderReadinessTool";
import { AssistantOrchestrationService } from "../services/assistant/orchestration";
import { AssistantOperatorRuntime } from "../services/assistant/operatorRuntime";

const name = "orders.current_readiness";
const goal = "Why are these lights red?";
const context = { goal, correlationId: "test", conversationId: "conversation", actor: { userId: "staff", email: null, organizationRole: "member" },
  scope: { userId: "staff", organizationId: "org" }, permissions: ["assistant.internal_staff"],
  context: assistantContextEnvelopeSchema.parse({ contextVersion: "v1", route: "/orders/one", pageTitle: "Order", entityType: "order", entityId: "one", capturedAt: new Date().toISOString(), unsavedChanges: false }) };
const order = { id: "one", orderNumber: "15", displayNumber: null, proofStatus: "draft_not_sent" as const, proofStatusLabel: "Draft Not Sent", proofLineItemId: "item",
  lineItems: [{ id: "item", workflowState: "on_hold" }, { id: "ignored", status: "canceled", workflowState: "new" }] };

test("the operator's answer is grounded in the current order, not a guessed cause or an inferred override", async () => {
  const read = jest.fn(async () => order);
  const service = new AssistantOrchestrationService({ [name]: createCurrentOrderReadinessTool(read) });
  const runtime = new AssistantOperatorRuntime({ decide: async ({ observations }) => {
    if (!observations.length) return { kind: "call_tools", calls: [{ toolName: name, arguments: {} }] };
    return { kind: "complete", response: describeCurrentReadiness(observations[0].result?.data) };
  } }, { catalog: ctx => service.catalog(ctx), execute: ({ toolName, arguments: args, context: ctx }) => service.executeTool(toolName, args, ctx) });
  const result = await runtime.run({ goal, taskId: "fixture", trustedContext: context });
  expect(read).toHaveBeenCalledWith("org", "one");
  expect(result.response).toContain("1 action needed. Draft Not Sent.");
  expect(result.observations[0].result?.data).toMatchObject({ view: "operational", proofOverrideRoleAllowed: false,
    actionLines: [{ lineItemId: "item", state: "on_hold", correctionEligibility: "not_supplied" }], proofNavigation: "/production/proofing?lineItemId=item&slice=all" });
});

test("missing proof evidence retains the UI fallback but is not reported as verified", async () => {
  const service = new AssistantOrchestrationService({ [name]: createCurrentOrderReadinessTool(async () => ({ ...order, proofStatus: null, proofStatusLabel: null, proofLineItemId: null, lineItems: [] })) });
  const read = await service.executeTool(name, {}, context);
  expect(describeCurrentReadiness(read.result?.data)).toContain("No immediate action needed. Proof evidence unavailable");
});

test("no order, no staff authority, malformed input and failed fulfillment never disclose order facts", async () => {
  const read = jest.fn(async () => order);
  const service = new AssistantOrchestrationService({ [name]: createCurrentOrderReadinessTool(read, async () => ({ status: "omitted", reason: "native_authority_unverified" })) });
  expect((await service.executeTool(name, {}, { ...context, permissions: [] })).status).toBe("permission_denied");
  expect((await service.executeTool(name, {}, { ...context, context: { ...context.context, entityType: "quote" } })).status).toBe("not_found");
  expect((await service.executeTool(name, { orderId: "other" }, context)).status).toBe("rejected");
  expect(read).not.toHaveBeenCalled();
  const denied = await service.executeTool(name, { view: "fulfillment" }, context);
  expect(denied.status).toBe("permission_denied");
  expect(denied.result?.data).toBeNull();
  expect(denied.result?.provenance).toBeUndefined();
});

test("the full count survives bounded action-line evidence", async () => {
  const service = new AssistantOrchestrationService({ [name]: createCurrentOrderReadinessTool(async () => ({ ...order, lineItems: Array.from({ length: 28 }, (_, i) => ({ id: `line_${i}`, workflowState: "ready_for_prepress" })) })) });
  const result = currentReadinessResult.parse((await service.executeTool(name, {}, context)).result?.data);
  expect(result).toMatchObject({ view: "operational", summary: { actionNeededCount: 28 }, omittedActionLines: 3 });
  if (result.view === "operational") expect(result.actionLines).toHaveLength(25);
});
