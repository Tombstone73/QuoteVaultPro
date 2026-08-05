import {
  UnsafeTestDatabaseUrlError,
  hasSafeTestDatabase,
  requireSafeTestDatabaseUrl,
  safeTestDatabaseUrl,
} from "./helpers/safeTestDatabase";

describe("safe test database guard", () => {
  test("does not use DATABASE_URL as a fallback", () => {
    const env = { DATABASE_URL: "postgresql://app:secret@db.example/titanos_dev" };
    expect(safeTestDatabaseUrl(env)).toBeNull();
    expect(hasSafeTestDatabase(env)).toBe(false);
    expect(() => requireSafeTestDatabaseUrl(env)).toThrow(UnsafeTestDatabaseUrlError);
  });

  test("accepts a separately configured test database", () => {
    const url = "postgresql://tests:secret@localhost:5432/printershero_canonical_test";
    expect(safeTestDatabaseUrl({ TEST_DATABASE_URL: url, DATABASE_URL: "postgresql://app:secret@localhost:5432/printershero_dev" })).toBe(url);
  });

  test.each([
    "postgresql://tests:secret@localhost:5432/printershero_dev",
    "postgresql://tests:secret@localhost:5432/printershero_main",
    "postgresql://tests:secret@localhost:5432/printershero_production",
    "postgresql://tests:secret@localhost:5432/printershero_shared",
    "postgresql://tests:secret@localhost:5432/printershero_business",
    "postgresql://tests:secret@localhost:5432/printershero",
  ])("rejects unsafe or unmarked target %s", (url) => {
    expect(() => safeTestDatabaseUrl({ TEST_DATABASE_URL: url })).toThrow(UnsafeTestDatabaseUrlError);
  });

  test("rejects a test variable that aliases an application database", () => {
    const url = "postgresql://tests:secret@localhost:5432/printershero_canonical_test";
    expect(() => safeTestDatabaseUrl({ TEST_DATABASE_URL: url, DATABASE_URL: url })).toThrow(/different from every application/i);
  });
});
