import type { AssistantToolExecutionAudit } from "./orchestration";
import { AssistantOrchestrationService } from "./orchestration";
import { createStage2AssistantToolAdapters } from "./assistantToolAdapters";
import type { AssistantOperatorToolExecutor } from "./operatorRuntime";

/** Bridges the existing policy-enforcing read registry into the iterative
 * Operator Runtime. No database or service access is exposed to the model. */
export function createAssistantOperatorToolExecutor(
  writeAudit: (event: AssistantToolExecutionAudit) => Promise<void> | void = () => undefined,
): AssistantOperatorToolExecutor {
  const orchestration = new AssistantOrchestrationService(createStage2AssistantToolAdapters(), writeAudit);
  return {
    catalog: () => orchestration.catalog(),
    async execute({ toolName, arguments: args, context }) {
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
