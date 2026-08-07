import type { AssistantToolExecutionAudit } from "./orchestration";
import { AssistantOrchestrationService } from "./orchestration";
import { createStage2AssistantToolAdapters } from "./assistantToolAdapters";
import type { AssistantOperatorObservation, AssistantOperatorToolExecutor, AssistantOperatorTrustedContext } from "./operatorRuntime";

export type AssistantOperatorSemanticTool = {
  name: string;
  description: string;
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
    catalog: () => [...orchestration.catalog(), ...semanticTools.map((tool) => ({ name: tool.name, description: tool.description }))],
    async execute({ toolName, arguments: args, context }) {
      const semanticTool = semantic.get(toolName);
      if (semanticTool) return { toolName, ...(await semanticTool.execute({ arguments: args, context })) };
      const execution = await orchestration.executeTool(toolName, args, context);
      return {
        toolName: execution.toolName,
        status: execution.status,
        ...(execution.result ? { result: execution.result } : {}),
        ...(execution.warning ? { warning: execution.warning } : {}),
      };
    },
  };
}
