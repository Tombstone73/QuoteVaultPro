import type { AssistantToolExecutionAudit } from "./orchestration";
import { AssistantOrchestrationService } from "./orchestration";
import { createStage2AssistantToolAdapters } from "./assistantToolAdapters";
import type { AssistantOperatorObservation, AssistantOperatorToolExecutor, AssistantOperatorTrustedContext } from "./operatorRuntime";
import { normalizeTrustedPricingReadArguments } from "./operatorPricingArguments";

export type AssistantOperatorSemanticTool = {
  name: string;
  description: string;
  /** Optional provider-function JSON schema. Execution remains validated by
   * the semantic service; this only helps capable providers express the small
   * business operation contract without internal persistence fields. */
  inputSchema?: Record<string, unknown>;
  execute(input: { arguments: Record<string, unknown>; context: AssistantOperatorTrustedContext }): Promise<Omit<AssistantOperatorObservation, "step" | "toolName">>;
};

/** Bridges the existing policy-enforcing read registry into the iterative
 * Operator Runtime. No database or service access is exposed to the model. */
export function createAssistantOperatorToolExecutor(
  writeAudit: (event: AssistantToolExecutionAudit) => Promise<void> | void = () => undefined,
  semanticTools: readonly AssistantOperatorSemanticTool[] = [],
): AssistantOperatorToolExecutor {
  const orchestration = new AssistantOrchestrationService(createStage2AssistantToolAdapters(), writeAudit);
  const semantic = new Map(semanticTools.map((tool) => [tool.name, tool]));
  return {
    catalog: () => [...orchestration.catalog(), ...semanticTools.map((tool) => ({ name: tool.name, description: tool.description, ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}) }))],
    async execute({ toolName, arguments: args, context }) {
      const semanticTool = semantic.get(toolName);
      if (semanticTool) return { toolName, ...(await semanticTool.execute({ arguments: args, context })) };
      const input = toolName === "products.get_pricing" ? normalizeTrustedPricingReadArguments(args, context) : args;
      const execution = await orchestration.executeTool(toolName, input, context);
      return {
        toolName: execution.toolName,
        status: execution.status,
        ...(execution.result ? { result: execution.result } : {}),
        ...(execution.warning ? { warning: execution.warning } : {}),
        ...(execution.failureCategory ? { failureCategory: execution.failureCategory } : {}),
        ...(execution.failureCode ? { failureCode: execution.failureCode } : {}),
        ...(execution.failingStep ? { failingStep: execution.failingStep } : {}),
      };
    },
  };
}
