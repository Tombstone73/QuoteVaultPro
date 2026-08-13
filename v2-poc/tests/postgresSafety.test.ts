import { describe, expect, test } from "@jest/globals";
import { requireV2PocPostgresUrl, V2PostgresSafetyError } from "../src/infrastructure/postgresSafety";

const disposable = "postgresql://poc:secret@ep-disposable-example.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require";
const safeEnvironment = { V2_POSTGRES_INTEGRATION: "1", TEST_DATABASE_URL: disposable };

describe("V2 POC PostgreSQL safety guard", () => {
  test("accepts only an explicit approved test target", () => {
    expect(requireV2PocPostgresUrl(safeEnvironment)).toBe(disposable);
  });

  test("fails closed without explicit experimental execution", () => {
    expect(() => requireV2PocPostgresUrl({ ...safeEnvironment, V2_POSTGRES_INTEGRATION: undefined })).toThrow(V2PostgresSafetyError);
  });

  test("rejects every alternate application or connection URL variable", () => {
    expect(() => requireV2PocPostgresUrl({ ...safeEnvironment, DATABASE_URL: disposable })).toThrow(/only TEST_DATABASE_URL/);
    expect(() => requireV2PocPostgresUrl({ ...safeEnvironment, PROD_DATABASE_URL: disposable })).toThrow(/only TEST_DATABASE_URL/);
    expect(() => requireV2PocPostgresUrl({ ...safeEnvironment, POSTGRES_URL: disposable })).toThrow(/only TEST_DATABASE_URL/);
  });
});
