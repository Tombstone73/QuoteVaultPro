import { ExecutionPlanError, type ExecutionCommandDefinition, type ExecutionCommandResult, type ExecutionPlanPreview } from "./types";
import { configurableProductDraftCommandName, configurableProductDraftInputSchema, createConfigurableProductDraftCommandDefinition } from "./configurableProductDraftCommand";
import { configurableProductResultDto } from "../complexProductPresentation";
import { getComplexProductConfirmation, getComplexProductProposal } from "../complexProductDraftPersistence";

export function createConfigurableProductDraftExecutionCommand(): ExecutionCommandDefinition {
  const command = createConfigurableProductDraftCommandDefinition();
  const load = async (organizationId: string, input: { proposalId: string; fingerprint: string }) => {
    const proposal = await getComplexProductProposal(organizationId, input.proposalId);
    if (!proposal || proposal.fingerprint !== input.fingerprint) throw new ExecutionPlanError("CONFIGURABLE_PROPOSAL_CHANGED", "The configurable-product proposal changed or is unavailable.");
    const confirmation = await getComplexProductConfirmation(organizationId, input.proposalId);
    if (!confirmation || !confirmation.goEligible) throw new ExecutionPlanError("CONFIGURABLE_PROPOSAL_BLOCKED", "The configurable-product proposal has blockers and cannot be confirmed.");
    return { proposal, confirmation };
  };
  return { name: command.name, version: command.version, testOnly: false, riskLevel: command.risk, confirmationTtlMs: command.confirmationExpiresInMs, maxAffectedRecords: 1, requiredPermissions: [command.requiredCapability],
    async buildPreview({ scope, arguments: raw }) { const input = configurableProductDraftInputSchema.parse(raw); const loaded = await load(scope.organizationId, input); const preview: ExecutionPlanPreview = { title: `Create configurable inactive draft: ${loaded.confirmation.product.name}`, summary: "Creates exactly one inactive product with one PBV2 DRAFT tree. It cannot activate, publish, or expose the product.", sideEffects: ["Create one inactive product.", "Create one PBV2 DRAFT tree with the persisted options and pricing matrix."], affectedRecords: [{ entityType: "ai_configurable_product_proposal", entityId: input.proposalId, fingerprint: input.fingerprint }], configurableProduct: loaded.confirmation as any }; return { arguments: input, preview }; },
    async revalidate({ plan, scope }) { try { const input = configurableProductDraftInputSchema.parse(plan.sanitizedArguments); await load(scope.organizationId, input); return { valid: true as const }; } catch (error) { return { valid: false as const, code: "CONFIGURABLE_PROPOSAL_CHANGED", summary: error instanceof Error ? error.message : "The configurable-product proposal changed." }; } },
    async execute({ plan, scope }): Promise<ExecutionCommandResult> { const input = configurableProductDraftInputSchema.parse(plan.sanitizedArguments); const loaded = await load(scope.organizationId, input); const result = await command.adapter.execute(input, { organizationId: scope.organizationId, actorUserId: scope.userId, planId: plan.id, idempotencyKey: plan.idempotencyKey, correlationId: plan.correlationId, signal: new AbortController().signal }); const dto = configurableProductResultDto({ proposalId: input.proposalId, specification: loaded.proposal.specification as any, productId: result.productId, pbv2TreeVersionId: result.pbv2TreeVersionId, reused: result.reused }); return { status: "succeeded", summary: result.reused ? "The configurable product draft was already created; returning the original result." : "The configurable product draft was created inactive with a PBV2 DRAFT tree.", details: { configurableProduct: dto }, steps: [{ commandName: `${configurableProductDraftCommandName}@v1`, status: "succeeded", summary: `Product ${result.productId}; PBV2 DRAFT ${result.pbv2TreeVersionId}.` }] }; },
  };
}
