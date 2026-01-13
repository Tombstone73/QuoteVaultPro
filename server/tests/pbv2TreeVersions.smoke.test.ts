import { describe, test } from "@jest/globals";

describe.skip("PBV2 DB smoke (moved to script)", () => {
  test("Run: npm run db:pbv2:check", () => {
    // DB schema checks were moved out of Jest to avoid OOM on Windows/ts-jest.
    // See scripts/db/pbv2-schema-check.ts
  });
});
