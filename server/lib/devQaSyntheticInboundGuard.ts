import { getRuntimeEnvironmentSummary } from "./runtimeEnvironment";

export const DEV_QA_SYNTHETIC_INBOUND_ORGANIZATION_ID = "b6f969b2-dda3-4133-9d75-c417dabb8f3a";

export class DevQaSyntheticInboundAccessError extends Error {
  constructor(message: string) { super(message); this.name = "DevQaSyntheticInboundAccessError"; }
}

/** Canonical synthetic-provider ingress is sealed to test or deployed DEV QA. */
export function assertDevQaSyntheticInboundAccess(organizationId: string, env: Record<string, string | undefined> = process.env): void {
  if (organizationId !== DEV_QA_SYNTHETIC_INBOUND_ORGANIZATION_ID) throw new DevQaSyntheticInboundAccessError("Synthetic inbound intake is restricted to the dedicated QA organization.");
  if (env.NODE_ENV?.trim().toLowerCase() === "test") return;
  const runtime = getRuntimeEnvironmentSummary({ env });
  if (runtime.appRuntime !== "deployed-dev" || runtime.apiRuntime !== "deployed-dev" || runtime.databaseRuntime !== "dev-cloud") throw new DevQaSyntheticInboundAccessError("Synthetic inbound intake is available only in test or deployed DEV.");
}
