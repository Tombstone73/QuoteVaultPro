import { getRuntimeEnvironmentSummary } from "./runtimeEnvironment";

export const STAGE_18P_DEV_FIXTURE_CUSTOMER_PREFIX = "DEV TEST ONLY - Stage 18P";

type FixtureRuntimeInput = {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  requestHost?: string | null;
  requestOrigin?: string | null;
};

function fixtureAccessError(message: string) {
  return Object.assign(new Error(message), {
    status: 404,
    code: "DEV_STAGE_18P_FIXTURE_ACCESS_UNAVAILABLE",
  });
}

/**
 * This is deliberately narrower than a general non-production switch. The
 * fixture setup link is available only from the deployed DEV app backed by
 * the known DEV database; local and unknown runtimes fail closed.
 */
export function assertStage18PDevFixtureAccess(input: FixtureRuntimeInput = {}) {
  const runtime = getRuntimeEnvironmentSummary({
    env: input.env,
    requestHost: input.requestHost,
    requestOrigin: input.requestOrigin,
  });

  if (
    runtime.appRuntime !== "deployed-dev" ||
    runtime.apiRuntime !== "deployed-dev" ||
    runtime.databaseRuntime !== "dev-cloud"
  ) {
    throw fixtureAccessError("DEV Stage 18P fixture access is unavailable in this environment.");
  }

  return runtime;
}

export function isStage18PDevFixtureCustomer(companyName: string | null | undefined): boolean {
  return String(companyName || "").trim().startsWith(STAGE_18P_DEV_FIXTURE_CUSTOMER_PREFIX);
}
