import { and, eq } from "drizzle-orm";
import { products } from "@shared/schema";
import { projectProductDraftIntentToProductBuilderDraft } from "../../productIntentCompiler/productIntentProjection";
import { resolveAndValidateProductDraftIntent } from "../../productIntentCompiler/productIntentResolver";
import { DrizzleCanonicalProductIntentProposalStore, ProductIntentPersistenceService } from "../../productIntentCompiler/productIntentPersistence";
import { createCanonicalProductDraftExecutionWriter } from "../../productIntentCompiler/productIntentDraftExecution";
import { ExecutionPlanError, type ExecutionCommandDefinition, type ExecutionCommandResult, type ExecutionPlanPreview } from "./types";
import { canonicalProductIntentDraftCommandName, canonicalProductIntentDraftInputSchema, createCanonicalProductIntentDraftCommandDefinition, type CanonicalProductIntentDraftService } from "./canonicalProductIntentDraftCommand";

type Loaded = { session: Awaited<ReturnType<ProductIntentPersistenceService["load"]>>; intent: any };

/** This bridge owns only confirmation/revalidation. The transactional PBV2
 * writer remains the canonical Product Intent execution service. */
export function createCanonicalProductIntentDraftService(
  persistence = new ProductIntentPersistenceService(new DrizzleCanonicalProductIntentProposalStore()),
): CanonicalProductIntentDraftService & { load(input: { organizationId: string; actorUserId: string; proposalId: string; revision: number; fingerprint: string }): Promise<Loaded> } {
  const load = async (input: { organizationId: string; actorUserId: string; proposalId: string; revision: number; fingerprint: string }): Promise<Loaded> => {
    const session = await persistence.load(input);
    const envelope = session.specification.session;
    const intent = envelope.revisions.at(-1)!.intent;
    if (session.fingerprint !== input.fingerprint || envelope.currentRevision !== input.revision || intent.revision !== input.revision) throw new ExecutionPlanError("PRODUCT_INTENT_CHANGED", "The canonical product intent changed; review the latest revision.");
    if (intent.operation !== "new_product" || intent.lifecycle.productStatus !== "inactive" || intent.lifecycle.published) throw new ExecutionPlanError("PRODUCT_INTENT_UNSAFE", "Only inactive, unpublished new-product intents can be executed.");
    return { session, intent };
  };
  return {
    load,
    async execute(input) {
      const current = await load(input);
      if (current.session.specification.session.state !== "ready_for_review") throw new ExecutionPlanError("PRODUCT_INTENT_NOT_READY", "The canonical product intent is not ready for confirmation.");
      // Bind the exact revision/fingerprint immediately before the transaction;
      // a correction cannot race a GO into an older revision.
      const bound = await persistence.bindConfirmation({ organizationId: input.organizationId, actorUserId: input.actorUserId, proposalId: input.proposalId, expectedRevision: input.revision, expectedFingerprint: input.fingerprint });
      const intent = bound.specification.session.revisions.at(-1)!.intent;
      const [{ db }] = await Promise.all([import("../../../db")]);
      const issues = await resolveAndValidateProductDraftIntent(intent, {
        categoryLabels: intent.identity.category.state === "resolved" ? [intent.identity.category.label] : [],
        materialLabels: intent.material.state === "resolved" ? [intent.material.label] : [],
        productionRouteLabels: intent.production.route.state === "resolved" ? [intent.production.route.label] : [],
        duplicateName: async (name) => Boolean((await db.select({ id: products.id }).from(products).where(and(eq(products.organizationId, input.organizationId), eq(products.name, name))).limit(1))[0]),
        validatePbv2Compatibility: (candidate) => { try { projectProductDraftIntentToProductBuilderDraft(candidate); return []; } catch (error) { return [{ code: "PBV2_INCOMPATIBLE", path: "", severity: "blocker" as const, message: error instanceof Error ? error.message : "The intent is not compatible with Product Builder." }]; } },
      });
      if (issues.length) throw new ExecutionPlanError("PRODUCT_INTENT_NOT_READY", issues.map((issue) => issue.message).join(" "));
      const writer = createCanonicalProductDraftExecutionWriter(db);
      const result = await writer.execute({ intent, organizationId: input.organizationId, actorUserId: input.actorUserId, idempotencyKey: input.idempotencyKey, sessionId: input.proposalId, assistantPlanId: input.planId, correlationId: input.correlationId });
      await persistence.markExecuted({ organizationId: input.organizationId, actorUserId: input.actorUserId, proposalId: input.proposalId, expectedRevision: input.revision, expectedFingerprint: input.fingerprint });
      return { productId: result.productId, pbv2TreeVersionId: result.pbv2TreeVersionId, reused: result.reused, sourceLink: result.sourceLink };
    },
  };
}

export function createCanonicalProductIntentDraftExecutionCommand(service = createCanonicalProductIntentDraftService()): ExecutionCommandDefinition {
  const command = createCanonicalProductIntentDraftCommandDefinition(service);
  const load = (scope: { organizationId: string; userId: string }, raw: unknown) => service.load({ organizationId: scope.organizationId, actorUserId: scope.userId, ...canonicalProductIntentDraftInputSchema.parse(raw) });
  return {
    name: command.name, version: command.version, testOnly: false, riskLevel: command.risk, confirmationTtlMs: command.confirmationExpiresInMs, maxAffectedRecords: 1, requiredPermissions: [command.requiredCapability],
    async buildPreview({ scope, arguments: raw }) {
      const input = canonicalProductIntentDraftInputSchema.parse(raw); const loaded = await load(scope, input);
      if (loaded.session.specification.session.state !== "ready_for_review") throw new ExecutionPlanError("PRODUCT_INTENT_NOT_READY", "The canonical product intent is not ready for confirmation.");
      const preview: ExecutionPlanPreview = { title: `Create inactive draft: ${loaded.intent.identity.name}`, summary: "Creates exactly one inactive product and one PBV2 DRAFT tree from this canonical revision.", sideEffects: ["Create one inactive product.", "Create one PBV2 DRAFT tree.", "Do not activate or publish the product."], affectedRecords: [{ entityType: "canonical_product_intent", entityId: input.proposalId, fingerprint: input.fingerprint }], configurableProduct: { kind: "canonical_product_intent", proposalId: input.proposalId, revision: input.revision, fingerprint: input.fingerprint, productName: loaded.intent.identity.name } };
      return { arguments: input, preview };
    },
    async revalidate({ plan, scope }) { try { const loaded = await load(scope, plan.sanitizedArguments); return loaded.session.specification.session.state === "ready_for_review" ? { valid: true as const } : { valid: false as const, code: "PRODUCT_INTENT_NOT_READY", summary: "The canonical product intent is no longer ready." }; } catch (error) { return { valid: false as const, code: "PRODUCT_INTENT_CHANGED", summary: error instanceof Error ? error.message : "The canonical product intent changed." }; } },
    async execute({ plan, scope }): Promise<ExecutionCommandResult> { const result = await command.adapter.execute(canonicalProductIntentDraftInputSchema.parse(plan.sanitizedArguments), { organizationId: scope.organizationId, actorUserId: scope.userId, planId: plan.id, idempotencyKey: plan.idempotencyKey, correlationId: plan.correlationId, signal: new AbortController().signal }); return { status: "succeeded", summary: result.reused ? "The canonical inactive draft already existed; returning the exact draft." : "The canonical inactive product draft was created.", details: { productDraft: { id: result.productId, name: "Inactive product draft", sourceLink: result.sourceLink } }, steps: [{ commandName: `${canonicalProductIntentDraftCommandName}@v1`, status: "succeeded", summary: `Product ${result.productId}; PBV2 DRAFT ${result.pbv2TreeVersionId}.` }] }; },
  };
}
