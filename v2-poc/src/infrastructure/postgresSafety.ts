/**
 * Isolated to the V2 experiment. This must not be used to weaken the V1 test
 * database guard: a V2 PostgreSQL run is allowed only when an explicit caller
 * supplies the operator-approved disposable target. The V2 harness must see
 * exactly one database URL: TEST_DATABASE_URL.
 */
export class V2PostgresSafetyError extends Error {
  constructor(message: string) { super(message); }
}

type Environment = Record<string, string | undefined>;

const databaseUrlVariable = /(DATABASE_URL|POSTGRES(?:QL)?_URL|NEON(?:_DATABASE)?_URL)$/i;

function parsePostgresUrl(value: string, label: string): URL {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new V2PostgresSafetyError(`${label} must be a valid PostgreSQL URL.`); }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") throw new V2PostgresSafetyError(`${label} must use a PostgreSQL URL.`);
  if (!parsed.pathname || parsed.pathname === "/" || parsed.pathname.slice(1).includes("/")) throw new V2PostgresSafetyError(`${label} must identify exactly one database.`);
  return parsed;
}

function availableAlternateDatabaseUrlVariables(environment: Environment): string[] {
  return Object.entries(environment)
    .filter(([name, value]) => name !== "TEST_DATABASE_URL" && databaseUrlVariable.test(name) && Boolean(value?.trim()))
    .map(([name]) => name)
    .sort();
}

/** Returns the unlogged test URL only after every isolation precondition passes. */
export function requireV2PocPostgresUrl(environment: Environment = process.env): string {
  if (environment.V2_POSTGRES_INTEGRATION !== "1") throw new V2PostgresSafetyError("V2_POSTGRES_INTEGRATION=1 is required for PostgreSQL experiment execution.");
  const testValue = environment.TEST_DATABASE_URL?.trim();
  if (!testValue) throw new V2PostgresSafetyError("TEST_DATABASE_URL is required; no database fallback is allowed.");
  parsePostgresUrl(testValue, "TEST_DATABASE_URL");
  const alternateNames = availableAlternateDatabaseUrlVariables(environment);
  if (alternateNames.length) throw new V2PostgresSafetyError(`V2 harness must expose only TEST_DATABASE_URL; alternate database URL variable(s) are present: ${alternateNames.join(", ")}.`);
  return testValue;
}
