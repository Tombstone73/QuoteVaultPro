import { describe, expect, test } from "@jest/globals";
import { getDevQaMutationProvisioningConfig, getDevQaProvisioningConfig } from "../lib/devQaProvisioningGuard";
import { DEV_QA_MUTATION_CAPABILITIES, devQaMutationProvisioningPlan } from "../lib/devQaMutationProvisioning";

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
  PRINTERSHERO_DEV_QA_MUTATION_EMAIL: "qa.mutation@example.test",
  PRINTERSHERO_DEV_QA_MUTATION_PASSWORD: "another-not-a-real-secret",
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
    expect(() => getDevQaMutationProvisioningConfig(env)).toThrow();
  });

  test("requires a distinct mutation identity and retains the DEV-only guard", () => {
    expect(getDevQaMutationProvisioningConfig(devEnv)).toMatchObject({ mutationEmail: "qa.mutation@example.test", organizationId: "org_titan_001" });
    expect(() => getDevQaMutationProvisioningConfig({ ...devEnv, PRINTERSHERO_DEV_QA_MUTATION_EMAIL: devEnv.PRINTERSHERO_DEV_QA_EMAIL })).toThrow("distinct");
    expect(() => getDevQaMutationProvisioningConfig({ ...devEnv, PRINTERSHERO_DEV_QA_MUTATION_PASSWORD: "" })).toThrow();
    expect(() => getDevQaMutationProvisioningConfig({ ...devEnv, APP_ENV: "production" })).toThrow();
  });

  test("requires the configured DEV tenant before it can identify a mutation actor", () => {
    expect(() => getDevQaMutationProvisioningConfig({ ...devEnv, PRINTERSHERO_DEV_QA_EXPECTED_ORG_ID: "" })).toThrow("PRINTERSHERO_DEV_QA_EXPECTED_ORG_ID");
    expect(() => getDevQaMutationProvisioningConfig({ ...devEnv, PRINTERSHERO_DEV_QA_EXPECTED_ORG_SLUG: "" })).toThrow("PRINTERSHERO_DEV_QA_EXPECTED_ORG_SLUG");
  });

  test("plans an idempotent least-privilege Staff set without structural Owner state", () => {
    const plan = devQaMutationProvisioningPlan(getDevQaMutationProvisioningConfig(devEnv));
    expect(plan.account).toEqual({ email: "qa.mutation@example.test", firstName: "DEV QA", lastName: "Mutation", role: "employee", isAdmin: false });
    expect(plan.membership).toEqual({ organizationId: "org_titan_001", role: "member" });
    expect(plan.permissionSet).toMatchObject({ name: "DEV QA Mutation", principalKind: "staff", capabilities: DEV_QA_MUTATION_CAPABILITIES });
    expect(plan.permissionSet.capabilities).toEqual(["product.view", "product.edit", "pricing.configure"]);
    expect(plan.permissionSet.capabilities).toContain("product.edit"); // Draft mutation/adoption
    expect(plan.permissionSet.capabilities).toContain("pricing.configure"); // Formula New/revise/Add to Library
    expect(plan.permissionSet.capabilities).not.toContain("permissions.assignStaff");
    expect(plan.permissionSet.capabilities).not.toContain("pricing.preview");
    expect(plan.permissionSet.capabilities).not.toContain("pricing.publish");
    expect(devQaMutationProvisioningPlan(getDevQaMutationProvisioningConfig(devEnv))).toEqual(plan);
  });
});
