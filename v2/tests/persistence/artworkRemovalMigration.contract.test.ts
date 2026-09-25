import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const migration = readFileSync("server/db/migrations_v2/0291_v2_artwork_assignment_removal.sql", "utf8");
assert.match(migration, /PRIMARY KEY \(organization_id, artwork_assignment_id\)/);
assert.match(migration, /REFERENCES v2_artwork_assignments\(id, organization_id\) ON DELETE RESTRICT/);
assert.match(migration, /Artwork removal history is immutable/);
assert.match(migration, /FOR UPDATE/g);
for (const table of ["v2_proof_version_artwork", "v2_prepress_units", "v2_production_works"]) assert.match(migration, new RegExp(`ON ${table}\\nFOR EACH ROW EXECUTE FUNCTION v2_artwork_removed_reference_validate`));
assert.doesNotMatch(migration, /DELETE FROM|UPDATE v2_artwork_assignments|DROP TABLE|CREATE OR REPLACE FUNCTION v2_artwork_assignment_replacement_validate/);
for (const path of ["artwork/postgresArtworkTransaction.ts", "proofing/postgresProofingTransaction.ts", "prepress/postgresPrepressTransaction.ts", "sales/postgresSalesWorkspaceReads.ts"]) {
  assert.match(readFileSync(`v2/infrastructure/${path}`, "utf8"), /v2_current_artwork_assignments/);
}
const repository = readFileSync("v2/infrastructure/artwork/postgresArtworkTransaction.ts", "utf8");
assert.doesNotMatch(repository, /storage\.remove|DELETE FROM v2_artwork/);
assert.match(repository, /artwork_assignment_removed/);
console.log("Artwork removal migration, retention and current-read contracts: PASS");
