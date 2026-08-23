/**
 * Safety boundary for the one-time, read-only Formula freeze inventory.
 * This module deliberately parses only connection target metadata and never
 * returns credentials or a connection string.
 */
export type FormulaFreezeTargetIdentity = Readonly<{
  host: string;
  database: string;
  schema: string;
  environment: string;
  sslExpected: boolean;
  credentialsRedacted: true;
}>;

export type FormulaFreezeExpectedTarget = Readonly<{
  host: string;
  database: string;
  schema: string;
  environment: string;
}>;

export type FormulaFreezeInventoryConnection = Readonly<{
  connectionString: string;
  source: "FORMULA_FREEZE_INVENTORY_DATABASE_URL" | "TEST_DATABASE_URL";
  target: FormulaFreezeTargetIdentity;
}>;

const required = (value: string | undefined, name: string): string => {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required before opening a Formula freeze inventory connection.`);
  return normalized;
};

const normalizeHost = (value: string): string => value.trim().toLowerCase().replace(/\.$/, "");
const normalizeDatabase = (value: string): string => value.trim();
const normalizeSchema = (value: string): string => value.trim();

const requestedSchema = (url: URL): string => {
  const direct = url.searchParams.get("schema") ?? url.searchParams.get("currentSchema");
  if (direct?.trim()) return direct.trim();
  const options = url.searchParams.get("options");
  const searchPath = options?.match(/(?:^|\s)-c\s*search_path=([^\s]+)/)?.[1];
  return searchPath?.trim() || "public";
};

const sslExpected = (url: URL): boolean => {
  const mode = (url.searchParams.get("sslmode") ?? "").toLowerCase();
  if (["disable", "false", "0"].includes(mode)) return false;
  const ssl = (url.searchParams.get("ssl") ?? "").toLowerCase();
  if (["false", "0", "disable"].includes(ssl)) return false;
  // PostgreSQL deployment URLs normally require TLS. Absence of an explicit
  // disabling directive is intentionally reported as TLS expected, not proof
  // that a socket has been opened or negotiated.
  return true;
};

export const expectedFormulaFreezeTargetFromEnvironment = (environment: NodeJS.ProcessEnv): FormulaFreezeExpectedTarget => ({
  host: normalizeHost(required(environment.FORMULA_FREEZE_EXPECTED_HOST, "FORMULA_FREEZE_EXPECTED_HOST")),
  database: normalizeDatabase(required(environment.FORMULA_FREEZE_EXPECTED_DATABASE, "FORMULA_FREEZE_EXPECTED_DATABASE")),
  schema: normalizeSchema(required(environment.FORMULA_FREEZE_EXPECTED_SCHEMA, "FORMULA_FREEZE_EXPECTED_SCHEMA")),
  environment: required(environment.FORMULA_FREEZE_EXPECTED_ENVIRONMENT, "FORMULA_FREEZE_EXPECTED_ENVIRONMENT"),
});

const testCloneExpectedTargetFromEnvironment = (environment: NodeJS.ProcessEnv): FormulaFreezeExpectedTarget => ({
  host: normalizeHost(required(environment.FORMULA_FREEZE_TEST_CLONE_HOST, "FORMULA_FREEZE_TEST_CLONE_HOST")),
  database: normalizeDatabase(required(environment.FORMULA_FREEZE_TEST_CLONE_DATABASE, "FORMULA_FREEZE_TEST_CLONE_DATABASE")),
  schema: normalizeSchema(required(environment.FORMULA_FREEZE_TEST_CLONE_SCHEMA, "FORMULA_FREEZE_TEST_CLONE_SCHEMA")),
  environment: required(environment.FORMULA_FREEZE_TEST_CLONE_ENVIRONMENT, "FORMULA_FREEZE_TEST_CLONE_ENVIRONMENT"),
});

export const parseFormulaFreezeTargetIdentity = (connectionString: string, expected: FormulaFreezeExpectedTarget): FormulaFreezeTargetIdentity => {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("FORMULA_FREEZE_INVENTORY_DATABASE_URL is not a valid PostgreSQL connection URL.");
  }
  if (!/^postgres(?:ql)?:$/i.test(url.protocol)) throw new Error("FORMULA_FREEZE_INVENTORY_DATABASE_URL must use a PostgreSQL URL.");
  const database = decodeURIComponent(url.pathname.replace(/^\//, "")).trim();
  if (!url.hostname || !database) throw new Error("FORMULA_FREEZE_INVENTORY_DATABASE_URL must include a host and database name.");
  return {
    host: normalizeHost(url.hostname),
    database: normalizeDatabase(database),
    schema: requestedSchema(url),
    environment: expected.environment,
    sslExpected: sslExpected(url),
    credentialsRedacted: true,
  };
};

export const assertFormulaFreezeTargetMatchesExpected = (actual: FormulaFreezeTargetIdentity, expected: FormulaFreezeExpectedTarget): void => {
  const mismatches: string[] = [];
  if (actual.host !== normalizeHost(expected.host)) mismatches.push("host");
  if (actual.database !== normalizeDatabase(expected.database)) mismatches.push("database");
  if (actual.schema !== normalizeSchema(expected.schema)) mismatches.push("schema");
  if (mismatches.length) throw new Error(`Formula freeze inventory target mismatch (${mismatches.join(", ")}); refusing to connect.`);
};

const assertNotApplicationUrl = (candidate: string, environment: NodeJS.ProcessEnv): void => {
  const applicationUrls = [environment.DATABASE_URL, environment.MIGRATION_DATABASE_URL, environment.DIRECT_DATABASE_URL]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  if (applicationUrls.includes(candidate.trim())) {
    throw new Error("TEST_DATABASE_URL is also configured as an application or migration URL; refusing Formula freeze inventory connection.");
  }
};

/**
 * The planner normally accepts only its dedicated URL. A one-time clone
 * exception is intentionally narrower than generic test-suite policy: it
 * requires an explicit switch, confirmation, and an independently repeated
 * clone target identity. This function still does not open a connection.
 */
export const selectFormulaFreezeInventoryConnection = (environment: NodeJS.ProcessEnv): FormulaFreezeInventoryConnection => {
  const expected = expectedFormulaFreezeTargetFromEnvironment(environment);
  const dedicated = environment.FORMULA_FREEZE_INVENTORY_DATABASE_URL?.trim();
  if (dedicated) {
    const target = parseFormulaFreezeTargetIdentity(dedicated, expected);
    assertFormulaFreezeTargetMatchesExpected(target, expected);
    return { connectionString: dedicated, source: "FORMULA_FREEZE_INVENTORY_DATABASE_URL", target };
  }

  if (environment.FORMULA_FREEZE_ALLOW_TEST_DATABASE_URL_FOR_CLONE !== "true") {
    throw new Error("FORMULA_FREEZE_INVENTORY_DATABASE_URL is required; TEST_DATABASE_URL is allowed only with FORMULA_FREEZE_ALLOW_TEST_DATABASE_URL_FOR_CLONE=true and clone identity proof.");
  }
  if (environment.FORMULA_FREEZE_TEST_CLONE_CONFIRMATION !== "READ_ONLY_FORMULA_FREEZE_CLONE") {
    throw new Error("FORMULA_FREEZE_TEST_CLONE_CONFIRMATION=READ_ONLY_FORMULA_FREEZE_CLONE is required before TEST_DATABASE_URL may be used for the read-only Formula freeze inventory.");
  }
  const testUrl = required(environment.TEST_DATABASE_URL, "TEST_DATABASE_URL");
  assertNotApplicationUrl(testUrl, environment);
  const cloneExpected = testCloneExpectedTargetFromEnvironment(environment);
  const target = parseFormulaFreezeTargetIdentity(testUrl, expected);
  assertFormulaFreezeTargetMatchesExpected(target, expected);
  assertFormulaFreezeTargetMatchesExpected(target, cloneExpected);
  return { connectionString: testUrl, source: "TEST_DATABASE_URL", target };
};
