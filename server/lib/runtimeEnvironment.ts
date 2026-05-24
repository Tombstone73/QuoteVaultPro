export type RuntimeKind = "local" | "deployed-dev" | "production" | "unknown";
export type DatabaseRuntimeKind = "local" | "dev-cloud" | "production-cloud" | "unknown";

export type RuntimeEnvironmentSummary = {
  appRuntime: RuntimeKind;
  apiRuntime: RuntimeKind;
  databaseRuntime: DatabaseRuntimeKind;
  databaseLabel: string;
  canMutateSharedDevData: boolean;
  migrationRunsOnStartup: boolean;
  warningMessage: string | null;
};

type RuntimeEnvironmentOptions = {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  requestHost?: string | null;
  requestOrigin?: string | null;
};

const DEV_NEON_HOSTS = new Set([
  "ep-wandering-band-aebq1qcx-pooler.c-2.us-east-2.aws.neon.tech",
]);

function normalize(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

function hostnameFromMaybeUrl(value: string | undefined | null): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;

  try {
    const url = raw.includes("://") ? new URL(raw) : new URL(`http://${raw}`);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isLocalHostname(hostname: string | null): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function hasDevMarker(value: string): boolean {
  return /\b(dev|development|staging|stage|test|preview)\b/.test(value);
}

function hasProductionMarker(value: string): boolean {
  return /\b(prod|production)\b/.test(value);
}

function classifyRuntime(params: {
  env: RuntimeEnvironmentOptions["env"];
  host?: string | null;
  origin?: string | null;
  nodeEnv: string;
}): RuntimeKind {
  const env = params.env ?? process.env;
  const host = hostnameFromMaybeUrl(params.host) ?? hostnameFromMaybeUrl(params.origin);
  const publicOriginHost = hostnameFromMaybeUrl(env.APP_PUBLIC_WEB_ORIGIN);
  const markerText = [
    env.APP_ENV,
    env.RAILWAY_ENVIRONMENT,
    env.RAILWAY_ENVIRONMENT_NAME,
    env.VERCEL_ENV,
    env.VITE_PUBLIC_APP_ENV,
    host,
    publicOriginHost,
  ].map((part) => normalize(part)).filter(Boolean).join(" ");

  if (isLocalHostname(host)) return "local";

  if (
    host === "printershero.com" ||
    host === "www.printershero.com" ||
    publicOriginHost === "printershero.com" ||
    publicOriginHost === "www.printershero.com" ||
    hasProductionMarker(markerText)
  ) {
    return "production";
  }

  if (hasDevMarker(markerText)) return "deployed-dev";
  if (params.nodeEnv === "development") return "local";
  if (params.nodeEnv === "production") return "production";

  return "unknown";
}

export function detectDatabaseRuntime(
  databaseUrl: string | undefined,
  env: RuntimeEnvironmentOptions["env"] = process.env,
): { databaseRuntime: DatabaseRuntimeKind; databaseLabel: string } {
  const raw = (databaseUrl ?? "").trim();
  if (!raw) {
    return { databaseRuntime: "unknown", databaseLabel: "Unknown database" };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { databaseRuntime: "unknown", databaseLabel: "Unknown database" };
  }

  const host = parsed.hostname.toLowerCase();
  const dbName = parsed.pathname.replace(/^\//, "").toLowerCase();
  const username = parsed.username.toLowerCase();
  const searchable = [
    host,
    dbName,
    username,
    normalize(env.APP_ENV),
    normalize(env.RAILWAY_ENVIRONMENT),
    normalize(env.RAILWAY_ENVIRONMENT_NAME),
    normalize(env.DATABASE_ENV),
    normalize(env.DB_ENV),
  ].filter(Boolean).join(" ");

  if (isLocalHostname(host)) {
    return { databaseRuntime: "local", databaseLabel: "Local Postgres" };
  }

  const isNeon = host.endsWith(".neon.tech") || host.includes(".neon.tech");
  if (isNeon && (DEV_NEON_HOSTS.has(host) || hasDevMarker(searchable) || !hasProductionMarker(searchable))) {
    return { databaseRuntime: "dev-cloud", databaseLabel: "DEV Neon" };
  }

  if (hasProductionMarker(searchable)) {
    return { databaseRuntime: "production-cloud", databaseLabel: isNeon ? "Production Neon" : "Production database" };
  }

  return { databaseRuntime: "unknown", databaseLabel: "Unknown database" };
}

export function migrationRunsOnStartup(env: RuntimeEnvironmentOptions["env"] = process.env): boolean {
  const flag = normalize(env.DRIZZLE_AUTO_MIGRATE);
  return flag !== "0" && flag !== "false";
}

export function getRuntimeEnvironmentSummary(
  options: RuntimeEnvironmentOptions = {},
): RuntimeEnvironmentSummary {
  const env = options.env ?? process.env;
  const nodeEnv = normalize(env.NODE_ENV);
  const appRuntime = classifyRuntime({
    env,
    host: options.requestOrigin ?? env.APP_PUBLIC_WEB_ORIGIN ?? options.requestHost,
    origin: options.requestOrigin ?? env.APP_PUBLIC_WEB_ORIGIN ?? options.requestHost,
    nodeEnv,
  });
  const apiRuntime = classifyRuntime({
    env,
    host: options.requestHost,
    origin: options.requestOrigin,
    nodeEnv,
  });
  const { databaseRuntime, databaseLabel } = detectDatabaseRuntime(env.DATABASE_URL, env);
  const migrationRuns = migrationRunsOnStartup(env);
  const canMutateSharedDevData = nodeEnv === "development" && databaseRuntime === "dev-cloud";
  const warningMessage = canMutateSharedDevData
    ? "LOCAL APP -> DEV CLOUD DB. Changes here affect shared DEV data."
    : null;

  return {
    appRuntime,
    apiRuntime,
    databaseRuntime,
    databaseLabel,
    canMutateSharedDevData,
    migrationRunsOnStartup: migrationRuns,
    warningMessage,
  };
}

export function getStartupSharedDevDatabaseWarning(
  env: RuntimeEnvironmentOptions["env"] = process.env,
): string | null {
  const summary = getRuntimeEnvironmentSummary({ env });
  if (normalize(env.NODE_ENV) === "development" && summary.databaseRuntime === "dev-cloud") {
    return "WARNING: Local development server is connected to shared DEV cloud database. Local writes and startup migrations affect DEV.";
  }
  return null;
}
