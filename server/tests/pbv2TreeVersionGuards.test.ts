import { describe, expect, test } from "@jest/globals";
import { assertPbv2TreeVersionNotDraft } from "../lib/pbv2TreeVersionGuards";

describe("PBV2 tree version guards", () => {
  test("allows non-draft statuses", () => {
    expect(() => assertPbv2TreeVersionNotDraft("PUBLISHED", "recompute")).not.toThrow();
    expect(() => assertPbv2TreeVersionNotDraft("ARCHIVED", "accept")).not.toThrow();
    expect(() => assertPbv2TreeVersionNotDraft(null, "persist")).not.toThrow();
  });

  test("rejects DRAFT with statusCode and context-specific message", () => {
    try {
      assertPbv2TreeVersionNotDraft("DRAFT", "recompute");
      throw new Error("expected throw");
    } catch (e: any) {
      expect(e.statusCode).toBe(409);
      expect(String(e.message)).toMatch(/cannot be recomputed/i);
    }
  });
});
