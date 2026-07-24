import { ExecutionPlanError } from "./types";
import type { ExecutionCommandDefinition, ExecutionCommandResult, ExecutionPlanPreview } from "./types";
import {
  createQuoteDraftCreateCommandDefinition,
  quoteDraftCreateCommandInputSchema,
  quoteDraftCreateCommandName,
  type QuoteDraftCreateCanonicalService,
} from "./quoteDraftCreateCommand";

/** Deliberately narrow structural view of a service-owned full proposal. */
export interface QuoteDraftCreatePlanningProposal {
  quoteIntakeSessionId: string;
  proposalFingerprint: string;
  customerName: string;
  contactName: string | null;
  totalCents: number;
  lineItems: readonly { productName: string; quantity: number; dimensions: { width: number; height: number; unit: string } | null; totalCents: number }[];
  validationErrors: readonly string[];
  warnings: readonly string[];
  downstreamActionsExcluded: readonly string[];
}

export interface QuoteDraftCreateProposalValidation {
  valid: true;
  proposal: QuoteDraftCreatePlanningProposal;
}

export interface QuoteDraftCreatePlanningService extends QuoteDraftCreateCanonicalService {
  revalidateCreateProposal(input: {
    organizationId: string;
    quoteIntakeSessionId: string;
    expectedProposalFingerprint: string;
  }): Promise<QuoteDraftCreateProposalValidation | { valid: false; code: string; summary: string }>;
}

/**
 * Planning bridge only. The injected service owns persisted intake lookup,
 * customer/product ownership checks, PBV2 pricing, taxes, and actual quote
 * creation; this layer never imports a route, repository, or database handle.
 */
export function createQuoteDraftCreateExecutionCommand(service: QuoteDraftCreatePlanningService): ExecutionCommandDefinition {
  const command = createQuoteDraftCreateCommandDefinition(service);
  return {
    name: command.name,
    version: command.version,
    testOnly: false,
    riskLevel: command.risk,
    confirmationTtlMs: command.confirmationExpiresInMs,
    maxAffectedRecords: command.maxAffectedRecords,
    requiredPermissions: [command.requiredCapability],
    async buildPreview({ scope, arguments: rawArguments }) {
      const input = quoteDraftCreateCommandInputSchema.parse(rawArguments);
      const validation = await service.revalidateCreateProposal({
        organizationId: scope.organizationId,
        quoteIntakeSessionId: input.quoteIntakeSessionId,
        expectedProposalFingerprint: input.proposalFingerprint,
      });
      if (!validation.valid) throw new ExecutionPlanError(validation.code, validation.summary);
      const proposal = validation.proposal;
      if (proposal.validationErrors.length) throw new ExecutionPlanError("QUOTE_PROPOSAL_INVALID", "The quote proposal has validation errors and cannot be confirmed.");
      const preview: ExecutionPlanPreview = {
        title: `Create draft quote for ${proposal.customerName}`,
        summary: `Create one draft quote for ${proposal.customerName}. No order, production job, inventory reservation, invoice, email, acceptance, or conversion will occur.`,
        sideEffects: [
          `Create exactly one draft quote totaling $${(proposal.totalCents / 100).toFixed(2)} with server-validated tax and pricing snapshots.`,
          ...proposal.lineItems.map((line) => `${line.quantity} × ${line.productName}${line.dimensions ? ` (${line.dimensions.width} × ${line.dimensions.height} ${line.dimensions.unit})` : ""}: $${(line.totalCents / 100).toFixed(2)}.`),
        ],
        affectedRecords: [{ entityType: "quote_intake_session", entityId: proposal.quoteIntakeSessionId, fingerprint: proposal.proposalFingerprint }],
        quoteDraftCreate: {
          quoteIntakeSessionId: proposal.quoteIntakeSessionId,
          proposalFingerprint: proposal.proposalFingerprint,
          customerName: proposal.customerName,
          contactName: proposal.contactName,
          totalCents: proposal.totalCents,
          validationErrors: proposal.validationErrors,
          warnings: proposal.warnings,
          downstreamActionsExcluded: proposal.downstreamActionsExcluded,
        },
      };
      return {
        arguments: {
          quoteIntakeSessionId: proposal.quoteIntakeSessionId,
          proposalFingerprint: proposal.proposalFingerprint,
          ...(input.proposalId ? { proposalId: input.proposalId } : {}),
        },
        preview,
      };
    },
    async revalidate({ plan, scope }) {
      const input = quoteDraftCreateCommandInputSchema.parse(plan.sanitizedArguments);
      const record = plan.affectedRecords[0];
      const validation = await service.revalidateCreateProposal({ organizationId: scope.organizationId, quoteIntakeSessionId: input.quoteIntakeSessionId, expectedProposalFingerprint: input.proposalFingerprint });
      if (!validation.valid || !record || record.entityId !== input.quoteIntakeSessionId || record.fingerprint !== input.proposalFingerprint) {
        return { valid: false as const, code: validation.valid ? "QUOTE_PROPOSAL_CHANGED" : validation.code, summary: validation.valid ? "The quote proposal changed." : validation.summary };
      }
      if (validation.proposal.validationErrors.length) return { valid: false as const, code: "QUOTE_PROPOSAL_INVALID", summary: "The quote proposal is no longer valid." };
      return { valid: true as const };
    },
    async execute({ plan, scope }): Promise<ExecutionCommandResult> {
      const input = quoteDraftCreateCommandInputSchema.parse(plan.sanitizedArguments);
      const result = await command.adapter.execute(input, {
        organizationId: scope.organizationId,
        actorUserId: scope.userId,
        planId: plan.id,
        idempotencyKey: plan.idempotencyKey,
        correlationId: plan.correlationId,
        signal: new AbortController().signal,
      });
      return {
        status: "succeeded",
        summary: `Draft quote ${result.quote.displayNumber} was created. It has not been sent, accepted, converted, or routed to production.`,
        steps: [{ commandName: `${quoteDraftCreateCommandName}@${command.version}`, status: "succeeded", summary: `Created draft quote ${result.quote.displayNumber}.`, ...(result.domainAuditReference ? { domainAuditReference: result.domainAuditReference } : {}) }],
      };
    },
  };
}
