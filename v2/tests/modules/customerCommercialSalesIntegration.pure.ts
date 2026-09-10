import assert from "node:assert/strict";
import { AuthorityPolicy } from "../../src/authorization/authorityPolicy.js";
import { CustomerCommercialPricingAdapter, type CustomerCommercialStore } from "../../src/modules/products/customerCommercial.js";
import { V2PricingParityAdapter } from "../../src/modules/pricing/v2PricingAdapter.js";
import { OrderApplicationService, summarizeOrderTotals, type OrderReadModel, type OrderTransaction } from "../../src/modules/sales/orderApplication.js";
import { brandedId, currencyCode, type CustomerId, type OrganizationId, type ProductId } from "../../src/modules/shared/commercialValues.js";
import type { OperationContext } from "../../src/application/operation.js";

const organizationId = brandedId<"OrganizationId">("commercial-order-org");
const customerId = brandedId<"CustomerId">("commercial-customer");
const productId = brandedId<"ProductId">("commercial-product");
const currency = currencyCode("USD");
let activeAgreement = {
  id: "agreement-one", organizationId, customerId, productId, currency,
  mode: "fixed_unit" as const, value: 325, active: true,
  effectiveFrom: "2026-09-07T00:00:00.000Z", createdAt: "2026-09-07T00:00:00.000Z",
};
const store: CustomerCommercialStore = {
  isEntitled: async () => false,
  resolveAgreement: async () => activeAgreement,
  setEntitlement: async (value) => value,
  replaceAgreement: async (value) => ({ ...value, id: "unused", active: true, effectiveFrom: "2026-09-07T00:00:00.000Z", createdAt: "2026-09-07T00:00:00.000Z" }),
  listEntitlements: async () => [],
  listActivePricingAgreements: async () => [],
};
const customerPricing = new CustomerCommercialPricingAdapter(new V2PricingParityAdapter(), store);
let created: any;
let pricingCalls = 0;
const transaction: OrderTransaction = {
  customers: {
    validateContactReference: async () => true,
    getCustomer: async () => null,
    getContact: async () => null,
    getPresentationIdentity: async () => ({}),
  },
  products: {
    resolveActivePricingInput: async (input) => ({ ok: true, value: {
      sellableProduct: { organizationId, productId: input.productId, displayName: "Commercial product", lifecycle: "active", pricingConfiguration: { id: "version-one" as never, version: "1", contentHash: "hash" }, requiresDimensions: false, pricingCurrency: currency },
      resolvedConfiguration: { schemaVersion: 1, organizationId, productId: input.productId, pricingConfigurationId: "version-one" as never, pricingConfigurationVersion: "1", pricingConfigurationContentHash: "hash", quantity: input.quantity, selections: {}, derivedFacts: {}, productFacts: {} },
      rules: { base: { perPieceCents: 100 } },
    } }),
    resolveCurrentTaxability: async () => ({ taxable: false }),
    resolveOrderRoutability: async () => ({ kind: "routable", productName: "Commercial product", routing: { kind: "no_route" } }),
  } as never,
  pricing: { calculate: async () => { throw new Error("base PricingPort must not bypass customer commercial pricing"); } },
  customerPricing: { calculateForCustomer: async (resolvedCustomer, request) => {
    pricingCalls += 1;
    assert.equal(resolvedCustomer, customerId, "Order derives the known Customer for canonical pricing");
    return customerPricing.calculateForCustomer(resolvedCustomer, request);
  } },
  materialRequirements: { freeze: async () => undefined, hasFrozen: async () => false },
  billing: {
    createDraftInvoice: async () => ({ invoiceId: brandedId<"InvoiceId">("draft-invoice"), status: "created", synchronizationVersion: "1" }),
    synchronizeDraftInvoice: async () => ({ invoiceId: brandedId<"InvoiceId">("draft-invoice"), status: "unchanged", synchronizationVersion: "1" }),
    readDraftForOrder: async () => null,
    readInvoiceForOrder: async () => null,
  } as never,
  routing: { instantiateRoute: async () => { throw new Error("no-route product must not instantiate a route"); } } as never,
  reserve: async () => ({ kind: "new", request: { id: "request-one", status: "in_progress", resultJson: null } }),
  succeed: async () => undefined,
  attribute: async () => undefined,
  audit: async () => undefined,
  allocateNumber: async () => ({ kind: "order", core: 1n, display: "ORD-1" }),
  create: async (input) => { created = input; },
  read: async (): Promise<OrderReadModel | null> => created ? {
    order: { orderId: created.orderId, organizationId, customerContact: created.customerContact, currency, terms: created.terms, lines: created.lines, commercialState: "open", billingInvoiceReference: brandedId<"InvoiceId">("draft-invoice") },
    number: created.number,
    revision: "1",
    totals: summarizeOrderTotals(created.lines, currency),
    routes: [],
    completionEligibility: { eligible: false, blockers: [] },
  } : null,
  update: async () => false,
  removeLinesNotIn: async () => undefined,
  hasRoute: async () => false,
  cancellationBlockers: async () => [],
  completionEligibility: async () => ({ eligible: false, blockers: [] }),
  reopen: async () => false,
  complete: async () => false,
  archive: async () => false,
  unarchive: async () => false,
  cancel: async () => false,
};
const context: OperationContext = {
  principal: { kind: "staff", organizationId, userId: "staff-one", authority: { membershipId: "membership-one", capabilities: ["order.create"] } },
  organizationId,
  operationId: "commercial-order-test",
  businessRequest: { id: "commercial-order-request", payloadFingerprint: "test" },
};
const service = new OrderApplicationService({ transaction: async (work) => work(transaction) }, new AuthorityPolicy());
const result = await service.create(context, { businessRequestId: "commercial-order-request", customerContact: { organizationId, customerId }, lines: [{ productId, quantity: 2 }] });
assert.equal(result.ok, true, "staff Order creates through the canonical Sales service");
assert.equal(pricingCalls, 1, "Sales invokes the transaction-scoped customer pricing resolver");
assert.equal(created.lines[0].pricingResult.customerPricing?.agreementId, "agreement-one", "the applied agreement is frozen on the persisted Sales line");
assert.equal(created.lines[0].calculatedLineAmount.cents, 650, "customer agreement controls the frozen commercial amount");
activeAgreement = { ...activeAgreement, id: "agreement-two", value: 450 };
assert.equal(created.lines[0].pricingResult.customerPricing?.agreementId, "agreement-one", "later agreement changes do not reprice an existing Order");
assert.equal(created.lines[0].calculatedLineAmount.cents, 650, "existing Sales evidence stays immutable after agreement replacement");
console.log("Customer commercial Sales integration tests passed.");
