/**
 * Isolated to the V2 experiment. This must not be used to weaken the V1 test
 * database guard: a V2 PostgreSQL run is allowed only when an explicit caller
 * supplies the disposable target plus known application references for a
 * fail-closed endpoint comparison.
 */
export class V2PostgresSafetyError extends Error {
  constructor(message: string) { super(message); }
}

type Environment = Record<string, string | undefined>;

type EndpointIdentity = { host: string; port: string; database: string };

const applicationUrlVariables = ["DATABASE_URL", "MIGRATION_DATABASE_URL", "DIRECT_DATABASE_URL", "DEV_DATABASE_URL", "PROD_DATABASE_URL", "PRODUCTION_DATABASE_URL"] as const;

function parsePostgresUrl(value: string, label: string): URL {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new V2PostgresSafetyError(`${label} must be a valid PostgreSQL URL.`); }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") throw new V2PostgresSafetyError(`${label} must use a PostgreSQL URL.`);
  if (!parsed.pathname || parsed.pathname === "/" || parsed.pathname.slice(1).includes("/")) throw new V2PostgresSafetyError(`${label} must identify exactly one database.`);
  return parsed;
}

function canonicalHost(host: string): string {
  const normalized = host.toLowerCase();
  // Neon direct/pooler hosts identify the same endpoint when they differ only
  // by this component; credentials/query strings are intentionally ignored.
  return normalized.endsWith(".neon.tech") ? normalized.replace("-pooler.", ".") : normalized;
}

function identity(url: URL): EndpointIdentity {
  return { host: canonicalHost(url.hostname), port: String(url.port || "5432"), database: decodeURIComponent(url.pathname.slice(1)).toLowerCase() };
}

function sameEndpoint(left: EndpointIdentity, right: EndpointIdentity): boolean {
  return left.host === right.host && left.port === right.port && left.database === right.database;
}

function referenceUrls(environment: Environment): string[] {
  const encoded = environment.V2_REFERENCE_DATABASE_URLS?.trim();
  if (!encoded) throw new V2PostgresSafetyError("V2_REFERENCE_DATABASE_URLS is required to prove the test target differs from known application databases.");
  let references: unknown;
  try { references = JSON.parse(encoded); } catch { throw new V2PostgresSafetyError("V2_REFERENCE_DATABASE_URLS must be a JSON array of PostgreSQL URLs."); }
  if (!Array.isArray(references) || references.length === 0 || references.some((value) => typeof value !== "string" || !value.trim())) throw new V2PostgresSafetyError("V2_REFERENCE_DATABASE_URLS must contain at least one nonempty PostgreSQL URL.");
  return references as string[];
}

/** Returns the unlogged test URL only after every isolation precondition passes. */
export function requireV2PocPostgresUrl(environment: Environment = process.env): string {
  if (environment.V2_POSTGRES_INTEGRATION !== "1") throw new V2PostgresSafetyError("V2_POSTGRES_INTEGRATION=1 is required for PostgreSQL experiment execution.");
  const testValue = environment.TEST_DATABASE_URL?.trim();
  if (!testValue) throw new V2PostgresSafetyError("TEST_DATABASE_URL is required; no database fallback is allowed.");
  const testIdentity = identity(parsePostgresUrl(testValue, "TEST_DATABASE_URL"));
  const knownApplicationUrls = [
    ...referenceUrls(environment),
    ...applicationUrlVariables.flatMap((name) => environment[name] ? [environment[name]!] : []),
  ];
  const applicationIdentities = knownApplicationUrls.map((value) => identity(parsePostgresUrl(value, "Application database reference")));
  if (applicationIdentities.some((candidate) => sameEndpoint(testIdentity, candidate))) {
    throw new V2PostgresSafetyError("TEST_DATABASE_URL aliases a known application database endpoint and is rejected.");
  }
  return testValue;
}
