import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { TransactionalClient } from "../../infrastructure/persistence/types.js";
import { PostgresCustomersCompatibilityReader } from "../../infrastructure/compatibility/postgresCustomersRead.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";
import type { CustomerContactReference } from "../../src/modules/customers/contracts.js";
import { PostgresSalesContactSelection } from "../../infrastructure/customers/postgresSalesContactSelection.js";

assert.equal(process.env.V2_VALIDATION_MODE, "deterministic", "Use cleanEnvironment/run, never root Jest or ambient database credentials.");
assert.deepEqual(Object.keys(process.env).filter((key) => /^(PG|DB)|DATABASE|POSTGRES|NEON|RAILWAY|CONNECTION_STRING/i.test(key)), []);

const org = brandedId<"OrganizationId">("tenant-a");
const otherOrg = brandedId<"OrganizationId">("tenant-b");
const customer = brandedId<"CustomerId">("account-a");
const secondCustomer = brandedId<"CustomerId">("account-b");
const contact = (id: string) => brandedId<"ContactId">(id);
const reference = (id: string, customerId?: string): CustomerContactReference => ({ organizationId: org, contactId: contact(id), ...(customerId ? { customerId: brandedId<"CustomerId">(customerId) } : {}) });
const db = new PGlite();
const statements: string[] = [];
const client = {
  async query(sql: string, parameters?: readonly unknown[]) {
    statements.push(sql);
    const result = await db.query(sql, parameters ? [...parameters] : []);
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  },
} as TransactionalClient;

// Current CRM read shape, including required company/name fields, nullable direct
// compatibility membership, tenant keys and the actual active-link uniqueness rule.
await db.exec(`CREATE TABLE organizations(id varchar PRIMARY KEY);
  CREATE TABLE customers(
    id varchar PRIMARY KEY, organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    company_name varchar(255) NOT NULL, display_name varchar(255), crm_revision bigint NOT NULL DEFAULT 1,
    is_active boolean DEFAULT true, status varchar(50) DEFAULT 'active',
    merged_into_customer_id varchar REFERENCES customers(id) ON DELETE RESTRICT,
    email varchar(255), phone varchar(50), payment_terms varchar(50) NOT NULL DEFAULT 'due_on_receipt',
    product_visibility_mode varchar(20) NOT NULL DEFAULT 'default', is_tax_exempt boolean NOT NULL DEFAULT false,
    blind_shipping boolean NOT NULL DEFAULT false, always_require_proof boolean NOT NULL DEFAULT false,
    billing_street1 varchar(255), billing_street2 varchar(255), billing_city varchar(100), billing_state varchar(100), billing_postal_code varchar(20), billing_country varchar(100),
    shipping_street1 varchar(255), shipping_street2 varchar(255), shipping_city varchar(100), shipping_state varchar(100), shipping_postal_code varchar(20), shipping_country varchar(100),
    created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(), UNIQUE(id,organization_id));
  CREATE TABLE customer_contacts(
    id varchar PRIMARY KEY, organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    customer_id varchar REFERENCES customers(id) ON DELETE SET NULL,
    first_name varchar(100) NOT NULL, last_name varchar(100) NOT NULL,
    crm_revision bigint NOT NULL DEFAULT 1, status varchar(30) NOT NULL DEFAULT 'active',
    is_primary boolean NOT NULL DEFAULT false, email varchar(255), phone varchar(50), internal_notes text, flags jsonb,
    created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(), UNIQUE(id,organization_id));
  CREATE TABLE customer_contact_links(
    id varchar PRIMARY KEY, organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    customer_id varchar NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    contact_id varchar NOT NULL REFERENCES customer_contacts(id) ON DELETE CASCADE,
    status varchar(30) NOT NULL DEFAULT 'active', is_primary boolean NOT NULL DEFAULT false,
    is_billing boolean NOT NULL DEFAULT false, is_portal boolean NOT NULL DEFAULT false, is_proof boolean NOT NULL DEFAULT false,
    created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
  CREATE UNIQUE INDEX customer_contact_links_active_pair_uidx ON customer_contact_links(customer_id,contact_id) WHERE status <> 'removed';
  CREATE UNIQUE INDEX customer_contact_links_primary_uidx ON customer_contact_links(customer_id) WHERE is_primary = true AND status = 'active';`);
await db.query("INSERT INTO organizations VALUES($1),($2)", [org, otherOrg]);
await db.query(`INSERT INTO customers(id,organization_id,company_name,payment_terms) VALUES
  ($1,$3,'First Account','net_30'),($2,$3,'Second Account','due_on_receipt'),('foreign-account',$4,'Foreign Account','net_30')`, [customer, secondCustomer, org, otherOrg]);
for (const [id, active, status, merged] of [
  ["inactive-account", false, "active", null], ["archived-account", true, "archived", null],
  ["superseded-account", true, "superseded", null], ["deleted-account", true, "deleted", null],
  ["merged-account", true, "active", customer], ["null-status-account", null, null, null],
] as const) await db.query("INSERT INTO customers(id,organization_id,company_name,is_active,status,merged_into_customer_id) VALUES($1,$2,$1,$3,$4,$5)", [id, org, active, status, merged]);
for (const [id, organizationId, customerId, firstName, lastName, status] of [
  ["direct", org, customer, "Alex", "Direct", "active"],
  ["linked", org, secondCustomer, "Bailey", "Linked", "active"],
  ["unlinked-direct", org, customer, "Chris", "Unlinked", "active"],
  ["standalone", org, null, "Dana", "Standalone", "active"],
  ["former", org, customer, "Evan", "Former", "active"],
  ["removed", org, customer, "Frank", "Removed", "active"],
  ["archived", org, customer, "Grace", "Archived", "archived"],
  ["inactive-owner", org, "inactive-account", "Harper", "Independent", "active"],
  ["foreign", otherOrg, "foreign-account", "Private", "Foreign", "active"],
  ["wildcard", org, null, "Literal%_", "Name", "active"],
  ["tie-a", org, null, "Same", "Name", "active"], ["tie-b", org, null, "Same", "Name", "active"],
] as const) await db.query("INSERT INTO customer_contacts(id,organization_id,customer_id,first_name,last_name,status,email,phone,internal_notes) VALUES($1,$2,$3,$4,$5,$6,'private@example.invalid','private-phone','private-note')", [id, organizationId, customerId, firstName, lastName, status]);
for (const [id, organizationId, customerId, contactId, status] of [
  ["direct-link", org, customer, "direct", "active"], ["linked-link", org, customer, "linked", "active"],
  ["second-link", org, secondCustomer, "linked", "active"],
  ["former-link", org, customer, "former", "former"], ["removed-link", org, customer, "removed", "removed"],
  ["archived-link", org, customer, "archived", "active"],
  ["inactive-link", org, "inactive-account", "inactive-owner", "active"],
  ["foreign-link", otherOrg, "foreign-account", "foreign", "active"],
  ["malformed-tenant-link", otherOrg, customer, "standalone", "active"],
] as const) await db.query("INSERT INTO customer_contact_links(id,organization_id,customer_id,contact_id,status) VALUES($1,$2,$3,$4,$5)", [id, organizationId, customerId, contactId, status]);
for (const id of ["inactive-account", "archived-account", "superseded-account", "deleted-account", "merged-account"]) {
  await db.query("INSERT INTO customer_contact_links(id,organization_id,customer_id,contact_id) VALUES($1,$2,$3,'direct')", [`invalid-owner-${id}`, org, id]);
}

const customers = new PostgresCustomersCompatibilityReader(client);
const selection = new PostgresSalesContactSelection(client);
const ids = (result: Awaited<ReturnType<typeof selection.lookupActiveContacts>>) => result.items.map((item) => item.id);
let cases = 0;
const check = async (name: string, work: () => Promise<void>) => { await work(); cases++; console.log(`PASS ${name}`); };
try {
  await check("canonical direct and linked membership both require an active tenant-scoped link", async () => {
    assert.equal(await customers.validateContactReference(reference("direct", customer)), true);
    assert.equal(await customers.validateContactReference(reference("linked", customer)), true);
    assert.equal(await customers.validateContactReference(reference("linked", secondCustomer)), true);
    for (const id of ["unlinked-direct", "standalone", "former", "removed", "archived", "foreign", "missing"]) assert.equal(await customers.validateContactReference(reference(id, customer)), false, id);
    for (const id of ["inactive-account", "archived-account", "superseded-account", "deleted-account", "merged-account"]) {
      assert.equal(await customers.validateContactReference({ organizationId: org, customerId: brandedId<"CustomerId">(id) }), false, id);
      assert.equal(await customers.validateContactReference(reference("direct", id)), false, "active relationship cannot bypass inactive Customer");
    }
  });
  await check("canonical contact-only identity is active contact truth, not account or relationship inference", async () => {
    for (const id of ["direct", "linked", "unlinked-direct", "standalone", "former", "removed", "inactive-owner"]) {
      assert.equal(await customers.validateContactReference(reference(id)), true, id);
      const selected = await customers.getContact(org, contact(id));
      assert.ok(selected); assert.equal(Object.hasOwn(selected, "customerId"), false);
      assert.equal(Object.hasOwn(reference(id), "customerId"), false);
    }
    for (const id of ["archived", "foreign", "missing"]) assert.equal(await customers.validateContactReference(reference(id)), false, id);
  });
  await check("fixture enforces required current CRM facts and actual link constraints", async () => {
    await assert.rejects(db.query("INSERT INTO customers(id,organization_id) VALUES('bad-account',$1)", [org]), (error: unknown) => (error as { code: string }).code === "23502");
    await assert.rejects(db.query("INSERT INTO customer_contacts(id,organization_id,first_name,last_name) VALUES('bad-contact','missing-tenant','A','B')"), (error: unknown) => (error as { code: string }).code === "23503");
    await assert.rejects(db.query("INSERT INTO customer_contact_links(id,organization_id,customer_id,contact_id) VALUES('duplicate',$1,$2,'direct')", [org, customer]), (error: unknown) => (error as { code: string }).code === "23505");
  });
  await check("customer filter matches canonical direct and linked active membership without duplicates", async () => {
    const result = await selection.lookupActiveContacts(org, { customerId: customer, selectedContactId: contact("linked") });
    assert.deepEqual(ids(result), ["direct", "linked"]);
    assert.deepEqual(result.selectedContact, { id: "linked", label: "Bailey Linked" });
    for (const item of result.items) assert.equal(await customers.validateContactReference(reference(item.id, customer)), true);
    assert.deepEqual(ids(await selection.lookupActiveContacts(org, { customerId: secondCustomer })), ["linked"]);
    for (const id of ["missing", "foreign-account", "inactive-account", "archived-account", "superseded-account", "deleted-account", "merged-account"]) {
      assert.deepEqual(await selection.lookupActiveContacts(org, { customerId: brandedId<"CustomerId">(id), selectedContactId: contact("direct") }), { items: [], selectedContact: null }, id);
    }
    await db.query("INSERT INTO customer_contact_links(id,organization_id,customer_id,contact_id) VALUES('nullable-active-link',$1,'null-status-account','standalone')", [org]);
    assert.deepEqual(ids(await selection.lookupActiveContacts(org, { customerId: brandedId<"CustomerId">("null-status-account") })), ["standalone"], "canonical null active/status fallback remains valid");
  });
  await check("contact-only results expose no account inference or private metadata", async () => {
    const result = await selection.lookupActiveContacts(org, {});
    assert.deepEqual(ids(result), ["direct", "linked", "unlinked-direct", "standalone", "former", "removed", "inactive-owner", "wildcard", "tie-a", "tie-b"]);
    for (const item of result.items) {
      assert.deepEqual(Object.keys(item).sort(), ["id", "label"]);
      assert.equal(await customers.validateContactReference(reference(item.id)), true);
    }
    assert.doesNotMatch(JSON.stringify(result), /private@example|private-phone|private-note|foreign-account|customerId/);
    assert.deepEqual(await selection.lookupActiveContacts(otherOrg, { selectedContactId: contact("direct") }), { items: [{ id: "foreign", label: "Private Foreign" }], selectedContact: null });
  });
  await check("name search is trimmed case-insensitive literal text, not wildcard or PII search", async () => {
    assert.deepEqual(ids(await selection.lookupActiveContacts(org, { search: "  bAiLeY li  " })), ["linked"]);
    assert.deepEqual(ids(await selection.lookupActiveContacts(org, { search: "%_" })), ["wildcard"]);
    assert.deepEqual(ids(await selection.lookupActiveContacts(org, { search: "private@example" })), []);
    assert.deepEqual(ids(await selection.lookupActiveContacts(org, { search: "' OR true --" })), []);
    assert.deepEqual(ids(await selection.lookupActiveContacts(org, { search: "  " })), ids(await selection.lookupActiveContacts(org, {})));
  });
  await check("selected contact hydration is independent of page/search but never of active scope", async () => {
    const result = await selection.lookupActiveContacts(org, { search: "Alex", limit: 1, selectedContactId: contact("standalone") });
    assert.deepEqual(ids(result), ["direct"]);
    assert.deepEqual(result.selectedContact, { id: "standalone", label: "Dana Standalone" });
    const filtered = await selection.lookupActiveContacts(org, { customerId: customer, search: "Alex", limit: 1, selectedContactId: contact("linked") });
    assert.deepEqual(ids(filtered), ["direct"]); assert.equal(filtered.selectedContact?.id, "linked");
    for (const id of ["foreign", "missing", "archived"]) assert.equal((await selection.lookupActiveContacts(org, { selectedContactId: contact(id) })).selectedContact, null, id);
    for (const id of ["unlinked-direct", "standalone", "former", "removed", "archived", "foreign"]) assert.equal((await selection.lookupActiveContacts(org, { customerId: customer, selectedContactId: contact(id) })).selectedContact, null, id);
    await db.query("UPDATE customer_contact_links SET status='former' WHERE id='direct-link'");
    assert.equal((await selection.lookupActiveContacts(org, { customerId: customer, selectedContactId: contact("direct") })).selectedContact, null);
    assert.equal(await customers.validateContactReference(reference("direct", customer)), false);
    assert.equal((await selection.lookupActiveContacts(org, { selectedContactId: contact("direct") })).selectedContact?.id, "direct");
    await db.query("UPDATE customer_contact_links SET status='active' WHERE id='direct-link'");
  });
  await check("bounds are enforced before SQL and equal names have deterministic ID ordering", async () => {
    for (let index = 59; index >= 0; index--) await db.query("INSERT INTO customer_contacts(id,organization_id,first_name,last_name) VALUES($1,$2,'Bounded','Name')", [`bounded-${String(index).padStart(2, "0")}`, org]);
    assert.equal((await selection.lookupActiveContacts(org, { search: "Bounded" })).items.length, 25);
    const bounded = await selection.lookupActiveContacts(org, { search: "Bounded", limit: 500 });
    assert.equal(bounded.items.length, 50);
    assert.deepEqual(ids(bounded), Array.from({ length: 50 }, (_, index) => `bounded-${String(index).padStart(2, "0")}`));
    assert.deepEqual(ids(await selection.lookupActiveContacts(org, { search: "Bounded", limit: 0 })), ["bounded-00"]);
    assert.deepEqual(ids(await selection.lookupActiveContacts(org, { search: "Same Name", limit: 2 })), ["tie-a", "tie-b"]);
    assert.deepEqual(ids(await selection.lookupActiveContacts(org, { search: "Same Name", limit: 2 })), ["tie-a", "tie-b"]);
    const before = statements.length;
    // Deliberately invalid transport values bypass the branded constructor.
    for (const query of [{ search: "x".repeat(121) }, { limit: 1.5 }, { limit: NaN }, { limit: Infinity }, { customerId: "" as typeof customer }, { selectedContactId: " " as ReturnType<typeof contact> }]) {
      await assert.rejects(selection.lookupActiveContacts(org, query), (error: unknown) => (error as { code: string }).code === "VALIDATION_ERROR");
    }
    await assert.rejects(selection.lookupActiveContacts("" as typeof org, {}), (error: unknown) => (error as { code: string }).code === "VALIDATION_ERROR");
    assert.equal(statements.length, before, "invalid inputs must not broaden or execute queries");
    assert.deepEqual((await selection.lookupActiveContacts(org, { search: "x".repeat(120) })).items, []);
  });
  await check("lookup uses at most two read-only parameterized queries and no empty IN", async () => {
    const before = statements.length;
    await selection.lookupActiveContacts(org, { customerId: customer, search: "none", selectedContactId: contact("missing") });
    const lookupSql = statements.slice(before);
    assert.equal(lookupSql.length, 2);
    for (const sql of lookupSql) {
      assert.match(sql, /^SELECT/);
      assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK)\b|IN\s*\(\s*\)|email|phone|internal_notes/i);
      assert.match(sql, /ct\.organization_id=\$1/);
    }
  });
  console.log(`Sales contact PostgreSQL characterization: ${cases} cases passed.`);
} finally {
  await db.close();
}
