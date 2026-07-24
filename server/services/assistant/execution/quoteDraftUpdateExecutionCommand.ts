import { ExecutionPlanError } from "./types";
import type { ExecutionCommandDefinition, ExecutionCommandResult, ExecutionPlanPreview } from "./types";
import {
  createQuoteDraftUpdateCommandDefinition,
  quoteDraftUpdateCommandInputSchema,
  quoteDraftUpdateCommandName,
  type QuoteDraftUpdateCanonicalService,
  type QuoteDraftUpdatePreview,
} from "./quoteDraftUpdateCommand";

export interface QuoteDraftUpdateProposalValidation {
  valid: true;
  proposal: QuoteDraftUpdatePreview;
}

export interface QuoteDraftUpdatePlanningService extends QuoteDraftUpdateCanonicalService {
  revalidateUpdateProposal(input: {
    organizationId: string;
    quoteId: string;
    quoteIntakeSessionId: string;
    expectedProposalFingerprint: string;
    expectedQuoteFingerprint: string;
  }): Promise<QuoteDraftUpdateProposalValidation | { valid: false; code: string; summary: string }>;
}

/** Planning-only adapter for one stale-safe canonical editable-draft update. */
export function createQuoteDraftUpdateExecutionCommand(service: QuoteDraftUpdatePlanningService): ExecutionCommandDefinition {
  const command = createQuoteDraftUpdateCommandDefinition(service);
  return {
    name: command.name,
    version: command.version,
    testOnly: false,
    riskLevel: command.risk,
    confirmationTtlMs: command.confirmationExpiresInMs,
    maxAffectedRecords: command.maxAffectedRecords,
    requiredPermissions: [command.requiredCapability],
    async buildPreview({ scope, arguments: rawArguments }) {
      const input = quoteDraftUpdateCommandInputSchema.parse(rawArguments);
      const validation = await service.revalidateUpdateProposal({ organizationId: scope.organizationId, quoteId: input.quoteId, quoteIntakeSessionId: input.quoteIntakeSessionId, expectedProposalFingerprint: input.proposalFingerprint, expectedQuoteFingerprint: input.expectedQuoteFingerprint });
      if (!validation.valid) throw new ExecutionPlanError(validation.code, validation.summary);
      const proposal = validation.proposal;
      if (proposal.validationErrors.length) throw new ExecutionPlanError("QUOTE_PROPOSAL_INVALID", "The quote update has validation errors and cannot be confirmed.");
      const preview: ExecutionPlanPreview = {
        title: `Update draft Quote ${proposal.quote.displayNumber}`,
        summary: `Update one editable draft quote. No order, production job, inventory reservation, invoice, email, acceptance, or conversion will occur.`,
        sideEffects: [
          "Apply the server-validated quote changes and refresh canonical pricing and tax snapshots.",
          ...proposal.changes.map((change) => `${change.field}: ${change.before ?? "not set"} → ${change.after ?? "cleared"}.`),
        ],
        affectedRecords: [{ entityType: "quote", entityId: proposal.quote.id, fingerprint: proposal.expectedQuoteFingerprint }],
        quoteDraftUpdate: {
          quoteId: proposal.quote.id,
          quoteNumber: proposal.quote.displayNumber,
          quoteIntakeSessionId: proposal.quoteIntakeSessionId,
          proposalFingerprint: proposal.proposalFingerprint,
          totalCentsBefore: proposal.totalCentsBefore,
          totalCentsAfter: proposal.totalCentsAfter,
          validationErrors: proposal.validationErrors,
          warnings: proposal.warnings,
          downstreamActionsExcluded: proposal.downstreamActionsExcluded,
        },
      };
      return { arguments: { quoteId: proposal.quote.id, quoteIntakeSessionId: proposal.quoteIntakeSessionId, proposalFingerprint: proposal.proposalFingerprint, expectedQuoteFingerprint: proposal.expectedQuoteFingerprint, ...(input.proposalId ? { proposalId: input.proposalId } : {}) }, preview };
    },
    async revalidate({ plan, scope }) {
      const input = quoteDraftUpdateCommandInputSchema.parse(plan.sanitizedArguments);
      const record = plan.affectedRecords[0];
      const validation = await service.revalidateUpdateProposal({ organizationId: scope.organizationId, quoteId: input.quoteId, quoteIntakeSessionId: input.quoteIntakeSessionId, expectedProposalFingerprint: input.proposalFingerprint, expectedQuoteFingerprint: input.expectedQuoteFingerprint });
      if (!validation.valid || !record || record.entityId !== input.quoteId || record.fingerprint !== input.expectedQuoteFingerprint) {
        return { valid: false as const, code: validation.valid ? "QUOTE_CHANGED" : validation.code, summary: validation.valid ? "The quote changed after the preview." : validation.summary };
      }
      if (validation.proposal.validationErrors.length) return { valid: false as const, code: "QUOTE_PROPOSAL_INVALID", summary: "The quote update is no longer valid." };
      return { valid: true as const };
    },
    async execute({ plan, scope }): Promise<ExecutionCommandResult> {
      const input = quoteDraftUpdateCommandInputSchema.parse(plan.sanitizedArguments);
      const result = await command.adapter.execute(input, { organizationId: scope.organizationId, actorUserId: scope.userId, planId: plan.id, idempotencyKey: plan.idempotencyKey, correlationId: plan.correlationId, signal: new AbortController().signal });
      return {
        status: "succeeded",
        summary: `Draft quote ${result.quote.displayNumber} was updated. It has not been sent, accepted, converted, or routed to production.`,
        steps: [{ commandName: `${quoteDraftUpdateCommandName}@${command.version}`, status: "succeeded", summary: `Updated draft quote ${result.quote.displayNumber}.`, ...(result.domainAuditReference ? { domainAuditReference: result.domainAuditReference } : {}) }],
      };
    },
  };
}
