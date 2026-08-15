import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, test } from "@jest/globals";

const runner = resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const script = resolve(process.cwd(), "v2", "scripts", "runM0PostgresRehearsal.ts");

const cleanEnvironment = (extra: Record<string, string> = {}) => Object.fromEntries([
  ...Object.entries(process.env).filter(([key]) => !/(?:DATABASE|POSTGRES|NEON|RAILWAY|CONNECTION_STRING|DB_URL|DB_URI)/i.test(key) && !/^PG(?:_|[A-Z])/i.test(key) && !/^DB(?:_|[A-Z])/i.test(key)),
  ...Object.entries(extra),
]);

const execute = (extra?: Record<string, string>) => spawnSync(process.execPath, [runner, script], {
  cwd: process.cwd(), env: cleanEnvironment(extra), encoding: "utf8",
});

describe("V2 M0 guarded PostgreSQL rehearsal runner", () => {
  test("fails non-zero when the explicit write opt-in is absent and never logs the candidate credential", () => {
    const result = execute({ TEST_DATABASE_URL: "postgresql://runner:do-not-log@localhost:5432/clone" });
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toMatch(/V2_M0_POSTGRES_INTEGRATION/i);
    expect(`${result.stdout}${result.stderr}`).not.toContain("do-not-log");
  });

  test("does not allow V2_DATABASE_URL to substitute for TEST_DATABASE_URL", () => {
    const result = execute({ V2_M0_POSTGRES_INTEGRATION: "1", V2_DATABASE_URL: "postgresql://runner:do-not-log@localhost:5432/runtime" });
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toMatch(/TEST_DATABASE_URL is required/i);
    expect(`${result.stdout}${result.stderr}`).not.toContain("do-not-log");
  });

  test("rejects a second database source before attempting a connection", () => {
    const result = execute({
      V2_M0_POSTGRES_INTEGRATION: "1",
      TEST_DATABASE_URL: "postgresql://runner:do-not-log@localhost:5432/clone",
      DATABASE_URL: "postgresql://runner:also-do-not-log@localhost:5432/runtime",
    });
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toMatch(/other database connection URL/i);
    expect(`${result.stdout}${result.stderr}`).not.toContain("do-not-log");
    expect(`${result.stdout}${result.stderr}`).not.toContain("also-do-not-log");
  });
});
