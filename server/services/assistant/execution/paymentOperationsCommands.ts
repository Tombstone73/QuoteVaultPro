import { z } from "zod";
import type { AssistantCanonicalCommandAdapter, AssistantCommandDefinition, AssistantCommandExecutionContext } from "./commandRegistry";
import { ExecutionPlanError } from "./types";
import type { ExecutionCommandDefinition, ExecutionCommandResult, ExecutionPlanPreview } from "./types";
import { paymentOperationCommandNames, type PaymentOperationCommandName, type PaymentOperationsService } from "../paymentOperationsService";

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/i);
export const paymentOperationInputSchema = z.object({ paymentIntakeSessionId: z.string().min(1), proposalFingerprint: fingerprint }).strict();
const resultSchema = z.object({ sourceLinks: z.array(z.object({ label: z.string(), href: z.string() })), summary: z.string() }).strict();

function label(name: PaymentOperationCommandName) {
  return ({
    "payments.record_manual_payment": "Record manual payment",
    "payments.add_payment_note": "Add internal payment note",
  } as const)[name];
}

export function createPaymentOperationCommandDefinition(name: PaymentOperationCommandName, service: PaymentOperationsService): AssistantCommandDefinition {
  const adapter: AssistantCanonicalCommandAdapter = {
    async execute(raw, context: AssistantCommandExecutionContext) {
      const input = paymentOperationInputSchema.parse(raw);
      return resultSchema.parse(await service.executeConfirmed({
        organizationId: context.organizationId, actorUserId: context.actorUserId, idempotencyKey: context.idempotencyKey, ...input,
      }));
    },
  };
  return {
    name, version: "v1", domain: "payments", mode: "write", description: `${label(name)} through the canonical manual payment service.`,
    risk: "high", requiredCapability: `assistant.${name}`, allowedRoles: ["owner", "admin", "manager", "employee"],
    inputSchema: paymentOperationInputSchema, previewSchema: z.object({}).passthrough(), resultSchema,
    maxAffectedRecords: 1, bulkAllowed: false, confirmationRequired: true, reauthenticationRequired: false, confirmationExpiresInMs: 5 * 60_000,
    idempotencyPolicy: "server_generated_with_request_hash", recordFingerprintStrategy: "updated_at_and_critical_fields",
    transactionPolicy: "required", partialFailurePolicy: "forbid", auditCategory: `assistant_${name.replaceAll(".", "_")}`,
    undoSupport: "metadata_only", abandonmentPolicy: "session_abandonment_only", testOnly: false, devEnabled: true, mainEnabled: true, adapter,
  };
}

export function createPaymentOperationExecutionCommand(name: PaymentOperationCommandName, service: PaymentOperationsService): ExecutionCommandDefinition {
  const command = createPaymentOperationCommandDefinition(name, service);
  return {
    name, version: "v1", testOnly: false, riskLevel: "high", confirmationTtlMs: command.confirmationExpiresInMs,
    maxAffectedRecords: 1, requiredPermissions: [command.requiredCapability],
    async buildPreview({ scope, arguments: raw }) {
      const input = paymentOperationInputSchema.parse(raw);
      const validation = await service.revalidateProposal({ organizationId: scope.organizationId, paymentIntakeSessionId: input.paymentIntakeSessionId, expectedProposalFingerprint: input.proposalFingerprint });
      if (!validation.valid) throw new ExecutionPlanError(validation.code, validation.summary);
      return {
        arguments: input,
        preview: {
          title: label(name), summary: validation.proposal.summary,
          sideEffects: [validation.proposal.summary, "No EPS, customer portal, card/ACH processing, refund, credit, production, or fulfillment action will occur."],
          affectedRecords: [{ entityType: "assistant_payment_intake_session", entityId: input.paymentIntakeSessionId, fingerprint: input.proposalFingerprint }],
        } as ExecutionPlanPreview,
      };
    },
    async revalidate({ plan, scope }) {
      const input = paymentOperationInputSchema.parse(plan.sanitizedArguments);
      const result = await service.revalidateProposal({ organizationId: scope.organizationId, paymentIntakeSessionId: input.paymentIntakeSessionId, expectedProposalFingerprint: input.proposalFingerprint });
      return result.valid ? { valid: true as const } : { valid: false as const, code: result.code, summary: result.summary };
    },
    async execute({ plan, scope }): Promise<ExecutionCommandResult> {
      const result = resultSchema.parse(await command.adapter.execute(paymentOperationInputSchema.parse(plan.sanitizedArguments), {
        organizationId: scope.organizationId, actorUserId: scope.userId, planId: plan.id, idempotencyKey: plan.idempotencyKey,
        correlationId: plan.correlationId, signal: new AbortController().signal,
      }));
      return { status: "succeeded", summary: result.summary, steps: [{ commandName: `${name}@v1`, status: "succeeded", summary: `${label(name)} succeeded.` }] };
    },
  };
}

export { paymentOperationCommandNames };
