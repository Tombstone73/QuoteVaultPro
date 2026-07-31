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
import { createProductInactiveDraftBatchCommandDefinition, productInactiveDraftBatchCommandName } from "../services/assistant/execution/productInactiveDraftBatchCommand";
import { createProductInactiveDraftBatchCanonicalService, createProductInactiveDraftBatchExecutionCommand } from "../services/assistant/execution/productInactiveDraftBatchExecutionCommand";
import { createProductInactiveDraftUpdateCommandDefinition, productInactiveDraftUpdateCommandName } from "../services/assistant/execution/productInactiveDraftUpdateCommand";
import { createProductInactiveDraftUpdateCanonicalService, createProductInactiveDraftUpdateExecutionCommand } from "../services/assistant/execution/productInactiveDraftUpdateExecutionCommand";
import { createProductInactiveDraftBulkUpdateCommandDefinition, productInactiveDraftBulkUpdateCommandName } from "../services/assistant/execution/productInactiveDraftBulkUpdateCommand";
import { createProductInactiveDraftBulkUpdateCanonicalService, createProductInactiveDraftBulkUpdateExecutionCommand } from "../services/assistant/execution/productInactiveDraftBulkUpdateExecutionCommand";
import { productInactiveDraftBulkUpdateHistoryService } from "../services/assistant/productInactiveDraftBulkUpdateHistoryService";
import { createProductPricingChangeSetCommandDefinition, createProductPricingRollbackCommandDefinition, productPricingChangeSetCommandName, productPricingRollbackCommandName } from "../services/assistant/execution/productPricingChangeSetCommand";
import { createProductPricingChangeSetExecutionCommand, createProductPricingRollbackExecutionCommand } from "../services/assistant/execution/productPricingChangeSetExecutionCommand";
import { productPricingChangeSetCommandService } from "../services/assistant/execution/productPricingChangeSetAdapter";
import { productPricingChangeSetStore } from "../services/assistant/productPricingChangeSetDb";
import { configurableProductDraftCommandName, createConfigurableProductDraftCommandDefinition } from "../services/assistant/execution/configurableProductDraftCommand";
import { createConfigurableProductDraftExecutionCommand } from "../services/assistant/execution/configurableProductDraftExecutionCommand";
import { cloneInactiveProductDraftCommandName, createCloneInactiveProductDraftCommandDefinition } from "../services/assistant/execution/cloneInactiveProductDraftCommand";
import { createCloneInactiveProductDraftExecutionCommand } from "../services/assistant/execution/cloneInactiveProductDraftExecutionCommand";
import { createInactivePbv2PricingMatrixEditCommandDefinition, inactivePbv2PricingMatrixEditCommandName } from "../services/assistant/execution/inactivePbv2PricingMatrixEditCommand";
import { createInactivePbv2PricingMatrixEditExecutionCommand } from "../services/assistant/execution/inactivePbv2PricingMatrixEditExecutionCommand";
import { createInactivePbv2QuantityTierEditCommandDefinition, inactivePbv2QuantityTierEditCommandName } from "../services/assistant/execution/inactivePbv2QuantityTierEditCommand";
import { createInactivePbv2QuantityTierEditExecutionCommand } from "../services/assistant/execution/inactivePbv2QuantityTierEditExecutionCommand";
import { createQuoteDraftCreateCommandDefinition, quoteDraftCreateCommandName } from "../services/assistant/execution/quoteDraftCreateCommand";
import { createQuoteDraftCreateExecutionCommand } from "../services/assistant/execution/quoteDraftCreateExecutionCommand";
import { createQuoteDraftUpdateCommandDefinition, quoteDraftUpdateCommandName } from "../services/assistant/execution/quoteDraftUpdateCommand";
import { createQuoteDraftUpdateExecutionCommand } from "../services/assistant/execution/quoteDraftUpdateExecutionCommand";
import { quoteDraftIntakeService } from "../services/assistant/quoteDraftIntakeService";
import { orderIntakeService } from "../services/assistant/orderIntakeService";
import { assistantOrderCreateCommandName, assistantOrderUpdateEditableCommandName, assistantQuoteConvertOrderCommandName, createDeferredOrderCommandDefinition, createDeferredOrderExecutionCommand, createEditableOrderUpdateCommandDefinition, createQuoteConvertOrderCommandDefinition } from "../services/assistant/execution/deferredOrderCommands";
import { createCrmManagementCommandDefinition, createCrmManagementExecutionCommand } from "../services/assistant/execution/crmManagementCommands";
import { crmCommandNames, crmManagementService } from "../services/assistant/crmManagementService";
import { createProductionOperationCommandDefinition, createProductionOperationExecutionCommand } from "../services/assistant/execution/productionOperationsCommands";
import { productionOperationCommandNames, productionOperationsService } from "../services/assistant/productionOperationsService";
import { createFulfillmentOperationCommandDefinition, createFulfillmentOperationExecutionCommand } from "../services/assistant/execution/fulfillmentOperationsCommands";
import { fulfillmentOperationCommandNames, fulfillmentOperationsService } from "../services/assistant/fulfillmentOperationsService";
import { billingInvoiceOperationCommandNames, billingInvoiceOperationsService } from "../services/assistant/billingInvoiceOperationsService";
import { createBillingInvoiceOperationCommandDefinition, createBillingInvoiceOperationExecutionCommand } from "../services/assistant/execution/billingInvoiceOperationsCommands";
import { paymentOperationCommandNames, paymentOperationsService } from "../services/assistant/paymentOperationsService";
import { createPaymentOperationCommandDefinition, createPaymentOperationExecutionCommand } from "../services/assistant/execution/paymentOperationsCommands";

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
    permissions: internal ? ["assistant.internal_staff", "catalog.read", "assistant.quotes.add_internal_note", "assistant.quotes.create_draft", "assistant.quotes.update_draft", "assistant.orders.create", "assistant.orders.update_editable", "assistant.quotes.convert_to_order", "assistant.customers.create", "assistant.customers.update_profile", "assistant.customers.update_commercial_terms", "assistant.contacts.create", "assistant.contacts.update", "assistant.production.intake_line_items", "assistant.production.send_to_prepress", "assistant.production.update_job_status", "assistant.production.add_job_note", "assistant.fulfillment.create_shipment", "assistant.fulfillment.update_shipment_details", "assistant.fulfillment.mark_shipped", "assistant.fulfillment.create_pickup_ticket", "assistant.fulfillment.add_note", "assistant.billing.create_invoice", "assistant.billing.update_invoice_draft", "assistant.billing.send_invoice", "assistant.billing.add_invoice_note", "assistant.payments.record_manual_payment", "assistant.payments.add_payment_note", ...(role === "owner" || role === "admin" ? ["assistant.products.create_inactive_draft", "assistant.products.create_inactive_draft_batch", "assistant.products.update_inactive_draft", "assistant.products.update_inactive_draft_batch", "assistant.products.adjust_pricing", "assistant.products.clone_to_inactive_draft", "assistant.products.replace_inactive_matrix", "assistant.products.replace_inactive_quantity_tiers"] : [])] : [],
    environment: process.env.NODE_ENV || "development",
  };
}

function planDto(plan: ExecutionPlanRecord, executionStarted = false): AssistantExecutionPlan {
  const status = plan.status as AssistantExecutionPlan["status"];
  const cancellationAvailable = ["draft", "resolving", "awaiting_input", "preview_ready", "awaiting_confirmation", "confirmed"].includes(status);
  const quoteInternalNote = plan.preview.quoteInternalNote;
  const productInactiveDraft = plan.preview.productInactiveDraft;
  const productInactiveDraftUpdate = plan.preview.productInactiveDraftUpdate;
  const productPricingChangeSet = plan.preview.productPricingChangeSet;
  const configurableProduct = plan.preview.configurableProduct;
  const cloneInactiveDraft = plan.preview.cloneInactiveDraft;
  const inactivePbv2MatrixEdit = plan.preview.inactivePbv2MatrixEdit;
  const inactivePbv2TierEdit = plan.preview.inactivePbv2TierEdit;
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
      ...(productPricingChangeSet ? { productPricingChangeSet: { ...productPricingChangeSet, excluded: productPricingChangeSet.excluded.map((row) => ({ ...row })), rows: productPricingChangeSet.rows.map((row) => ({ ...row, before: { ...row.before }, after: { ...row.after } })), unchanged: [...productPricingChangeSet.unchanged] } } : {}),
      ...(configurableProduct ? { configurableProduct } : {}),
      ...(cloneInactiveDraft ? { cloneInactiveDraft } : {}),
      ...(inactivePbv2MatrixEdit ? { inactivePbv2MatrixEdit } : {}),
      ...(inactivePbv2TierEdit ? { inactivePbv2TierEdit } : {}),
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
  const productBatchService = createProductInactiveDraftBatchCanonicalService(productService);
  const productUpdateService = createProductInactiveDraftUpdateCanonicalService();
  const productBulkUpdateService = createProductInactiveDraftBulkUpdateCanonicalService(productUpdateService, productInactiveDraftBulkUpdateHistoryService);
  const metadataRegistry = createProductionAssistantCommandRegistry(
    createQuoteInternalNoteCommandDefinition(quoteInternalNotesService),
    createProductInactiveDraftCommandDefinition(productService),
    createProductInactiveDraftBatchCommandDefinition(productBatchService),
    createProductInactiveDraftUpdateCommandDefinition(productUpdateService),
    createProductInactiveDraftBulkUpdateCommandDefinition(productBulkUpdateService),
    createProductPricingChangeSetCommandDefinition(productPricingChangeSetCommandService),
    createProductPricingRollbackCommandDefinition(productPricingChangeSetCommandService),
    createConfigurableProductDraftCommandDefinition(),
    createCloneInactiveProductDraftCommandDefinition(),
    createInactivePbv2PricingMatrixEditCommandDefinition(),
    createInactivePbv2QuantityTierEditCommandDefinition(),
    createQuoteDraftCreateCommandDefinition(quoteDraftIntakeService),
    createQuoteDraftUpdateCommandDefinition(quoteDraftIntakeService),
    createDeferredOrderCommandDefinition(orderIntakeService),
    createEditableOrderUpdateCommandDefinition(orderIntakeService),
    createQuoteConvertOrderCommandDefinition(orderIntakeService),
    ...crmCommandNames.map((name) => createCrmManagementCommandDefinition(name, crmManagementService)),
    ...productionOperationCommandNames.map((name) => createProductionOperationCommandDefinition(name, productionOperationsService)),
    ...fulfillmentOperationCommandNames.map((name) => createFulfillmentOperationCommandDefinition(name, fulfillmentOperationsService)),
    ...billingInvoiceOperationCommandNames.map((name) => createBillingInvoiceOperationCommandDefinition(name, billingInvoiceOperationsService)),
    ...paymentOperationCommandNames.map((name) => createPaymentOperationCommandDefinition(name, paymentOperationsService)),
  );
  const executionCommands = new Map<string, ExecutionCommandDefinition>([
    [quoteInternalNoteCommandName, createQuoteInternalNoteExecutionCommand(quoteInternalNotesService)],
    [productInactiveDraftCommandName, createProductInactiveDraftExecutionCommand(productService)],
    [productInactiveDraftBatchCommandName, createProductInactiveDraftBatchExecutionCommand(productBatchService)],
    [productInactiveDraftUpdateCommandName, createProductInactiveDraftUpdateExecutionCommand(productUpdateService)],
    [productInactiveDraftBulkUpdateCommandName, createProductInactiveDraftBulkUpdateExecutionCommand(productBulkUpdateService)],
    [productPricingChangeSetCommandName, createProductPricingChangeSetExecutionCommand(productPricingChangeSetCommandService, productPricingChangeSetStore)],
    [productPricingRollbackCommandName, createProductPricingRollbackExecutionCommand(productPricingChangeSetCommandService, productPricingChangeSetStore)],
    [configurableProductDraftCommandName, createConfigurableProductDraftExecutionCommand()],
    [cloneInactiveProductDraftCommandName, createCloneInactiveProductDraftExecutionCommand()],
    [inactivePbv2PricingMatrixEditCommandName, createInactivePbv2PricingMatrixEditExecutionCommand()],
    [inactivePbv2QuantityTierEditCommandName, createInactivePbv2QuantityTierEditExecutionCommand()],
    [quoteDraftCreateCommandName, createQuoteDraftCreateExecutionCommand(quoteDraftIntakeService)],
    [quoteDraftUpdateCommandName, createQuoteDraftUpdateExecutionCommand(quoteDraftIntakeService)],
    [assistantOrderCreateCommandName, createDeferredOrderExecutionCommand(assistantOrderCreateCommandName, orderIntakeService)],
    [assistantOrderUpdateEditableCommandName, createDeferredOrderExecutionCommand(assistantOrderUpdateEditableCommandName, orderIntakeService)],
    [assistantQuoteConvertOrderCommandName, createDeferredOrderExecutionCommand(assistantQuoteConvertOrderCommandName, orderIntakeService)],
    ...crmCommandNames.map((name) => [name, createCrmManagementExecutionCommand(name, crmManagementService)] as [string, ExecutionCommandDefinition]),
    ...productionOperationCommandNames.map((name) => [name, createProductionOperationExecutionCommand(name, productionOperationsService)] as [string, ExecutionCommandDefinition]),
    ...fulfillmentOperationCommandNames.map((name) => [name, createFulfillmentOperationExecutionCommand(name, fulfillmentOperationsService)] as [string, ExecutionCommandDefinition]),
    ...billingInvoiceOperationCommandNames.map((name) => [name, createBillingInvoiceOperationExecutionCommand(name, billingInvoiceOperationsService)] as [string, ExecutionCommandDefinition]),
    ...paymentOperationCommandNames.map((name) => [name, createPaymentOperationExecutionCommand(name, paymentOperationsService)] as [string, ExecutionCommandDefinition]),
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
      const productBatchProposal = Array.isArray(assistantMessage.structuredCards)
        ? (assistantMessage.structuredCards as any[]).find((card: any) => card?.kind === "action_proposal" && card?.plan?.action === productInactiveDraftBatchCommandName)?.plan
        : null;
      const productUpdateProposal = Array.isArray(assistantMessage.structuredCards)
        ? (assistantMessage.structuredCards as any[]).find((card: any) => card?.kind === "action_proposal" && card?.plan?.action === productInactiveDraftUpdateCommandName)?.plan
        : null;
      const productBulkUpdateProposal = Array.isArray(assistantMessage.structuredCards)
        ? (assistantMessage.structuredCards as any[]).find((card: any) => card?.kind === "action_proposal" && card?.plan?.action === productInactiveDraftBulkUpdateCommandName)?.plan
        : null;
      const productPricingChangeSetProposal = Array.isArray(assistantMessage.structuredCards)
        ? (assistantMessage.structuredCards as any[]).find((card: any) => card?.kind === "action_proposal" && card?.plan?.action === productPricingChangeSetCommandName)?.plan
        : null;
      const productPricingRollbackProposal = Array.isArray(assistantMessage.structuredCards)
        ? (assistantMessage.structuredCards as any[]).find((card: any) => card?.kind === "action_proposal" && card?.plan?.action === productPricingRollbackCommandName)?.plan
        : null;
      const configurableProductProposal = Array.isArray(assistantMessage.structuredCards)
        ? (assistantMessage.structuredCards as any[]).find((card: any) => card?.kind === "action_proposal" && card?.plan?.action === configurableProductDraftCommandName)?.plan
        : null;
      const cloneInactiveDraftProposal = Array.isArray(assistantMessage.structuredCards)
        ? (assistantMessage.structuredCards as any[]).find((card: any) => card?.kind === "action_proposal" && card?.plan?.action === cloneInactiveProductDraftCommandName)?.plan
        : null;
      const matrixProposal = Array.isArray(assistantMessage.structuredCards)
        ? (assistantMessage.structuredCards as any[]).find((card: any) => card?.kind === "action_proposal" && card?.plan?.action === inactivePbv2PricingMatrixEditCommandName)?.plan
        : null;
      const tierProposal = Array.isArray(assistantMessage.structuredCards)
        ? (assistantMessage.structuredCards as any[]).find((card: any) => card?.kind === "action_proposal" && card?.plan?.action === inactivePbv2QuantityTierEditCommandName)?.plan
        : null;
      const quoteDraftCreateProposal = Array.isArray(assistantMessage.structuredCards)
        ? (assistantMessage.structuredCards as any[]).find((card: any) => card?.kind === "action_proposal" && card?.plan?.action === quoteDraftCreateCommandName)?.plan
        : null;
      const quoteDraftUpdateProposal = Array.isArray(assistantMessage.structuredCards)
        ? (assistantMessage.structuredCards as any[]).find((card: any) => card?.kind === "action_proposal" && card?.plan?.action === quoteDraftUpdateCommandName)?.plan
        : null;
      const directOrderProposal = Array.isArray(assistantMessage.structuredCards)
        ? (assistantMessage.structuredCards as any[]).find((card: any) => card?.kind === "action_proposal" && card?.plan?.action === assistantOrderCreateCommandName)?.plan
        : null;
      const conversionProposal = Array.isArray(assistantMessage.structuredCards)
        ? (assistantMessage.structuredCards as any[]).find((card: any) => card?.kind === "action_proposal" && card?.plan?.action === assistantQuoteConvertOrderCommandName)?.plan
        : null;
      const orderUpdateProposal = Array.isArray(assistantMessage.structuredCards)
        ? (assistantMessage.structuredCards as any[]).find((card: any) => card?.kind === "action_proposal" && card?.plan?.action === assistantOrderUpdateEditableCommandName)?.plan
        : null;
      const crmProposal = Array.isArray(assistantMessage.structuredCards)
        ? (assistantMessage.structuredCards as any[]).find((card: any) => card?.kind === "action_proposal" && typeof card?.plan?.action === "string" && crmCommandNames.includes(card.plan.action) && typeof card?.plan?.crmIntakeSessionId === "string" && typeof card?.plan?.proposalFingerprint === "string")?.plan
        : null;
      const productionProposal = Array.isArray(assistantMessage.structuredCards)
        ? (assistantMessage.structuredCards as any[]).find((card: any) => card?.kind === "action_proposal" && typeof card?.plan?.action === "string" && productionOperationCommandNames.includes(card.plan.action) && typeof card?.plan?.productionIntakeSessionId === "string" && typeof card?.plan?.proposalFingerprint === "string")?.plan
        : null;
      const fulfillmentProposal = Array.isArray(assistantMessage.structuredCards)
        ? (assistantMessage.structuredCards as any[]).find((card: any) => card?.kind === "action_proposal" && typeof card?.plan?.action === "string" && fulfillmentOperationCommandNames.includes(card.plan.action) && typeof card?.plan?.fulfillmentIntakeSessionId === "string" && typeof card?.plan?.proposalFingerprint === "string")?.plan
        : null;
      const billingProposal = Array.isArray(assistantMessage.structuredCards)
        ? (assistantMessage.structuredCards as any[]).find((card: any) => card?.kind === "action_proposal" && typeof card?.plan?.action === "string" && billingInvoiceOperationCommandNames.includes(card.plan.action) && typeof card?.plan?.billingIntakeSessionId === "string" && typeof card?.plan?.proposalFingerprint === "string")?.plan
        : null;
      const paymentProposal = Array.isArray(assistantMessage.structuredCards)
        ? (assistantMessage.structuredCards as any[]).find((card: any) => card?.kind === "action_proposal" && typeof card?.plan?.action === "string" && paymentOperationCommandNames.includes(card.plan.action) && typeof card?.plan?.paymentIntakeSessionId === "string" && typeof card?.plan?.proposalFingerprint === "string")?.plan
        : null;
      if (paymentProposal) { const plan = await service.createPlan(actor, { conversationId: req.params.conversationId, turnId: input.turnId, commandName: paymentProposal.action, arguments: { paymentIntakeSessionId: paymentProposal.paymentIntakeSessionId, proposalFingerprint: paymentProposal.proposalFingerprint }, context: input.context }); const confirmation = await service.issueConfirmation(actor, plan.id, plan.version); return res.status(201).json({ success: true, data: { plan: planDto(confirmation.plan), confirmationToken: confirmation.token } }); }
      if (billingProposal) { const plan = await service.createPlan(actor, { conversationId: req.params.conversationId, turnId: input.turnId, commandName: billingProposal.action, arguments: { billingIntakeSessionId: billingProposal.billingIntakeSessionId, proposalFingerprint: billingProposal.proposalFingerprint }, context: input.context }); const confirmation = await service.issueConfirmation(actor, plan.id, plan.version); return res.status(201).json({ success: true, data: { plan: planDto(confirmation.plan), confirmationToken: confirmation.token } }); }
      if (fulfillmentProposal) { const plan = await service.createPlan(actor, { conversationId: req.params.conversationId, turnId: input.turnId, commandName: fulfillmentProposal.action, arguments: { fulfillmentIntakeSessionId: fulfillmentProposal.fulfillmentIntakeSessionId, proposalFingerprint: fulfillmentProposal.proposalFingerprint }, context: input.context }); const confirmation = await service.issueConfirmation(actor, plan.id, plan.version); return res.status(201).json({ success: true, data: { plan: planDto(confirmation.plan), confirmationToken: confirmation.token } }); }
      if (productionProposal) {
        const plan = await service.createPlan(actor, { conversationId: req.params.conversationId, turnId: input.turnId, commandName: productionProposal.action, arguments: { productionIntakeSessionId: productionProposal.productionIntakeSessionId, proposalFingerprint: productionProposal.proposalFingerprint }, context: input.context });
        const confirmation = await service.issueConfirmation(actor, plan.id, plan.version);
        return res.status(201).json({ success: true, data: { plan: planDto(confirmation.plan), confirmationToken: confirmation.token } });
      }
      if (crmProposal) {
        const plan = await service.createPlan(actor, { conversationId: req.params.conversationId, turnId: input.turnId, commandName: crmProposal.action, arguments: { crmIntakeSessionId: crmProposal.crmIntakeSessionId, proposalFingerprint: crmProposal.proposalFingerprint }, context: input.context });
        const confirmation = await service.issueConfirmation(actor, plan.id, plan.version);
        return res.status(201).json({ success: true, data: { plan: planDto(confirmation.plan), confirmationToken: confirmation.token } });
      }
      if (orderUpdateProposal && typeof orderUpdateProposal.orderIntakeSessionId === "string" && typeof orderUpdateProposal.proposalFingerprint === "string") {
        const plan = await service.createPlan(actor, { conversationId: req.params.conversationId, turnId: input.turnId, commandName: assistantOrderUpdateEditableCommandName, arguments: { orderIntakeSessionId: orderUpdateProposal.orderIntakeSessionId, proposalFingerprint: orderUpdateProposal.proposalFingerprint }, context: input.context });
        const confirmation = await service.issueConfirmation(actor, plan.id, plan.version);
        return res.status(201).json({ success: true, data: { plan: planDto(confirmation.plan), confirmationToken: confirmation.token } });
      }
      if (conversionProposal && typeof conversionProposal.orderIntakeSessionId === "string" && typeof conversionProposal.proposalFingerprint === "string") {
        const plan = await service.createPlan(actor, { conversationId: req.params.conversationId, turnId: input.turnId, commandName: assistantQuoteConvertOrderCommandName, arguments: { orderIntakeSessionId: conversionProposal.orderIntakeSessionId, proposalFingerprint: conversionProposal.proposalFingerprint }, context: input.context });
        const confirmation = await service.issueConfirmation(actor, plan.id, plan.version);
        return res.status(201).json({ success: true, data: { plan: planDto(confirmation.plan), confirmationToken: confirmation.token } });
      }
      if (directOrderProposal && typeof directOrderProposal.orderIntakeSessionId === "string" && typeof directOrderProposal.proposalFingerprint === "string") {
        const plan = await service.createPlan(actor, { conversationId: req.params.conversationId, turnId: input.turnId, commandName: assistantOrderCreateCommandName, arguments: { orderIntakeSessionId: directOrderProposal.orderIntakeSessionId, proposalFingerprint: directOrderProposal.proposalFingerprint }, context: input.context });
        const confirmation = await service.issueConfirmation(actor, plan.id, plan.version);
        return res.status(201).json({ success: true, data: { plan: planDto(confirmation.plan), confirmationToken: confirmation.token } });
      }
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
      if (productBulkUpdateProposal && typeof productBulkUpdateProposal.bulkUpdateId === "string" && typeof productBulkUpdateProposal.bulkFingerprint === "string") {
        const plan = await service.createPlan(actor, { conversationId: req.params.conversationId, turnId: input.turnId, commandName: productInactiveDraftBulkUpdateCommandName, arguments: { bulkUpdateId: productBulkUpdateProposal.bulkUpdateId, bulkFingerprint: productBulkUpdateProposal.bulkFingerprint }, context: input.context });
        const confirmation = await service.issueConfirmation(actor, plan.id, plan.version);
        return res.status(201).json({ success: true, data: { plan: planDto(confirmation.plan), confirmationToken: confirmation.token } });
      }
      if (productPricingChangeSetProposal && typeof productPricingChangeSetProposal.changeSetId === "string" && typeof productPricingChangeSetProposal.fingerprint === "string") {
        const plan = await service.createPlan(actor, { conversationId: req.params.conversationId, turnId: input.turnId, commandName: productPricingChangeSetCommandName, arguments: { changeSetId: productPricingChangeSetProposal.changeSetId, fingerprint: productPricingChangeSetProposal.fingerprint }, context: input.context });
        const confirmation = await service.issueConfirmation(actor, plan.id, plan.version);
        return res.status(201).json({ success: true, data: { plan: planDto(confirmation.plan), confirmationToken: confirmation.token } });
      }
      if (productPricingRollbackProposal && typeof productPricingRollbackProposal.changeSetId === "string" && typeof productPricingRollbackProposal.fingerprint === "string") {
        const plan = await service.createPlan(actor, { conversationId: req.params.conversationId, turnId: input.turnId, commandName: productPricingRollbackCommandName, arguments: { changeSetId: productPricingRollbackProposal.changeSetId, fingerprint: productPricingRollbackProposal.fingerprint }, context: input.context });
        const confirmation = await service.issueConfirmation(actor, plan.id, plan.version); return res.status(201).json({ success: true, data: { plan: planDto(confirmation.plan), confirmationToken: confirmation.token } });
      }
      if (configurableProductProposal && typeof configurableProductProposal.proposalId === "string" && typeof configurableProductProposal.fingerprint === "string") {
        const plan = await service.createPlan(actor, { conversationId: req.params.conversationId, turnId: input.turnId, commandName: configurableProductDraftCommandName, arguments: { proposalId: configurableProductProposal.proposalId, fingerprint: configurableProductProposal.fingerprint }, context: input.context, reuseAwaitingPlan: true, supersedeAwaitingProposal: { proposalId: configurableProductProposal.proposalId, fingerprint: configurableProductProposal.fingerprint } });
        const confirmation = await service.issueConfirmation(actor, plan.id, plan.version); return res.status(201).json({ success: true, data: { plan: planDto(confirmation.plan), confirmationToken: confirmation.token } });
      }
      if (cloneInactiveDraftProposal && typeof cloneInactiveDraftProposal.proposalId === "string" && typeof cloneInactiveDraftProposal.proposalFingerprint === "string") {
        const plan = await service.createPlan(actor, { conversationId: req.params.conversationId, turnId: input.turnId, commandName: cloneInactiveProductDraftCommandName, arguments: { proposalId: cloneInactiveDraftProposal.proposalId, proposalFingerprint: cloneInactiveDraftProposal.proposalFingerprint }, context: input.context, reuseAwaitingPlan: true, supersedeAwaitingProposal: { proposalId: cloneInactiveDraftProposal.proposalId, fingerprint: cloneInactiveDraftProposal.proposalFingerprint } });
        const confirmation = await service.issueConfirmation(actor, plan.id, plan.version);
        return res.status(201).json({ success: true, data: { plan: planDto(confirmation.plan), confirmationToken: confirmation.token } });
      }
      if (matrixProposal && typeof matrixProposal.proposalId === "string" && typeof matrixProposal.proposalFingerprint === "string") {
        const plan = await service.createPlan(actor, { conversationId: req.params.conversationId, turnId: input.turnId, commandName: inactivePbv2PricingMatrixEditCommandName, arguments: { proposalId: matrixProposal.proposalId, proposalFingerprint: matrixProposal.proposalFingerprint }, context: input.context, reuseAwaitingPlan: true, supersedeAwaitingProposal: { proposalId: matrixProposal.proposalId, fingerprint: matrixProposal.proposalFingerprint } });
        const confirmation = await service.issueConfirmation(actor, plan.id, plan.version); return res.status(201).json({ success: true, data: { plan: planDto(confirmation.plan), confirmationToken: confirmation.token } });
      }
      if (tierProposal && typeof tierProposal.proposalId === "string" && typeof tierProposal.proposalFingerprint === "string") {
        const plan = await service.createPlan(actor, { conversationId: req.params.conversationId, turnId: input.turnId, commandName: inactivePbv2QuantityTierEditCommandName, arguments: { proposalId: tierProposal.proposalId, proposalFingerprint: tierProposal.proposalFingerprint }, context: input.context, reuseAwaitingPlan: true, supersedeAwaitingProposal: { proposalId: tierProposal.proposalId, fingerprint: tierProposal.proposalFingerprint } });
        const confirmation = await service.issueConfirmation(actor, plan.id, plan.version); return res.status(201).json({ success: true, data: { plan: planDto(confirmation.plan), confirmationToken: confirmation.token } });
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
      if (productBatchProposal && typeof productBatchProposal.batchFingerprint === "string" && Array.isArray(productBatchProposal.children)) {
        const plan = await service.createPlan(actor, { conversationId: req.params.conversationId, turnId: input.turnId, commandName: productInactiveDraftBatchCommandName, arguments: { ...(typeof productBatchProposal.batchId === "string" ? { batchId: productBatchProposal.batchId } : {}), sharedDefaults: productBatchProposal.sharedDefaults && typeof productBatchProposal.sharedDefaults === "object" ? productBatchProposal.sharedDefaults : {}, batchFingerprint: productBatchProposal.batchFingerprint, children: productBatchProposal.children }, context: input.context });
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
