import {
  detectDatabaseRuntime,
  getRuntimeBuildFingerprint,
  getRuntimeEnvironmentSummary,
} from "../lib/runtimeEnvironment";

describe("runtime environment detection", () => {
  test("DATABASE_URL localhost maps to local", () => {
    const result = detectDatabaseRuntime("postgresql://user:secret@localhost:5432/titanos_dev");

    expect(result).toEqual({
      databaseRuntime: "local",
      databaseLabel: "Local Postgres",
    });
  });

  test("known DEV Neon maps to dev-cloud", () => {
    const result = detectDatabaseRuntime(
      "postgresql://neondb_owner:secret@ep-wandering-band-aebq1qcx-pooler.c-2.us-east-2.aws.neon.tech/neondb",
      { NODE_ENV: "development" },
    );

    expect(result).toEqual({
      databaseRuntime: "dev-cloud",
      databaseLabel: "DEV Neon",
    });
  });

  test("production marker maps cloud database to production-cloud", () => {
    const result = detectDatabaseRuntime(
      "postgresql://prod_owner:secret@ep-prod-db.us-east-2.aws.neon.tech/prod",
      { APP_ENV: "production" },
    );

    expect(result).toEqual({
      databaseRuntime: "production-cloud",
      databaseLabel: "Production Neon",
    });
  });

  test("unknown remote database maps safely to unknown", () => {
    const result = detectDatabaseRuntime("postgresql://user:secret@db.example.invalid/app");

    expect(result).toEqual({
      databaseRuntime: "unknown",
      databaseLabel: "Unknown database",
    });
  });

  test("sanitized summary does not leak DATABASE_URL details", () => {
    const summary = getRuntimeEnvironmentSummary({
      env: {
        NODE_ENV: "development",
        DATABASE_URL:
          "postgresql://neondb_owner:super-secret@ep-wandering-band-aebq1qcx-pooler.c-2.us-east-2.aws.neon.tech/neondb",
      },
      requestHost: "localhost:5000",
    });

    const serialized = JSON.stringify(summary);
    expect(summary.canMutateSharedDevData).toBe(true);
    expect(summary.warningMessage).toBe("LOCAL APP -> DEV CLOUD DB. Changes here affect shared DEV data.");
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("ep-wandering-band");
    expect(serialized).not.toContain("DATABASE_URL");
  });

  test("startup migration flag is exposed without changing behavior", () => {
    const enabled = getRuntimeEnvironmentSummary({
      env: {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://user:secret@localhost:5432/titanos_dev",
      },
    });
    const disabled = getRuntimeEnvironmentSummary({
      env: {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://user:secret@localhost:5432/titanos_dev",
        DRIZZLE_AUTO_MIGRATE: "0",
      },
    });

    expect(enabled.migrationRunsOnStartup).toBe(true);
    expect(disabled.migrationRunsOnStartup).toBe(false);
  });

  test("exposes only allowlisted deployment identity fields", () => {
    const fingerprint = getRuntimeBuildFingerprint({ RAILWAY_GIT_COMMIT_SHA: "99db691e", RAILWAY_DEPLOYMENT_ID: "deployment_1", RAILWAY_ENVIRONMENT: "development", SECRET_URL: "postgres://hidden" });

    expect(fingerprint).toEqual({ gitSha: "99db691e", buildId: "deployment_1", environment: "development", operatorArchitectureVersion: "operator-business-operations-v1" });
    expect(JSON.stringify(fingerprint)).not.toContain("hidden");
  });
});
