import { describe, expect, test } from "@jest/globals";
import {
  DEV_QA_APPROVED_PROFILES,
  DEV_QA_GUARDIAN_EMAIL,
  DEV_QA_GUARDIAN_PERMISSION_SET_NAME,
  approvedDevQaProfile,
  assertDedicatedBrowserEmail,
  devQaProfileDefinition,
  isExactGuardianCapabilitySet,
  isTemporaryFixtureProfile,
  profileForPermissionState,
  sameCapabilitySet,
} from "../lib/devQaOperator";
import {
  DEV_QA_OPERATOR_BROWSER_EMAIL,
  DEV_QA_OPERATOR_ORGANIZATION_ID,
  DEV_QA_OPERATOR_ORGANIZATION_NAME,
  getDevQaOperatorConfig,
} from "../lib/devQaProvisioningGuard";
import {
  DEV_QA_M78I_FIXTURE_ARTWORK_CAPABILITIES,
  DEV_QA_M78I_FIXTURE_PRICING_CAPABILITIES,
  DEV_QA_M78I_FIXTURE_ROUTE_CAPABILITIES,
  DEV_QA_M78I_FIXTURE_SETUP_CAPABILITIES,
  DEV_QA_M78I_OPERATIONAL_CAPABILITIES,
  DEV_QA_M78I_PERMISSION_FLOOR_CAPABILITIES,
} from "../lib/devQaFullAccessProvisioning";
import { assertM78iFixtureBootstrapEnvironment } from "../lib/m78iFixtureBootstrapGuard";

const devEnv = {
  NODE_ENV: "production",
  APP_ENV: "development",
  APP_PUBLIC_WEB_ORIGIN: "https://dev.printershero.com",
  DATABASE_URL: "postgres://user:pass@ep-wandering-band-aebq1qcx-pooler.c-2.us-east-2.aws.neon.tech/dev",
  PRINTERSHERO_DEV_QA_OPERATOR_ENABLED: "true",
  PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN: "https://dev.printershero.com",
  PRINTERSHERO_DEV_QA_EXPECTED_ORG_ID: DEV_QA_OPERATOR_ORGANIZATION_ID,
};

describe("guarded DEV QA operator", () => {
  test("fixture bootstrap is locked to the deployed DEV QA tenant and Railway DEV", () => {
    const fixtureEnv = {
      ...devEnv,
      PRINTERSHERO_DEV_QA_FIXTURE_BOOTSTRAP_ENABLED: "true",
      RAILWAY_PROJECT_NAME: "PrintersHero-DEV",
      RAILWAY_ENVIRONMENT_NAME: "Development",
    };
    expect(() => assertM78iFixtureBootstrapEnvironment(fixtureEnv)).not.toThrow();
    expect(() => assertM78iFixtureBootstrapEnvironment({ ...fixtureEnv, RAILWAY_PROJECT_NAME: "PrintersHero" })).toThrow();
    expect(() => assertM78iFixtureBootstrapEnvironment({ ...fixtureEnv, APP_ENV: "production" })).toThrow();
    expect(() => assertM78iFixtureBootstrapEnvironment({ ...fixtureEnv, PRINTERSHERO_DEV_QA_EXPECTED_ORG_ID: "wrong-tenant" })).toThrow();
  });

  test("status/verify guard accepts the approved deployed DEV identity without a password", () => {
    expect(getDevQaOperatorConfig(devEnv)).toEqual({ organizationId: DEV_QA_OPERATOR_ORGANIZATION_ID, organizationName: DEV_QA_OPERATOR_ORGANIZATION_NAME, browserEmail: DEV_QA_OPERATOR_BROWSER_EMAIL });
    expect(getDevQaOperatorConfig(devEnv)).not.toHaveProperty("password");
  });

  test.each([
    [{ ...devEnv, PRINTERSHERO_DEV_QA_OPERATOR_ENABLED: "false" }],
    [{ ...devEnv, APP_ENV: "production" }],
    [{ ...devEnv, NODE_ENV: "development" }],
    [{ ...devEnv, APP_PUBLIC_WEB_ORIGIN: "https://www.printershero.com", PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN: "https://www.printershero.com" }],
    [{ ...devEnv, DATABASE_URL: "postgres://user:pass@production-db.example.com/prod" }],
    [{ ...devEnv, PRINTERSHERO_DEV_QA_EXPECTED_ORG_ID: "other-tenant" }],
  ])("fails closed outside the exact DEV QA tenant boundary", (env) => {
    expect(() => getDevQaOperatorConfig(env)).toThrow();
  });

  test("password set is permanently locked to the existing QA browser email", () => {
    expect(assertDedicatedBrowserEmail(DEV_QA_OPERATOR_BROWSER_EMAIL.toUpperCase())).toBe(DEV_QA_OPERATOR_BROWSER_EMAIL);
    expect(() => assertDedicatedBrowserEmail("other@example.test")).toThrow();
    expect(() => assertDedicatedBrowserEmail(undefined)).toThrow();
  });

  test("allows only the reviewed QA profiles", () => {
    expect(DEV_QA_APPROVED_PROFILES).toEqual(["m78i", "m78i_fixture_pricing", "m78i_fixture_artwork", "m78i_fixture_route", "m78i_fixture_setup"]);
    expect(approvedDevQaProfile("m78i")).toBe("m78i");
    expect(approvedDevQaProfile("m78i_fixture_route")).toBe("m78i_fixture_route");
    expect(approvedDevQaProfile("m78i_fixture_setup")).toBe("m78i_fixture_setup");
    expect(() => approvedDevQaProfile("full")).toThrow();
    expect(() => approvedDevQaProfile("arbitrary-admin")).toThrow();
  });

  test("normal m78i excludes fixture and permission-administration authority", () => {
    expect(DEV_QA_M78I_OPERATIONAL_CAPABILITIES).not.toEqual(expect.arrayContaining(["artwork.adopt", "pricing.configure", "pricing.publish", "route.manageTemplates", "permissions.manageSets", "permissions.assignStaff"]));
  });

  test("pricing fixture adds only the two approved pricing capabilities", () => {
    expect(DEV_QA_M78I_FIXTURE_PRICING_CAPABILITIES.filter((capability) => !DEV_QA_M78I_OPERATIONAL_CAPABILITIES.includes(capability as never))).toEqual(["pricing.configure", "pricing.publish"]);
  });

  test("artwork fixture adds only artwork.adopt", () => {
    expect(DEV_QA_M78I_FIXTURE_ARTWORK_CAPABILITIES.filter((capability) => !DEV_QA_M78I_OPERATIONAL_CAPABILITIES.includes(capability as never))).toEqual(["artwork.adopt"]);
  });

  test("route fixture adds only route.manageTemplates", () => {
    expect(DEV_QA_M78I_FIXTURE_ROUTE_CAPABILITIES.filter((capability) => !DEV_QA_M78I_OPERATIONAL_CAPABILITIES.includes(capability as never))).toEqual(["route.manageTemplates"]);
    expect(DEV_QA_M78I_FIXTURE_ROUTE_CAPABILITIES).not.toEqual(expect.arrayContaining(["artwork.adopt", "pricing.configure", "pricing.publish", "permissions.manageSets", "permissions.assignStaff"]));
  });

  test("fixture setup adds exactly the four reviewed setup capabilities", () => {
    expect(DEV_QA_M78I_FIXTURE_SETUP_CAPABILITIES.filter((capability) => !DEV_QA_M78I_OPERATIONAL_CAPABILITIES.includes(capability as never))).toEqual(["pricing.configure", "pricing.publish", "route.manageTemplates", "artwork.adopt"]);
    expect(DEV_QA_M78I_FIXTURE_SETUP_CAPABILITIES).not.toEqual(expect.arrayContaining(["payment.record", "refund.issue", "invoice.send", "communications.configure", "permissions.manageSets", "permissions.assignStaff"]));
  });

  test("profile recognition requires one exact reviewed set and capability list", () => {
    const normal = devQaProfileDefinition("m78i");
    expect(profileForPermissionState(normal.permissionSetName, normal.capabilities)).toBe("m78i");
    expect(profileForPermissionState(normal.permissionSetName, [...normal.capabilities, "artwork.adopt"])).toBeNull();
    expect(profileForPermissionState("Unexpected set", normal.capabilities)).toBeNull();
    const route = devQaProfileDefinition("m78i_fixture_route");
    expect(profileForPermissionState(route.permissionSetName, route.capabilities)).toBe("m78i_fixture_route");
    const setup = devQaProfileDefinition("m78i_fixture_setup");
    expect(profileForPermissionState(setup.permissionSetName, setup.capabilities)).toBe("m78i_fixture_setup");
  });

  test("restore target is the exact normal m78i capability set", () => {
    expect(devQaProfileDefinition("m78i").capabilities).toEqual(DEV_QA_M78I_OPERATIONAL_CAPABILITIES);
    expect(isTemporaryFixtureProfile("m78i")).toBe(false);
    expect(isTemporaryFixtureProfile("m78i_fixture_artwork")).toBe(true);
    expect(isTemporaryFixtureProfile("m78i_fixture_route")).toBe(true);
    expect(isTemporaryFixtureProfile("m78i_fixture_setup")).toBe(true);
    expect(devQaProfileDefinition("m78i").capabilities).not.toContain("route.manageTemplates");
  });

  test("guardian is a separate non-interactive identity with only the floor capabilities", () => {
    expect(DEV_QA_GUARDIAN_EMAIL).not.toBe(DEV_QA_OPERATOR_BROWSER_EMAIL);
    expect(DEV_QA_GUARDIAN_PERMISSION_SET_NAME).toContain("Permission Floor");
    expect(isExactGuardianCapabilitySet(DEV_QA_M78I_PERMISSION_FLOOR_CAPABILITIES)).toBe(true);
    expect(isExactGuardianCapabilitySet([...DEV_QA_M78I_PERMISSION_FLOOR_CAPABILITIES, "permissions.view"])).toBe(false);
  });

  test("capability comparisons are order-independent and reject extras", () => {
    expect(sameCapabilitySet(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameCapabilitySet(["a", "b"], ["a", "b", "c"])).toBe(false);
  });
});
