import type { Express, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import {
  assistantCancelExecutionPlanRequestSchema,
  assistantConfirmationRequestSchema,
  assistantCreateExecutionPlanRequestSchema,
  type AssistantExecutionPlan,
} from "@shared/assistantContracts";
import { getRequestOrganizationId } from "../tenantContext";
import { DrizzleAssistantExecutionRepository } from "../storage/assistantExecution.repo";
import { DrizzleAssistantRepository } from "../storage/assistant.repo";
import { ExecutionPlanError, ExecutionPlanningService } from "../services/assistant/execution";
import type { ExecutionActorScope, ExecutionPlanRecord } from "../services/assistant/execution/types";
import { createProductionAssistantCommandRegistry } from "../services/assistant/execution/commandRegistry";
import { createQuoteInternalNoteCommandDefinition } from "../services/assistant/execution/quoteInternalNoteCommand";
import { createQuoteInternalNoteExecutionCommand } from "../services/assistant/execution/quoteInternalNoteExecutionCommand";
import { quoteInternalNoteCommandName } from "../services/assistant/execution/quoteInternalNoteCommand";
import { resolveQuoteInternalNoteIntent } from "../services/assistant/execution/quoteInternalNoteIntent";
import { quoteInternalNotesService } from "../services/quoteInternalNotesService";

function userId(req: Request): string | null {
  const user = req.user as { id?: unknown; claims?: { sub?: unknown } } | undefined;
  const id = user?.claims?.sub ?? user?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function scope(req: Request): ExecutionActorScope {
  const id = userId(req);
  if (!id) throw new ExecutionPlanError("AUTH_REQUIRED", "Unauthorized.");
  const internal = ["owner", "admin", "manager", "member", "employee"].includes(String(req.orgRole ?? "").toLowerCase());
  return {
    organizationId: getRequestOrganizationId(req), userId: id,
    permissions: internal ? ["assistant.internal_staff", "catalog.read", "assistant.quotes.add_internal_note"] : [],
    environment: process.env.NODE_ENV || "development",
  };
}

function planDto(plan: ExecutionPlanRecord, executionStarted = false): AssistantExecutionPlan {
  const status = plan.status as AssistantExecutionPlan["status"];
  const cancellationAvailable = ["draft", "resolving", "awaiting_input", "preview_ready", "awaiting_confirmation", "confirmed"].includes(status);
  const quoteInternalNote = plan.preview.quoteInternalNote;
  return {
    id: plan.id, conversationId: plan.conversationId, turnId: plan.turnId ?? null, action: plan.normalizedAction,
    commandVersion: plan.commandVersion, status, riskLevel: plan.riskLevel as AssistantExecutionPlan["riskLevel"],
    planVersion: plan.version, contextVersion: "v1", preview: {
      title: plan.preview.title, summary: plan.preview.summary,
      affectedEntities: plan.affectedRecords.map((record) => ({
        entityType: record.entityType as any,
        entityId: record.entityId,
        label: quoteInternalNote?.quoteId === record.entityId ? `Quote ${quoteInternalNote.quoteNumber}` : `${record.entityType} ${record.entityId}`,
        ...(quoteInternalNote?.quoteId === record.entityId ? { sourceLink: quoteInternalNote.sourceLink } : {}),
      })),
      sideEffects: plan.preview.sideEffects.map((description) => ({ label: "Planned side effect", description, affectedRecordCount: plan.affectedRecords.length, reversible: false })),
      undo: { available: false, label: null, expiresAt: null },
      ...(quoteInternalNote ? { quoteInternalNote: { ...quoteInternalNote, unchanged: [...quoteInternalNote.unchanged] } } : {}),
    },
    missingInformation: (plan.preview.missingInformation ?? []).map((label) => ({ field: label, label, description: label })),
    // Execution state comes only from the server-created plan and its stored
    // confirmation. The browser never selects a command or makes a proposal
    // executable by itself.
    executable: status === "awaiting_confirmation", confirmationAvailable: status === "awaiting_confirmation", cancellationAvailable,
    expiresAt: plan.expiresAt.toISOString(), staleReason: plan.status === "invalidated" ? (plan.failureSummary ?? "Plan inputs changed.") : null,
    failureSummary: plan.failureSummary ?? null, steps: [], correlationId: plan.correlationId,
    createdAt: plan.createdAt.toISOString(), updatedAt: plan.updatedAt.toISOString(),
  };
}

function safeError(res: Response, error: unknown) {
  if (error instanceof ExecutionPlanError) {
    const notFound = error.code === "PLAN_NOT_FOUND";
    const code = notFound ? "plan_not_found" : error.code === "PLAN_EXPIRED" ? "confirmation_expired"
      : error.code === "PERMISSION_CHANGED" ? "plan_permission_changed"
        : error.code === "CONTEXT_CHANGED" ? "plan_stale" : "plan_transition_invalid";
    return res.status(notFound ? 404 : 409).json({ error: { code, message: notFound ? "Plan not found." : error.message, retryable: false } });
  }
  if (error instanceof z.ZodError) return res.status(400).json({ error: { code: "context_invalid", message: error.errors.map((issue) => issue.message).join("; "), retryable: false } });
  console.error("[Assistant execution] Route failed:", error);
  return res.status(500).json({ error: { code: "turn_failed", message: "Assistant execution request failed.", retryable: true } });
}

export interface AssistantExecutionRouteDependencies {
  service?: ExecutionPlanningService;
}

function createProductionExecutionService(): ExecutionPlanningService {
  const metadataRegistry = createProductionAssistantCommandRegistry(
    createQuoteInternalNoteCommandDefinition(quoteInternalNotesService),
  );
  const executionCommand = createQuoteInternalNoteExecutionCommand(quoteInternalNotesService);
  const executionRegistry = {
    get: (name: string) => metadataRegistry.has(name) ? executionCommand : undefined,
    list: () => metadataRegistry.list().map(() => executionCommand),
  };
  return new ExecutionPlanningService(
    new DrizzleAssistantExecutionRepository(),
    executionRegistry,
    { allowProductionExecution: true },
  );
}

export function registerAssistantExecutionRoutes(app: Express, middleware: { isAuthenticated: RequestHandler; tenantContext: RequestHandler }, dependencies: AssistantExecutionRouteDependencies = {}): void {
  const service = dependencies.service ?? createProductionExecutionService();
  const guarded = [middleware.isAuthenticated, middleware.tenantContext];

  app.post("/api/assistant/conversations/:conversationId/plans", ...guarded, async (req, res) => {
    try {
      const input = assistantCreateExecutionPlanRequestSchema.parse(req.body ?? {});
      if (!input.turnId) throw new ExecutionPlanError("PLAN_INPUT_REQUIRED", "A proposed assistant turn is required.");
      const actor = scope(req);
      // The proposal must come from a tenant/user-owned stored turn. The
      // browser supplies context only; it cannot provide a command, note text,
      // record selector, identity, permission, or confirmation token.
      const conversation = await new DrizzleAssistantRepository().getConversation({
        organizationId: actor.organizationId,
        userId: actor.userId,
        conversationId: req.params.conversationId,
      });
      const userMessage = conversation?.messages.find((message) => message.turnId === input.turnId && message.role === "user");
      if (!userMessage) throw new ExecutionPlanError("PLAN_PROPOSAL_NOT_FOUND", "The proposed action is no longer available.");
      const intent = resolveQuoteInternalNoteIntent(userMessage.content, input.context);
      if (intent.kind !== "resolved") throw new ExecutionPlanError("PLAN_CLARIFICATION_REQUIRED", "The quote note needs clarification before a plan can be created.");
      const resolved = await quoteInternalNotesService.resolveQuoteReference({
        organizationId: actor.organizationId,
        quoteId: intent.quoteId,
        expectedQuoteNumber: intent.expectedQuoteNumber,
      });
      if (!resolved) throw new ExecutionPlanError("QUOTE_NOT_FOUND", "Quote not found.");
      const plan = await service.createPlan(actor, {
        conversationId: req.params.conversationId,
        turnId: input.turnId,
        commandName: quoteInternalNoteCommandName,
        arguments: {
          quoteId: resolved.id,
          noteText: intent.noteText,
          ...(intent.expectedQuoteNumber ? { expectedQuoteNumber: intent.expectedQuoteNumber } : {}),
        },
        context: input.context,
      });
      const confirmation = await service.issueConfirmation(actor, plan.id, plan.version);
      return res.status(201).json({
        success: true,
        data: { plan: planDto(confirmation.plan), confirmationToken: confirmation.token },
      });
    } catch (error) { return safeError(res, error); }
  });

  app.get("/api/assistant/plans/:planId", ...guarded, async (req, res) => {
    try { return res.json({ success: true, data: planDto(await service.getPlan(scope(req), req.params.planId)) }); }
    catch (error) { return safeError(res, error); }
  });
  app.get("/api/assistant/plans/:planId/status", ...guarded, async (req, res) => {
    try { return res.json({ success: true, data: planDto(await service.getPlan(scope(req), req.params.planId)) }); }
    catch (error) { return safeError(res, error); }
  });
  app.post("/api/assistant/plans/:planId/cancel", ...guarded, async (req, res) => {
    try {
      const input = assistantCancelExecutionPlanRequestSchema.parse(req.body ?? {});
      return res.json({ success: true, data: planDto(await service.cancelPlan(scope(req), req.params.planId, input.expectedPlanVersion)) });
    } catch (error) { return safeError(res, error); }
  });
  const confirm = async (req: Request, res: Response) => {
    try {
      const input = assistantConfirmationRequestSchema.parse(req.body ?? {});
      const result = await service.confirmAndExecute(scope(req), { planId: req.params.planId, expectedVersion: input.expectedPlanVersion, token: input.confirmationToken, context: input.context });
      return res.json({ success: true, data: { plan: planDto(result.plan, Boolean(result.result)), accepted: true, executionStarted: Boolean(result.result) } });
    } catch (error) { return safeError(res, error); }
  };
  app.post("/api/assistant/plans/:planId/confirmations", ...guarded, confirm);
  // Retain the Stage 3 singular endpoint as a safe compatibility alias.
  app.post("/api/assistant/plans/:planId/confirmation", ...guarded, confirm);
}
