import { ExecutionPlanError } from "./types";
import type { ExecutionCommandDefinition, ExecutionCommandResult, ExecutionPlanPreview } from "./types";
import {
  createProductInactiveDraftUpdateCommandDefinition,
  productInactiveDraftUpdateCommandInputSchema,
  productInactiveDraftUpdateCommandName,
  type ProductInactiveDraftUpdateCanonicalService,
  type ProductInactiveDraftUpdateCommandInput,
} from "./productInactiveDraftUpdateCommand";
import { inactiveProductDraftUpdateService, type InactiveProductDraftPatch, type InactiveProductDraftUpdateService } from "../inactiveProductDraftUpdateService";
import { productInactiveDraftUpdatePresentation } from "./productInactiveDraftUpdatePresentation";

export interface ProductInactiveDraftUpdatePlanningService extends ProductInactiveDraftUpdateCanonicalService {
  buildProposal(input: { organizationId: string; sessionId: string; patch: InactiveProductDraftPatch }): ReturnType<InactiveProductDraftUpdateService["buildProposal"]>;
  revalidateProposal(input: { organizationId: string; sessionId: string; patch: InactiveProductDraftPatch; expectedFingerprint: string }): ReturnType<InactiveProductDraftUpdateService["revalidateProposal"]>;
}

export function createProductInactiveDraftUpdateCanonicalService(
  service: InactiveProductDraftUpdateService = inactiveProductDraftUpdateService,
): ProductInactiveDraftUpdatePlanningService {
  return {
    buildProposal: ({ organizationId, sessionId, patch }) => service.buildProposal({ organizationId, sessionId, patch }),
    revalidateProposal: ({ organizationId, sessionId, patch, expectedFingerprint }) => service.revalidateProposal({ organizationId, sessionId, patch, expectedFingerprint }),
    async updateInactiveDraft(input) {
      const patch = input.patch;
      const updated = await service.updateInactiveProductDraft({
        organizationId: input.organizationId,
        sessionId: input.productIntakeSessionId,
        patch,
        expectedFingerprint: input.proposalFingerprint,
        userId: input.actorUserId,
        assistantAudit: {
          command: "products.update_inactive_draft@v1",
          planId: input.assistantPlanId,
          idempotencyKey: input.idempotencyKey,
          correlationId: input.correlationId,
        },
      });
      return {
        product: { id: updated.productId, name: updated.productName, active: false, sourceLink: `/products/${updated.productId}` },
        productIntakeSession: { id: updated.sessionId, sourceLink: updated.editorLink },
        pbv2DraftTreeVersionId: updated.pbv2TreeVersionId,
        readiness: updated.readiness.status === "ready" ? "ready" as const : "not_ready" as const,
        domainAuditReference: input.assistantPlanId,
      };
    },
  };
}

const unchanged = ["product_activation", "active_product_modification", "quote_or_order_pricing", "inventory_adjustment", "production_job_creation", "customer_facing_catalog_change"] as const;

function changes(input: ProductInactiveDraftUpdateCommandInput, before: Awaited<ReturnType<InactiveProductDraftUpdateService["buildProposal"]>>["before"]) {
  const pricingChanges = (Object.keys(input.patch.basePricing ?? {}) as Array<keyof NonNullable<ProductInactiveDraftUpdateCommandInput["patch"]["basePricing"]>>).map((key) => ({
    field: key === "perSqftCents" ? "Base rate per square foot" : key === "perPieceCents" ? "Base rate per piece" : "Minimum charge",
    before: before.pricingBase[key] ?? null,
    after: input.patch.basePricing?.[key] ?? null,
  }));
  const configurationChanges = (Object.keys(input.patch.configuration ?? {}) as Array<keyof NonNullable<ProductInactiveDraftUpdateCommandInput["patch"]["configuration"]>>).map((key) => ({
    field: key,
    before: typeof before.configuration[key] === "object" && before.configuration[key] !== null ? JSON.stringify(before.configuration[key]) : before.configuration[key] ?? null,
    after: typeof input.patch.configuration?.[key] === "object" && input.patch.configuration?.[key] !== null ? JSON.stringify(input.patch.configuration?.[key]) : input.patch.configuration?.[key] ?? null,
  }));
  const relationship = input.patch.relationships;
  const relationshipChanges = !relationship ? [] : [
    relationship.routing ? { field: "Production routing", before: before.relationships.routing?.stationName ?? null, after: relationship.routing.operation === "clear" ? null : relationship.routing.station?.id ?? relationship.routing.station?.key ?? relationship.routing.station?.name ?? null } : null,
    relationship.options ? { field: "Option templates", before: JSON.stringify(before.relationships.optionTemplates.map((item) => item.name)), after: `${relationship.options.operation}: ${JSON.stringify((relationship.options.templates ?? []).map((item) => item.id ?? item.key ?? item.name))}` } : null,
    relationship.setupNote ? { field: "Internal setup note", before: before.relationships.setupNote, after: relationship.setupNote.operation === "clear" ? null : relationship.setupNote.text ?? null } : null,
    relationship.reviewWarnings ? { field: "Review warnings", before: JSON.stringify(before.relationships.reviewWarnings), after: relationship.reviewWarnings.operation === "clear" ? "[]" : JSON.stringify(relationship.reviewWarnings.warnings ?? []) } : null,
  ].filter(Boolean) as Array<{ field: string; before: string | number | boolean | null; after: string | number | boolean | null }>;
  return [...pricingChanges, ...configurationChanges, ...relationshipChanges];
}

export function createProductInactiveDraftUpdateExecutionCommand(service: ProductInactiveDraftUpdatePlanningService): ExecutionCommandDefinition {
  const command = createProductInactiveDraftUpdateCommandDefinition(service);
  return {
    name: command.name, version: command.version, testOnly: false, riskLevel: command.risk,
    confirmationTtlMs: command.confirmationExpiresInMs, maxAffectedRecords: command.maxAffectedRecords,
    requiredPermissions: [command.requiredCapability],
    async buildPreview({ scope, arguments: rawArguments }) {
      const input = productInactiveDraftUpdateCommandInputSchema.parse(rawArguments);
      const validation = await service.revalidateProposal({ organizationId: scope.organizationId, sessionId: input.productIntakeSessionId, patch: input.patch, expectedFingerprint: input.proposalFingerprint });
      if (!validation.valid) throw new ExecutionPlanError(validation.code, validation.summary);
      const { before, fingerprint } = validation.proposal;
      const preview: ExecutionPlanPreview = {
        title: `Update inactive draft: ${before.productName}`,
        summary: "Apply the displayed validated patch to one inactive Product Intake draft. Activation and publication remain disabled.",
        sideEffects: [input.patch.relationships ? "Updates PBV2 DRAFT routing, template relationships, and staff-only review metadata." : "Updates the validated PBV2 DRAFT metadata."],
        affectedRecords: [{ entityType: "product", entityId: before.productId, fingerprint }],
        productInactiveDraftUpdate: productInactiveDraftUpdatePresentation({
          productId: before.productId, productName: before.productName, sessionId: before.sessionId, editorLink: before.editorLink,
          changes: changes(input, before), readinessBefore: before.readiness.status, expectedReadinessAfter: "unknown",
          warnings: before.readiness.warnings, validationErrors: before.readiness.findings, unchanged,
        }),
      };
      if (before.readiness.findings.length) preview.missingInformation = before.readiness.findings;
      return { arguments: { ...input, proposalFingerprint: fingerprint }, preview };
    },
    async revalidate({ plan, scope }) {
      const input = productInactiveDraftUpdateCommandInputSchema.parse(plan.sanitizedArguments);
      const record = plan.affectedRecords[0];
      const validation = await service.revalidateProposal({ organizationId: scope.organizationId, sessionId: input.productIntakeSessionId, patch: input.patch, expectedFingerprint: input.proposalFingerprint });
      if (!validation.valid || !record || record.entityId !== (validation.valid ? validation.proposal.before.productId : record.entityId) || record.fingerprint !== input.proposalFingerprint) return { valid: false as const, code: validation.valid ? "INACTIVE_DRAFT_STALE" : validation.code, summary: validation.valid ? "The inactive draft changed." : validation.summary };
      return { valid: true as const };
    },
    async execute({ plan, scope }): Promise<ExecutionCommandResult> {
      const input = productInactiveDraftUpdateCommandInputSchema.parse(plan.sanitizedArguments);
      const result = await command.adapter.execute(input, { organizationId: scope.organizationId, actorUserId: scope.userId, planId: plan.id, idempotencyKey: plan.idempotencyKey, correlationId: plan.correlationId, signal: new AbortController().signal });
      return { status: "succeeded", summary: `Inactive draft ${result.product.name} was updated. Activation and publication remain unavailable in the assistant.`, details: { productDraft: { id: result.product.id, name: result.product.name, sourceLink: result.product.sourceLink } }, steps: [{ commandName: `${productInactiveDraftUpdateCommandName}@${command.version}`, status: "succeeded", summary: `Updated validated base-pricing fields on PBV2 DRAFT ${result.pbv2DraftTreeVersionId ?? ""}.` }] };
    },
  };
}
