import {
  assistantProviderPlanSchema,
  type AssistantProviderPlan,
  type AssistantToolName,
  type AssistantToolResultEnvelope,
} from "@shared/assistantContracts";
import {
  containsForbiddenModelArgument,
  createAssistantToolRegistry,
  isAuthorizedForAssistantTool,
  stripUntrustedModelIdentity,
  validateAssistantToolResult,
  type AssistantToolAdapters,
  type AssistantToolDefinition,
  type AssistantTrustedToolContext,
} from "./toolRegistry";

export const ASSISTANT_MAX_TOOL_CALLS_PER_TURN = 5;

export interface AssistantToolExecutionAudit {
  correlationId: string;
  toolName: AssistantToolName;
  toolVersion: "v1";
  auditCategory: string;
  status: "succeeded" | "not_found" | "permission_denied" | "partial" | "failed" | "rejected" | "timed_out";
  durationMs: number;
  /** Never raw input or model output. */
  failureCode?: "unknown_tool" | "invalid_arguments" | "unauthorized" | "adapter_missing" | "invalid_result" | "timeout" | "tool_failed";
}

export interface AssistantToolExecution {
  toolName: AssistantToolName | string;
  status: AssistantToolExecutionAudit["status"];
  result?: AssistantToolResultEnvelope;
  warning?: string;
}

export interface AssistantOrchestrationResult {
  plan: AssistantProviderPlan;
  executions: AssistantToolExecution[];
}

export type AssistantToolAuditWriter = (event: AssistantToolExecutionAudit) => Promise<void> | void;

export class AssistantOrchestrationService {
  private readonly registry: ReadonlyMap<AssistantToolName, AssistantToolDefinition>;

  constructor(
    adapters: AssistantToolAdapters,
    private readonly writeAudit: AssistantToolAuditWriter = () => undefined,
  ) {
    this.registry = createAssistantToolRegistry(adapters);
  }

  /**
   * A provider plan gets one bounded, non-recursive execution pass.  A tool is
   * never given access to the registry, so it cannot invoke another tool.
   */
  async executePlan(rawPlan: unknown, trustedContext: Omit<AssistantTrustedToolContext, "signal">): Promise<AssistantOrchestrationResult> {
    const plan = assistantProviderPlanSchema.parse(rawPlan);
    if (plan.toolCalls.length > ASSISTANT_MAX_TOOL_CALLS_PER_TURN) {
      // Defensive in case the shared plan schema changes later.
      throw new Error(`Assistant plan exceeds the ${ASSISTANT_MAX_TOOL_CALLS_PER_TURN}-tool limit.`);
    }
    if (plan.intent === "unsupported_write" || plan.clarificationRequired) {
      return { plan, executions: [] };
    }

    const executions: AssistantToolExecution[] = [];
    for (const call of plan.toolCalls) {
      // Intentionally sequential: the hard turn bound and adapters' individual
      // timeouts are easier to audit and cannot turn into a fan-out DoS.
      executions.push(await this.executeCall(call.toolName, call.arguments, trustedContext));
    }
    return { plan, executions };
  }

  private async executeCall(
    toolName: AssistantToolName,
    args: Record<string, unknown>,
    trustedContext: Omit<AssistantTrustedToolContext, "signal">,
  ): Promise<AssistantToolExecution> {
    const started = Date.now();
    const tool = this.registry.get(toolName);
    if (!tool) {
      await this.audit({
        correlationId: trustedContext.correlationId,
        toolName,
        toolVersion: "v1",
        auditCategory: "assistant_rejected_tool",
        status: "rejected",
        durationMs: Date.now() - started,
        failureCode: "unknown_tool",
      });
      return { toolName, status: "rejected", warning: "The requested business tool is not available." };
    }
    if (containsForbiddenModelArgument(args)) {
      return this.reject(tool, trustedContext, started, "invalid_arguments", "The tool request included unsupported fields.");
    }
    // Identity-shaped model arguments are discarded rather than accepted; the
    // adapter sees only server-derived scope, actor, and permission context.
    const parsedInput = tool.inputSchema.safeParse(stripUntrustedModelIdentity(args));
    if (!parsedInput.success) {
      return this.reject(tool, trustedContext, started, "invalid_arguments", "The tool request could not be validated.");
    }
    if (!isAuthorizedForAssistantTool(tool.requiredPermission, trustedContext)) {
      return this.reject(tool, trustedContext, started, "unauthorized", "You do not have permission to view that information.", "permission_denied");
    }
    if (!tool.adapter) {
      return this.reject(tool, trustedContext, started, "adapter_missing", "This business tool is not configured yet.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), tool.timeoutMs);
    try {
      const rawResult = await Promise.race([
        tool.adapter.execute(parsedInput.data, { ...trustedContext, signal: controller.signal }),
        new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("tool_timeout")), { once: true })),
      ]);
      const result = validateAssistantToolResult(tool, rawResult);
      await this.audit({
        correlationId: trustedContext.correlationId,
        toolName: tool.name,
        toolVersion: tool.version,
        auditCategory: tool.auditCategory,
        status: result.status,
        durationMs: Date.now() - started,
      });
      return { toolName: tool.name, status: result.status, result, warning: result.warning };
    } catch (error) {
      const timedOut = controller.signal.aborted;
      await this.audit({
        correlationId: trustedContext.correlationId,
        toolName: tool.name,
        toolVersion: tool.version,
        auditCategory: tool.auditCategory,
        status: timedOut ? "timed_out" : "failed",
        durationMs: Date.now() - started,
        failureCode: timedOut ? "timeout" : "invalid_result",
      });
      return {
        toolName: tool.name,
        status: timedOut ? "timed_out" : "failed",
        warning: timedOut ? "The business lookup timed out. Please try again." : "The business lookup could not be completed.",
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async reject(
    tool: AssistantToolDefinition,
    trustedContext: Omit<AssistantTrustedToolContext, "signal">,
    started: number,
    failureCode: AssistantToolExecutionAudit["failureCode"],
    warning: string,
    status: AssistantToolExecutionAudit["status"] = "rejected",
  ): Promise<AssistantToolExecution> {
    await this.audit({
      correlationId: trustedContext.correlationId,
      toolName: tool.name,
      toolVersion: tool.version,
      auditCategory: tool.auditCategory,
      status,
      durationMs: Date.now() - started,
      failureCode,
    });
    return { toolName: tool.name, status, warning };
  }

  private async audit(event: AssistantToolExecutionAudit): Promise<void> {
    try {
      await this.writeAudit(event);
    } catch {
      // Auditing should be persisted by the integration layer, but a transient
      // audit writer failure must not make normal application workflows fail.
    }
  }
}
