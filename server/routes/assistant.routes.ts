import type { Express, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import {
  assistantCreateConversationRequestSchema,
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
  type AssistantScope,
} from "../services/assistant/assistantService";
import { OrganizationAssistantCapabilityResolver } from "../services/assistant/assistantCapabilities";
import { DrizzleAssistantRepository } from "../storage/assistant.repo";
import { AnalyticalCustomerResolutionService } from "../services/assistant/analyticalCustomerResolution";
import { AssistantAnalyticsReportingRepository } from "../storage/assistantAnalyticsReporting.repo";
import { assistantReportEntityResolutionsRepository } from "../storage/assistantReportEntityResolutions.repo";

function getUserId(user: unknown): string | null {
  const candidate = user as { id?: unknown; claims?: { sub?: unknown } } | null;
  const id = candidate?.claims?.sub ?? candidate?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function buildActor(req: Request, userId: string): AssistantActor {
  const user = req.user as { email?: unknown; claims?: { email?: unknown } } | undefined;
  const email = user?.claims?.email ?? user?.email;
  return {
    userId,
    email: typeof email === "string" ? email : null,
    ipAddress: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
    // tenantContext has already excluded customer-portal identities. Do not
    // consume any permission claim or request body field here.
    permissions: (() => {
      const role = String(req.orgRole ?? "").toLowerCase();
      if (!["owner", "admin", "manager", "member", "employee"].includes(role)) return [];
      return [
        "assistant.internal_staff",
        "catalog.read",
        "assistant.quotes.add_internal_note",
        ...(role === "owner" || role === "admin" ? [
          "assistant.products.create_inactive_draft",
          "assistant.products.update_inactive_draft",
          "assistant.diagnostics.view",
          // Financial reporting is deliberately derived from the server-owned
          // tenant role, never a browser supplied capability or model input.
          "finance.read",
        ] : []),
      ];
    })(),
  };
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
  middleware: { isAuthenticated: RequestHandler; tenantContext: RequestHandler },
  dependencies: AssistantRouteDependencies = {},
): void {
  const service = dependencies.service ?? new AssistantService(
    new DrizzleAssistantRepository(),
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
  const { isAuthenticated, tenantContext } = middleware;
  const guarded: RequestHandler[] = [isAuthenticated, tenantContext];

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
      const result = await service.createTurn(scope, req.params.conversationId, buildActor(req, scope.userId), data);
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
