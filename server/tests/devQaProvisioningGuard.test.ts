import { describe, expect, test } from "@jest/globals";
import { databaseIdentityFingerprint, getDevQaProvisioningConfig } from "../lib/devQaProvisioningGuard";

const databaseUrl = "postgres://user:pass@postgres.internal:5432/dev_db";

const devEnv = {
  NODE_ENV: "production",
  APP_ENV: "development",
  APP_PUBLIC_WEB_ORIGIN: "https://dev.printershero.com",
  DATABASE_URL: databaseUrl,
  RAILWAY_ENVIRONMENT_NAME: "development",
  RAILWAY_ENVIRONMENT_ID: "reviewed-dev-environment-id",
  PRINTERSHERO_DEV_QA_APPROVED_RAILWAY_ENVIRONMENT_ID: "reviewed-dev-environment-id",
  PRINTERSHERO_DEV_QA_APPROVED_DATABASE_IDENTITY: databaseIdentityFingerprint(databaseUrl)!,
  PRINTERSHERO_DEV_QA_PROVISION_ENABLED: "true",
  PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN: "https://dev.printershero.com",
  PRINTERSHERO_DEV_QA_EMAIL: "qa.browser@example.test",
  PRINTERSHERO_DEV_QA_PASSWORD: "not-a-real-secret",
  PRINTERSHERO_DEV_QA_EXPECTED_ORG_ID: "org_titan_001",
  PRINTERSHERO_DEV_QA_EXPECTED_ORG_SLUG: "titan",
};

describe("DEV QA provisioning guard", () => {
  test("accepts only the approved Railway DEV environment and exact PostgreSQL identity", () => {
    expect(getDevQaProvisioningConfig(devEnv)).toMatchObject({
      email: "qa.browser@example.test",
      organizationId: "org_titan_001",
      organizationSlug: "titan",
      databaseName: "dev_db",
      databaseUser: "user",
    });
  });

  test("database identity excludes the password and changes with endpoint, user, or database", () => {
    const fingerprint = databaseIdentityFingerprint(databaseUrl);
    expect(fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(fingerprint).toBe(databaseIdentityFingerprint(databaseUrl.replace('pass', 'new-password')));
    expect(fingerprint).not.toBe(databaseIdentityFingerprint(databaseUrl.replace('dev_db', 'main_db')));
    expect(fingerprint).not.toBe(databaseIdentityFingerprint(databaseUrl.replace('postgres.internal', 'other.internal')));
    expect(fingerprint).not.toBe(databaseIdentityFingerprint(databaseUrl.replace('user:', 'other:')));
    expect(databaseIdentityFingerprint('not-a-database-url')).toBeNull();
  });

  test.each([
    [{ ...devEnv, PRINTERSHERO_DEV_QA_PROVISION_ENABLED: "false" }],
    [{ ...devEnv, APP_ENV: "production" }],
    [{ ...devEnv, NODE_ENV: "development" }],
    [{ ...devEnv, RAILWAY_ENVIRONMENT_NAME: "production" }],
    [{ ...devEnv, RAILWAY_ENVIRONMENT_ID: "wrong-environment" }],
    [{ ...devEnv, PRINTERSHERO_DEV_QA_APPROVED_DATABASE_IDENTITY: undefined }],
    [{ ...devEnv, PRINTERSHERO_DEV_QA_PASSWORD: 'short' }],
    [{ ...devEnv, DATABASE_URL: "postgres://user:pass@postgres.internal:5432/main_db" }],
    [{ ...devEnv, DATABASE_URL: "postgres://user:pass@localhost:5432/dev_db" }],
    [{ ...devEnv, APP_PUBLIC_WEB_ORIGIN: "https://www.printershero.com", PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN: "https://www.printershero.com" }],
    [{ ...devEnv, DATABASE_URL: "postgres://user:pass@production-db.example.com/prod" }],
  ])("fails closed for a non-DEV provisioning environment", (env) => {
    expect(() => getDevQaProvisioningConfig(env)).toThrow();
  });
});
