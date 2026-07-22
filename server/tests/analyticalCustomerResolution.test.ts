import { describe, expect, jest, test } from "@jest/globals";
import {
  AnalyticalCustomerResolutionService,
  patchAnalyticalPlanCustomer,
  type AnalyticalResolutionPersistence,
  type PersistedAnalyticalResolution,
} from "../services/assistant/analyticalCustomerResolution";

const context = {
  contextVersion: "v1" as const,
  route: "/customers",
  pageTitle: "Customers",
  selectedRecordIds: [],
  activeFilters: [],
  capturedAt: "2026-07-22T12:00:00.000Z",
  unsavedChanges: false,
};
const scope = { organizationId: "org-a", userId: "user-a", conversationId: "conversation-a" };
const brightMarketing = { id: "customer-marketing", displayName: "Bright Signs Marketing", updatedAt: new Date(), resolutionType: "company" as const, contactId: null, contactName: null, explanation: "Matched company account Bright Signs Marketing." };
const brightOhio = { id: "customer-ohio", displayName: "Bright Signs of Ohio", updatedAt: new Date(), resolutionType: "company" as const, contactId: null, contactName: null, explanation: "Matched company account Bright Signs of Ohio." };

function plan(customer: Record<string, string> = { name: "Bright Signs" }) {
  return {
    intent: "analytical_reporting" as const,
    selectedSkill: "analytics" as const,
    clarificationRequired: false,
    clarificationQuestion: null,
    responseStyle: "standard" as const,
    toolCalls: [{
      toolName: "analytics.customer_product_sales" as const,
      arguments: {
        customer,
        dateRange: { start: "2026-01-01", end: "2026-06-30" },
        rankingMetric: "revenue",
        limit: 5,
        grouping: "category",
        includeQuantities: false,
        includeInvoiceCounts: true,
        includeOrderCounts: false,
        includeAverageUnitPrice: false,
        interactiveReport: true,
        audience: "customer_safe",
      },
    }],
  };
}

function persistence(): AnalyticalResolutionPersistence & { rows: Map<string, PersistedAnalyticalResolution> } {
  const rows = new Map<string, PersistedAnalyticalResolution>();
  return {
    rows,
    pause: jest.fn(async (input) => {
      const row: PersistedAnalyticalResolution = {
        id: "resolution-a", version: 1, status: "awaiting_entity_resolution", plan: input.plan, context: input.context,
        originalUserRequest: input.originalUserRequest, unresolvedReference: input.unresolvedReference,
        candidates: input.candidates.map((candidate, index) => ({ ...candidate, candidateId: `opaque-${index + 1}` })),
      };
      rows.set(row.id, row);
      return row;
    }),
    load: jest.fn(async (input) => rows.get(input.resolutionId) ?? null),
    claim: jest.fn(async (input) => {
      const row = rows.get(input.resolutionId);
      if (!row) return { kind: "rejected" as const, code: "not_found" as const };
      if (row.status === "resumed") return { kind: "completed" as const, continuationResult: row.continuationResult };
      if (row.status !== "awaiting_entity_resolution") return { kind: "rejected" as const, code: "not_pending" as const };
      if (input.expectedVersion !== row.version) return { kind: "rejected" as const, code: "stale_version" as const };
      if (!row.candidates.some((candidate) => candidate.candidateId === input.candidateId)) return { kind: "rejected" as const, code: "invalid_candidate" as const };
      row.status = "resuming";
      return { kind: "claimed" as const, resolution: row };
    }),
    finish: jest.fn(async (input) => {
      const row = rows.get(input.resolutionId)!;
      row.status = "resumed";
      row.continuationResult = input.continuationResult;
    }),
    fail: jest.fn(async () => undefined),
  };
}

describe("analytical customer resolution preflight", () => {
  test("auto-resolves one canonical purchasing company and preserves reporting arguments", async () => {
    const store = persistence();
    const resolver = { resolveCustomer: jest.fn(async () => ({ customer: brightMarketing, alternatives: [], confidence: "exact" as const })) };
    const service = new AnalyticalCustomerResolutionService(resolver, store);

    const result = await service.preflight({ scope, originalUserRequest: "Top five Bright Signs products", plan: plan(), context });

    expect(result).toMatchObject({ kind: "continue", plan: { toolCalls: [{ arguments: { customer: { id: "customer-marketing", name: "Bright Signs Marketing" }, rankingMetric: "revenue", limit: 5, grouping: "category", interactiveReport: true, audience: "customer_safe" } }] } });
    expect(store.pause).not.toHaveBeenCalled();
  });

  test("pauses ambiguous candidates before financial execution and exposes opaque ids only", async () => {
    const store = persistence();
    const resolver = { resolveCustomer: jest.fn(async () => ({ customer: null, alternatives: [brightMarketing, brightOhio], confidence: "ambiguous" as const })) };
    const service = new AnalyticalCustomerResolutionService(resolver, store);

    const result = await service.preflight({ scope, originalUserRequest: "Top five Bright Signs products", plan: plan(), context });

    expect(result.kind).toBe("awaiting_entity_resolution");
    if (result.kind !== "awaiting_entity_resolution") return;
    expect(result.resolution.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ candidateId: "opaque-1", companyName: "Bright Signs Marketing", companyLink: "/customers/customer-marketing" }),
    ]));
    expect(Object.keys(result.resolution.candidates[0]!)).not.toContain("id");
    expect(store.pause).toHaveBeenCalledTimes(1);
  });

  test("never offers a selection card when atomic pause persistence fails", async () => {
    const store = persistence();
    store.pause = jest.fn(async () => null);
    const resolver = { resolveCustomer: jest.fn(async () => ({ customer: null, alternatives: [brightMarketing, brightOhio], confidence: "ambiguous" as const })) };
    const service = new AnalyticalCustomerResolutionService(resolver, store);
    await expect(service.preflight({ scope, originalUserRequest: "report", plan: plan(), context })).resolves.toMatchObject({ kind: "persistence_failed" });
  });

  test("selection resumes the persisted plan once and replay returns the saved result", async () => {
    const store = persistence();
    const resolver = {
      resolveCustomer: jest.fn(async (organizationId: string, query: string) => query === "Bright Signs"
        ? ({ customer: null, alternatives: [brightMarketing, brightOhio], confidence: "ambiguous" as const })
        : ({ customer: brightMarketing, alternatives: [], confidence: "exact" as const })),
      reloadReportingCompany: jest.fn(async () => brightMarketing),
    };
    const service = new AnalyticalCustomerResolutionService(resolver, store);
    await service.preflight({ scope, originalUserRequest: "report", plan: plan(), context });
    expect(store.rows.has("resolution-a")).toBe(true);
    const execute = jest.fn(async (continued) => ({ continued }));

    const first = await service.continuePersistedPlan({ ...scope, resolutionId: "resolution-a", candidateId: "opaque-1", expectedVersion: 1, execute });
    const replay = await service.continuePersistedPlan({ ...scope, resolutionId: "resolution-a", candidateId: "opaque-1", expectedVersion: 1, execute });

    expect(first).toMatchObject({ kind: "resumed", replayed: false });
    expect(replay).toMatchObject({ kind: "resumed", replayed: true });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0].toolCalls[0]!.arguments).toMatchObject({
      customer: { id: "customer-marketing", name: "Bright Signs Marketing" }, rankingMetric: "revenue", limit: 5, grouping: "category", interactiveReport: true, audience: "customer_safe",
    });
  });

  test("rejects tampered candidate and stale version without executing", async () => {
    const store = persistence();
    const resolver = { resolveCustomer: jest.fn(async () => ({ customer: null, alternatives: [brightMarketing, brightOhio], confidence: "ambiguous" as const })) };
    const service = new AnalyticalCustomerResolutionService(resolver, store);
    await service.preflight({ scope, originalUserRequest: "report", plan: plan(), context });
    const execute = jest.fn();
    await expect(service.continuePersistedPlan({ ...scope, resolutionId: "resolution-a", candidateId: "company-id-from-browser", expectedVersion: 1, execute })).resolves.toEqual({ kind: "rejected", code: "invalid_candidate" });
    await expect(service.continuePersistedPlan({ ...scope, resolutionId: "resolution-a", candidateId: "opaque-1", expectedVersion: 2, execute })).resolves.toEqual({ kind: "rejected", code: "stale_version" });
    expect(execute).not.toHaveBeenCalled();
  });

  test("patch changes only the targeted unresolved customer reference", () => {
    const original = plan({ name: "Bright Signs" });
    const patched = patchAnalyticalPlanCustomer(original, "Bright Signs", brightMarketing);
    expect(patched).toMatchObject({ toolCalls: [{ arguments: { dateRange: original.toolCalls[0]!.arguments.dateRange, rankingMetric: "revenue", limit: 5, grouping: "category", interactiveReport: true, audience: "customer_safe" } }] });
  });
});
