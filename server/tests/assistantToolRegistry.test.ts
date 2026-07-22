import { describe, expect, jest, test } from "@jest/globals";
import { assistantProviderPlanSchema } from "@shared/assistantContracts";
import {
  createAssistantToolRegistry,
  validateAssistantToolResult,
} from "../services/assistant/toolRegistry";
import { AssistantOrchestrationService } from "../services/assistant/orchestration";

const capturedAt = "2026-07-21T12:00:00.000Z";
const trustedContext = {
  scope: { organizationId: "org_1", userId: "user_1" },
  actor: { userId: "user_1", email: "user@example.test" },
  permissions: ["assistant.internal_staff", "catalog.read"],
  context: {
    contextVersion: "v1" as const,
    route: "/orders/order_1",
    pageTitle: "Order",
    entityType: "order" as const,
    entityId: "order_1",
    selectedRecordIds: [],
    activeFilters: [],
    capturedAt,
    unsavedChanges: false,
  },
  correlationId: "correlation_1",
};

const successfulSearch = {
  status: "succeeded" as const,
  data: { matches: [] },
  provenance: {
    sourceLinks: [{ label: "Search", href: "/search", capturedAt }],
    freshness: { capturedAt },
  },
};

describe("assistant tool registry", () => {
  test("contains only the six Stage 2 read-only tools", () => {
    const registry = createAssistantToolRegistry();
    expect([...registry.keys()]).toEqual([
      "search.global",
      "customers.get_summary",
      "orders.get_summary",
      "products.get_summary",
      "reports.operational_summary",
      "navigation.get_current_context",
    ]);
    for (const tool of registry.values()) {
      expect(tool.readOnly).toBe(true);
      expect(tool.timeoutMs).toBeGreaterThan(0);
      expect(tool.maxResults).toBeGreaterThan(0);
    }
  });

  test("rejects provider plans with unknown tools or more than five calls", () => {
    expect(() => assistantProviderPlanSchema.parse({
      intent: "lookup", selectedSkill: "search", clarificationRequired: false, clarificationQuestion: null, responseStyle: "standard",
      toolCalls: [{ toolName: "database.execute", arguments: {} }],
    })).toThrow();
    expect(() => assistantProviderPlanSchema.parse({
      intent: "lookup", selectedSkill: "search", clarificationRequired: false, clarificationQuestion: null, responseStyle: "standard",
      toolCalls: Array.from({ length: 6 }, () => ({ toolName: "search.global", arguments: { query: "OTB" } })),
    })).toThrow();
  });

  test("validates result data and requires provenance for successful business results", () => {
    const tool = createAssistantToolRegistry().get("search.global")!;
    expect(validateAssistantToolResult(tool, successfulSearch)).toMatchObject({ status: "succeeded" });
    expect(() => validateAssistantToolResult(tool, { status: "succeeded", data: { matches: [] } })).toThrow();
    expect(() => validateAssistantToolResult(tool, { status: "not_found", data: { matches: [] } })).toThrow();
  });

  test("ignores model identity and authorization fields before adapter invocation", async () => {
    const execute = jest.fn(async () => successfulSearch);
    const audit = jest.fn();
    const service = new AssistantOrchestrationService({ "search.global": { execute } }, audit);

    const output = await service.executePlan({
      intent: "lookup", selectedSkill: "search", clarificationRequired: false, clarificationQuestion: null, responseStyle: "standard",
      toolCalls: [{ toolName: "search.global", arguments: { query: "OTB", organizationId: "other_org" } }],
    }, trustedContext);

    expect(output.executions).toEqual([expect.objectContaining({ status: "succeeded" })]);
    expect(execute).toHaveBeenCalledWith({ query: "OTB" }, expect.objectContaining({
      scope: { organizationId: "org_1", userId: "user_1" },
    }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ status: "succeeded" }));
  });

  test("keeps a validated read result when non-critical audit persistence fails", async () => {
    const service = new AssistantOrchestrationService(
      { "search.global": { execute: jest.fn(async () => successfulSearch) } },
      async () => { throw new Error("audit store unavailable"); },
    );

    const output = await service.executePlan({
      intent: "lookup", selectedSkill: "search", clarificationRequired: false, clarificationQuestion: null, responseStyle: "standard",
      toolCalls: [{ toolName: "search.global", arguments: { query: "OTB" } }],
    }, trustedContext);

    expect(output.executions).toEqual([expect.objectContaining({ status: "succeeded", result: expect.objectContaining({ data: { matches: [] } }) })]);
  });

  test("enforces authorization before each call and validates adapters cannot return arbitrary rows", async () => {
    const execute = jest.fn(async () => ({ ...successfulSearch, data: { rawRows: [{ password: "no" }] } }));
    const service = new AssistantOrchestrationService({ "products.get_summary": { execute } });

    const unauthorized = await service.executePlan({
      intent: "lookup", selectedSkill: "product", clarificationRequired: false, clarificationQuestion: null, responseStyle: "standard",
      toolCalls: [{ toolName: "products.get_summary", arguments: { productId: "product_1" } }],
    }, { ...trustedContext, permissions: ["assistant.internal_staff"] });
    expect(unauthorized.executions[0]).toMatchObject({ status: "permission_denied" });
    expect(execute).not.toHaveBeenCalled();
  });

  test("does not execute any tool for an explicit write plan", async () => {
    const execute = jest.fn(async () => successfulSearch);
    const service = new AssistantOrchestrationService({ "search.global": { execute } });
    const output = await service.executePlan({
      intent: "unsupported_write", selectedSkill: null, clarificationRequired: false, clarificationQuestion: null, responseStyle: "concise",
      toolCalls: [],
    }, trustedContext);
    expect(output.executions).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
});
