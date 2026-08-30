import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const migration = readFileSync(resolve(root, "server/db/migrations_v2/0244_v2_order_artwork_replacement_lineage.sql"), "utf8");
const currentSlotGuard = readFileSync(resolve(root, "server/db/migrations_v2/0245_v2_order_artwork_current_slot_guard.sql"), "utf8");
const transaction = readFileSync(resolve(root, "v2/infrastructure/artwork/postgresArtworkTransaction.ts"), "utf8");

assert.match(migration, /supersedes_artwork_assignment_id varchar/);
assert.match(migration, /one_successor_uidx/);
assert.match(migration, /source_quote_accepted_artwork_snapshot_id IS NOT NULL/);
assert.match(migration, /v2_proof_version_artwork/);
assert.match(currentSlotGuard, /explicitly supersede the current customer-supplied Order-line slot/);
assert.match(transaction, /createOrGetReplacementAssignment/);
assert.match(transaction, /NOT EXISTS \(SELECT 1 FROM v2_artwork_assignments successor/);
console.log("order Artwork replacement lineage SQL contract: PASS");
