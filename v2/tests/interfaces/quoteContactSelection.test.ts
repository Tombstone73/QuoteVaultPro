import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import express from "express";
import request from "supertest";
import { PGlite } from "@electric-sql/pglite";
import type { Principal } from "../../src/authorization/principals.js";
import type { TransactionalClient } from "../../infrastructure/persistence/types.js";
import { PostgresCustomersCompatibilityReader } from "../../infrastructure/compatibility/postgresCustomersRead.js";
import { PostgresSalesContactSelection } from "../../infrastructure/customers/postgresSalesContactSelection.js";
import { QuoteApplicationService, type QuoteReadModel, type QuoteTransaction } from "../../src/modules/sales/quoteApplication.js";
import { createQuoteRouter, type QuoteHttpDependencies } from "../../src/interfaces/http/quoteRoutes.js";
import { brandedId, currencyCode } from "../../src/modules/shared/commercialValues.js";

/** Shared by the mounted App test. Only Quote persistence/effect ports are
 * fixtures; authorization, reference validation, updates and CRM selection run
 * the actual applications/adapters. No live database or provider imports. */
export async function quoteContactFixture() {
  assert.equal(process.env.V2_VALIDATION_MODE, "deterministic");
  assert.deepEqual(Object.keys(process.env).filter(key => /^(PG|DB)|DATABASE|POSTGRES|NEON|RAILWAY|CONNECTION_STRING/i.test(key)), []);
  const org = brandedId<"OrganizationId">("11111111-1111-4111-8111-111111111111");
  const otherOrg = "22222222-2222-4222-8222-222222222222";
  const quoteId = brandedId<"QuoteId">("33333333-3333-4333-8333-333333333333");
  const customerId = brandedId<"CustomerId">("44444444-4444-4444-8444-444444444444");
  const otherCustomerId = brandedId<"CustomerId">("55555555-5555-4555-8555-555555555555");
  const contactId = brandedId<"ContactId">("66666666-6666-4666-8666-666666666666");
  const foreignContactId = brandedId<"ContactId">("77777777-7777-4777-8777-777777777777");
  const db = new PGlite();
  const events: string[] = [];
  const client = { async query(sql: string, values?: readonly unknown[]) {
    events.push("sql:" + sql);
    const result = await db.query(sql, values ? [...values] : []);
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  } } as TransactionalClient;
  await db.exec(`CREATE TABLE customers(id varchar PRIMARY KEY,organization_id varchar NOT NULL,company_name varchar NOT NULL,is_active boolean DEFAULT true,status varchar DEFAULT 'active',merged_into_customer_id varchar);
    CREATE TABLE customer_contacts(id varchar PRIMARY KEY,organization_id varchar NOT NULL,customer_id varchar,first_name varchar NOT NULL,last_name varchar NOT NULL,status varchar DEFAULT 'active',email varchar,phone varchar);
    CREATE TABLE customer_contact_links(id varchar PRIMARY KEY,organization_id varchar NOT NULL,customer_id varchar NOT NULL,contact_id varchar NOT NULL,status varchar DEFAULT 'active');`);
  await db.query("INSERT INTO customers(id,organization_id,company_name) VALUES($1,$3,'Account A'),($2,$3,'Account B')", [customerId, otherCustomerId, org]);
  await db.query("INSERT INTO customer_contacts(id,organization_id,customer_id,first_name,last_name,status) VALUES($1,$2,NULL,'Zoe','Saved','active'),($3,$4,NULL,'Private','Foreign','active'),('page-first',$2,NULL,'Alex','Other','active')", [contactId, org, foreignContactId, otherOrg]);
  await db.query("INSERT INTO customer_contact_links VALUES('link',$1,$2,$3,'active')", [org, customerId, contactId]);
  let quote: QuoteReadModel = { quote: { quoteId, organizationId: org, customerContact: { organizationId: org, contactId }, currency: currencyCode("USD"), terms: {}, deliveryState: "not_sent", acceptanceState: "not_accepted", lifecycleState: "open", lines: [] }, number: { kind: "quote", display: "QT1001", core: 1001n }, revision: "1", checkpoints: [] };
  let principal: Principal = { kind: "staff", organizationId: org, userId: "staff", authority: { membershipId: "fresh", capabilities: ["quote.view", "quote.edit"] } };
  const customers = new PostgresCustomersCompatibilityReader(client);
  const effects: unknown[] = [];
  const unused = async (): Promise<never> => { throw Error("Unrelated owner port must not be called"); };
  const tx: QuoteTransaction = {
    customers,
    products: { resolveActivePricingInput: unused } as unknown as QuoteTransaction["products"],
    pricing: { calculate: unused },
    reserve: async () => ({ kind: "new", request: { id: randomUUID(), status: "in_progress", resultJson: null } }),
    succeed: async (...args) => { effects.push(args); },
    attribute: async value => { effects.push(value); },
    audit: async value => { effects.push(value); },
    allocateNumber: unused, create: unused, transition: unused, freezeTaxComposition: unused,
    read: async (organizationId, id) => { events.push("quote-read"); return organizationId === org && id === quoteId ? structuredClone(quote) : null; },
    update: async input => {
      assert.equal(input.organizationId, org); assert.equal(input.quoteId, quoteId);
      if (input.expectedRevision !== Number(quote.revision)) return false;
      const { expectedRevision, ...fields } = input;
      quote = { ...quote, revision: String(expectedRevision + 1), quote: { ...quote.quote, ...fields } };
      return true;
    },
  };
  const service = new QuoteApplicationService({ transaction: async work => work(tx) });
  const selection = new PostgresSalesContactSelection(client);
  const dependencies: QuoteHttpDependencies = {
    service,
    principals: { principal: async () => { events.push("fresh-principal"); return principal; } },
    formReads: { customers: async () => [{ customerId, displayName: "Account A" }, { customerId: otherCustomerId, displayName: "Account B" }], contacts: async (_org, customer) => {
      events.push(`form-contacts:${customer}`);
      const result = await selection.lookupActiveContacts(org, { customerId: brandedId<"CustomerId">(customer) });
      return result.items.map(item => ({ contactId: item.id, displayName: item.label }));
    }, products: async () => [], configuration: async () => null },
    contactSelection: { lookupActiveContacts: async (organizationId, input) => { events.push("selection"); return selection.lookupActiveContacts(organizationId, input); } },
  };
  const app = express(); app.use(express.json()); app.use("/v2/organizations/:organizationId/quotes", createQuoteRouter(dependencies));
  const endpoint = `/v2/organizations/${org}/quotes/${quoteId}`;
  return { app, endpoint, org, otherOrg, quoteId, customerId, otherCustomerId, contactId, foreignContactId, db, events, effects, dependencies,
    get quote() { return quote; }, set quote(value: QuoteReadModel) { quote = value; },
    get principal() { return principal; }, set principal(value: Principal) { principal = value; },
  };
}

async function main() {
  const f = await quoteContactFixture();
  const selection = () => request(f.app).get(`${f.endpoint}/contact-selection`);
  const reference = (customerId?: typeof f.customerId, contactId = f.contactId) => { f.quote = { ...f.quote, quote: { ...f.quote.quote, customerContact: { organizationId: f.org, ...(customerId ? { customerId } : {}), contactId } } }; };
  let cases = 0;
  const check = async (name: string, work: () => Promise<void>) => { await work(); cases++; console.log(`PASS ${name}`); };
  try {
    await check("Contact-only canonical Quote read returns only selected id/label after fresh authorization", async () => {
      f.events.length = 0;
      const response = await selection();
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.headers["cache-control"], "private, no-store");
      assert.deepEqual(response.body.data, { id: f.contactId, label: "Zoe Saved" });
      assert.deepEqual(f.events.slice(0, 3), ["fresh-principal", "quote-read", "selection"]);
      assert.equal(Object.hasOwn(f.quote.quote.customerContact, "customerId"), false);
      assert.equal(f.effects.length, 0);
    });
    await check("Customer plus Contact uses active linked filtering without account inference", async () => {
      reference(f.customerId); assert.equal((await selection()).body.data.id, f.contactId);
      reference(f.otherCustomerId); assert.equal((await selection()).body.data, null);
      reference(f.customerId); await f.db.query("UPDATE customer_contact_links SET status='former'");
      assert.equal((await selection()).body.data, null);
      reference(); assert.equal((await selection()).body.data.id, f.contactId);
      await f.db.query("UPDATE customer_contact_links SET status='active'");
    });
    await check("missing inactive and foreign selected references are null without rewriting canonical identity", async () => {
      for (const id of [brandedId<"ContactId">("missing"), f.foreignContactId]) {
        reference(undefined, id); assert.equal((await selection()).body.data, null); assert.equal(f.quote.quote.customerContact.contactId, id);
      }
      reference(); await f.db.query("UPDATE customer_contacts SET status='archived' WHERE id=$1", [f.contactId]);
      assert.equal((await selection()).body.data, null); assert.equal(f.quote.quote.customerContact.contactId, f.contactId);
      await f.db.query("UPDATE customer_contacts SET status='active' WHERE id=$1", [f.contactId]);
    });
    await check("caller cannot supply a Contact Customer or search query", async () => {
      for (const query of [{ contactId: f.foreignContactId }, { selectedContactId: f.foreignContactId }, { customerId: f.otherCustomerId }, { search: "Private" }, { limit: "1" }]) {
        f.events.length = 0; assert.equal((await selection().query(query)).status, 400); assert.ok(!f.events.includes("selection"));
      }
      f.events.length = 0; assert.equal((await selection().send({ contactId: f.foreignContactId })).status, 400); assert.ok(!f.events.includes("selection"));
    });
    await check("revoked wrong-tenant and nonexistent Quote cannot reach CRM", async () => {
      const staff = f.principal;
      for (const principal of [{ ...staff, authority: { membershipId: "revoked", capabilities: [] } }, { ...staff, organizationId: f.otherOrg }] as Principal[]) {
        f.principal = principal; f.events.length = 0;
        const response = await selection(); assert.ok([403, 404].includes(response.status));
        assert.equal(response.headers["cache-control"], "private, no-store");
        assert.equal(f.events[0], "fresh-principal"); assert.ok(!f.events.includes("selection"));
      }
      f.principal = staff; f.events.length = 0;
      assert.equal((await request(f.app).get(`${f.endpoint.replace(f.quoteId, "missing")}/contact-selection`)).status, 404);
      assert.ok(!f.events.includes("selection"));
    });
    await check("Portal retains actual Quote Customer scope and cannot browse contact-only or another account", async () => {
      const staff = f.principal;
      f.principal = { kind: "portal", organizationId: f.org, customerId: f.customerId, subjectId: "portal", capabilities: ["quote.view"] };
      for (const customer of [undefined, f.otherCustomerId]) { reference(customer); f.events.length = 0; assert.equal((await selection()).status, 403); assert.ok(!f.events.includes("selection")); }
      reference(f.customerId); assert.deepEqual((await selection()).body.data, { id: f.contactId, label: "Zoe Saved" });
      f.principal = staff; reference();
    });
    await check("missing optional injected dependency fails closed after the Quote authorization", async () => {
      const original = f.dependencies.contactSelection; delete (f.dependencies as { contactSelection?: unknown }).contactSelection;
      f.events.length = 0; assert.equal((await selection()).status, 503);
      assert.deepEqual(f.events, ["fresh-principal", "quote-read"]);
      (f.dependencies as { contactSelection?: typeof original }).contactSelection = original;
    });
    await check("Quote without a Contact returns null without a CRM lookup", async () => {
      const original = f.quote;
      f.quote = { ...f.quote, quote: { ...f.quote.quote, customerContact: { organizationId: f.org, customerId: f.customerId } } };
      f.events.length = 0; assert.equal((await selection()).body.data, null);
      assert.deepEqual(f.events, ["fresh-principal", "quote-read"]); f.quote = original;
    });
    await check("unrelated canonical Save runs actual Quote owner preserves Contact-only and never creates Customer", async () => {
      const before = await f.db.query("SELECT * FROM customers ORDER BY id");
      const response = await request(f.app).patch(f.endpoint).send({ businessRequestId: randomUUID(), expectedRevision: f.quote.revision, patch: { customerContact: { organizationId: f.org, contactId: f.contactId }, purchaseOrderNumber: "PO-unchanged-contact" } });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      const reloaded = await request(f.app).get(f.endpoint);
      assert.deepEqual(reloaded.body.data.quote.customerContact, { organizationId: f.org, contactId: f.contactId });
      assert.equal(reloaded.body.data.quote.purchaseOrderNumber, "PO-unchanged-contact");
      assert.equal((await selection()).body.data.label, "Zoe Saved");
      assert.deepEqual((await f.db.query("SELECT * FROM customers ORDER BY id")).rows, before.rows);
      assert.ok(f.effects.length > 0, "real Quote owner recorded mutation effects");
    });
    console.log(`Canonical Quote contact selection: ${cases} cases passed (real route/application and in-memory Customers PostgreSQL adapter; fixture Quote persistence).`);
  } finally { await f.db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error); process.exitCode = 1; });
