import { z } from "zod";
import type { AssistantCanonicalCommandAdapter, AssistantCommandDefinition, AssistantCommandExecutionContext } from "./commandRegistry";
import { ExecutionPlanError } from "./types";
import type { ExecutionCommandDefinition, ExecutionCommandResult, ExecutionPlanPreview } from "./types";
import { crmCommandNames, type CrmCommandName, type CrmManagementService } from "../crmManagementService";

export const crmProposalFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/i);
export const crmCommandInputSchema = z.object({ crmIntakeSessionId: z.string().min(1).max(128), proposalFingerprint: crmProposalFingerprintSchema }).strict();
export type CrmCommandInput = z.infer<typeof crmCommandInputSchema>;
const changeSchema = z.object({ field: z.string().min(1), before: z.unknown(), after: z.unknown() }).strict();
export const crmCommandPreviewSchema = z.object({ crmIntakeSessionId: z.string().min(1), commandName: z.enum(crmCommandNames), proposalFingerprint: crmProposalFingerprintSchema, expectedFingerprint: z.string().min(1), changes: z.array(changeSchema).min(1), warnings: z.array(z.string()), duplicateCandidates: z.array(z.string()), sourceLinks: z.array(z.object({ label: z.string(), href: z.string() }).strict()), summary: z.string(), downstreamActionsExcluded: z.array(z.string()) }).strict();
export const crmCommandResultSchema = z.object({ id: z.string().min(1), entityType: z.enum(["customer", "contact"]), sourceLink: z.string().regex(/^\/customers\/[\S]+$/) }).strict();

function label(name: CrmCommandName) { return name === "customers.create" ? "Create customer" : name === "customers.update_profile" ? "Update customer profile" : name === "customers.update_commercial_terms" ? "Update customer commercial terms" : name === "contacts.create" ? "Create contact" : "Update contact"; }
function category(name: CrmCommandName) { return `assistant_${name.replace(".", "_")}`; }
function adapter(name: CrmCommandName, service: CrmManagementService): AssistantCanonicalCommandAdapter<CrmCommandInput, z.infer<typeof crmCommandResultSchema>> { return { async execute(raw, context: AssistantCommandExecutionContext) { const input = crmCommandInputSchema.parse(raw); return crmCommandResultSchema.parse(await service.executeConfirmed({ organizationId: context.organizationId, actorUserId: context.actorUserId, ...input })); } }; }

export function createCrmManagementCommandDefinition(name: CrmCommandName, service: CrmManagementService): AssistantCommandDefinition<CrmCommandInput, z.infer<typeof crmCommandPreviewSchema>, z.infer<typeof crmCommandResultSchema>> {
  return { name, version: "v1", domain: name.split(".")[0], mode: "write", description: `${label(name)} through the canonical, tenant-scoped CRM service.`, risk: "high", requiredCapability: `assistant.${name}`, allowedRoles: ["owner", "admin", "manager", "employee"], inputSchema: crmCommandInputSchema, previewSchema: crmCommandPreviewSchema, resultSchema: crmCommandResultSchema, maxAffectedRecords: 1, bulkAllowed: false, confirmationRequired: true, reauthenticationRequired: false, confirmationExpiresInMs: 5 * 60_000, idempotencyPolicy: "server_generated_with_request_hash", recordFingerprintStrategy: "updated_at_and_critical_fields", transactionPolicy: "required", partialFailurePolicy: "forbid", auditCategory: category(name), undoSupport: "metadata_only", abandonmentPolicy: "session_abandonment_only", testOnly: false, devEnabled: true, mainEnabled: true, adapter: adapter(name, service) };
}

export function createCrmManagementExecutionCommand(name: CrmCommandName, service: CrmManagementService): ExecutionCommandDefinition {
  const command = createCrmManagementCommandDefinition(name, service);
  return { name, version: command.version, testOnly: false, riskLevel: command.risk, confirmationTtlMs: command.confirmationExpiresInMs, maxAffectedRecords: 1, requiredPermissions: [command.requiredCapability],
    async buildPreview({ scope, arguments: raw }) {
      const input = crmCommandInputSchema.parse(raw); const validated = await service.revalidateProposal({ organizationId: scope.organizationId, crmIntakeSessionId: input.crmIntakeSessionId, expectedProposalFingerprint: input.proposalFingerprint }); if (!validated.valid) throw new ExecutionPlanError(validated.code, validated.summary);
      const proposal = crmCommandPreviewSchema.parse(validated.proposal);
      const commercialNotice = name === "customers.update_commercial_terms" ? " Existing quote, order, and invoice snapshots remain unchanged; future quotes and orders use the new settings." : "";
      const preview: ExecutionPlanPreview = { title: label(name), summary: `${proposal.summary}${commercialNotice}`, sideEffects: [...proposal.changes.map((change) => `${change.field}: ${String(change.before)} → ${String(change.after)}.`), ...proposal.warnings, "No quote, order, invoice, payment, production, or fulfillment records will be created or changed."], affectedRecords: [{ entityType: "assistant_crm_intake_session", entityId: proposal.crmIntakeSessionId, fingerprint: proposal.proposalFingerprint }], crmManagement: { commandName: name, crmIntakeSessionId: proposal.crmIntakeSessionId, proposalFingerprint: proposal.proposalFingerprint, changes: proposal.changes.map((c) => ({ field: c.field, before: c.before === undefined ? null : c.before as any, after: c.after === undefined ? null : c.after as any })), warnings: proposal.warnings, duplicateCandidates: proposal.duplicateCandidates, sourceLinks: proposal.sourceLinks } };
      return { arguments: input, preview };
    },
    async revalidate({ plan, scope }) { const input = crmCommandInputSchema.parse(plan.sanitizedArguments); const result = await service.revalidateProposal({ organizationId: scope.organizationId, crmIntakeSessionId: input.crmIntakeSessionId, expectedProposalFingerprint: input.proposalFingerprint }); const record = plan.affectedRecords[0]; return result.valid && record?.entityId === input.crmIntakeSessionId && record.fingerprint === input.proposalFingerprint ? { valid: true as const } : { valid: false as const, code: result.valid ? "CRM_PROPOSAL_CHANGED" : result.code, summary: result.valid ? "The CRM proposal changed." : result.summary }; },
    async execute({ plan, scope }): Promise<ExecutionCommandResult> { const result = await command.adapter.execute(crmCommandInputSchema.parse(plan.sanitizedArguments), { organizationId: scope.organizationId, actorUserId: scope.userId, planId: plan.id, idempotencyKey: plan.idempotencyKey, correlationId: plan.correlationId, signal: new AbortController().signal }); return { status: "succeeded", summary: `${label(name)} succeeded. Open: ${result.sourceLink}`, steps: [{ commandName: `${name}@v1`, status: "succeeded", summary: `${label(name)} succeeded.` }] }; },
  };
}
