import { describe, expect, test } from "@jest/globals";
import { capabilityIds } from "../../v2/src/authorization/capabilities";
import { DEV_QA_FULL_ACCESS_CAPABILITIES, DEV_QA_FULL_ACCESS_PERMISSION_SET_NAME, DEV_QA_M78I_FIXTURE_ARTWORK_CAPABILITIES, DEV_QA_M78I_FIXTURE_ARTWORK_SET_NAME, DEV_QA_M78I_FIXTURE_PRICING_CAPABILITIES, DEV_QA_M78I_FIXTURE_PRICING_SET_NAME, DEV_QA_M78I_FIXTURE_ROUTE_CAPABILITIES, DEV_QA_M78I_FIXTURE_ROUTE_SET_NAME, DEV_QA_M78I_FIXTURE_SETUP_CAPABILITIES, DEV_QA_M78I_FIXTURE_SETUP_SET_NAME, DEV_QA_M78I_OPERATIONAL_CAPABILITIES, DEV_QA_M78I_PERMISSION_FLOOR_CAPABILITIES, DEV_QA_M78I_PERMISSION_FLOOR_EMAIL, DEV_QA_M78I_PERMISSION_FLOOR_SET_NAME, DEV_QA_M78I_PERMISSION_SET_NAME, devQaFullAccessProvisioningPlan, devQaM78iFixtureArtworkProvisioningPlan, devQaM78iFixturePricingProvisioningPlan, devQaM78iFixtureRouteProvisioningPlan, devQaM78iFixtureSetupProvisioningPlan, devQaM78iOperationalProvisioningPlan, devQaM78iPermissionFloorProvisioningPlan } from "../lib/devQaFullAccessProvisioning";
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

  test("requires an explicit least-privilege M7.8I operational plan", () => {
    const plan = devQaM78iOperationalProvisioningPlan(getDevQaProvisioningConfig(devEnv));
    expect(plan.permissionSet).toMatchObject({ name: DEV_QA_M78I_PERMISSION_SET_NAME, principalKind: "staff" });
    expect(plan.permissionSet.capabilities).toEqual(DEV_QA_M78I_OPERATIONAL_CAPABILITIES);
    expect(plan.permissionSet.capabilities).toEqual(expect.arrayContaining(["artwork.view", "artwork.adopt", "proof.view", "proof.prepare", "proof.issue", "fulfillment.pickup", "fulfillment.replace", "fulfillment.shipping.cost", "fulfillment.shipping.price", "production.output.reject", "production.run.create", "production.run.execute"]));
    expect(plan.permissionSet.capabilities).not.toEqual(expect.arrayContaining(["artwork.assign", "permissions.manageSets", "permissions.assignStaff", "permissions.assignPortal", "pricing.configure", "pricing.publish", "route.manageTemplates", "payment.record", "refund.issue", "invoice.send", "communications.configure", "platform.admin" as never]));
  });

  test("keeps the M7.8I database administrator floor on a separate non-interactive DEV identity", () => {
    const plan = devQaM78iPermissionFloorProvisioningPlan(getDevQaProvisioningConfig(devEnv));
    expect(plan.account.email).toBe(DEV_QA_M78I_PERMISSION_FLOOR_EMAIL);
    expect(plan.account.email).toContain(".invalid");
    expect(plan.account.email).not.toBe(devQaM78iOperationalProvisioningPlan(getDevQaProvisioningConfig(devEnv)).account.email);
    expect(plan.permissionSet).toMatchObject({ name: DEV_QA_M78I_PERMISSION_FLOOR_SET_NAME, principalKind: "staff" });
    expect(plan.permissionSet.capabilities).toEqual(DEV_QA_M78I_PERMISSION_FLOOR_CAPABILITIES);
    expect(plan.permissionSet.capabilities).toEqual(["permissions.manageSets", "permissions.assignStaff"]);
  });

  test("limits temporary fixture pricing authority to the two publish prerequisites", () => {
    const plan = devQaM78iFixturePricingProvisioningPlan(getDevQaProvisioningConfig(devEnv));
    expect(plan.permissionSet.name).toBe(DEV_QA_M78I_FIXTURE_PRICING_SET_NAME);
    expect(plan.permissionSet.capabilities).toEqual(DEV_QA_M78I_FIXTURE_PRICING_CAPABILITIES);
    expect(plan.permissionSet.capabilities).toEqual(expect.arrayContaining(["pricing.configure", "pricing.publish"]));
    expect(plan.permissionSet.capabilities).toHaveLength(DEV_QA_M78I_OPERATIONAL_CAPABILITIES.length + 2);
    expect(plan.permissionSet.capabilities).not.toEqual(expect.arrayContaining(["payment.record", "refund.issue", "invoice.send", "permissions.manageSets"]));
  });

  test("keeps the guarded Artwork fixture profile compatible with ordinary m78i adoption", () => {
    const plan = devQaM78iFixtureArtworkProvisioningPlan(getDevQaProvisioningConfig(devEnv));
    expect(plan.permissionSet.name).toBe(DEV_QA_M78I_FIXTURE_ARTWORK_SET_NAME);
    expect(plan.permissionSet.capabilities).toEqual(DEV_QA_M78I_FIXTURE_ARTWORK_CAPABILITIES);
    expect(plan.permissionSet.capabilities).toEqual(expect.arrayContaining(["artwork.view", "artwork.adopt"]));
    expect(plan.permissionSet.capabilities).toHaveLength(DEV_QA_M78I_OPERATIONAL_CAPABILITIES.length);
    expect(plan.permissionSet.capabilities).not.toEqual(expect.arrayContaining(["artwork.assign", "pricing.configure", "pricing.publish", "payment.record", "refund.issue", "invoice.send", "permissions.manageSets"]));
  });

  test("limits temporary fixture route authority to route-template management", () => {
    const plan = devQaM78iFixtureRouteProvisioningPlan(getDevQaProvisioningConfig(devEnv));
    expect(plan.permissionSet.name).toBe(DEV_QA_M78I_FIXTURE_ROUTE_SET_NAME);
    expect(plan.permissionSet.capabilities).toEqual(DEV_QA_M78I_FIXTURE_ROUTE_CAPABILITIES);
    expect(plan.permissionSet.capabilities).toEqual(expect.arrayContaining(["route.manageTemplates"]));
    expect(plan.permissionSet.capabilities).toHaveLength(DEV_QA_M78I_OPERATIONAL_CAPABILITIES.length + 1);
    expect(plan.permissionSet.capabilities).not.toEqual(expect.arrayContaining(["artwork.assign", "pricing.configure", "pricing.publish", "payment.record", "refund.issue", "invoice.send", "permissions.manageSets"]));
  });

  test("limits complete fixture setup authority to the remaining reviewed prerequisites", () => {
    const plan = devQaM78iFixtureSetupProvisioningPlan(getDevQaProvisioningConfig(devEnv));
    expect(plan.permissionSet.name).toBe(DEV_QA_M78I_FIXTURE_SETUP_SET_NAME);
    expect(plan.permissionSet.capabilities).toEqual(DEV_QA_M78I_FIXTURE_SETUP_CAPABILITIES);
    expect(plan.permissionSet.capabilities.filter((capability) => !DEV_QA_M78I_OPERATIONAL_CAPABILITIES.includes(capability as never))).toEqual(["pricing.configure", "pricing.publish", "route.manageTemplates"]);
    expect(plan.permissionSet.capabilities).toHaveLength(DEV_QA_M78I_OPERATIONAL_CAPABILITIES.length + 3);
    expect(plan.permissionSet.capabilities).not.toEqual(expect.arrayContaining(["payment.record", "refund.issue", "invoice.send", "communications.configure", "permissions.manageSets", "permissions.assignStaff"]));
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
