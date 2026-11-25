import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { organizationRoleValues, resolveOrganizationRoleAuthority } from "@shared/organizationRoleAuthority";
import {
  executeReviewedProductionCompletion, previewReviewedProductionCompletion,
  reviewedProductionCompletionPreviewSchema, reviewedProductionCompletionResultSchema,
  ReviewedProductionCompletionError, type ReviewedProductionCompletionPreview,
} from "../../reviewedProductionCompletion";
import { verifyNativeReadAuthority } from "../orderFulfillmentReadinessRead";
import type { AssistantCommandDefinition } from "./commandRegistry";
import { ExecutionPlanError, type ExecutionActorScope, type ExecutionCommandDefinition } from "./types";

export const productionCompletionCommandName = "production.complete_job";
const requiredCapability = "assistant.production.update_job_status";
const allowedRoles = organizationRoleValues.filter(role => resolveOrganizationRoleAuthority(role).grants.includes(requiredCapability));
const native = { preview: previewReviewedProductionCompletion, execute: executeReviewedProductionCompletion, verifyMembership: verifyNativeReadAuthority };
const argumentSchema = z.object({ preview: reviewedProductionCompletionPreviewSchema }).strict();
const planPreviewSchema = z.object({ title: z.string(), summary: z.string(), sideEffects: z.array(z.string()),
  affectedRecords: z.array(z.object({ entityType: z.string(), entityId: z.string(), fingerprint: z.string() }).strict()),
}).strict();

/** Accept the server-created review once; subsequent plans must not select a new job or compute new arguments. */
export function prepareProductionCompletionCommandArguments(preview: ReviewedProductionCompletionPreview) {
  return argumentSchema.parse({ preview });
}

type Actor = Pick<ExecutionActorScope, "organizationId" | "userId">;
type Target = Parameters<typeof previewReviewedProductionCompletion>[0];

async function authorize(actor: Actor, target: Target, operations: typeof native) {
  if (actor.organizationId !== target.organizationId || actor.userId !== target.actorUserId) {
    throw new ExecutionPlanError("PERMISSION_DENIED", "This production review belongs to a different actor or organization.");
  }
  const current = await operations.verifyMembership({ organizationId: actor.organizationId, userId: actor.userId, orderId: target.orderId });
  if (current?.organizationId !== actor.organizationId || current.userId !== actor.userId ||
      !resolveOrganizationRoleAuthority(current.organizationRole).grants.includes(requiredCapability)) {
    throw new ExecutionPlanError("PERMISSION_DENIED", "Current membership does not authorize production completion.");
  }
}

export function createProductionCompletionCommandDefinition(operations = native): AssistantCommandDefinition {
  return {
    name: productionCompletionCommandName, version: "v1", mode: "write", domain: "production", risk: "high",
    description: "Complete one reviewed Production-board job through the ordinary native workflow.",
    requiredCapability, allowedRoles, inputSchema: argumentSchema, previewSchema: planPreviewSchema,
    resultSchema: reviewedProductionCompletionResultSchema, confirmationRequired: true, confirmationExpiresInMs: 5 * 60_000,
    reauthenticationRequired: false, maxAffectedRecords: 3, bulkAllowed: false, idempotencyPolicy: "server_generated_with_request_hash",
    recordFingerprintStrategy: "stable_field_hash", transactionPolicy: "required", partialFailurePolicy: "record_and_stop",
    auditCategory: "assistant_production_complete_job", undoSupport: "none", abandonmentPolicy: "none",
    testOnly: false, devEnabled: true, mainEnabled: true,
    adapter: { async execute(raw, context) {
      const { preview } = argumentSchema.parse(raw);
      const target = preview.scope;
      await authorize({ organizationId: context.organizationId, userId: context.actorUserId }, target, operations);
      return reviewedProductionCompletionResultSchema.parse(await operations.execute(target, preview));
    } },
  };
}

export function createProductionCompletionExecutionCommand(operations = native): ExecutionCommandDefinition {
  const command = createProductionCompletionCommandDefinition(operations);
  async function verify(actor: Actor, review: ReviewedProductionCompletionPreview) {
    await authorize(actor, review.scope, operations);
    const fresh = reviewedProductionCompletionPreviewSchema.parse(await operations.preview(review.scope));
    if (!isDeepStrictEqual(fresh, review)) {
      throw new ExecutionPlanError("PLAN_STALE", "The reviewed job, line or route changed. Review a new proposal.");
    }
  }
  return {
    name: command.name, version: command.version, testOnly: false, riskLevel: command.risk, confirmationTtlMs: command.confirmationExpiresInMs,
    maxAffectedRecords: command.maxAffectedRecords, requiredPermissions: [requiredCapability], allowedRoles,
    async buildPreview({ scope, context, arguments: raw }) {
      const args = argumentSchema.parse(raw);
      const { scope: target, jobId, state, route, revision } = args.preview;
      const orderPath = `/orders/${encodeURIComponent(target.orderId)}`;
      const path = context.route.split(/[?#]/)[0].replace(/\/$/, "");
      if (context.unsavedChanges || context.entityType !== "order" || context.entityId !== target.orderId ||
          (path !== orderPath && path !== `/fulfillment${orderPath}`)) {
        throw new ExecutionPlanError("CONTEXT_CHANGED", "Review production completion on the saved target order.");
      }
      try { await verify(scope, args.preview); }
      catch (error) {
        if (error instanceof ExecutionPlanError) throw error;
        throw new ExecutionPlanError("PLAN_PREPARATION_FAILED", "Cannot verify the reviewed production job; review it again.");
      }
      return { arguments: args, preview: planPreviewSchema.parse({
        title: "Complete production job",
        summary: `Complete started job ${jobId} at ${state.stationKey}/${state.stepKey} for order ${target.orderId}, line ${target.lineItemId}. Current line workflow: ${state.lineWorkflowState ?? "unavailable"}; order status: ${state.orderStatus ?? "unavailable"}. Configured next route: ${route.stationKey}/${route.stepKey}.`,
        sideEffects: ["Uses ordinary production completion, including native routing, workflow history and configured status notifications.",
          "Does not attest physical ready quantity, box items, create a shipment or record a pickup."],
        affectedRecords: [{ entityType: "order", entityId: target.orderId, fingerprint: revision },
          { entityType: "order_line", entityId: target.lineItemId, fingerprint: revision },
          { entityType: "production_job", entityId: jobId, fingerprint: revision }],
      }) };
    },
    async revalidate({ scope, plan }) {
      try { await verify(scope, argumentSchema.parse(plan.sanitizedArguments).preview); return { valid: true }; }
      catch (error) { return { valid: false, code: error instanceof ExecutionPlanError ? error.code : "PLAN_STALE",
        summary: "Current membership or job state no longer verifies the reviewed completion." }; }
    },
    async execute({ scope, plan }) {
      let status: "succeeded" | "failed" = "failed";
      let summary: string;
      try {
        const { preview } = argumentSchema.parse(plan.sanitizedArguments);
        const result = reviewedProductionCompletionResultSchema.parse(await command.adapter.execute({ preview }, {
          organizationId: scope.organizationId, actorUserId: scope.userId, planId: plan.id, correlationId: plan.correlationId,
          idempotencyKey: plan.idempotencyKey, signal: new AbortController().signal,
        }));
        if (result.job.id !== preview.jobId || result.order.id !== preview.scope.orderId || result.line.id !== preview.scope.lineItemId ||
            result.job.status !== "done" || !result.job.completedAt) throw new Error("Unverified native postcondition");
        status = "succeeded";
        summary = `Completed production job ${result.job.id}. ` +
          `Line ${result.line.id}: ${result.line.workflowState ?? result.line.status ?? "state unavailable"}. Order ${result.order.id}: ${result.order.status ?? result.order.state ?? "state unavailable"}.`;
        if (result.activeSuccessors.length) summary += ` Next active job: ${result.activeSuccessors[0].stationKey}/${result.activeSuccessors[0].stepKey}.`;
        if (result.postcommit.some(hook => hook.status === "unavailable")) summary += " A post-completion workflow update is unavailable; check the order history.";
      } catch (error) {
        // A lost response or an inconsistent post-write read is not proof that the write rolled back.
        summary = error instanceof ExecutionPlanError || (error instanceof ReviewedProductionCompletionError && error.statusCode < 500)
          ? `The reviewed production completion was not accepted (${error.code}).`
          : "Production completion outcome unverified. Check the job and order history before retrying.";
      }
      return { status, summary, steps: [{ commandName: command.name, status, summary }] };
    },
  };
}
