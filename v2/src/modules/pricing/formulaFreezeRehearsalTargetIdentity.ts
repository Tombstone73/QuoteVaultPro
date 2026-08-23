/**
 * Target guard for the explicitly authorized disposable-clone Formula freeze
 * rehearsal.  This is intentionally separate from the read-only inventory:
 * it never falls back to TEST_DATABASE_URL or an application connection.
 */
export type FormulaFreezeRehearsalTarget = Readonly<{
  host: string;
  database: string;
  schema: string;
  environment: "DISPOSABLE_VALIDATION_CLONE";
  sslExpected: boolean;
  credentialsRedacted: true;
}>;

export type FormulaFreezeRehearsalConnection = Readonly<{
  connectionString: string;
  target: FormulaFreezeRehearsalTarget;
}>;

const required = (value: string | undefined, name: string): string => {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required before opening a Formula freeze rehearsal connection.`);
  return normalized;
};
const host = (value: string) => value.trim().toLowerCase().replace(/\.$/u, "");
const schemaFrom = (url: URL): string => {
  const direct = url.searchParams.get("schema") ?? url.searchParams.get("currentSchema");
  if (direct?.trim()) return direct.trim();
  const searchPath = url.searchParams.get("options")?.match(/(?:^|\s)-c\s*search_path=([^\s]+)/u)?.[1];
  return searchPath?.trim() || "public";
};
const tlsExpected = (url: URL): boolean => !["disable", "false", "0"].includes((url.searchParams.get("sslmode") ?? url.searchParams.get("ssl") ?? "").toLowerCase());

/** Parses and proves a dedicated rehearsal target before a Pool is constructed. */
export const selectFormulaFreezeRehearsalConnection = (environment: NodeJS.ProcessEnv): FormulaFreezeRehearsalConnection => {
  const connectionString = required(environment.FORMULA_FREEZE_REHEARSAL_DATABASE_URL, "FORMULA_FREEZE_REHEARSAL_DATABASE_URL");
  const expectedHost = host(required(environment.FORMULA_FREEZE_REHEARSAL_EXPECTED_HOST, "FORMULA_FREEZE_REHEARSAL_EXPECTED_HOST"));
  const expectedDatabase = required(environment.FORMULA_FREEZE_REHEARSAL_EXPECTED_DATABASE, "FORMULA_FREEZE_REHEARSAL_EXPECTED_DATABASE");
  const expectedSchema = required(environment.FORMULA_FREEZE_REHEARSAL_EXPECTED_SCHEMA, "FORMULA_FREEZE_REHEARSAL_EXPECTED_SCHEMA");
  if (required(environment.FORMULA_FREEZE_REHEARSAL_EXPECTED_ENVIRONMENT, "FORMULA_FREEZE_REHEARSAL_EXPECTED_ENVIRONMENT") !== "DISPOSABLE_VALIDATION_CLONE") {
    throw new Error("FORMULA_FREEZE_REHEARSAL_EXPECTED_ENVIRONMENT must be DISPOSABLE_VALIDATION_CLONE.");
  }
  if ([environment.DATABASE_URL, environment.MIGRATION_DATABASE_URL, environment.DIRECT_DATABASE_URL, environment.TEST_DATABASE_URL]
    .some((value) => value?.trim() === connectionString)) {
    throw new Error("Formula freeze rehearsal URL matches an application, migration, direct, or TEST database URL; refusing to connect.");
  }
  let url: URL;
  try { url = new URL(connectionString); } catch { throw new Error("FORMULA_FREEZE_REHEARSAL_DATABASE_URL is not a valid PostgreSQL URL."); }
  if (!/^postgres(?:ql)?:$/iu.test(url.protocol) || !url.hostname || !url.pathname.replace(/^\//u, "").trim()) {
    throw new Error("FORMULA_FREEZE_REHEARSAL_DATABASE_URL must include a PostgreSQL host and database.");
  }
  const target: FormulaFreezeRehearsalTarget = {
    host: host(url.hostname), database: decodeURIComponent(url.pathname.replace(/^\//u, "")).trim(), schema: schemaFrom(url),
    environment: "DISPOSABLE_VALIDATION_CLONE", sslExpected: tlsExpected(url), credentialsRedacted: true,
  };
  const mismatches = [target.host !== expectedHost && "host", target.database !== expectedDatabase && "database", target.schema !== expectedSchema && "schema"].filter(Boolean);
  if (mismatches.length) throw new Error(`Formula freeze rehearsal target mismatch (${mismatches.join(", ")}); refusing to connect.`);
  return { connectionString, target };
};
