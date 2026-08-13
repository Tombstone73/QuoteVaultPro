import { expect, test } from "@jest/globals";

test("V2 PostgreSQL harness only runs after the fail-closed setup gate", () => {
  expect(process.env.V2_POSTGRES_INTEGRATION).toBe("1");
  expect(process.env.TEST_DATABASE_URL).toBeTruthy();
});
