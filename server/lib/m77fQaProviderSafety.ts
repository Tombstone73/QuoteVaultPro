import { getRuntimeEnvironmentSummary } from "./runtimeEnvironment";

/**
 * This is deliberately an exact tenant allow-list rather than a broad DEV
 * switch. It is the only tenant for which M7.7F may suppress an external
 * delivery while exercising the canonical Proof and Portal flows.
 */
export const M77F_QA_ORGANIZATION_ID = "b6f969b2-dda3-4133-9d75-c417dabb8f3a";

type QaProviderSafetyInput = {
  organizationId: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  requestHost?: string | null;
  requestOrigin?: string | null;
};

function unavailable(message: string) {
  return Object.assign(new Error(message), {
    status: 404,
    code: "M77F_QA_PROVIDER_SAFETY_UNAVAILABLE",
  });
}

/**
 * The seam is available only from the deployed DEV application, against the
 * known DEV cloud database, and only for the dedicated M7 QA organization.
 * It fails closed for PROD, local/unknown runtimes, and every other DEV
 * tenant. The route caller remains responsible for its normal RBAC checks.
 */
export function assertM77fQaProviderSafety(input: QaProviderSafetyInput) {
  if (input.organizationId !== M77F_QA_ORGANIZATION_ID) {
    throw unavailable("M7.7F QA provider safety is unavailable for this organization.");
  }

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
    throw unavailable("M7.7F QA provider safety is unavailable in this environment.");
  }

  return runtime;
}

/** The non-throwing predicate is for a delivery boundary, never authorization. */
export function shouldSuppressM77fQaExternalDelivery(input: QaProviderSafetyInput): boolean {
  try {
    assertM77fQaProviderSafety(input);
    return true;
  } catch {
    return false;
  }
}
