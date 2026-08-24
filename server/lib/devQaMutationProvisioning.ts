import type { Capability } from "../../v2/src/authorization/capabilities";
import type { DevQaMutationProvisioningConfig } from "./devQaProvisioningGuard";

export const DEV_QA_MUTATION_PERMISSION_SET_NAME = "DEV QA Mutation";
export const DEV_QA_MUTATION_PERMISSION_SET_DESCRIPTION = "Dedicated DEV-only Formula and Product Builder validation authority.";
export const DEV_QA_MUTATION_CAPABILITIES = Object.freeze([
  "product.view",
  "product.edit",
  "pricing.preview",
  "pricing.configure",
] as const satisfies readonly Capability[]);

export type DevQaMutationProvisioningPlan = Readonly<{
  account: Readonly<{ email: string; firstName: string; lastName: string; role: "employee"; isAdmin: false }>;
  membership: Readonly<{ organizationId: string; role: "member" }>;
  permissionSet: Readonly<{ name: string; description: string; principalKind: "staff"; capabilities: readonly Capability[] }>;
}>;

export function devQaMutationProvisioningPlan(config: DevQaMutationProvisioningConfig): DevQaMutationProvisioningPlan {
  return Object.freeze({
    account: Object.freeze({ email: config.mutationEmail, firstName: "DEV QA", lastName: "Mutation", role: "employee", isAdmin: false }),
    membership: Object.freeze({ organizationId: config.organizationId, role: "member" }),
    permissionSet: Object.freeze({
      name: DEV_QA_MUTATION_PERMISSION_SET_NAME,
      description: DEV_QA_MUTATION_PERMISSION_SET_DESCRIPTION,
      principalKind: "staff",
      capabilities: DEV_QA_MUTATION_CAPABILITIES,
    }),
  });
}
