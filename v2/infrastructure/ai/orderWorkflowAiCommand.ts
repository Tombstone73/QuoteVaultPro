import type { AiCommandHandler } from "../../src/modules/ai/assistantApplication.js";
import type { AiExecutionContext, AiPreparedCommand } from "../../src/modules/ai/contracts.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { OrderWorkflowApplicationService } from "../../src/modules/sales/workflowApplication.js";

type ProductionNotRequiredInput = Readonly<{ orderId: string; orderLineId: string; reason: string }>;
const input = (raw: unknown): ProductionNotRequiredInput => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new V2ApplicationError("VALIDATION_ERROR", "The proposed workflow action is invalid.");
  const value = raw as Record<string, unknown>;
  const text = (name: string, limit: number) => typeof value[name] === "string" ? value[name].trim() : "";
  const orderId = text("orderId", 200), orderLineId = text("orderLineId", 200), reason = text("reason", 500);
  if (!orderId || orderId.length > 200 || !orderLineId || orderLineId.length > 200 || !reason || reason.length > 500)
    throw new V2ApplicationError("VALIDATION_ERROR", "Order, line, and a concise reason are required for this workflow action.");
  return { orderId, orderLineId, reason };
};
const proposal = (value: ProductionNotRequiredInput) => `Mark Production Not Required\n\nOrder: ${value.orderId}\nLine: ${value.orderLineId}\nReason: ${value.reason}\n\nNo changes have been made yet.`;

/** This is deliberately the first and only live M7.6B command adapter. The
 * underlying V2 workflow operation has durable request reservation, current
 * policy validation, state revalidation, audit evidence, and lifecycle
 * reconciliation. The model never receives the execute callable. */
export const orderProductionNotRequiredAiCommand = (workflow: OrderWorkflowApplicationService): AiCommandHandler => ({
  name: "order.production_not_required",
  capability: "workflow.override",
  prepare: async (context: AiExecutionContext, raw: unknown): Promise<AiPreparedCommand> => {
    const normalizedInput = input(raw);
    return { commandName: "order.production_not_required", capability: "workflow.override", normalizedInput, proposal: proposal(normalizedInput), expectedEntityReferences: [{ type: "order", id: normalizedInput.orderId }, { type: "order_line", id: normalizedInput.orderLineId }], expiresAt: new Date(Date.now() + 5 * 60_000) };
  },
  execute: async (context, raw) => {
    const command = input(raw);
    const result = await workflow.productionNotRequired({ principal: context.delegatedPrincipal, organizationId: context.organizationId, operationId: `ai:${context.businessRequestId}`, businessRequest: { id: context.businessRequestId, payloadFingerprint: "ai-command-fingerprint-derived-by-workflow" } }, { ...command, businessRequestId: context.businessRequestId, confirmed: true } as any);
    if (!result.ok) throw result.error;
    return result.value;
  },
});
