import type { AssistantToolExecutionAudit } from "./orchestration";
import { AssistantOrchestrationService } from "./orchestration";
import { createStage2AssistantToolAdapters } from "./assistantToolAdapters";
import type { AssistantOperatorObservation, AssistantOperatorToolExecutor, AssistantOperatorTrustedContext } from "./operatorRuntime";
import { normalizeTrustedPricingReadArguments, normalizeTrustedProductReadArguments } from "./operatorPricingArguments";

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
  const discoveryTool = { name: "application.capabilities", description: "Discover the application operations available in this session, with their argument schemas. Filter by a domain or operation word. Discovery does not execute an operation or grant permission.",
    inputSchema: { type: "object", additionalProperties: false, properties: { query: { type: "string", maxLength: 80 }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 30 } } } };
  const available = (context?: AssistantOperatorTrustedContext) => [
    ...orchestration.catalog(context), ...semanticTools.map((tool) => ({ name: tool.name, description: tool.description, ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}) })),
  ];
  return {
    catalog: (context) => [...available(context), discoveryTool],
    async execute({ toolName, arguments: args, context }) {
      if (toolName === discoveryTool.name) {
        if (Object.keys(args).some((key) => !["query", "offset", "limit"].includes(key)) ||
          args.query !== undefined && (typeof args.query !== "string" || args.query.length > 80) ||
          args.offset !== undefined && (!Number.isInteger(args.offset) || Number(args.offset) < 0 || Number(args.offset) > 10_000) ||
          args.limit !== undefined && (!Number.isInteger(args.limit) || Number(args.limit) < 1 || Number(args.limit) > 30)) {
          return { toolName, status: "rejected" as const, warning: "Capability discovery arguments must be a short query, offset 0–10000, and limit 1–30." };
        }
        const query = typeof args.query === "string" && args.query.length <= 80 ? args.query.trim().toLowerCase() : "";
        const offset = Number.isInteger(args.offset) && Number(args.offset) >= 0 ? Number(args.offset) : 0;
        const limit = Number.isInteger(args.limit) && Number(args.limit) >= 1 && Number(args.limit) <= 30 ? Number(args.limit) : 20;
        const matches = available(context).filter((tool) => !query || `${tool.name} ${tool.description}`.toLowerCase().includes(query));
        return { toolName, status: "succeeded" as const, result: { status: "succeeded" as const,
          data: { capabilities: matches.slice(offset, offset + limit), total: matches.length, nextOffset: offset + limit < matches.length ? offset + limit : null,
            notice: "Only listed tools can be called; execution still checks the signed-in actor and tenant." },
          provenance: { sourceLinks: [], freshness: { capturedAt: new Date().toISOString() } } } };
      }
      const semanticTool = semantic.get(toolName);
      if (semanticTool) return { toolName, ...(await semanticTool.execute({ arguments: args, context })) };
      const input = toolName === "products.get_pricing"
        ? normalizeTrustedPricingReadArguments(args, context)
        : toolName === "products.get_summary"
          ? normalizeTrustedProductReadArguments(args, context)
          : args;
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
