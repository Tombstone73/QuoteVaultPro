import { getRuntimeEnvironmentSummary } from "./runtimeEnvironment.js";

export class DevQaQuoteArtworkProvisioningError extends Error {
  override readonly name = "DevQaQuoteArtworkProvisioningError";
}

const required = (env: Readonly<Record<string, string | undefined>>, key: string): string => {
  const value = env[key]?.trim();
  if (!value) throw new DevQaQuoteArtworkProvisioningError(`DEV QA Quote Artwork provisioning requires ${key}.`);
  return value;
};

/**
 * A deliberately narrow guard for the disposable DEV Quote-artwork fixture.
 * It is intentionally unsuitable for a local database, a generic staging
 * target, or the production project. The command still needs an explicit
 * one-shot opt-in in addition to these deployment facts.
 */
export const assertDevQaQuoteArtworkProvisioningEnvironment = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): void => {
  if (env.PRINTERSHERO_DEV_QA_ARTWORK_PROVISION_ENABLED?.trim().toLowerCase() !== "true") {
    throw new DevQaQuoteArtworkProvisioningError("DEV QA Quote Artwork provisioning is disabled.");
  }
  if (env.APP_ENV?.trim().toLowerCase() !== "development" || env.NODE_ENV?.trim().toLowerCase() !== "production") {
    throw new DevQaQuoteArtworkProvisioningError("DEV QA Quote Artwork provisioning requires the deployed DEV runtime profile.");
  }
  if (env.RAILWAY_PROJECT_NAME?.trim() !== "PrintersHero-DEV" || env.RAILWAY_ENVIRONMENT_NAME?.trim() !== "Development") {
    throw new DevQaQuoteArtworkProvisioningError("DEV QA Quote Artwork provisioning is restricted to Railway PrintersHero-DEV / Development.");
  }
  const publicOrigin = required(env, "APP_PUBLIC_WEB_ORIGIN");
  let origin: URL;
  try { origin = new URL(publicOrigin); } catch { throw new DevQaQuoteArtworkProvisioningError("DEV QA Quote Artwork provisioning requires a valid DEV public origin."); }
  if (origin.origin !== "https://dev.printershero.com") {
    throw new DevQaQuoteArtworkProvisioningError("DEV QA Quote Artwork provisioning requires https://dev.printershero.com.");
  }
  const runtime = getRuntimeEnvironmentSummary({ env, requestHost: origin.host, requestOrigin: origin.origin });
  if (runtime.appRuntime !== "deployed-dev" || runtime.apiRuntime !== "deployed-dev" || runtime.databaseRuntime !== "dev-cloud") {
    throw new DevQaQuoteArtworkProvisioningError("DEV QA Quote Artwork provisioning requires the DEV application and DEV-cloud database.");
  }
  required(env, "DATABASE_URL");
  required(env, "SUPABASE_URL");
  required(env, "SUPABASE_SERVICE_ROLE_KEY");
};
