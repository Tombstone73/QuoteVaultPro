export type AutoMigrateConfig = {
  enabled: boolean;
  raw: string | undefined;
  parsed: string;
};

export type MigrationDatabaseSelection = {
  connectionString: string;
  source: "MIGRATION_DATABASE_URL" | "DIRECT_DATABASE_URL" | "DATABASE_URL";
  usesAppDatabaseUrl: boolean;
};

export type MigrationLockConfig = {
  timeoutMs: number;
  retryIntervalMs: number;
};

function normalize(value: string | undefined | null): string {
  return (value ?? "").trim();
}

function normalizeLower(value: string | undefined | null): string {
  return normalize(value).toLowerCase();
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(normalize(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function parseAutoMigrateConfig(env: Record<string, string | undefined> = process.env): AutoMigrateConfig {
  const raw = env.DRIZZLE_AUTO_MIGRATE;
  const parsed = normalizeLower(raw);
  return {
    enabled: parsed !== "0" && parsed !== "false",
    raw,
    parsed,
  };
}

export function selectMigrationDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): MigrationDatabaseSelection {
  const migrationUrl = normalize(env.MIGRATION_DATABASE_URL);
  if (migrationUrl) {
    return {
      connectionString: migrationUrl,
      source: "MIGRATION_DATABASE_URL",
      usesAppDatabaseUrl: migrationUrl === normalize(env.DATABASE_URL),
    };
  }

  const directUrl = normalize(env.DIRECT_DATABASE_URL);
  if (directUrl) {
    return {
      connectionString: directUrl,
      source: "DIRECT_DATABASE_URL",
      usesAppDatabaseUrl: directUrl === normalize(env.DATABASE_URL),
    };
  }

  return {
    connectionString: normalize(env.DATABASE_URL),
    source: "DATABASE_URL",
    usesAppDatabaseUrl: true,
  };
}

export function isPooledNeonDatabaseUrl(connectionString: string | undefined): boolean {
  const raw = normalize(connectionString);
  if (!raw) return false;

  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    return hostname.endsWith(".neon.tech") && (hostname.includes("-pooler.") || hostname.includes("pooler"));
  } catch {
    return false;
  }
}

export function getSafeDatabaseLabel(connectionString: string | undefined): string {
  const raw = normalize(connectionString);
  if (!raw) return "not set";

  try {
    const url = new URL(raw);
    const dbName = url.pathname.replace(/^\//, "") || "unknown";
    const kind = isPooledNeonDatabaseUrl(raw) ? "pooled" : "direct";
    return `${url.hostname}/${dbName} (${kind}, credentials redacted)`;
  } catch {
    return "invalid URL (credentials redacted)";
  }
}

export function getMigrationLockConfig(
  env: Record<string, string | undefined> = process.env,
): MigrationLockConfig {
  const nodeEnv = normalizeLower(env.NODE_ENV);
  const defaultTimeoutMs = nodeEnv === "production" ? 120_000 : 30_000;
  return {
    timeoutMs: parsePositiveInteger(env.MIGRATION_LOCK_TIMEOUT_MS, defaultTimeoutMs),
    retryIntervalMs: parsePositiveInteger(env.MIGRATION_LOCK_RETRY_MS, 1_000),
  };
}
