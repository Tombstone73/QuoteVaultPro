import { getRuntimeEnvironmentSummary } from "./runtimeEnvironment";
import {
  DEV_QA_OPERATOR_ORGANIZATION_ID,
  DEV_QA_OPERATOR_ORGANIZATION_NAME,
  getDevQaOperatorConfig,
} from "./devQaProvisioningGuard";

export class M78iFixtureBootstrapGuardError extends Error {
  override readonly name = "M78iFixtureBootstrapGuardError";
}

const required = (env: Readonly<Record<string, string | undefined>>, name: string): string => {
  const value = env[name]?.trim();
  if (!value) throw new M78iFixtureBootstrapGuardError(`M7.8I fixture bootstrap requires ${name}.`);
  return value;
};

/**
 * This is deliberately narrower than a generic "development" switch.  The
 * fixture command has one immutable destination and may only run beside the
 * guarded DEV-QA operator in the deployed DEV service.
 */
export const assertM78iFixtureBootstrapEnvironment = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): void => {
  if (env.PRINTERSHERO_DEV_QA_FIXTURE_BOOTSTRAP_ENABLED?.trim().toLowerCase() !== "true")
    throw new M78iFixtureBootstrapGuardError("M7.8I fixture bootstrap is disabled.");
  if (env.RAILWAY_PROJECT_NAME?.trim() !== "PrintersHero-DEV" || env.RAILWAY_ENVIRONMENT_NAME?.trim() !== "Development")
    throw new M78iFixtureBootstrapGuardError("M7.8I fixture bootstrap is restricted to Railway PrintersHero-DEV / Development.");
  if (env.APP_ENV?.trim().toLowerCase() !== "development" || env.NODE_ENV?.trim().toLowerCase() !== "production")
    throw new M78iFixtureBootstrapGuardError("M7.8I fixture bootstrap requires the deployed DEV runtime profile.");
  const origin = new URL(required(env, "APP_PUBLIC_WEB_ORIGIN"));
  if (origin.origin !== "https://dev.printershero.com")
    throw new M78iFixtureBootstrapGuardError("M7.8I fixture bootstrap requires https://dev.printershero.com.");
  const runtime = getRuntimeEnvironmentSummary({ env, requestHost: origin.host, requestOrigin: origin.origin });
  if (runtime.appRuntime !== "deployed-dev" || runtime.apiRuntime !== "deployed-dev" || runtime.databaseRuntime !== "dev-cloud")
    throw new M78iFixtureBootstrapGuardError("M7.8I fixture bootstrap is unavailable outside the approved DEV application and DEV-cloud database.");
  required(env, "DATABASE_URL");
  const operator = getDevQaOperatorConfig(env as Record<string, string | undefined>);
  if (operator.organizationId !== DEV_QA_OPERATOR_ORGANIZATION_ID || operator.organizationName !== DEV_QA_OPERATOR_ORGANIZATION_NAME)
    throw new M78iFixtureBootstrapGuardError("M7.8I fixture bootstrap tenant lock did not resolve to PrintersHero M7 QA.");
};
