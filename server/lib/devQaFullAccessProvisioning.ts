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
  "prepress.view", "prepress.work", "prepress.complete",
  "production.view", "production.work", "production.complete", "production.hold", "production.rework", "production.note", "production.output.reject", "production.run.create", "production.run.execute",
  "fulfillment.view", "fulfillment.ship", "fulfillment.replace", "fulfillment.shipping.cost", "fulfillment.shipping.price",
] as const satisfies readonly Capability[]);
export const DEV_QA_M78I_PERMISSION_SET_NAME = "DEV QA M7.8I Operations";
export const DEV_QA_M78I_PERMISSION_SET_DESCRIPTION = "Dedicated DEV-only least-privilege authority for synthetic M7.8I live validation.";

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
