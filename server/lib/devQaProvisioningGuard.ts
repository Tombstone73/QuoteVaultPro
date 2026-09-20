import { getRuntimeEnvironmentSummary } from "./runtimeEnvironment";

export type DevQaProvisioningConfig = {
  email: string;
  password: string;
  organizationId: string;
  organizationSlug: string;
};

export const DEV_QA_OPERATOR_ORGANIZATION_ID = "b6f969b2-dda3-4133-9d75-c417dabb8f3a";
export const DEV_QA_OPERATOR_ORGANIZATION_NAME = "PrintersHero M7 QA";
export const DEV_QA_OPERATOR_BROWSER_EMAIL = "m7-7e-qa-browser@printershero.invalid";

export type DevQaOperatorConfig = Readonly<{
  organizationId: typeof DEV_QA_OPERATOR_ORGANIZATION_ID;
  organizationName: typeof DEV_QA_OPERATOR_ORGANIZATION_NAME;
  browserEmail: typeof DEV_QA_OPERATOR_BROWSER_EMAIL;
}>;

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`DEV QA provisioning requires ${name} (value not logged).`);
  }
  return value;
}

function normalizedOrigin(value: string, name: string): URL {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
      throw new Error();
    }
    return url;
  } catch {
    throw new Error(`DEV QA provisioning requires ${name} to be an HTTPS origin without a path.`);
  }
}

/**
 * The QA user command is deliberately narrower than a general development
 * switch: it can run only from the deployed PrintersHero DEV environment and
 * its known DEV-cloud database. Local and production configurations fail closed.
 */
export function getDevQaProvisioningConfig(
  env: Record<string, string | undefined> = process.env,
): DevQaProvisioningConfig {
  if (env.PRINTERSHERO_DEV_QA_PROVISION_ENABLED?.trim().toLowerCase() !== "true") {
    throw new Error("DEV QA provisioning is disabled. Set PRINTERSHERO_DEV_QA_PROVISION_ENABLED=true for this one-time DEV command.");
  }

  if (env.APP_ENV?.trim().toLowerCase() !== "development") {
    throw new Error("DEV QA provisioning requires APP_ENV=development.");
  }

  // Railway DEV runs the production server build with APP_ENV=development.
  // Requiring that combination prevents accidental use from a local shell.
  if (env.NODE_ENV?.trim().toLowerCase() !== "production") {
    throw new Error("DEV QA provisioning requires the deployed DEV server runtime (NODE_ENV=production).");
  }

  const allowedOrigin = normalizedOrigin(
    required(env, "PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN"),
    "PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN",
  );
  const configuredOrigin = normalizedOrigin(
    required(env, "APP_PUBLIC_WEB_ORIGIN"),
    "APP_PUBLIC_WEB_ORIGIN",
  );

  if (allowedOrigin.origin !== configuredOrigin.origin || allowedOrigin.hostname !== "dev.printershero.com") {
    throw new Error("DEV QA provisioning requires the reviewed https://dev.printershero.com origin.");
  }

  const runtime = getRuntimeEnvironmentSummary({
    env,
    requestHost: allowedOrigin.host,
    requestOrigin: allowedOrigin.origin,
  });
  if (
    runtime.appRuntime !== "deployed-dev" ||
    runtime.apiRuntime !== "deployed-dev" ||
    runtime.databaseRuntime !== "dev-cloud"
  ) {
    throw new Error("DEV QA provisioning is unavailable outside the deployed DEV application and DEV cloud database.");
  }

  return {
    email: required(env, "PRINTERSHERO_DEV_QA_EMAIL").toLowerCase(),
    password: required(env, "PRINTERSHERO_DEV_QA_PASSWORD"),
    organizationId: required(env, "PRINTERSHERO_DEV_QA_EXPECTED_ORG_ID"),
    organizationSlug: required(env, "PRINTERSHERO_DEV_QA_EXPECTED_ORG_SLUG").toLowerCase(),
  };
}

/**
 * Guard for the narrow DEV-QA operator. Unlike the legacy provisioner this
 * intentionally does not require a stored QA password, so read-only status
 * and verification can run without any credential material being present.
 */
export function getDevQaOperatorConfig(
  env: Record<string, string | undefined> = process.env,
): DevQaOperatorConfig {
  if (env.PRINTERSHERO_DEV_QA_OPERATOR_ENABLED?.trim().toLowerCase() !== "true") {
    throw new Error("DEV QA operator is disabled. Set PRINTERSHERO_DEV_QA_OPERATOR_ENABLED=true in the deployed DEV environment.");
  }
  if (env.APP_ENV?.trim().toLowerCase() !== "development") {
    throw new Error("DEV QA operator requires APP_ENV=development.");
  }
  if (env.NODE_ENV?.trim().toLowerCase() !== "production") {
    throw new Error("DEV QA operator requires the deployed DEV server runtime (NODE_ENV=production).");
  }
  const allowedOrigin = normalizedOrigin(required(env, "PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN"), "PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN");
  const configuredOrigin = normalizedOrigin(required(env, "APP_PUBLIC_WEB_ORIGIN"), "APP_PUBLIC_WEB_ORIGIN");
  if (allowedOrigin.origin !== configuredOrigin.origin || allowedOrigin.hostname !== "dev.printershero.com") {
    throw new Error("DEV QA operator requires the reviewed https://dev.printershero.com origin.");
  }
  if (required(env, "PRINTERSHERO_DEV_QA_EXPECTED_ORG_ID") !== DEV_QA_OPERATOR_ORGANIZATION_ID) {
    throw new Error("DEV QA operator is locked to the dedicated PrintersHero M7 QA organization.");
  }
  const runtime = getRuntimeEnvironmentSummary({ env, requestHost: allowedOrigin.host, requestOrigin: allowedOrigin.origin });
  if (runtime.appRuntime !== "deployed-dev" || runtime.apiRuntime !== "deployed-dev" || runtime.databaseRuntime !== "dev-cloud") {
    throw new Error("DEV QA operator is unavailable outside the deployed DEV application and approved DEV cloud database.");
  }
  return Object.freeze({ organizationId: DEV_QA_OPERATOR_ORGANIZATION_ID, organizationName: DEV_QA_OPERATOR_ORGANIZATION_NAME, browserEmail: DEV_QA_OPERATOR_BROWSER_EMAIL });
}
