#!/usr/bin/env node
/**
 * check-journal-monotonic.mjs
 *
 * Validates that server/db/migrations_v2/meta/_journal.json has strictly
 * increasing 'when' values ordered by idx.
 *
 * Drizzle's migrator silently skips any migration whose 'when' (folderMillis)
 * is <= MAX(created_at) in the ledger table. If a newer migration has a lower
 * 'when' than an earlier one, it will be permanently skipped once the earlier
 * one is applied.
 *
 * Usage:
 *   node scripts/check-journal-monotonic.mjs
 *   npm run db:migrations:v2:check-journal
 *
 * Exit codes:
 *   0 — journal is strictly monotonic
 *   1 — one or more violations found (non-monotonic when values)
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const journalPath = path.resolve(__dirname, "../server/db/migrations_v2/meta/_journal.json");

let journal;
try {
  journal = JSON.parse(readFileSync(journalPath, "utf8"));
} catch (e) {
  console.error(`[check-journal] ERROR: could not read journal at ${journalPath}: ${e.message}`);
  process.exit(1);
}

const entries = (journal.entries ?? []).slice().sort((a, b) => a.idx - b.idx);

if (entries.length === 0) {
  console.log("[check-journal] Journal has no entries — nothing to check.");
  process.exit(0);
}

console.log(`[check-journal] Checking ${entries.length} entries in ${journalPath}`);

let violations = 0;
let prevWhen = -Infinity;
let prevIdx = -1;
let prevTag = "(start)";

for (const entry of entries) {
  const { idx, tag, when } = entry;
  if (when <= prevWhen) {
    console.error(
      `[check-journal] VIOLATION: idx=${idx} (${tag}) when=${when}` +
      ` is NOT strictly greater than idx=${prevIdx} (${prevTag}) when=${prevWhen}` +
      ` — delta=${when - prevWhen}`
    );
    violations++;
  }
  prevWhen = when;
  prevIdx = idx;
  prevTag = tag;
}

if (violations > 0) {
  console.error(
    `\n[check-journal] FAILED: ${violations} non-monotonic when value(s) found.\n` +
    `  Every migration's 'when' must be strictly greater than all preceding migrations.\n` +
    `  Drizzle silently skips migrations whose 'when' <= MAX(created_at) in the ledger.\n` +
    `  Fix: assign 'when' values that are strictly increasing by idx order.`
  );
  process.exit(1);
}

// Print summary table
console.log("\n[check-journal] All when values are strictly monotonic. Summary:");
console.log("  idx  | when              | tag");
console.log("  -----|-------------------|------------------------------------------------");
for (const { idx, when, tag } of entries) {
  const idxStr = String(idx).padStart(4, " ");
  const whenStr = String(when).padEnd(17, " ");
  console.log(`  ${idxStr} | ${whenStr} | ${tag}`);
}
console.log(`\n[check-journal] PASSED — journal is strictly monotonic (${entries.length} entries).`);
process.exit(0);
