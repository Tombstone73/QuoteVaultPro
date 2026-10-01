import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import express from "express";
import request from "supertest";
import { PGlite } from "@electric-sql/pglite";
import type { Pool, PoolClient } from "pg";
import type { OperationContext } from "../../src/application/operation.js";
import type { Capability } from "../../src/authorization/capabilities.js";
import type { ProductPricingCompatibilityPort } from "../../src/modules/products/contracts.js";
import type { CustomerScopedPricingPort } from "../../src/modules/products/customerCommercial.js";
import type { QuoteReadModel, QuoteTransaction } from "../../src/modules/sales/quoteApplication.js";
import type { OrderReadModel, OrderTransaction } from "../../src/modules/sales/orderApplication.js";
import type { SalesWorkspace } from "../../src/modules/sales/workspaceContracts.js";
import { SalesWorkspaceApplicationService } from "../../src/modules/sales/workspaceApplication.js";
import { SalesWorkspaceLineService } from "../../src/modules/sales/workspaceLines.js";
import { brandedId, currencyCode } from "../../src/modules/shared/commercialValues.js";
import { V2PricingParityAdapter } from "../../src/modules/pricing/v2PricingAdapter.js";
import { PostgresCustomersCompatibilityReader } from "../../infrastructure/compatibility/postgresCustomersRead.js";
import { PostgresSalesContactSelection } from "../../infrastructure/customers/postgresSalesContactSelection.js";
import { PostgresSalesWorkspaceStore, PostgresSalesWorkspaceTransaction } from "../../infrastructure/sales/postgresSalesWorkspace.js";
import { PostgresWorkspaceLinePricing } from "../../infrastructure/sales/postgresWorkspaceLinePricing.js";
import { PostgresWorkspacePromotion } from "../../infrastructure/sales/postgresWorkspacePromotion.js";
import { createSalesWorkspaceRouter, type SalesWorkspaceHttpDependencies } from "../../src/interfaces/http/salesWorkspaceRoutes.js";

assert.equal(process.env.V2_VALIDATION_MODE, "deterministic");
assert.deepEqual(Object.keys(process.env).filter(key => /^(PG|DB)|DATABASE|POSTGRES|NEON|RAILWAY|CONNECTION_STRING/i.test(key)), []);
const org = brandedId<"OrganizationId">(randomUUID()), otherOrg = randomUUID(), user = randomUUID(), otherUser = randomUUID();
const account = brandedId<"CustomerId">(randomUUID()), product = brandedId<"ProductId">(randomUUID()), config = brandedId<"PricingConfigurationId">(randomUUID());
const contact = brandedId<"ContactId">(randomUUID()), savedContact = brandedId<"ContactId">(randomUUID()), foreignContact = randomUUID(), archivedContact = randomUUID();
const usd = currencyCode("USD"), clock = new Date("2026-10-01T00:00:00.000Z");
let actorUser = user, actorOrg: string = org, caps: readonly Capability[] = ["quote.create", "order.create"], principalCalls = 0, leased = false;
const db = new PGlite(), statements: string[] = [];
const client = {
  async query(sql: string, values?: readonly unknown[]) { statements.push(sql); const result = await db.query(sql, values ? [...values] : []); return { ...result, rowCount: result.affectedRows ?? result.rows.length }; },
  release() { assert.equal(leased, true); leased = false; },
} as unknown as PoolClient;
const pool = { async connect() { assert.equal(leased, false, "all operations use one transaction-local client"); leased = true; return client; } } as unknown as Pool;
const json = (value: unknown) => JSON.stringify(value, (_key, entry: unknown) => typeof entry === "bigint" ? entry.toString() : entry);
const context = (requestId = randomUUID()): OperationContext => ({ organizationId: org, operationId: "m3.workspace.integration", businessRequest: { id: requestId, payloadFingerprint: "not-authoritative" }, principal: { kind: "staff", organizationId: org, userId: user, authority: { membershipId: "verified", capabilities: ["quote.create", "order.create", "order.view", "order.edit"] } } });

await db.exec(`CREATE TABLE organizations(id varchar PRIMARY KEY); CREATE TABLE users(id varchar PRIMARY KEY);
  CREATE TABLE customers(id varchar PRIMARY KEY,organization_id varchar NOT NULL,company_name varchar NOT NULL,display_name varchar,email varchar,phone varchar,is_active boolean DEFAULT true,status varchar DEFAULT 'active',merged_into_customer_id varchar,payment_terms varchar DEFAULT 'net_30',
    billing_street1 varchar,billing_street2 varchar,billing_city varchar,billing_state varchar,billing_postal_code varchar,billing_country varchar,shipping_street1 varchar,shipping_street2 varchar,shipping_city varchar,shipping_state varchar,shipping_postal_code varchar,shipping_country varchar);
  CREATE TABLE customer_contacts(id varchar PRIMARY KEY,organization_id varchar NOT NULL,customer_id varchar,first_name varchar NOT NULL,last_name varchar NOT NULL,status varchar DEFAULT 'active',email varchar,phone varchar);
  CREATE TABLE customer_contact_links(id varchar PRIMARY KEY,organization_id varchar NOT NULL,customer_id varchar NOT NULL,contact_id varchar NOT NULL,status varchar DEFAULT 'active');
  CREATE TABLE v2_sales_documents(id varchar PRIMARY KEY,organization_id varchar NOT NULL,document_kind text NOT NULL,revision integer NOT NULL DEFAULT 1,payload jsonb NOT NULL,UNIQUE(id,organization_id));
  CREATE TABLE v2_sales_document_lines(id varchar PRIMARY KEY,organization_id varchar NOT NULL,document_id varchar NOT NULL,position integer NOT NULL,payload jsonb NOT NULL,UNIQUE(id,organization_id),UNIQUE(id,organization_id,document_id));
  CREATE TABLE integration_requests(id varchar PRIMARY KEY,organization_id varchar,operation text,request_id text,fingerprint text,status text,result jsonb,UNIQUE(organization_id,operation,request_id));
  CREATE TABLE integration_numbers(kind text PRIMARY KEY,value bigint NOT NULL);
  CREATE TABLE integration_effects(id varchar PRIMARY KEY,kind text NOT NULL,payload jsonb NOT NULL);
  CREATE TABLE v2_customer_product_pricing_agreements(id varchar,organization_id varchar,customer_id varchar,product_id varchar,product_version_id varchar,currency text,pricing_mode text,pricing_value integer,active boolean,effective_from timestamptz,created_at timestamptz);`);
await db.query("INSERT INTO organizations VALUES($1),($2)", [org, otherOrg]);
await db.query("INSERT INTO users VALUES($1),($2)", [user, otherUser]);
await db.query("INSERT INTO customers(id,organization_id,company_name) VALUES($1,$2,'Existing Account')", [account, org]);
await db.query(`INSERT INTO customer_contacts(id,organization_id,customer_id,first_name,last_name,status,email) VALUES
  ($1,$3,$4,'Alex','Direct','active','private@example.invalid'),($2,$3,NULL,'Zoe','Saved','active',NULL),($5,$6,NULL,'Foreign','Private','active',NULL),($7,$3,NULL,'Archived','Private','archived',NULL)`, [contact, savedContact, org, account, foreignContact, otherOrg, archivedContact]);
await db.query("INSERT INTO customer_contact_links VALUES('active-link',$1,$2,$3,'active')", [org, account, contact]);
for (const migration of ["0294_v2_sales_workspace_foundation.sql", "0296_v2_order_edit_workspaces.sql"]) await db.exec(await readFile(new URL(`../../../server/db/migrations_v2/${migration}`, import.meta.url), "utf8"));

const customers = new PostgresCustomersCompatibilityReader(client), pricing = new V2PricingParityAdapter();
const products = {
  async resolveActivePricingInput(input) { return { ok: true, value: {
    sellableProduct: { organizationId: org, productId: product, displayName: "Fixture product", lifecycle: "active", requiresDimensions: false, pricingCurrency: usd, pricingConfiguration: { id: config, version: "1", contentHash: "fixture-v1" } },
    resolvedConfiguration: { schemaVersion: 1, organizationId: org, productId: product, pricingConfigurationId: config, pricingConfigurationVersion: "1", pricingConfigurationContentHash: "fixture-v1", quantity: input.quantity, selections: input.selections ?? {}, derivedFacts: {}, productFacts: {} }, rules: { base: { perPieceCents: 125 } }, warnings: [],
  } }; },
  async resolveCurrentTaxability() { return { taxable: false }; },
  async resolveOrderRoutability() { return { kind: "routable", productName: "Fixture product", routing: { kind: "no_route" } }; },
} satisfies Pick<ProductPricingCompatibilityPort, "resolveActivePricingInput" | "resolveCurrentTaxability" | "resolveOrderRoutability">;
const store = new PostgresSalesWorkspaceStore(pool), service = new SalesWorkspaceApplicationService(store, { now: () => clock });
const lines = new SalesWorkspaceLineService(store, { now: () => clock,
  pricing: tx => { assert.ok(tx instanceof PostgresSalesWorkspaceTransaction); return new PostgresWorkspaceLinePricing(tx.client, { customers, products, pricing, now: () => clock }); },
  releaseLineArtwork: async () => { throw Error("No Artwork removal in contact integration"); },
});
const effect = async (kind: string, payload: unknown) => client.query("INSERT INTO integration_effects VALUES($1,$2,$3::jsonb)", [randomUUID(), kind, json(payload)]);
// Only persistence and unrelated owner effects are fixture ports. Promotion runs
// the real Sales applications; active-reference validation and rollback use SQL.
function canonicalTransaction(supplied: PoolClient, target: "quote" | "order", customerPricing?: CustomerScopedPricingPort) {
  assert.equal(supplied, client); assert.equal(leased, true);
  const common = {
    customers, pricing, products: products as unknown as ProductPricingCompatibilityPort, customerPricing,
    async reserve(input: Parameters<QuoteTransaction["reserve"]>[0]) { const id = randomUUID(); await client.query("INSERT INTO integration_requests VALUES($1,$2,$3,$4,$5,'in_progress',NULL)", [id, input.organizationId, input.operation, input.businessRequestId, input.payloadFingerprint]); return { kind: "new" as const, request: { id, status: "in_progress" as const, resultJson: null } }; },
    async succeed(organizationId: string, id: string, result: unknown) { await client.query("UPDATE integration_requests SET status='succeeded',result=$3::jsonb WHERE organization_id=$1 AND id=$2", [organizationId, id, json(result)]); },
    async allocateNumber() { const row = (await client.query<{ value: string }>("INSERT INTO integration_numbers VALUES($1,1) ON CONFLICT(kind) DO UPDATE SET value=integration_numbers.value+1 RETURNING value::text", [target])).rows[0]; const core = BigInt(row.value); return { kind: target, core, display: `${target}-${core}` }; },
    async create(input: Parameters<QuoteTransaction["create"]>[0] | Parameters<OrderTransaction["create"]>[0]) { const id = "quoteId" in input ? input.quoteId : input.orderId; await client.query("INSERT INTO v2_sales_documents(id,organization_id,document_kind,payload) VALUES($1,$2,$3,$4::jsonb)", [id, input.organizationId, target, json(input)]); for (const [position, line] of input.lines.entries()) await client.query("INSERT INTO v2_sales_document_lines VALUES($1,$2,$3,$4,$5::jsonb)", [line.lineId, input.organizationId, id, position, json(line)]); },
    async read(organizationId: string, id: string) { const row = (await client.query<{ payload: Record<string, unknown>; revision: number }>("SELECT payload,revision FROM v2_sales_documents WHERE organization_id=$1 AND id=$2", [organizationId, id])).rows[0]; if (!row) return null; const payload = row.payload as unknown as Parameters<QuoteTransaction["create"]>[0]; const number = { ...payload.number, core: BigInt(payload.number.core) }; return target === "quote" ? { quote: { ...payload, currency: usd, deliveryState: "not_sent", acceptanceState: "not_accepted", lifecycleState: "open" }, number, revision: String(row.revision), checkpoints: [] } as QuoteReadModel : { order: { ...payload, currency: usd, commercialState: "open" }, number, revision: String(row.revision), totals: {}, routes: [], completionEligibility: { eligible: false, blockers: [], lines: [] } } as unknown as OrderReadModel; },
    async audit(input: Parameters<QuoteTransaction["audit"]>[0]) { await effect("audit", input); },
    async attribute(input: Parameters<QuoteTransaction["attribute"]>[0]) { await effect("attribute", input); },
  };
  if (target === "quote") return { ...common, update: async () => { throw Error("No inline Quote edit"); }, transition: async () => { throw Error("No Quote lifecycle transition"); }, freezeTaxComposition: async () => { throw Error("No Quote checkpoint"); } } as QuoteTransaction;
  return { ...common, materialRequirements: { freeze: async (...input: unknown[]) => { await effect("materials", input); } },
    billing: { createDraftInvoice: async (input: Parameters<OrderTransaction["billing"]["createDraftInvoice"]>[0]) => { await effect("billing", input); return { invoiceId: randomUUID(), status: "created", synchronizationVersion: "1" }; } },
    routing: { instantiateRoute: async () => { throw Error("No-route Product must not create work"); } },
  } as unknown as OrderTransaction;
}
const promotion = new PostgresWorkspacePromotion(pool, async () => ({ promotedCount: 0, claims: [] }), { now: () => clock,
  quoteTransaction: supplied => canonicalTransaction(supplied, "quote") as QuoteTransaction,
  orderTransaction: (supplied, customerPricing) => canonicalTransaction(supplied, "order", customerPricing) as OrderTransaction,
});
let lookupCalls = 0;
const dependencies: SalesWorkspaceHttpDependencies = { service, lines, promotion,
  principals: { principal: async () => { principalCalls++; return { kind: "staff", organizationId: actorOrg, userId: actorUser, authority: { membershipId: "fresh-verified", capabilities: caps } }; } },
  formReads: { customers: async () => [], contacts: async () => { throw Error("Legacy account-only reader must not serve workspace contacts"); }, products: async () => [], configuration: async () => null },
  contactSelection: { lookupActiveContacts: (organizationId, query) => { lookupCalls++; return store.run(tx => { assert.ok(tx instanceof PostgresSalesWorkspaceTransaction); return new PostgresSalesContactSelection(tx.client).lookupActiveContacts(organizationId, query); }); } },
  preview: async () => { throw Error("No direct preview bypass"); },
  artwork: { uploads: { upload: async () => { throw Error("No upload"); } }, lifecycle: { list: async () => [], remove: async () => { throw Error("No removal"); }, assign: async () => { throw Error("No assignment"); } } },
};
const app = express(); app.use(express.json()); app.use("/v2/organizations/:organizationId/sales-workspaces", createSalesWorkspaceRouter(dependencies));
const endpoint = (id?: string) => `/v2/organizations/${org}/sales-workspaces${id ? `/${id}` : ""}`;
const data = (response: { status: number; body: { ok: boolean; data: unknown; error?: unknown } }) => { assert.equal(response.status, 200, json(response.body)); assert.equal(response.body.ok, true); return response.body.data as SalesWorkspace; };
const create = async (customerContact = { organizationId: org, contactId: savedContact }) => data(await request(app).post(endpoint()).send({ requestId: randomUUID(), header: { customerContact, jobLabel: "Contact-only job", terms: { commercialNotes: "Preserve commercial terms" }, notes: "TEMP metadata" } }));
const add = async (workspace: SalesWorkspace) => data(await request(app).post(`${endpoint(workspace.id)}/lines`).send({ requestId: randomUUID(), expectedRevision: workspace.revision, line: { productId: product, quantity: 2 } }));
const image = async () => {
  const result: Record<string, unknown> = {};
  for (const table of ["customers", "v2_sales_documents", "v2_sales_document_lines", "integration_requests", "integration_numbers", "integration_effects", "v2_sales_workspaces", "v2_sales_workspace_lines", "v2_sales_workspace_requests", "v2_sales_workspace_promotions", "v2_sales_workspace_promotion_lines"]) result[table] = (await db.query(`SELECT * FROM ${table} ORDER BY 1`)).rows;
  return result;
};
let cases = 0;
const check = async (name: string, work: () => Promise<void>) => { await work(); cases++; console.log(`PASS ${name}`); };
try {
  const workspace = await create();
  await check("actual HTTP contact-only lookup is scoped, name-only, bounded and no-store", async () => {
    const before = await image(), start = statements.length;
    const response = await request(app).get(`${endpoint(workspace.id)}/contacts`).query({ limit: "1", selectedContactId: savedContact });
    assert.equal(response.status, 200); assert.equal(response.headers["cache-control"], "private, no-store");
    assert.deepEqual(response.body.data, { items: [{ id: contact, label: "Alex Direct" }], selectedContact: { id: savedContact, label: "Zoe Saved" } });
    assert.doesNotMatch(json(response.body.data), /customerId|email|Foreign|Archived/);
    assert.ok(statements.slice(start).findIndex(sql => sql.includes("FROM v2_sales_workspaces")) < statements.slice(start).findIndex(sql => sql.includes("FROM customer_contacts")));
    assert.deepEqual(await image(), before, "lookup never changes CRM, TEMP or canonical state");
  });
  await check("actual HTTP Customer filter uses active owner links, not the direct compatibility column", async () => {
    const valid = await request(app).get(`${endpoint(workspace.id)}/contacts`).query({ customerId: account, selectedContactId: contact });
    assert.deepEqual(valid.body.data, { items: [{ id: contact, label: "Alex Direct" }], selectedContact: { id: contact, label: "Alex Direct" } });
    await db.query("UPDATE customer_contact_links SET status='former'");
    const invalid = await request(app).get(`${endpoint(workspace.id)}/contacts`).query({ customerId: account, selectedContactId: contact });
    assert.deepEqual(invalid.body.data, { items: [], selectedContact: null });
    const standalone = await request(app).get(`${endpoint(workspace.id)}/contacts`).query({ selectedContactId: contact });
    assert.equal(standalone.body.data.selectedContact.id, contact, "contact-only does not infer or require an account link");
    await db.query("UPDATE customer_contact_links SET status='active'");
  });
  await check("unknown, stale, foreign or Customer-incompatible selected IDs hydrate to null", async () => {
    for (const id of [randomUUID(), foreignContact, archivedContact]) { const response = await request(app).get(`${endpoint(workspace.id)}/contacts`).query({ selectedContactId: id }); assert.equal(response.status, 200); assert.equal(response.body.data.selectedContact, null); }
    const incompatible = await request(app).get(`${endpoint(workspace.id)}/contacts`).query({ customerId: account, selectedContactId: savedContact });
    assert.equal(incompatible.body.data.selectedContact, null);
  });
  await check("strict bounded HTTP queries reject before the Customer owner read", async () => {
    const before = lookupCalls;
    for (const query of [{ extra: "ignored" }, { limit: "0" }, { limit: "51" }, { limit: "1.5" }, { search: "x".repeat(121) }, { customerId: "bad" }, { selectedContactId: "bad" }, { customerId: [account, account] }]) assert.equal((await request(app).get(`${endpoint(workspace.id)}/contacts`).query(query)).status, 400);
    assert.equal(lookupCalls, before);
  });
  await check("every request freshly verifies org, creator and kind-specific authority before CRM", async () => {
    const before = lookupCalls;
    actorUser = otherUser; assert.equal((await request(app).get(`${endpoint(workspace.id)}/contacts`)).status, 404);
    actorUser = user; actorOrg = otherOrg; assert.equal((await request(app).get(`${endpoint(workspace.id)}/contacts`)).status, 404);
    actorOrg = org; caps = []; assert.equal((await request(app).get(`${endpoint(workspace.id)}/contacts`)).status, 403);
    caps = ["order.view", "order.edit"]; assert.equal((await request(app).get(`${endpoint(workspace.id)}/contacts`)).status, 403);
    assert.equal(lookupCalls, before); caps = ["quote.create", "order.create"];
    assert.ok(principalCalls >= 4);
  });
  await check("actual Draft save/reload replaces account identity and preserves complete header without canonical effects", async () => {
    const original = await service.create(context(), { requestId: randomUUID(), header: { customerContact: { organizationId: org, customerId: account, contactId: contact }, jobLabel: "Hidden label", purchaseOrderNumber: "PO-1", requestedFulfillment: { method: "pickup", instructions: "Retain" }, terms: { termsCode: "net_30", commercialNotes: "Retain terms" }, notes: "TEMP only" } });
    const nextHeader = { ...original.header, customerContact: { organizationId: org, contactId: savedContact } };
    const before = (await db.query("SELECT * FROM v2_sales_documents")).rows;
    const saved = data(await request(app).patch(endpoint(original.id)).send({ requestId: randomUUID(), expectedRevision: original.revision, header: nextHeader }));
    const reloaded = data(await request(app).get(endpoint(original.id)));
    assert.deepEqual(saved.header, nextHeader); assert.deepEqual(reloaded.header, nextHeader); assert.equal(Object.hasOwn(reloaded.header.customerContact!, "customerId"), false);
    assert.deepEqual((await db.query("SELECT * FROM v2_sales_documents")).rows, before);
  });
  for (const target of ["quote", "order"] as const) await check(`actual HTTP workspace coordinator promotes contact-only ${target} through real Sales and preserves identity`, async () => {
    const draft = await add(await create()), requestId = randomUUID();
    const response = await request(app).post(`${endpoint(draft.id)}/promote`).send({ requestId, expectedRevision: draft.revision, target });
    assert.equal(response.status, 200, json(response.body));
    const receipt = response.body.data.receipt, document = (await db.query<{ payload: { customerContact: unknown; jobLabel: string; terms: unknown } }>("SELECT payload FROM v2_sales_documents WHERE id=$1", [receipt.documentId])).rows[0].payload;
    assert.deepEqual(document.customerContact, { organizationId: org, contactId: savedContact }); assert.equal(Object.hasOwn(document.customerContact!, "customerId"), false);
    assert.equal(document.jobLabel, "Contact-only job"); assert.deepEqual(document.terms, { commercialNotes: "Preserve commercial terms" });
    assert.deepEqual(receipt.header.customerContact, document.customerContact); assert.equal(receipt.lineMap[0].workspaceLineId, draft.lines[0].id);
    const before = await image();
    const replay = await request(app).post(`${endpoint(draft.id)}/promote`).send({ requestId, expectedRevision: draft.revision, target });
    assert.equal(replay.status, 200); assert.equal(replay.body.data.replayed, true); assert.deepEqual(await image(), before);
    if (target === "order") { const billing = (await db.query<{ payload: { customerContact: unknown } }>("SELECT payload FROM integration_effects WHERE kind='billing' ORDER BY id")).rows.at(-1)!; assert.deepEqual(billing.payload.customerContact, document.customerContact); }
    assert.equal((await db.query("SELECT * FROM customers")).rows.length, 1, "no Customer account is inferred or created");
  });
  for (const failure of ["stale", "foreign", "link"] as const) await check(`actual promotion revalidates ${failure} contact evidence and rolls back all coordinator effects`, async () => {
    const reference = failure === "link" ? { organizationId: org, customerId: account, contactId: contact } : { organizationId: org, contactId: savedContact };
    const draft = await add(await service.create(context(), { requestId: randomUUID(), header: { customerContact: reference } }));
    if (failure === "stale") await db.query("UPDATE customer_contacts SET status='archived' WHERE id=$1", [savedContact]);
    if (failure === "foreign") await db.query("UPDATE customer_contacts SET organization_id=$2 WHERE id=$1", [savedContact, otherOrg]);
    if (failure === "link") await db.query("UPDATE customer_contact_links SET status='former'");
    const before = await image();
    const response = await request(app).post(`${endpoint(draft.id)}/promote`).send({ requestId: randomUUID(), expectedRevision: draft.revision, target: "quote" });
    assert.equal(response.status, 404, json(response.body)); assert.equal(response.body.error.code, "NOT_FOUND"); assert.deepEqual(await image(), before);
    await db.query("UPDATE customer_contacts SET status='active',organization_id=$2 WHERE id=$1", [savedContact, org]); await db.query("UPDATE customer_contact_links SET status='active'");
  });
  await check("Order-edit lookup uses fresh view/edit authority without requiring create authority", async () => {
    const sourceId = randomUUID(), editId = randomUUID();
    await db.query("INSERT INTO v2_sales_documents(id,organization_id,document_kind,payload) VALUES($1,$2,'order','{}')", [sourceId, org]);
    await db.query(`INSERT INTO v2_sales_workspaces(id,organization_id,creator_user_id,kind,state,source_document_kind,source_document_id,base_revision,revision,header_json,creation_request_id,creation_fingerprint,created_at,updated_at,expires_at,source_header_json,source_artifact_fingerprint)
      VALUES($1,$2,$3,'order_edit','draft','order',$4,'1',1,'{}',$5,$6,$7,$7,'2026-10-31',$8::jsonb,$6)`, [editId, org, user, sourceId, randomUUID(), "a".repeat(64), clock.toISOString(), json({ orderId: sourceId, organizationId: org })]);
    const before = lookupCalls; caps = ["order.create"];
    assert.equal((await request(app).get(`${endpoint(editId)}/contacts`)).status, 403); assert.equal(lookupCalls, before);
    caps = ["order.view", "order.edit"]; assert.equal((await request(app).get(`${endpoint(editId)}/contacts`)).status, 200);
    caps = ["order.view"]; assert.equal((await request(app).get(`${endpoint(editId)}/contacts`)).status, 403);
    caps = ["quote.create", "order.create"];
  });
  console.log(`Contact-only workspace HTTP/SQL coordinator: ${cases} cases passed. Canonical persistence and downstream effects use same-client SQL fixture ports; no live Billing/provider or native concurrency proof.`);
} finally { assert.equal(leased, false); await db.close(); }
