import { describe, expect, test } from "@jest/globals";
import {
  readPbv2OverrideConfig,
  selectPbv2TreeVersionIdForEvaluation,
  writePbv2OverrideConfig,
} from "../lib/pbv2OverrideConfig";

describe("pbv2OverrideConfig", () => {
  test("readPbv2OverrideConfig defaults", () => {
    expect(readPbv2OverrideConfig(undefined)).toEqual({ enabled: false, treeVersionId: null });
    expect(readPbv2OverrideConfig(null)).toEqual({ enabled: false, treeVersionId: null });
    expect(readPbv2OverrideConfig({})).toEqual({ enabled: false, treeVersionId: null });
  });

  test("writePbv2OverrideConfig merges into pricingProfileConfig", () => {
    const next = writePbv2OverrideConfig({ foo: 1 }, { enabled: true, treeVersionId: "tv_123" });

    expect(next.foo).toBe(1);
    expect(next.pbv2Override.enabled).toBe(true);
    expect(next.pbv2Override.treeVersionId).toBe("tv_123");
    expect(typeof next.pbv2Override.updatedAt).toBe("string");
  });

  test("selectPbv2TreeVersionIdForEvaluation chooses active when override disabled", () => {
    const id = selectPbv2TreeVersionIdForEvaluation({
      activeTreeVersionId: "tv_active",
      pricingProfileConfig: { pbv2Override: { enabled: false, treeVersionId: "tv_override" } },
    });
    expect(id).toBe("tv_active");
  });

  test("selectPbv2TreeVersionIdForEvaluation chooses override when enabled", () => {
    const id = selectPbv2TreeVersionIdForEvaluation({
      activeTreeVersionId: "tv_active",
      pricingProfileConfig: { pbv2Override: { enabled: true, treeVersionId: "tv_override" } },
    });
    expect(id).toBe("tv_override");
  });

  test("selectPbv2TreeVersionIdForEvaluation throws 409 when enabled but missing override id", () => {
    try {
      selectPbv2TreeVersionIdForEvaluation({
        activeTreeVersionId: "tv_active",
        pricingProfileConfig: { pbv2Override: { enabled: true } },
      });
      throw new Error("Expected to throw");
    } catch (e: any) {
      expect(e?.statusCode).toBe(409);
      expect(String(e?.message ?? "")).toMatch(/override is enabled/i);
    }
  });
});
