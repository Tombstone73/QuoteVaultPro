import { ExecutionPlanError } from "./types";
import type { ExecutionCommandDefinition, ExecutionCommandResult, ExecutionPlanPreview } from "./types";
import { createProductInactiveDraftBatchCommandDefinition, productInactiveDraftBatchCommandInputSchema, productInactiveDraftBatchCommandName, type ProductInactiveDraftBatchCanonicalService, type ProductInactiveDraftBatchCommandInput } from "./productInactiveDraftBatchCommand";
import type { ProductInactiveDraftPlanningService } from "./productInactiveDraftExecutionCommand";
import { fingerprintProductInactiveDraftBatch } from "../productInactiveDraftBatchService";

type DraftReadinessReader = { reviewDraft(input: { organizationId: string; sessionId: string }): Promise<{ status: string }> };

export interface ProductInactiveDraftBatchPlanningService extends ProductInactiveDraftBatchCanonicalService {
  single: ProductInactiveDraftPlanningService;
}

export function createProductInactiveDraftBatchCanonicalService(
  single: ProductInactiveDraftPlanningService,
  readiness?: DraftReadinessReader,
): ProductInactiveDraftBatchPlanningService {
  return {
    single,
    async createInactiveDraftBatch(input) {
      const children = [];
      for (const child of input.children) {
        const result = await single.createInactiveDraft({ organizationId: input.organizationId, actorUserId: input.actorUserId, assistantPlanId: `${input.assistantPlanId}:row:${child.rowNumber}`, idempotencyKey: `${input.idempotencyKey}:row:${child.rowNumber}`, correlationId: input.correlationId, intakeSessionId: child.intakeSessionId, proposalFingerprint: child.proposalFingerprint });
        if (!result.pbv2DraftTreeVersionId) throw new ExecutionPlanError("PBV2_DRAFT_MISSING", `Row ${child.rowNumber} did not return a PBV2 DRAFT tree reference.`);
        const draftReadiness = await (readiness?.reviewDraft({ organizationId: input.organizationId, sessionId: child.intakeSessionId })
          ?? import("../../productIntakeWizard/productIntakeDraftReadinessService").then(({ productIntakeDraftReadinessService }) => productIntakeDraftReadinessService.reviewDraft({ organizationId: input.organizationId, sessionId: child.intakeSessionId })));
        children.push({ rowNumber: child.rowNumber, productId: result.product.id, productName: result.product.name, pbv2TreeVersionId: result.pbv2DraftTreeVersionId, readinessStatus: draftReadiness.status, reused: false });
      }
      return { children };
    },
  };
}

const unchanged = ["product_activation", "active_product_modification", "quote_or_order_pricing", "inventory_adjustment", "production_job_creation", "customer_facing_catalog_change"] as const;

export function createProductInactiveDraftBatchExecutionCommand(service: ProductInactiveDraftBatchPlanningService): ExecutionCommandDefinition {
  const command = createProductInactiveDraftBatchCommandDefinition(service);
  const validate = async (organizationId: string, input: ProductInactiveDraftBatchCommandInput) => {
    const checks = await Promise.all(input.children.map((child) => service.single.revalidateProposal({ organizationId, sessionId: child.intakeSessionId, expectedFingerprint: child.proposalFingerprint })));
    const failed = checks.find((check) => !check.valid);
    if (failed && !failed.valid) throw new ExecutionPlanError(failed.code, failed.summary);
    const actual = fingerprintProductInactiveDraftBatch(input.children);
    if (actual !== input.batchFingerprint) throw new ExecutionPlanError("BATCH_PROPOSAL_CHANGED", "The batch proposal changed; review it again.");
  };
  return {
    name: command.name, version: command.version, testOnly: false, riskLevel: command.risk, confirmationTtlMs: command.confirmationExpiresInMs,
    maxAffectedRecords: command.maxAffectedRecords, requiredPermissions: [command.requiredCapability],
    async buildPreview({ scope, arguments: rawArguments }) {
      const input = productInactiveDraftBatchCommandInputSchema.parse(rawArguments); await validate(scope.organizationId, input);
      const preview: ExecutionPlanPreview = { title: `Create ${input.children.length} inactive product drafts`, summary: "Creates only inactive products with PBV2 DRAFT trees. Activation, publication, and changes to existing products are excluded.", sideEffects: input.children.map((child) => `Create inactive draft for ${child.productName}.`), affectedRecords: input.children.map((child) => ({ entityType: "product_intake_session", entityId: child.intakeSessionId, fingerprint: child.proposalFingerprint })), productInactiveDraftBatch: { batchFingerprint: input.batchFingerprint, children: input.children.map((child) => ({ rowNumber: child.rowNumber, productName: child.productName, intakeSessionId: child.intakeSessionId })), unchanged } };
      return { arguments: input, preview };
    },
    async revalidate({ plan, scope }) { try { await validate(scope.organizationId, productInactiveDraftBatchCommandInputSchema.parse(plan.sanitizedArguments)); return { valid: true as const }; } catch (error) { return { valid: false as const, code: error instanceof ExecutionPlanError ? error.code : "BATCH_PROPOSAL_CHANGED", summary: error instanceof Error ? error.message : "The batch proposal changed." }; } },
    async execute({ plan, scope }): Promise<ExecutionCommandResult> {
      const input = productInactiveDraftBatchCommandInputSchema.parse(plan.sanitizedArguments);
      try {
        const history = input.batchId ? await import("../productInactiveDraftBatchHistoryService").then(({ productInactiveDraftBatchHistoryService }) => productInactiveDraftBatchHistoryService) : null;
        if (history && input.batchId) await history.beginExecution({ organizationId: scope.organizationId, batchId: input.batchId, planId: plan.id, correlationId: plan.correlationId, idempotencyKey: plan.idempotencyKey });
        const result = await command.adapter.execute(input, { organizationId: scope.organizationId, actorUserId: scope.userId, planId: plan.id, idempotencyKey: plan.idempotencyKey, correlationId: plan.correlationId, signal: new AbortController().signal });
        if (history && input.batchId) {
          for (const child of result.children) await history.markRowCreated({ organizationId: scope.organizationId, batchId: input.batchId, rowNumber: child.rowNumber, productId: child.productId, readinessResult: { status: child.readinessStatus } });
          await history.completeExecution({ organizationId: scope.organizationId, batchId: input.batchId, hadFailures: false });
        }
        return { status: "succeeded", summary: `Created ${result.children.length} inactive product drafts. Activation and publication remain unavailable in the assistant.`, steps: result.children.map((child) => ({ commandName: `${productInactiveDraftBatchCommandName}@v1`, status: "succeeded", summary: `Row ${child.rowNumber}: created inactive product ${child.productId} with PBV2 DRAFT ${child.pbv2TreeVersionId}; readiness is ${child.readinessStatus.replaceAll("_", " ")}.` })) };
      } catch (error) {
        return { status: "partially_failed", summary: error instanceof Error ? `Batch stopped safely: ${error.message}` : "Batch stopped safely.", steps: [{ commandName: `${productInactiveDraftBatchCommandName}@v1`, status: "failed", summary: "Stopped at the first failing child. Existing child drafts remain inactive and are not retried automatically." }] };
      }
    },
  };
}
