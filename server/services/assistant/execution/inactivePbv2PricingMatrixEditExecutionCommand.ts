import { ExecutionPlanError, type ExecutionCommandDefinition, type ExecutionCommandResult, type ExecutionPlanPreview } from "./types";
import { InactivePbv2PricingMatrixEditError, InactivePbv2PricingMatrixEditService, type InactivePbv2PricingMatrixEditStore } from "../inactivePbv2PricingMatrixEditService";
import { createDrizzleInactivePbv2PricingMatrixEditStore } from "../inactivePbv2PricingMatrixEditPersistence";
import { createInactivePbv2PricingMatrixEditCommandDefinition, inactivePbv2PricingMatrixEditCommandName, inactivePbv2PricingMatrixEditInputSchema } from "./inactivePbv2PricingMatrixEditCommand";

export function createInactivePbv2PricingMatrixEditExecutionCommand(store: InactivePbv2PricingMatrixEditStore = createDrizzleInactivePbv2PricingMatrixEditStore()): ExecutionCommandDefinition {
  const service = new InactivePbv2PricingMatrixEditService(store);
  const command = createInactivePbv2PricingMatrixEditCommandDefinition(store);
  const load = async (organizationId: string, actorUserId: string, input: { proposalId: string; proposalFingerprint: string }) => service.revalidateProposal({ organizationId, actorUserId, ...input });
  const failure = (error: unknown) => ({ code: error instanceof InactivePbv2PricingMatrixEditError ? error.code : "PBV2_MATRIX_PROPOSAL_CHANGED", summary: error instanceof Error ? error.message : "The pricing-matrix proposal changed." });
  return {
    name: command.name, version: command.version, testOnly: false, riskLevel: command.risk, confirmationTtlMs: command.confirmationExpiresInMs,
    maxAffectedRecords: command.maxAffectedRecords, requiredPermissions: [command.requiredCapability],
    async buildPreview({ scope, arguments: raw }) {
      const input = inactivePbv2PricingMatrixEditInputSchema.parse(raw); let proposal;
      try { proposal = await load(scope.organizationId, scope.userId, input); } catch (error) { const result = failure(error); throw new ExecutionPlanError(result.code, result.summary); }
      const preview = {
        title: `Replace inactive draft matrix: ${proposal.preview.source.product.name}`,
        summary: `Replace every matrix cell on PBV2 DRAFT ${proposal.pbv2TreeVersionId}; active products and scalar pricing are excluded.`,
        sideEffects: ["Replace the complete pricing matrix on one inactive PBV2 DRAFT.", "Do not activate, publish, or modify an active product."],
        affectedRecords: [{ entityType: "product", entityId: proposal.productId, fingerprint: proposal.sourceFingerprint }, { entityType: "pbv2_tree_version", entityId: proposal.pbv2TreeVersionId, fingerprint: proposal.sourceFingerprint }, { entityType: "ai_configurable_product_proposal", entityId: proposal.id, fingerprint: proposal.fingerprint }],
        inactivePbv2MatrixEdit: { action: inactivePbv2PricingMatrixEditCommandName, proposalId: proposal.id, proposalFingerprint: proposal.fingerprint, fingerprint: proposal.fingerprint, preview: proposal.preview },
      } as ExecutionPlanPreview;
      return { arguments: input, preview };
    },
    async revalidate({ plan, scope }) {
      try { const input = inactivePbv2PricingMatrixEditInputSchema.parse(plan.sanitizedArguments); await load(scope.organizationId, scope.userId, input); return { valid: true as const }; }
      catch (error) { return { valid: false as const, ...failure(error) }; }
    },
    async execute({ plan, scope }): Promise<ExecutionCommandResult> {
      const input = inactivePbv2PricingMatrixEditInputSchema.parse(plan.sanitizedArguments);
      try {
        const result = await command.adapter.execute(input, { organizationId: scope.organizationId, actorUserId: scope.userId, planId: plan.id, idempotencyKey: plan.idempotencyKey, correlationId: plan.correlationId, signal: new AbortController().signal });
        return {
          status: "succeeded", summary: result.reused ? "The pricing-matrix replacement was already applied; returning the original draft." : "The complete pricing matrix was replaced on the inactive PBV2 DRAFT.",
          details: { inactivePbv2MatrixEdit: { action: inactivePbv2PricingMatrixEditCommandName, ...result } } as any,
          steps: [{ commandName: `${inactivePbv2PricingMatrixEditCommandName}@${command.version}`, status: "succeeded", summary: `Product ${result.productId}; PBV2 DRAFT ${result.pbv2TreeVersionId}.` }],
        };
      } catch (error) { const result = failure(error); throw new ExecutionPlanError(result.code, result.summary); }
    },
  };
}
