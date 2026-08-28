import { describe, expect, it } from "@jest/globals";

import { assertDurableCanonicalStorageTarget } from "../services/storageTarget";

describe("durable canonical storage target", () => {
  it("rejects a non-durable local canonical target in production before a file record can be persisted", () => {
    expect(() => assertDurableCanonicalStorageTarget("local_dev", { NODE_ENV: "production" })).toThrow(
      "A durable object-storage target is required for production uploads",
    );
    try {
      assertDurableCanonicalStorageTarget("local_dev", { NODE_ENV: "production" });
    } catch (error: any) {
      expect(error.code).toBe("DURABLE_STORAGE_REQUIRED");
      expect(error.statusCode).toBe(409);
    }
  });

  it("continues to allow durable and development storage targets", () => {
    expect(() => assertDurableCanonicalStorageTarget("supabase", { NODE_ENV: "production" })).not.toThrow();
    expect(() => assertDurableCanonicalStorageTarget("local_dev", { NODE_ENV: "development" })).not.toThrow();
  });
});
