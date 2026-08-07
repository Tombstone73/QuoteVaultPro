import { describe, expect, jest, test } from "@jest/globals";
import { assistantProviderPlanSchema } from "@shared/assistantContracts";
import {
  ASSISTANT_PLATFORM_MAX_TOOL_TIMEOUT_MS,
  createAssistantToolRegistry,
  validateAssistantToolResult,
} from "../services/assistant/toolRegistry";
import { AssistantOrchestrationService, AssistantToolExecutionError, normalizeAssistantToolArguments } from "../services/assistant/orchestration";

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
  test("contains only the registered read-only tools", () => {
    const registry = createAssistantToolRegistry();
    expect([...registry.keys()]).toEqual([
      "search.global",
      "quotes.search",
      "customers.get_summary",
      "orders.get_summary",
      "products.get_summary",
      "reports.operational_summary",
      "navigation.get_current_context",
      "production.get_queue_summary",
      "operations.get_attention_summary",
      "orders.get_due_summary",
      "production.get_completed_jobs",
      "analytics.resolve_customer",
      "analytics.customer_product_sales",
      "analytics.customer_uninvoiced_orders",
    ]);
    for (const tool of registry.values()) {
      expect(tool.readOnly).toBe(true);
      expect(tool.timeoutMs).toBeGreaterThan(0);
      expect(tool.timeoutMs).toBeLessThanOrEqual(ASSISTANT_PLATFORM_MAX_TOOL_TIMEOUT_MS);
      expect(tool.maxResults).toBeGreaterThan(0);
    }
  });

  test("uses the registered five-second deadline for the multi-query order summary", () => {
    const orderSummary = createAssistantToolRegistry().get("orders.get_summary")!;
    expect(orderSummary.timeoutMs).toBe(5_000);
    expect(orderSummary.timeoutMs).toBeLessThanOrEqual(ASSISTANT_PLATFORM_MAX_TOOL_TIMEOUT_MS);
  });

  test("normalizes only a safe numeric order summary number at the registered-tool boundary", () => {
    expect(normalizeAssistantToolArguments("orders.get_summary", { orderNumber: 1112 })).toEqual({ orderNumber: "1112" });
    expect(normalizeAssistantToolArguments("orders.get_summary", { orderNumber: "ORD-1112" })).toEqual({ orderNumber: "ORD-1112" });
    for (const orderNumber of [-1, 11.12, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, true, null, {}, []]) {
      expect(normalizeAssistantToolArguments("orders.get_summary", { orderNumber })).toEqual({ orderNumber });
    }
    expect(normalizeAssistantToolArguments("search.global", { query: 1112 })).toEqual({ query: 1112 });
  });

  test("passes the normalized order number as a string and records value-free validation diagnostics", async () => {
    const execute = jest.fn(async () => ({
      status: "not_found" as const,
      data: { reason: "not_found" },
      provenance: { sourceLinks: [], freshness: { capturedAt } },
    }));
    const audit = jest.fn();
    const service = new AssistantOrchestrationService({ "orders.get_summary": { execute } }, audit);
    await service.executePlan({
      intent: "lookup", selectedSkill: "order", clarificationRequired: false, clarificationQuestion: null, responseStyle: "concise",
      toolCalls: [{ toolName: "orders.get_summary", arguments: { orderNumber: 1112, organizationId: "other_org", roles: ["owner"] } }],
    }, trustedContext);
    expect(execute).toHaveBeenCalledWith({ orderNumber: "1112" }, expect.objectContaining({ scope: { organizationId: "org_1", userId: "user_1" } }));

    const invalid = await service.executePlan({
      intent: "lookup", selectedSkill: "order", clarificationRequired: false, clarificationQuestion: null, responseStyle: "concise",
      toolCalls: [{ toolName: "orders.get_summary", arguments: { number: 1112 } }],
    }, trustedContext);
    expect(invalid.executions).toEqual([expect.objectContaining({ status: "rejected", warning: "The tool request could not be validated." })]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenLastCalledWith(expect.objectContaining({
      failureCode: "invalid_arguments",
      validationDiagnostic: expect.objectContaining({ stage: "request_validation", fieldPath: "root" }),
    }));
    expect(JSON.stringify(audit.mock.calls)).not.toContain("1112");

    await service.executePlan({
      intent: "lookup", selectedSkill: "order", clarificationRequired: false, clarificationQuestion: null, responseStyle: "concise",
      toolCalls: [{ toolName: "orders.get_summary", arguments: { orderNumber: true } }],
    }, trustedContext);
    expect(audit).toHaveBeenLastCalledWith(expect.objectContaining({
      validationDiagnostic: expect.objectContaining({ fieldPath: "orderNumber", expectedPrimitiveType: "string", receivedPrimitiveType: "boolean" }),
    }));
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

  test("accepts a successful empty due-date report without inventing a source link", () => {
    const dueSummary = createAssistantToolRegistry().get("orders.get_due_summary")!;
    const emptyReport = {
      status: "succeeded" as const,
      data: {
        totalMatchingOrders: 0,
        orders: [],
        timezone: "America/New_York",
        warnings: [],
      },
      provenance: {
        sourceLinks: [],
        freshness: { capturedAt },
      },
    };

    expect(dueSummary.sourceLinkBehavior).toBe("optional");
    expect(validateAssistantToolResult(dueSummary, emptyReport)).toMatchObject({
      status: "succeeded",
      data: { totalMatchingOrders: 0, orders: [] },
    });
  });

  test("ignores model identity and authorization fields before adapter invocation", async () => {
    const execute = jest.fn(async () => successfulSearch);
    const audit = jest.fn();
    const service = new AssistantOrchestrationService({ "search.global": { execute } }, audit);

    const output = await service.executePlan({
      intent: "lookup", selectedSkill: "search", clarificationRequired: false, clarificationQuestion: null, responseStyle: "standard",
      toolCalls: [{
        toolName: "search.global",
        arguments: {
          query: "OTB",
          organizationId: "other_org",
          orgId: "other_org",
          tenantId: "other_tenant",
          userId: "other_user",
          permissions: ["admin"],
          roles: ["owner"],
        },
      }],
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

  test("records a distinct safe adapter failure category without retaining the thrown error", async () => {
    const audit = jest.fn();
    const service = new AssistantOrchestrationService(
      { "search.global": { execute: jest.fn(async () => { throw new Error("database password=not-safe-to-store"); }) } },
      audit,
    );

    const output = await service.executePlan({
      intent: "lookup", selectedSkill: "search", clarificationRequired: false, clarificationQuestion: null, responseStyle: "standard",
      toolCalls: [{ toolName: "search.global", arguments: { query: "OTB" } }],
    }, trustedContext);

    expect(output.executions).toEqual([expect.objectContaining({ status: "failed" })]);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed", failureCode: "adapter_failed", failureCategory: "adapter_failed", failingStep: "adapter_execution", coreResultSucceeded: false,
    }));
  });

  test("records registered result-schema failures separately from adapter failures", async () => {
    const audit = jest.fn();
    const service = new AssistantOrchestrationService(
      { "search.global": { execute: jest.fn(async () => ({ ...successfulSearch, data: { rawRows: [] } })) } },
      audit,
    );

    await service.executePlan({
      intent: "lookup", selectedSkill: "search", clarificationRequired: false, clarificationQuestion: null, responseStyle: "standard",
      toolCalls: [{ toolName: "search.global", arguments: { query: "OTB" } }],
    }, trustedContext);

    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed", failureCode: "result_validation_failed", failureCategory: "result_validation_failed", failingStep: "result_validation", coreResultSucceeded: false,
    }));
  });

  test("preserves an adapter's safe core-query failure classification", async () => {
    const audit = jest.fn();
    const service = new AssistantOrchestrationService(
      { "search.global": { execute: jest.fn(async () => {
        throw new AssistantToolExecutionError("core_query_failed", "core_query_failed", "core_lookup");
      }) } },
      audit,
    );

    await service.executePlan({
      intent: "lookup", selectedSkill: "search", clarificationRequired: false, clarificationQuestion: null, responseStyle: "standard",
      toolCalls: [{ toolName: "search.global", arguments: { query: "OTB" } }],
    }, trustedContext);

    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "core_query_failed", failureCategory: "core_query_failed", failingStep: "core_lookup", coreResultSucceeded: false,
    }));
  });

  test("uses the registered timeout rather than a shorter global deadline", async () => {
    jest.useFakeTimers();
    try {
      const audit = jest.fn();
      const service = new AssistantOrchestrationService(
        { "orders.get_summary": { execute: jest.fn(async () => new Promise(() => undefined)) } },
        audit,
      );
      const execution = service.executePlan({
        intent: "lookup", selectedSkill: "order", clarificationRequired: false, clarificationQuestion: null, responseStyle: "standard",
        toolCalls: [{ toolName: "orders.get_summary", arguments: { orderNumber: "20002" } }],
      }, trustedContext);

      await jest.advanceTimersByTimeAsync(4_999);
      expect(audit).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      await expect(execution).resolves.toMatchObject({ executions: [{ status: "timed_out" }] });
      expect(audit).toHaveBeenCalledWith(expect.objectContaining({
        status: "timed_out", failureCode: "timeout", failureCategory: "timeout", failingStep: "tool_execution",
      }));
    } finally {
      jest.useRealTimers();
    }
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

  test("blocks tenant-wide quote search before its adapter receives an unauthorized actor", async () => {
    const execute = jest.fn(async () => ({ ...successfulSearch, data: { totalMatchingQuotes: 0, quotes: [], appliedFilters: { recencyField: "createdAt", sentAtAvailable: false } } }));
    const service = new AssistantOrchestrationService({ "quotes.search": { execute } });
    const output = await service.executePlan({
      intent: "lookup", selectedSkill: "search", clarificationRequired: false, clarificationQuestion: null, responseStyle: "concise",
      toolCalls: [{ toolName: "quotes.search", arguments: { lifecycle: "open" } }],
    }, { ...trustedContext, permissions: [] });

    expect(output.executions).toEqual([expect.objectContaining({ status: "permission_denied" })]);
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
