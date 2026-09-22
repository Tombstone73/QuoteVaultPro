import { capabilityIds, type Capability } from "../../v2/src/authorization/capabilities";
import type { DevQaProvisioningConfig } from "./devQaProvisioningGuard";

export const DEV_QA_FULL_ACCESS_PERMISSION_SET_NAME = "DEV QA Full Access";
export const DEV_QA_FULL_ACCESS_PERMISSION_SET_DESCRIPTION = "Dedicated DEV-only full operational authority for the DEV QA Browser sandbox actor.";

/**
 * Explicit, least-privilege authority for synthetic M7.8I DEV validation.
 * The existing full-access plan remains the provisioner's default.
 */
export const DEV_QA_M78I_OPERATIONAL_CAPABILITIES = Object.freeze([
  "customer.view", "customer.edit", "product.view", "product.edit", "pricing.preview",
  "order.view", "order.create", "order.edit", "order.overridePrice",
  "organization.configure",
  "invoice.view", "invoice.editDraft", "invoice.editIssued", "invoice.issue", "payment.view",
  "route.view", "route.advance",
  "artwork.view", "artwork.adopt",
  "proof.view", "proof.prepare", "proof.issue",
  "prepress.view", "prepress.work", "prepress.complete",
  "production.view", "production.work", "production.complete", "production.hold", "production.rework", "production.note", "production.output.reject", "production.run.create", "production.run.execute",
  "fulfillment.view", "fulfillment.pickup", "fulfillment.ship", "fulfillment.replace", "fulfillment.shipping.cost", "fulfillment.shipping.price",
] as const satisfies readonly Capability[]);
export const DEV_QA_M78I_PERMISSION_SET_NAME = "DEV QA M7.8I Operations";
export const DEV_QA_M78I_PERMISSION_SET_DESCRIPTION = "Dedicated DEV-only least-privilege authority for synthetic M7.8I live validation.";
/** One-shot fixture setup only; immediately converge back to m78i after publish. */
export const DEV_QA_M78I_FIXTURE_PRICING_CAPABILITIES = Object.freeze([
  ...DEV_QA_M78I_OPERATIONAL_CAPABILITIES,
  "pricing.configure",
  "pricing.publish",
] as const satisfies readonly Capability[]);
export const DEV_QA_M78I_FIXTURE_PRICING_SET_NAME = "DEV QA M7.8I Fixture Pricing Setup";
export const DEV_QA_M78I_FIXTURE_PRICING_SET_DESCRIPTION = "Temporary DEV-only pricing authority to publish the marked M7.8I synthetic fixture Product.";
/** Retained for guarded command compatibility; Artwork adoption is now ordinary m78i authority. */
export const DEV_QA_M78I_FIXTURE_ARTWORK_CAPABILITIES = Object.freeze([
  ...DEV_QA_M78I_OPERATIONAL_CAPABILITIES,
] as const satisfies readonly Capability[]);
export const DEV_QA_M78I_FIXTURE_ARTWORK_SET_NAME = "DEV QA M7.8I Fixture Artwork Setup";
export const DEV_QA_M78I_FIXTURE_ARTWORK_SET_DESCRIPTION = "Guarded DEV-only compatibility profile; ordinary m78i includes Artwork adoption.";
/** One-shot fixture route setup only; immediately converge back to m78i after creation. */
export const DEV_QA_M78I_FIXTURE_ROUTE_CAPABILITIES = Object.freeze([
  ...DEV_QA_M78I_OPERATIONAL_CAPABILITIES,
  "route.manageTemplates",
] as const satisfies readonly Capability[]);
export const DEV_QA_M78I_FIXTURE_ROUTE_SET_NAME = "DEV QA M7.8I Fixture Route Setup";
export const DEV_QA_M78I_FIXTURE_ROUTE_SET_DESCRIPTION = "Temporary DEV-only route-template authority to create the marked M7.8I synthetic fixture route.";
/** One-shot complete fixture setup only; immediately converge back to m78i before live validation. */
export const DEV_QA_M78I_FIXTURE_SETUP_CAPABILITIES = Object.freeze([
  ...DEV_QA_M78I_OPERATIONAL_CAPABILITIES,
  "pricing.configure",
  "pricing.publish",
  "route.manageTemplates",
] as const satisfies readonly Capability[]);
export const DEV_QA_M78I_FIXTURE_SETUP_SET_NAME = "DEV QA M7.8I Fixture Setup";
export const DEV_QA_M78I_FIXTURE_SETUP_SET_DESCRIPTION = "Temporary DEV-only authority to establish the complete marked M7.8I synthetic fixture graph.";

/**
 * The physical administrator-floor constraint requires one active Staff
 * identity with both capabilities. This non-interactive `.invalid` identity
 * exists only in the verified DEV QA tenant so the M7.8I actor need not hold
 * permission-administration authority.
 */
export const DEV_QA_M78I_PERMISSION_FLOOR_EMAIL = "dev-qa-permission-floor@printershero.invalid";
export const DEV_QA_M78I_PERMISSION_FLOOR_CAPABILITIES = Object.freeze([
  "permissions.manageSets",
  "permissions.assignStaff",
] as const satisfies readonly Capability[]);
export const DEV_QA_M78I_PERMISSION_FLOOR_SET_NAME = "DEV QA Permission Floor";
export const DEV_QA_M78I_PERMISSION_FLOOR_SET_DESCRIPTION = "Dedicated DEV-only non-interactive administrator-floor guardian for M7.8I QA.";

/**
 * The reviewed V2 vocabulary contains tenant-scoped operational capabilities
 * only. Platform administration and organization ownership remain outside this
 * set, on the account and membership models respectively.
 */
export const DEV_QA_FULL_ACCESS_CAPABILITIES = Object.freeze([...capabilityIds] as Capability[]);

export type DevQaFullAccessProvisioningPlan = Readonly<{
  account: Readonly<{ email: string; firstName: string; lastName: string; role: "admin"; isAdmin: true; isPlatformAdmin: false; isPlatformDeveloper: false }>;
  membership: Readonly<{ organizationId: string; role: "admin" }>;
  permissionSet: Readonly<{ name: string; description: string; principalKind: "staff"; capabilities: readonly Capability[] }>;
}>;

export function devQaFullAccessProvisioningPlan(config: DevQaProvisioningConfig): DevQaFullAccessProvisioningPlan {
  return devQaProvisioningPlan(config, DEV_QA_FULL_ACCESS_PERMISSION_SET_NAME, DEV_QA_FULL_ACCESS_PERMISSION_SET_DESCRIPTION, DEV_QA_FULL_ACCESS_CAPABILITIES);
}

export function devQaM78iOperationalProvisioningPlan(config: DevQaProvisioningConfig): DevQaFullAccessProvisioningPlan {
  return devQaProvisioningPlan(config, DEV_QA_M78I_PERMISSION_SET_NAME, DEV_QA_M78I_PERMISSION_SET_DESCRIPTION, DEV_QA_M78I_OPERATIONAL_CAPABILITIES);
}

export function devQaM78iFixturePricingProvisioningPlan(config: DevQaProvisioningConfig): DevQaFullAccessProvisioningPlan {
  return devQaProvisioningPlan(config, DEV_QA_M78I_FIXTURE_PRICING_SET_NAME, DEV_QA_M78I_FIXTURE_PRICING_SET_DESCRIPTION, DEV_QA_M78I_FIXTURE_PRICING_CAPABILITIES);
}

export function devQaM78iFixtureArtworkProvisioningPlan(config: DevQaProvisioningConfig): DevQaFullAccessProvisioningPlan {
  return devQaProvisioningPlan(config, DEV_QA_M78I_FIXTURE_ARTWORK_SET_NAME, DEV_QA_M78I_FIXTURE_ARTWORK_SET_DESCRIPTION, DEV_QA_M78I_FIXTURE_ARTWORK_CAPABILITIES);
}

export function devQaM78iFixtureRouteProvisioningPlan(config: DevQaProvisioningConfig): DevQaFullAccessProvisioningPlan {
  return devQaProvisioningPlan(config, DEV_QA_M78I_FIXTURE_ROUTE_SET_NAME, DEV_QA_M78I_FIXTURE_ROUTE_SET_DESCRIPTION, DEV_QA_M78I_FIXTURE_ROUTE_CAPABILITIES);
}

export function devQaM78iFixtureSetupProvisioningPlan(config: DevQaProvisioningConfig): DevQaFullAccessProvisioningPlan {
  return devQaProvisioningPlan(config, DEV_QA_M78I_FIXTURE_SETUP_SET_NAME, DEV_QA_M78I_FIXTURE_SETUP_SET_DESCRIPTION, DEV_QA_M78I_FIXTURE_SETUP_CAPABILITIES);
}

export function devQaM78iPermissionFloorProvisioningPlan(config: DevQaProvisioningConfig): DevQaFullAccessProvisioningPlan {
  return Object.freeze({
    account: Object.freeze({ email: DEV_QA_M78I_PERMISSION_FLOOR_EMAIL, firstName: "DEV QA", lastName: "Permission Floor", role: "admin", isAdmin: true, isPlatformAdmin: false, isPlatformDeveloper: false }),
    membership: Object.freeze({ organizationId: config.organizationId, role: "admin" }),
    permissionSet: Object.freeze({
      name: DEV_QA_M78I_PERMISSION_FLOOR_SET_NAME,
      description: DEV_QA_M78I_PERMISSION_FLOOR_SET_DESCRIPTION,
      principalKind: "staff",
      capabilities: DEV_QA_M78I_PERMISSION_FLOOR_CAPABILITIES,
    }),
  });
}

function devQaProvisioningPlan(
  config: DevQaProvisioningConfig,
  permissionSetName: string,
  permissionSetDescription: string,
  capabilities: readonly Capability[],
): DevQaFullAccessProvisioningPlan {
  return Object.freeze({
    account: Object.freeze({ email: config.email, firstName: "DEV QA", lastName: "Browser", role: "admin", isAdmin: true, isPlatformAdmin: false, isPlatformDeveloper: false }),
    membership: Object.freeze({ organizationId: config.organizationId, role: "admin" }),
    permissionSet: Object.freeze({
      name: permissionSetName,
      description: permissionSetDescription,
      principalKind: "staff",
      capabilities,
    }),
  });
}
