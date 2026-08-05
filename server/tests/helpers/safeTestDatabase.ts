/**
 * Guardrail for integration suites that may write to PostgreSQL.
 *
 * A test suite must opt in with TEST_DATABASE_URL.  We intentionally do not
 * accept an app DATABASE_URL as a fallback: an absent dedicated test URL means
 * that database suites are skipped and pure tests remain database-free.
 */
export class UnsafeTestDatabaseUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeTestDatabaseUrlError";
  }
}

export type DatabaseTestEnvironment = Record<string, string | undefined> & {
  TEST_DATABASE_URL?: string;
  DATABASE_URL?: string;
  MIGRATION_DATABASE_URL?: string;
  DIRECT_DATABASE_URL?: string;
};

const UNSAFE_TARGET = /(?:^|[-_.])(dev|development|main|prod|production|live|shared|business)(?:$|[-_.])/i;
const SAFE_TEST_TARGET = /(?:^|[-_.])(test|testing|ci)(?:$|[-_.])/i;

function normalized(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function databaseName(url: URL): string {
  const pathname = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, "");
  if (!pathname || pathname.includes("/")) {
    throw new UnsafeTestDatabaseUrlError("TEST_DATABASE_URL must name exactly one dedicated test database.");
  }
  return pathname;
}

/**
 * Returns a URL only when it is explicitly designated as a safe test database.
 * It performs no connection and can safely run from Jest setup before DB modules
 * have been imported.
 */
export function safeTestDatabaseUrl(env: DatabaseTestEnvironment = process.env): string | null {
  const candidate = normalized(env.TEST_DATABASE_URL);
  if (!candidate) return null;

  const configuredApplicationUrls = [env.DATABASE_URL, env.MIGRATION_DATABASE_URL, env.DIRECT_DATABASE_URL]
    .map(normalized)
    .filter((value): value is string => Boolean(value));
  if (configuredApplicationUrls.includes(candidate)) {
    throw new UnsafeTestDatabaseUrlError("TEST_DATABASE_URL must be different from every application or migration database URL.");
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new UnsafeTestDatabaseUrlError("TEST_DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new UnsafeTestDatabaseUrlError("TEST_DATABASE_URL must use the postgres or postgresql protocol.");
  }

  const target = databaseName(parsed);
  if (UNSAFE_TARGET.test(target)) {
    throw new UnsafeTestDatabaseUrlError("TEST_DATABASE_URL points to a DEV, MAIN, production, shared, or business database and is blocked.");
  }
  if (!SAFE_TEST_TARGET.test(target)) {
    throw new UnsafeTestDatabaseUrlError("TEST_DATABASE_URL database name must include a standalone test, testing, or ci marker.");
  }
  return candidate;
}

/** Throws rather than silently skipping when an unsafe URL was supplied. */
export function requireSafeTestDatabaseUrl(env: DatabaseTestEnvironment = process.env): string {
  const url = safeTestDatabaseUrl(env);
  if (!url) throw new UnsafeTestDatabaseUrlError("This database suite requires a dedicated TEST_DATABASE_URL; DATABASE_URL is never used as a fallback.");
  return url;
}

/** Lets a suite opt into describe.skip without importing server/db. */
export function hasSafeTestDatabase(env: DatabaseTestEnvironment = process.env): boolean {
  return safeTestDatabaseUrl(env) !== null;
}
