import { z } from "zod";
import type { AssistantCanonicalCommandAdapter, AssistantCommandDefinition, AssistantCommandExecutionContext } from "./commandRegistry";
import { ExecutionPlanError } from "./types";
import type { ExecutionCommandDefinition, ExecutionCommandResult, ExecutionPlanPreview } from "./types";
import { billingInvoiceOperationCommandNames, type BillingInvoiceOperationCommandName, type BillingInvoiceOperationsService } from "../billingInvoiceOperationsService";

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/i);
export const billingInvoiceOperationInputSchema = z.object({ billingIntakeSessionId: z.string().min(1), proposalFingerprint: fingerprint }).strict();
const resultSchema = z.object({ sourceLinks: z.array(z.object({ label: z.string(), href: z.string() })), summary: z.string() }).strict();

function label(name: BillingInvoiceOperationCommandName) {
  return ({
    "billing.create_invoice": "Create invoice",
    "billing.update_invoice_draft": "Update draft invoice",
    "billing.send_invoice": "Mark invoice sent",
    "billing.add_invoice_note": "Add internal invoice note",
  } as const)[name];
}

export function createBillingInvoiceOperationCommandDefinition(name: BillingInvoiceOperationCommandName, service: BillingInvoiceOperationsService): AssistantCommandDefinition {
  const adapter: AssistantCanonicalCommandAdapter = {
    async execute(raw, context: AssistantCommandExecutionContext) {
      const input = billingInvoiceOperationInputSchema.parse(raw);
      return resultSchema.parse(await service.executeConfirmed({ organizationId: context.organizationId, actorUserId: context.actorUserId, ...input }));
    },
  };
  return {
    name, version: "v1", domain: "billing", mode: "write", description: `${label(name)} through canonical billing and invoice services.`, risk: "high",
    requiredCapability: `assistant.${name}`, allowedRoles: ["owner", "admin", "manager", "employee"], inputSchema: billingInvoiceOperationInputSchema,
    previewSchema: z.object({}).passthrough(), resultSchema, maxAffectedRecords: name === "billing.create_invoice" ? 10 : 1,
    bulkAllowed: name === "billing.create_invoice", confirmationRequired: true, reauthenticationRequired: false, confirmationExpiresInMs: 5 * 60_000,
    idempotencyPolicy: "server_generated_with_request_hash", recordFingerprintStrategy: "updated_at_and_critical_fields", transactionPolicy: "required",
    partialFailurePolicy: "forbid", auditCategory: `assistant_${name.replaceAll(".", "_")}`, undoSupport: "metadata_only", abandonmentPolicy: "session_abandonment_only",
    testOnly: false, devEnabled: true, mainEnabled: true, adapter,
  };
}

export function createBillingInvoiceOperationExecutionCommand(name: BillingInvoiceOperationCommandName, service: BillingInvoiceOperationsService): ExecutionCommandDefinition {
  const command = createBillingInvoiceOperationCommandDefinition(name, service);
  return {
    name, version: "v1", testOnly: false, riskLevel: "high", confirmationTtlMs: command.confirmationExpiresInMs, maxAffectedRecords: command.maxAffectedRecords,
    requiredPermissions: [command.requiredCapability],
    async buildPreview({ scope, arguments: raw }) {
      const input = billingInvoiceOperationInputSchema.parse(raw);
      const validation = await service.revalidateProposal({ organizationId: scope.organizationId, billingIntakeSessionId: input.billingIntakeSessionId, expectedProposalFingerprint: input.proposalFingerprint });
      if (!validation.valid) throw new ExecutionPlanError(validation.code, validation.summary);
      return {
        arguments: input,
        preview: {
          title: label(name), summary: validation.proposal.summary,
          sideEffects: [validation.proposal.summary, "No payment, paid status, production, or fulfillment state will change."],
          affectedRecords: [{ entityType: "assistant_billing_intake_session", entityId: input.billingIntakeSessionId, fingerprint: input.proposalFingerprint }],
        } as ExecutionPlanPreview,
      };
    },
    async revalidate({ plan, scope }) {
      const input = billingInvoiceOperationInputSchema.parse(plan.sanitizedArguments);
      const result = await service.revalidateProposal({ organizationId: scope.organizationId, billingIntakeSessionId: input.billingIntakeSessionId, expectedProposalFingerprint: input.proposalFingerprint });
      return result.valid ? { valid: true as const } : { valid: false as const, code: result.code, summary: result.summary };
    },
    async execute({ plan, scope }): Promise<ExecutionCommandResult> {
      const result = resultSchema.parse(await command.adapter.execute(billingInvoiceOperationInputSchema.parse(plan.sanitizedArguments), {
        organizationId: scope.organizationId, actorUserId: scope.userId, planId: plan.id, idempotencyKey: plan.idempotencyKey, correlationId: plan.correlationId, signal: new AbortController().signal,
      }));
      return { status: "succeeded", summary: result.summary, steps: [{ commandName: `${name}@v1`, status: "succeeded", summary: `${label(name)} succeeded.` }] };
    },
  };
}

export { billingInvoiceOperationCommandNames };
