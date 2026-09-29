import assert from "node:assert/strict";
import { Client } from "pg";

// Run only in the guarded Railway Development shell. All rows and indexes are
// temporary and the surrounding transaction is rolled back, even on failure.
assert.equal(process.env.RAILWAY_ENVIRONMENT_NAME, "Development", "DEV-only PostgreSQL regression");
assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required");

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(`CREATE TEMP TABLE prepress_work_conflict_test (
    id text PRIMARY KEY,
    organization_id text NOT NULL,
    artwork_assignment_id text NOT NULL,
    rework_cycle_id text,
    replacement_obligation_id text
  ) ON COMMIT DROP`);
  await client.query(`CREATE UNIQUE INDEX prepress_work_normal_uidx
    ON prepress_work_conflict_test(organization_id, artwork_assignment_id)
    WHERE rework_cycle_id IS NULL AND replacement_obligation_id IS NULL`);
  await client.query(`CREATE UNIQUE INDEX prepress_work_rework_uidx
    ON prepress_work_conflict_test(organization_id, rework_cycle_id)
    WHERE rework_cycle_id IS NOT NULL`);
  await client.query(`CREATE UNIQUE INDEX prepress_work_replacement_uidx
    ON prepress_work_conflict_test(organization_id, replacement_obligation_id)
    WHERE replacement_obligation_id IS NOT NULL`);

  await client.query("SAVEPOINT old_conflict_target");
  let oldErrorCode: string | undefined;
  try {
    await client.query(`INSERT INTO prepress_work_conflict_test VALUES ('old', 'qa', 'art', NULL, NULL)
      ON CONFLICT (organization_id, artwork_assignment_id) DO NOTHING`);
  } catch (error) {
    oldErrorCode = (error as { code?: string }).code;
  }
  await client.query("ROLLBACK TO SAVEPOINT old_conflict_target");
  assert.equal(oldErrorCode, "42P10", "the old unconditional target must reproduce the DEV failure");

  const normal = `INSERT INTO prepress_work_conflict_test VALUES ($1, $2, $3, NULL, NULL)
    ON CONFLICT (organization_id, artwork_assignment_id)
    WHERE rework_cycle_id IS NULL AND replacement_obligation_id IS NULL DO NOTHING`;
  assert.equal((await client.query(normal, ["original", "qa", "art"])).rowCount, 1);
  assert.equal((await client.query(normal, ["original-retry", "qa", "art"])).rowCount, 0);

  const rework = `INSERT INTO prepress_work_conflict_test VALUES ($1, $2, $3, $4, NULL)
    ON CONFLICT (organization_id, rework_cycle_id) WHERE rework_cycle_id IS NOT NULL DO NOTHING`;
  assert.equal((await client.query(rework, ["rework", "qa", "art", "cycle"])).rowCount, 1);
  assert.equal((await client.query(rework, ["rework-retry", "qa", "art", "cycle"])).rowCount, 0);

  const replacement = `INSERT INTO prepress_work_conflict_test VALUES ($1, $2, $3, NULL, $4)
    ON CONFLICT (organization_id, replacement_obligation_id)
    WHERE replacement_obligation_id IS NOT NULL DO NOTHING`;
  assert.equal((await client.query(replacement, ["replacement", "qa", "art", "obligation"])).rowCount, 1);
  assert.equal((await client.query(replacement, ["replacement-retry", "qa", "art", "obligation"])).rowCount, 0);

  assert.equal((await client.query(normal, ["foreign", "other", "art"])).rowCount, 1);
  assert.equal((await client.query(normal, ["original-retry-2", "qa", "art"])).rowCount, 0);
  const rows = await client.query(`SELECT id, organization_id, rework_cycle_id, replacement_obligation_id
    FROM prepress_work_conflict_test ORDER BY id`);
  assert.equal(rows.rowCount, 4);
  assert.deepEqual(rows.rows.find(row => row.id === "original"), {
    id: "original", organization_id: "qa", rework_cycle_id: null, replacement_obligation_id: null,
  });
  console.log("DEV PostgreSQL partial-conflict, retry, rework, replacement, and tenant regression passed (rollback only).");
} finally {
  await client.query("ROLLBACK").catch(() => undefined);
  await client.end();
}
