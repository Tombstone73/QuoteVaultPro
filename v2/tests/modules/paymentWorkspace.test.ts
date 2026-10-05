import { describe, expect, jest, test } from "@jest/globals";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SourceTextModule, SyntheticModule, type Module } from "node:vm";
import ts from "typescript";
import type { Pool, PoolClient } from "pg";
import type * as PaymentAdapterExports from "../../infrastructure/billing/postgresBillingPaymentsTransaction.js";
import * as operationRequestExports from "../../infrastructure/persistence/postgresOperationRequests.js";
import * as outboxExports from "../../infrastructure/persistence/postgresOutbox.js";
import * as errorExports from "../../src/errors/applicationError.js";
import * as commercialValueExports from "../../src/modules/shared/commercialValues.js";
import * as reusableTaxEvidenceExports from "../../infrastructure/billing/postgresReusableInvoiceTaxEvidence.js";
import * as pendingProviderPaymentExports from "../../infrastructure/billing/pendingProviderPaymentCents.js";
import * as stripePaymentPolicyExports from "../../src/modules/billing/stripePaymentPolicy.js";
import * as principalExports from "../../src/authorization/principals.js";
import { BillingPaymentsApplicationService, type BillingFinancialTransaction, type BillingFinancialTransactionRunner, type FinancialLockedInvoice } from "../../src/modules/billing/paymentApplication.js";
import { PaymentWorkspaceApplicationService, previewPaymentTender, type PaymentWorkspaceReadPort, type PaymentWorkspaceReadRunner, type PaymentWorkspaceRecordInput } from "../../src/modules/billing/paymentWorkspace.js";
import type { PaymentAggregateFact, RecordManualPaymentAllocationsInput, RecordManualPaymentInput } from "../../src/modules/billing/contracts.js";
import type { OperationContext } from "../../src/application/operation.js";
import type { Capability } from "../../src/authorization/capabilities.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { OrderAutomaticLifecycle } from "../../src/modules/sales/orderAutomaticLifecycle.js";
import { brandedId, currencyCode, money } from "../../src/modules/shared/commercialValues.js";
import { validateReportingWindow, type ReportingWindow } from "../../src/modules/shared/reportingWindow.js";

// External integration ports are explicitly inert; V2 Billing sources stay actual.
const quickBooks = jest.fn(async (client: PoolClient, organizationId: string, kind: string, id: string) => {
  await client.query("INSERT INTO fixture_quickbooks_jobs VALUES($1,$2,$3)", [organizationId, kind, id]);
});
const fakeStripeCalls = { creates: [] as unknown[], retrieves: [] as unknown[], refunds: [] as unknown[] };
class FakeStripeProviderAdapter {
  async createPaymentIntent(input: unknown) { fakeStripeCalls.creates.push(input); return { providerTransactionId: `pi-created-${fakeStripeCalls.creates.length}`, clientSecret: `secret-created-${fakeStripeCalls.creates.length}` }; }
  async retrievePaymentIntent(paymentIntentId: string, stripeAccountId: string) { fakeStripeCalls.retrieves.push({ paymentIntentId, stripeAccountId }); return { clientSecret: `secret-${paymentIntentId}` }; }
  async createRefund(input: unknown) { fakeStripeCalls.refunds.push(input); return { providerTransactionId: `refund-created-${fakeStripeCalls.refunds.length}` }; }
}
type PersistenceHooks = import("../../infrastructure/billing/postgresBillingPaymentsTransaction.js").BillingFinancialPersistenceTestHooks;

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const paymentAdapterPath = fileURLToPath(new URL("../../infrastructure/billing/postgresBillingPaymentsTransaction.ts", import.meta.url));
const stripeInitiationPath = fileURLToPath(new URL("../../infrastructure/billing/stripePaymentInitiation.ts", import.meta.url));
const draftAdapterPath = fileURLToPath(new URL("../../infrastructure/billing/postgresBillingDraftInvoiceTransaction.ts", import.meta.url));
const draftRegressionPath = fileURLToPath(new URL("../infrastructure/billingDraftInvoiceOptionalJson.pure.ts", import.meta.url));
const queueBridge = { enqueueV2QuickBooksAutoSync: quickBooks };
const uuidBridge = { randomUUID };
const draftRegressionDependencies = new Map<string, object>([
  ["node:assert/strict", { default: assert }],
  ["../../src/modules/shared/commercialValues.js", commercialValueExports],
]);
const sources = new Map<string, Readonly<{ identifier: string; dependencies: Map<string, object> }>>([
  ["postgresBillingPaymentsTransaction.ts", { identifier: paymentAdapterPath, dependencies: new Map<string, object>([
    ["node:crypto", uuidBridge],
    ["../persistence/postgresOperationRequests.js", operationRequestExports],
    ["../persistence/postgresOutbox.js", outboxExports],
    ["../../src/modules/shared/commercialValues.js", commercialValueExports],
    ["../accounting/quickBooksBillingQueue.js", queueBridge],
    ["./pendingProviderPaymentCents.js", pendingProviderPaymentExports],
  ]) }],
  ["stripePaymentInitiation.ts", { identifier: stripeInitiationPath, dependencies: new Map<string, object>([
    ["../../src/authorization/principals.js", principalExports],
    ["../../src/errors/applicationError.js", errorExports],
    ["../../src/modules/shared/commercialValues.js", commercialValueExports],
    ["./stripeProviderIngress.js", { V2StripeProviderAdapter: FakeStripeProviderAdapter }],
    ["../../src/modules/billing/stripePaymentPolicy.js", stripePaymentPolicyExports],
  ]) }],
  ["postgresBillingDraftInvoiceTransaction.ts", { identifier: draftAdapterPath, dependencies: new Map<string, object>([
    ["node:crypto", uuidBridge],
    ["../../src/errors/applicationError.js", errorExports],
    ["../../src/modules/shared/commercialValues.js", commercialValueExports],
    ["../accounting/quickBooksBillingQueue.js", queueBridge],
    ["./postgresReusableInvoiceTaxEvidence.js", reusableTaxEvidenceExports],
  ]) }],
  ["billingDraftInvoiceOptionalJson.pure.ts", { identifier: draftRegressionPath, dependencies: draftRegressionDependencies }],
]);
const linked = new Map<string, Module>();
const denyDynamicImport = (): never => { throw new Error("Dynamic fixture imports are forbidden."); };
function denySourceLoadCalls(bytes: string, identifier: string): void {
  const ast = ts.createSourceFile(identifier, bytes, ts.ScriptTarget.ES2022, true);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) denyDynamicImport();
    ts.forEachChild(node, visit);
  };
  visit(ast);
}
function linkFixtureImport(specifier: string, parent: Module): Module {
  const source = [...sources.values()].find((entry) => entry.identifier === parent.identifier);
  if (!source) throw new Error("Unexpected fixture source parent.");
  const exports = source.dependencies.get(specifier);
  if (!specifier.startsWith(".")) {
    // Only the exact builtin exports needed by actual source are bridged.
    if (!exports) throw new Error(`Unexpected external fixture dependency: ${specifier}`);
  }
  const identifier = specifier.startsWith(".") ? path.resolve(path.dirname(parent.identifier), specifier).replace(/\.js$/u, ".ts") : specifier;
  if (specifier.startsWith(".")) {
    const relative = path.relative(workspaceRoot, identifier).replaceAll("\\", "/");
    if (!relative.startsWith("v2/") || relative.startsWith("../") || path.isAbsolute(relative)) throw new Error(`Forbidden V1/outside fixture dependency: ${specifier}`);
  }
  if (!exports) throw new Error(`Unexpected fixture dependency: ${specifier}`);
  if (!linked.has(identifier)) linked.set(identifier, new SyntheticModule(Object.keys(exports), function () {
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
  }, { identifier }));
  return linked.get(identifier)!;
}
async function evaluateActualSource(name: string) {
  const source = sources.get(name);
  if (!source) throw new Error(`Unexpected fixture source: ${name}`);
  const bytes = await readFile(source.identifier, "utf8");
  denySourceLoadCalls(bytes, source.identifier);
  const { outputText } = ts.transpileModule(bytes, { fileName: source.identifier, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  const module = new SourceTextModule(outputText, { identifier: source.identifier, importModuleDynamically: denyDynamicImport });
  // ESM linking validates every named export BEFORE any actual source runs.
  await module.link(linkFixtureImport);
  // Jest itself runs in a VM realm. Node's default SourceTextModule realm is
  // different: its provider DTO literals fail the unchanged strict JSON owner.
  // Execute identical compiler output in the EXISTING Jest context, with only
  // the exact linked namespaces as require ports. Never coerce source results.
  const compiled = ts.transpileModule(bytes, { fileName: source.identifier, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, unknown> = {};
  const localModule = { exports };
  const requireBridge = (specifier: string): object => {
    linkFixtureImport(specifier, module);
    return source.dependencies.get(specifier)!;
  };
  const evaluate = new Function("exports", "module", "require", `return (async () => {\n${compiled}\n})();`);
  await evaluate(exports, localModule, requireBridge);
  return localModule.exports;
}
const { PostgresBillingPaymentsTransactionRunner } = await evaluateActualSource("postgresBillingPaymentsTransaction.ts") as unknown as typeof PaymentAdapterExports;
const StripePaymentInitiation = (await evaluateActualSource("stripePaymentInitiation.ts") as { StripePaymentInitiation: new (pool: unknown, payments: unknown, accounts: unknown) => {
  beginPayment(context: OperationContext, input: Readonly<{ organizationId: string; invoiceId: string; amountCents: number; currency: string; businessRequestId: string }>): Promise<unknown>;
  beginPaymentAggregate(context: OperationContext, input: Readonly<{ organizationId: string; currency: string; allocations: readonly Readonly<{ invoiceId: string; amountCents: number }>[]; businessRequestId: string }>): Promise<unknown>;
  beginRefund(context: OperationContext, input: Readonly<{ organizationId: string; invoiceId: string; paymentId: string; amountCents: number; currency: string; businessRequestId: string }>): Promise<unknown>;
} }).StripePaymentInitiation;
const draftAdapterNamespace = await evaluateActualSource("postgresBillingDraftInvoiceTransaction.ts");
draftRegressionDependencies.set("../../infrastructure/billing/postgresBillingDraftInvoiceTransaction.js", draftAdapterNamespace);

describe("actual Payments fixture has a closed current-context import boundary", () => {
  test.each([
    "../../../server/db.js", "../../../server/services/billing.js", "../../../shared/schema.js", "../../../client/src/App.js",
    "../../../../outside.js", "pg", "dotenv", "dotenv/config", "@neondatabase/serverless", "node:net", "node:http", "node:https", "node:fs",
    "../../src/deployment/server.js", "./unreviewedDependency.js", "../accounting/quickBooksBillingQueue.ts",
  ])("rejects forbidden or unknown dependency before evaluation: %s", async (specifier) => {
    const calls = quickBooks.mock.calls.length;
    const probe = new SourceTextModule(`import ${JSON.stringify(specifier)};`, { identifier: paymentAdapterPath, importModuleDynamically: denyDynamicImport });
    await expect(probe.link(async (specifier,parent)=>linkFixtureImport(specifier,parent))).rejects.toThrow(/Forbidden|Unexpected/);
    expect(probe.status).toBe("errored"); expect(quickBooks.mock.calls).toHaveLength(calls);
  });
  test.each([
    ["../persistence/postgresOperationRequests.js", "UnknownRepository"],
    ["../../src/modules/shared/commercialValues.js", "unknownMoneyAllocator"],
    ["../accounting/quickBooksBillingQueue.js", "recordPaymentAggregate"],
    ["node:crypto", "createHash"],
  ])("rejects unknown or unexposed symbol %s:%s at link time", async (specifier, symbol) => {
    const calls = quickBooks.mock.calls.length;
    const probe = new SourceTextModule(`import { ${symbol} } from ${JSON.stringify(specifier)}; export { ${symbol} };`, { identifier: paymentAdapterPath, importModuleDynamically: denyDynamicImport });
    await expect(probe.link(linkFixtureImport)).rejects.toThrow(/does not provide an export/);
    expect(quickBooks.mock.calls).toHaveLength(calls);
  });
  test("reads only the four exact actual sources and refuses an unreviewed source parent", async () => {
    for (const name of ["../../../server/db.ts", "postgresUnreviewedAdapter.ts", "../infrastructure/stripeProviderIngress.pure.ts"]) await expect(evaluateActualSource(name)).rejects.toThrow("Unexpected fixture source");
    const probe = new SourceTextModule("", { identifier: path.join(workspaceRoot, "v2/unreviewedParent.ts") });
    expect(() => linkFixtureImport("../persistence/postgresOperationRequests.js", probe)).toThrow("Unexpected fixture source parent");
    expect(sources.size).toBe(4);
  });
  test.each(["../../../server/db.js", "dotenv", "../persistence/postgresOperationRequests.js"])("refuses dynamic import, including an otherwise approved bridge: %s", async (specifier) => {
    const calls = quickBooks.mock.calls.length;
    const probe = new SourceTextModule(`await import(${JSON.stringify(specifier)});`, { identifier: paymentAdapterPath, importModuleDynamically: denyDynamicImport });
    await probe.link(linkFixtureImport);
    await expect(probe.evaluate()).rejects.toThrow("Dynamic fixture imports are forbidden");
    expect(quickBooks.mock.calls).toHaveLength(calls);
  });
  test.each([
    "await import('../../../server/db.js');",
    "const later = () => import('../persistence/postgresOperationRequests.js');",
    "const later = (specifier) => import(specifier);",
    "require('../persistence/postgresOperationRequests.js');",
    "const later = (specifier) => require(specifier);",
  ])("refuses source load calls before current-context compilation: %s", (bytes) => {
    expect(() => denySourceLoadCalls(bytes, paymentAdapterPath)).toThrow("Dynamic fixture imports are forbidden");
  });
  test("actual namespace bridges preserve host application-error and Money object identity", async () => {
    const probe = new SourceTextModule(`import { OperationRequestIdempotencyConflictError } from '../persistence/postgresOperationRequests.js';
      import { currencyCode, money } from '../../src/modules/shared/commercialValues.js';
      export { money }; export const amount = money(currencyCode('USD'), 1); export const error = new OperationRequestIdempotencyConflictError();`,
    { identifier: paymentAdapterPath, importModuleDynamically: denyDynamicImport });
    await probe.link(linkFixtureImport); await probe.evaluate();
    const exposed = probe.namespace as Readonly<{ money: typeof money; error: unknown; amount: ReturnType<typeof money> }>;
    expect(exposed.money).toBe(money);
    expect(exposed.error).toBeInstanceOf(V2ApplicationError);
    expect(Object.getPrototypeOf(exposed.amount)).toBe(Object.getPrototypeOf(money(currencyCode("USD"), 1)));
    expect(exposed.amount).toStrictEqual(money(currencyCode("USD"), 1));
  });
});

const usd = currencyCode("USD"), amount = (cents: number) => money(usd, cents);
const context = (id = "request-a", capabilities: readonly Capability[] = ["payment.view", "payment.record", "invoice.view"], userId = "staff-a"): OperationContext => ({ organizationId: "org-a", operationId: "test", principal: { kind: "staff", organizationId: "org-a", userId, authority: { membershipId: userId, capabilities } }, businessRequest: { id, payloadFingerprint: "ignored-wire-fingerprint" } });
const stripeInitiationFixture = (owner: Readonly<{ kind: string; subject: string }>, providerTransactionId: string | null = null, options: Readonly<{ existingRequest?: boolean; amountCents?: number; state?: string }> = {}) => {
  fakeStripeCalls.creates.length = 0; fakeStripeCalls.retrieves.length = 0; fakeStripeCalls.refunds.length = 0;
  const operationRow = { provider_transaction_id: providerTransactionId, stripe_account_id: "acct-a", amount_cents: String(options.amountCents ?? 1500), currency: "USD", reconciliation_state: options.state ?? "uncertain", initiated_principal_kind: owner.kind, initiated_principal_subject: owner.subject };
  const statements: string[] = [];
  const pool = { query: async (sql: string, values: readonly unknown[] = []) => {
    statements.push(sql);
    if (sql.startsWith("SELECT id FROM v2_operation_requests")) return { rows: options.existingRequest ? [{ id: "existing-request" }] : [] };
    if (sql.startsWith("SELECT operation.provider_transaction_id")) return { rows: [{ ...operationRow }] };
    if (sql.startsWith("SELECT provider_transaction_id,stripe_account_id,source FROM v2_billing_payments")) return { rows: [{ provider_transaction_id: "pi-original", stripe_account_id: "acct-a", source: "provider" }] };
    if (sql.startsWith("SELECT provider_operation_id FROM v2_billing_payments")) return { rows: [{ provider_operation_id: "provider-a" }] };
    throw new Error(`Unexpected Stripe initiation fixture SQL: ${sql}`);
  } };
  const operation = { providerOperationId: brandedId<"ProviderFinancialOperationId">("provider-a"), providerIdempotencyKey: "stripe-operation-key" };
  const applicationCalls = { scalarBegin: 0, aggregateBegin: 0, transition: 0 };
  const payments = {
    beginProviderOperation: async () => { applicationCalls.scalarBegin++; return { ok: true as const, value: operation }; },
    beginProviderPaymentAggregate: async (_context: OperationContext, input: Readonly<{ organizationId: string; allocations: readonly Readonly<{ invoiceId: string; amount: ReturnType<typeof amount> }>[] }>) => {
      applicationCalls.aggregateBegin++;
      const allocations = input.allocations.map((allocation) => ({ invoiceId: allocation.invoiceId, amount: allocation.amount }));
      return { ok: true as const, value: { operation: { ...operation, invoiceId: allocations[0]!.invoiceId, kind: "payment" as const, amount: money(allocations[0]!.amount.currency, allocations.reduce((sum, allocation) => sum + allocation.amount.cents, 0)), provider: "stripe", reconciliationState: operationRow.reconciliation_state as "uncertain" | "pending" | "failed" | "succeeded" }, allocations } };
    },
    transitionProviderPaymentIntent: async (_context: OperationContext, input: { providerTransactionId: string | null; state: "pending" | "failed"; stripeAccountId: string }) => {
      applicationCalls.transition++;
      if (operationRow.provider_transaction_id && input.providerTransactionId && operationRow.provider_transaction_id !== input.providerTransactionId) return { ok: false as const, error: new V2ApplicationError("CONFLICT", "provider transaction mismatch") };
      operationRow.provider_transaction_id ??= input.providerTransactionId;
      operationRow.reconciliation_state = input.state;
      return { ok: true as const, value: { ...operation, invoiceId: brandedId<"InvoiceId">("invoice-a"), kind: "payment" as const, amount: amount(1500), provider: "stripe", providerAccountId: input.stripeAccountId, ...(operationRow.provider_transaction_id ? { providerTransactionId: operationRow.provider_transaction_id } : {}), reconciliationState: operationRow.reconciliation_state as "pending" | "uncertain" | "succeeded" | "failed" } };
    },
  };
  const accounts = { requireReadyAccount: async () => ({ accountId: "acct-a" }), assertOperationAccount: async () => {} };
  const service = new StripePaymentInitiation(pool, payments, accounts);
  return { service, statements, operationRow, applicationCalls, stripeCalls: fakeStripeCalls };
};
const input = (id = "request-a"): RecordManualPaymentAllocationsInput => ({ organizationId: brandedId<"OrganizationId">("org-a"), businessRequestId: brandedId<"BusinessRequestId">(id), occurredAt: "2026-10-01T05:00:00.000Z", method: "cash", allocations: [{ invoiceId: brandedId<"InvoiceId">("invoice-b"), amount: amount(3750) }, { invoiceId: brandedId<"InvoiceId">("invoice-a"), amount: amount(5000) }], tender: { tendered: amount(10_000), expectedBalances: [{ invoiceId: brandedId<"InvoiceId">("invoice-a"), collectibleBalance: amount(5000) }, { invoiceId: brandedId<"InvoiceId">("invoice-b"), collectibleBalance: amount(3750) }] } });

describe("Stripe PaymentIntent initiator secret boundary", () => {
  test.each([{ kind: "staff", subject: "staff-b" }, { kind: "portal", subject: "staff-a" }])("rejects a same-organization M0 replay from a different principal identity: %o", async (principal) => {
    const f = stripeInitiationFixture({ kind: "staff", subject: "staff-a" }, "pi-owned");
    const caller = principal.kind === "portal"
      ? { ...context("shared-payment-id"), principal: { kind: "portal" as const, organizationId: "org-a", customerId: "staff-a", subjectId: "staff-a", capabilities: ["payment.record" as const] } } as unknown as OperationContext
      : context("shared-payment-id", ["payment.record"], principal.subject);
    await expect(f.service.beginPayment(caller, { organizationId: "org-a", invoiceId: "invoice-a", amountCents: 1500, currency: "USD", businessRequestId: "shared-payment-id" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.stripeCalls.retrieves).toHaveLength(0);
    expect(f.stripeCalls.creates).toHaveLength(0);
  });

  test("only the exact initiating principal can retrieve the existing secret; new owned intents still create once", async () => {
    const resumed = stripeInitiationFixture({ kind: "staff", subject: "staff-a" }, "pi-owned");
    const result = await resumed.service.beginPayment(context("shared-payment-id", ["payment.record"], "staff-a"), { organizationId: "org-a", invoiceId: "invoice-a", amountCents: 1500, currency: "USD", businessRequestId: "shared-payment-id" });
    expect(result).toMatchObject({ ok: true, value: { providerOperationId: "provider-a", paymentIntentId: "pi-owned", clientSecret: "secret-pi-owned", stripeAccountId: "acct-a" } });
    expect(resumed.stripeCalls.retrieves).toEqual([{ paymentIntentId: "pi-owned", stripeAccountId: "acct-a" }]);

    const created = stripeInitiationFixture({ kind: "staff", subject: "staff-a" });
    const createdResult = await created.service.beginPayment(context("new-payment-id"), { organizationId: "org-a", invoiceId: "invoice-a", amountCents: 1500, currency: "USD", businessRequestId: "new-payment-id" });
    expect(createdResult).toMatchObject({ ok: true, value: { paymentIntentId: "pi-created-1", clientSecret: "secret-pi-created-1" } });
    expect(created.stripeCalls.creates).toHaveLength(1);
    expect(created.stripeCalls.retrieves).toEqual([{ paymentIntentId: "pi-created-1", stripeAccountId: "acct-a" }]);
    expect(created.statements.some((sql) => sql.includes("JOIN v2_operation_requests request"))).toBe(true);
    expect(created.statements.some((sql) => sql.includes("UPDATE v2_billing_provider_financial_operations SET provider_transaction_id"))).toBe(false, "Integrations returns the ephemeral provider identity through the Billing owner rather than writing Billing state");
  });

  test("new subminimum aggregate is rejected before reservation, while exact legacy replays recover or safely fail", async () => {
    const newRequest = stripeInitiationFixture({ kind: "staff", subject: "staff-a" });
    await expect(newRequest.service.beginPaymentAggregate(context("new-subminimum"), { organizationId: "org-a", currency: "USD", allocations: [{ invoiceId: "invoice-a", amountCents: 49 }], businessRequestId: "new-subminimum" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(newRequest.applicationCalls.aggregateBegin).toBe(0, "a new below-minimum request never reaches durable Billing admission");
    expect(newRequest.applicationCalls.transition).toBe(0);
    expect(newRequest.stripeCalls.creates).toHaveLength(0);
    expect(newRequest.stripeCalls.retrieves).toHaveLength(0);

    const existingIntent = stripeInitiationFixture({ kind: "staff", subject: "staff-a" }, "pi-low-existing", { existingRequest: true, amountCents: 49, state: "pending" });
    const resumed = await existingIntent.service.beginPaymentAggregate(context("legacy-subminimum"), { organizationId: "org-a", currency: "USD", allocations: [{ invoiceId: "invoice-a", amountCents: 49 }], businessRequestId: "legacy-subminimum" });
    expect(resumed).toMatchObject({ ok: true, value: { paymentIntentId: "pi-low-existing", clientSecret: "secret-pi-low-existing" } });
    expect(existingIntent.applicationCalls.aggregateBegin).toBe(1, "an existing exact request keeps replay semantics");
    expect(existingIntent.stripeCalls.creates).toHaveLength(0);
    expect(existingIntent.stripeCalls.retrieves).toHaveLength(1, "subminimum policy does not replace an already-created exact PaymentIntent");

    const historicalNoCall = stripeInitiationFixture({ kind: "staff", subject: "staff-a" }, null, { existingRequest: true, amountCents: 49, state: "uncertain" });
    await expect(historicalNoCall.service.beginPaymentAggregate(context("legacy-subminimum-no-provider-call"), { organizationId: "org-a", currency: "USD", allocations: [{ invoiceId: "invoice-a", amountCents: 49 }], businessRequestId: "legacy-subminimum-no-provider-call" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(historicalNoCall.operationRow.reconciliation_state).toBe("failed", "the historical pre-provider rejection releases its Billing reservation through the owner operation");
    expect(historicalNoCall.applicationCalls.transition).toBe(1);
    expect(historicalNoCall.stripeCalls.creates).toHaveLength(0);
    expect(historicalNoCall.stripeCalls.retrieves).toHaveLength(0);
  });

  test("principal mismatch blocks scalar, aggregate, and Refund provider calls", async () => {
    const scalar = stripeInitiationFixture({ kind: "staff", subject: "staff-a" });
    await expect(scalar.service.beginPayment(context("scalar-replay", ["payment.record"], "staff-b"), { organizationId: "org-a", invoiceId: "invoice-a", amountCents: 1500, currency: "USD", businessRequestId: "scalar-replay" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const aggregate = stripeInitiationFixture({ kind: "staff", subject: "staff-a" });
    await expect(aggregate.service.beginPaymentAggregate(context("aggregate-replay", ["payment.record"], "staff-b"), { organizationId: "org-a", currency: "USD", allocations: [{ invoiceId: "invoice-a", amountCents: 750 }, { invoiceId: "invoice-b", amountCents: 750 }], businessRequestId: "aggregate-replay" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const refund = stripeInitiationFixture({ kind: "staff", subject: "staff-a" });
    await expect(refund.service.beginRefund(context("refund-replay", ["refund.issue"], "staff-b"), { organizationId: "org-a", invoiceId: "invoice-a", paymentId: brandedId<"PaymentId">("payment-a"), amountCents: 500, currency: "USD", businessRequestId: "refund-replay" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const f of [scalar, aggregate, refund]) {
      expect(f.stripeCalls.creates).toHaveLength(0);
      expect(f.stripeCalls.retrieves).toHaveLength(0);
      expect(f.stripeCalls.refunds).toHaveLength(0);
    }
  });
});

/** Only transaction persistence is simulated. Every command executes the real canonical Billing operation. */
function fixture() {
  const invoices = new Map<string, FinancialLockedInvoice>([["invoice-a", { invoiceId: brandedId<"InvoiceId">("invoice-a"), currency: "USD", customerId: "customer-a", totalCents: 5000, lifecycle: "draft" }], ["invoice-b", { invoiceId: brandedId<"InvoiceId">("invoice-b"), currency: "USD", customerId: "customer-a", totalCents: 3750, lifecycle: "issued" }]]);
  let paid = new Map<string, number>(), reserved = new Map<string, number>(), providerReservations: { kind: "payment" | "refund"; invoiceId: string; amountCents: number; allocations: readonly { invoiceId: string; amountCents: number }[]; state: "pending" | "uncertain" | "succeeded" | "failed" }[] = [], payments: PaymentAggregateFact[] = [], requests = new Map<string, { fingerprint: string; id: string; result: unknown | null }>();
  let audits: unknown[] = [], attributions = 0, outbox = 0, transactions = 0, providers = 0, failAudit = false;
  const unsupported = async (): Promise<never> => { providers++; throw Error("Unrelated legacy/provider operation is not allowed"); };
  const lockedIds: string[][] = [];
  const settlement: BillingFinancialTransaction["settlement"] = async (_org, invoiceId, currency, gross) => ({ invoiceId, gross: money(currencyCode(currency), gross), successfulPayments: money(currencyCode(currency), paid.get(invoiceId) ?? 0), successfulRefunds: money(currencyCode(currency), 0), collectibleBalance: money(currencyCode(currency), gross - (paid.get(invoiceId) ?? 0)) });
  const recordAggregate: NonNullable<BillingFinancialTransaction["recordPaymentAggregate"]> = async (value) => {
    const aggregate: PaymentAggregateFact = { payment: { paymentId: brandedId<"PaymentId">(`payment-${payments.length}`), invoiceId: value.allocations[0].invoiceId, method: value.method, source: "manual", amount: amount(value.allocations.reduce((sum, allocation) => sum + allocation.amount.cents, 0)), occurredAt: value.occurredAt }, allocations: value.allocations };
    payments.push(aggregate);
    for (const allocation of value.allocations) paid.set(allocation.invoiceId, (paid.get(allocation.invoiceId) ?? 0) + allocation.amount.cents);
    return aggregate;
  };
  const tx = {
    lockInvoice: async (org, id) => { lockedIds.push([id]); return org === "org-a" ? invoices.get(id) ?? null : null; },
    recordPayment: async (value) => (await recordAggregate({ ...value, allocations: [{ invoiceId: value.invoiceId, amount: amount(value.amountCents) }] })).payment,
    recordRefund: unsupported, confirmProviderPayment: unsupported, confirmProviderRefund: unsupported,
    lockInvoices: async (org, ids) => { lockedIds.push([...ids]); return org === "org-a" ? ids.flatMap((id) => invoices.has(id) ? [invoices.get(id)!] : []) : []; },
    settlement,
    pendingProviderPaymentCents: async (_org, invoiceId) => (reserved.get(invoiceId) ?? 0) + providerReservations.filter((operation) => operation.kind === "payment" && (operation.state === "pending" || operation.state === "uncertain")).reduce((sum, operation) => sum + (operation.allocations.length ? operation.allocations.filter((allocation) => allocation.invoiceId === invoiceId).reduce((total, allocation) => total + allocation.amountCents, 0) : operation.invoiceId === invoiceId ? operation.amountCents : 0), 0),
    reserve: async (value) => {
      const key = `${value.organizationId}:${value.operation}:${value.businessRequestId}`, existing = requests.get(key);
      if (existing) {
        if (existing.fingerprint !== value.payloadFingerprint) throw new V2ApplicationError("IDEMPOTENCY_CONFLICT", "Changed input under the existing business request.");
        return { kind: "replay" as const, request: { id: existing.id, resultJson: structuredClone(existing.result) } };
      }
      const saved = { fingerprint: value.payloadFingerprint, id: `operation-${requests.size}`, result: null };
      requests.set(key, saved);
      return { kind: "new" as const, request: { id: saved.id, resultJson: null } };
    },
    recordPaymentAggregate: recordAggregate,
    attribute: async () => { attributions++; }, audit: async (value) => { if (failAudit) throw new Error("Injected audit failure"); audits.push(structuredClone(value)); }, enqueue: async () => { outbox++; },
    succeed: async (_org, id, _type, _resource, result) => { const saved = [...requests.values()].find((value) => value.id === id)!; saved.result = structuredClone(result); },
    beginProvider: async (value) => {
      providers++;
      const operationAmount = money(currencyCode(value.currency), value.amountCents);
      const operation = { providerOperationId: brandedId<"ProviderFinancialOperationId">(`provider-${providers}`), invoiceId: value.invoiceId, kind: value.kind, ...(value.paymentId ? { paymentId: value.paymentId } : {}), amount: operationAmount, provider: value.provider, providerIdempotencyKey: value.providerIdempotencyKey, ...(value.providerAccountId ? { providerAccountId: value.providerAccountId } : {}), reconciliationState: "uncertain" as const };
      providerReservations.push({ kind: value.kind, invoiceId: value.invoiceId, amountCents: value.amountCents, allocations: [], state: "uncertain" });
      return operation;
    },
    beginProviderPaymentAggregate: async (value) => {
      providers++;
      const allocations = value.allocations.map((allocation) => ({ invoiceId: allocation.invoiceId, amountCents: allocation.amount.cents }));
      const operation = { providerOperationId: brandedId<"ProviderFinancialOperationId">(`provider-${providers}`), invoiceId: value.allocations[0]!.invoiceId, kind: "payment" as const, amount: amount(allocations.reduce((sum, allocation) => sum + allocation.amountCents, 0)), provider: value.provider, providerIdempotencyKey: value.providerIdempotencyKey, reconciliationState: "uncertain" as const };
      providerReservations.push({ kind: "payment", invoiceId: operation.invoiceId, amountCents: operation.amount.cents, allocations, state: "uncertain" });
      return { operation, allocations: value.allocations.map((allocation) => ({ invoiceId: allocation.invoiceId, amount: allocation.amount })) };
    },
  } satisfies BillingFinancialTransaction;
  const runner: BillingFinancialTransactionRunner = { async transaction(work) {
    transactions++;
    const before = structuredClone({ paid, reserved, providerReservations, payments, requests, audits, attributions, outbox });
    try { return await work(tx); }
    catch (error) { ({ paid, reserved, providerReservations, payments, requests, audits, attributions, outbox } = before); throw error; }
  } };
  const service = () => new BillingPaymentsApplicationService(runner);
  const record = (ctx: OperationContext, command: RecordManualPaymentAllocationsInput) => service().recordManualPaymentAllocations(ctx, command);
  return { service, record, invoices, lockedIds, balance: (id: string, cents: number) => paid.set(id, cents), reserveProvider: (id: string, cents: number) => reserved.set(id, cents), setProviderState: (index: number, state: "pending" | "uncertain" | "succeeded" | "failed") => { providerReservations[index]!.state = state; }, providerReservations, failAudit: () => { failAudit = true; }, restoreAudit: () => { failAudit = false; }, state: () => ({ paid: Object.fromEntries(paid), reserved: Object.fromEntries(reserved), providerReservations, payments, requests: requests.size, audits, attributions, outbox, transactions, providers }) };
}

function concurrentProviderFixture() {
  const invoices = new Map<string, FinancialLockedInvoice>([["invoice-a", { invoiceId: brandedId<"InvoiceId">("invoice-a"), currency: "USD", customerId: "customer-a", totalCents: 5000, lifecycle: "issued" }], ["invoice-b", { invoiceId: brandedId<"InvoiceId">("invoice-b"), currency: "USD", customerId: "customer-a", totalCents: 3750, lifecycle: "issued" }]]);
  const lockTails = new Map<string, Promise<void>>(), requests = new Map<string, { id: string; fingerprint: string; result: unknown | null }>();
  const providerOperations: { providerOperationId: string; invoiceId: string; amountCents: number; state: string; allocations: readonly { invoiceId: string; amountCents: number }[] }[] = [];
  const lockOrders: string[][] = [], pendingChecks: string[] = [];
  let nextRequest = 0, nextProviderOperation = 0, holdFirstPendingCheck = true;
  let releasePendingCheck!: () => void, signalPendingCheck!: () => void;
  const firstPendingCheck = new Promise<void>((resolve) => { signalPendingCheck = resolve; });
  const pendingCheckGate = new Promise<void>((resolve) => { releasePendingCheck = resolve; });
  const acquire = async (key: string) => {
    const previous = lockTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => wait);
    lockTails.set(key, tail);
    await previous;
    return () => { release(); if (lockTails.get(key) === tail) lockTails.delete(key); };
  };
  const pendingCents = (invoiceId: string) => providerOperations.filter((operation) => operation.state === "pending" || operation.state === "uncertain")
    .reduce((sum, operation) => sum + (operation.allocations.length
      ? operation.allocations.filter((allocation) => allocation.invoiceId === invoiceId).reduce((total, allocation) => total + allocation.amountCents, 0)
      : operation.invoiceId === invoiceId ? operation.amountCents : 0), 0);
  const runner: BillingFinancialTransactionRunner = {
    transaction: async (action) => {
      const releases: (() => void)[] = [], ownRequests: string[] = [], ownOperations: string[] = [];
      const tx = {
        lockInvoice: async (organizationId: string, invoiceId: string) => {
          releases.push(await acquire(`${organizationId}:${invoiceId}`));
          return organizationId === "org-a" ? invoices.get(invoiceId) ?? null : null;
        },
        lockInvoices: async (organizationId: string, invoiceIds: readonly string[]) => {
          const ordered = [...invoiceIds].sort(); lockOrders.push(ordered);
          for (const invoiceId of ordered) releases.push(await acquire(`${organizationId}:${invoiceId}`));
          return organizationId === "org-a" ? ordered.flatMap((invoiceId) => invoices.has(invoiceId) ? [invoices.get(invoiceId)!] : []) : [];
        },
        settlement: async (_organizationId: string, invoiceId: string, currency: string, grossCents: number) => ({ invoiceId, gross: money(currencyCode(currency), grossCents), successfulPayments: money(currencyCode(currency), 0), successfulRefunds: money(currencyCode(currency), 0), collectibleBalance: money(currencyCode(currency), grossCents) }),
        pendingProviderPaymentCents: async (_organizationId: string, invoiceId: string) => {
          pendingChecks.push(invoiceId);
          if (holdFirstPendingCheck) { holdFirstPendingCheck = false; signalPendingCheck(); await pendingCheckGate; }
          return pendingCents(invoiceId);
        },
        reserve: async (input: { organizationId: string; operation: string; businessRequestId: string; payloadFingerprint: string }) => {
          const key = `${input.organizationId}:${input.operation}:${input.businessRequestId}`, existing = requests.get(key);
          if (existing) {
            if (existing.fingerprint !== input.payloadFingerprint) throw new V2ApplicationError("IDEMPOTENCY_CONFLICT", "Stored request differs.");
            return { kind: "replay" as const, request: { id: existing.id, resultJson: existing.result } };
          }
          const request = { id: `request-${++nextRequest}`, fingerprint: input.payloadFingerprint, result: null };
          requests.set(key, request); ownRequests.push(key);
          return { kind: "new" as const, request: { id: request.id, resultJson: null } };
        },
        beginProvider: async (input: Parameters<BillingFinancialTransaction["beginProvider"]>[0]) => {
          const id = `provider-${++nextProviderOperation}`;
          const operationAmount = money(currencyCode(input.currency), input.amountCents);
          providerOperations.push({ providerOperationId: id, invoiceId: input.invoiceId, amountCents: input.amountCents, state: "uncertain", allocations: [] }); ownOperations.push(id);
          return { providerOperationId: brandedId<"ProviderFinancialOperationId">(id), invoiceId: input.invoiceId, kind: input.kind, ...(input.paymentId ? { paymentId: input.paymentId } : {}), amount: operationAmount, provider: input.provider, providerIdempotencyKey: input.providerIdempotencyKey, ...(input.providerAccountId ? { providerAccountId: input.providerAccountId } : {}), reconciliationState: "uncertain" as const };
        },
        beginProviderPaymentAggregate: async (input: Parameters<NonNullable<BillingFinancialTransaction["beginProviderPaymentAggregate"]>>[0]) => {
          const allocations = input.allocations.map((allocation) => ({ invoiceId: allocation.invoiceId, amountCents: allocation.amount.cents }));
          const amountCents = allocations.reduce((sum, allocation) => sum + allocation.amountCents, 0), id = `provider-${++nextProviderOperation}`;
          const first = input.allocations[0]!;
          providerOperations.push({ providerOperationId: id, invoiceId: first.invoiceId, amountCents, state: "uncertain", allocations }); ownOperations.push(id);
          return { operation: { providerOperationId: brandedId<"ProviderFinancialOperationId">(id), invoiceId: first.invoiceId, kind: "payment" as const, amount: money(first.amount.currency, amountCents), provider: input.provider, providerIdempotencyKey: input.providerIdempotencyKey, reconciliationState: "uncertain" as const }, allocations: input.allocations.map((allocation) => ({ invoiceId: allocation.invoiceId, amount: allocation.amount })) };
        },
        attribute: async () => {}, audit: async () => {}, enqueue: async () => {},
        succeed: async (organizationId: string, requestId: string, _type: string, _id: string, value: unknown) => {
          const row = [...requests.entries()].find(([, request]) => request.id === requestId)?.[1];
          if (row) row.result = value;
        },
      } as unknown as BillingFinancialTransaction;
      try { return await action(tx); }
      catch (error) {
        for (const key of ownRequests) requests.delete(key);
        for (const id of ownOperations) { const index = providerOperations.findIndex((operation) => operation.providerOperationId === id); if (index >= 0) providerOperations.splice(index, 1); }
        throw error;
      } finally { for (const release of releases.reverse()) release(); }
    },
  };
  return { service: new BillingPaymentsApplicationService(runner), providerOperations, lockOrders, pendingChecks, firstPendingCheck, releasePendingCheck: () => releasePendingCheck() };
}

describe("Billing-owned tender and canonical recording", () => {
  test("cash 100 for 87.50 records exactly one 87.50 Payment and 12.50 operational change", async () => {
    const f = fixture(), command = input();
    const result = await f.record(context(), command);
    expect(result.ok).toBe(true); if (!result.ok) throw result.error;
    expect(result.value.payment.payment.amount).toEqual(amount(8750));
    expect(result.value.tenderReceipt).toEqual({ selectedBalance: amount(8750), tendered: amount(10_000), applied: amount(8750), changeDue: amount(1250) });
    expect(result.value.settlements.map((entry) => entry.collectibleBalance.cents)).toEqual([0, 0]);
    expect(f.lockedIds).toEqual([["invoice-a", "invoice-b"]]);
    expect(f.state()).toMatchObject({ payments: [result.value.payment], paid: { "invoice-a": 5000, "invoice-b": 3750 }, attributions: 1, outbox: 1, providers: 0 });
    expect(f.state().audits[0]).toMatchObject({ changes: { tenderReceipt: result.value.tenderReceipt } });
    expect(JSON.stringify(result.value)).not.toMatch(/credit|refundId/);
  });
  test("lost response replay after zero balances returns the stored receipt, across Staff actors", async () => {
    const f = fixture(), command = input();
    const first = await f.record(context(), command);
    const retry = await f.record(context("request-a", ["payment.record"], "staff-b"), command);
    expect(retry).toEqual(first);
    expect(f.state().payments).toHaveLength(1); expect(f.state().audits).toHaveLength(1);
    expect(f.state()).toMatchObject({ attributions: 1, outbox: 1, providers: 0 });
  });
  test("changed cash tender under the same request conflicts, even though Applied is identical", async () => {
    const f = fixture(), command = input();
    expect((await f.record(context(), command)).ok).toBe(true);
    const changed = await f.record(context(), { ...command, tender: { ...command.tender!, tendered: amount(11_000) } });
    expect(changed).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect(f.state().payments).toHaveLength(1); expect(f.state().audits).toHaveLength(1);
  });
  test.each(["check", "external", "other"] as const)("%s excess never becomes cash change", async (method) => {
    const f = fixture();
    expect(await f.record(context(), { ...input(), method })).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(f.state()).toMatchObject({ transactions: 0, payments: [], providers: 0 });
    const exact = { ...input(), method, tender: { ...input().tender!, tendered: amount(8750) } };
    const result = await f.record(context(), exact);
    expect(result.ok).toBe(true); if (result.ok) expect(result.value.tenderReceipt?.changeDue.cents).toBe(0);
  });
  test.each([250, -250])("stale collectible balance (%i paid) conflicts atomically without reallocation", async (paid) => {
    const f = fixture(); f.balance("invoice-b", paid);
    const result = await f.record(context(), input());
    expect(result).toMatchObject({ ok: false, error: { code: "STALE_STATE" } });
    expect(f.state()).toMatchObject({ payments: [], requests: 0, audits: [], outbox: 0 });
  });
  test("explicit partial allocations are retained rather than redistributed", async () => {
    const f = fixture(), command = input();
    const result = await f.record(context(), { ...command, allocations: command.allocations.map((entry) => ({ ...entry, amount: amount(1000) })), tender: { ...command.tender!, tendered: amount(2000) } });
    expect(result.ok).toBe(true); if (!result.ok) throw result.error;
    expect(result.value.payment.allocations.map((entry) => entry.amount.cents)).toEqual([1000, 1000]);
    expect(result.value.tenderReceipt?.selectedBalance.cents).toBe(8750);
    expect(result.value.settlements.map((entry) => entry.collectibleBalance.cents)).toEqual([4000, 2750]);
  });
  test("single and aggregate manual Payments reserve pending provider cents without losing cash change", async () => {
    const single = fixture(); single.reserveProvider("invoice-a", 2000);
    const scalarInput: RecordManualPaymentInput = { organizationId: brandedId<"OrganizationId">("org-a"), businessRequestId: brandedId<"BusinessRequestId">("scalar-too-large"), invoiceId: brandedId<"InvoiceId">("invoice-a"), amount: amount(3001), method: "cash", occurredAt: "2026-10-01T05:00:00.000Z" };
    expect(await single.service().recordManualPayment(context("scalar-too-large"), scalarInput)).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    const scalar = await single.service().recordManualPayment(context("scalar-fit"), { ...scalarInput, businessRequestId: brandedId<"BusinessRequestId">("scalar-fit"), amount: amount(3000) });
    expect(scalar).toMatchObject({ ok: true, value: { payment: { amount: { cents: 3000 } }, settlement: { collectibleBalance: { cents: 2000 } } } });

    const aggregate = fixture(); aggregate.reserveProvider("invoice-a", 1000);
    const command = input("aggregate-pending-fit");
    const invoiceBAllocation = command.allocations.find((entry) => entry.invoiceId === "invoice-b")!;
    const tooMuch = await aggregate.record(context("aggregate-pending-too-much"), { ...command, businessRequestId: brandedId<"BusinessRequestId">("aggregate-pending-too-much"), allocations: [{ invoiceId: brandedId<"InvoiceId">("invoice-a"), amount: amount(4001) }, invoiceBAllocation], tender: { ...command.tender!, tendered: amount(8751) } });
    expect(tooMuch).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    const fitted = await aggregate.record(context("aggregate-pending-fit"), { ...command, allocations: [{ invoiceId: brandedId<"InvoiceId">("invoice-a"), amount: amount(4000) }, invoiceBAllocation], tender: { ...command.tender!, tendered: amount(8750) } });
    expect(fitted).toMatchObject({ ok: true, value: { tenderReceipt: { selectedBalance: { cents: 8750 }, tendered: { cents: 8750 }, applied: { cents: 7750 }, changeDue: { cents: 1000 } }, settlements: [{ collectibleBalance: { cents: 1000 } }, { collectibleBalance: { cents: 0 } }] } });
  });
  test("provider gate allows exact replay, blocks overlapping new IDs, releases failed operations, and is not global", async () => {
    const f = fixture();
    const scalar = { organizationId: brandedId<"OrganizationId">("org-a"), invoiceId: brandedId<"InvoiceId">("invoice-a"), kind: "payment" as const, amount: amount(1000), provider: "stripe", providerIdempotencyKey: "provider-a", businessRequestId: brandedId<"BusinessRequestId">("provider-a") };
    const begun = await f.service().beginProviderOperation(context("provider-a"), scalar);
    expect(begun.ok).toBe(true); if (!begun.ok) throw begun.error;
    expect(await f.service().beginProviderOperation(context("provider-a"), scalar)).toEqual(begun);
    expect(f.state().providers).toBe(1, "the exact M0 replay returns before the pending gate");
    const otherScalar = await f.service().beginProviderOperation(context("provider-a-2"), { ...scalar, businessRequestId: brandedId<"BusinessRequestId">("provider-a-2"), providerIdempotencyKey: "provider-a-2" });
    expect(otherScalar).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    const overlappingAggregate = await f.service().beginProviderPaymentAggregate(context("provider-aggregate-overlap"), {
      organizationId: brandedId<"OrganizationId">("org-a"), businessRequestId: brandedId<"BusinessRequestId">("provider-aggregate-overlap"), provider: "stripe", providerIdempotencyKey: "provider-aggregate-overlap",
      allocations: [{ invoiceId: brandedId<"InvoiceId">("invoice-b"), amount: amount(500) }, { invoiceId: brandedId<"InvoiceId">("invoice-a"), amount: amount(500) }],
    });
    expect(overlappingAggregate).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    const disjoint = await f.service().beginProviderPaymentAggregate(context("provider-b"), {
      organizationId: brandedId<"OrganizationId">("org-a"), businessRequestId: brandedId<"BusinessRequestId">("provider-b"), provider: "stripe", providerIdempotencyKey: "provider-b",
      allocations: [{ invoiceId: brandedId<"InvoiceId">("invoice-b"), amount: amount(500) }],
    });
    expect(disjoint.ok).toBe(true, "an unresolved provider intent does not globally disable distinct invoices");
    f.setProviderState(0, "failed");
    const released = await f.service().beginProviderOperation(context("provider-a-3"), { ...scalar, businessRequestId: brandedId<"BusinessRequestId">("provider-a-3"), providerIdempotencyKey: "provider-a-3" });
    expect(released.ok).toBe(true, "a failed terminal operation releases its Invoice reservation");
    expect(f.state().providers).toBe(3);
  });
  test.each([["scalar", "scalar"], ["scalar", "aggregate"], ["aggregate", "scalar"]] as const)("serialized concurrent %s then %s intents cannot reserve the same Invoice twice", async (firstKind, secondKind) => {
    const f = concurrentProviderFixture();
    const begin = (kind: "scalar" | "aggregate", id: string) => kind === "scalar"
      ? f.service.beginProviderOperation(context(id), { organizationId: brandedId<"OrganizationId">("org-a"), invoiceId: brandedId<"InvoiceId">("invoice-a"), kind: "payment", amount: amount(1000), provider: "stripe", providerIdempotencyKey: `stripe-${id}`, businessRequestId: brandedId<"BusinessRequestId">(id) })
      : f.service.beginProviderPaymentAggregate(context(id), { organizationId: brandedId<"OrganizationId">("org-a"), allocations: [{ invoiceId: brandedId<"InvoiceId">("invoice-b"), amount: amount(500) }, { invoiceId: brandedId<"InvoiceId">("invoice-a"), amount: amount(500) }], provider: "stripe", providerIdempotencyKey: `stripe-${id}`, businessRequestId: brandedId<"BusinessRequestId">(id) });
    const first = begin(firstKind, `first-${firstKind}-${secondKind}`);
    await f.firstPendingCheck;
    const second = begin(secondKind, `second-${firstKind}-${secondKind}`);
    assert.equal(f.pendingChecks.length, 1, "the second transaction waits on the same sorted Invoice lock before reading reservations");
    f.releasePendingCheck();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.ok).toBe(true);
    expect(secondResult).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(f.providerOperations).toHaveLength(1);
    expect(f.pendingChecks.filter((invoiceId) => invoiceId === "invoice-a")).toHaveLength(2);
    for (const order of f.lockOrders) expect(order).toEqual([...order].sort());
    const adapter = await readFile(paymentAdapterPath, "utf8");
    expect(adapter).toMatch(/const ids = \[\.\.\.invoiceIds\]\.sort\(\)/u);
    expect(adapter).toMatch(/ORDER BY id FOR UPDATE/u);
  });
  test("default aggregate callers retain their old result and balance cap", async () => {
    const f = fixture(), { tender: _tender, ...command } = input();
    const result = await f.record(context(), command);
    expect(result.ok).toBe(true); if (result.ok) expect(result.value).not.toHaveProperty("tenderReceipt");
    const exceeded = await f.record(context("new-request"), { ...command, businessRequestId: brandedId<"BusinessRequestId">("new-request") });
    expect(exceeded).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(f.state().payments).toHaveLength(1);
  });
  test("audit failure rolls Payment, allocations and request back, then exact retry succeeds", async () => {
    const f = fixture(); f.failAudit();
    expect(await f.record(context(), input())).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(f.state()).toMatchObject({ payments: [], requests: 0, audits: [], paid: {}, outbox: 0, attributions: 0 });
    f.restoreAudit(); expect((await f.record(context(), input())).ok).toBe(true);
    expect(f.state().payments).toHaveLength(1);
  });
  test.each(["customer", "currency", "void", "missing"])("canonical locked %s invariant is retained", async (kind) => {
    const f = fixture(), invoice = f.invoices.get("invoice-b")!;
    if (kind === "missing") f.invoices.delete("invoice-b");
    else f.invoices.set("invoice-b", { ...invoice, ...(kind === "customer" ? { customerId: "other-customer" } : kind === "currency" ? { currency: "EUR" } : { lifecycle: "void" as const }) });
    const result = await f.record(context(), input());
    expect(result.ok).toBe(false); expect(f.state().payments).toHaveLength(0); expect(f.state().requests).toBe(0);
  });
  test("replay still requires fresh payment-record authority", async () => {
    const f = fixture(); await f.record(context(), input());
    expect(await f.record(context("request-a", []), input())).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(f.state().payments).toHaveLength(1);
  });
  test("canonical first success and replay use the declared envelope without changing the stored receipt", async () => {
    const f = fixture();
    const first = await f.service().recordManualPaymentAllocations(context(), input());
    expect(first).toMatchObject({ ok: true, value: { payment: { payment: { paymentId: "payment-0" } }, tenderReceipt: { changeDue: { cents: 1250 } } } });
    const replay = await f.service().recordManualPaymentAllocations(context(), input());
    expect(replay).toEqual(first); expect(f.state().payments).toHaveLength(1);
  });
  test("preview rejects duplicate/missing balances, mixed currency, excess, unsafe cents and allocation bounds", () => {
    const command = input();
    const preview = (allocations = command.allocations, tender = command.tender!) => previewPaymentTender(allocations, command.method, tender);
    expect(() => preview([], { ...command.tender!, expectedBalances: [] })).toThrow();
    expect(() => preview([command.allocations[0], command.allocations[0]])).toThrow();
    expect(() => preview(command.allocations, { ...command.tender!, expectedBalances: [command.tender!.expectedBalances[0], command.tender!.expectedBalances[0]] })).toThrow();
    expect(() => preview(command.allocations, { ...command.tender!, tendered: money(currencyCode("EUR"), 10_000) })).toThrow();
    expect(() => preview(command.allocations.map((entry) => ({ ...entry, amount: amount(10_000) })))).toThrow();
    expect(() => preview(command.allocations, { ...command.tender!, tendered: { currency: usd, cents: 100.1 } })).toThrow();
    expect(() => previewPaymentTender(command.allocations, "card", command.tender!)).toThrow();
    expect(() => preview(command.allocations, { ...command.tender!, tendered: amount(1000) })).toThrow();
    const many = Array.from({ length: 26 }, (_, index) => ({ invoiceId: brandedId<"InvoiceId">(`invoice-${index}`), amount: amount(1) }));
    expect(() => preview(many, { tendered: amount(26), expectedBalances: many.map((entry) => ({ invoiceId: entry.invoiceId, collectibleBalance: entry.amount })) })).toThrow();
  });
});

/** Actual Postgres transaction, recorder, M0 repositories and runner. Only SQL
 * execution/QuickBooks transport are fake; BEGIN/ROLLBACK restore all effects. */
function postgresRecorderFixture(hooks: PersistenceHooks = {}, reconcile?: OrderAutomaticLifecycle["reconcileInvoice"]) {
  type Row = Record<string, unknown>;
  let state = { requests: new Map<string, Row>(), payments: [] as Row[], allocations: [] as Row[], refunds: [] as Row[], refundAllocations: [] as Row[], refundEvidence: [] as Row[], providerOperations: [] as Row[], events: 0, attributions: 0, audits: [] as unknown[], outbox: [] as Row[], quickBooks: [] as unknown[] };
  let snapshot: typeof state | undefined, releases = 0;
  const statements: { sql: string; values: readonly unknown[] }[] = [];
  const fixedNow = new Date("2026-10-01T05:00:00.000Z");
  const client = {
    async query(text: string, values: readonly unknown[] = []) {
      const sql = text.replace(/\s+/g, " ").trim();
      statements.push({ sql, values: structuredClone(values) });
      const result = (rows: Row[] = []) => ({ rows, rowCount: rows.length });
      if (sql === "BEGIN") { expect(snapshot).toBeUndefined(); snapshot = structuredClone(state); return result(); }
      if (sql === "COMMIT") { snapshot = undefined; return result(); }
      if (sql === "ROLLBACK") { if (snapshot) state = snapshot; snapshot = undefined; return result(); }
      if (sql.startsWith("SELECT id,customer_id,currency,total_cents,invoice_state FROM v2_billing_invoices WHERE organization_id=$1 AND id=$2 FOR UPDATE")) {
        const invoiceId = String(values[1]);
        return result(values[0] === "org-a" && (invoiceId === "invoice-a" || invoiceId === "invoice-b")
          ? [{ id: invoiceId, customer_id: "customer-a", currency: "USD", total_cents: invoiceId === "invoice-a" ? "5000" : "3750", invoice_state: invoiceId === "invoice-a" ? "draft" : "issued" }]
          : []);
      }
      if (sql.startsWith("SELECT id,customer_id,currency,total_cents,invoice_state")) {
        expect(values[0]).toBe("org-a");
        return result((values[1] as string[]).map((id) => ({ id, customer_id: "customer-a", currency: "USD", total_cents: id === "invoice-a" ? "5000" : "3750", invoice_state: "draft" })));
      }
      if (sql.startsWith("SELECT COALESCE((SELECT sum(amount_cents)")) {
        const paid = state.allocations.filter((row) => row.organization_id === values[0] && row.invoice_id === values[1]).reduce((sum, row) => sum + Number(row.amount_cents), 0);
        const refunded = state.refundEvidence.filter((row) => row.organization_id === values[0] && row.invoice_id === values[1]).reduce((sum, row) => sum + Number(row.amount_cents), 0);
        return result([{ paid: String(paid), refunded: String(refunded) }]);
      }
      if (sql.startsWith("SELECT COALESCE(SUM(")) {
        const cents = state.providerOperations.filter((row) => row.organization_id === values[0] && row.operation_kind === "payment" && ["pending", "uncertain"].includes(String(row.reconciliation_state)))
          .reduce((sum, row) => {
            const allocations = Array.isArray(row.allocation_intent) ? row.allocation_intent as { invoiceId: string; amountCents: number }[] : [];
            return sum + (allocations.length ? allocations.filter((entry) => entry.invoiceId === values[1]).reduce((total, entry) => total + entry.amountCents, 0)
              : row.invoice_id === values[1] ? Number(row.amount_cents) : 0);
          }, 0);
        return result([{ cents: String(cents) }]);
      }
      if (sql.startsWith("SELECT * FROM v2_operation_requests")) {
        const row = state.requests.get(values.slice(0, 3).join(":"));
        return result(row ? [row] : []);
      }
      if (sql.startsWith("SELECT provider_transaction_id,stripe_account_id,source FROM v2_billing_payments")) return result(state.payments.filter((row) => row.organization_id === values[0] && row.id === values[1] && row.invoice_id === values[2]).map((row) => ({ provider_transaction_id: row.provider_transaction_id, stripe_account_id: row.stripe_account_id, source: row.source })));
      if (sql.startsWith("SELECT provider_operation_id FROM v2_billing_payments")) return result(state.payments.filter((row) => row.organization_id === values[0] && row.id === values[1]).map((row) => ({ provider_operation_id: row.provider_operation_id })));
      if (sql.startsWith("SELECT invoice_id,currency,provider_transaction_id,stripe_account_id,source FROM v2_billing_payments")) return result(state.payments.filter((row) => row.organization_id === values[0] && row.id === values[1] && row.invoice_id === values[2]).map((row) => ({ invoice_id: row.invoice_id, currency: row.currency, provider_transaction_id: row.provider_transaction_id, stripe_account_id: row.stripe_account_id, source: row.source })));
      if (sql.startsWith("SELECT count(*)::text count,min(invoice_id) invoice_id FROM v2_billing_payment_allocations")) {
        const allocations = state.allocations.filter((row) => row.organization_id === values[0] && row.payment_id === values[1]);
        return result([{ count: String(allocations.length), invoice_id: allocations.map((row) => String(row.invoice_id)).sort()[0] ?? null }]);
      }
      if (sql.startsWith("SELECT invoice_id,currency,amount_cents,stripe_account_id FROM v2_billing_payments")) return result(state.payments.filter((row) => row.organization_id === values[0] && row.id === values[1]).map((row) => ({ invoice_id: row.invoice_id, currency: row.currency, amount_cents: String(row.amount_cents), stripe_account_id: row.stripe_account_id })));
      if (sql.startsWith("SELECT amount_cents FROM v2_billing_refund_allocations")) return result(state.refundAllocations.filter((row) => row.organization_id === values[0] && row.payment_id === values[1]).map((row) => ({ amount_cents: String(row.amount_cents) })));
      if (sql.startsWith("SELECT amount_cents FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND payment_id=$2")) return result(state.providerOperations.filter((row) => row.organization_id === values[0] && row.payment_id === values[1] && row.operation_kind === "refund" && ["pending", "uncertain"].includes(String(row.reconciliation_state)) && row.provider_idempotency_key !== values[2]).map((row) => ({ amount_cents: String(row.amount_cents) })));
      if (sql.startsWith("SELECT r.id,r.amount_cents,a.payment_id,r.provider_transaction_id,r.occurred_at")) return result(state.refunds.filter((row) => row.organization_id === values[0] && row.provider_operation_id === values[1]).map((row) => ({ id: row.id, amount_cents: String(row.amount_cents), payment_id: row.payment_id, provider_transaction_id: row.provider_transaction_id, occurred_at: row.occurred_at })));
      if (sql.startsWith("SELECT invoice_id,currency,amount_cents FROM v2_billing_payments")) return result(state.payments.filter((row) => row.organization_id === values[0] && row.id === values[1]).map((row) => ({ invoice_id: row.invoice_id, currency: row.currency, amount_cents: String(row.amount_cents) })));
      if (sql.startsWith("SELECT COALESCE(sum(amount_cents),0)::text amount FROM v2_billing_refund_allocations")) return result([{ amount: String(state.refundAllocations.filter((row) => row.organization_id === values[0] && row.payment_id === values[1]).reduce((sum, row) => sum + Number(row.amount_cents), 0)) }]);
      if (sql.startsWith("INSERT INTO v2_operation_requests")) {
        const row: Row = { id: `operation-${state.requests.size}`, organization_id: values[0], operation: values[1], business_request_id: values[2], payload_fingerprint: values[3], initiated_principal_kind: values[4], initiated_principal_subject: values[5], staff_actor_user_id: values[6], status: "in_progress", result_json: null, created_at: fixedNow, updated_at: fixedNow, completed_at: null };
        state.requests.set(values.slice(0, 3).join(":"), row); return result([row]);
      }
      if (sql.startsWith("UPDATE v2_operation_requests")) {
        const row = [...state.requests.values()].find((entry) => entry.organization_id === values[0] && entry.id === values[1]);
        expect(row?.status).toBe("in_progress");
        Object.assign(row!, { status: "succeeded", result_resource_type: values[2], result_resource_id: values[3], result_json: JSON.parse(String(values[4])), completed_at: fixedNow });
        return result([row!]);
      }
      if (sql.startsWith("INSERT INTO v2_billing_payments(")) {
        const manual = sql.includes("'manual'");
        state.payments.push({ id: values[0], organization_id: values[1], invoice_id: values[2], source: manual ? "manual" : "provider", amount_cents: String(values[manual ? 4 : 3]), currency: values[manual ? 5 : 4], occurred_at: new Date(String(values[manual ? 6 : 8])), ...(manual ? {} : { provider_operation_id: values[5] }) });
        return result();
      }
      if (sql.startsWith("INSERT INTO v2_billing_refunds(")) {
        state.refunds.push({ id: values[0], organization_id: values[1], invoice_id: values[2], source: sql.includes("'provider'") ? "provider" : "manual", amount_cents: Number(values[3]), currency: values[4], provider_operation_id: values[5] ?? null, provider_transaction_id: values[6] ?? null, stripe_account_id: values[7] ?? null, occurred_at: new Date(String(values[8])), principal_kind: values[9], principal_subject: values[10], operation_request_id: values[12] });
        return result();
      }
      if (sql.startsWith("SELECT id FROM v2_billing_payment_allocations WHERE organization_id=$1 AND payment_id=$2 AND invoice_id=$3")) return result(state.allocations.filter((row) => row.organization_id === values[0] && row.payment_id === values[1] && row.invoice_id === values[2]).map((row) => ({ id: row.id })));
      if (sql.startsWith("INSERT INTO v2_billing_refund_allocations")) {
        state.refundAllocations.push({ id: values[0], organization_id: values[1], refund_id: values[2], payment_id: values[3], amount_cents: Number(values[4]) }); return result();
      }
      if (sql.startsWith("INSERT INTO v2_billing_refund_allocation_evidence")) {
        state.refundEvidence.push({ refund_allocation_id: values[0], organization_id: values[1], refund_id: values[2], payment_id: values[3], payment_allocation_id: values[4], invoice_id: values[5], amount_cents: Number(values[6]) }); return result();
      }
      if (sql.startsWith("INSERT INTO v2_billing_payment_allocations(")) {
        state.allocations.push({ id: values[0], organization_id: values[1], payment_id: values[2], invoice_id: values[3], amount_cents: Number(values[4]) }); return result();
      }
      if (sql.startsWith("INSERT INTO fixture_quickbooks_jobs")) { state.quickBooks.push([...values]); return result(); }
      if (sql.startsWith("INSERT INTO v2_principal_attributions")) { state.attributions++; return result(); }
      if (sql.startsWith("INSERT INTO v2_audit_events")) { state.audits.push(JSON.parse(String(values[9]))); return result(); }
      if (sql.startsWith("INSERT INTO v2_outbox_messages")) {
        const row = { id: `outbox-${state.outbox.length}`, organization_id: values[0], event_type: values[1], aggregate_type: values[2], aggregate_id: values[3], idempotency_key: values[4], payload: JSON.parse(String(values[5])), status: "pending", attempt_count: 0, available_at: fixedNow, created_at: fixedNow };
        state.outbox.push(row); return result([row]);
      }
      if (sql.startsWith("INSERT INTO v2_billing_provider_financial_operations")) {
        const row = sql.includes(",allocation_intent)")
          ? { id: values[0], organization_id: values[1], invoice_id: values[2], payment_id: null, operation_kind: "payment", provider: values[3], provider_idempotency_key: values[4], stripe_account_id: values[5], amount_cents: String(values[6]), currency: values[7], operation_request_id: values[8], provider_transaction_id: null, reconciliation_state: "uncertain", allocation_intent: JSON.parse(String(values[9])) }
          : { id: values[0], organization_id: values[1], invoice_id: values[2], payment_id: values[3], operation_kind: values[4], provider: values[5], provider_idempotency_key: values[6], stripe_account_id: values[7], amount_cents: String(values[8]), currency: values[9], operation_request_id: values[10], provider_transaction_id: null, reconciliation_state: "uncertain", allocation_intent: [] };
        state.providerOperations.push(row); return result([row]);
      }
      if (sql.startsWith("SELECT operation.id,operation.invoice_id,operation.payment_id,operation.operation_kind")) {
        const row = state.providerOperations.find((entry) => entry.organization_id === values[0] && entry.id === values[1]);
        const owner = row && [...state.requests.values()].find((entry) => entry.organization_id === row.organization_id && entry.id === row.operation_request_id);
        return result(row && owner ? [{ ...row, initiated_principal_kind: owner.initiated_principal_kind, initiated_principal_subject: owner.initiated_principal_subject }] : []);
      }
      if (sql.startsWith("SELECT operation.provider_transaction_id")) {
        const row = state.providerOperations.find((entry) => entry.organization_id === values[0] && entry.id === values[1]);
        const owner = row && [...state.requests.values()].find((entry) => entry.organization_id === row.organization_id && entry.id === row.operation_request_id);
        return result(row && owner ? [{ ...row, initiated_principal_kind: owner.initiated_principal_kind, initiated_principal_subject: owner.initiated_principal_subject }] : []);
      }
      if (sql.startsWith("SELECT operation.id,operation.invoice_id,operation.operation_kind")) {
        const row = state.providerOperations.find((entry) => entry.organization_id === values[0] && entry.id === values[1]);
        const owner = row && [...state.requests.values()].find((entry) => entry.organization_id === row.organization_id && entry.id === row.operation_request_id);
        return result(row && owner ? [{ ...row, initiated_principal_kind: owner.initiated_principal_kind, initiated_principal_subject: owner.initiated_principal_subject }] : []);
      }
      if (sql.includes("FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND id=$2")) return result(state.providerOperations.filter((row) => row.organization_id === values[0] && row.id === values[1]));
      if (sql.startsWith("SELECT id,occurred_at,amount_cents FROM v2_billing_payments")) return result(state.payments.filter((row) => row.organization_id === values[0] && row.provider_operation_id === values[1]));
      if (sql.startsWith("INSERT INTO v2_billing_provider_events")) { state.events++; return result([{ id: values[0] }]); }
      if (sql.startsWith("UPDATE v2_billing_provider_financial_operations SET provider_transaction_id=COALESCE")) {
        const row = state.providerOperations.find((entry) => entry.organization_id === values[0] && entry.id === values[1]);
        if (row) {
          row.provider_transaction_id ??= values[2];
          row.reconciliation_state = values.length > 3 && values[3] === "failed" ? "failed" : row.reconciliation_state === "uncertain" ? "pending" : row.reconciliation_state;
        }
        return result(row ? [{ provider_transaction_id: row.provider_transaction_id, reconciliation_state: row.reconciliation_state }] : []);
      }
      if (sql.startsWith("UPDATE v2_billing_provider_financial_operations")) {
        const row = state.providerOperations.find((entry) => entry.organization_id === values[0] && entry.id === values[1]);
        Object.assign(row!, { provider_transaction_id: values[2], reconciliation_state: "succeeded" }); return result();
      }
      throw new Error(`Unexpected fixture SQL: ${sql}`);
    },
    release() { releases++; },
  };
  const pgClient = client as unknown as PoolClient;
  const pool = { connect: async () => pgClient } as unknown as Pool;
  const reconciliations: string[] = [];
  const lifecycle: OrderAutomaticLifecycle = { reconcileOrder: async () => { throw Error("Only existing Invoice reconciliation is expected"); }, reconcileInvoice: async (org, id) => { expect(statements.at(-1)?.sql).toBe("COMMIT"); reconciliations.push(`${org}:${id}`); await reconcile?.(org, id); } };
  const seedProviderPayment = (input: Readonly<{ organizationId: string; paymentId: string; invoiceId: string; amountCents: number; paymentTransactionId: string; providerOperationId: string; operationRequestId: string; principalKind: string; principalSubject: string; stripeAccountId: string }>) => {
    state.requests.set(`${input.organizationId}:seed:${input.operationRequestId}`, { id: input.operationRequestId, organization_id: input.organizationId, operation: "billing.provider.payment.begin.v1", business_request_id: input.operationRequestId, payload_fingerprint: "seed", initiated_principal_kind: input.principalKind, initiated_principal_subject: input.principalSubject, status: "succeeded", result_json: null });
    state.providerOperations.push({ id: input.providerOperationId, organization_id: input.organizationId, invoice_id: input.invoiceId, payment_id: null, operation_kind: "payment", provider: "stripe", provider_idempotency_key: `key-${input.providerOperationId}`, stripe_account_id: input.stripeAccountId, amount_cents: String(input.amountCents), currency: "USD", operation_request_id: input.operationRequestId, provider_transaction_id: input.paymentTransactionId, reconciliation_state: "succeeded", allocation_intent: [] });
    state.payments.push({ id: input.paymentId, organization_id: input.organizationId, invoice_id: input.invoiceId, source: "provider", method: "card", amount_cents: input.amountCents, currency: "USD", provider_operation_id: input.providerOperationId, provider_transaction_id: input.paymentTransactionId, stripe_account_id: input.stripeAccountId, occurred_at: new Date("2026-10-01T05:00:00.000Z"), principal_kind: input.principalKind, principal_subject: input.principalSubject });
    state.allocations.push({ id: "payment-allocation-original", organization_id: input.organizationId, payment_id: input.paymentId, invoice_id: input.invoiceId, amount_cents: input.amountCents });
  };
  return { service: new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool, hooks), undefined, lifecycle), client: pgClient, reconciliations, statements, seedProviderPayment, state: () => ({ ...state, releases }) };
}

describe("Stripe operation initiator ownership", () => {
  test("generic same-organization replay cannot retrieve a PaymentIntent secret for a different principal", async () => {
    const f = stripeInitiationFixture({ kind: "staff", subject: "staff-a" }, "pi-owned");
    await expect(f.service.beginPayment(context("same-business-id", ["payment.record"], "staff-b"), { organizationId: "org-a", invoiceId: "invoice-a", amountCents: 1500, currency: "USD", businessRequestId: "same-business-id" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.stripeCalls.retrieves).toHaveLength(0);
    expect(f.stripeCalls.creates).toHaveLength(0);
    expect(f.statements.some((sql) => sql.includes("JOIN v2_operation_requests request"))).toBe(true);
  });

  test("the initiating principal can explicitly retrieve its exact existing client secret", async () => {
    const f = stripeInitiationFixture({ kind: "staff", subject: "staff-a" }, "pi-owned");
    const result = await f.service.beginPayment(context("same-business-id", ["payment.record"], "staff-a"), { organizationId: "org-a", invoiceId: "invoice-a", amountCents: 1500, currency: "USD", businessRequestId: "same-business-id" });
    expect(result).toMatchObject({ ok: true, value: { providerOperationId: "provider-a", paymentIntentId: "pi-owned", clientSecret: "secret-pi-owned", stripeAccountId: "acct-a" } });
    expect(f.stripeCalls.retrieves).toEqual([{ paymentIntentId: "pi-owned", stripeAccountId: "acct-a" }]);
    expect(f.stripeCalls.creates).toHaveLength(0);
  });

  test("owner mismatch on new scalar or aggregate replay rejects before create; Refunds also check before provider calls", async () => {
    const scalar = stripeInitiationFixture({ kind: "staff", subject: "staff-a" });
    await expect(scalar.service.beginPayment(context("shared-payment-id", ["payment.record"], "staff-b"), { organizationId: "org-a", invoiceId: "invoice-a", amountCents: 1500, currency: "USD", businessRequestId: "shared-payment-id" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const aggregate = stripeInitiationFixture({ kind: "staff", subject: "staff-a" });
    await expect(aggregate.service.beginPaymentAggregate(context("shared-aggregate-id", ["payment.record"], "staff-b"), { organizationId: "org-a", currency: "USD", allocations: [{ invoiceId: "invoice-a", amountCents: 750 }, { invoiceId: "invoice-b", amountCents: 750 }], businessRequestId: "shared-aggregate-id" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const refund = stripeInitiationFixture({ kind: "staff", subject: "staff-a" });
    await expect(refund.service.beginRefund(context("shared-refund-id", ["refund.issue"], "staff-b"), { organizationId: "org-a", invoiceId: "invoice-a", paymentId: "payment-a", amountCents: 500, currency: "USD", businessRequestId: "shared-refund-id" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const f of [scalar, aggregate, refund]) {
      expect(f.stripeCalls.creates).toHaveLength(0);
      expect(f.stripeCalls.retrieves).toHaveLength(0);
      expect(f.stripeCalls.refunds).toHaveLength(0);
    }
  });

  test("Billing-owned Stripe Refund binding persists providerRefundID before response and leaves Refund facts webhook-only", async () => {
    fakeStripeCalls.refunds.length = 0;
    const f = postgresRecorderFixture();
    f.seedProviderPayment({ organizationId: "org-a", paymentId: "payment-origin", invoiceId: "invoice-a", amountCents: 3000, paymentTransactionId: "pi-origin", providerOperationId: "provider-payment-origin", operationRequestId: "request-payment-origin", principalKind: "staff", principalSubject: "staff-a", stripeAccountId: "acct-a" });
    const accounts = { assertOperationAccount: async () => {} };
    const stripe = new StripePaymentInitiation(f.client, f.service, accounts);
    const input = { organizationId: "org-a", invoiceId: "invoice-a", paymentId: "payment-origin", amountCents: 500, currency: "USD", businessRequestId: "stripe-refund-original" };
    const initiatingContext = context("stripe-refund-original", ["refund.issue"], "staff-a");

    const initiated = await stripe.beginRefund(initiatingContext, input);
    if (!initiated.ok) throw initiated.error;
    expect(initiated).toMatchObject({ ok: true, value: { refundId: "refund-created-1", confirmed: false } });
    const providerRefund = f.state().providerOperations.find((row) => row.operation_kind === "refund");
    expect(providerRefund).toMatchObject({ payment_id: "payment-origin", invoice_id: "invoice-a", provider_transaction_id: "refund-created-1", stripe_account_id: "acct-a", reconciliation_state: "pending" });
    expect(f.state().refunds).toHaveLength(0, "Stripe initiation binds provider identity only; no Refund/payment fact is created");
    expect(fakeStripeCalls.refunds).toHaveLength(1);

    const replay = await stripe.beginRefund(initiatingContext, input);
    expect(replay).toMatchObject({ ok: true, value: { refundId: "refund-created-1", confirmed: false } });
    expect(fakeStripeCalls.refunds).toHaveLength(1, "same-request replay returns the Billing-bound ID without another Stripe create");
    await expect(stripe.beginRefund(context("stripe-refund-original", ["refund.issue"], "staff-b"), input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fakeStripeCalls.refunds).toHaveLength(1, "a different initiating principal cannot replay the provider Refund");

    const confirmed = await f.service.confirmProviderRefund(context("stripe-refund-event", ["refund.issue"], "staff-a"), { organizationId: brandedId<"OrganizationId">("org-a"), invoiceId: brandedId<"InvoiceId">("invoice-a"), paymentId: brandedId<"PaymentId">("payment-origin"), providerOperationId: brandedId<"ProviderFinancialOperationId">(String(providerRefund!.id)), providerEventId: "stripe-refund-event", providerTransactionId: "refund-created-1", occurredAt: "2026-10-01T06:00:00.000Z", businessRequestId: brandedId<"BusinessRequestId">("stripe-refund-event") });
    expect(confirmed).toMatchObject({ ok: true, value: { source: "provider", providerTransactionId: "refund-created-1" } });
    expect(f.state().refunds).toHaveLength(1, "only the provider-confirmation Billing operation materializes the Refund fact");
    const lateReplay = await stripe.beginRefund(initiatingContext, input);
    expect(lateReplay).toMatchObject({ ok: true, value: { refundId: "refund-created-1", confirmed: true } });
    expect(fakeStripeCalls.refunds).toHaveLength(1);
    expect(f.state().refunds).toHaveLength(1, "late replay preserves canonical owner state");
  });
});

describe("Billing-owned Stripe Refund binding", () => {
  test("initiation durably binds the original providerRefundID without a Refund fact, and webhook success remains canonical", async () => {
    fakeStripeCalls.refunds.length = 0;
    const f = postgresRecorderFixture();
    f.seedProviderPayment({ organizationId: "org-a", paymentId: "payment-origin", invoiceId: "invoice-a", amountCents: 3000, paymentTransactionId: "pi-origin", providerOperationId: "provider-payment-origin", operationRequestId: "request-payment-origin", principalKind: "staff", principalSubject: "staff-a", stripeAccountId: "acct-a" });
    const accounts = { requireReadyAccount: async () => ({ accountId: "acct-a" }), assertOperationAccount: async () => {} };
    const stripe = new StripePaymentInitiation(f.client, f.service, accounts);
    const input = { organizationId: "org-a", invoiceId: "invoice-a", paymentId: "payment-origin", amountCents: 500, currency: "USD", businessRequestId: "refund-request-a" };
    const initiatingContext = context("refund-request-a", ["refund.issue"], "staff-a");

    const initiated = await stripe.beginRefund(initiatingContext, input);
    if (!initiated.ok) throw new Error(`${initiated.error.message}; SQL=${f.statements.slice(-8).map((entry) => entry.sql).join(" | ")}`);
    expect(initiated).toMatchObject({ ok: true, value: { refundId: "refund-created-1", confirmed: false } });
    const operation = f.state().providerOperations.find((row) => row.operation_kind === "refund");
    expect(operation).toMatchObject({ payment_id: "payment-origin", invoice_id: "invoice-a", provider_transaction_id: "refund-created-1", stripe_account_id: "acct-a", reconciliation_state: "pending" });
    expect(f.state().refunds).toHaveLength(0, "initiation only binds provider operation state; it does not materialize a Refund fact");
    expect(fakeStripeCalls.refunds).toHaveLength(1);
    const refundOperationLockIndex = f.statements.findIndex((entry) => entry.sql.startsWith("SELECT operation.id,operation.invoice_id,operation.payment_id,operation.operation_kind"));
    const providerBindingWriteIndex = f.statements.findIndex((entry) => entry.sql.startsWith("UPDATE v2_billing_provider_financial_operations SET provider_transaction_id=COALESCE"));
    if (refundOperationLockIndex < 0) throw new Error(`Refund bind SQL trace: ${JSON.stringify(f.statements.map((entry) => entry.sql))}`);
    const invoiceLockIndex = f.statements.map((entry, index) => entry.sql.startsWith("SELECT id,customer_id,currency,total_cents,invoice_state FROM v2_billing_invoices WHERE organization_id=$1 AND id=$2 FOR UPDATE") ? index : -1).filter((index) => index >= 0 && index < refundOperationLockIndex).at(-1)!;
    const paymentLockIndex = f.statements.map((entry, index) => entry.sql.startsWith("SELECT invoice_id,currency,provider_transaction_id,stripe_account_id,source FROM v2_billing_payments WHERE organization_id=$1 AND id=$2 AND invoice_id=$3 FOR UPDATE") ? index : -1).filter((index) => index >= 0 && index < refundOperationLockIndex).at(-1)!;
    assert.ok(invoiceLockIndex >= 0);
    expect(invoiceLockIndex).toBeLessThan(paymentLockIndex);
    expect(paymentLockIndex).toBeLessThan(refundOperationLockIndex);
    expect(refundOperationLockIndex).toBeLessThan(providerBindingWriteIndex);
    expect(await f.service.bindProviderRefund(initiatingContext, { organizationId: brandedId<"OrganizationId">("org-a"), providerOperationId: brandedId<"ProviderFinancialOperationId">(String(operation!.id)), providerTransactionId: "refund-mismatch", stripeAccountId: "acct-a", paymentId: brandedId<"PaymentId">("payment-origin"), invoiceId: brandedId<"InvoiceId">("invoice-a"), amountCents: 500, currency: "USD" })).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(f.state().providerOperations.find((row) => row.id === operation!.id)?.provider_transaction_id).toBe("refund-created-1", "a different provider ID cannot overwrite the bound Refund operation");

    const replay = await stripe.beginRefund(initiatingContext, input);
    expect(replay).toMatchObject({ ok: true, value: { refundId: "refund-created-1", confirmed: false } });
    expect(fakeStripeCalls.refunds).toHaveLength(1, "same original request replays its Billing-bound ID without another Stripe create");
    await expect(stripe.beginRefund(context("refund-request-a", ["refund.issue"], "staff-b"), input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fakeStripeCalls.refunds).toHaveLength(1, "another principal cannot replay the existing provider Refund");
    expect(f.state().refunds).toHaveLength(0);

    const confirmed = await f.service.confirmProviderRefund(context("refund-webhook-a", ["refund.issue"], "staff-a"), { organizationId: brandedId<"OrganizationId">("org-a"), invoiceId: brandedId<"InvoiceId">("invoice-a"), paymentId: brandedId<"PaymentId">("payment-origin"), providerOperationId: brandedId<"ProviderFinancialOperationId">(String(operation!.id)), providerEventId: "stripe-refund-event-a", providerTransactionId: "refund-created-1", occurredAt: "2026-10-01T06:00:00.000Z", businessRequestId: brandedId<"BusinessRequestId">("refund-webhook-a") });
    expect(confirmed).toMatchObject({ ok: true, value: { source: "provider", providerTransactionId: "refund-created-1" } });
    expect(f.state().refunds).toHaveLength(1, "only the signed provider-confirmation owner operation materializes a Refund fact");
    const lateReplay = await stripe.beginRefund(initiatingContext, input);
    expect(lateReplay).toMatchObject({ ok: true, value: { refundId: "refund-created-1", confirmed: true } });
    expect(fakeStripeCalls.refunds).toHaveLength(1);
    expect(f.state().refunds).toHaveLength(1, "late initiation replay preserves the canonical confirmed Refund");
  });
});

describe("receiver-sensitive actual Postgres Payment owner regressions", () => {
  test("Refund locks sorted Invoice rows before stable allocation/payment rows despite reverse UUID order", async () => {
    const allocationA = "ffffffff-0000-0000-0000-000000000001", allocationB = "00000000-0000-0000-0000-000000000002";
    const calls: { sql: string; values: readonly unknown[] }[] = [];
    const queryClient = { query: async (sql: string, values: readonly unknown[] = []) => {
      calls.push({ sql, values });
      if (sql.startsWith("SELECT a.id payment_allocation_id,a.invoice_id")) return { rows: [
        { payment_allocation_id: allocationA, invoice_id: "invoice-a" },
        { payment_allocation_id: allocationB, invoice_id: "invoice-b" },
      ] };
      if (sql.startsWith("SELECT id,customer_id,currency,total_cents,invoice_state")) return { rows: [
        { id: "invoice-a", customer_id: "customer-a", currency: "USD", total_cents: "1000", invoice_state: "issued" },
        { id: "invoice-b", customer_id: "customer-a", currency: "USD", total_cents: "1000", invoice_state: "issued" },
      ] };
      if (sql.startsWith("SELECT a.id payment_allocation_id,a.payment_id,a.invoice_id")) return { rows: [
        { payment_allocation_id: allocationA, payment_id: "payment-a", invoice_id: "invoice-a", amount_cents: "300", customer_id: "customer-a", currency: "USD", total_cents: "1000", invoice_state: "issued", refunded_cents: "0" },
        { payment_allocation_id: allocationB, payment_id: "payment-a", invoice_id: "invoice-b", amount_cents: "400", customer_id: "customer-a", currency: "USD", total_cents: "1000", invoice_state: "issued", refunded_cents: "0" },
      ] };
      throw new Error(`Unexpected refund-lock fixture SQL: ${sql}`);
    } };
    const adapter = await evaluateActualSource("postgresBillingPaymentsTransaction.ts") as unknown as typeof PaymentAdapterExports;
    const rows = await new adapter.PostgresBillingPaymentsTransaction(queryClient as unknown as PoolClient).lockRefundAllocations({ organizationId: brandedId<"OrganizationId">("org-a"), paymentId: brandedId<"PaymentId">("payment-a"), paymentAllocationIds: [allocationB, allocationA] });
    expect(rows.map((row) => row.invoice.invoiceId)).toEqual(["invoice-a", "invoice-b"]);
    expect(calls).toHaveLength(3);
    expect(calls[0]!.sql).toContain("ORDER BY a.invoice_id,a.id");
    expect(calls[1]!.values[1]).toEqual(["invoice-a", "invoice-b"]);
    expect(calls[1]!.sql).toContain("ORDER BY id FOR UPDATE");
    expect(calls[2]!.sql).toContain("ORDER BY a.invoice_id,a.id FOR UPDATE OF a,p");
    expect(calls[2]!.sql).not.toContain("FOR UPDATE OF a,p,i");
    const refundInvoiceLock = calls[1]!;
    calls.length = 0;
    await new adapter.PostgresBillingPaymentsTransaction(queryClient as unknown as PoolClient).lockInvoices(brandedId<"OrganizationId">("org-a"), [brandedId<"InvoiceId">("invoice-b"), brandedId<"InvoiceId">("invoice-a")]);
    expect(calls[0]).toEqual(refundInvoiceLock, "Refund and provider aggregate acquire Invoice rows through the same sorted owner lock helper");
  });
  test("actual provider allocation DTOs retain the host plain-object identity without result normalization", async () => {
    const f = postgresRecorderFixture();
    const manual = input(), command = { organizationId: manual.organizationId, allocations: manual.allocations, provider: "stripe", providerIdempotencyKey: "provider-request", businessRequestId: brandedId<"BusinessRequestId">("provider-request") };
    const begun = await f.service.beginProviderPaymentAggregate(context("provider-request"), command);
    if (!begun.ok) throw begun.error;
    const adapter = await evaluateActualSource("postgresBillingPaymentsTransaction.ts") as unknown as typeof PaymentAdapterExports;
    const preview = await new adapter.PostgresBillingPaymentsTransaction(f.client).loadProviderPaymentAggregate({ organizationId: manual.organizationId, providerOperationId: begun.value.operation.providerOperationId });
    expect(Object.getPrototypeOf(preview!.allocations[0])).toBe(Object.prototype);
    expect(commercialValueExports.canonicalJson(preview!.allocations)).toBe('[{"amount":{"cents":5000,"currency":"USD"},"invoiceId":"invoice-a"},{"amount":{"cents":3750,"currency":"USD"},"invoiceId":"invoice-b"}]');
  });
  test("Billing-owned intent binding is principal-bound, durable and releases only terminal failed reservations", async () => {
    const f = postgresRecorderFixture();
    const command = { organizationId: brandedId<"OrganizationId">("org-a"), allocations: [{ invoiceId: brandedId<"InvoiceId">("invoice-a"), amount: amount(2000) }], provider: "stripe", providerAccountId: "acct-a", providerIdempotencyKey: "intent-bind-key", businessRequestId: brandedId<"BusinessRequestId">("intent-bind-begin") };
    const begun = await f.service.beginProviderPaymentAggregate(context("intent-bind-begin"), command);
    expect(begun.ok).toBe(true); if (!begun.ok) throw begun.error;
    const intent = { organizationId: command.organizationId, providerOperationId: begun.value.operation.providerOperationId, providerTransactionId: "pi-bound", stripeAccountId: "acct-a", state: "pending" as const, allocations: command.allocations };
    const denied = await f.service.transitionProviderPaymentIntent(context("intent-bind-other", ["payment.record"], "staff-b"), intent);
    expect(denied).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(f.state().providerOperations[0]).toMatchObject({ provider_transaction_id: null, reconciliation_state: "uncertain" });
    const bound = await f.service.transitionProviderPaymentIntent(context("intent-bind-same"), intent);
    expect(bound).toMatchObject({ ok: true, value: { providerTransactionId: "pi-bound", reconciliationState: "pending" } });
    const adapter = await evaluateActualSource("postgresBillingPaymentsTransaction.ts") as unknown as typeof PaymentAdapterExports;
    const tx = new adapter.PostgresBillingPaymentsTransaction(f.client);
    expect(await tx.pendingProviderPaymentCents("org-a", "invoice-a")).toBe(2000);
    const replay = await f.service.transitionProviderPaymentIntent(context("intent-bind-same"), intent);
    expect(replay).toEqual(bound);
    expect(f.state().providerOperations[0]).toMatchObject({ provider_transaction_id: "pi-bound", reconciliation_state: "pending" });

    const failed = await f.service.transitionProviderPaymentIntent(context("intent-bind-failed"), { ...intent, state: "failed" });
    expect(failed).toMatchObject({ ok: true, value: { providerTransactionId: "pi-bound", reconciliationState: "failed" } });
    expect(await tx.pendingProviderPaymentCents("org-a", "invoice-a")).toBe(0);
    const next = await f.service.beginProviderPaymentAggregate(context("intent-after-failure"), { ...command, businessRequestId: brandedId<"BusinessRequestId">("intent-after-failure"), providerIdempotencyKey: "intent-after-failure" });
    expect(next.ok).toBe(true, "terminal failed operation releases its locked Invoice for a new partial attempt");
  });
  test("actual recorder writes one Payment and two allocations; first success and replay reconcile through declared envelopes", async () => {
    const f = postgresRecorderFixture(), command = input();
    const first = await f.service.recordManualPaymentAllocations(context(), command);
    expect(first.ok).toBe(true); if (!first.ok) throw first.error;
    expect(f.state().payments).toHaveLength(1); expect(f.state().allocations).toHaveLength(2);
    expect(f.state().payments[0]).toMatchObject({ source: "manual", amount_cents: "8750", invoice_id: "invoice-a" });
    expect(f.state().allocations.map((row) => [row.invoice_id, row.amount_cents])).toEqual([["invoice-a", 5000], ["invoice-b", 3750]]);
    expect(f.state().quickBooks).toEqual([["org-a", "payment", first.value.payment.payment.paymentId]]);
    expect(quickBooks).toHaveBeenCalledWith(f.client, "org-a", "payment", first.value.payment.payment.paymentId);
    const saved = structuredClone([...f.state().requests.values()][0]!);
    expect(saved.result_json).toEqual(first.value); expect(saved.result_json).not.toHaveProperty("ok");
    const replay = await f.service.recordManualPaymentAllocations(context("request-a", ["payment.record"], "staff-b"), command);
    expect(replay).toEqual(first); expect([...f.state().requests.values()][0]).toEqual(saved);
    expect(f.reconciliations).toEqual(["org-a:invoice-a", "org-a:invoice-b", "org-a:invoice-a", "org-a:invoice-b"]);
    expect(f.state()).toMatchObject({ attributions: 1, events: 0, releases: 2 });
    expect(f.state().payments).toHaveLength(1); expect(f.state().allocations).toHaveLength(2); expect(f.state().audits).toHaveLength(1); expect(f.state().outbox).toHaveLength(1); expect(f.state().quickBooks).toHaveLength(1);
    const revoked = await f.service.recordManualPaymentAllocations(context("request-a", []), command);
    expect(revoked).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } }); expect(f.reconciliations).toHaveLength(4);
    expect(f.statements.at(-1)?.sql).toBe("ROLLBACK");
    const changed = await f.service.recordManualPaymentAllocations(context(), { ...command, tender: { ...command.tender!, tendered: amount(11_000) } });
    expect(changed).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } }); expect(f.state().payments).toHaveLength(1);
  });
  test.each(["afterPayment", "afterAudit", "beforeComplete"] as const)("actual owner failure at %s rolls financial facts and same-client effects back", async (stage) => {
    let fail = true;
    const f = postgresRecorderFixture({ [stage]: async () => { if (fail) throw Error(`Injected ${stage} failure`); } });
    const failed = await f.service.recordManualPaymentAllocations(context(), input());
    expect(failed).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(f.statements.filter((call) => call.sql.startsWith("INSERT INTO v2_billing_payments("))).toHaveLength(1);
    expect(f.statements.filter((call) => call.sql.startsWith("INSERT INTO v2_billing_payment_allocations("))).toHaveLength(2);
    expect(f.statements.at(-1)?.sql).toBe("ROLLBACK");
    expect(f.state()).toMatchObject({ payments: [], allocations: [], audits: [], outbox: [], quickBooks: [], attributions: 0, releases: 1 });
    expect(f.state().requests.size).toBe(0); expect(f.reconciliations).toEqual([]);
    fail = false;
    expect((await f.service.recordManualPaymentAllocations(context(), input())).ok).toBe(true);
    expect(f.state().payments).toHaveLength(1); expect(f.state().allocations).toHaveLength(2);
    expect(f.reconciliations).toEqual(["org-a:invoice-a", "org-a:invoice-b"]);
  });
  test.each(["error", "stale"])("post-commit %s hook failure remains retryable under original identity without duplicate facts", async (kind) => {
    let fail = true;
    const f = postgresRecorderFixture({}, async () => { if (fail) throw kind === "stale" ? new V2ApplicationError("STALE_STATE", "Injected lifecycle failure") : Error("Lost reconciliation response"); });
    const command = input(), failed = await f.service.recordManualPaymentAllocations(context(), command);
    expect(failed).toMatchObject({ ok: false, error: { code: "RETRYABLE_FAILURE" } });
    expect(f.state().payments).toHaveLength(1); expect(f.state().allocations).toHaveLength(2); expect(f.statements.at(-1)?.sql).toBe("COMMIT");
    const saved = structuredClone([...f.state().requests.values()][0]!);
    expect(saved.status).toBe("succeeded"); expect(saved.result_json).toHaveProperty("tenderReceipt.changeDue.cents", 1250);
    expect((await f.service.recordManualPaymentAllocations(context("request-a", []), command)).ok).toBe(false);
    expect(f.reconciliations).toHaveLength(2);
    fail = false;
    const replay = await f.service.recordManualPaymentAllocations(context(), command);
    expect(replay).toEqual({ ok: true, value: saved.result_json }); expect([...f.state().requests.values()][0]).toEqual(saved);
    expect(f.state().payments).toHaveLength(1); expect(f.state().allocations).toHaveLength(2); expect(f.state().audits).toHaveLength(1); expect(f.state().outbox).toHaveLength(1); expect(f.state().quickBooks).toHaveLength(1);
    expect(f.reconciliations).toEqual(["org-a:invoice-a", "org-a:invoice-b", "org-a:invoice-a", "org-a:invoice-b"]);
  });
  test("aggregate provider begin/confirm, replay and hook retry keep declared contracts and receiver-sensitive owner calls", async () => {
    let failLifecycle = false;
    const f = postgresRecorderFixture({}, async () => { if (failLifecycle) throw new V2ApplicationError("STALE_STATE", "Injected provider lifecycle failure"); });
    const manual = input(), command = { organizationId: manual.organizationId, allocations: manual.allocations, provider: "stripe", providerIdempotencyKey: "provider-request", businessRequestId: brandedId<"BusinessRequestId">("provider-request") };
    const begun = await f.service.beginProviderPaymentAggregate(context("provider-request"), command);
    expect(begun.ok).toBe(true); if (!begun.ok) throw begun.error;
    expect(begun.value.operation.amount.cents).toBe(8750); expect(begun.value.allocations).toHaveLength(2); expect(f.reconciliations).toEqual([]);
    expect(await f.service.beginProviderPaymentAggregate(context("provider-request"), command)).toEqual(begun);
    expect(f.state().providerOperations).toHaveLength(1); expect(f.state().payments).toHaveLength(0);
    const confirm = { organizationId: manual.organizationId, providerOperationId: begun.value.operation.providerOperationId, providerEventId: "event-a", providerTransactionId: "intent-a", occurredAt: manual.occurredAt, businessRequestId: brandedId<"BusinessRequestId">("confirm-request") };
    const confirmed = await f.service.confirmProviderPaymentAggregate(context("confirm-request"), confirm);
    expect(confirmed.ok).toBe(true); if (!confirmed.ok) throw confirmed.error;
    expect(confirmed.value.payment).toMatchObject({ source: "provider", amount: amount(8750) });
    expect(await f.service.confirmProviderPaymentAggregate(context("confirm-request"), confirm)).toEqual(confirmed);
    expect(f.state().payments).toHaveLength(1); expect(f.state().allocations).toHaveLength(2); expect(f.state().events).toBe(1);
    expect(f.reconciliations).toEqual(["org-a:invoice-a", "org-a:invoice-b", "org-a:invoice-a", "org-a:invoice-b"]);
    const saved = structuredClone([...f.state().requests.values()].find((row) => row.business_request_id === "confirm-request")!);
    failLifecycle = true;
    expect(await f.service.confirmProviderPaymentAggregate(context("confirm-request"), confirm)).toMatchObject({ ok: false, error: { code: "RETRYABLE_FAILURE" } });
    failLifecycle = false;
    expect(await f.service.confirmProviderPaymentAggregate(context("confirm-request"), confirm)).toEqual(confirmed);
    expect([...f.state().requests.values()].find((row) => row.business_request_id === "confirm-request")).toEqual(saved);
    expect(f.state().payments).toHaveLength(1); expect(f.state().allocations).toHaveLength(2); expect(f.state().events).toBe(1); expect(f.state().quickBooks).toHaveLength(1);
    expect(f.reconciliations).toHaveLength(8);
  });
  test("pending reservation blocks manual overlap; confirmed Payment remains canonical and permits a later partial intent", async () => {
    const f = postgresRecorderFixture();
    const firstCommand = { organizationId: brandedId<"OrganizationId">("org-a"), allocations: [{ invoiceId: brandedId<"InvoiceId">("invoice-a"), amount: amount(2000) }], provider: "stripe", providerIdempotencyKey: "partial-card-a", businessRequestId: brandedId<"BusinessRequestId">("partial-card-a") };
    const first = await f.service.beginProviderPaymentAggregate(context("partial-card-a"), firstCommand);
    expect(first.ok).toBe(true); if (!first.ok) throw first.error;
    const overlap = await f.service.beginProviderPaymentAggregate(context("partial-card-overlap"), { ...firstCommand, allocations: [{ invoiceId: brandedId<"InvoiceId">("invoice-a"), amount: amount(500) }], providerIdempotencyKey: "partial-card-overlap", businessRequestId: brandedId<"BusinessRequestId">("partial-card-overlap") });
    expect(overlap).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    const manual = input("manual-overlap");
    const manualOverlap = await f.service.recordManualPaymentAllocations(context("manual-overlap"), { ...manual, allocations: [{ invoiceId: brandedId<"InvoiceId">("invoice-a"), amount: amount(4000) }], tender: { tendered: amount(4000), expectedBalances: [{ invoiceId: brandedId<"InvoiceId">("invoice-a"), collectibleBalance: amount(5000) }] } });
    expect(manualOverlap).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(f.state().payments).toHaveLength(0);

    const confirmed = await f.service.confirmProviderPaymentAggregate(context("partial-card-confirm"), { organizationId: firstCommand.organizationId, providerOperationId: first.value.operation.providerOperationId, providerEventId: "partial-card-event", providerTransactionId: "pi-partial-a", occurredAt: "2026-10-01T05:00:00.000Z", businessRequestId: brandedId<"BusinessRequestId">("partial-card-confirm") });
    expect(confirmed.ok).toBe(true); if (!confirmed.ok) throw confirmed.error;
    expect(confirmed.value.payment).toMatchObject({ source: "provider", amount: { cents: 2000 } });
    expect(confirmed.value.allocations).toEqual([{ invoiceId: "invoice-a", amount: amount(2000) }]);
    expect(f.state().payments).toHaveLength(1); expect(f.state().allocations).toEqual(expect.arrayContaining([expect.objectContaining({ invoice_id: "invoice-a", amount_cents: 2000 })]));
    expect(f.state().providerOperations[0]).toMatchObject({ reconciliation_state: "succeeded", provider_transaction_id: "pi-partial-a" });

    const manualAfterConfirm = await f.service.recordManualPaymentAllocations(context("manual-after-card"), {
      organizationId: brandedId<"OrganizationId">("org-a"), businessRequestId: brandedId<"BusinessRequestId">("manual-after-card"), method: "cash", occurredAt: "2026-10-01T06:00:00.000Z",
      allocations: [{ invoiceId: brandedId<"InvoiceId">("invoice-a"), amount: amount(1000) }],
      tender: { tendered: amount(1000), expectedBalances: [{ invoiceId: brandedId<"InvoiceId">("invoice-a"), collectibleBalance: amount(3000) }] },
    });
    expect(manualAfterConfirm.ok).toBe(true);
    const nextPartial = await f.service.beginProviderPaymentAggregate(context("next-partial-card"), { ...firstCommand, allocations: [{ invoiceId: brandedId<"InvoiceId">("invoice-a"), amount: amount(1500) }], providerIdempotencyKey: "next-partial-card", businessRequestId: brandedId<"BusinessRequestId">("next-partial-card") });
    expect(nextPartial.ok).toBe(true, "terminal success releases the pending reservation but the canonical Payment still reduces the Invoice balance");
    expect(f.state().payments).toHaveLength(2);
    expect(f.state().providerOperations).toHaveLength(2);
    expect(f.state().providerOperations[0]).toMatchObject({ reconciliation_state: "succeeded", amount_cents: "2000" });
    expect(f.state().providerOperations[1]).toMatchObject({ reconciliation_state: "uncertain", amount_cents: "1500" });
  });
  test("existing Billing draft Invoice regression runs unchanged under the explicit QuickBooks seam", async () => {
    await evaluateActualSource("billingDraftInvoiceOptionalJson.pure.ts");
  });
});

describe("Staff payment workspace authority and server reporting clock", () => {
  const window: ReportingWindow = { asOf: "2026-10-01T05:00:00.000Z", timeZone: "UTC", timeZoneSource: "default_utc", startInclusive: "2026-10-01T00:00:00.000Z", endExclusive: "2026-10-02T00:00:00.000Z", todayDate: "2026-10-01", tomorrowDate: "2026-10-02" };
  function workspace() {
    const calls: { name: string; args: unknown[] }[] = [], canonical = fixture();
    const port: PaymentWorkspaceReadPort = {
      readWindow: async (...args) => { calls.push({ name: "window", args }); return window; },
      pagePayments: async (...args) => { calls.push({ name: "page", args }); return { scope: "v2_payment_facts", window: args[2], summary: { paymentCount: 0, byCurrency: [] }, items: [], page: 1, pageSize: 25, totalMatching: 0, hasNextPage: false }; },
      summarizePayments: async (...args) => { calls.push({ name: "summary", args }); return { scope: "v2_payment_facts", window: args[2], summary: { paymentCount: 0, byCurrency: [] } }; },
      listCustomers: async () => [], pageCollectibleInvoices: async (...args) => { calls.push({ name: "invoices", args }); return { items: [], page: 1, pageSize: 25, hasNextPage: false }; },
    };
    const runner: PaymentWorkspaceReadRunner = { read: async (action) => action(port) };
    return { service: new PaymentWorkspaceApplicationService(runner, canonical.service(), undefined, () => new Date(window.asOf)), calls, canonical };
  }
  test("list and Dashboard summary pass the same server-captured window and filters", async () => {
    const f = workspace(), query = { period: "month" as const, method: "cash" as const, customerId: "customer-a" };
    const page = await f.service.page(context(), query), summary = await f.service.summary(context(), query);
    expect(page.ok && summary.ok && page.value.window === summary.value.window).toBe(true);
    expect(f.calls.filter((call) => call.name === "window").map((call) => call.args)).toEqual([["org-a", query, new Date(window.asOf)], ["org-a", query, new Date(window.asOf)]]);
    expect(f.calls.filter((call) => call.name !== "window").map((call) => call.args)).toEqual([["org-a", query, window], ["org-a", query, window]]);
  });
  test("no workspace reads for missing capability, Portal, Service or foreign tenant", async () => {
    const f = workspace();
    const denied = [context("request-a", []), { ...context(), organizationId: "org-b" }, { ...context(), principal: { kind: "service" as const, organizationId: "org-a", clientId: "svc", capabilities: ["payment.view" as const] } }, { ...context(), principal: { kind: "portal" as const, organizationId: "org-a", customerId: "customer-a", subjectId: "portal-a", capabilities: ["payment.view" as const] } }];
    for (const ctx of denied) expect((await f.service.page(ctx, { period: "today" })).ok).toBe(false);
    expect(f.calls).toEqual([]);
  });
  test("picker and command need BOTH invoice-view and payment-record authority", async () => {
    const f = workspace(), { organizationId: _org, ...command } = input();
    for (const caps of [["invoice.view"], ["payment.record"]] as readonly (readonly Capability[])[]) {
      expect(await f.service.invoices(context("request-a", caps), { customerId: "customer-a" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
      expect(await f.service.record(context("request-a", caps), command as PaymentWorkspaceRecordInput)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    }
    expect(f.calls).toEqual([]); expect(f.canonical.state().transactions).toBe(0);
    expect((await f.service.record(context(), command as PaymentWorkspaceRecordInput)).ok).toBe(true);
  });
  test("invalid windows and bounded pagination fail before reading", async () => {
    const f = workspace();
    for (const query of [{ period: "custom" as const, fromDate: "2026-02-30", toDate: "2026-03-01" }, { period: "today" as const, page: 0 }, { period: "month" as const, pageSize: 101 }]) expect((await f.service.page(context(), query)).ok).toBe(false);
    expect(f.calls).toEqual([]);
    expect(() => validateReportingWindow({ period: "custom", fromDate: "2024-01-01", toDate: "2024-12-31" })).not.toThrow();
    expect(() => validateReportingWindow({ period: "custom", fromDate: "2024-01-01", toDate: "2025-01-01" })).toThrow();
    expect(() => validateReportingWindow({ period: "custom", fromDate: "2026-03-02", toDate: "2026-03-01" })).toThrow();
  });
});
