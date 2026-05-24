import {
  getMigrationLockConfig,
  getSafeDatabaseLabel,
  isPooledNeonDatabaseUrl,
  parseAutoMigrateConfig,
  selectMigrationDatabaseUrl,
} from "../lib/migrationRuntimeConfig";

describe("migration runtime config", () => {
  test("detects pooled Neon URLs", () => {
    expect(
      isPooledNeonDatabaseUrl("postgresql://user:secret@ep-wandering-band-aebq1qcx-pooler.c-2.us-east-2.aws.neon.tech/neondb"),
    ).toBe(true);
    expect(
      isPooledNeonDatabaseUrl("postgresql://user:secret@ep-wandering-band-aebq1qcx.c-2.us-east-2.aws.neon.tech/neondb"),
    ).toBe(false);
    expect(isPooledNeonDatabaseUrl("postgresql://user:secret@localhost:5432/neondb")).toBe(false);
  });

  test("prefers explicit migration URL over direct URL over app DATABASE_URL", () => {
    expect(
      selectMigrationDatabaseUrl({
        DATABASE_URL: "postgresql://app:secret@app.example/db",
        DIRECT_DATABASE_URL: "postgresql://direct:secret@direct.example/db",
        MIGRATION_DATABASE_URL: "postgresql://migration:secret@migration.example/db",
      }),
    ).toEqual({
      connectionString: "postgresql://migration:secret@migration.example/db",
      source: "MIGRATION_DATABASE_URL",
      usesAppDatabaseUrl: false,
    });

    expect(
      selectMigrationDatabaseUrl({
        DATABASE_URL: "postgresql://app:secret@app.example/db",
        DIRECT_DATABASE_URL: "postgresql://direct:secret@direct.example/db",
      }),
    ).toEqual({
      connectionString: "postgresql://direct:secret@direct.example/db",
      source: "DIRECT_DATABASE_URL",
      usesAppDatabaseUrl: false,
    });

    expect(
      selectMigrationDatabaseUrl({
        DATABASE_URL: "postgresql://app:secret@app.example/db",
      }),
    ).toEqual({
      connectionString: "postgresql://app:secret@app.example/db",
      source: "DATABASE_URL",
      usesAppDatabaseUrl: true,
    });
  });

  test("parses DRIZZLE_AUTO_MIGRATE kill switch", () => {
    expect(parseAutoMigrateConfig({ DRIZZLE_AUTO_MIGRATE: "0" }).enabled).toBe(false);
    expect(parseAutoMigrateConfig({ DRIZZLE_AUTO_MIGRATE: "false" }).enabled).toBe(false);
    expect(parseAutoMigrateConfig({ DRIZZLE_AUTO_MIGRATE: "1" }).enabled).toBe(true);
    expect(parseAutoMigrateConfig({}).enabled).toBe(true);
  });

  test("parses bounded lock timing with environment defaults", () => {
    expect(getMigrationLockConfig({ NODE_ENV: "development" })).toEqual({
      timeoutMs: 30_000,
      retryIntervalMs: 1_000,
    });
    expect(getMigrationLockConfig({ NODE_ENV: "production" })).toEqual({
      timeoutMs: 120_000,
      retryIntervalMs: 1_000,
    });
    expect(
      getMigrationLockConfig({
        NODE_ENV: "development",
        MIGRATION_LOCK_TIMEOUT_MS: "5000",
        MIGRATION_LOCK_RETRY_MS: "250",
      }),
    ).toEqual({
      timeoutMs: 5_000,
      retryIntervalMs: 250,
    });
  });

  test("safe database labels redact credentials", () => {
    const label = getSafeDatabaseLabel("postgresql://user:super-secret@example.com:5432/app");
    expect(label).toContain("example.com/app");
    expect(label).not.toContain("super-secret");
    expect(label).not.toContain("user:");
  });
});
