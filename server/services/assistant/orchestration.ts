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

export type AssistantToolFailureCategory =
  | "timeout"
  | "core_query_failed"
  | "optional_enrichment_failed"
  | "adapter_failed"
  | "result_validation_failed"
  | "audit_persistence_failed"
  | "message_persistence_failed"
  | "permission_denied"
  | "not_found"
  | "invalid_input";

export type AssistantToolFailureCode =
  | "unknown_tool"
  | "invalid_arguments"
  | "unauthorized"
  | "adapter_missing"
  | "invalid_result"
  | "timeout"
  | "tool_failed"
  | "core_query_failed"
  | "optional_enrichment_failed"
  | "adapter_failed"
  | "result_validation_failed";

/**
 * An adapter may opt into a safe, domain-specific failure classification.
 * Its fields are deliberately constrained so neither raw database errors nor
 * stack traces can cross the orchestration boundary.
 */
export class AssistantToolExecutionError extends Error {
  constructor(
    readonly category: Extract<AssistantToolFailureCategory, "core_query_failed" | "optional_enrichment_failed" | "adapter_failed" | "result_validation_failed">,
    readonly safeCode: Extract<AssistantToolFailureCode, "core_query_failed" | "optional_enrichment_failed" | "adapter_failed" | "result_validation_failed">,
    readonly failingStep: string,
    readonly coreResultSucceeded = false,
  ) {
    super(safeCode);
    this.name = "AssistantToolExecutionError";
  }
}

export interface AssistantToolExecutionAudit {
  correlationId: string;
  toolName: AssistantToolName;
  toolVersion: "v1";
  auditCategory: string;
  status: "succeeded" | "not_found" | "permission_denied" | "partial" | "failed" | "rejected" | "timed_out";
  durationMs: number;
  /** Never raw input or model output. */
  failureCode?: AssistantToolFailureCode;
  failureCategory?: AssistantToolFailureCategory;
  failingStep?: string;
  coreResultSucceeded?: boolean;
}

export interface AssistantToolExecution {
  toolName: AssistantToolName | string;
  status: AssistantToolExecutionAudit["status"];
  result?: AssistantToolResultEnvelope;
  warning?: string;
  failureCategory?: AssistantToolFailureCategory;
  failureCode?: AssistantToolFailureCode;
  failingStep?: string;
  coreResultSucceeded?: boolean;
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
      let rawResult: unknown;
      try {
        rawResult = await this.withToolDeadline(
          tool.adapter.execute(parsedInput.data, { ...trustedContext, signal: controller.signal }),
          controller.signal,
        );
      } catch (error) {
        return this.failedExecution(tool, trustedContext, started, controller.signal.aborted
          ? { category: "timeout", code: "timeout", step: "tool_execution" }
          : this.safeAdapterFailure(error));
      }

      let result: AssistantToolResultEnvelope;
      try {
        result = validateAssistantToolResult(tool, rawResult);
      } catch {
        return this.failedExecution(tool, trustedContext, started, {
          category: "result_validation_failed",
          code: "result_validation_failed",
          step: "result_validation",
        });
      }
      await this.audit({
        correlationId: trustedContext.correlationId,
        toolName: tool.name,
        toolVersion: tool.version,
        auditCategory: tool.auditCategory,
        status: result.status,
        durationMs: Date.now() - started,
        ...(result.status === "not_found" ? { failureCategory: "not_found" as const, failingStep: "core_lookup", coreResultSucceeded: false } : {}),
      });
      return { toolName: tool.name, status: result.status, result, warning: result.warning };
    } finally {
      clearTimeout(timeout);
    }
  }

  private withToolDeadline<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
    return Promise.race([
      operation,
      new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("tool_timeout")), { once: true })),
    ]);
  }

  private safeAdapterFailure(error: unknown): { category: AssistantToolFailureCategory; code: AssistantToolFailureCode; step: string; coreResultSucceeded: boolean } {
    if (error instanceof AssistantToolExecutionError) {
      return {
        category: error.category,
        code: error.safeCode,
        step: error.failingStep,
        coreResultSucceeded: error.coreResultSucceeded,
      };
    }
    return { category: "adapter_failed", code: "adapter_failed", step: "adapter_execution", coreResultSucceeded: false };
  }

  private async failedExecution(
    tool: AssistantToolDefinition,
    trustedContext: Omit<AssistantTrustedToolContext, "signal">,
    started: number,
    failure: { category: AssistantToolFailureCategory; code: AssistantToolFailureCode; step: string; coreResultSucceeded?: boolean },
  ): Promise<AssistantToolExecution> {
    const timedOut = failure.category === "timeout";
    await this.audit({
      correlationId: trustedContext.correlationId,
      toolName: tool.name,
      toolVersion: tool.version,
      auditCategory: tool.auditCategory,
      status: timedOut ? "timed_out" : "failed",
      durationMs: Date.now() - started,
      failureCode: failure.code,
      failureCategory: failure.category,
      failingStep: failure.step,
      coreResultSucceeded: failure.coreResultSucceeded ?? false,
    });
    return {
      toolName: tool.name,
      status: timedOut ? "timed_out" : "failed",
      warning: timedOut ? "The business lookup timed out. Please try again." : "The business lookup could not be completed.",
      failureCategory: failure.category,
      failureCode: failure.code,
      failingStep: failure.step,
      coreResultSucceeded: failure.coreResultSucceeded ?? false,
    };
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
      failureCategory: failureCode === "invalid_arguments" ? "invalid_input" : failureCode === "unauthorized" ? "permission_denied" : "adapter_failed",
      failingStep: "request_validation",
      coreResultSucceeded: false,
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
