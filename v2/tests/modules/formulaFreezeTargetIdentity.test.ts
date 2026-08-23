import { describe, expect, test } from "@jest/globals";
import { assertFormulaFreezeTargetMatchesExpected, expectedFormulaFreezeTargetFromEnvironment, parseFormulaFreezeTargetIdentity } from "../../src/modules/pricing/formulaFreezeTargetIdentity";

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
});
