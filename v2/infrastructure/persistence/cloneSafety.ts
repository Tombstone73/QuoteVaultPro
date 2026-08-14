/**
 * M0 integration tests may write only to an explicitly supplied disposable
 * clone. This module deliberately does not import dotenv, application config,
 * or any V1 database runtime.
 */
export const V2_M0_WRITE_OPT_IN = "V2_M0_POSTGRES_INTEGRATION";

export class UnsafeV2M0CloneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeV2M0CloneError";
  }
}

export type V2M0DatabaseEnvironment = Record<string, string | undefined>;

const isDatabaseConnectionVariable = (key: string): boolean => {
  if (key === "TEST_DATABASE_URL" || key === V2_M0_WRITE_OPT_IN) return false;
  // The integration harness must have one possible connection source only.
  // This intentionally also rejects libpq component variables (PGHOST, etc.)
  // and V2 runtime configuration: either could bypass TEST_DATABASE_URL.
  return /(?:DATABASE|POSTGRES|NEON|RAILWAY|CONNECTION_STRING|DB_URL|DB_URI)/i.test(key)
    || /^PG(?:_|[A-Z])/i.test(key)
    || /^DB(?:_|[A-Z])/i.test(key);
};

export function requireV2M0CloneDatabaseUrl(env: V2M0DatabaseEnvironment = process.env): string {
  if (env[V2_M0_WRITE_OPT_IN] !== "1") {
    throw new UnsafeV2M0CloneError(`${V2_M0_WRITE_OPT_IN} must explicitly equal 1.`);
  }

  const url = env.TEST_DATABASE_URL?.trim();
  if (!url) throw new UnsafeV2M0CloneError("TEST_DATABASE_URL is required; no database URL fallback is permitted.");

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      throw new UnsafeV2M0CloneError("TEST_DATABASE_URL must use a PostgreSQL protocol.");
    }
  } catch (error) {
    if (error instanceof UnsafeV2M0CloneError) throw error;
    throw new UnsafeV2M0CloneError("TEST_DATABASE_URL must be a valid PostgreSQL connection URL.");
  }

  const otherConnectionVariables = Object.entries(env)
    .filter(([key, value]) => isDatabaseConnectionVariable(key) && Boolean(value?.trim()))
    .map(([key]) => key);
  if (otherConnectionVariables.length > 0) {
    throw new UnsafeV2M0CloneError("The V2 M0 harness must not have any other database connection URL available.");
  }
  return url;
}
