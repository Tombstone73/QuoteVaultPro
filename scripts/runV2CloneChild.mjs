// The Railway CLI intentionally supplies DATABASE_URL.  V2 guarded rehearsals
// accept only TEST_DATABASE_URL, so this tiny child wrapper removes every other
// possible connection source before executing the requested npm script.
import { spawnSync } from "node:child_process";

const target = process.argv[2];
const cloneUrl = process.env.DATABASE_URL;
if (!target || !cloneUrl) throw new Error("A Railway-provided clone DATABASE_URL and an npm script are required.");
for (const key of Object.keys(process.env)) {
  if (key !== "TEST_DATABASE_URL" && /(?:DATABASE|POSTGRES|NEON|RAILWAY|CONNECTION_STRING|DB_URL|DB_URI)|^PG(?:_|[A-Z])|^DB(?:_|[A-Z])/iu.test(key)) delete process.env[key];
}
process.env.TEST_DATABASE_URL = cloneUrl;
process.env.V2_M0_POSTGRES_INTEGRATION = "1";
const executable = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(executable, ["run", target], { stdio: "inherit", env: process.env, shell: process.platform === "win32" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
