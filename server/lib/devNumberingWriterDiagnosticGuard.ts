import { getRuntimeEnvironmentSummary } from "./runtimeEnvironment.js";

export class DevNumberingWriterDiagnosticEnvironmentError extends Error {
  override readonly name = "DevNumberingWriterDiagnosticEnvironmentError";
}

const required = (env: Readonly<Record<string, string | undefined>>, key: string): string => {
  const value = env[key]?.trim();
  if (!value) throw new DevNumberingWriterDiagnosticEnvironmentError(`DEV numbering writer diagnostic requires ${key}.`);
  return value;
};

/**
 * This intentionally permits only a command executed from the deployed DEV
 * service.  The command itself also requires an explicit one-shot CLI intent,
 * an organization id, and QA-only source records; this guard makes a copied
 * command fail closed against local, production, or MAIN runtimes.
 */
export const assertDevNumberingWriterDiagnosticEnvironment = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): void => {
  if (env.APP_ENV?.trim().toLowerCase() !== "development" || env.NODE_ENV?.trim().toLowerCase() !== "production") {
    throw new DevNumberingWriterDiagnosticEnvironmentError("DEV numbering writer diagnostic requires the deployed DEV runtime profile.");
  }
  if (env.RAILWAY_PROJECT_NAME?.trim() !== "PrintersHero-DEV" || env.RAILWAY_ENVIRONMENT_NAME?.trim() !== "Development") {
    throw new DevNumberingWriterDiagnosticEnvironmentError("DEV numbering writer diagnostic is restricted to Railway PrintersHero-DEV / Development.");
  }
  const originText = required(env, "APP_PUBLIC_WEB_ORIGIN");
  let origin: URL;
  try {
    origin = new URL(originText);
  } catch {
    throw new DevNumberingWriterDiagnosticEnvironmentError("DEV numbering writer diagnostic requires a valid DEV public origin.");
  }
  if (origin.origin !== "https://dev.printershero.com") {
    throw new DevNumberingWriterDiagnosticEnvironmentError("DEV numbering writer diagnostic requires https://dev.printershero.com.");
  }
  const runtime = getRuntimeEnvironmentSummary({ env, requestHost: origin.host, requestOrigin: origin.origin });
  if (runtime.appRuntime !== "deployed-dev" || runtime.apiRuntime !== "deployed-dev" || runtime.databaseRuntime !== "dev-cloud") {
    throw new DevNumberingWriterDiagnosticEnvironmentError("DEV numbering writer diagnostic requires the deployed DEV application and DEV-cloud database.");
  }
  required(env, "DATABASE_URL");
};
