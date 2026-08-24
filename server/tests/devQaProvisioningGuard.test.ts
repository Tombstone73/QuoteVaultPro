import { describe, expect, test } from "@jest/globals";
import { capabilityIds } from "../../v2/src/authorization/capabilities";
import { DEV_QA_FULL_ACCESS_CAPABILITIES, DEV_QA_FULL_ACCESS_PERMISSION_SET_NAME, devQaFullAccessProvisioningPlan } from "../lib/devQaFullAccessProvisioning";
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

describe("DEV QA full-access provisioning", () => {
  test("accepts only the deployed DEV origin and DEV cloud database", () => {
    expect(getDevQaProvisioningConfig(devEnv)).toMatchObject({ email: "qa.browser@example.test", organizationId: "org_titan_001", organizationSlug: "titan" });
  });

  test.each([
    [{ ...devEnv, PRINTERSHERO_DEV_QA_PROVISION_ENABLED: "false" }],
    [{ ...devEnv, APP_ENV: "production" }],
    [{ ...devEnv, NODE_ENV: "development" }],
    [{ ...devEnv, APP_PUBLIC_WEB_ORIGIN: "https://www.printershero.com", PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN: "https://www.printershero.com" }],
    [{ ...devEnv, DATABASE_URL: "postgres://user:pass@production-db.example.com/prod" }],
    [{ ...devEnv, PRINTERSHERO_DEV_QA_EXPECTED_ORG_ID: "" }],
  ])("fails closed outside the configured DEV sandbox", (env) => {
    expect(() => getDevQaProvisioningConfig(env)).toThrow();
  });

  test("reuses DEV QA Browser with an idempotent custom Staff plan", () => {
    const plan = devQaFullAccessProvisioningPlan(getDevQaProvisioningConfig(devEnv));
    expect(plan.account).toEqual({ email: "qa.browser@example.test", firstName: "DEV QA", lastName: "Browser", role: "admin", isAdmin: true, isPlatformAdmin: false, isPlatformDeveloper: false });
    expect(plan.membership).toEqual({ organizationId: "org_titan_001", role: "admin" });
    expect(plan.permissionSet).toMatchObject({ name: DEV_QA_FULL_ACCESS_PERMISSION_SET_NAME, principalKind: "staff" });
    expect(plan.permissionSet.capabilities).toEqual(capabilityIds);
    expect(devQaFullAccessProvisioningPlan(getDevQaProvisioningConfig(devEnv))).toEqual(plan);
  });

  test("includes real Product and Formula authority without a second identity or forged claims", () => {
    expect(DEV_QA_FULL_ACCESS_CAPABILITIES).toEqual(capabilityIds);
    expect(DEV_QA_FULL_ACCESS_CAPABILITIES).toEqual(expect.arrayContaining(["product.view", "product.edit", "pricing.configure"]));
    expect(DEV_QA_FULL_ACCESS_CAPABILITIES).toEqual(expect.arrayContaining(["quote.create", "order.create", "payment.record", "refund.issue", "route.manageTemplates", "proof.issue", "prepress.complete", "production.complete", "fulfillment.ship", "inventory.receive"]));
  });

  test("keeps platform and structural ownership outside the V2 QA permission set", () => {
    expect(DEV_QA_FULL_ACCESS_CAPABILITIES).not.toContain("platform.admin" as never);
    expect(DEV_QA_FULL_ACCESS_CAPABILITIES).not.toContain("organization.transferOwnership" as never);
    const plan = devQaFullAccessProvisioningPlan(getDevQaProvisioningConfig(devEnv));
    expect(plan.account.isPlatformAdmin).toBe(false);
    expect(plan.account.isPlatformDeveloper).toBe(false);
    expect(plan.membership.role).not.toBe("owner");
  });
});
