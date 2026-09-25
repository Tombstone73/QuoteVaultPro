import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = "server/db/migrations_v2/";
const previous = readFileSync(root + "0259_v2_customer_proof_delivery.sql", "utf8");
const migration = readFileSync(root + "0290_v2_artwork_additive_line_assignments.sql", "utf8");
const functionBody = (sql: string) => sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION v2_artwork_assignment_replacement_validate()"), sql.indexOf("$$ LANGUAGE plpgsql;", sql.indexOf("CREATE OR REPLACE FUNCTION v2_artwork_assignment_replacement_validate()")));
const previousBody = functionBody(previous);
const newBody = functionBody(migration);
assert.match(newBody, /IF NEW\.supersedes_artwork_assignment_id IS NULL THEN RETURN NEW; END IF;/);
assert.equal(newBody.slice(newBody.indexOf("  IF TG_OP=")), previousBody.slice(previousBody.indexOf("  IF TG_OP=")), "every explicit-replacement guard must remain byte-for-byte equivalent to 0259");
assert.doesNotMatch(migration, /DROP\s|ALTER TABLE|DELETE FROM|UPDATE v2_artwork_assignments|current_assignment/i, "only the trigger function changes; identities, indexes, and historical rows remain intact");
const lineage = readFileSync(root + "0244_v2_order_artwork_replacement_lineage.sql", "utf8");
assert.match(lineage, /CREATE UNIQUE INDEX v2_artwork_assignments_one_successor_uidx[\s\S]*?WHERE supersedes_artwork_assignment_id IS NOT NULL/);
console.log("additive Artwork migration and preserved replacement guards: PASS");
