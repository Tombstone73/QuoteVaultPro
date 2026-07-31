import { ExecutionPlanError, type ExecutionCommandDefinition, type ExecutionCommandResult, type ExecutionPlanPreview } from "./types";
import { CloneInactiveProductDraftError, CloneInactiveProductDraftService, type CloneInactiveProductDraftStore } from "../cloneInactiveProductDraftService";
import { createDrizzleCloneInactiveProductDraftStore } from "../cloneInactiveProductDraftPersistence";
import { cloneInactiveProductDraftCommandName, cloneInactiveProductDraftInputSchema, createCloneInactiveProductDraftCommandDefinition } from "./cloneInactiveProductDraftCommand";

export function createCloneInactiveProductDraftExecutionCommand(store: CloneInactiveProductDraftStore = createDrizzleCloneInactiveProductDraftStore()): ExecutionCommandDefinition {
  const service = new CloneInactiveProductDraftService(store);
  const command = createCloneInactiveProductDraftCommandDefinition(store);
  const load = async (organizationId: string, actorUserId: string, input: { proposalId: string; proposalFingerprint: string }) => service.revalidateProposal({ organizationId, actorUserId, ...input });
  const failure = (error: unknown) => ({ code: error instanceof CloneInactiveProductDraftError ? error.code : "CLONE_PROPOSAL_CHANGED", summary: error instanceof Error ? error.message : "The clone proposal changed." });
  return {
    name: command.name, version: command.version, testOnly: false, riskLevel: command.risk, confirmationTtlMs: command.confirmationExpiresInMs, maxAffectedRecords: command.maxAffectedRecords, requiredPermissions: [command.requiredCapability],
    async buildPreview({ scope, arguments: raw }) {
      const input = cloneInactiveProductDraftInputSchema.parse(raw); let proposal;
      try { proposal = await load(scope.organizationId, scope.userId, input); } catch (error) { const result = failure(error); throw new ExecutionPlanError(result.code, result.summary); }
      const preview = { title: `Clone inactive draft: ${proposal.preview.result.product.name}`, summary: `Clone ${proposal.preview.source.product.name} into one inactive product with one PBV2 DRAFT tree. The source remains unchanged; activation and publication are excluded.`, sideEffects: ["Create one inactive clone product.", "Create one exact PBV2 DRAFT snapshot.", "Do not modify, activate, or publish the source or result."], affectedRecords: [{ entityType: "product", entityId: proposal.sourceProductId, fingerprint: proposal.sourceFingerprint }, { entityType: "ai_configurable_product_proposal", entityId: proposal.id, fingerprint: proposal.fingerprint }], cloneInactiveDraft: { action: cloneInactiveProductDraftCommandName, proposalId: proposal.id, proposalFingerprint: proposal.fingerprint, fingerprint: proposal.fingerprint, preview: proposal.preview } } as ExecutionPlanPreview;
      return { arguments: input, preview };
    },
    async revalidate({ plan, scope }) { try { const input = cloneInactiveProductDraftInputSchema.parse(plan.sanitizedArguments); await load(scope.organizationId, scope.userId, input); return { valid: true as const }; } catch (error) { return { valid: false as const, ...failure(error) }; } },
    async execute({ plan, scope }): Promise<ExecutionCommandResult> {
      const input = cloneInactiveProductDraftInputSchema.parse(plan.sanitizedArguments);
      try {
        const result = await command.adapter.execute(input, { organizationId: scope.organizationId, actorUserId: scope.userId, planId: plan.id, idempotencyKey: plan.idempotencyKey, correlationId: plan.correlationId, signal: new AbortController().signal });
        const editorLink = `/products/${encodeURIComponent(result.productId)}/edit?draftTreeVersionId=${encodeURIComponent(result.pbv2TreeVersionId)}`;
        return { status: "succeeded", summary: result.reused ? "The inactive clone was already created; returning the original draft." : "The product was cloned as an inactive PBV2 DRAFT.", details: { cloneInactiveDraft: { action: cloneInactiveProductDraftCommandName, productId: result.productId, productName: result.productName, pbv2TreeVersionId: result.pbv2TreeVersionId, editorLink, inactive: true, pbv2Status: "DRAFT", reused: result.reused } } as any, steps: [{ commandName: `${cloneInactiveProductDraftCommandName}@${command.version}`, status: "succeeded", summary: `Product ${result.productId}; PBV2 DRAFT ${result.pbv2TreeVersionId}.` }] };
      } catch (error) { const result = failure(error); throw new ExecutionPlanError(result.code, result.summary); }
    },
  };
}
