import { ExecutionPlanError } from "./types";
import type { ExecutionCommandDefinition, ExecutionCommandResult, ExecutionPlanPreview } from "./types";
import {
  createQuoteInternalNoteCommandDefinition,
  quoteInternalNoteCommandInputSchema,
  quoteInternalNoteCommandName,
  type QuoteInternalNoteCanonicalService,
} from "./quoteInternalNoteCommand";

export interface QuoteInternalNotePlanningService extends QuoteInternalNoteCanonicalService {
  resolveQuoteReference(args: { organizationId: string; quoteId?: string; expectedQuoteNumber?: string }): Promise<{
    id: string;
    displayNumber: string | null;
    quoteNumber: number | null;
    customerName: string | null;
    fingerprint: string;
  } | null>;
}

const unchanged = ["pricing", "quote status", "customer-facing notes", "order state", "production", "invoice", "payment"] as const;

function displayNumber(reference: { displayNumber: string | null; quoteNumber: number | null }): string | null {
  return reference.displayNumber ?? (reference.quoteNumber === null ? null : String(reference.quoteNumber));
}

function expectedNumberMatches(expected: string | undefined, reference: { displayNumber: string | null; quoteNumber: number | null }) {
  return !expected || expected === reference.displayNumber || expected === String(reference.quoteNumber ?? "");
}

/** Bridges the reviewed command metadata to Stage 3's execution interface.
 * It owns no persistence; the only write remains the injected canonical
 * quote-note service called through the command adapter. */
export function createQuoteInternalNoteExecutionCommand(service: QuoteInternalNotePlanningService): ExecutionCommandDefinition {
  const command = createQuoteInternalNoteCommandDefinition(service);
  return {
    name: command.name,
    version: command.version,
    testOnly: false,
    riskLevel: command.risk,
    confirmationTtlMs: command.confirmationExpiresInMs,
    maxAffectedRecords: command.maxAffectedRecords,
    requiredPermissions: [command.requiredCapability],
    async buildPreview({ scope, arguments: rawArguments }) {
      const input = quoteInternalNoteCommandInputSchema.parse(rawArguments);
      const reference = await service.resolveQuoteReference({
        organizationId: scope.organizationId,
        quoteId: input.quoteId,
        expectedQuoteNumber: input.expectedQuoteNumber,
      });
      const number = reference ? displayNumber(reference) : null;
      if (!reference || !number || !expectedNumberMatches(input.expectedQuoteNumber, reference)) {
        throw new ExecutionPlanError("QUOTE_NOT_FOUND", "Quote not found.");
      }
      const preview: ExecutionPlanPreview = {
        title: `Add internal note to Quote ${number}`,
        summary: `Add this internal-only note to Quote ${number}. No pricing, customer-facing text, status, or downstream operational data will change.`,
        sideEffects: ["Append one internal-only staff note."],
        affectedRecords: [{ entityType: "quote", entityId: reference.id, fingerprint: reference.fingerprint }],
        quoteInternalNote: {
          quoteId: reference.id,
          quoteNumber: number,
          customerName: reference.customerName,
          noteText: input.noteText,
          sourceLink: { label: `Quote ${number}`, href: `/quotes/${reference.id}`, entityType: "quote", entityId: reference.id },
          unchanged,
        },
      };
      return { arguments: { quoteId: reference.id, noteText: input.noteText, ...(input.expectedQuoteNumber ? { expectedQuoteNumber: input.expectedQuoteNumber } : {}) }, preview };
    },
    async revalidate({ plan, scope }) {
      const input = quoteInternalNoteCommandInputSchema.parse(plan.sanitizedArguments);
      const record = plan.affectedRecords[0];
      const reference = await service.resolveQuoteReference({ organizationId: scope.organizationId, quoteId: input.quoteId });
      if (!reference || !record || reference.id !== record.entityId || reference.fingerprint !== record.fingerprint || !expectedNumberMatches(input.expectedQuoteNumber, reference)) {
        return { valid: false, code: "QUOTE_STALE", summary: "The quote changed or is no longer available." };
      }
      return { valid: true };
    },
    async execute({ plan, scope }): Promise<ExecutionCommandResult> {
      const input = quoteInternalNoteCommandInputSchema.parse(plan.sanitizedArguments);
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
        summary: `Internal note added to Quote ${result.quote.displayNumber}.`,
        steps: [{
          commandName: `${quoteInternalNoteCommandName}@${command.version}`,
          status: "succeeded",
          summary: `Internal-only note ${result.note.id} added to Quote ${result.quote.displayNumber}.`,
          domainAuditReference: result.domainAuditReference,
        }],
      };
    },
  };
}
