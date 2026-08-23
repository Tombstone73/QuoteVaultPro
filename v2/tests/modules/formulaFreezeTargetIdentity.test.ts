import { describe, expect, test } from "@jest/globals";
import { assertFormulaFreezeTargetMatchesExpected, expectedFormulaFreezeTargetFromEnvironment, parseFormulaFreezeTargetIdentity, selectFormulaFreezeInventoryConnection } from "../../src/modules/pricing/formulaFreezeTargetIdentity";

const expected = {
  host: "dev-db.example.internal",
  database: "quotevault_dev",
  schema: "product_v2",
  environment: "DEV",
};

describe("Formula freeze inventory target identity", () => {
  test("redacts credentials while reporting the parsed pre-connection target", () => {
    const actual = parseFormulaFreezeTargetIdentity("postgresql://sensitive-user:sensitive-password@dev-db.example.internal/quotevault_dev?schema=product_v2&sslmode=require", expected);
    expect(actual).toEqual({ ...expected, sslExpected: true, credentialsRedacted: true });
    expect(JSON.stringify(actual)).not.toContain("sensitive");
  });

  test("uses public as the explicit default schema and recognizes disabled SSL", () => {
    expect(parseFormulaFreezeTargetIdentity("postgres://user:password@dev-db.example.internal/quotevault_dev?sslmode=disable", { ...expected, schema: "public" })).toMatchObject({ schema: "public", sslExpected: false });
  });

  test("rejects a host, database, or schema mismatch before a caller can create a Pool", () => {
    const actual = parseFormulaFreezeTargetIdentity("postgres://user:password@other-db.example.internal/other?schema=other", expected);
    expect(() => assertFormulaFreezeTargetMatchesExpected(actual, expected)).toThrow("target mismatch");
  });

  test("requires every expected target identity field", () => {
    expect(() => expectedFormulaFreezeTargetFromEnvironment({ FORMULA_FREEZE_EXPECTED_HOST: "host" } as NodeJS.ProcessEnv)).toThrow("FORMULA_FREEZE_EXPECTED_DATABASE");
  });

  test("allows TEST_DATABASE_URL only with an explicit independently repeated clone proof", () => {
    const connection = selectFormulaFreezeInventoryConnection({
      TEST_DATABASE_URL: "postgres://user:password@dev-db.example.internal/quotevault_dev?schema=product_v2",
      FORMULA_FREEZE_ALLOW_TEST_DATABASE_URL_FOR_CLONE: "true",
      FORMULA_FREEZE_TEST_CLONE_CONFIRMATION: "READ_ONLY_FORMULA_FREEZE_CLONE",
      FORMULA_FREEZE_EXPECTED_HOST: expected.host,
      FORMULA_FREEZE_EXPECTED_DATABASE: expected.database,
      FORMULA_FREEZE_EXPECTED_SCHEMA: expected.schema,
      FORMULA_FREEZE_EXPECTED_ENVIRONMENT: expected.environment,
      FORMULA_FREEZE_TEST_CLONE_HOST: expected.host,
      FORMULA_FREEZE_TEST_CLONE_DATABASE: expected.database,
      FORMULA_FREEZE_TEST_CLONE_SCHEMA: expected.schema,
      FORMULA_FREEZE_TEST_CLONE_ENVIRONMENT: expected.environment,
    } as NodeJS.ProcessEnv);
    expect(connection).toMatchObject({ source: "TEST_DATABASE_URL", target: { ...expected, credentialsRedacted: true } });
  });

  test("does not permit TEST_DATABASE_URL merely because it is present", () => {
    expect(() => selectFormulaFreezeInventoryConnection({
      TEST_DATABASE_URL: "postgres://user:password@dev-db.example.internal/quotevault_dev?schema=product_v2",
      FORMULA_FREEZE_EXPECTED_HOST: expected.host,
      FORMULA_FREEZE_EXPECTED_DATABASE: expected.database,
      FORMULA_FREEZE_EXPECTED_SCHEMA: expected.schema,
      FORMULA_FREEZE_EXPECTED_ENVIRONMENT: expected.environment,
    } as NodeJS.ProcessEnv)).toThrow("FORMULA_FREEZE_INVENTORY_DATABASE_URL is required");
  });

  test("rejects a TEST_DATABASE_URL that is also an application URL", () => {
    const url = "postgres://user:password@dev-db.example.internal/quotevault_dev?schema=product_v2";
    expect(() => selectFormulaFreezeInventoryConnection({
      TEST_DATABASE_URL: url,
      DATABASE_URL: url,
      FORMULA_FREEZE_ALLOW_TEST_DATABASE_URL_FOR_CLONE: "true",
      FORMULA_FREEZE_TEST_CLONE_CONFIRMATION: "READ_ONLY_FORMULA_FREEZE_CLONE",
      FORMULA_FREEZE_EXPECTED_HOST: expected.host,
      FORMULA_FREEZE_EXPECTED_DATABASE: expected.database,
      FORMULA_FREEZE_EXPECTED_SCHEMA: expected.schema,
      FORMULA_FREEZE_EXPECTED_ENVIRONMENT: expected.environment,
      FORMULA_FREEZE_TEST_CLONE_HOST: expected.host,
      FORMULA_FREEZE_TEST_CLONE_DATABASE: expected.database,
      FORMULA_FREEZE_TEST_CLONE_SCHEMA: expected.schema,
      FORMULA_FREEZE_TEST_CLONE_ENVIRONMENT: expected.environment,
    } as NodeJS.ProcessEnv)).toThrow("application or migration URL");
  });
});
