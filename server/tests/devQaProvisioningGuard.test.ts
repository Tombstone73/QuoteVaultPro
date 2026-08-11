import { describe, expect, test } from "@jest/globals";
import { getDevQaProvisioningConfig } from "../lib/devQaProvisioningGuard";

const devEnv = {
  NODE_ENV: "production",
  APP_ENV: "development",
  APP_PUBLIC_WEB_ORIGIN: "https://dev.printershero.com",
  DATABASE_URL: "postgres://user:pass@ep-wandering-band-aebq1qcx-pooler.c-2.us-east-2.aws.neon.tech/dev",
  PRINTERSHERO_DEV_QA_PROVISION_ENABLED: "true",
  PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN: "https://dev.printershero.com",
  PRINTERSHERO_DEV_QA_EMAIL: "qa.browser@example.test",
  PRINTERSHERO_DEV_QA_PASSWORD: "not-a-real-secret",
  PRINTERSHERO_DEV_QA_EXPECTED_ORG_ID: "org_titan_001",
  PRINTERSHERO_DEV_QA_EXPECTED_ORG_SLUG: "titan",
};

describe("DEV QA provisioning guard", () => {
  test("accepts only the deployed DEV origin and DEV cloud database", () => {
    expect(getDevQaProvisioningConfig(devEnv)).toMatchObject({
      email: "qa.browser@example.test",
      organizationId: "org_titan_001",
      organizationSlug: "titan",
    });
  });

  test.each([
    [{ ...devEnv, PRINTERSHERO_DEV_QA_PROVISION_ENABLED: "false" }],
    [{ ...devEnv, APP_ENV: "production" }],
    [{ ...devEnv, NODE_ENV: "development" }],
    [{ ...devEnv, APP_PUBLIC_WEB_ORIGIN: "https://www.printershero.com", PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN: "https://www.printershero.com" }],
    [{ ...devEnv, DATABASE_URL: "postgres://user:pass@production-db.example.com/prod" }],
  ])("fails closed for a non-DEV provisioning environment", (env) => {
    expect(() => getDevQaProvisioningConfig(env)).toThrow();
  });
});
