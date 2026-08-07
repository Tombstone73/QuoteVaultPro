import type { AssistantContextEnvelope } from "@shared/assistantContracts";
import { CompositeExecutionPlanningService, type CompositeExecutionPlan } from "./compositeExecutionPlanningService";
import type { ExecutionActorScope } from "./types";

/** A target must originate from an authorized server read tool or canonical
 * service. It is never an identifier invented by a model or copied from an
 * untrusted browser payload. */
export type AuthorizedCompositeTarget = {
  entityType: string;
  entityId: string;
  label: string;
  fingerprint: string;
  attributes?: Readonly<Record<string, unknown>>;
};

export type CompositeTargetExclusion = { entityType: string; entityId: string; label: string; reason: string };
export type CompiledCompositeOperation = { commandName: string; arguments: Record<string, unknown>; summary: string };

export interface CompositeSemanticOperationCompiler<TIntent extends Record<string, unknown>> {
  /** Domain-specific eligibility and argument compilation, owned by server
   * code. It may call only canonical services and receives authoritative
   * fingerprints from the preceding authorized read. */
  compile(input: { scope: ExecutionActorScope; intent: TIntent; target: AuthorizedCompositeTarget }): Promise<
    | { kind: "eligible"; operation: CompiledCompositeOperation }
    | { kind: "ineligible"; reason: string }
  >;
}

export type CompositeSemanticPlanningResult = {
  plan: CompositeExecutionPlan;
  included: readonly { entityType: string; entityId: string; label: string; summary: string }[];
  excluded: readonly CompositeTargetExclusion[];
};

/**
 * Reusable server boundary between authorized discovery and the deterministic
 * multi-command executor. The model may express a business intent, but it
 * cannot provide command payloads, fingerprints, tokens, or execution IDs.
 */
export class CompositeSemanticMutationPlanningService<TIntent extends Record<string, unknown>> {
  constructor(
    private readonly execution: CompositeExecutionPlanningService,
    private readonly compiler: CompositeSemanticOperationCompiler<TIntent>,
  ) {}

  async prepare(input: {
    scope: ExecutionActorScope;
    conversationId: string;
    context: AssistantContextEnvelope;
    correlationId: string;
    intent: TIntent;
    /** Results from an already-authorized server read; duplicates are rejected. */
    authorizedTargets: readonly AuthorizedCompositeTarget[];
  }): Promise<CompositeSemanticPlanningResult> {
    const seen = new Set<string>();
    const operations: CompiledCompositeOperation[] = [];
    const included: Array<{ entityType: string; entityId: string; label: string; summary: string }> = [];
    const excluded: CompositeTargetExclusion[] = [];
    for (const target of input.authorizedTargets) {
      const key = `${target.entityType}:${target.entityId}`;
      if (seen.has(key)) { excluded.push({ entityType: target.entityType, entityId: target.entityId, label: target.label, reason: "Duplicate target excluded." }); continue; }
      seen.add(key);
      const compiled = await this.compiler.compile({ scope: input.scope, intent: input.intent, target });
      if (compiled.kind === "ineligible") { excluded.push({ entityType: target.entityType, entityId: target.entityId, label: target.label, reason: compiled.reason }); continue; }
      operations.push(compiled.operation);
      included.push({ entityType: target.entityType, entityId: target.entityId, label: target.label, summary: compiled.operation.summary });
    }
    const plan = await this.execution.createPlan(input.scope, {
      conversationId: input.conversationId, context: input.context, correlationId: input.correlationId,
      operations: operations.map(({ commandName, arguments: args }) => ({ commandName, arguments: args })),
    });
    return { plan, included, excluded };
  }
}
