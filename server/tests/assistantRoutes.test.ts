import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import express from "express";
import request from "supertest";

jest.unstable_mockModule("../tenantContext", () => ({
  getRequestOrganizationId: (req: any) => req.organizationId,
}));
jest.unstable_mockModule("../storage/assistant.repo", () => ({
  DrizzleAssistantRepository: class {},
}));
jest.unstable_mockModule("../services/assistant/assistantCapabilities", () => ({
  OrganizationAssistantCapabilityResolver: class {},
  assistantCapabilityProductionCommands: ["quotes.add_internal_note", "products.create_inactive_draft", "products.update_inactive_draft"],
  assistantCapabilityCommandPermissions: {
    "quotes.add_internal_note": "assistant.quotes.add_internal_note",
    "products.create_inactive_draft": "assistant.products.create_inactive_draft",
    "products.update_inactive_draft": "assistant.products.update_inactive_draft",
  },
  assistantCapabilityCommandDescriptions: {
    "quotes.add_internal_note": "add an internal quote note after your confirmation",
    "products.create_inactive_draft": "help create an inactive product draft after your confirmation",
    "products.update_inactive_draft": "update an inactive product draft after your confirmation",
  },
  isAssistantCapabilityProductionCommand: (value: string) => ["quotes.add_internal_note", "products.create_inactive_draft", "products.update_inactive_draft"].includes(value),
  assistantCapabilityReadTools: [
    "search.global",
    "customers.get_summary",
    "orders.get_summary",
    "products.get_summary",
    "reports.operational_summary",
    "navigation.get_current_context",
  ],
}));

let registerAssistantRoutes: any;
let AssistantServiceError: any;

beforeAll(async () => {
  ({ registerAssistantRoutes } = await import("../routes/assistant.routes"));
  ({ AssistantServiceError } = await import("../services/assistant/assistantService"));
});

const NOW = "2026-07-21T12:00:00.000Z";
const conversation = {
  id: "conversation_1",
  organizationId: "org_1",
  userId: "user_1",
  title: "New conversation",
  status: "active",
  lastMessagePreview: null,
  lastActivityAt: new Date(NOW),
  createdAt: new Date(NOW),
  updatedAt: new Date(NOW),
  messages: [],
};

function buildService() {
  return {
    getCapabilities: jest.fn(async (scope: any) => ({
      enabled: true,
      conversationsEnabled: true,
      toolsEnabled: false,
      writeActionsEnabled: false,
      externalResearchEnabled: false,
      assistantVersion: "stage-1",
      unavailableReason: null,
      actorScope: scope,
    })),
    listConversations: jest.fn(async () => [conversation]),
    createConversation: jest.fn(async () => conversation),
    getConversation: jest.fn(async () => conversation),
    updateConversation: jest.fn(async () => conversation),
    createTurn: jest.fn(async () => ({
      turnId: "turn_1",
      correlationId: "correlation_1",
      conversation,
      userMessage: { id: "message_1", conversationId: conversation.id, turnId: "turn_1", role: "user", content: "Hello", createdAt: new Date(NOW) },
      assistantMessage: { id: "message_2", conversationId: conversation.id, turnId: "turn_1", role: "assistant", content: "Connected", createdAt: new Date(NOW) },
    })),
  };
}

function buildApp(service: any, options: { authenticated?: boolean; withTenant?: boolean; orgId?: string; reportResolutionService?: any } = {}) {
  const app = express();
  app.use(express.json());
  const authenticated = jest.fn((req: any, res: any, next: any) => {
    if (options.authenticated === false) return res.status(401).json({ error: { code: "assistant_unavailable", message: "Unauthorized", retryable: false } });
    req.user = { id: "user_1", email: "user@example.test" };
    next();
  });
  const tenantContext = jest.fn((req: any, res: any, next: any) => {
    if (options.withTenant === false) return res.status(409).json({ error: { code: "assistant_unavailable", message: "Organization required", retryable: false } });
    req.organizationId = options.orgId ?? "org_1";
    next();
  });
  registerAssistantRoutes(app, { isAuthenticated: authenticated, tenantContext }, {
    service,
    reportResolutionService: options.reportResolutionService,
  });
  return { app, authenticated, tenantContext };
}

function turnBody(extra: Record<string, unknown> = {}) {
  return {
    message: "What orders are late?",
    context: {
      contextVersion: "v1",
      route: "/orders/order_1",
      pageTitle: "Order",
      entityType: "order",
      entityId: "order_1",
      selectedRecordIds: [],
      activeFilters: [],
      capturedAt: NOW,
      unsavedChanges: false,
      ...extra,
    },
  };
}

describe("assistant routes", () => {
  beforeEach(() => jest.clearAllMocks());

  test("requires authentication and tenant context before exposing capabilities", async () => {
    const service = buildService();
    const unauthenticated = buildApp(service, { authenticated: false });
    const tenantMissing = buildApp(service, { withTenant: false });

    await request(unauthenticated.app).get("/api/assistant/capabilities").expect(401);
    await request(tenantMissing.app).get("/api/assistant/capabilities").expect(409);
    expect(service.getCapabilities).not.toHaveBeenCalled();
  });

  test("returns safe fixed no-tool capability flags and authenticated actor scope", async () => {
    const service = buildService();
    const { app, authenticated, tenantContext } = buildApp(service);
    const response = await request(app).get("/api/assistant/capabilities").expect(200);

    expect(authenticated).toHaveBeenCalled();
    expect(tenantContext).toHaveBeenCalled();
    expect(response.body.data).toEqual(expect.objectContaining({
      toolsEnabled: false,
      writeActionsEnabled: false,
      externalResearchEnabled: false,
      actorScope: { organizationId: "org_1", userId: "user_1" },
    }));
  });

  test("returns the same safe not-found response for another-user and another-org conversation IDs", async () => {
    const service = buildService();
    service.getConversation.mockRejectedValue(new AssistantServiceError("ASSISTANT_CONVERSATION_NOT_FOUND", "Conversation not found.", 404));
    const { app } = buildApp(service);

    const otherUser = await request(app).get("/api/assistant/conversations/conversation_other_user").expect(404);
    const otherOrg = await request(app).get("/api/assistant/conversations/conversation_other_org").expect(404);

    expect(otherUser.body).toEqual(otherOrg.body);
    expect(otherUser.body.error.code).toBe("conversation_not_found");
    expect(service.getConversation).toHaveBeenCalledWith({ organizationId: "org_1", userId: "user_1" }, "conversation_other_user");
  });

  test("keeps server presentation metadata out of the visible card collection", async () => {
    const service = buildService();
    service.getConversation.mockResolvedValue({
      ...conversation,
      messages: [{
        id: "message_2", conversationId: conversation.id, turnId: "turn_1", role: "assistant", content: "You're viewing Order ORD-20003.", createdAt: new Date(NOW),
        structuredCards: [
          { kind: "response_presentation", title: "Response presentation", summary: "Server metadata", sourceLinks: [], presentation: "conversational" },
          { kind: "current_context", title: "navigation.get_current_context", summary: "You're viewing Order ORD-20003.", sourceLinks: [] },
        ],
      }],
    });
    const { app } = buildApp(service);

    const response = await request(app).get("/api/assistant/conversations/conversation_1").expect(200);

    expect(response.body.data.messages[0]).toEqual(expect.objectContaining({
      presentation: "conversational",
      responseState: { kind: "success", retryable: false, diagnosticsAvailable: false },
    }));
    expect(response.body.data.messages[0].structuredCards).toEqual([
      expect.objectContaining({ kind: "current_context" }),
    ]);
  });

  test("classifies each response independently so a prior failure cannot make a successful answer retryable", async () => {
    const service = buildService();
    service.getConversation.mockResolvedValue({
      ...conversation,
      messages: [
        { id: "message_failed", conversationId: conversation.id, turnId: "turn_1", role: "assistant", content: "Retry later.", createdAt: new Date(NOW), structuredCards: [{ kind: "provider_unavailable", title: "Unavailable", summary: "Retry later.", sourceLinks: [], toolStatus: "failed" }] },
        { id: "message_success", conversationId: conversation.id, turnId: "turn_2", role: "assistant", content: "I can help with that.", createdAt: new Date(NOW), structuredCards: [{ kind: "notice", title: "Assistant capabilities", body: "I can help with that.", tone: "info" }] },
      ],
    });
    const { app } = buildApp(service);

    const response = await request(app).get("/api/assistant/conversations/conversation_1").expect(200);

    expect(response.body.data.messages.map((message: any) => message.responseState)).toEqual([
      { kind: "retryable_failure", retryable: true, diagnosticsAvailable: true },
      { kind: "success", retryable: false, diagnosticsAvailable: false },
    ]);
  });

  test("ignores untrusted organization identity in a turn payload", async () => {
    const service = buildService();
    const { app } = buildApp(service);
    const response = await request(app)
      .post("/api/assistant/conversations/conversation_1/turns")
      .send({ ...turnBody({ organizationId: "org_attacker" }), organizationId: "org_attacker" })
      .expect(201);

    expect(response.headers["x-assistant-correlation-id"]).toBe("correlation_1");
    expect(service.createTurn).toHaveBeenCalledWith(
      { organizationId: "org_1", userId: "user_1" },
      "conversation_1",
      expect.objectContaining({ userId: "user_1" }),
      expect.objectContaining({ context: expect.not.objectContaining({ organizationId: expect.anything() }) }),
    );
  });

  test("disabled assistant rejects turns without calling any provider or domain dependency", async () => {
    const service = buildService();
    service.createTurn.mockRejectedValue(new AssistantServiceError("ASSISTANT_DISABLED", "Disabled", 503));
    const { app } = buildApp(service);

    const response = await request(app).post("/api/assistant/conversations/conversation_1/turns").send(turnBody()).expect(503);
    expect(response.body.error.code).toBe("assistant_disabled");
    expect(service.createTurn).toHaveBeenCalledTimes(1);
  });

  test("selects an opaque persisted candidate using only authenticated scope and server-derived actor", async () => {
    const service = buildService();
    const reportResolutionService = {
      selectReportResolution: jest.fn(async () => ({
        resolution: {
          resolutionId: "resolution_1", conversationId: "conversation_1", version: 3, status: "resumed",
          expiresAt: "2026-07-22T13:00:00.000Z", candidates: [
            { candidateId: "candidate_1", companyName: "Bright Signs Marketing", matchReason: "Exact company match", companyLink: { label: "Open company", href: "/customers/customer_1", entityType: "customer", entityId: "customer_1" } },
            { candidateId: "candidate_2", companyName: "Bright Signs of Ohio", matchReason: "Exact company match", companyLink: { label: "Open company", href: "/customers/customer_2", entityType: "customer", entityId: "customer_2" } },
          ], cancellationAvailable: false,
        },
        continuation: {
          resolutionId: "resolution_1", version: 3, status: "resumed", turnId: "turn_2", correlationId: "correlation_2",
          message: { id: "message_3", role: "assistant", content: "Bright Signs Marketing's report is ready.", structuredCards: [], provider: "local", model: "analytics", correlationId: "correlation_2", createdAt: NOW },
        },
      })),
    };
    const { app } = buildApp(service, { reportResolutionService });

    const response = await request(app)
      .post("/api/assistant/report-resolutions/resolution_1/select")
      .send({ candidateId: "candidate_1", expectedVersion: 2 })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(reportResolutionService.selectReportResolution).toHaveBeenCalledWith(
      { organizationId: "org_1", userId: "user_1" },
      "resolution_1",
      expect.objectContaining({ userId: "user_1" }),
      { candidateId: "candidate_1", expectedVersion: 2 },
    );
  });

  test("rejects company ids and identity-shaped selection input before continuation", async () => {
    const service = buildService();
    const reportResolutionService = { selectReportResolution: jest.fn() };
    const { app } = buildApp(service, { reportResolutionService });

    const response = await request(app)
      .post("/api/assistant/report-resolutions/resolution_1/select")
      .send({ candidateId: "candidate_1", expectedVersion: 2, companyId: "customer_attacker", organizationId: "org_attacker" })
      .expect(400);

    expect(response.body.error.code).toBe("context_invalid");
    expect(reportResolutionService.selectReportResolution).not.toHaveBeenCalled();
  });

  test("returns the same safe error for tenant/user-hidden report resolutions", async () => {
    const service = buildService();
    const reportResolutionService = {
      selectReportResolution: jest.fn(async () => {
        throw { code: "REPORT_RESOLUTION_NOT_FOUND" };
      }),
    };
    const { app } = buildApp(service, { reportResolutionService });

    const response = await request(app)
      .post("/api/assistant/report-resolutions/resolution_other_tenant/select")
      .send({ candidateId: "candidate_1", expectedVersion: 2 })
      .expect(404);

    expect(response.body.error).toEqual({
      code: "report_resolution_not_found",
      message: "Report selection not found.",
      retryable: false,
    });
  });
});
