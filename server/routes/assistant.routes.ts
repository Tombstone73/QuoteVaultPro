import type { Express, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import {
  assistantCreateConversationRequestSchema,
  assistantBulkArchiveConversationsRequestSchema,
  assistantContextEnvelopeSchema,
  assistantReportResolutionCancelRequestSchema,
  assistantReportResolutionSelectionRequestSchema,
  assistantUpdateConversationRequestSchema,
  assistantTurnRequestSchema,
  type AssistantReportResolutionSelectionRequest,
  type AssistantReportResolutionCancelRequest,
  type AssistantReportResolutionSelectionResponse,
} from "@shared/assistantContracts";
import { getRequestOrganizationId } from "../tenantContext";
import {
  AssistantService,
  AssistantServiceError,
  responsePresentationForCards,
  responseStateForCards,
  type AssistantActor,
  type AssistantRepository,
  type AssistantScope,
} from "../services/assistant/assistantService";
import { OrganizationAssistantCapabilityResolver } from "../services/assistant/assistantCapabilities";
import { DrizzleAssistantRepository } from "../storage/assistant.repo";
import { AnalyticalCustomerResolutionService } from "../services/assistant/analyticalCustomerResolution";
import { AssistantAnalyticsReportingRepository } from "../storage/assistantAnalyticsReporting.repo";
import { assistantReportEntityResolutionsRepository } from "../storage/assistantReportEntityResolutions.repo";
import { canonicalProductIntentCards, ConfiguredCanonicalProductIntentRouter } from "../services/assistant/productManagementSkill";
import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { db } from "../db";
import { aiAuditEvents } from "@shared/schema";
import { aiDiagnosticEnvelopeSchema } from "@shared/aiDiagnostics";
import { legacyChatPermissionsForOrganizationRole } from "../services/assistant/actorAuthorityShadowAdapters";
import { compareAssistantAuthority, emitAssistantAuthorityShadowDiagnostic, resolveAssistantActorAuthority } from "../services/assistant/actorAuthorityResolver";
import { hasCanonicalProposalCard } from "../services/assistant/canonicalProductIntentCardPersistence";

const canonicalInteractionRequestSchema = z.object({
  proposalId: z.string().uuid(), action: z.enum(["accept_recommendation", "dismiss_recommendation", "apply_candidate"]), actionId: z.string().min(3).max(128), newProductName: z.string().trim().min(1).max(160).optional(),
}).strict();

function getUserId(user: unknown): string | null {
  const candidate = user as { id?: unknown; claims?: { sub?: unknown } } | null;
  const id = candidate?.claims?.sub ?? candidate?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function buildActor(req: Request, userId: string): AssistantActor {
  const user = req.user as { email?: unknown; claims?: { email?: unknown } } | undefined;
  const email = user?.claims?.email ?? user?.email;
  const organizationId = typeof req.organizationId === "string" ? req.organizationId : "";
  const authority = resolveAssistantActorAuthority({ actorUserId: userId, organizationId, organizationRole: req.orgRole, authenticationSource: "authenticated_request", tenantSource: "tenant_context" });
  const actor = {
    userId,
    email: typeof email === "string" ? email : null,
    ipAddress: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
    // tenantContext has already excluded customer-portal identities. Do not
    // consume any permission claim or request body field here.
    permissions: authority.grants,
  };
  emitAssistantAuthorityShadowDiagnostic(compareAssistantAuthority("chat", legacyChatPermissionsForOrganizationRole(req.orgRole), authority));
  return actor;
}

function conversationSummary(row: any) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    lastMessagePreview: row.lastMessagePreview ?? null,
    lastActivityAt: row.lastActivityAt instanceof Date ? row.lastActivityAt.toISOString() : row.lastActivityAt,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  };
}

function conversationDetail(row: any) {
  return {
    ...conversationSummary(row),
    messages: row.messages.map((message: any) => messageDto(message)),
  };
}

function messageDto(message: any, turnId = message.turnId) {
  const rawCards = Array.isArray(message.structuredCards) ? message.structuredCards : [];
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    // Older persisted turns may contain the legacy metadata marker. It is
    // intentionally read only to derive the server-owned presentation then
    // stripped before the browser receives its visible card collection.
    presentation: responsePresentationForCards(rawCards),
    responseState: responseStateForCards(rawCards),
    structuredCards: withTurnBoundProposals(rawCards.filter((card: any) => card?.kind !== "response_presentation"), turnId),
    provider: message.provider ?? null,
    model: message.model ?? null,
    correlationId: message.correlationId ?? null,
    createdAt: message.createdAt instanceof Date ? message.createdAt.toISOString() : message.createdAt,
  };
}

/** The turn ID is persisted separately from its safe display card. Supplying it
 * only in this authenticated response lets the browser ask for a plan without
 * ever choosing the command or embedding a token in conversation history. */
function withTurnBoundProposals(cards: unknown, turnId: string | null) {
  if (!Array.isArray(cards)) return [];
  return cards.map((card: any) => card?.kind === "action_proposal" && card?.plan && turnId
    ? { ...card, proposal: { ...card.plan, turnId } }
    : card);
}

function sendError(res: Response, error: unknown) {
  if (error instanceof AssistantServiceError) {
    const code = error.code === "ASSISTANT_CONVERSATION_NOT_FOUND"
      ? "conversation_not_found"
      : error.code === "ASSISTANT_DISABLED"
        ? "assistant_disabled"
        : error.code === "ASSISTANT_MESSAGE_PERSISTENCE_FAILED"
          ? "message_persistence_failed"
        : error.code === "ASSISTANT_AUTH_REQUIRED"
          ? "assistant_unavailable"
          : "turn_failed";
    return res.status(error.statusCode).json({
      error: { code, message: error.message, retryable: error.statusCode >= 500 },
    });
  }
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      error: {
        code: "context_invalid",
        message: error.errors.map((issue) => issue.message).join("; "),
        retryable: false,
      },
    });
  }
  console.error("[Assistant] Route failed:", error);
  return res.status(500).json({
    error: { code: "turn_failed", message: "Assistant request failed.", retryable: true },
  });
}

/** Identity is derived exclusively from the authenticated request.  Ignore
 * identity-shaped values a client (or future model payload) might attach while
 * still letting Zod reject every other unknown field. */
function withoutUntrustedIdentity(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const { organizationId: _organizationId, orgId: _orgId, userId: _userId, ...body } = raw as Record<string, unknown>;
  const context = body.context;
  if (context && typeof context === "object" && !Array.isArray(context)) {
    const { organizationId: _contextOrganizationId, orgId: _contextOrgId, userId: _contextUserId, ...safeContext } = context as Record<string, unknown>;
    return { ...body, context: safeContext };
  }
  return body;
}

export interface AssistantRouteDependencies {
  service?: AssistantService;
  repository?: AssistantRepository;
  canonicalProductIntentRouter?: Pick<ConfiguredCanonicalProductIntentRouter, "interact">;
  orderOptionSelectionService?: AssistantOrderOptionSelectionService;
  /**
   * Reporting entity selection is intentionally a separate server-owned
   * continuation boundary.  The route only supplies authenticated scope,
   * server-derived actor permissions, the resolution path id, and the two
   * opaque client values; it never receives a company id or report plan.
   */
  reportResolutionService?: AssistantReportResolutionSelectionService;
}

export interface AssistantReportResolutionSelectionService {
  selectReportResolution(
    scope: AssistantScope,
    resolutionId: string,
    actor: AssistantActor,
    input: AssistantReportResolutionSelectionRequest,
  ): Promise<AssistantReportResolutionSelectionResponse>;
  cancelReportResolution?(
    scope: AssistantScope,
    resolutionId: string,
    actor: AssistantActor,
    input: AssistantReportResolutionCancelRequest,
  ): Promise<unknown>;
}

export interface AssistantOrderOptionSelectionService {
  submitOrderOptionSelections(scope: AssistantScope, conversationId: string, actor: AssistantActor, input: { orderIntakeSessionId: string; productId: string; pbv2TreeVersionId: string; selections: Array<{ nodeId: string; valueId: string }>; useRemainingDefaults: boolean; context: unknown }): Promise<any>;
}

const assistantOrderOptionSelectionRequestSchema = z.object({
  productId: z.string().trim().min(1).max(128),
  pbv2TreeVersionId: z.string().trim().min(1).max(128),
  selections: z.array(z.object({ nodeId: z.string().trim().min(1).max(128), valueId: z.string().trim().min(1).max(256) }).strict()).max(30),
  useRemainingDefaults: z.boolean(),
  context: assistantContextEnvelopeSchema,
}).strict();

function sendOrderOptionSelectionError(res: Response, error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (code === "ORDER_OPTION_SELECTION_STALE") return res.status(409).json({ error: { code: "order_option_selection_stale", message: "This option selection is no longer available. Refresh the order request.", retryable: false } });
  if (code === "ORDER_OPTION_SELECTION_INVALID") return res.status(400).json({ error: { code: "order_option_selection_invalid", message: "One or more selected options are not available for this order.", retryable: false } });
  return sendError(res, error);
}

type ReportResolutionFailureCode =
  | "REPORT_RESOLUTION_NOT_FOUND"
  | "REPORT_RESOLUTION_EXPIRED"
  | "REPORT_RESOLUTION_CANCELLED"
  | "REPORT_RESOLUTION_STALE"
  | "REPORT_RESOLUTION_INVALID_CANDIDATE";

/** Safe, stable failures for the resolution route.  Implementations may use
 * this error or expose the same uppercase code shape; neither path leaks
 * whether another tenant/user owns a resolution. */
export class AssistantReportResolutionError extends Error {
  constructor(readonly code: ReportResolutionFailureCode, message: string) {
    super(message);
    this.name = "AssistantReportResolutionError";
  }
}

function sendReportResolutionError(res: Response, error: unknown) {
  const rawCode = error instanceof AssistantReportResolutionError
    ? error.code
    : typeof error === "object" && error && "code" in error && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : null;
  const code = rawCode === "REPORT_RESOLUTION_STALE_VERSION" || rawCode === "REPORT_RESOLUTION_NOT_PENDING"
    ? "REPORT_RESOLUTION_STALE"
    : rawCode;
  const errors: Record<ReportResolutionFailureCode, { status: number; code: string; message: string }> = {
    REPORT_RESOLUTION_NOT_FOUND: { status: 404, code: "report_resolution_not_found", message: "Report selection not found." },
    REPORT_RESOLUTION_EXPIRED: { status: 409, code: "report_resolution_expired", message: "This report selection has expired." },
    REPORT_RESOLUTION_CANCELLED: { status: 409, code: "report_resolution_cancelled", message: "This report selection is no longer available." },
    REPORT_RESOLUTION_STALE: { status: 409, code: "report_resolution_stale", message: "This report selection changed. Refresh and try again." },
    REPORT_RESOLUTION_INVALID_CANDIDATE: { status: 400, code: "report_resolution_invalid_candidate", message: "The selected company is not available for this report." },
  };
  if (code && code in errors) {
    const safe = errors[code as ReportResolutionFailureCode];
    return res.status(safe.status).json({ error: { code: safe.code, message: safe.message, retryable: false } });
  }
  return sendError(res, error);
}

export function registerAssistantRoutes(
  app: Express,
  middleware: { isAuthenticated: RequestHandler; tenantContext: RequestHandler; isAdmin?: RequestHandler },
  dependencies: AssistantRouteDependencies = {},
): void {
  const repository = dependencies.repository ?? new DrizzleAssistantRepository();
  const service = dependencies.service ?? new AssistantService(
    repository,
    new OrganizationAssistantCapabilityResolver(),
    undefined,
    undefined,
    new AnalyticalCustomerResolutionService(
      new AssistantAnalyticsReportingRepository(),
      assistantReportEntityResolutionsRepository,
    ),
  );
  // The production assistant service owns the server-only continuation once
  // Stage 8.2 is installed.  The explicit dependency keeps route tests and
  // isolated deployments injectable without ever moving continuation inputs
  // into the browser.
  const reportResolutionService = dependencies.reportResolutionService
    ?? (service as unknown as Partial<AssistantReportResolutionSelectionService>);
  const orderOptionSelectionService = dependencies.orderOptionSelectionService
    ?? (service as unknown as Partial<AssistantOrderOptionSelectionService>);
  const canonicalProductIntentRouter = dependencies.canonicalProductIntentRouter ?? new ConfiguredCanonicalProductIntentRouter();
  const { isAuthenticated, tenantContext } = middleware;
  const guarded: RequestHandler[] = [isAuthenticated, tenantContext];

  if (middleware.isAdmin) app.get("/api/assistant/diagnostics/:reference", isAuthenticated, tenantContext, middleware.isAdmin, async (req, res) => {
    const scope = resolveScope(req);
    const reference = String(req.params.reference ?? "");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(reference)) return res.status(404).json({ success: false, error: { code: "DIAGNOSTIC_NOT_FOUND", message: "Diagnostic not found." } });
    const rows = await db.select().from(aiAuditEvents).where(and(eq(aiAuditEvents.orgId, scope.organizationId), or(eq(aiAuditEvents.correlationId, reference), eq(sql<string>`${aiAuditEvents.metadata}->>'referenceId'`, reference)))).orderBy(asc(aiAuditEvents.createdAt)).limit(20);
    const diagnostics = rows.flatMap((row) => { const parsed = aiDiagnosticEnvelopeSchema.safeParse(row.metadata); return parsed.success ? [parsed.data] : []; });
    await db.insert(aiAuditEvents).values({ orgId: scope.organizationId, actorUserId: scope.userId, eventType: "ai_diagnostic_lookup", status: diagnostics.length ? "found" : "not_found", correlationId: reference, metadata: { identifierType: reference.startsWith("aip-") || reference.startsWith("pic-") ? "reference" : "correlation", reference, matchingEvents: diagnostics.length } }).catch(() => undefined);
    if (!diagnostics.length) return res.status(404).json({ success: false, error: { code: "DIAGNOSTIC_NOT_FOUND", message: "Diagnostic not found." } });
    return res.json({ success: true, data: diagnostics });
  });

  const resolveScope = (req: Request) => {
    const userId = getUserId(req.user);
    if (!userId) throw new AssistantServiceError("ASSISTANT_AUTH_REQUIRED", "Unauthorized", 401);
    return { organizationId: getRequestOrganizationId(req), userId };
  };

  app.get("/api/assistant/capabilities", ...guarded, async (req, res) => {
    try {
      const resolvedScope = resolveScope(req);
      const data = await service.getCapabilities(resolvedScope, buildActor(req, resolvedScope.userId));
      return res.json({ success: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.get("/api/assistant/conversations", ...guarded, async (req, res) => {
    try {
      const status = req.query.status === "archived" ? "archived" : "active";
      const rows = await service.listConversations(resolveScope(req), status);
      return res.json({ success: true, data: rows.map(conversationSummary) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/assistant/conversations", ...guarded, async (req, res) => {
    try {
      const data = assistantCreateConversationRequestSchema.parse(withoutUntrustedIdentity(req.body ?? {}));
      const conversation = await service.createConversation(resolveScope(req), data);
      return res.status(201).json({ success: true, data: conversationDetail({ ...conversation, messages: [] }) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/assistant/conversations/archive", ...guarded, async (req, res) => {
    try {
      const data = assistantBulkArchiveConversationsRequestSchema.parse(withoutUntrustedIdentity(req.body ?? {}));
      const result = await service.archiveConversations(resolveScope(req), data);
      return res.json({ success: true, data: result });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.get("/api/assistant/conversations/:conversationId", ...guarded, async (req, res) => {
    try {
      const conversation = await service.getConversation(resolveScope(req), req.params.conversationId);
      return res.json({ success: true, data: conversationDetail(conversation) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.patch("/api/assistant/conversations/:conversationId", ...guarded, async (req, res) => {
    try {
      const patch = assistantUpdateConversationRequestSchema.parse(withoutUntrustedIdentity(req.body ?? {}));
      const conversation = await service.updateConversation(resolveScope(req), req.params.conversationId, patch);
      return res.json({ success: true, data: conversationSummary(conversation) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/assistant/conversations/:conversationId/turns", ...guarded, async (req, res) => {
    try {
      const data = assistantTurnRequestSchema.parse(withoutUntrustedIdentity(req.body ?? {}));
      const scope = resolveScope(req);
      const result = await service.createTurn(
        scope,
        req.params.conversationId,
        buildActor(req, scope.userId),
        data,
      );
      res.setHeader("x-assistant-correlation-id", result.correlationId);
      return res.status(201).json({
        success: true,
        data: {
          turnId: result.turnId,
          correlationId: result.correlationId,
          message: { ...messageDto(result.assistantMessage, result.turnId), correlationId: result.correlationId },
          status: result.status,
          usage: {
            correlationId: result.correlationId,
            conversationId: result.conversation.id,
            turnId: result.turnId,
            provider: null,
            model: null,
          },
        },
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/assistant/conversations/:conversationId/order-option-selections/:orderIntakeSessionId", ...guarded, async (req, res) => {
    try {
      const input = assistantOrderOptionSelectionRequestSchema.parse(withoutUntrustedIdentity(req.body ?? {}));
      const scope = resolveScope(req);
      if (typeof orderOptionSelectionService.submitOrderOptionSelections !== "function") throw new AssistantServiceError("ASSISTANT_DISABLED", "Order option selection is not available.", 503);
      const result = await orderOptionSelectionService.submitOrderOptionSelections(scope, req.params.conversationId, buildActor(req, scope.userId), { ...input, orderIntakeSessionId: req.params.orderIntakeSessionId });
      return res.json({ success: true, data: { turnId: result.turnId, correlationId: result.correlationId, message: messageDto(result.assistantMessage, result.turnId), status: result.status } });
    } catch (error) {
      return sendOrderOptionSelectionError(res, error);
    }
  });

  /** Opaque canonical interaction IDs are resolved only against the latest
   * tenant/actor-bound session. No browser-supplied patch is accepted. */
  app.post("/api/assistant/conversations/:conversationId/product-intent-interactions", ...guarded, async (req, res) => {
    try {
      const scope = resolveScope(req); const input = canonicalInteractionRequestSchema.parse(withoutUntrustedIdentity(req.body ?? {}));
      const conversation = await repository.getConversation({ ...scope, conversationId: req.params.conversationId });
      const ownsProposal = conversation?.messages.some((message) => message.role === "assistant" && hasCanonicalProposalCard(message.structuredCards, input.proposalId));
      if (!ownsProposal) return res.status(404).json({ error: { code: "product_intent_not_found", message: "Product draft interaction not found.", retryable: false } });
      const result = await canonicalProductIntentRouter.interact!({ organizationId: scope.organizationId, actorUserId: scope.userId, ...input });
      if ("navigation" in result) {
        if (result.navigation.conversationId !== req.params.conversationId) return res.status(404).json({ error: { code: "product_intent_not_found", message: "Product draft interaction not found.", retryable: false } });
        const { conversationId: _conversationId, ...navigation } = result.navigation;
        return res.json({ success: true, data: { navigation } });
      }
      if (!result.ok) return res.status(409).json({ error: { code: result.code, message: result.message, retryable: false } });
      if (result.session.conversationId !== req.params.conversationId) return res.status(404).json({ error: { code: "product_intent_not_found", message: "Product draft interaction not found.", retryable: false } });
      const persisted = await repository.replaceCanonicalProductIntentCards?.({ ...scope, conversationId: req.params.conversationId, proposalId: result.session.proposalId, cards: canonicalProductIntentCards(result) as any });
      if (!persisted?.turnId) return res.status(409).json({ error: { code: "product_intent_turn_stale", message: "This product draft is no longer attached to an active review turn. Refresh the conversation and try again.", retryable: true } });
      return res.json({ success: true, data: { proposalId: result.session.proposalId, card: result.card, turnId: persisted.turnId, cards: withTurnBoundProposals(persisted.structuredCards, persisted.turnId) } });
    } catch (error) { return sendError(res, error); }
  });

  app.post("/api/assistant/report-resolutions/:resolutionId/select", ...guarded, async (req, res) => {
    try {
      const input = assistantReportResolutionSelectionRequestSchema.parse(withoutUntrustedIdentity(req.body ?? {}));
      const scope = resolveScope(req);
      if (typeof reportResolutionService.selectReportResolution !== "function") {
        // This is only reachable when a deployment has not installed the
        // persisted-plan continuation integration.  Do not fall back to
        // planning from chat text or execute an analytical tool here.
        throw new AssistantServiceError("ASSISTANT_DISABLED", "Report continuation is not available.", 503);
      }
      const data = await reportResolutionService.selectReportResolution(
        scope,
        req.params.resolutionId,
        buildActor(req, scope.userId),
        input,
      );
      return res.json({ success: true, data });
    } catch (error) {
      return sendReportResolutionError(res, error);
    }
  });

  app.post("/api/assistant/report-resolutions/:resolutionId/cancel", ...guarded, async (req, res) => {
    try {
      const input = assistantReportResolutionCancelRequestSchema.parse(withoutUntrustedIdentity(req.body ?? {}));
      const scope = resolveScope(req);
      if (typeof reportResolutionService.cancelReportResolution !== "function") {
        throw new AssistantServiceError("ASSISTANT_DISABLED", "Report continuation is not available.", 503);
      }
      const data = await reportResolutionService.cancelReportResolution(scope, req.params.resolutionId, buildActor(req, scope.userId), input);
      return res.json({ success: true, data });
    } catch (error) {
      return sendReportResolutionError(res, error);
    }
  });
}
