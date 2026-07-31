import { describe, expect, jest, test } from "@jest/globals";
import { assistantCompletedJobReportInputSchema } from "@shared/assistantContracts";
import { createAssistantCompletedJobReportingToolAdapters } from "../services/assistant/completedJobReportingTools";
import { resolveDeterministicReadPlan } from "../services/assistant/deterministicReadRouting";

const capturedAt = "2026-07-21T12:00:00.000Z";
const context = {
  scope: { organizationId: "org-a", userId: "user-a" },
  actor: { userId: "user-a", email: null },
  permissions: ["assistant.internal_staff"],
  context: { contextVersion: "v1" as const, route: "/production", pageTitle: "Production", selectedRecordIds: [], activeFilters: [], capturedAt, unsavedChanges: false },
  correlationId: "correlation-1",
  signal: new AbortController().signal,
};

function repository(overrides: Record<string, unknown> = {}) {
  return {
    countCompletedJobs: jest.fn(async () => 1),
    listCompletedJobs: jest.fn(async () => [{
      productionJobId: "job-20002", orderId: "order-20002", orderNumber: "ORD-20002", customerName: "Graphic Solutions",
      productOrLineItemDescription: "PVC board", quantity: "4", productionStatus: "done", completedAt: "2026-07-20T16:00:00.000Z", invoiceState: "not_invoiced",
    }]),
    ...overrides,
  };
}

describe("customer-scoped completed-job reporting", () => {
  test("routes the exact done-last-week-and-this-week request away from uninvoiced orders", () => {
    const plan = resolveDeterministicReadPlan("Give me a report of all jobs for Graphic Solutions that were done last week and this week.");
    expect(plan).toMatchObject({
      intent: "production_reporting",
      selectedSkill: "deterministic_customer_completed_job_report",
      toolCalls: [{ toolName: "production.get_completed_jobs", arguments: { completed: "last_week_through_current_week", customer: { name: "Graphic Solutions" }, limit: 10 } }],
    });
    expect(plan?.toolCalls.some((call) => call.toolName === "analytics.customer_uninvoiced_orders")).toBe(false);
    expect(assistantCompletedJobReportInputSchema.safeParse(plan?.toolCalls[0]?.arguments).success).toBe(true);
  });

  test("uses tenant-scoped customer id and the Monday calendar range against canonical job completion", async () => {
    const repo = repository();
    const timezoneRepository = { getOrganizationTimezone: jest.fn(async () => "America/New_York") };
    const tool = createAssistantCompletedJobReportingToolAdapters({ repository: repo as any, timezoneRepository, now: () => new Date(capturedAt) })["production.get_completed_jobs"]!;

    const result = await tool.execute({ completed: "last_week_through_current_week", customer: { id: "customer-graphic", name: "Graphic Solutions" } }, context);

    expect(repo.countCompletedJobs).toHaveBeenCalledWith("org-a", {
      rangeStart: new Date("2026-07-13T04:00:00.000Z"),
      rangeEnd: new Date("2026-07-27T04:00:00.000Z"),
    }, { customerId: "customer-graphic", limit: 10 });
    expect(repo.listCompletedJobs).toHaveBeenCalledWith("org-a", expect.any(Object), { customerId: "customer-graphic", limit: 10 });
    expect(result).toMatchObject({
      status: "succeeded",
      data: { totalMatchingJobs: 1, jobs: [{ productionJobId: "job-20002", quantity: 4, productionStatus: "done", invoiceState: "not_invoiced", sourceLink: { href: "/production/jobs/job-20002" }, orderSourceLink: { href: "/orders/order-20002" } }] },
    });
  });

  test("returns an empty completed-job report successfully and rejects unresolved customer input", async () => {
    const repo = repository({ countCompletedJobs: jest.fn(async () => 0), listCompletedJobs: jest.fn(async () => []) });
    const tool = createAssistantCompletedJobReportingToolAdapters({ repository: repo as any, timezoneRepository: { getOrganizationTimezone: jest.fn(async () => "America/New_York") }, now: () => new Date(capturedAt) })["production.get_completed_jobs"]!;

    await expect(tool.execute({ completed: "last_week_through_current_week", customer: { id: "customer-graphic" } }, context)).resolves.toMatchObject({ status: "succeeded", data: { totalMatchingJobs: 0, jobs: [] } });
    await expect(tool.execute({ completed: "last_week_through_current_week", customer: { name: "Graphic Solutions" } }, context)).rejects.toThrow("adapter_failed");
  });
});
