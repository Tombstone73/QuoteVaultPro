import { describe, expect, test } from "@jest/globals";
import { requireV2PocPostgresUrl, V2PostgresSafetyError } from "../src/infrastructure/postgresSafety";

const disposable = "postgresql://poc:secret@ep-disposable-example.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require";
const development = "postgresql://dev:secret@ep-development-example.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require";
const safeEnvironment = { V2_POSTGRES_INTEGRATION: "1", TEST_DATABASE_URL: disposable, V2_REFERENCE_DATABASE_URLS: JSON.stringify([development]) };

describe("V2 POC PostgreSQL safety guard", () => {
  test("accepts an explicit test target distinct from all supplied application references", () => {
    expect(requireV2PocPostgresUrl(safeEnvironment)).toBe(disposable);
  });

  test("fails closed without explicit experimental execution", () => {
    expect(() => requireV2PocPostgresUrl({ ...safeEnvironment, V2_POSTGRES_INTEGRATION: undefined })).toThrow(V2PostgresSafetyError);
  });

  test("fails closed without known application endpoint references", () => {
    expect(() => requireV2PocPostgresUrl({ V2_POSTGRES_INTEGRATION: "1", TEST_DATABASE_URL: disposable })).toThrow(/V2_REFERENCE_DATABASE_URLS/);
  });

  test("rejects exact and Neon pooler/direct aliases of a known application database", () => {
    expect(() => requireV2PocPostgresUrl({ ...safeEnvironment, V2_REFERENCE_DATABASE_URLS: JSON.stringify([disposable]) })).toThrow(/aliases/);
    const pooledAlias = "postgresql://dev:other@ep-disposable-example-pooler.c-2.us-east-2.aws.neon.tech/neondb";
    expect(() => requireV2PocPostgresUrl({ ...safeEnvironment, V2_REFERENCE_DATABASE_URLS: JSON.stringify([pooledAlias]) })).toThrow(/aliases/);
  });

  test("rejects a configured application URL even when it is absent from the explicit reference list", () => {
    expect(() => requireV2PocPostgresUrl({ ...safeEnvironment, DATABASE_URL: disposable })).toThrow(/aliases/);
  });
});
