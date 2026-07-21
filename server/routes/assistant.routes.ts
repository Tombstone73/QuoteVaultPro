import type { Express, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import {
  assistantCreateConversationRequestSchema,
  assistantUpdateConversationRequestSchema,
  assistantTurnRequestSchema,
} from "@shared/assistantContracts";
import { getRequestOrganizationId } from "../tenantContext";
import {
  AssistantService,
  AssistantServiceError,
  responsePresentationForCards,
  type AssistantActor,
} from "../services/assistant/assistantService";
import { OrganizationAssistantCapabilityResolver } from "../services/assistant/assistantCapabilities";
import { DrizzleAssistantRepository } from "../storage/assistant.repo";

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
        ...(role === "owner" || role === "admin" ? ["assistant.products.create_inactive_draft", "assistant.products.update_inactive_draft", "assistant.diagnostics.view"] : []),
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
}

export function registerAssistantRoutes(
  app: Express,
  middleware: { isAuthenticated: RequestHandler; tenantContext: RequestHandler },
  dependencies: AssistantRouteDependencies = {},
): void {
  const service = dependencies.service ?? new AssistantService(
    new DrizzleAssistantRepository(),
    new OrganizationAssistantCapabilityResolver(),
  );
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
      const rows = await service.listConversations(resolveScope(req));
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
}
