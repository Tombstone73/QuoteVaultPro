import { describe, expect, test } from "@jest/globals";
import { mergeInventoryPolicyIntoPreferences, normalizeInventoryPolicyPatch } from "../inventoryPolicyPreferences";

describe("mergeInventoryPolicyIntoPreferences", () => {
  test("merges inventoryPolicy without clobbering other keys", () => {
    const existing = {
      quotes: { requireApproval: true },
      orders: { requireDueDateForProduction: true },
    };

    const next = mergeInventoryPolicyIntoPreferences(existing, { mode: "advisory" });

    expect(next).toEqual({
      quotes: { requireApproval: true },
      orders: { requireDueDateForProduction: true },
      inventoryPolicy: {
        mode: "advisory",
        autoReserveOnApplyPbV2: false,
        autoReserveOnOrderConfirm: false,
        allowNegative: false,
      },
    });

    // Ensure immutability
    expect(existing).toEqual({
      quotes: { requireApproval: true },
      orders: { requireDueDateForProduction: true },
    });
  });

  test("enabled=false is equivalent to mode off", () => {
    const existing = {
      inventoryPolicy: {
        mode: "enforced",
        allowNegative: true,
      },
      quotes: { requireApproval: false },
    };

    const next = mergeInventoryPolicyIntoPreferences(existing, { enabled: false, mode: "enforced" });

    expect((next as any).quotes).toEqual({ requireApproval: false });
    expect((next as any).inventoryPolicy).toMatchObject({
      mode: "off",
      allowNegative: true,
    });
  });
});

describe("normalizeInventoryPolicyPatch", () => {
  test("mode wins over conflicting enabled", () => {
    const result = normalizeInventoryPolicyPatch({ mode: "advisory", enabled: false });
    expect(result.patch).toEqual({ mode: "advisory" });
    expect(result.warnings).toEqual([
      "Legacy field 'enabled' is deprecated; use 'mode' instead.",
    ]);
  });

  test("enabled=false derives mode off when mode missing", () => {
    const result = normalizeInventoryPolicyPatch({ enabled: false });
    expect(result.patch).toEqual({ mode: "off" });
    expect(result.warnings).toEqual([
      "Legacy field 'enabled' is deprecated; use 'mode' instead.",
    ]);
  });

  test("enforcementMode warn_only => mode advisory", () => {
    const result = normalizeInventoryPolicyPatch({ enforcementMode: "warn_only" });
    expect(result.patch).toEqual({ mode: "advisory" });
    expect(result.warnings).toEqual([
      "Legacy field 'enforcementMode' is deprecated; use 'mode' instead.",
    ]);
  });

  test("enforcementMode block_on_shortage => mode enforced", () => {
    const result = normalizeInventoryPolicyPatch({ enforcementMode: "block_on_shortage" });
    expect(result.patch).toEqual({ mode: "enforced" });
    expect(result.warnings).toEqual([
      "Legacy field 'enforcementMode' is deprecated; use 'mode' instead.",
    ]);
  });

  test("warnings include each legacy field provided", () => {
    const result = normalizeInventoryPolicyPatch({ enabled: true, reservationsEnabled: true, enforcementMode: "off" });
    expect(result.patch.mode).toBe("off");
    expect(result.warnings).toEqual([
      "Legacy field 'enabled' is deprecated; use 'mode' instead.",
      "Legacy field 'reservationsEnabled' is deprecated; use 'mode' instead.",
      "Legacy field 'enforcementMode' is deprecated; use 'mode' instead.",
    ]);
  });
});
