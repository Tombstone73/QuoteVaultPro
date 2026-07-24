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
import type { ExecutionActorScope, ExecutionCommandDefinition, ExecutionPlanRecord } from "../services/assistant/execution/types";
import { createProductionAssistantCommandRegistry } from "../services/assistant/execution/commandRegistry";
import { createQuoteInternalNoteCommandDefinition } from "../services/assistant/execution/quoteInternalNoteCommand";
import { createQuoteInternalNoteExecutionCommand } from "../services/assistant/execution/quoteInternalNoteExecutionCommand";
import { quoteInternalNoteCommandName } from "../services/assistant/execution/quoteInternalNoteCommand";
import { resolveQuoteInternalNoteIntent } from "../services/assistant/execution/quoteInternalNoteIntent";
import { quoteInternalNotesService } from "../services/quoteInternalNotesService";
import { createProductInactiveDraftCommandDefinition } from "../services/assistant/execution/productInactiveDraftCommand";
import { createProductInactiveDraftCanonicalService, createProductInactiveDraftExecutionCommand } from "../services/assistant/execution/productInactiveDraftExecutionCommand";
import { productInactiveDraftCommandName } from "../services/assistant/execution/productInactiveDraftCommand";
import { createProductInactiveDraftUpdateCommandDefinition, productInactiveDraftUpdateCommandName } from "../services/assistant/execution/productInactiveDraftUpdateCommand";
import { createProductInactiveDraftUpdateCanonicalService, createProductInactiveDraftUpdateExecutionCommand } from "../services/assistant/execution/productInactiveDraftUpdateExecutionCommand";
import { createQuoteDraftCreateCommandDefinition, quoteDraftCreateCommandName } from "../services/assistant/execution/quoteDraftCreateCommand";
import { createQuoteDraftCreateExecutionCommand } from "../services/assistant/execution/quoteDraftCreateExecutionCommand";
import { createQuoteDraftUpdateCommandDefinition, quoteDraftUpdateCommandName } from "../services/assistant/execution/quoteDraftUpdateCommand";
import { createQuoteDraftUpdateExecutionCommand } from "../services/assistant/execution/quoteDraftUpdateExecutionCommand";
import { quoteDraftIntakeService } from "../services/assistant/quoteDraftIntakeService";

function userId(req: Request): string | null {
  const user = req.user as { id?: unknown; claims?: { sub?: unknown } } | undefined;
  const id = user?.claims?.sub ?? user?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function scope(req: Request): ExecutionActorScope {
  const id = userId(req);
  if (!id) throw new ExecutionPlanError("AUTH_REQUIRED", "Unauthorized.");
  const role = String(req.orgRole ?? "").toLowerCase();
  const internal = ["owner", "admin", "manager", "member", "employee"].includes(role);
  return {
    organizationId: getRequestOrganizationId(req), userId: id,
    permissions: internal ? ["assistant.internal_staff", "catalog.read", "assistant.quotes.add_internal_note", "assistant.quotes.create_draft", "assistant.quotes.update_draft", ...(role === "owner" || role === "admin" ? ["assistant.products.create_inactive_draft", "assistant.products.update_inactive_draft"] : [])] : [],
    environment: process.env.NODE_ENV || "development",
  };
}

function planDto(plan: ExecutionPlanRecord, executionStarted = false): AssistantExecutionPlan {
  const status = plan.status as AssistantExecutionPlan["status"];
  const cancellationAvailable = ["draft", "resolving", "awaiting_input", "preview_ready", "awaiting_confirmation", "confirmed"].includes(status);
  const quoteInternalNote = plan.preview.quoteInternalNote;
  const productInactiveDraft = plan.preview.productInactiveDraft;
  const productInactiveDraftUpdate = plan.preview.productInactiveDraftUpdate;
  return {
    id: plan.id, conversationId: plan.conversationId, turnId: plan.turnId ?? null, action: plan.normalizedAction,
    commandVersion: plan.commandVersion, status, riskLevel: plan.riskLevel as AssistantExecutionPlan["riskLevel"],
    planVersion: plan.version, contextVersion: "v1", preview: {
      title: plan.preview.title, summary: plan.preview.summary,
      affectedEntities: plan.affectedRecords.map((record) => ({
        entityType: record.entityType as any,
        entityId: record.entityId,
        label: quoteInternalNote?.quoteId === record.entityId ? `Quote ${quoteInternalNote.quoteNumber}` : productInactiveDraft?.intakeSessionId === record.entityId ? `Product Intake: ${productInactiveDraft.productName}` : productInactiveDraftUpdate?.productId === record.entityId ? `Inactive draft: ${productInactiveDraftUpdate.productName}` : `${record.entityType} ${record.entityId}`,
        ...(quoteInternalNote?.quoteId === record.entityId ? { sourceLink: quoteInternalNote.sourceLink } : productInactiveDraft?.intakeSessionId === record.entityId ? { sourceLink: productInactiveDraft.sourceLink } : productInactiveDraftUpdate?.productId === record.entityId ? { sourceLink: { label: "Open inactive draft", href: productInactiveDraftUpdate.editorLink, entityType: "product" as const, entityId: productInactiveDraftUpdate.productId } } : {}),
      })),
      sideEffects: plan.preview.sideEffects.map((description) => ({ label: "Planned side effect", description, affectedRecordCount: plan.affectedRecords.length, reversible: false })),
      undo: { available: false, label: null, expiresAt: null },
      ...(quoteInternalNote ? { quoteInternalNote: { ...quoteInternalNote, unchanged: [...quoteInternalNote.unchanged] } } : {}),
      ...(productInactiveDraft ? { productInactiveDraft: { ...productInactiveDraft, warnings: [...productInactiveDraft.warnings], unchanged: [...productInactiveDraft.unchanged] } } : {}),
      ...(productInactiveDraftUpdate ? { productInactiveDraftUpdate: { ...productInactiveDraftUpdate, changes: productInactiveDraftUpdate.changes.map((change) => ({ ...change })), warnings: [...productInactiveDraftUpdate.warnings], validationErrors: [...productInactiveDraftUpdate.validationErrors], unchanged: [...productInactiveDraftUpdate.unchanged] } } : {}),
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
  const productService = createProductInactiveDraftCanonicalService();
  const productUpdateService = createProductInactiveDraftUpdateCanonicalService();
  const metadataRegistry = createProductionAssistantCommandRegistry(
    createQuoteInternalNoteCommandDefinition(quoteInternalNotesService),
    createProductInactiveDraftCommandDefinition(productService),
    createProductInactiveDraftUpdateCommandDefinition(productUpdateService),
    createQuoteDraftCreateCommandDefinition(quoteDraftIntakeService),
    createQuoteDraftUpdateCommandDefinition(quoteDraftIntakeService),
  );
  const executionCommands = new Map<string, ExecutionCommandDefinition>([
    [quoteInternalNoteCommandName, createQuoteInternalNoteExecutionCommand(quoteInternalNotesService)],
    [productInactiveDraftCommandName, createProductInactiveDraftExecutionCommand(productService)],
    [productInactiveDraftUpdateCommandName, createProductInactiveDraftUpdateExecutionCommand(productUpdateService)],
    [quoteDraftCreateCommandName, createQuoteDraftCreateExecutionCommand(quoteDraftIntakeService)],
    [quoteDraftUpdateCommandName, createQuoteDraftUpdateExecutionCommand(quoteDraftIntakeService)],
  ]);
  const executionRegistry = {
    get: (name: string) => metadataRegistry.has(name) ? executionCommands.get(name) : undefined,
    list: () => metadataRegistry.list().flatMap((command) => {
      const execution = executionCommands.get(command.name);
      return execution ? [execution] : [];
    }),
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
      const assistantMessage = conversation?.messages.find((message) => message.turnId === input.turnId && message.role === "assistant");
      if (!userMessage || !assistantMessage) throw new ExecutionPlanError("PLAN_PROPOSAL_NOT_FOUND", "The proposed action is no longer available.");
      const productProposal = Array.isArray(assistantMessage.structuredCards)
        ? (assistantMessage.structuredCards as any[]).find((card: any) => card?.kind === "action_proposal" && card?.plan?.action === productInactiveDraftCommandName)?.plan
        : null;
      const productUpdateProposal = Array.isArray(assistantMessage.structuredCards)
        ? (assistantMessage.structuredCards as any[]).find((card: any) => card?.kind === "action_proposal" && card?.plan?.action === productInactiveDraftUpdateCommandName)?.plan
        : null;
      const quoteDraftCreateProposal = Array.isArray(assistantMessage.structuredCards)
        ? (assistantMessage.structuredCards as any[]).find((card: any) => card?.kind === "action_proposal" && card?.plan?.action === quoteDraftCreateCommandName)?.plan
        : null;
      const quoteDraftUpdateProposal = Array.isArray(assistantMessage.structuredCards)
        ? (assistantMessage.structuredCards as any[]).find((card: any) => card?.kind === "action_proposal" && card?.plan?.action === quoteDraftUpdateCommandName)?.plan
        : null;
      if (quoteDraftUpdateProposal && typeof quoteDraftUpdateProposal.quoteId === "string" && typeof quoteDraftUpdateProposal.quoteIntakeSessionId === "string" && typeof quoteDraftUpdateProposal.proposalFingerprint === "string" && typeof quoteDraftUpdateProposal.expectedQuoteFingerprint === "string") {
        const plan = await service.createPlan(actor, { conversationId: req.params.conversationId, turnId: input.turnId, commandName: quoteDraftUpdateCommandName, arguments: { quoteId: quoteDraftUpdateProposal.quoteId, quoteIntakeSessionId: quoteDraftUpdateProposal.quoteIntakeSessionId, proposalFingerprint: quoteDraftUpdateProposal.proposalFingerprint, expectedQuoteFingerprint: quoteDraftUpdateProposal.expectedQuoteFingerprint }, context: input.context });
        const confirmation = await service.issueConfirmation(actor, plan.id, plan.version);
        return res.status(201).json({ success: true, data: { plan: planDto(confirmation.plan), confirmationToken: confirmation.token } });
      }
      if (quoteDraftCreateProposal && typeof quoteDraftCreateProposal.quoteIntakeSessionId === "string" && typeof quoteDraftCreateProposal.proposalFingerprint === "string") {
        const plan = await service.createPlan(actor, { conversationId: req.params.conversationId, turnId: input.turnId, commandName: quoteDraftCreateCommandName, arguments: { quoteIntakeSessionId: quoteDraftCreateProposal.quoteIntakeSessionId, proposalFingerprint: quoteDraftCreateProposal.proposalFingerprint }, context: input.context });
        const confirmation = await service.issueConfirmation(actor, plan.id, plan.version);
        return res.status(201).json({ success: true, data: { plan: planDto(confirmation.plan), confirmationToken: confirmation.token } });
      }
      if (productUpdateProposal && typeof productUpdateProposal.productIntakeSessionId === "string" && typeof productUpdateProposal.proposalFingerprint === "string" && productUpdateProposal.patch && typeof productUpdateProposal.patch === "object") {
        const plan = await service.createPlan(actor, { conversationId: req.params.conversationId, turnId: input.turnId, commandName: productInactiveDraftUpdateCommandName, arguments: { productIntakeSessionId: productUpdateProposal.productIntakeSessionId, proposalFingerprint: productUpdateProposal.proposalFingerprint, patch: productUpdateProposal.patch }, context: input.context });
        const confirmation = await service.issueConfirmation(actor, plan.id, plan.version);
        return res.status(201).json({ success: true, data: { plan: planDto(confirmation.plan), confirmationToken: confirmation.token } });
      }
      if (productProposal && typeof productProposal.intakeSessionId === "string" && typeof productProposal.proposalFingerprint === "string") {
        const plan = await service.createPlan(actor, {
          conversationId: req.params.conversationId,
          turnId: input.turnId,
          commandName: productInactiveDraftCommandName,
          arguments: { intakeSessionId: productProposal.intakeSessionId, proposalFingerprint: productProposal.proposalFingerprint },
          context: input.context,
        });
        const confirmation = await service.issueConfirmation(actor, plan.id, plan.version);
        return res.status(201).json({ success: true, data: { plan: planDto(confirmation.plan), confirmationToken: confirmation.token } });
      }
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
      return res.json({ success: true, data: { plan: planDto(result.plan, Boolean(result.result)), result: result.result ?? null, accepted: true, executionStarted: Boolean(result.result) } });
    } catch (error) { return safeError(res, error); }
  };
  app.post("/api/assistant/plans/:planId/confirmations", ...guarded, confirm);
  // Retain the Stage 3 singular endpoint as a safe compatibility alias.
  app.post("/api/assistant/plans/:planId/confirmation", ...guarded, confirm);
}
