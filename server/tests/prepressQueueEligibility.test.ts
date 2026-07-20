import { describe, expect, test } from "@jest/globals";

import { filterPrepressOwnedLineItemIds } from "../services/prepressQueueEligibility";

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
});
