import { describe, expect, test } from "@jest/globals";

import {
  UnsafeV2M0CloneError,
  V2_M0_WRITE_OPT_IN,
  requireV2M0CloneDatabaseUrl,
} from "../../../infrastructure/persistence/cloneSafety";

describe("V2 M0 disposable clone safety", () => {
  const approved = "postgresql://user:secret@clone.example.test/neondb?sslmode=require";

  test("requires the explicit M0 opt-in and never falls back to an application URL", () => {
    expect(() => requireV2M0CloneDatabaseUrl({ DATABASE_URL: approved })).toThrow(UnsafeV2M0CloneError);
    expect(() => requireV2M0CloneDatabaseUrl({ [V2_M0_WRITE_OPT_IN]: "1" })).toThrow(/TEST_DATABASE_URL is required/i);
  });

  test("accepts the explicitly supplied clone URL when it is the only database connection", () => {
    expect(requireV2M0CloneDatabaseUrl({
      [V2_M0_WRITE_OPT_IN]: "1",
      TEST_DATABASE_URL: approved,
    })).toBe(approved);
  });

  test.each(["DATABASE_URL", "DIRECT_DATABASE_URL", "MIGRATION_DATABASE_URL", "RAILWAY_DATABASE_URL", "NEON_CONNECTION_STRING", "POSTGRES_URL_NON_POOLING", "PGHOST", "V2_DATABASE_URL"])(
    "fails closed when %s is visible to the M0 harness",
    (name) => {
      expect(() => requireV2M0CloneDatabaseUrl({
        [V2_M0_WRITE_OPT_IN]: "1",
        TEST_DATABASE_URL: approved,
        [name]: "postgresql://another:secret@other.example.test/app",
      })).toThrow(/other database connection URL/i);
    },
  );
});
