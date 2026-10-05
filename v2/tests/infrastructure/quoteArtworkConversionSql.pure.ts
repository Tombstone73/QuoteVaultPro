import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PostgresQuoteArtworkConversionPort, PostgresQuoteArtworkTransaction } from "../../infrastructure/artwork/postgresQuoteArtworkTransaction.js";

const source = await readFile(path.join(process.cwd(), "v2", "infrastructure", "artwork", "postgresQuoteArtworkTransaction.ts"), "utf8");

assert.match(
  source,
  /concat_ws\('\|',s\.id,\$4::varchar,\$5::varchar\)/,
  "Quote-to-Order artwork reuse must keep Order parameter types consistent in the fingerprint call.",
);
console.log("Quote Artwork conversion SQL uses unambiguous text parameters.");

assert.equal(process.env.V2_VALIDATION_MODE, "deterministic");
const db = new PGlite();
const statements: string[] = [];
const client: any = { query: async (sql: string, values?: unknown[]) => {
  statements.push(sql); const result = await db.query(sql, values); return { ...result, rowCount: result.affectedRows };
} };
const port = new PostgresQuoteArtworkConversionPort(client);
let checks = 0;
const equal = (actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected); checks++; };
const inTransaction = async <T,>(action: () => Promise<T>): Promise<T> => {
  await db.exec("BEGIN");
  try { const value = await action(); await db.exec("COMMIT"); return value; }
  catch (cause) { await db.exec("ROLLBACK"); throw cause; }
};
const checkpoint = async (id: string, quoteId: string, lineIds: readonly string[], kind = "quote_accepted", org = "art-org-a", patch: object = {}) => {
  const payload = { schemaVersion: 1, organizationId: org, checkpointId: id, kind, sourceDocument: { quoteId },
    commercial: { currency: "USD", lines: lineIds.map(lineId => ({ lineId })) }, ...patch };
  await db.query("INSERT INTO v2_sales_quote_checkpoints VALUES($1,$2,$3,$4,$5::jsonb)", [id, org, quoteId, kind, JSON.stringify(payload)]);
};
const assignment = async (id: string, quote: string, line: string, file: string, purpose = "customer_supplied", side: string | null = "front", org = "art-org-a") => {
  await db.query("INSERT INTO v2_quote_artwork_assignments(id,organization_id,quote_document_id,quote_line_id,artwork_file_id,purpose,side,source_page_index,layer_key,layer_order,identity_fingerprint,created_principal_kind,created_principal_subject) VALUES($1,$2,$3,$4,$5,$6,$7,0,NULL,NULL,$8,'staff','inert-staff')",
    [id, org, quote, line, file, purpose, side, `sha256:${createHash("sha256").update(id).digest("hex")}`]);
};
const snapshots = async (cp: string) => (await db.query("SELECT quote_line_id,quote_artwork_assignment_id,artwork_file_id,purpose,side,source_page_index,layer_key,layer_order,evidence_fingerprint FROM v2_quote_accepted_artwork_snapshots WHERE acceptance_checkpoint_id=$1 ORDER BY quote_artwork_assignment_id", [cp])).rows;
const reject = async (name: string, action: () => Promise<unknown>, message: RegExp) => {
  const before = (await db.query("SELECT count(*)::int AS count FROM v2_quote_accepted_artwork_snapshots")).rows;
  await assert.rejects(() => inTransaction(async () => {
    await db.query("INSERT INTO owner_test_transaction_marks VALUES($1)", [name]); await action();
  }), message); checks++;
  equal((await db.query("SELECT count(*)::int AS count FROM v2_quote_accepted_artwork_snapshots")).rows, before);
  equal((await db.query("SELECT name FROM owner_test_transaction_marks WHERE name=$1", [name])).rows, []);
};
try {
  await db.exec(`CREATE TABLE organizations(id varchar PRIMARY KEY); CREATE TABLE users(id varchar PRIMARY KEY);
    CREATE TABLE v2_sales_documents(id varchar PRIMARY KEY,organization_id varchar NOT NULL REFERENCES organizations(id),document_kind varchar NOT NULL,revision bigint NOT NULL DEFAULT 1,updated_at timestamptz DEFAULT now(),UNIQUE(id,organization_id));
    CREATE TABLE v2_sales_quote_details(document_id varchar,organization_id varchar,delivery_state varchar DEFAULT 'not_sent',acceptance_state varchar DEFAULT 'not_accepted',lifecycle_state varchar DEFAULT 'open',PRIMARY KEY(document_id,organization_id),FOREIGN KEY(document_id,organization_id) REFERENCES v2_sales_documents(id,organization_id));
    CREATE TABLE v2_sales_order_details(document_id varchar,organization_id varchar,PRIMARY KEY(document_id,organization_id),FOREIGN KEY(document_id,organization_id) REFERENCES v2_sales_documents(id,organization_id));
    CREATE TABLE v2_sales_document_lines(id varchar PRIMARY KEY,organization_id varchar,document_id varchar,UNIQUE(id,organization_id,document_id),FOREIGN KEY(document_id,organization_id) REFERENCES v2_sales_documents(id,organization_id));
    CREATE TABLE v2_sales_quote_checkpoints(id varchar PRIMARY KEY,organization_id varchar,quote_document_id varchar,checkpoint_kind varchar,payload jsonb NOT NULL,UNIQUE(id,organization_id,quote_document_id),FOREIGN KEY(quote_document_id,organization_id) REFERENCES v2_sales_quote_details(document_id,organization_id));
    CREATE TABLE v2_sales_quote_conversions(organization_id varchar,quote_document_id varchar,source_checkpoint_id varchar,order_document_id varchar,PRIMARY KEY(organization_id,quote_document_id));
    CREATE TABLE v2_permission_capabilities(id varchar PRIMARY KEY,module varchar,label varchar);
    CREATE TABLE v2_permission_set_templates(id varchar PRIMARY KEY,template_key varchar);
    CREATE TABLE v2_permission_set_template_capabilities(template_id varchar,capability_id varchar,PRIMARY KEY(template_id,capability_id));
    CREATE TABLE owner_test_transaction_marks(name varchar PRIMARY KEY);
    INSERT INTO organizations VALUES('art-org-a'),('art-org-b');
    INSERT INTO v2_sales_documents(id,organization_id,document_kind) VALUES('quote-main','art-org-a','quote'),('quote-same','art-org-a','quote'),('quote-deleted','art-org-a','quote'),('quote-other','art-org-a','quote'),('quote-foreign','art-org-b','quote'),('order-main','art-org-a','order'),('order-deleted','art-org-a','order'),('order-other','art-org-a','order');
    INSERT INTO v2_sales_quote_details(document_id,organization_id) SELECT id,organization_id FROM v2_sales_documents WHERE document_kind='quote';
    INSERT INTO v2_sales_order_details(document_id,organization_id) SELECT id,organization_id FROM v2_sales_documents WHERE document_kind='order';
    INSERT INTO v2_sales_document_lines VALUES('line-a','art-org-a','quote-main'),('line-b','art-org-a','quote-main'),('same-a','art-org-a','quote-same'),('deleted-a','art-org-a','quote-deleted'),('deleted-b','art-org-a','quote-deleted'),('other-a','art-org-a','quote-other'),('foreign-a','art-org-b','quote-foreign'),('order-a','art-org-a','order-main'),('order-b','art-org-a','order-main'),('order-deleted-a','art-org-a','order-deleted'),('order-other-a','art-org-a','order-other');
    -- PGlite does not need an external pgcrypto provider. This compatibility
    -- wrapper uses PostgreSQL's real built-in SHA-256, not a fake fingerprint.
    CREATE FUNCTION digest(value text,algorithm text) RETURNS bytea LANGUAGE SQL IMMUTABLE AS $$ SELECT CASE WHEN algorithm='sha256' THEN sha256(convert_to(value,'UTF8')) ELSE NULL::bytea END $$;`);
  const migration = (name: string) => readFile(path.join(process.cwd(), "server", "db", "migrations_v2", name), "utf8");
  await db.exec(await migration("0197_v2_artwork_domain_foundation.sql"));
  await db.exec(await migration("0242_v2_quote_artwork_lineage.sql"));
  const immutable = await migration("0187_v2_sales_commercial_persistence.sql");
  await db.exec(immutable.slice(immutable.indexOf("CREATE OR REPLACE FUNCTION v2_reject_sales_quote_checkpoint_mutation"), immutable.indexOf("CREATE TABLE v2_sales_quote_conversions")));
  for (const id of ["file-old", "file-current", "file-back", "file-draft-b", "file-foreign"]) {
    await db.query("INSERT INTO v2_artwork_files(id,organization_id,storage_provider,object_key,original_filename,display_filename,content_type,byte_size,source_kind) VALUES($1,$2,'inert',$3,$3,$3,'application/pdf',8,'customer_upload')",
      [id, id === "file-foreign" ? "art-org-b" : "art-org-a", `${id}.pdf`]);
  }
  await assignment("art-a-current", "quote-main", "line-a", "file-current");
  await assignment("art-a-back", "quote-main", "line-a", "file-back", "reference", "back");
  await assignment("art-b-draft", "quote-main", "line-b", "file-draft-b");
  await assignment("art-foreign", "quote-foreign", "foreign-a", "file-foreign", "customer_supplied", "front", "art-org-b");
  await checkpoint("accepted-main", "quote-main", ["line-a"]);
  await inTransaction(() => port.snapshotPublished("art-org-a", "quote-main", "accepted-main", ["line-a"]));
  const acceptedRows = await snapshots("accepted-main");
  equal(acceptedRows.map(row => row.quote_line_id), ["line-a", "line-a"]);
  equal(acceptedRows.map(row => row.artwork_file_id), ["file-back", "file-current"]);
  equal(acceptedRows.map(row => row.purpose), ["reference", "customer_supplied"]);
  equal(acceptedRows.map(row => row.side), ["back", "front"]);
  const expectedFingerprint = `sha256:${createHash("sha256").update("art-a-current|file-current|line-a|front|0||").digest("hex")}`;
  equal(acceptedRows.find(row => row.quote_artwork_assignment_id === "art-a-current")!.evidence_fingerprint, expectedFingerprint);
  assert.ok(statements.find(sql => sql.startsWith("SELECT c.payload"))?.includes("FOR UPDATE OF d,q")); checks++;
  assert.ok(statements.findIndex(sql => sql.startsWith("SELECT c.payload")) < statements.findIndex(sql => sql.startsWith("INSERT INTO v2_quote_accepted_artwork_snapshots"))); checks++;
  const filesBeforeCarry = (await db.query("SELECT count(*)::int AS count FROM v2_artwork_files")).rows;
  await reject("wrong-order-line-scope", () => port.carryAcceptedToOrder({ organizationId: "art-org-a", quoteId: "quote-main", acceptanceCheckpointId: "accepted-main", orderId: "order-other", lineMap: new Map([["line-a", "order-other-a"]]) }), /exact accepted Quote conversion/);
  await inTransaction(async () => {
    // Real deferred 0242 provenance permits the canonical conversion link to
    // be recorded after the Artwork owner inserts the mapped Order usages.
    await port.carryAcceptedToOrder({ organizationId: "art-org-a", quoteId: "quote-main", acceptanceCheckpointId: "accepted-main", orderId: "order-main", lineMap: new Map([["line-a", "order-a"], ["line-b", "order-b"]]) });
    await db.exec("INSERT INTO v2_sales_quote_conversions VALUES('art-org-a','quote-main','accepted-main','order-main')");
  });
  const orderRows = (await db.query("SELECT order_line_id,artwork_file_id,purpose FROM v2_artwork_assignments WHERE order_document_id='order-main' ORDER BY artwork_file_id")).rows;
  equal(orderRows.map(row => row.order_line_id), ["order-a", "order-a"]);
  equal(orderRows.map(row => row.artwork_file_id), ["file-back", "file-current"]);
  equal(orderRows.map(row => row.purpose), ["customer_supplied", "customer_supplied"]);
  equal((await db.query("SELECT count(*)::int AS count FROM v2_artwork_files")).rows, filesBeforeCarry);
  await inTransaction(async () => {
    await port.snapshotPublished("art-org-a", "quote-main", "accepted-main", ["line-a"]);
    await port.carryAcceptedToOrder({ organizationId: "art-org-a", quoteId: "quote-main", acceptanceCheckpointId: "accepted-main", orderId: "order-main", lineMap: new Map([["line-a", "order-a"]]) });
  });
  equal(await snapshots("accepted-main"), acceptedRows);
  equal((await db.query("SELECT order_line_id,artwork_file_id,purpose FROM v2_artwork_assignments WHERE order_document_id='order-main' ORDER BY artwork_file_id")).rows, orderRows);
  await reject("missing-line-map", () => port.carryAcceptedToOrder({ organizationId: "art-org-a", quoteId: "quote-main", acceptanceCheckpointId: "accepted-main", orderId: "order-main", lineMap: new Map([["line-b", "order-b"]]) }), /could not be mapped/);
  await reject("source-fk-protection", async () => { await db.exec("DELETE FROM v2_quote_artwork_assignments WHERE id='art-a-current'"); }, /foreign key/);
  await reject("line-fk-protection", async () => { await db.exec("DELETE FROM v2_sales_document_lines WHERE id='line-a'"); }, /foreign key/);
  await reject("immutable-accepted-art", async () => { await db.exec("UPDATE v2_quote_accepted_artwork_snapshots SET artwork_file_id='file-old' WHERE acceptance_checkpoint_id='accepted-main'"); }, /immutable/);
  await checkpoint("wrong-kind", "quote-main", ["line-a"], "quote_sent");
  await checkpoint("wrong-body-quote", "quote-main", ["line-a"], "quote_accepted", "art-org-a", { sourceDocument: { quoteId: "quote-other" } });
  await checkpoint("wrong-body-tenant", "quote-main", ["line-a"], "quote_accepted", "art-org-a", { organizationId: "art-org-b" });
  await checkpoint("wrong-body-id", "quote-main", ["line-a"], "quote_accepted", "art-org-a", { checkpointId: "another-checkpoint" });
  await checkpoint("wrong-body-kind", "quote-main", ["line-a"], "quote_accepted", "art-org-a", { kind: "quote_sent" });
  await checkpoint("missing-commercial-lines", "quote-main", ["line-a"], "quote_accepted", "art-org-a", { commercial: { lines: null } });
  await checkpoint("duplicate-commercial-lines", "quote-main", ["line-a", "line-a"]);
  await checkpoint("foreign-commercial-line", "quote-main", ["foreign-a"]);
  await checkpoint("other-commercial-line", "quote-main", ["other-a"]);
  for (const id of ["wrong-kind", "wrong-body-quote", "wrong-body-tenant", "wrong-body-id", "wrong-body-kind", "missing-checkpoint", "missing-commercial-lines"]) {
    await reject(id, () => port.snapshotPublished("art-org-a", "quote-main", id, ["line-a"]), /exact tenant-scoped accepted Quote checkpoint/);
  }
  await reject("wrong-tenant", () => port.snapshotPublished("art-org-b", "quote-main", "accepted-main", ["line-a"]), /exact tenant-scoped accepted Quote checkpoint/);
  await reject("wrong-quote", () => port.snapshotPublished("art-org-a", "quote-other", "accepted-main", ["line-a"]), /exact tenant-scoped accepted Quote checkpoint/);
  await reject("duplicate-requested", () => port.snapshotPublished("art-org-a", "quote-main", "accepted-main", ["line-a", "line-a"]), /distinct valid identities/);
  await reject("draft-only-requested", () => port.snapshotPublished("art-org-a", "quote-main", "accepted-main", ["line-b"]), /immutable accepted Quote line set/);
  await reject("extra-requested", () => port.snapshotPublished("art-org-a", "quote-main", "accepted-main", ["line-a", "line-b"]), /immutable accepted Quote line set/);
  await reject("missing-requested", () => port.snapshotPublished("art-org-a", "quote-main", "accepted-main", []), /immutable accepted Quote line set/);
  await reject("duplicate-cp-lines", () => port.snapshotPublished("art-org-a", "quote-main", "duplicate-commercial-lines", ["line-a"]), /immutable accepted Quote line set/);
  await reject("foreign-id", () => port.snapshotPublished("art-org-a", "quote-main", "foreign-commercial-line", ["foreign-a"]), /different tenant or document/);
  await reject("other-quote-id", () => port.snapshotPublished("art-org-a", "quote-main", "other-commercial-line", ["other-a"]), /different tenant or document/);

  // SAME commercial line identity does not imply the PDF froze its Artwork.
  // Exercise the existing owner replacement semantics before acceptance: the
  // current file, not the old file or a fabricated historical manifest, wins.
  await assignment("same-old", "quote-same", "same-a", "file-old");
  await inTransaction(async () => {
    const editable = new PostgresQuoteArtworkTransaction(client);
    await editable.lockEditableQuote("art-org-a" as any, "quote-same" as any, "1");
    await editable.createOrGetAssignment({ id: "same-current" as any, organizationId: "art-org-a" as any, artworkFileId: "file-current" as any,
      usage: { quoteId: "quote-same" as any, quoteLineId: "same-a" as any, purpose: "customer_supplied", side: "front", sourcePageIndex: 0 },
      principalKind: "staff", principalSubject: "inert-staff" });
    await editable.bumpQuoteRevision("art-org-a" as any, "quote-same" as any, "1");
  });
  await checkpoint("accepted-same", "quote-same", ["same-a"]);
  await inTransaction(() => port.snapshotPublished("art-org-a", "quote-same", "accepted-same", ["same-a"]));
  equal((await snapshots("accepted-same")).map(row => row.artwork_file_id), ["file-current"]);
  equal((await db.query("SELECT id FROM v2_quote_artwork_assignments WHERE id='same-old'")).rows, []);
  await db.exec("UPDATE v2_sales_quote_details SET delivery_state='sent',acceptance_state='accepted' WHERE document_id='quote-same'");
  await reject("existing-art-lifecycle-guard", () => new PostgresQuoteArtworkTransaction(client).lockEditableQuote("art-org-a" as any, "quote-same" as any, "2"), /immutable after the Quote lifecycle advances/);

  // With a deleted/unassigned A and current B-only, snapshotting accepted A
  // yields no Artwork. It never chooses B or recreates the former A usage.
  await assignment("deleted-old-a", "quote-deleted", "deleted-a", "file-old");
  await checkpoint("accepted-deleted", "quote-deleted", ["deleted-a"]);
  await db.exec("DELETE FROM v2_quote_artwork_assignments WHERE id='deleted-old-a'; DELETE FROM v2_sales_document_lines WHERE id='deleted-a'");
  await assignment("deleted-current-b", "quote-deleted", "deleted-b", "file-draft-b");
  await inTransaction(async () => {
    await port.snapshotPublished("art-org-a", "quote-deleted", "accepted-deleted", ["deleted-a"]);
    await port.carryAcceptedToOrder({ organizationId: "art-org-a", quoteId: "quote-deleted", acceptanceCheckpointId: "accepted-deleted", orderId: "order-deleted", lineMap: new Map([["deleted-a", "order-deleted-a"]]) });
  });
  equal(await snapshots("accepted-deleted"), []);
  equal((await db.query("SELECT id FROM v2_artwork_assignments WHERE order_document_id='order-deleted'")).rows, []);
  await inTransaction(() => port.snapshotPublished("art-org-a", "quote-deleted", "accepted-deleted", ["deleted-a"]));
  equal(await snapshots("accepted-deleted"), []);

  // Preserve baseline snapshotAccepted all-current behavior for its existing
  // same-line-set call sites, with the same immutable identities and FKs.
  await checkpoint("accepted-baseline", "quote-main", ["line-a", "line-b"]);
  await inTransaction(() => port.snapshotAccepted("art-org-a", "quote-main", "accepted-baseline"));
  equal((await snapshots("accepted-baseline")).map(row => row.quote_line_id), ["line-a", "line-a", "line-b"]);
  await inTransaction(() => port.snapshotAccepted("art-org-a", "quote-main", "accepted-baseline"));
  equal((await snapshots("accepted-baseline")).length, 3);
  await checkpoint("accepted-outside-scope", "quote-main", ["line-a"]);
  await inTransaction(() => port.snapshotAccepted("art-org-a", "quote-main", "accepted-outside-scope"));
  await reject("existing-outside-published-scope", () => port.snapshotPublished("art-org-a", "quote-main", "accepted-outside-scope", ["line-a"]), /outside the authorized published line scope/);
  console.log(`L0-A-ART-OWNER: ${checks} checks passed; actual Artwork SQL, real 0197/0242 FK/triggers/deferred provenance, shared header locks, current-at-acceptance semantics, no draft-B carry or reconstructed Artwork; in-memory PostgreSQL only.`);
  console.log(`Artwork conversion source SHA256: ${createHash("sha256").update(source).digest("hex")}`);
  console.log(`Artwork owner regression SHA256: ${createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex")}`);
} finally { await db.close(); }
