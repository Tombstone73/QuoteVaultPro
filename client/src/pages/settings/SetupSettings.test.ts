import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import { normalizeSystemSetupSequenceValue } from "@/lib/systemSetupSettings";

describe("System Setup sequence normalization", () => {
  test("numeric frontend value becomes a string payload value", () => {
    expect(normalizeSystemSetupSequenceValue(20000)).toBe("20000");
  });

  test("string numeric value remains valid and preserves leading zeros", () => {
    expect(normalizeSystemSetupSequenceValue("020000")).toBe("020000");
  });

  test("blank, decimal, and negative values are rejected before mutation", () => {
    expect(() => normalizeSystemSetupSequenceValue("")).toThrow("positive whole number");
    expect(() => normalizeSystemSetupSequenceValue("10.5")).toThrow("positive whole number");
    expect(() => normalizeSystemSetupSequenceValue("-1")).toThrow("positive whole number");
  });

  test("save success refetches global variables settings", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "client/src/pages/settings/SetupSettings.tsx"), "utf8");
    expect(source).toContain('queryClient.invalidateQueries({ queryKey: ["/api/global-variables"] })');
  });
});
