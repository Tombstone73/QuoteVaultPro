import { beforeAll, describe, expect, jest, test } from "@jest/globals";
import type { InvestigationRepository } from "../services/investigation/investigationService";
import type { AssistantToolAdapters, AssistantTrustedToolContext } from "../services/assistant/toolRegistry";

// All persistence is synthetic; exercise the real registry, discovery,
// orchestration, traversal, and presentation without providers or dotenv.
jest.unstable_mockModule("../db", () => ({ db: {} }));
let adapters: AssistantToolAdapters = {};
jest.unstable_mockModule("../services/assistant/assistantToolAdapters", () => ({
  createStage2AssistantToolAdapters: () => adapters,
}));
let InvestigationService: typeof import("../services/investigation/investigationService").InvestigationService;
let createAssistantInvestigationToolAdapters: typeof import("../services/assistant/investigationTools").createAssistantInvestigationToolAdapters;
let createAssistantProductionReportingToolAdapters: typeof import("../services/assistant/productionReportingTools").createAssistantProductionReportingToolAdapters;
let createAssistantOperatorToolExecutor: typeof import("../services/assistant/operatorToolExecutor").createAssistantOperatorToolExecutor;
let AssistantOrchestrationService: typeof import("../services/assistant/orchestration").AssistantOrchestrationService;
let assistantToolRegistry: typeof import("../services/assistant/toolRegistry").assistantToolRegistry;
beforeAll(async () => {
  ({ InvestigationService } = await import("../services/investigation/investigationService"));
  ({ createAssistantInvestigationToolAdapters } = await import("../services/assistant/investigationTools"));
  ({ createAssistantProductionReportingToolAdapters } = await import("../services/assistant/productionReportingTools"));
  ({ createAssistantOperatorToolExecutor } = await import("../services/assistant/operatorToolExecutor"));
  ({ AssistantOrchestrationService } = await import("../services/assistant/orchestration"));
  ({ assistantToolRegistry } = await import("../services/assistant/toolRegistry"));
});

const capturedAt = "2026-11-25T12:00:00.000Z";
const context: AssistantTrustedToolContext = {
  scope: { organizationId: "org_a", userId: "staff_a" }, actor: { userId: "staff_a", email: null },
  permissions: ["assistant.internal_staff"], correlationId: "test_investigation",
  context: { contextVersion: "v1", route: "/production", pageTitle: "Production", selectedRecordIds: [], activeFilters: [], capturedAt, unsavedChanges: false },
  signal: new AbortController().signal,
};
const order = { type: "order" as const, id: "order_a", label: "81001", href: "/orders/order_a" };
const job = { type: "production_job" as const, id: "job_a", label: "Job A", href: "/production?jobId=job_a" };
function investigationRepository(): InvestigationRepository {
  return {
    search: jest.fn(async (org: string, query: string, types: readonly string[]) => org !== "org_a" ? []
      : query === "81001" && types.includes("order") ? [{ resource: order, summary: "Open", match: "exact" as const }]
      : query === "job_a" && types.includes("production_job") ? [{ resource: job, summary: "Queued", match: "exact" as const }] : []),
    get: jest.fn(async (org: string, resource: { type: string; id: string }) => org !== "org_a" ? null
      : resource.type === "order" && resource.id === order.id ? { type: "order" as const, resource: order, current: { status: "Open" }, orderNumber: order.label, state: "open", fulfillmentStatus: "pending" }
      : resource.type === "production_job" && resource.id === job.id ? { type: "production_job" as const, resource: job, current: { status: "queued" }, order, line: null, station: "flatbed", step: "print", status: "queued" } : null),
    related: jest.fn(async (org: string, resource: { type: string; id: string }, relationships?: readonly string[]) => org !== "org_a" || relationships && !relationships.includes("has_production_job") ? []
      : resource.type === "order" ? [{ from: order, to: job, relationship: "has_production_job" as const }]
      : [{ from: job, to: order, relationship: "has_production_job" as const }]),
    history: jest.fn(async () => []),
  };
}
function queueRepository() {
  return {
    getStations: jest.fn(async (_org: string) => [{ id: "station_a", key: "flatbed", name: "Flatbed", active: true }]),
    getOrganizationTimezone: jest.fn(async (_org: string) => "UTC"),
    getStationAggregates: jest.fn(async (_org: string, _dates: unknown, _filters: unknown) => [{ stationKey: "flatbed", activeJobs: 30, activeLineItems: 30, uniqueOrders: 30, progressAvailableJobs: 0, confirmedRemainingQuantity: null, queuedJobs: 29, inProductionJobs: 1, overdueJobs: 2, dueTodayJobs: 1, dueTomorrowJobs: 0 }]),
    listUrgentJobs: jest.fn(async (_org: string, _dates: unknown, _filters: unknown) => []),
    getOldestActiveJob: jest.fn(async (_org: string, _filters: unknown) => null),
    getProductionScopeTotals: jest.fn(async (_org: string, _dates: unknown, _filters: unknown) => ({ activeJobs: 30, activeLineItems: 30, uniqueOrders: 30, progressAvailableJobs: 0, confirmedRemainingQuantity: null })),
    listReadyForFulfillmentOrders: jest.fn(async () => []),
  };
}

describe("existing production investigation discovery and qualification", () => {
  test.each(["jobs", "production_job", "has_production_job"])("general discovery %s exposes the existing relationship read", async query => {
    adapters = createAssistantInvestigationToolAdapters(new InvestigationService(investigationRepository()));
    const result = await createAssistantOperatorToolExecutor().execute({ toolName: "application.capabilities", arguments: { query }, context: { ...context, conversationId: "test_conversation", goal: "Discover production reads" } });
    expect((result.result!.data as any).capabilities).toEqual(expect.arrayContaining([expect.objectContaining({ name: "investigation.related" })]));
  });

  test("catalog exposes actual unfinished job filters, without promising a paginated full list", () => {
    const tool = assistantToolRegistry.get("production.get_queue_summary")!;
    expect(tool.providerInputSchema).toMatchObject({ additionalProperties: false, properties: {
      status: { enum: ["queued", "in_progress", "paused"] }, due: { enum: ["overdue", "today", "tomorrow"] },
      includeOverdue: { type: "boolean" }, limit: { maximum: 20 }, stationKey: { type: "string" },
    } });
    expect(tool.description).toMatch(/jobs/i);
    expect(tool.description).toMatch(/no pagination/i);
    expect(tool.inputSchema.safeParse({ status: "unfinished" }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ page: 2 }).success).toBe(false);
  });

  test("relationship provider contract defines the resource identity rather than an opaque object", () => {
    const tool = assistantToolRegistry.get("investigation.related")!;
    expect(tool.providerInputSchema).toMatchObject({ properties: { resource: {
      additionalProperties: false, required: ["type", "id"], properties: { type: { enum: expect.arrayContaining(["order", "production_job"]) }, id: { type: "string", maxLength: 128 } },
    } } });
  });

  test.each<[string, "order" | "production_job", typeof order | typeof job]>([
    ["81001", "order", order], ["job_a", "production_job", job],
  ])("different query %s resolves only the requested identity and qualifies the bounded search", async (query, type, expected) => {
    const repo = investigationRepository();
    const service = new AssistantOrchestrationService(createAssistantInvestigationToolAdapters(new InvestigationService(repo)));
    const result = await service.executeTool("investigation.search", { query, resourceTypes: [type], limit: 2 }, context);
    expect(result.status).toBe("succeeded");
    expect(result.result!.data).toMatchObject({ matches: [{ resource: expected }] });
    expect(result.result!.warning).toMatch(/identity.*not.*exhaustive/i);
    expect(repo.search).toHaveBeenCalledWith("org_a", query, [type], 2);
  });

  test.each<[typeof order | typeof job, typeof order | typeof job]>([[order, job], [job, order]])("traverses %s to its persisted counterpart without a new tool", async (root, target) => {
    const repo = investigationRepository();
    const service = new AssistantOrchestrationService(createAssistantInvestigationToolAdapters(new InvestigationService(repo)));
    const result = await service.executeTool("investigation.related", { resource: { type: root.type, id: root.id }, relationships: ["has_production_job"], depth: 1, limit: 20 }, context);
    expect(result.status).toBe("succeeded");
    expect(result.result!.data).toMatchObject({ root, edges: [{ from: root, to: target, relationship: "has_production_job", depth: 1 }] });
    expect(result.result!.warning).toMatch(/no pagination/i);
    expect(repo.related).toHaveBeenCalledWith("org_a", { type: root.type, id: root.id }, ["has_production_job"]);
  });

  test("limit one search reports partial coverage, not global unique resolution", async () => {
    const service = new AssistantOrchestrationService(createAssistantInvestigationToolAdapters(new InvestigationService(investigationRepository())));
    const result = await service.executeTool("investigation.search", { query: "81001", resourceTypes: ["order"], limit: 1 }, context);
    expect(result).toMatchObject({ status: "partial", result: { status: "partial", warning: expect.stringContaining("does not establish global uniqueness") } });
    expect((result.result!.data as any).matches).toHaveLength(1);
  });

  test("a full source relationship cap is partial coverage even if traversal reports truncated false", async () => {
    const repo = investigationRepository();
    repo.related = jest.fn(async () => Array.from({ length: 20 }, (_, index) => ({ from: order, to: { ...job, id: `job_${index}` }, relationship: "has_production_job" as const })));
    const service = new AssistantOrchestrationService(createAssistantInvestigationToolAdapters(new InvestigationService(repo)));
    const result = await service.executeTool("investigation.related", { resource: { type: "order", id: order.id }, relationships: ["has_production_job"], depth: 1, limit: 20 }, context);
    expect(result).toMatchObject({ status: "partial", result: { status: "partial", data: { truncated: false }, warning: expect.stringContaining("per-relation caps") } });
    expect((result.result!.data as any).edges).toHaveLength(20);
  });

  test("changed tenant returns no foreign identity or relationship, and current grant denial performs no read", async () => {
    const repo = investigationRepository();
    const service = new AssistantOrchestrationService(createAssistantInvestigationToolAdapters(new InvestigationService(repo)));
    for (const [tool, args] of [
      ["investigation.search", { query: "81001", resourceTypes: ["order"] }],
      ["investigation.get", { resource: { type: "production_job", id: job.id } }],
      ["investigation.related", { resource: { type: "order", id: order.id }, relationships: ["has_production_job"] }],
    ] as const) {
      const foreign = await service.executeTool(tool, args, { ...context, scope: { ...context.scope, organizationId: "org_b" } });
      expect(foreign).toMatchObject({ status: "not_found", result: { data: null } });
      expect(JSON.stringify(foreign)).not.toContain("81001");
      jest.clearAllMocks();
      expect(await service.executeTool(tool, args, { ...context, permissions: [] })).toMatchObject({ status: "permission_denied" });
      expect(repo.search).not.toHaveBeenCalled(); expect(repo.get).not.toHaveBeenCalled(); expect(repo.related).not.toHaveBeenCalled();
    }
    const catalog = service.catalog({ permissions: [] });
    expect(catalog.some(tool => tool.name.startsWith("investigation.") || tool.name === "production.get_queue_summary")).toBe(false);
  });

  test.each(["queued", "in_progress", "paused"] as const)("forwards existing %s and deadline filters before the bounded job read", async status => {
    const repo = queueRepository();
    const service = new AssistantOrchestrationService(createAssistantProductionReportingToolAdapters({ repository: repo, now: () => new Date(capturedAt) }));
    const result = await service.executeTool("production.get_queue_summary", { status, stationKey: "flatbed", due: "overdue", limit: 2 }, context);
    expect(result.status).toBe("succeeded");
    expect(repo.listUrgentJobs).toHaveBeenCalledWith("org_a", expect.any(Object), { stationKey: "flatbed", status, due: "overdue", limit: 2 });
    expect(repo.getOldestActiveJob).not.toHaveBeenCalled();
    expect((result.result!.data as any).warnings).toEqual(expect.arrayContaining([expect.stringMatching(/bounded.*no pagination/i)]));
  });

  test("includeOverdue false also omits the unfiltered oldest job instead of borrowing its identity", async () => {
    const repo = queueRepository();
    const service = new AssistantOrchestrationService(createAssistantProductionReportingToolAdapters({ repository: repo, now: () => new Date(capturedAt) }));
    const result = await service.executeTool("production.get_queue_summary", { includeOverdue: false }, context);
    expect(result.status).toBe("succeeded");
    expect(repo.getOldestActiveJob).not.toHaveBeenCalled();
    expect((result.result!.data as any).warnings).toContain("Oldest active job is omitted because its native read does not support deadline filters.");
    expect((result.result!.data as any).stations[0]).not.toHaveProperty("oldestActiveJob");
  });

  test.each([{ page: 2 }, { offset: 20 }, { status: "unfinished" }, { orderId: order.id }])("unsupported job-list arguments %j fail before a read", async args => {
    const repo = queueRepository();
    const service = new AssistantOrchestrationService(createAssistantProductionReportingToolAdapters({ repository: repo }));
    expect(await service.executeTool("production.get_queue_summary", args, context)).toMatchObject({ status: "rejected" });
    expect(repo.getStations).not.toHaveBeenCalled(); expect(repo.listUrgentJobs).not.toHaveBeenCalled();
  });

  test("queue tenant and current permission come from trusted context, never filter arguments", async () => {
    const repo = queueRepository();
    const service = new AssistantOrchestrationService(createAssistantProductionReportingToolAdapters({ repository: repo, now: () => new Date(capturedAt) }));
    await service.executeTool("production.get_queue_summary", { status: "queued" }, { ...context, scope: { ...context.scope, organizationId: "org_b" } });
    expect(repo.listUrgentJobs).toHaveBeenCalledWith("org_b", expect.any(Object), { status: "queued", limit: 10 });
    jest.clearAllMocks();
    expect(await service.executeTool("production.get_queue_summary", {}, { ...context, permissions: [] })).toMatchObject({ status: "permission_denied" });
    expect(repo.getStations).not.toHaveBeenCalled(); expect(repo.listUrgentJobs).not.toHaveBeenCalled();
  });
});
