/**
 * Clone-only proof that the ordinary migration runner follows a completed
 * M7.2C reconciliation. This starts no HTTP service or worker.
 */
import { createHash } from "node:crypto";

const PROD_HOST_SHA256_16 = "6775f8eb2ab01aad";

function fingerprint(host: string): string {
  return createHash("sha256").update(host).digest("hex").slice(0, 16);
}

const target = process.env.M72C_RECONCILIATION_DATABASE_URL;
if (process.env.M72C_REHEARSAL !== "1" || !target) {
  throw new Error("[M7.2C] rehearsal acknowledgement and dedicated reconciliation URL are required.");
}
const parsed = new URL(target);
const targetFingerprint = fingerprint(parsed.hostname);
if (!parsed.hostname.endsWith(".neon.tech") || targetFingerprint === PROD_HOST_SHA256_16 || targetFingerprint !== process.env.M72C_EXPECTED_CLONE_HOST_SHA256_16) {
  throw new Error("[M7.2C] refusing a non-clone or fingerprint-mismatched follow-on target.");
}

// `runMigrations` is deliberately exercised unchanged: its only inputs are
// mapped from the dedicated clone URL in this process, never from ambient app
// deployment configuration.
process.env.DATABASE_URL = target;
process.env.MIGRATION_DATABASE_URL = target;
process.env.DRIZZLE_AUTO_MIGRATE = "1";
delete process.env.DIRECT_DATABASE_URL;

const { runMigrations } = await import("../../server/runMigrations.js");
await runMigrations();
console.log("[M7.2C] normal Drizzle follow-on completed after reconciliation gate.");
