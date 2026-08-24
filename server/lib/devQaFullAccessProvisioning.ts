import { capabilityIds, type Capability } from "../../v2/src/authorization/capabilities";
import type { DevQaProvisioningConfig } from "./devQaProvisioningGuard";

export const DEV_QA_FULL_ACCESS_PERMISSION_SET_NAME = "DEV QA Full Access";
export const DEV_QA_FULL_ACCESS_PERMISSION_SET_DESCRIPTION = "Dedicated DEV-only full operational authority for the DEV QA Browser sandbox actor.";

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
  return Object.freeze({
    account: Object.freeze({ email: config.email, firstName: "DEV QA", lastName: "Browser", role: "admin", isAdmin: true, isPlatformAdmin: false, isPlatformDeveloper: false }),
    membership: Object.freeze({ organizationId: config.organizationId, role: "admin" }),
    permissionSet: Object.freeze({
      name: DEV_QA_FULL_ACCESS_PERMISSION_SET_NAME,
      description: DEV_QA_FULL_ACCESS_PERMISSION_SET_DESCRIPTION,
      principalKind: "staff",
      capabilities: DEV_QA_FULL_ACCESS_CAPABILITIES,
    }),
  });
}
