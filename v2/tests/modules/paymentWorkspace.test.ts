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
import { BillingPaymentsApplicationService, type BillingFinancialTransaction, type BillingFinancialTransactionRunner, type FinancialLockedInvoice } from "../../src/modules/billing/paymentApplication.js";
import { PaymentWorkspaceApplicationService, previewPaymentTender, type PaymentWorkspaceReadPort, type PaymentWorkspaceReadRunner, type PaymentWorkspaceRecordInput } from "../../src/modules/billing/paymentWorkspace.js";
import type { PaymentAggregateFact, RecordManualPaymentAllocationsInput } from "../../src/modules/billing/contracts.js";
import type { OperationContext } from "../../src/application/operation.js";
import type { Capability } from "../../src/authorization/capabilities.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { OrderAutomaticLifecycle } from "../../src/modules/sales/orderAutomaticLifecycle.js";
import { brandedId, currencyCode, money } from "../../src/modules/shared/commercialValues.js";
import { validateReportingWindow, type ReportingWindow } from "../../src/modules/shared/reportingWindow.js";

// Sole fake dependency: the reviewed QuickBooks queue writes on the caller's
// client. All V2 bridges below expose actual, statically inspected namespaces.
const quickBooks = jest.fn(async (client: PoolClient, organizationId: string, kind: string, id: string) => {
  await client.query("INSERT INTO fixture_quickbooks_jobs VALUES($1,$2,$3)", [organizationId, kind, id]);
});
type PersistenceHooks = import("../../infrastructure/billing/postgresBillingPaymentsTransaction.js").BillingFinancialPersistenceTestHooks;

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const paymentAdapterPath = fileURLToPath(new URL("../../infrastructure/billing/postgresBillingPaymentsTransaction.ts", import.meta.url));
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
  ]) }],
  ["postgresBillingDraftInvoiceTransaction.ts", { identifier: draftAdapterPath, dependencies: new Map<string, object>([
    ["node:crypto", uuidBridge],
    ["../../src/errors/applicationError.js", errorExports],
    ["../../src/modules/shared/commercialValues.js", commercialValueExports],
    ["../accounting/quickBooksBillingQueue.js", queueBridge],
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
    await expect(probe.link(linkFixtureImport)).rejects.toThrow(/Forbidden|Unexpected/);
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
  test("reads only the three exact actual sources and refuses an unreviewed source parent", async () => {
    for (const name of ["../../../server/db.ts", "postgresUnreviewedAdapter.ts", "../infrastructure/stripeProviderIngress.pure.ts"]) await expect(evaluateActualSource(name)).rejects.toThrow("Unexpected fixture source");
    const probe = new SourceTextModule("", { identifier: path.join(workspaceRoot, "v2/unreviewedParent.ts") });
    expect(() => linkFixtureImport("../persistence/postgresOperationRequests.js", probe)).toThrow("Unexpected fixture source parent");
    expect(sources.size).toBe(3);
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
const input = (id = "request-a"): RecordManualPaymentAllocationsInput => ({ organizationId: brandedId<"OrganizationId">("org-a"), businessRequestId: brandedId<"BusinessRequestId">(id), occurredAt: "2026-10-01T05:00:00.000Z", method: "cash", allocations: [{ invoiceId: brandedId<"InvoiceId">("invoice-b"), amount: amount(3750) }, { invoiceId: brandedId<"InvoiceId">("invoice-a"), amount: amount(5000) }], tender: { tendered: amount(10_000), expectedBalances: [{ invoiceId: brandedId<"InvoiceId">("invoice-a"), collectibleBalance: amount(5000) }, { invoiceId: brandedId<"InvoiceId">("invoice-b"), collectibleBalance: amount(3750) }] } });

/** Only transaction persistence is simulated. Every command executes the real canonical Billing operation. */
function fixture() {
  const invoices = new Map<string, FinancialLockedInvoice>([["invoice-a", { invoiceId: brandedId<"InvoiceId">("invoice-a"), currency: "USD", customerId: "customer-a", totalCents: 5000, lifecycle: "draft" }], ["invoice-b", { invoiceId: brandedId<"InvoiceId">("invoice-b"), currency: "USD", customerId: "customer-a", totalCents: 3750, lifecycle: "issued" }]]);
  let paid = new Map<string, number>(), payments: PaymentAggregateFact[] = [], requests = new Map<string, { fingerprint: string; id: string; result: unknown | null }>();
  let audits: unknown[] = [], attributions = 0, outbox = 0, transactions = 0, providers = 0, failAudit = false;
  const unsupported = async (): Promise<never> => { providers++; throw Error("Unrelated legacy/provider operation is not allowed"); };
  const lockedIds: string[][] = [];
  const settlement: BillingFinancialTransaction["settlement"] = async (_org, invoiceId, currency, gross) => ({ invoiceId, gross: money(currencyCode(currency), gross), successfulPayments: money(currencyCode(currency), paid.get(invoiceId) ?? 0), successfulRefunds: money(currencyCode(currency), 0), collectibleBalance: money(currencyCode(currency), gross - (paid.get(invoiceId) ?? 0)) });
  const tx = {
    lockInvoice: unsupported, recordPayment: unsupported, recordRefund: unsupported, confirmProviderPayment: unsupported, confirmProviderRefund: unsupported,
    lockInvoices: async (org, ids) => { lockedIds.push([...ids]); return org === "org-a" ? ids.flatMap((id) => invoices.has(id) ? [invoices.get(id)!] : []) : []; },
    settlement,
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
    recordPaymentAggregate: async (value) => {
      const aggregate: PaymentAggregateFact = { payment: { paymentId: brandedId<"PaymentId">(`payment-${payments.length}`), invoiceId: value.allocations[0].invoiceId, method: value.method as "cash", source: "manual", amount: amount(value.allocations.reduce((sum, allocation) => sum + allocation.amount.cents, 0)), occurredAt: value.occurredAt }, allocations: value.allocations };
      payments.push(aggregate);
      for (const allocation of value.allocations) paid.set(allocation.invoiceId, (paid.get(allocation.invoiceId) ?? 0) + allocation.amount.cents);
      return aggregate;
    },
    attribute: async () => { attributions++; }, audit: async (value) => { if (failAudit) throw new Error("Injected audit failure"); audits.push(structuredClone(value)); }, enqueue: async () => { outbox++; },
    succeed: async (_org, id, _type, _resource, result) => { const saved = [...requests.values()].find((value) => value.id === id)!; saved.result = structuredClone(result); },
    beginProvider: async () => { providers++; throw Error("No provider operation is allowed"); },
  } satisfies BillingFinancialTransaction;
  const runner: BillingFinancialTransactionRunner = { async transaction(work) {
    transactions++;
    const before = structuredClone({ paid, payments, requests, audits, attributions, outbox });
    try { return await work(tx); }
    catch (error) { ({ paid, payments, requests, audits, attributions, outbox } = before); throw error; }
  } };
  const service = () => new BillingPaymentsApplicationService(runner);
  const record = (ctx: OperationContext, command: RecordManualPaymentAllocationsInput) => service().recordManualPaymentAllocations(ctx, command);
  return { service, record, invoices, lockedIds, balance: (id: string, cents: number) => paid.set(id, cents), failAudit: () => { failAudit = true; }, restoreAudit: () => { failAudit = false; }, state: () => ({ paid: Object.fromEntries(paid), payments, requests: requests.size, audits, attributions, outbox, transactions, providers }) };
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
  let state = { requests: new Map<string, Row>(), payments: [] as Row[], allocations: [] as Row[], providerOperations: [] as Row[], events: 0, attributions: 0, audits: [] as unknown[], outbox: [] as Row[], quickBooks: [] as unknown[] };
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
      if (sql.startsWith("SELECT id,customer_id,currency,total_cents,invoice_state")) {
        expect(values[0]).toBe("org-a");
        return result((values[1] as string[]).map((id) => ({ id, customer_id: "customer-a", currency: "USD", total_cents: id === "invoice-a" ? "5000" : "3750", invoice_state: "draft" })));
      }
      if (sql.startsWith("SELECT COALESCE((SELECT sum(amount_cents)")) {
        const paid = state.allocations.filter((row) => row.organization_id === values[0] && row.invoice_id === values[1]).reduce((sum, row) => sum + Number(row.amount_cents), 0);
        return result([{ paid: String(paid), refunded: "0" }]);
      }
      if (sql.startsWith("SELECT COALESCE(sum((allocation")) return result([{ cents: "0" }]);
      if (sql.startsWith("SELECT * FROM v2_operation_requests")) {
        const row = state.requests.get(values.slice(0, 3).join(":"));
        return result(row ? [row] : []);
      }
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
        const row = { id: values[0], organization_id: values[1], invoice_id: values[2], provider: values[3], provider_idempotency_key: values[4], stripe_account_id: values[5], amount_cents: String(values[6]), currency: values[7], provider_transaction_id: null, reconciliation_state: "uncertain", allocation_intent: JSON.parse(String(values[9])) };
        state.providerOperations.push(row); return result([row]);
      }
      if (sql.includes("FROM v2_billing_provider_financial_operations WHERE organization_id=$1 AND id=$2")) return result(state.providerOperations.filter((row) => row.organization_id === values[0] && row.id === values[1]));
      if (sql.startsWith("SELECT id,occurred_at,amount_cents FROM v2_billing_payments")) return result(state.payments.filter((row) => row.organization_id === values[0] && row.provider_operation_id === values[1]));
      if (sql.startsWith("INSERT INTO v2_billing_provider_events")) { state.events++; return result([{ id: values[0] }]); }
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
  return { service: new BillingPaymentsApplicationService(new PostgresBillingPaymentsTransactionRunner(pool, hooks), undefined, lifecycle), client: pgClient, reconciliations, statements, state: () => ({ ...state, releases }) };
}

describe("receiver-sensitive actual Postgres Payment owner regressions", () => {
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
