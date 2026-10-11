import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import type { PoolClient } from "pg";
import type { OperationContext } from "../../src/application/operation.js";
import { createSalesWorkspaceRouter, type SalesWorkspaceHttpDependencies } from "../../src/interfaces/http/salesWorkspaceRoutes.js";
import { readWorkspaceOrderTotals } from "../../src/modules/sales/workspaceTotals.js";
import type { SalesWorkspace, SalesWorkspaceStore, SalesWorkspaceTransaction } from "../../src/modules/sales/workspaceContracts.js";
import { PostgresWorkspaceLinePricing } from "../../infrastructure/sales/postgresWorkspaceLinePricing.js";
import { composePostgresSalesTax } from "../../infrastructure/sales/postgresSalesTaxComposition.js";
import { V2PricingParityAdapter } from "../../src/modules/pricing/v2PricingAdapter.js";
import { brandedId, currencyCode } from "../../src/modules/shared/commercialValues.js";
import { createSalesWorkspaceClient } from "../../ui/src/salesWorkspaceApi.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const org = brandedId<"OrganizationId">(id(1));
const customerId = brandedId<"CustomerId">(id(4));
const context: OperationContext = { organizationId: org, operationId: "totals-test", principal: {
  kind: "staff", organizationId: org, userId: id(2), authority: { membershipId: id(3), capabilities: ["order.create", "order.overridePrice"] },
} };
const currency = currencyCode("USD");
const sql: string[] = [];
let unresolved = false, exempt = false, taxable = true, unitCents = 250;
const client = { query: async (text: string) => {
  sql.push(text);
  assert.match(text, /^SELECT /);
  if (text.includes("v2_sales_tax_jurisdictions")) return { rows: unresolved ? [] : [{ id: "home", name: "Home", country_code: "US", region_code: "CA", rate_basis_points: 1000, active: true, home_business: true }] };
  assert.match(text, /FROM customers/);
  return { rows: [{ is_tax_exempt: exempt }] };
} } as unknown as PoolClient;
const pricing = new PostgresWorkspaceLinePricing(client, {
  pricing: new V2PricingParityAdapter(),
  customerPricing: { calculateForCustomer: async (_customerId, input) => new V2PricingParityAdapter().calculate({ ...input, rules: { base: { perPieceCents: unitCents } } }) },
  customers: { validateContactReference: async () => true, getContact: async () => ({ id: brandedId<"ContactId">(id(9)), customerId, displayName: "Contact" }) },
  products: { resolveActivePricingInput: async input => ({ ok: true, value: {
    sellableProduct: { organizationId: org, productId: input.productId, displayName: "Sign", lifecycle: "active", requiresDimensions: false, pricingCurrency: currency,
      pricingConfiguration: { id: brandedId<"PricingConfigurationId">(id(8)), version: "1", contentHash: "hash" } },
    resolvedConfiguration: { schemaVersion: 1, organizationId: org, productId: input.productId,
      pricingConfigurationId: brandedId<"PricingConfigurationId">(id(8)), pricingConfigurationVersion: "1", pricingConfigurationContentHash: "hash", quantity: input.quantity, selections: {}, derivedFacts: {}, productFacts: {} },
    rules: { base: { perPieceCents: 100 } }, warnings: [],
  } }) },
});
let workspace: SalesWorkspace = { id: id(6), organizationId: org, creatorUserId: id(2), kind: "new_sales", state: "draft", revision: 3,
  header: { customerContact: { organizationId: org, customerId } }, lines: [],
  createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z" };
const input = { productId: id(5), quantity: 2 };
workspace = { ...workspace, lines: [{ id: id(7), workspaceId: workspace.id, position: 0, revision: 1, input,
  previews: await pricing.preview(context, workspace.header, input) }] };
// Every undeclared persistence operation fails closed, including locks and writes.
const tx = new Proxy({ get: async (organizationId: string, creator: string, workspaceId: string, lock?: boolean) => {
  assert.equal(lock, false);
  return organizationId === workspace.organizationId && creator === workspace.creatorUserId && workspaceId === workspace.id ? structuredClone(workspace) : null;
} }, { get: (target, key) => key in target ? target[key as keyof typeof target] : key === "getKind" ? undefined : () => { throw new Error(`Unexpected persistence operation ${String(key)}`); } }) as unknown as SalesWorkspaceTransaction;
const store: SalesWorkspaceStore = { run: async action => action(tx), withWorkspace: async () => { throw new Error("Mutation runner forbidden"); } };
const owners = () => ({ pricing, taxability: async () => taxable,
  composeTax: async (current: SalesWorkspace, lines: Parameters<typeof composePostgresSalesTax>[0]["lines"]) => composePostgresSalesTax({ client, organizationId: org, customerId, fulfillment: current.header.requestedFulfillment, lines }) });
const read = (actor = context, revision = workspace.revision) => readWorkspaceOrderTotals(actor, workspace.id, revision, store, owners);
const before = structuredClone(workspace);
const totals = await read();
assert.deepEqual(totals, { workspaceId: workspace.id, workspaceRevision: 3, target: "order", currency: "USD", subtotalCents: 500,
  tax: { status: "resolved", taxCents: 50, totalCents: 550 } });
assert.deepEqual(workspace, before);
assert.equal(workspace.lines[0].previews!.quote!.pricingResult.calculatedLineAmount.cents, 200, "Order review must not use cheaper Quote preview");
taxable = false;
assert.equal((await read()).tax.taxCents, 0);
taxable = true; exempt = true;
assert.equal((await read()).tax.taxCents, 0);
exempt = false; unresolved = true;
assert.deepEqual((await read()).tax, { status: "unresolved", reason: "tax_jurisdiction_not_configured", taxCents: null, totalCents: null });
unresolved = false;
const override = { ...input, selling: { kind: "total_override" as const, totalCents: 700, reason: "Approved selling price" } };
workspace = { ...workspace, lines: [{ ...workspace.lines[0], input: override, previews: await pricing.preview(context, workspace.header, override) }] };
assert.deepEqual((await read()).tax, { status: "resolved", taxCents: 70, totalCents: 770 });
assert.equal((await read()).subtotalCents, 700, "Subtotal uses Sales selling decision, not calculated amount");
workspace = { ...before, header: { ...before.header, requestedFulfillment: { method: "shipping" } } };
assert.deepEqual((await read()).tax, { status: "unresolved", reason: "tax_jurisdiction_not_configured", taxCents: null, totalCents: null });
workspace = before;
unitCents = 300;
await assert.rejects(read(), { code: "CONFLICT" });
unitCents = 250;
await assert.rejects(read(context, 2), { code: "CONFLICT" });
await assert.rejects(read({ ...context, principal: { ...context.principal, userId: id(99) } } as OperationContext), { code: "NOT_FOUND" });
await assert.rejects(read({ ...context, organizationId: id(99) }), { code: "WRONG_TENANT" });
await assert.rejects(read({ ...context, principal: { kind: "staff", organizationId: org, userId: id(2), authority: { membershipId: id(3), capabilities: ["quote.create"] } } }), { code: "FORBIDDEN" });
workspace = { ...workspace, kind: "order_edit" };
await assert.rejects(read({ ...context, principal: { kind: "staff", organizationId: org, userId: id(2), authority: { membershipId: id(3), capabilities: ["order.view", "order.edit"] } } }), { code: "CONFLICT" });
workspace = before;
const savedPreview = workspace.lines[0].previews;
workspace = { ...workspace, lines: [{ ...workspace.lines[0], previews: { quote: savedPreview!.quote } }] };
await assert.rejects(read(), { code: "CONFLICT" });
workspace = before;
let changeDuringTax = false;
const orderTotals = (actor: OperationContext, workspaceId: string, revision: number) => readWorkspaceOrderTotals(actor, workspaceId, revision, store, () => ({ ...owners(),
  composeTax: async (current, lines) => { const tax = await owners().composeTax(current, lines); if (changeDuringTax) workspace = { ...workspace, revision: workspace.revision + 1 }; return tax; } }));
changeDuringTax = true;
await assert.rejects(orderTotals(context, workspace.id, 3), { code: "CONFLICT" });
changeDuringTax = false; workspace = before;
const dependencies = { principals: { principal: async () => context.principal }, orderTotals } as SalesWorkspaceHttpDependencies;
const app = express().use(`/v2/organizations/:organizationId/sales-workspaces`, createSalesWorkspaceRouter(dependencies));
const path = `/v2/organizations/${org}/sales-workspaces/${workspace.id}/order-totals`;
const response = await request(app).get(`${path}?expectedRevision=3`).expect(200);
assert.equal(response.headers["cache-control"], "private, no-store");
assert.deepEqual(response.body.data, totals);
for (const query of ["", "?expectedRevision=0", "?expectedRevision=3.2", "?expectedRevision=3&unknown=1"]) await request(app).get(`${path}${query}`).expect(400);
await request(app).get(`${path}?expectedRevision=2`).expect(409);
await request(app).get(path.replace(workspace.id, id(99)) + "?expectedRevision=3").expect(404);
const unavailable = express().use(`/v2/organizations/:organizationId/sales-workspaces`, createSalesWorkspaceRouter({ ...dependencies, orderTotals: undefined }));
await request(unavailable).get(`${path}?expectedRevision=3`).expect(503);
let url = "";
const api = createSalesWorkspaceClient({ request: async <T>(value: string) => { url = value; return totals as T; }, commandHeaders: () => { throw new Error("GET cannot use command transport"); } });
await api.orderTotals!(org, workspace.id, 3);
assert.equal(url, `${path}?expectedRevision=3`);
assert.ok(sql.length > 0);
console.log("Workspace Order totals: canonical target pricing, tax/exemption, stale fencing, read-only owner/HTTP/client contracts passed.");
