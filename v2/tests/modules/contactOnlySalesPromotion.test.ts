import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { OperationContext } from "../../src/application/operation.js";
import type { TransactionalClient } from "../../infrastructure/persistence/types.js";
import { PostgresCustomersCompatibilityReader } from "../../infrastructure/compatibility/postgresCustomersRead.js";
import { PostgresSalesContactSelection } from "../../infrastructure/customers/postgresSalesContactSelection.js";
import type { CustomerContactReference, CustomersReadPort } from "../../src/modules/customers/contracts.js";
import type { ProductPricingCompatibilityPort } from "../../src/modules/products/contracts.js";
import { CustomerCommercialPricingAdapter, type CustomerCommercialStore } from "../../src/modules/products/customerCommercial.js";
import { V2PricingParityAdapter } from "../../src/modules/pricing/v2PricingAdapter.js";
import { QuoteApplicationService, type QuoteTransaction, type QuoteReadModel } from "../../src/modules/sales/quoteApplication.js";
import { OrderApplicationService, summarizeOrderTotals, type OrderTransaction, type OrderReadModel } from "../../src/modules/sales/orderApplication.js";
import { BillingPaymentsApplicationService, type BillingFinancialTransaction } from "../../src/modules/billing/paymentApplication.js";
import { brandedId, currencyCode, money } from "../../src/modules/shared/commercialValues.js";

assert.equal(process.env.V2_VALIDATION_MODE, "deterministic", "Run through cleanEnvironment/run, not root Jest.");
assert.deepEqual(Object.keys(process.env).filter((key) => /^(PG|DB)|DATABASE|POSTGRES|NEON|RAILWAY|CONNECTION_STRING/i.test(key)), []);
const org = brandedId<"OrganizationId">("tenant-a"), otherOrg = brandedId<"OrganizationId">("tenant-b");
const account = brandedId<"CustomerId">("account-a"), otherAccount = brandedId<"CustomerId">("account-b");
const contactId = brandedId<"ContactId">("contact-a"), product = brandedId<"ProductId">("product-a");
const configuration = brandedId<"PricingConfigurationId">("configuration-a"), usd = currencyCode("USD");
const context = (businessRequestId: string): OperationContext => ({ organizationId: org, operationId: "contact-only-characterization", businessRequest: { id: businessRequestId, payloadFingerprint: "wire-not-authoritative" }, principal: { kind: "staff", organizationId: org, userId: "staff-a", authority: { membershipId: "membership-a", capabilities: ["quote.create", "order.create", "payment.record"] } } });
const db = new PGlite();
const client = { async query(sql: string, values?: readonly unknown[]) { const result = await db.query(sql, values ? [...values] : []); return { ...result, rowCount: result.affectedRows ?? result.rows.length }; } } as TransactionalClient;
await db.exec(`CREATE TABLE organizations(id varchar PRIMARY KEY);
  CREATE TABLE customers(id varchar PRIMARY KEY,organization_id varchar NOT NULL REFERENCES organizations(id),company_name varchar(255) NOT NULL,
    display_name varchar(255),email varchar(255),phone varchar(50),is_active boolean DEFAULT true,status varchar(50) DEFAULT 'active',merged_into_customer_id varchar REFERENCES customers(id),
    payment_terms varchar(50) NOT NULL DEFAULT 'due_on_receipt',
    billing_street1 varchar(255),billing_street2 varchar(255),billing_city varchar(100),billing_state varchar(100),billing_postal_code varchar(20),billing_country varchar(100),
    shipping_street1 varchar(255),shipping_street2 varchar(255),shipping_city varchar(100),shipping_state varchar(100),shipping_postal_code varchar(20),shipping_country varchar(100),UNIQUE(id,organization_id));
  CREATE TABLE customer_contacts(id varchar PRIMARY KEY,organization_id varchar NOT NULL REFERENCES organizations(id),customer_id varchar REFERENCES customers(id) ON DELETE SET NULL,
    first_name varchar(100) NOT NULL,last_name varchar(100) NOT NULL,status varchar(30) NOT NULL DEFAULT 'active',email varchar(255),phone varchar(50),UNIQUE(id,organization_id));
  CREATE TABLE customer_contact_links(id varchar PRIMARY KEY,organization_id varchar NOT NULL REFERENCES organizations(id),customer_id varchar NOT NULL REFERENCES customers(id),contact_id varchar NOT NULL REFERENCES customer_contacts(id),status varchar(30) NOT NULL DEFAULT 'active');
  CREATE UNIQUE INDEX customer_contact_links_active_pair_uidx ON customer_contact_links(customer_id,contact_id) WHERE status <> 'removed';`);
await db.query("INSERT INTO organizations VALUES($1),($2)", [org, otherOrg]);
await db.query("INSERT INTO customers(id,organization_id,company_name,payment_terms) VALUES($1,$3,'Account A','net_30'),($2,$3,'Account B','due_on_receipt'),('foreign-account',$4,'Foreign Account','net_30')", [account, otherAccount, org, otherOrg]);
await db.query(`INSERT INTO customer_contacts(id,organization_id,customer_id,first_name,last_name,status) VALUES
  ($1,$2,$3,'Alex','Direct','active'),('standalone',$2,NULL,'Dana','Standalone','active'),
  ('linked',$2,$4,'Bailey','Linked','active'),('archived',$2,$3,'Stale','Contact','archived'),('foreign',$5,'foreign-account','Foreign','Private','active')`, [contactId, org, account, otherAccount, otherOrg]);
await db.query("INSERT INTO customer_contact_links VALUES('direct-link',$1,$2,$3,'active'),('linked-link',$1,$2,'linked','active')", [org, account, contactId]);
const customers = new PostgresCustomersCompatibilityReader(client);
const lookup = new PostgresSalesContactSelection(client);
const pricing = new V2PricingParityAdapter();
const products = {
  async resolveActivePricingInput(input) {
    assert.equal(input.organizationId, org); assert.equal(input.productId, product);
    return { ok: true, value: {
      sellableProduct: { organizationId: org, productId: product, displayName: "Fixture product", lifecycle: "active", requiresDimensions: false, pricingCurrency: usd, pricingConfiguration: { id: configuration, version: "1", contentHash: "fixture-v1" } },
      resolvedConfiguration: { schemaVersion: 1, organizationId: org, productId: product, pricingConfigurationId: configuration, pricingConfigurationVersion: "1", pricingConfigurationContentHash: "fixture-v1", quantity: input.quantity, selections: input.selections ?? {}, derivedFacts: {}, productFacts: {} },
      rules: { base: { perPieceCents: 125 } }, warnings: [],
    } };
  },
  async resolveCurrentTaxability() { return { taxable: false }; },
  async resolveOrderRoutability() { return { kind: "routable", productName: "Fixture product", routing: { kind: "no_route" } }; },
} satisfies Pick<ProductPricingCompatibilityPort, "resolveActivePricingInput" | "resolveCurrentTaxability" | "resolveOrderRoutability">;
const commercialStore: CustomerCommercialStore = {
  isEntitled: async () => false,
  resolveAgreement: async (input) => input.customerId === account ? { id: "account-agreement", organizationId: org, customerId: account, productId: product, currency: usd, mode: "fixed_unit", value: 325, active: true, effectiveFrom: "2020-01-01T00:00:00.000Z", createdAt: "2020-01-01T00:00:00.000Z" } : null,
  setEntitlement: async () => { throw Error("No entitlement writes in characterization."); },
  replaceAgreement: async () => { throw Error("No agreement writes in characterization."); },
  listEntitlements: async () => [], listActivePricingAgreements: async () => [],
};
const commercialPricing = new CustomerCommercialPricingAdapter(pricing, commercialStore);
type QuoteInput = Parameters<QuoteTransaction["create"]>[0];
type OrderInput = Parameters<OrderTransaction["create"]>[0];
type BillingInput = Parameters<OrderTransaction["billing"]["createDraftInvoice"]>[0];
let quoteInput: QuoteInput | undefined, orderInput: OrderInput | undefined, billingInput: BillingInput | undefined;
let allocations = 0, baseCalls = 0;
const customerPricingCalls: string[] = [];
const common = {
  customers, products: products as unknown as ProductPricingCompatibilityPort,
  pricing: { async calculate(input: Parameters<typeof pricing.calculate>[0]) { baseCalls++; return pricing.calculate(input); } },
  async reserve() { return { kind: "new" as const, request: { id: "fixture-request", status: "in_progress" as const, resultJson: null } }; },
  async succeed() {}, async attribute() {}, async audit() {},
};
// These are explicit transaction-local persistence/owner ports, not mocks of the
// canonical services. The CRM reader executes real PostgreSQL validation; the
// real Sales services and Pricing adapters perform all commercial decisions.
const quoteTx = {
  ...common,
  async allocateNumber() { allocations++; return { kind: "quote" as const, core: 1n, display: "Q-1" }; },
  async create(input: QuoteInput) { quoteInput = input; },
  async read(): Promise<QuoteReadModel | null> {
    return quoteInput ? { quote: { quoteId: quoteInput.quoteId, organizationId: org, customerContact: quoteInput.customerContact, currency: usd, terms: quoteInput.terms, lines: quoteInput.lines, deliveryState: "not_sent", acceptanceState: "not_accepted", lifecycleState: "open" }, number: quoteInput.number, revision: "1", checkpoints: [] } : null;
  },
  async update() { throw Error("No Quote edits expected."); }, async transition() { throw Error("No Quote lifecycle changes expected."); },
  async freezeTaxComposition() { throw Error("No Quote checkpoint mutation expected."); },
} as QuoteTransaction;
const orderTx = {
  ...common,
  customerPricing: { async calculateForCustomer(id: typeof account, input: Parameters<typeof pricing.calculate>[0]) { customerPricingCalls.push(id); return commercialPricing.calculateForCustomer(id, input); } },
  async allocateNumber() { allocations++; return { kind: "order" as const, core: 1n, display: "O-1" }; },
  async create(input: OrderInput) { orderInput = input; },
  async read(): Promise<OrderReadModel | null> {
    return orderInput ? { order: { orderId: orderInput.orderId, organizationId: org, customerContact: orderInput.customerContact, currency: usd, terms: orderInput.terms, lines: orderInput.lines, commercialState: "open" }, number: orderInput.number, revision: "1", totals: summarizeOrderTotals(orderInput.lines, usd), routes: [], completionEligibility: { eligible: false, blockers: [], lines: [] } } : null;
  },
  materialRequirements: { async freeze() {}, async hasFrozen() { return false; } },
  billing: { async createDraftInvoice(input: BillingInput) {
    assert.equal(input.organizationId, org); assert.equal(input.customerContact.organizationId, org);
    assert.equal(input.salesLines.length, 1); assert.ok(input.salesLines[0].salesPricingEvidenceFingerprint);
    billingInput = input;
    return { invoiceId: brandedId<"InvoiceId">("fixture-invoice"), status: "created" as const, synchronizationVersion: "1" };
  } },
  routing: { async instantiateRoute() { throw Error("No-route product must not instantiate Routing work."); } },
} as unknown as OrderTransaction;
const quotes = new QuoteApplicationService({ transaction: async (work) => work(quoteTx) });
const orders = new OrderApplicationService({ transaction: async (work) => work(orderTx) });
const inputs = { lines: [{ productId: product, quantity: 2 }] };
const reference = (contact: string, customerId?: typeof account): CustomerContactReference => ({ organizationId: org, contactId: brandedId<"ContactId">(contact), ...(customerId ? { customerId } : {}) });
const reset = () => { quoteInput = undefined; orderInput = undefined; billingInput = undefined; allocations = 0; baseCalls = 0; customerPricingCalls.length = 0; };
let cases = 0;
const check = async (name: string, work: () => Promise<void>) => { reset(); await work(); cases++; console.log(`PASS ${name}`); };
try {
  await check("real Quote creation preserves contact-only identity and does not import account terms", async () => {
    for (const id of [contactId, "linked", "standalone"]) {
      const customerContact = reference(id);
      const request = `quote-${id}`;
      const created = await quotes.create(context(request), { businessRequestId: request, customerContact, ...inputs });
      assert.ok(created.ok, !created.ok ? created.error.message : "");
      assert.deepEqual(created.value.quote.quote.customerContact, customerContact);
      assert.deepEqual(quoteInput?.customerContact, customerContact); assert.deepEqual(quoteInput?.terms, {});
      assert.equal(quoteInput?.lines[0].calculatedLineAmount.cents, 250);
      assert.equal(Object.hasOwn(quoteInput!.customerContact, "customerId"), false);
    }
    assert.equal(baseCalls, 3); assert.deepEqual(customerPricingCalls, []);
  });
  await check("real Order creation and Billing request preserve contact identity with base pricing", async () => {
    for (const id of [contactId, "linked", "standalone"]) {
      const customerContact = reference(id), request = `contact-only-order-${id}`;
      const created = await orders.create(context(request), { businessRequestId: request, customerContact, ...inputs });
      assert.ok(created.ok, !created.ok ? created.error.message : "");
      assert.deepEqual(created.value.order.order.customerContact, customerContact);
      assert.deepEqual(orderInput?.customerContact, customerContact); assert.deepEqual(billingInput?.customerContact, customerContact);
      assert.deepEqual(orderInput?.terms, {}); assert.equal(billingInput?.termsCode, undefined);
      assert.equal(orderInput?.lines[0].calculatedLineAmount.cents, 250);
      assert.equal(Object.hasOwn(billingInput!.customerContact, "customerId"), false);
    }
    assert.equal(baseCalls, 3); assert.deepEqual(customerPricingCalls, []);
  });
  await check("explicit Customer keeps canonical customer-aware price and commercial defaults; Quote stays base", async () => {
    const customerContact = reference("linked", account), request = "customer-order";
    const created = await orders.create(context(request), { businessRequestId: request, customerContact, ...inputs });
    assert.ok(created.ok, !created.ok ? created.error.message : "");
    assert.deepEqual(customerPricingCalls, [account]); assert.equal(baseCalls, 0);
    assert.equal(orderInput?.lines[0].calculatedLineAmount.cents, 650);
    assert.equal(orderInput?.lines[0].pricingResult.customerPricing?.agreementId, "account-agreement");
    assert.deepEqual(orderInput?.terms, { termsCode: "net_30" }); assert.equal(billingInput?.termsCode, "net_30");
    const quote = await quotes.create(context("customer-quote"), { businessRequestId: "customer-quote", customerContact, ...inputs });
    assert.ok(quote.ok); assert.equal(quoteInput?.lines[0].calculatedLineAmount.cents, 250); assert.equal(baseCalls, 1);
    assert.deepEqual(quoteInput?.terms, { termsCode: "net_30" });
  });
  await check("existing optional getContact pricing fallback never rewrites a contact-only reference", async () => {
    const customerContact = reference(contactId);
    const mappedCustomers: CustomersReadPort = {
      getCustomer: customers.getCustomer.bind(customers), validateContactReference: customers.validateContactReference.bind(customers),
      getPresentationIdentity: customers.getPresentationIdentity.bind(customers), getCommercialPolicy: customers.getCommercialPolicy.bind(customers),
      getContact: async (organizationId, id) => { const found = await customers.getContact(organizationId, id); return found ? { ...found, customerId: account } : null; },
    };
    const mappedOrders = new OrderApplicationService({ transaction: async (work) => work({ ...orderTx, customers: mappedCustomers }) });
    const created = await mappedOrders.create(context("existing-fallback"), { businessRequestId: "existing-fallback", customerContact, ...inputs });
    assert.ok(created.ok); assert.deepEqual(customerPricingCalls, [account]); assert.equal(orderInput?.lines[0].calculatedLineAmount.cents, 650);
    assert.deepEqual(orderInput?.customerContact, customerContact); assert.deepEqual(billingInput?.customerContact, customerContact);
    assert.deepEqual(orderInput?.terms, {}, "pricing fallback must not infer Customer terms or identity");
    const baseOrders = new OrderApplicationService({ transaction: async (work) => work({ ...orderTx, customerPricing: undefined }) });
    const base = await baseOrders.create(context("no-customer-pricing-port"), { businessRequestId: "no-customer-pricing-port", customerContact: reference(contactId, account), ...inputs });
    assert.ok(base.ok); assert.equal(orderInput?.lines[0].calculatedLineAmount.cents, 250);
  });
  await check("real Quote/Order reject foreign, stale and incompatible contacts before canonical allocation", async () => {
    const selected = await lookup.lookupActiveContacts(org, { customerId: account, selectedContactId: contactId });
    assert.equal(selected.selectedContact?.id, contactId);
    await db.query("UPDATE customer_contact_links SET status='former' WHERE id='direct-link'");
    const invalid = [reference(contactId, account), reference(contactId, otherAccount), reference(contactId, brandedId<"CustomerId">("foreign-account")), reference("archived"), reference("foreign"), reference("missing"), { organizationId: otherOrg, contactId }];
    for (const [index, customerContact] of invalid.entries()) {
      const request = `invalid-${index}`;
      for (const service of [quotes, orders]) {
        const created = await service.create(context(request), { businessRequestId: request, customerContact, ...inputs });
        assert.equal(created.ok, false);
        if (!created.ok) assert.equal(created.error.code, service === quotes && customerContact.organizationId !== org ? "WRONG_TENANT" : "NOT_FOUND");
      }
    }
    assert.equal(allocations, 0); assert.equal(quoteInput, undefined); assert.equal(orderInput, undefined); assert.equal(billingInput, undefined); assert.equal(baseCalls, 0);
    await db.query("UPDATE customer_contacts SET status='archived' WHERE id=$1", [contactId]);
    const stale = await orders.create(context("stale-after-lookup"), { businessRequestId: "stale-after-lookup", customerContact: reference(contactId), ...inputs });
    assert.equal(stale.ok, false); assert.equal(allocations, 0);
  });
  await check("actual Billing Payment aggregate refuses a contact-only Invoice without creating an account", async () => {
    // This is an existing unsupported downstream case, not a new Customer rule.
    const invoiceId = brandedId<"InvoiceId">("contact-only-invoice");
    let mutations = 0;
    const paymentTx = { async lockInvoices() { return [{ invoiceId, currency: usd, totalCents: 250, lifecycle: "draft" as const }]; },
      async reserve() { mutations++; throw Error("An unsupported aggregate must not reserve or record."); },
      async recordPaymentAggregate() { mutations++; throw Error("No account should be silently created."); },
    } as unknown as BillingFinancialTransaction;
    const payments = new BillingPaymentsApplicationService({ transaction: async (work) => work(paymentTx) });
    const refused = await payments.recordManualPaymentAllocations(context("unsupported-contact-aggregate"), { organizationId: org, businessRequestId: brandedId<"BusinessRequestId">("unsupported-contact-aggregate"), allocations: [{ invoiceId, amount: money(usd, 250) }], method: "cash", occurredAt: "2026-10-01T00:00:00.000Z" });
    assert.equal(refused.ok, false);
    if (!refused.ok) { assert.equal(refused.error.code, "CONFLICT"); assert.match(refused.error.message, /one Customer account/); }
    assert.equal(mutations, 0);
  });
  console.log(`Canonical contact-only Sales characterization: ${cases} cases passed. Billing persistence, providers and Portal lifecycle are not exercised.`);
} finally {
  await db.close();
}
