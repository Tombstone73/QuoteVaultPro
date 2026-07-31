import { describe, expect, jest, test } from "@jest/globals";

jest.unstable_mockModule("../productionHelpers", () => ({
  appendEvent: jest.fn(),
}));

const { filterPrepressOwnedLineItemIds, resolvePrepressQueueEligibility } = await import("../services/prepressQueueEligibility");

type Owner = { stationKey: string; stepKey: string };

describe("Prepress queue eligibility shared by queue and sidebar count", () => {
  test("returns zero when workflow-state candidates have no visible Prepress jobs", () => {
    expect(filterPrepressOwnedLineItemIds(["line-1"], new Map<string, Owner>())).toEqual([]);
  });

  test("includes only candidates actively owned by Prepress", () => {
    const owners = new Map<string, Owner>([
      ["line-1", { stationKey: "prepress", stepKey: "prepress" }],
      ["line-2", { stationKey: "flatbed", stepKey: "print" }],
    ]);

    expect(filterPrepressOwnedLineItemIds(["line-1", "line-2"], owners)).toEqual(["line-1"]);
  });

  test("releasing the only Prepress job clears the eligible badge count", () => {
    const candidates = ["line-1"];
    const beforeRelease = new Map<string, Owner>([
      ["line-1", { stationKey: "prepress", stepKey: "prepress" }],
    ]);
    const afterRelease = new Map<string, Owner>([
      ["line-1", { stationKey: "flatbed", stepKey: "print" }],
    ]);

    expect(filterPrepressOwnedLineItemIds(candidates, beforeRelease)).toHaveLength(1);
    expect(filterPrepressOwnedLineItemIds(candidates, afterRelease)).toHaveLength(0);
  });

  test("does not require a customer join before checking Prepress ownership", async () => {
    const joins: string[] = [];
    let selectCount = 0;
    const runner = {
      select: jest.fn(() => {
        selectCount += 1;
        const rows = selectCount === 1
          ? [{ lineItemId: "contact-only-line" }]
          : [{
              id: "job-1",
              orderId: "order-1",
              lineItemId: "contact-only-line",
              stationKey: "prepress",
              stepKey: "prepress",
              status: "queued",
              stationId: "station-prepress",
              totalSeconds: 0,
              startedAt: null,
              completedAt: null,
              createdAt: new Date("2026-07-31T12:00:00.000Z"),
              updatedAt: new Date("2026-07-31T12:00:00.000Z"),
            }];
        const query = {
          from: jest.fn(() => query),
          innerJoin: jest.fn((table: unknown) => {
            joins.push(String((table as { _: { name?: string } })?._?.name ?? ""));
            return query;
          }),
          where: jest.fn(() => query),
          orderBy: jest.fn(() => query),
          then: (resolve: (value: unknown[]) => void) => Promise.resolve(rows).then(resolve),
        };
        return query;
      }),
    };

    const result = await resolvePrepressQueueEligibility(runner, { organizationId: "org_1" });

    expect(result.lineItemIds).toEqual(["contact-only-line"]);
    expect(joins).not.toContain("customers");
  });
});
