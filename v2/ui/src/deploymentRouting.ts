export type V2UiDeploymentTarget = "development" | "production";

export type V2UiRoutingEnvironment = Readonly<{
  V2_UI_DEPLOYMENT_TARGET?: string;
  V2_UI_API_ORIGIN?: string;
  VERCEL?: string;
}>;

export type V2UiRoutingConfiguration = Readonly<{
  target: V2UiDeploymentTarget;
  apiOrigin: string;
}>;

const apiOriginByTarget: Readonly<Record<V2UiDeploymentTarget, string>> = {
  development: "https://api-dev.printershero.com",
  production: "https://api.printershero.com",
};

const isDeploymentTarget = (value: string | undefined): value is V2UiDeploymentTarget =>
  value === "development" || value === "production";

/**
 * Vercel expands V2_UI_API_ORIGIN in the route destinations. This build-time
 * contract binds that expansion to an explicit, closed deployment target so a
 * production UI deployment cannot silently proxy its sessions or OAuth
 * callbacks to the DEV API (or the reverse).
 */
export const resolveV2UiRoutingConfiguration = (
  environment: V2UiRoutingEnvironment,
): V2UiRoutingConfiguration => {
  const target = environment.V2_UI_DEPLOYMENT_TARGET?.trim();
  if (!isDeploymentTarget(target)) {
    throw new Error("V2_UI_DEPLOYMENT_TARGET must be exactly development or production.");
  }

  const apiOrigin = environment.V2_UI_API_ORIGIN?.trim();
  if (apiOrigin !== apiOriginByTarget[target]) {
    throw new Error("V2_UI_API_ORIGIN does not match the selected V2 UI deployment target.");
  }

  return { target, apiOrigin };
};

/** Vercel deployments must prove the route expansion before building assets. */
export const assertVercelUiRoutingEnvironment = (
  environment: V2UiRoutingEnvironment,
): void => {
  if (environment.VERCEL === "1") resolveV2UiRoutingConfiguration(environment);
};
