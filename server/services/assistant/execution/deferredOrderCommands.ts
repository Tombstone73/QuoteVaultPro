import { z } from "zod";
import { ExecutionPlanError } from "./types";
import type { ExecutionCommandDefinition, ExecutionCommandResult, ExecutionPlanPreview } from "./types";
import type { AssistantCanonicalCommandAdapter, AssistantCommandDefinition, AssistantCommandExecutionContext } from "./commandRegistry";

export const assistantOrderCreateCommandName = "orders.create" as const;
export const assistantOrderUpdateEditableCommandName = "orders.update_editable" as const;
export const assistantQuoteConvertOrderCommandName = "quotes.convert_to_order" as const;
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/i);
const inputSchema = z.object({ orderIntakeSessionId: z.string().min(1).max(128), proposalFingerprint: fingerprint }).strict();
const resultSchema = z.object({ id: z.string().min(1), displayNumber: z.string().min(1), totalCents: z.number().int().min(0), sourceLink: z.string().regex(/^\/orders\/[^\s/]+$/) }).strict();

export interface DeferredOrderPlanningService {
  revalidateCreateProposal(input: { organizationId: string; orderIntakeSessionId: string; expectedProposalFingerprint: string }): Promise<{ valid: true; proposal: any } | { valid: false; code: string; summary: string }>;
  createConfirmedOrder(input: { organizationId: string; actorUserId: string; orderIntakeSessionId: string; proposalFingerprint: string }): Promise<z.infer<typeof resultSchema>>;
}

function definition(name: string, service: DeferredOrderPlanningService): AssistantCommandDefinition {
  const adapter: AssistantCanonicalCommandAdapter = { async execute(raw, context: AssistantCommandExecutionContext) {
    const input = inputSchema.parse(raw);
    return resultSchema.parse(await service.createConfirmedOrder({ organizationId: context.organizationId, actorUserId: context.actorUserId, ...input }));
  } };
  return {
    name, version: "v1", domain: name.startsWith("quotes.") ? "quotes" : "orders", mode: "write",
    description: name === assistantQuoteConvertOrderCommandName ? "Convert one quote into an order with deferred production intake." : "Create one order with deferred production intake.",
    risk: "high", requiredCapability: `assistant.${name}`, allowedRoles: ["owner", "admin", "manager", "employee"], inputSchema, previewSchema: z.object({}).passthrough(), resultSchema,
    maxAffectedRecords: 1, bulkAllowed: false, confirmationRequired: true, reauthenticationRequired: false, confirmationExpiresInMs: 5 * 60_000,
    idempotencyPolicy: "server_generated_with_request_hash", recordFingerprintStrategy: "stable_field_hash", transactionPolicy: "required", partialFailurePolicy: "forbid",
    auditCategory: "assistant_deferred_order", undoSupport: "metadata_only", abandonmentPolicy: "session_abandonment_only", testOnly: false, devEnabled: true, mainEnabled: true, adapter,
  };
}

export const createDeferredOrderCommandDefinition = (service: DeferredOrderPlanningService) => definition(assistantOrderCreateCommandName, service);
export const createQuoteConvertOrderCommandDefinition = (service: DeferredOrderPlanningService) => definition(assistantQuoteConvertOrderCommandName, service);
export const createEditableOrderUpdateCommandDefinition = (service: DeferredOrderPlanningService) => definition(assistantOrderUpdateEditableCommandName, service);

export function createDeferredOrderExecutionCommand(name: typeof assistantOrderCreateCommandName | typeof assistantOrderUpdateEditableCommandName | typeof assistantQuoteConvertOrderCommandName, service: DeferredOrderPlanningService): ExecutionCommandDefinition {
  const command = definition(name, service);
  return {
    name, version: "v1", testOnly: false, riskLevel: "high", confirmationTtlMs: 5 * 60_000, maxAffectedRecords: 1,
    requiredPermissions: [command.requiredCapability],
    async buildPreview({ scope, arguments: raw }) {
      const input = inputSchema.parse(raw);
      const validation = await service.revalidateCreateProposal({ organizationId: scope.organizationId, orderIntakeSessionId: input.orderIntakeSessionId, expectedProposalFingerprint: input.proposalFingerprint });
      if (!validation.valid) throw new ExecutionPlanError(validation.code, validation.summary);
      const p = validation.proposal;
      const conversion = p.kind === "conversion";
      const preview: ExecutionPlanPreview = {
        title: conversion ? "Convert quote to order" : `Create order for ${p.customerName}`,
        summary: `${p.summary} No production job, production scheduling, material reservation, fulfillment record, invoice, or payment will be created.`,
        sideEffects: [p.summary, ...(p.lines ?? []).map((line: any) => `${line.quantity} × ${line.productName}: $${(line.totalCents / 100).toFixed(2)}.`)],
        affectedRecords: [{ entityType: "assistant_order_intake_session", entityId: p.orderIntakeSessionId, fingerprint: p.proposalFingerprint }],
      };
      return { arguments: { orderIntakeSessionId: p.orderIntakeSessionId, proposalFingerprint: p.proposalFingerprint }, preview };
    },
    async revalidate({ plan, scope }) {
      const input = inputSchema.parse(plan.sanitizedArguments); const record = plan.affectedRecords[0];
      const validation = await service.revalidateCreateProposal({ organizationId: scope.organizationId, orderIntakeSessionId: input.orderIntakeSessionId, expectedProposalFingerprint: input.proposalFingerprint });
      return validation.valid && record?.entityId === input.orderIntakeSessionId && record.fingerprint === input.proposalFingerprint
        ? { valid: true as const } : { valid: false as const, code: validation.valid ? "ORDER_PROPOSAL_CHANGED" : validation.code, summary: validation.valid ? "The order proposal changed." : validation.summary };
    },
    async execute({ plan, scope }): Promise<ExecutionCommandResult> {
      const result = resultSchema.parse(await command.adapter.execute(inputSchema.parse(plan.sanitizedArguments), { organizationId: scope.organizationId, actorUserId: scope.userId, planId: plan.id, idempotencyKey: plan.idempotencyKey, correlationId: plan.correlationId, signal: new AbortController().signal }));
      const isUpdate = name === assistantOrderUpdateEditableCommandName;
      const isConversion = name === assistantQuoteConvertOrderCommandName;
      return { status: "succeeded", summary: isUpdate ? `Updated editable order ${result.displayNumber}.` : `${isConversion ? "Quote converted to" : "Created"} order ${result.displayNumber}. Production remains deferred.`, steps: [{ commandName: `${name}@v1`, status: "succeeded", summary: isUpdate ? `Updated editable order ${result.displayNumber}.` : `Created order ${result.displayNumber} with deferred production intake.` }] };
    },
  };
}
