import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { organizationRoleValues, resolveOrganizationRoleAuthority } from "@shared/organizationRoleAuthority";
import {
  executePhysicalReadinessAdjustment, physicalReadinessAdjustmentPreviewSchema, physicalReadinessAdjustmentResultSchema,
  PhysicalReadinessAdjustmentError, previewPhysicalReadinessAdjustment, type PhysicalReadinessAdjustmentPreview,
} from "../physicalReadinessAdjustment";
import type { AssistantCommandDefinition } from "./commandRegistry";
import { ExecutionPlanError, type ExecutionActorScope, type ExecutionCommandDefinition } from "./types";

export const physicalReadinessCommandName = "fulfillment.adjust_physical_readiness";
const requiredCapability = "assistant.fulfillment.add_note";
const allowedRoles = organizationRoleValues.filter(role => resolveOrganizationRoleAuthority(role).grants.includes(requiredCapability));
type Operations = { preview: typeof previewPhysicalReadinessAdjustment; execute: typeof executePhysicalReadinessAdjustment };
const native: Operations = { preview: previewPhysicalReadinessAdjustment, execute: executePhysicalReadinessAdjustment };

export const physicalReadinessCommandArgumentsSchema = z.object({
  clientRequestId: z.string().uuid(), preview: physicalReadinessAdjustmentPreviewSchema,
}).strict();

/** Call only when creating the server-owned action_proposal, never when issuing a plan/token. */
export function preparePhysicalReadinessCommandArguments(preview: PhysicalReadinessAdjustmentPreview) {
  return physicalReadinessCommandArgumentsSchema.parse({ clientRequestId: randomUUID(), preview });
}

function boundScope(scope: Pick<ExecutionActorScope, "organizationId" | "userId">, preview: PhysicalReadinessAdjustmentPreview) {
  if (scope.organizationId !== preview.scope.organizationId || scope.userId !== preview.scope.userId) {
    throw new ExecutionPlanError("PERMISSION_DENIED", "This adjustment belongs to a different actor or organization.");
  }
  return { organizationId: scope.organizationId, userId: scope.userId, orderId: preview.scope.orderId };
}

const planPreviewSchema = z.object({
  title: z.string(), summary: z.string(), sideEffects: z.array(z.string()),
  affectedRecords: z.array(z.object({ entityType: z.literal("order"), entityId: z.string(), fingerprint: z.string().length(64) }).strict()).length(1),
}).strict();

export function createPhysicalReadinessCommandDefinition(ops: Operations = native): AssistantCommandDefinition {
  return {
    name: physicalReadinessCommandName, version: "v1", mode: "write", domain: "fulfillment", risk: "high",
    description: "Adjust physical readiness for one reviewed order line through native fulfillment.",
    requiredCapability, allowedRoles, inputSchema: physicalReadinessCommandArgumentsSchema, previewSchema: planPreviewSchema,
    resultSchema: physicalReadinessAdjustmentResultSchema, confirmationRequired: true, confirmationExpiresInMs: 5 * 60_000,
    reauthenticationRequired: false, maxAffectedRecords: 1, bulkAllowed: false, idempotencyPolicy: "server_generated_required",
    recordFingerprintStrategy: "stable_field_hash", transactionPolicy: "required", partialFailurePolicy: "forbid",
    auditCategory: "assistant_fulfillment_adjust_physical_readiness", undoSupport: "none", abandonmentPolicy: "none",
    testOnly: false, devEnabled: true, mainEnabled: true,
    adapter: { async execute(raw, actor) {
      const { clientRequestId, preview } = physicalReadinessCommandArgumentsSchema.parse(raw);
      const scope = boundScope({ organizationId: actor.organizationId, userId: actor.actorUserId }, preview);
      return physicalReadinessAdjustmentResultSchema.parse(await ops.execute(scope, preview, { clientRequestId }));
    } },
  };
}

export function createPhysicalReadinessExecutionCommand(ops: Operations = native): ExecutionCommandDefinition {
  const command = createPhysicalReadinessCommandDefinition(ops);

  async function verify(scope: ExecutionActorScope, preview: PhysicalReadinessAdjustmentPreview) {
    const target = boundScope(scope, preview);
    if (!isDeepStrictEqual(physicalReadinessAdjustmentPreviewSchema.parse(await ops.preview(target, preview.input)), preview)) {
      throw new ExecutionPlanError("PLAN_STALE", "The reviewed readiness or authority changed. Review a new proposal.");
    }
  }

  return {
    name: command.name, version: command.version, testOnly: false, riskLevel: command.risk,
    confirmationTtlMs: command.confirmationExpiresInMs, maxAffectedRecords: command.maxAffectedRecords,
    requiredPermissions: [requiredCapability], allowedRoles,
    async buildPreview({ scope, arguments: raw, context }) {
      const args = physicalReadinessCommandArgumentsSchema.parse(raw);
      const { preview } = args;
      const targetPath = `/orders/${encodeURIComponent(preview.scope.orderId)}`;
      const pathname = context.route.split(/[?#]/)[0].replace(/\/$/, "");
      if (context.entityType !== "order" || context.entityId !== preview.scope.orderId || context.unsavedChanges ||
          (pathname !== targetPath && pathname !== `/fulfillment${targetPath}`)) {
        throw new ExecutionPlanError("CONTEXT_CHANGED", "Review this adjustment on the saved target order.");
      }
      try { await verify(scope, preview); } catch (error) {
        if (error instanceof ExecutionPlanError) throw error;
        throw new ExecutionPlanError("PLAN_PREPARATION_FAILED", "The reviewed adjustment could not be verified.");
      }
      const { orderLineItemId, quantityDelta, reason } = preview.input;
      return { arguments: args, preview: planPreviewSchema.parse({
        title: "Adjust physical readiness",
        summary: `Order ${preview.scope.orderId}, line ${orderLineItemId}: physical ready quantity ${preview.expectedReadyQuantity} to ${preview.expectedReadyQuantity + quantityDelta} (${quantityDelta > 0 ? "+" : ""}${quantityDelta}). Reason: ${reason}`,
        sideEffects: ["Records the adjustment and reason in fulfillment history. Production jobs stay unchanged; no shipment or pickup is created."],
        affectedRecords: [{ entityType: "order", entityId: preview.scope.orderId, fingerprint: createHash("sha256").update(JSON.stringify(preview)).digest("hex") }],
      }) };
    },
    async revalidate({ scope, plan }) {
      try {
        await verify(scope, physicalReadinessCommandArgumentsSchema.parse(plan.sanitizedArguments).preview);
        return { valid: true };
      } catch {
        return { valid: false, code: "PLAN_STALE", summary: "Current readiness or authority no longer verifies this proposal." };
      }
    },
    async execute({ scope, plan }) {
      let summary: string;
      let status: "succeeded" | "failed" = "failed";
      let receipt: string | null = null;
      try {
        const result = physicalReadinessAdjustmentResultSchema.parse(await command.adapter.execute(plan.sanitizedArguments, {
          organizationId: scope.organizationId, actorUserId: scope.userId, planId: plan.id,
          correlationId: plan.correlationId, idempotencyKey: plan.idempotencyKey, signal: new AbortController().signal,
        }));
        receipt = result.receiptId;
        if (result.status === "outcome_unknown") {
          summary = "Adjustment outcome unknown. Check fulfillment history before making another adjustment.";
        } else {
          status = "succeeded";
          summary = "Native fulfillment recorded the physical readiness adjustment.";
          if (result.status === "applied" && result.readiness.status === "available") {
            const { preview } = physicalReadinessCommandArgumentsSchema.parse(plan.sanitizedArguments);
            const line = result.readiness.lines.find(row => row.id === preview.input.orderLineItemId);
            if (line) summary += ` Ready waiting quantity for the reviewed line: ${line.quantities.readyWaitingQuantity}.`;
          } else summary += " Refreshed readiness is unavailable.";
        }
      } catch (error) {
        summary = error instanceof PhysicalReadinessAdjustmentError
          ? `Native fulfillment rejected this adjustment (${error.code}).`
          : "Adjustment outcome unknown. Check fulfillment history before making another adjustment.";
      }
      return { status, summary, steps: [{ commandName: command.name, status, summary, ...(receipt ? {domainAuditReference: receipt} : {}) }] };
    },
  };
}
