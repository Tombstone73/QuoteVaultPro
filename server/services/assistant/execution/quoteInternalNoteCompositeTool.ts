import { and, eq, ilike } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../db";
import { quotes } from "@shared/schema";
import type { AssistantOperatorSemanticTool } from "../operatorToolExecutor";
import { DrizzleAssistantExecutionRepository } from "../../../storage/assistantExecution.repo";
import { DrizzleCompositeAssistantExecutionRepository } from "../../../storage/compositeAssistantExecution.repo";
import { CompositeExecutionPlanningService } from "./compositeExecutionPlanningService";
import { CompositeSemanticMutationPlanningService } from "./compositeSemanticMutationPlanningService";
import { ExecutionPlanningService } from "./executionPlanningService";
import { createQuoteInternalNoteExecutionCommand } from "./quoteInternalNoteExecutionCommand";
import { quoteInternalNotesService } from "../../quoteInternalNotesService";

const inputSchema = z.object({
  customerName: z.string().trim().min(2).max(160),
  noteText: z.string().trim().min(1).max(4_000),
}).strict();

export function createQuoteInternalNoteCompositeExecutionService() {
  const childPlans = new ExecutionPlanningService(new DrizzleAssistantExecutionRepository(), {
    get: (name) => name === "quotes.add_internal_note" ? createQuoteInternalNoteExecutionCommand(quoteInternalNotesService) : undefined,
    list: () => [createQuoteInternalNoteExecutionCommand(quoteInternalNotesService)],
  }, { allowProductionExecution: true });
  return new CompositeExecutionPlanningService(new DrizzleCompositeAssistantExecutionRepository(), childPlans);
}

/** Real semantic Operator capability. It accepts only business terms, performs
 * tenant-scoped quote discovery server-side, and compiles existing single-note
 * commands. It never accepts quote IDs, child command payloads, or GO tokens
 * from the model. */
export function createQuoteInternalNoteCompositeSemanticTool(
  composite: CompositeExecutionPlanningService = createQuoteInternalNoteCompositeExecutionService(),
): AssistantOperatorSemanticTool {
  return {
    name: "quotes.plan_internal_notes",
    description: "Prepare one confirmation to append the same internal-only staff note to eligible open quotes for a named customer. Arguments: customerName and noteText only. Never supplies quote IDs, command payloads, or GO tokens.",
    async execute({ arguments: raw, context }) {
      const input = inputSchema.safeParse(raw);
      if (!input.success) return { status: "rejected", warning: "Customer name and internal note text are required." };
      if (!context.permissions.includes("assistant.quotes.add_internal_note")) return { status: "permission_denied", warning: "You do not have permission to add internal quote notes." };
      const rows = await db.select({ id: quotes.id, displayNumber: quotes.displayNumber, quoteNumber: quotes.quoteNumber, customerName: quotes.customerName, status: quotes.status })
        .from(quotes).where(and(eq(quotes.organizationId, context.scope.organizationId), ilike(quotes.customerName, `%${input.data.customerName}%`))).limit(25);
      const targets = await Promise.all(rows.map(async (row) => {
        const reference = await quoteInternalNotesService.resolveQuoteReference({ organizationId: context.scope.organizationId, quoteId: row.id });
        const label = `Quote ${row.displayNumber ?? row.quoteNumber ?? row.id}${row.customerName ? ` — ${row.customerName}` : ""}`;
        return reference ? { entityType: "quote", entityId: row.id, label, fingerprint: reference.fingerprint, attributes: { status: row.status } } : null;
      }));
      const available = targets.filter((target): target is NonNullable<typeof target> => Boolean(target));
      if (available.length < 2) return { status: "partial", warning: "Fewer than two quotes were available for a composite confirmation.", result: { status: "partial", data: { requestedCustomer: input.data.customerName, eligibleCount: 0 }, provenance: { sourceLinks: [], freshness: { capturedAt: new Date().toISOString() } } } };
      const planner = new CompositeSemanticMutationPlanningService(composite, {
        compile: async ({ intent, target }) => target.attributes?.status === "active"
          ? { kind: "eligible" as const, operation: { commandName: "quotes.add_internal_note", arguments: { quoteId: target.entityId, noteText: intent.noteText }, summary: `Add an internal-only note to ${target.label}.` } }
          : { kind: "ineligible" as const, reason: `Quote is ${String(target.attributes?.status ?? "not open")}.` },
      });
      const prepared = await planner.prepare({ scope: { ...context.scope, permissions: context.permissions, environment: process.env.NODE_ENV ?? "development" }, conversationId: context.conversationId, context: context.context, correlationId: context.correlationId, intent: { noteText: input.data.noteText }, authorizedTargets: available });
      const confirmation = await composite.issueConfirmation({ ...context.scope, permissions: context.permissions, environment: process.env.NODE_ENV ?? "development" }, { planId: prepared.plan.id, expectedVersion: prepared.plan.version });
      const card = {
        kind: "action_plan" as const,
        title: `Add internal note to ${prepared.included.length} open quote${prepared.included.length === 1 ? "" : "s"}`,
        summary: `Add this internal-only note: “${input.data.noteText}”. ${prepared.excluded.length ? `${prepared.excluded.length} quote${prepared.excluded.length === 1 ? " was" : "s were"} excluded.` : ""} Partial execution is possible if a quote changes after approval.`,
        sourceLinks: prepared.included.map((item) => ({ label: item.label, href: `/quotes/${item.entityId}`, entityType: "quote" as const, entityId: item.entityId })),
        plan: {
          id: confirmation.plan.id, action: "quotes.add_internal_note", status: confirmation.plan.status, planVersion: confirmation.plan.version, riskLevel: "low", confirmationAvailable: true, confirmationToken: confirmation.token, expiresAt: confirmation.plan.expiresAt.toISOString(),
          preview: { title: `Add internal note to ${prepared.included.length} quote${prepared.included.length === 1 ? "" : "s"}`, summary: `Internal-only note: ${input.data.noteText}`, affectedEntities: prepared.included.map((item) => ({ entityType: item.entityType, entityId: item.entityId, label: item.label, sourceLink: { label: item.label, href: `/quotes/${item.entityId}`, entityType: "quote", entityId: item.entityId } })), sideEffects: prepared.included.map((item) => ({ label: "Append internal note", description: item.summary, affectedRecordCount: 1, reversible: false })), composite: { operationCount: prepared.included.length, excluded: prepared.excluded.map((item) => ({ label: item.label, reason: item.reason })), partialExecutionPossible: true } },
        },
      };
      return { status: "succeeded", result: { status: "succeeded", data: { requestedCustomer: input.data.customerName, eligibleCount: prepared.included.length, excludedCount: prepared.excluded.length, response: `I prepared one confirmation for ${prepared.included.length} eligible open quotes.` }, provenance: { sourceLinks: card.sourceLinks, freshness: { capturedAt: new Date().toISOString() } } }, presentation: { cards: [card] } };
    },
  };
}
