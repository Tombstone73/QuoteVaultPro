import { describe, expect, test } from "@jest/globals";
import { requireV2M0CloneDatabaseUrl, UnsafeV2M0CloneError, V2_M0_WRITE_OPT_IN } from "../../infrastructure/persistence/cloneSafety";

const cloneUrl = "postgresql://tester:secret@localhost:5432/neondb?sslmode=require";

describe("V2 M0 disposable clone safety", () => {
  test("requires explicit opt-in and uses only TEST_DATABASE_URL", () => {
    expect(() => requireV2M0CloneDatabaseUrl({ TEST_DATABASE_URL: cloneUrl })).toThrow(UnsafeV2M0CloneError);
    expect(requireV2M0CloneDatabaseUrl({ [V2_M0_WRITE_OPT_IN]: "1", TEST_DATABASE_URL: cloneUrl })).toBe(cloneUrl);
  });

  test("fails closed when any other database connection URL is available", () => {
    expect(() => requireV2M0CloneDatabaseUrl({
      [V2_M0_WRITE_OPT_IN]: "1",
      TEST_DATABASE_URL: cloneUrl,
      DATABASE_URL: "postgresql://app:secret@localhost:5432/app",
    })).toThrow(/other database connection URL/i);
    expect(() => requireV2M0CloneDatabaseUrl({
      [V2_M0_WRITE_OPT_IN]: "1",
      TEST_DATABASE_URL: cloneUrl,
      DEV_DATABASE_URL: "postgresql://app:secret@localhost:5432/dev",
    })).toThrow(/other database connection URL/i);
  });

  test("does not require a test marker in an operator-approved clone database name", () => {
    expect(requireV2M0CloneDatabaseUrl({
      [V2_M0_WRITE_OPT_IN]: "1",
      TEST_DATABASE_URL: cloneUrl,
    })).toContain("/neondb");
  });
});
