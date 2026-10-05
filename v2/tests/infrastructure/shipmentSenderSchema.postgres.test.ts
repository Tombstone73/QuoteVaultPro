import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { TransactionalClient } from "../../infrastructure/persistence/types.js";
import { assertShipmentSenderSchema } from "../../infrastructure/fulfillment/shipmentSenderPhysicalPostconditions.js";

// Declared minimal read-schema prerequisites, not copied Shipping-owned DDL.
const db = new PGlite();
const sql = (name: string) => readFileSync(resolve(process.cwd(), "server/db/migrations_v2", name), "utf8");
const migration = sql("0301_v2_shipment_sender_snapshot.sql");
const cases: [string, () => Promise<void>][] = [];
const shapeName = "v2_shipment_sender_snapshot_shape_chk";
const revisions = "v2_fulfillment_shipment_prepared_revisions";
const immutableTrigger = "v2_fulfillment_shipment_prepared_revisions_immutable_trigger";
const client = { query: async (text: string, params?: unknown[]) => db.query(text, params) } as unknown as TransactionalClient;
async function ready() { try { await assertShipmentSenderSchema(client); return true; } catch { return false; } }
const blind = { version: 1, blindShipping: true, source: "customer", sender: { company: "Synthetic sender", addressLine1: "Return Way", city: "City", region: "FL", postalCode: "12345", country: "US" }, intents: [] };
const ordinary = { version: 1, blindShipping: false, source: "organization", intents: [] };
let sequence = 0;
async function insert(snapshot: unknown) {
  const id = `sender-revision-${++sequence}`;
  await db.query(`INSERT INTO ${revisions}(id,organization_id,shipment_id,revision_number,revision_kind,created_principal_kind,created_principal_subject,sender_snapshot)
    VALUES($1,'sender-org','sender-shipment',$2,'initial','staff','synthetic-actor',$3::jsonb)`, [id, sequence + 1, snapshot === undefined ? null : JSON.stringify(snapshot)]);
  return id;
}
const rejected = (operation: Promise<unknown>) => assert.rejects(operation, error => (error as { code: string }).code === "23514" || (error as { code: string }).code === "22P02");

async function setup() {
  await db.exec(`
    CREATE TABLE organizations(id varchar PRIMARY KEY);
    CREATE TABLE users(id varchar PRIMARY KEY);
    CREATE TABLE customers(id varchar PRIMARY KEY);
    CREATE TABLE v2_fulfillment_handoffs(id varchar,organization_id varchar,handoff_method varchar,UNIQUE(id,organization_id));
    CREATE TABLE v2_sales_document_lines(id varchar,organization_id varchar,document_id varchar,UNIQUE(id,organization_id,document_id));
    INSERT INTO organizations VALUES('sender-org');
  `);
  await db.exec(sql("0267_v2_fulfillment_shipment_containers.sql"));
  await db.query(`INSERT INTO v2_fulfillment_shipments(id,organization_id,notes,created_principal_kind,created_principal_subject)
    VALUES('sender-shipment','sender-org','Preserve  historical  spacing','staff','synthetic-actor')`);
  await db.exec(sql("0275_v2_fulfillment_shipment_recovery.sql"));
}

cases.push(["actual migration adds nullable evidence without rewriting historical rows", async () => {
  const before = (await db.query(`SELECT to_jsonb(r)::text evidence,xmin::text xmin,ctid::text ctid FROM ${revisions} r`)).rows;
  await db.exec(migration);
  const after = (await db.query(`SELECT (to_jsonb(r)-'sender_snapshot')::text evidence,xmin::text xmin,ctid::text ctid FROM ${revisions} r`)).rows;
  assert.deepEqual(after, before);
  assert.deepEqual((await db.query(`SELECT sender_snapshot FROM ${revisions}`)).rows, [{ sender_snapshot: null }]);
  assert.equal(await ready(), true);
}]);
cases.push(["SQL NULL, blind Customer/Custom and ordinary Organization evidence are admitted", async () => {
  for (const value of [undefined, blind, { ...blind, source: "custom" }, ordinary]) await insert(value);
}]);
cases.push(["malformed JSON null, primitives, versions, enum, intents, flags and blind sender data fail closed", async () => {
  for (const value of [null, false, 1, "sender", [], {}, { ...blind, version: 2 }, { ...blind, version: null },
    { ...blind, version: " 1" }, { ...blind, source: "Customer" }, { ...blind, source: null }, { ...blind, source: "organization" },
    { ...ordinary, source: "custom" }, { ...blind, intents: {} }, { ...blind, intents: null }, { ...blind, intents: undefined },
    { ...blind, blindShipping: "true" }, { ...blind, blindShipping: null }, { ...blind, blindShipping: undefined },
    { ...blind, sender: undefined }, { ...blind, sender: null }, { ...blind, sender: "sender" }, { ...blind, sender: [] }]) await rejected(insert(value));
}]);
cases.push(["existing immutable guard protects UPDATE/DELETE including the new column and historical NULL", async () => {
  const id = await insert(blind);
  await rejected(db.query(`UPDATE ${revisions} SET sender_snapshot=$2::jsonb WHERE id=$1`, [id, JSON.stringify(ordinary)]));
  await rejected(db.query(`UPDATE ${revisions} SET notes='changed' WHERE id=$1`, [id]));
  await rejected(db.query(`DELETE FROM ${revisions} WHERE id=$1`, [id]));
  await rejected(db.query(`UPDATE ${revisions} SET sender_snapshot=$1::jsonb WHERE sender_snapshot IS NULL`, [JSON.stringify(ordinary)]));
  assert.deepEqual((await db.query(`SELECT sender_snapshot FROM ${revisions} WHERE id=$1`, [id])).rows, [{ sender_snapshot: blind }]);
}]);
cases.push(["failed migration transaction rolls back its additive column and constraint", async () => {
  await db.exec(`BEGIN; ALTER TABLE ${revisions} DROP COLUMN sender_snapshot;`);
  await db.exec("SAVEPOINT before_migration");
  await assert.rejects(db.exec(`${migration}\nSELECT 1/0;`), error => (error as { code: string }).code === "22012");
  await db.exec("ROLLBACK TO SAVEPOINT before_migration");
  assert.equal((await db.query("SELECT count(*)::integer n FROM information_schema.columns WHERE table_name=$1 AND column_name='sender_snapshot'", [revisions])).rows[0].n, 0);
  assert.equal((await db.query("SELECT count(*)::integer n FROM pg_constraint WHERE conname=$1", [shapeName])).rows[0].n, 0);
  await db.exec("ROLLBACK");
}]);

const triggerWith = (events: string, suffix = "") => `DROP TRIGGER ${immutableTrigger} ON ${revisions};
  CREATE TRIGGER ${immutableTrigger} BEFORE ${events} ON ${revisions} FOR EACH ROW ${suffix}
  EXECUTE FUNCTION v2_fulfillment_shipment_recovery_immutable_validate();`;
const replaceShape = (replacement: string, suffix = "") => `ALTER TABLE ${revisions} DROP CONSTRAINT ${shapeName};
  ALTER TABLE ${revisions} ADD CONSTRAINT ${shapeName} CHECK (${replacement}) ${suffix};`;
const catalogChanges: [string, string][] = [
  ["missing sender column", `ALTER TABLE ${revisions} DROP COLUMN sender_snapshot`],
  ["missing prepared table", `ALTER TABLE ${revisions} RENAME TO sender_wrong_table`],
  ["column default would fabricate evidence", `ALTER TABLE ${revisions} ALTER COLUMN sender_snapshot SET DEFAULT '{}'::jsonb`],
  ["wrong column type", `ALTER TABLE ${revisions} DROP CONSTRAINT ${shapeName}; ALTER TABLE ${revisions} ALTER COLUMN sender_snapshot TYPE json`],
  ["missing named shape check", `ALTER TABLE ${revisions} DROP CONSTRAINT ${shapeName}`],
  ["weak same-name shape check", replaceShape("sender_snapshot IS NULL OR true")],
  ["unvalidated same-name check", migration.slice(migration.indexOf("ALTER TABLE", migration.indexOf("ALTER TABLE") + 1)).replace(/;\s*--[\s\S]*/, " NOT VALID;").replace("ADD CONSTRAINT", `DROP CONSTRAINT ${shapeName}; ALTER TABLE ${revisions} ADD CONSTRAINT`)],
  ["missing immutable trigger", `DROP TRIGGER ${immutableTrigger} ON ${revisions}`],
  ["disabled immutable trigger", `ALTER TABLE ${revisions} DISABLE TRIGGER ${immutableTrigger}`],
  ["replica-only immutable trigger", `ALTER TABLE ${revisions} ENABLE REPLICA TRIGGER ${immutableTrigger}`],
  ["UPDATE-only event mask", triggerWith("UPDATE")],
  ["DELETE-only event mask", triggerWith("DELETE")],
  ["column-limited UPDATE guard", triggerWith("UPDATE OF sender_snapshot OR DELETE")],
  ["conditional guard", triggerWith("UPDATE OR DELETE", "WHEN (false)")],
  ["wrong immutable function body", "CREATE OR REPLACE FUNCTION v2_fulfillment_shipment_recovery_immutable_validate() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql"],
  ["altered protected function SQL literal", sql("0275_v2_fulfillment_shipment_recovery.sql").match(/CREATE OR REPLACE FUNCTION v2_fulfillment_shipment_recovery_immutable_validate[\s\S]*?\$\$ LANGUAGE plpgsql;/)![0].replace("'INSERT'", "' INSERT '")],
  ["altered protected check SQL literal", migration.slice(migration.indexOf("ALTER TABLE", migration.indexOf("ALTER TABLE") + 1)).replace("'organization'", "' organization '").replace("ADD CONSTRAINT", `DROP CONSTRAINT ${shapeName}; ALTER TABLE ${revisions} ADD CONSTRAINT`).replace(/\n\);/, "\n) NOT VALID;")],
];
for (const [name, change] of catalogChanges) cases.push([`readiness fails closed for ${name}`, async () => {
  await db.exec("BEGIN");
  try { await db.exec(change); assert.equal(await ready(), false); }
  finally { await db.exec("ROLLBACK"); }
  assert.equal(await ready(), true, "rollback restores the actual migrated catalog");
}]);
cases.push(["readiness preserves literal whitespace even when the altered check is validated", async () => {
  await db.exec("BEGIN");
  try {
    await db.exec(migration.slice(migration.indexOf("ALTER TABLE", migration.indexOf("ALTER TABLE") + 1))
      .replace("'1'", "' 1 '").replace("ADD CONSTRAINT", `DROP CONSTRAINT ${shapeName}; ALTER TABLE ${revisions} ADD CONSTRAINT`)
      .replace(/\n\);/, "\n) NOT VALID;"));
    await db.exec(`ALTER TABLE ${revisions} DISABLE TRIGGER ${immutableTrigger}; UPDATE ${revisions} SET sender_snapshot=NULL;
      ALTER TABLE ${revisions} ENABLE TRIGGER ${immutableTrigger}; ALTER TABLE ${revisions} VALIDATE CONSTRAINT ${shapeName};`);
    assert.equal(await ready(), false);
  } finally { await db.exec("ROLLBACK"); }
}]);
cases.push(["catalog query errors fail readiness closed", async () => {
  await assert.rejects(assertShipmentSenderSchema({ query: async () => { throw new Error("synthetic catalog failure"); } } as unknown as TransactionalClient), /synthetic catalog failure/);
  assert.equal(await ready(), true);
}]);

try {
  await setup();
  for (const [name, runCase] of cases) { await runCase(); console.log(`PASS ${name}`); }
  console.log(`${cases.length} shipment sender schema checks passed`);
} finally { await db.close(); }
