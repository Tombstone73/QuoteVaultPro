import { describe, expect, jest, test } from "@jest/globals";
import { createAssistantProductionReportingToolAdapters, productionDateWindow } from "../services/assistant/productionReportingTools";

const capturedAt = "2026-07-21T12:00:00.000Z";
const context = {
  scope: { organizationId: "org-a", userId: "user-a" },
  actor: { userId: "user-a", email: null },
  permissions: ["assistant.internal_staff"],
  context: { contextVersion: "v1" as const, route: "/production/flatbed", pageTitle: "Flatbed", selectedRecordIds: [], activeFilters: [], capturedAt, unsavedChanges: false },
  correlationId: "correlation-1",
  signal: new AbortController().signal,
};

function repository(overrides: Record<string, unknown> = {}) {
  return {
    getStations: jest.fn(async () => [
      { id: "station-flatbed", key: "flatbed", name: "Flatbed", active: true },
      { id: "station-roll", key: "roll", name: "Roll", active: false },
    ]),
    getOrganizationTimezone: jest.fn(async () => "America/New_York"),
    getStationAggregates: jest.fn(async () => [
      { stationKey: "flatbed", activeJobs: 3, queuedJobs: 2, inProductionJobs: 1, overdueJobs: 1, dueTodayJobs: 1, dueTomorrowJobs: 1 },
      { stationKey: "roll", activeJobs: 0, queuedJobs: 0, inProductionJobs: 0, overdueJobs: 0, dueTodayJobs: 0, dueTomorrowJobs: 0 },
    ]),
    listUrgentJobs: jest.fn(async () => [{
      jobId: "job-1", orderId: "order-1", orderNumber: "ORD-20017", customerName: "T3 Signs", label: "Yard signs",
      stationKey: "flatbed", status: "queued", dueDate: "2026-07-21T17:00:00.000Z", createdAt: "2026-07-19T12:00:00.000Z", updatedAt: capturedAt,
    }]),
    getOldestActiveJob: jest.fn(async () => null),
    ...overrides,
  };
}

describe("assistant production reporting tools", () => {
  test("returns tenant-scoped station metrics, an internal job link, and an inactive-station flag", async () => {
    const repo = repository();
    const tools = createAssistantProductionReportingToolAdapters({ repository: repo as any, now: () => new Date(capturedAt) });
    const result = await tools["production.get_queue_summary"]!.execute({ stationKey: "flatbed", limit: 5 }, context);

    expect(result.status).toBe("succeeded");
    expect(result.data).toMatchObject({
      timezone: "America/New_York",
      stations: [{ stationKey: "flatbed", active: true, activeJobs: 3, queuedJobs: 2, inProductionJobs: 1, overdueJobs: 1 }],
      urgentJobs: [{ orderNumber: "ORD-20017", status: "Queued", sourceLink: { href: "/production/jobs/job-1" } }],
    });
    expect(repo.getStationAggregates).toHaveBeenCalledWith("org-a", expect.any(Object), expect.objectContaining({ stationKey: "flatbed" }));
  });

  test("does not turn an unknown station into a successful zero queue", async () => {
    const repo = repository();
    const tools = createAssistantProductionReportingToolAdapters({ repository: repo as any, now: () => new Date(capturedAt) });
    const result = await tools["production.get_queue_summary"]!.execute({ stationKey: "fabrication" }, context);

    expect(result).toMatchObject({ status: "not_found", data: null, warning: expect.stringContaining("No active production station") });
    expect(repo.getStationAggregates).not.toHaveBeenCalled();
  });

  test("resolves a human Flatbed alias only through the active tenant station list", async () => {
    const repo = repository();
    const tools = createAssistantProductionReportingToolAdapters({ repository: repo as any, now: () => new Date(capturedAt) });
    const result = await tools["production.get_queue_summary"]!.execute({ stationKey: "Flat bed printing", limit: 5 }, context);

    expect(result.status).toBe("succeeded");
    expect((result.data as any).stations).toEqual([expect.objectContaining({ stationKey: "flatbed", stationLabel: "Flatbed" })]);
    expect(repo.getStationAggregates).toHaveBeenCalledWith("org-a", expect.any(Object), expect.objectContaining({ stationKey: "flatbed" }));
  });

  test("does not query an inactive station alias", async () => {
    const repo = repository();
    const tools = createAssistantProductionReportingToolAdapters({ repository: repo as any, now: () => new Date(capturedAt) });
    const result = await tools["production.get_queue_summary"]!.execute({ stationKey: "Wide roll" }, context);

    expect(result).toMatchObject({ status: "not_found", warning: expect.stringContaining("inactive") });
    expect(repo.getStationAggregates).not.toHaveBeenCalled();
  });

  test("keeps unsupported artwork waiting unavailable and reuses canonical operational queues", async () => {
    const repo = repository();
    const tools = createAssistantProductionReportingToolAdapters({
      repository: repo as any,
      now: () => new Date(capturedAt),
      getOperationalSummary: async () => ({ inboundOrders: 0, overview: 3, design: 0, proofing: 2, prepress: 4, flatbed: 3, roll: 0, fulfillment: 5, invoices: { pendingSend: 0, unpaid: 0 } }),
    });
    const result = await tools["operations.get_attention_summary"]!.execute({}, context);

    expect(result.status).toBe("succeeded");
    const data = result.data as any;
    expect(data.totalActiveJobs).toBe(3);
    expect(data.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "waiting_artwork", available: false, count: null }),
      expect.objectContaining({ key: "waiting_proof", available: true, count: 2 }),
      expect.objectContaining({ key: "ready_for_fulfillment", available: true, count: 5 }),
    ]));
  });

  test("applies an overdue filter to the production read and labels matching attention items", async () => {
    const repo = repository();
    const tools = createAssistantProductionReportingToolAdapters({ repository: repo as any, now: () => new Date(capturedAt) });
    const result = await tools["operations.get_attention_summary"]!.execute({ filter: "overdue", limit: 5 }, context);

    expect(result.status).toBe("succeeded");
    expect(repo.getStationAggregates).toHaveBeenCalledWith("org-a", expect.any(Object), expect.objectContaining({ due: "overdue" }));
    expect(repo.listUrgentJobs).toHaveBeenCalledWith("org-a", expect.any(Object), expect.objectContaining({ due: "overdue", limit: 5 }));
    expect((result.data as any).attentionItems).toEqual([expect.objectContaining({ orderNumber: "ORD-20017", reason: "Overdue" })]);
  });

  test("uses bounded canonical fulfillment orders instead of generic production jobs", async () => {
    const repo = repository({
      listReadyForFulfillmentOrders: jest.fn(async () => [{
        orderId: "order-fulfillment", orderNumber: "ORD-20019", customerName: "T3 Signs", fulfillmentStatus: "ready",
        dueDate: "2026-07-22T15:00:00.000Z", readySince: "2026-07-21T08:00:00.000Z",
      }]),
    });
    const tools = createAssistantProductionReportingToolAdapters({
      repository: repo as any,
      now: () => new Date(capturedAt),
      getOperationalSummary: async () => ({ inboundOrders: 0, overview: 3, design: 0, proofing: 0, prepress: 0, flatbed: 3, roll: 0, fulfillment: 2, invoices: { pendingSend: 0, unpaid: 0 } }),
    });
    const result = await tools["operations.get_attention_summary"]!.execute({ filter: "ready_for_fulfillment", limit: 1 }, context);

    expect(result.status).toBe("succeeded");
    expect(repo.listUrgentJobs).not.toHaveBeenCalled();
    expect(repo.listReadyForFulfillmentOrders).toHaveBeenCalledWith("org-a", 1);
    expect((result.data as any).attentionItems).toEqual([expect.objectContaining({
      orderNumber: "ORD-20019", stationLabel: "Fulfillment", reason: "Ready for fulfillment", sourceLink: expect.objectContaining({ href: "/orders/order-fulfillment" }),
    })]);
    expect((result.data as any).warnings).toContain("Showing the first 1 of 2 ready-for-fulfillment orders.");
  });

  test("keeps the requested urgency limit and applies the urgent reason", async () => {
    const repo = repository();
    const tools = createAssistantProductionReportingToolAdapters({ repository: repo as any, now: () => new Date(capturedAt) });
    const result = await tools["operations.get_attention_summary"]!.execute({ filter: "urgent", limit: 5 }, context);

    expect(result.status).toBe("succeeded");
    expect(repo.listUrgentJobs).toHaveBeenCalledWith("org-a", expect.any(Object), expect.objectContaining({ limit: 5 }));
    expect((result.data as any).attentionItems).toEqual([expect.objectContaining({ reason: "Urgent production work" })]);
  });

  test("computes day boundaries in the organization timezone, including daylight-saving offsets", () => {
    const summer = productionDateWindow(new Date("2026-07-21T12:00:00.000Z"), "America/New_York");
    const winter = productionDateWindow(new Date("2026-01-21T12:00:00.000Z"), "America/New_York");
    expect(summer.startOfToday.toISOString()).toBe("2026-07-21T04:00:00.000Z");
    expect(winter.startOfToday.toISOString()).toBe("2026-01-21T05:00:00.000Z");
  });
});
