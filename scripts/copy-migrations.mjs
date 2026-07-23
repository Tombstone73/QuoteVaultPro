/**
 * Copy server/db/migrations_v2 → dist/db/migrations_v2 after esbuild bundle.
 * Run as: node scripts/copy-migrations.mjs
 * Called automatically by `npm run build`.
 *
 * After copying, reads the packaged journal and logs the highest idx so build
 * logs (Railway, CI) make stale-dist problems immediately visible.
 */
import { cpSync, mkdirSync, readFileSync, rmSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "server", "db", "migrations_v2");
const dest = path.join(root, "dist", "db", "migrations_v2");
const bridgeSrc = path.join(root, "local-bridge-agent");
const bridgeDest = path.join(root, "dist", "local-bridge-agent");

mkdirSync(path.dirname(dest), { recursive: true });
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
if (readFileSync && (() => { try { return !!readFileSync(path.join(bridgeSrc, "agent.mjs")); } catch { return false; } })()) { rmSync(bridgeDest, { recursive: true, force: true }); cpSync(bridgeSrc, bridgeDest, { recursive: true }); }
console.log("[Build] Copied server/db/migrations_v2 → dist/db/migrations_v2");

// Verify the copy: read the packaged journal and emit its highest idx.
// If this log is missing from Railway build output, the copy step did not run.
try {
  const journalPath = path.join(dest, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  const entries = journal.entries ?? [];
  const maxIdx = entries.length > 0 ? Math.max(...entries.map((e) => e.idx)) : -1;
  const lastTag = entries.find((e) => e.idx === maxIdx)?.tag ?? "unknown";
  console.log(
    `[Build] migrations_v2 packaged: ${entries.length} entries, highest idx = ${maxIdx} (${lastTag})`,
  );
} catch (e) {
  console.error(
    "[Build] WARNING: could not read packaged journal after copy — verify copy succeeded:",
    e.message,
  );
  process.exit(1);
}
