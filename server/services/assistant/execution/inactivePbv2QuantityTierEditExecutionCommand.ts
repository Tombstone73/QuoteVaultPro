import { ExecutionPlanError, type ExecutionCommandDefinition, type ExecutionCommandResult, type ExecutionPlanPreview } from "./types";
import { InactivePbv2QuantityTierEditError, InactivePbv2QuantityTierEditService, type InactivePbv2QuantityTierEditStore } from "../inactivePbv2QuantityTierEditService";
import { createDrizzleInactivePbv2QuantityTierEditStore } from "../inactivePbv2QuantityTierEditPersistence";
import { createInactivePbv2QuantityTierEditCommandDefinition, inactivePbv2QuantityTierEditCommandName, inactivePbv2QuantityTierEditInputSchema } from "./inactivePbv2QuantityTierEditCommand";

export function createInactivePbv2QuantityTierEditExecutionCommand(store: InactivePbv2QuantityTierEditStore = createDrizzleInactivePbv2QuantityTierEditStore()): ExecutionCommandDefinition {
  const service = new InactivePbv2QuantityTierEditService(store);
  const command = createInactivePbv2QuantityTierEditCommandDefinition(store);
  const load = (organizationId: string, actorUserId: string, input: { proposalId: string; proposalFingerprint: string }) => service.revalidateProposal({ organizationId, actorUserId, ...input });
  const failure = (error: unknown) => ({ code: error instanceof InactivePbv2QuantityTierEditError ? error.code : "PBV2_TIER_PROPOSAL_CHANGED", summary: error instanceof Error ? error.message : "The quantity-tier proposal changed." });
  return {
    name: command.name, version: command.version, testOnly: false, riskLevel: command.risk, confirmationTtlMs: command.confirmationExpiresInMs, maxAffectedRecords: command.maxAffectedRecords, requiredPermissions: [command.requiredCapability],
    async buildPreview({ scope, arguments: raw }) {
      const input = inactivePbv2QuantityTierEditInputSchema.parse(raw); let proposal;
      try { proposal = await load(scope.organizationId, scope.userId, input); } catch (error) { const result = failure(error); throw new ExecutionPlanError(result.code, result.summary); }
      return { arguments: input, preview: { title: `Replace inactive quantity tiers: ${proposal.preview.source.product.name}`, summary: `Replace the complete ${proposal.preview.after.tierType} family on one exact inactive PBV2 DRAFT. The product remains inactive and no active tree is changed.`, sideEffects: ["Replace one complete PBV2 quantity-tier family.", "Update only the exact inactive PBV2 DRAFT.", "Do not activate, publish, or change an active product tree."], affectedRecords: [{ entityType: "product", entityId: proposal.productId, fingerprint: proposal.sourceFingerprint }, { entityType: "pbv2_tree_version", entityId: proposal.pbv2TreeVersionId, fingerprint: proposal.sourceFingerprint }, { entityType: "ai_configurable_product_proposal", entityId: proposal.id, fingerprint: proposal.fingerprint }], inactivePbv2TierEdit: { proposalId: proposal.id, proposalFingerprint: proposal.fingerprint, preview: proposal.preview } } as ExecutionPlanPreview };
    },
    async revalidate({ plan, scope }) { try { await load(scope.organizationId, scope.userId, inactivePbv2QuantityTierEditInputSchema.parse(plan.sanitizedArguments)); return { valid: true as const }; } catch (error) { return { valid: false as const, ...failure(error) }; } },
    async execute({ plan, scope }): Promise<ExecutionCommandResult> {
      try {
        const result = await command.adapter.execute(inactivePbv2QuantityTierEditInputSchema.parse(plan.sanitizedArguments), { organizationId: scope.organizationId, actorUserId: scope.userId, planId: plan.id, idempotencyKey: plan.idempotencyKey, correlationId: plan.correlationId, signal: new AbortController().signal });
        return { status: "succeeded", summary: result.reused ? "The quantity tiers were already replaced; returning the original inactive draft." : "The complete quantity-tier family was replaced on the inactive PBV2 DRAFT.", details: { inactivePbv2TierEdit: { productId: result.productId, pbv2TreeVersionId: result.pbv2TreeVersionId, editorLink: result.editorLink, reused: result.reused } } as any, steps: [{ commandName: `${inactivePbv2QuantityTierEditCommandName}@${command.version}`, status: "succeeded", summary: `PBV2 DRAFT ${result.pbv2TreeVersionId}; ${result.reused ? "reused" : "replaced"} quantity tiers.` }] };
      } catch (error) { const result = failure(error); throw new ExecutionPlanError(result.code, result.summary); }
    },
  };
}
