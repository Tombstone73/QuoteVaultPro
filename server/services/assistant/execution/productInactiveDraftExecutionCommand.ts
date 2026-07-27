import { ExecutionPlanError } from "./types";
import type { ExecutionCommandDefinition, ExecutionCommandResult, ExecutionPlanPreview } from "./types";
import {
  createProductInactiveDraftCommandDefinition,
  productInactiveDraftCommandInputSchema,
  productInactiveDraftCommandName,
  type ProductInactiveDraftCanonicalService,
} from "./productInactiveDraftCommand";
import { assistantProductIntakeAdapter, type AssistantProductIntakeAdapter } from "../productIntakeAdapter";

export interface ProductInactiveDraftPlanningService extends ProductInactiveDraftCanonicalService {
  buildProposal(input: { organizationId: string; sessionId: string }): ReturnType<AssistantProductIntakeAdapter["buildProposal"]>;
  revalidateProposal(input: { organizationId: string; sessionId: string; expectedFingerprint: string }): ReturnType<AssistantProductIntakeAdapter["revalidateProposal"]>;
}

/** The only domain bridge from an assistant plan to the canonical Product
 * Intake transactional draft creator. It has no route or repository access. */
export function createProductInactiveDraftCanonicalService(
  adapter: AssistantProductIntakeAdapter = assistantProductIntakeAdapter,
): ProductInactiveDraftPlanningService {
  return {
    buildProposal: (input) => adapter.buildProposal(input),
    revalidateProposal: (input) => adapter.revalidateProposal(input),
    async createInactiveDraft(input) {
      const current = await adapter.revalidateProposal({ organizationId: input.organizationId, sessionId: input.intakeSessionId, expectedFingerprint: input.proposalFingerprint });
      if (!current.valid) throw new ExecutionPlanError(current.code, current.summary);
      const result = await adapter.createInactiveDraft({
        organizationId: input.organizationId,
        userId: input.actorUserId,
        sessionId: input.intakeSessionId,
        planId: input.assistantPlanId,
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
      });
      return {
        product: { id: result.productId, name: result.productName, active: false, sourceLink: `/products/${result.productId}` },
        intakeSession: { id: input.intakeSessionId, status: "draft_created", sourceLink: current.proposal.sourceLink.href },
        pbv2DraftTreeVersionId: result.pbv2TreeVersionId,
      };
    },
  };
}

const unchanged = [
  "product_activation", "active_product_modification", "quote_or_order_pricing", "inventory_adjustment",
  "production_job_creation", "customer_facing_catalog_change", "material_record_duplication", "routing_record_duplication",
] as const;

export function createProductInactiveDraftExecutionCommand(service: ProductInactiveDraftPlanningService): ExecutionCommandDefinition {
  const command = createProductInactiveDraftCommandDefinition(service);
  return {
    name: command.name, version: command.version, testOnly: false, riskLevel: command.risk,
    confirmationTtlMs: command.confirmationExpiresInMs, maxAffectedRecords: command.maxAffectedRecords,
    requiredPermissions: [command.requiredCapability],
    async buildPreview({ scope, arguments: rawArguments }) {
      const input = productInactiveDraftCommandInputSchema.parse(rawArguments);
      const validation = await service.revalidateProposal({ organizationId: scope.organizationId, sessionId: input.intakeSessionId, expectedFingerprint: input.proposalFingerprint });
      if (!validation.valid) throw new ExecutionPlanError(validation.code, validation.summary);
      const proposal = validation.proposal;
      const preview: ExecutionPlanPreview = {
        title: proposal.preview.title,
        summary: proposal.preview.summary,
        sideEffects: proposal.preview.sideEffects,
        affectedRecords: [{ entityType: "product_intake_session", entityId: proposal.sessionId, fingerprint: proposal.fingerprint }],
        productInactiveDraft: {
          intakeSessionId: proposal.sessionId, proposalFingerprint: proposal.fingerprint, productName: proposal.productName,
          sourceLink: proposal.sourceLink, warnings: proposal.preview.warnings, unchanged,
          proposedFields: proposal.preview.proposedFields,
        },
      };
      return { arguments: { intakeSessionId: proposal.sessionId, proposalFingerprint: proposal.fingerprint, ...(input.proposalId ? { proposalId: input.proposalId } : {}) }, preview };
    },
    async revalidate({ plan, scope }) {
      const input = productInactiveDraftCommandInputSchema.parse(plan.sanitizedArguments);
      const record = plan.affectedRecords[0];
      const validation = await service.revalidateProposal({ organizationId: scope.organizationId, sessionId: input.intakeSessionId, expectedFingerprint: input.proposalFingerprint });
      if (!validation.valid || !record || record.entityId !== input.intakeSessionId || record.fingerprint !== input.proposalFingerprint) return { valid: false as const, code: validation.valid ? "PRODUCT_INTAKE_SESSION_CHANGED" : validation.code, summary: validation.valid ? "The Product Intake proposal changed." : validation.summary };
      return { valid: true as const };
    },
    async execute({ plan, scope }): Promise<ExecutionCommandResult> {
      const input = productInactiveDraftCommandInputSchema.parse(plan.sanitizedArguments);
      const result = await command.adapter.execute(input, { organizationId: scope.organizationId, actorUserId: scope.userId, planId: plan.id, idempotencyKey: plan.idempotencyKey, correlationId: plan.correlationId, signal: new AbortController().signal });
      return {
        status: "succeeded",
        summary: `Inactive product draft ${result.product.name} was created. Activation and publication remain unavailable in the assistant.`,
        details: { productDraft: { id: result.product.id, name: result.product.name, sourceLink: result.product.sourceLink } },
        steps: [{ commandName: `${productInactiveDraftCommandName}@${command.version}`, status: "succeeded", summary: `Created inactive product ${result.product.id} with PBV2 DRAFT ${result.pbv2DraftTreeVersionId ?? "pending"}.`, ...(result.domainAuditReference ? { domainAuditReference: result.domainAuditReference } : {}) }],
      };
    },
  };
}
