import { describe, expect, test } from "@jest/globals";

import {
  shouldApplyQuoteConversionProductionIntake,
  shouldCreateLegacyProductionJob,
} from "../services/productionIntakePolicy";

describe("production intake policy", () => {
  test("preserves the existing legacy job behavior by default", () => {
    expect(shouldCreateLegacyProductionJob({
      lineItemRole: "standalone",
      workflowState: "ready_for_prepress",
    })).toBe(true);
    expect(shouldApplyQuoteConversionProductionIntake()).toBe(true);
  });

  test("never auto-creates legacy or modern production ownership when deferred", () => {
    expect(shouldCreateLegacyProductionJob({
      policy: "deferred",
      lineItemRole: "standalone",
      workflowState: "ready_for_production",
    })).toBe(false);
    expect(shouldApplyQuoteConversionProductionIntake("deferred")).toBe(false);
  });

  test("continues to exclude parent bundle lines from legacy production jobs", () => {
    expect(shouldCreateLegacyProductionJob({
      lineItemRole: "parent",
      workflowState: "ready_for_production",
    })).toBe(false);
  });

  test("rejects unknown policies instead of silently choosing production behavior", () => {
    expect(() => shouldCreateLegacyProductionJob({
      policy: "unexpected" as any,
      lineItemRole: "standalone",
      workflowState: "ready_for_production",
    })).toThrow("Unknown production intake policy.");
  });
});
