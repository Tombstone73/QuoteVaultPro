import { describe, expect, test } from "@jest/globals";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createContext, SourceTextModule, SyntheticModule, type Module } from "node:vm";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import type { PoolClient } from "pg";
import type * as AdapterExports from "../../infrastructure/billing/postgresFinancialRead.js";
import * as commercialValues from "../../src/modules/shared/commercialValues.js";
import * as applicationError from "../../src/errors/applicationError.js";

const workspaceRoot = path.resolve(process.cwd());
const adapterPath = path.join(workspaceRoot, "v2/infrastructure/billing/postgresFinancialRead.ts");
const draftAdapterPath = path.join(workspaceRoot, "v2/infrastructure/billing/postgresBillingDraftInvoiceTransaction.ts");
const adapterSources = new Set([adapterPath, draftAdapterPath]);
const moduleContext = createContext({});
const rejectQuickBooks = () => { throw new Error("QuickBooks writes are outside this read-only regression."); };
// Both readers are evaluated from actual source. Only the unused write-side
// QuickBooks seam is replaced, with a failure rather than simulated success.
const dependencies = new Map<string, Map<string, object>>([
  [adapterPath, new Map([["../../src/modules/shared/commercialValues.js", commercialValues]])],
  [draftAdapterPath, new Map<string, object>([
    ["../../src/modules/shared/commercialValues.js", commercialValues],
    ["../../src/errors/applicationError.js", applicationError],
    ["node:crypto", { randomUUID }],
    ["../accounting/quickBooksBillingQueue.js", { enqueueV2QuickBooksAutoSync: rejectQuickBooks }],
  ])],
]);
const modules = new Map<string, Module>();
const linkDependency = async (specifier: string, parent: Module): Promise<Module> => {
  if (!adapterSources.has(parent.identifier)) throw new Error("Unexpected adapter parent.");
  if (parent.identifier === adapterPath && specifier === "./postgresBillingDraftInvoiceTransaction.js") return sourceModule(draftAdapterPath);
  const exports = dependencies.get(parent.identifier)?.get(specifier);
  if (!exports) throw new Error(`Unexpected adapter dependency: ${specifier}`);
  const key = `${parent.identifier}:${specifier}`;
  if (!modules.has(key)) modules.set(key, new SyntheticModule(Object.keys(exports), function () {
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
  }, { identifier: specifier, context: moduleContext }));
  return modules.get(key)!;
};
const rejectDynamicImport = () => { throw new Error("Unexpected dynamic adapter import."); };
const sourceModule = async (filename: string) => {
  if (!adapterSources.has(filename)) throw new Error("Unexpected adapter source.");
  const source = await readFile(filename, "utf8");
  const { outputText } = ts.transpileModule(source, { fileName: filename, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return new SourceTextModule(outputText, { identifier: filename, context: moduleContext, importModuleDynamically: rejectDynamicImport });
};
const evaluateAdapter = async (filename: string) => {
  const module = await sourceModule(filename);
  await module.link(linkDependency);
  await module.evaluate();
  return module.namespace as unknown as typeof AdapterExports;
};
const { PostgresFinancialRead } = await evaluateAdapter(adapterPath);

describe("Invoice presentation through the actual page mapper", () => {
  test("preserves canonical numbers, separate Order reference, IDs and financial facts", async () => {
    const row = (id: string, invoiceNumber: string) => ({
      source: "v2", record_id: id, invoice_id: id, invoice_number: invoiceNumber, persisted_invoice_number: invoiceNumber,
      source_order_id: "order-a", source_order_number: "ORD-1010", customer_id: "customer-a", customer_name: "QA Customer",
      lifecycle: "issued", settlement: "unpaid", currency: "USD", gross_cents: "600", paid_cents: "0", refunded_cents: "0", balance_cents: "600",
      issued_at: new Date("2026-01-01T00:00:00Z"), updated_at: new Date("2026-01-01T00:00:00Z"),
    });
    const input = [row("invoice-original", "ORD-1010"), row("invoice-replacement", "ORD-1010-B")];
    const calls: { sql: string; values: readonly unknown[] }[] = [];
    const client = { query: async (sql: string, values: readonly unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes("FROM filtered ORDER BY updated_at")) return { rows: input };
      if (sql.includes("FROM filtered GROUP BY currency")) return { rows: [{ currency: "USD", invoice_count: "2", unpaid_count: "2", unpaid_cents: "1200", partially_paid_count: "0", partially_paid_cents: "0", paid_count: "0", credit_due_count: "0", credit_due_cents: "0" }] };
      throw new Error("Unexpected query outside Invoice page projection.");
    } } as unknown as PoolClient;
    const page = await new PostgresFinancialRead(client).pageFinancialInvoices(commercialValues.brandedId<"OrganizationId">("org-a"), {});
    expect(page.items.map((item) => ({ invoiceId: item.invoiceId, invoiceNumber: item.invoiceNumber, sourceOrderId: item.sourceOrderId, sourceOrderNumber: item.sourceOrderNumber }))).toEqual([
      { invoiceId: "invoice-original", invoiceNumber: "ORD-1010", sourceOrderId: "order-a", sourceOrderNumber: "ORD-1010" },
      { invoiceId: "invoice-replacement", invoiceNumber: "ORD-1010-B", sourceOrderId: "order-a", sourceOrderNumber: "ORD-1010" },
    ]);
    expect(page.items.map((item) => item.balance)).toEqual([{ currency: "USD", cents: 600 }, { currency: "USD", cents: 600 }]);
    expect(page.items.map((item) => item.persistedInvoiceNumber)).toEqual(["ORD-1010", "ORD-1010-B"]);
    expect(page.totalMatching).toBe(2);
    expect(page.summary.openInvoiceCount).toBe(2);
    expect(page.summary.outstanding).toEqual([{ currency: "USD", cents: 1200 }]);
    expect(page.hasNextPage).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.values).toEqual(["org-a", "", null, null, 25, 0]);
    expect(calls[1]!.values).toEqual(["org-a", "", null, null]);
    expect(calls[0]!.sql).toContain("invoice_number");
    expect(calls.every(({ sql }) => !/\b(?:INSERT|UPDATE|DELETE|COMMIT)\b/i.test(sql))).toBe(true);
  });

  test.each(["../../../server/db.js", "../../../server/services/billing.js", "dotenv", "pg", "node:net", "node:fs", "./unreviewed.js", "../../deployment/server.js"])("rejects unsafe or unexpected imports before either adapter evaluates: %s", async (specifier) => {
    for (const identifier of adapterSources) {
      const context = createContext({ reachedEvaluation: false });
      const probe = new SourceTextModule(`import ${JSON.stringify(specifier)}; globalThis.reachedEvaluation = true;`, { identifier, context });
      await expect(probe.link(linkDependency)).rejects.toThrow("Unexpected adapter dependency");
      expect(context.reachedEvaluation).toBe(false);
    }
  });

  test("rejects another source, parent and dynamic imports", async () => {
    await expect(evaluateAdapter(path.join(workspaceRoot, "server/db.ts"))).rejects.toThrow("Unexpected adapter source");
    const wrongParent = new SourceTextModule("", { identifier: "unreviewed", context: moduleContext });
    await expect(linkDependency("../../src/modules/shared/commercialValues.js", wrongParent)).rejects.toThrow("Unexpected adapter parent");
    const probe = new SourceTextModule("await import('node:fs');", { identifier: adapterPath, context: moduleContext, importModuleDynamically: rejectDynamicImport });
    await probe.link(linkDependency);
    await expect(probe.evaluate()).rejects.toThrow("Unexpected dynamic adapter import");
  });

  test("the linked write-side QuickBooks seam fails closed, not fake success", async () => {
    const probe = new SourceTextModule("import { enqueueV2QuickBooksAutoSync } from '../accounting/quickBooksBillingQueue.js'; enqueueV2QuickBooksAutoSync();", { identifier: draftAdapterPath, context: moduleContext });
    await probe.link(linkDependency);
    await expect(probe.evaluate()).rejects.toThrow("QuickBooks writes are outside this read-only regression");
  });

  test("actual SQL and readers preserve raw native/legacy provenance without changing display fallbacks or financial history", async () => {
    const db = new PGlite(); // In-memory only: no path, URL, server or credentials.
    try {
      await db.exec(`
        CREATE TABLE customers (organization_id text,id text,display_name text,company_name text);
        CREATE TABLE v2_sales_documents (organization_id text,id text,display_number text);
        CREATE TABLE v2_billing_invoices (organization_id text,id text,sales_order_document_id text,invoice_display_number text,invoice_state text,currency text DEFAULT 'USD',customer_id text,synchronization_version text DEFAULT '1',subtotal_cents bigint DEFAULT 600,tax_total_cents bigint DEFAULT 0,total_cents bigint DEFAULT 600,sales_adjustment_cents bigint DEFAULT 0,sales_adjustment_reason text,purchase_order_number text,terms_code text,issued_at timestamptz,created_at timestamptz DEFAULT '2026-01-01T00:00:00Z',updated_at timestamptz DEFAULT '2026-01-01T00:00:00Z');
        CREATE TABLE v2_billing_invoice_lines (organization_id text,invoice_id text,sales_order_document_id text,source_sales_line_id text,product_id text,description text,quantity int,selling_unit_cents bigint,selling_line_cents bigint,position int);
        CREATE TABLE v2_billing_invoice_additional_charges (organization_id text,invoice_id text,charge_kind text,customer_charge_cents bigint,tax_cents bigint,customer_note text,created_at timestamptz,id text);
        CREATE TABLE v2_billing_invoice_checkpoints (organization_id text,invoice_id text,checkpoint_json jsonb);
        CREATE TABLE v2_billing_payments (organization_id text,id text,currency text,method text,source text,occurred_at timestamptz,recorded_at timestamptz);
        CREATE TABLE v2_billing_payment_allocations (organization_id text,payment_id text,invoice_id text,amount_cents bigint);
        CREATE TABLE v2_billing_refunds (organization_id text,id text,currency text,source text,occurred_at timestamptz,recorded_at timestamptz);
        CREATE TABLE v2_billing_refund_allocations (organization_id text,id text,refund_id text,payment_id text);
        CREATE TABLE v2_billing_refund_allocation_evidence (organization_id text,refund_allocation_id text,payment_id text,invoice_id text,amount_cents bigint);
        CREATE TABLE orders (organization_id text,id text,display_number text,order_number text,po_number text);
        CREATE TABLE invoices (organization_id text,id text,display_number text,order_id text,customer_id text,status text DEFAULT 'issued',currency text DEFAULT 'USD',total_cents bigint DEFAULT 600,total numeric DEFAULT 6,subtotal_cents bigint DEFAULT 600,subtotal numeric DEFAULT 6,tax_cents bigint DEFAULT 0,tax numeric DEFAULT 0,amount_paid numeric DEFAULT 0,balance_due numeric DEFAULT 6,issued_at timestamptz,created_at timestamptz DEFAULT '2026-01-01T00:00:00Z',updated_at timestamptz DEFAULT '2026-01-01T00:00:00Z');
        CREATE TABLE payments (organization_id text,id text,invoice_id text,amount_cents bigint,amount numeric,currency text,method text,paid_at timestamptz,applied_at timestamptz,created_at timestamp);
        INSERT INTO v2_sales_documents VALUES ('org-a','order-a','ORD-1010'),('org-b','order-a','FOREIGN-ORDER');
        INSERT INTO v2_billing_invoices (organization_id,id,sales_order_document_id,invoice_display_number,invoice_state) VALUES
          ('org-a','original','order-a','ORD-1010','issued'),('org-a','replacement','order-a','ORD-1010-B','issued'),
          ('org-a','native-missing','order-a',NULL,'issued'),('org-a','live-draft','order-a',NULL,'draft'),
          ('org-b','original','order-a','FOREIGN-NUMBER','issued');
        INSERT INTO orders VALUES ('org-a','legacy-order','OLD-ORDER','123',NULL);
        INSERT INTO invoices (organization_id,id,display_number,order_id) VALUES ('org-a','legacy-missing',NULL,'legacy-order'),('org-a','legacy-numbered','OLD-123','legacy-order'),('org-b','legacy-missing','FOREIGN-LEGACY','legacy-order');
        INSERT INTO v2_billing_payments VALUES ('org-a','payment-a','USD','check','manual','2026-01-02T00:00:00Z','2026-01-02T00:00:00Z');
        INSERT INTO v2_billing_payment_allocations VALUES ('org-a','payment-a','native-missing',200);
        INSERT INTO v2_billing_refunds VALUES ('org-a','refund-a','USD','manual','2026-01-03T00:00:00Z','2026-01-03T00:00:00Z');
        INSERT INTO v2_billing_refund_allocations VALUES ('org-a','refund-allocation','refund-a','payment-a');
        INSERT INTO v2_billing_refund_allocation_evidence VALUES ('org-a','refund-allocation','payment-a','native-missing',50);
      `);
      const calls: { sql: string; values: readonly unknown[] }[] = [];
      const client = { query: async (sql: string, values: readonly unknown[]) => {
        expect(sql).toMatch(/^\s*(?:SELECT|WITH)\b/i);
        expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|COMMIT)\b/i);
        calls.push({ sql, values });
        return db.query(sql, [...values]);
      } } as unknown as PoolClient;
      const reader = new PostgresFinancialRead(client);
      const org = commercialValues.brandedId<"OrganizationId">("org-a");
      const page = await reader.pageFinancialInvoices(org, { sort: "invoice_number", direction: "asc" });
      expect(page.totalMatching).toBe(6);
      const numbered = new Map(page.items.map((item) => [item.invoiceId as string, item]));
      for (const [id, persisted, display] of [
        ["original", "ORD-1010", "ORD-1010"], ["replacement", "ORD-1010-B", "ORD-1010-B"],
        ["native-missing", null, "ORD-1010"], ["live-draft", null, "ORD-1010"],
        ["legacy-missing", null, "Invoice legacy-missing"], ["legacy-numbered", "OLD-123", "OLD-123"],
      ] as const) {
        expect(numbered.get(id)?.persistedInvoiceNumber).toBe(persisted);
        expect(numbered.get(id)?.invoiceNumber).toBe(display);
        const before = calls.length;
        const invoiceId = commercialValues.brandedId<"InvoiceId">(id);
        const detail = id.startsWith("legacy") ? await reader.readLegacyFinancialInvoice(org, invoiceId) : await reader.readFinancialInvoice(org, invoiceId);
        expect(detail?.persistedInvoiceNumber).toBe(persisted);
        expect(calls.slice(before).every((call) => call.values[0] === org && call.values[1] === id)).toBe(true);
        expect(calls.length - before).toBe(id.startsWith("legacy") ? 2 : id === "live-draft" ? 4 : 5);
        if (!id.startsWith("legacy")) expect(detail?.invoice.invoiceNumber).toBe(display); // Existing aggregate/PDF fallback stays intact.
        if (id === "native-missing") {
          expect(detail?.history.map((fact) => [fact.kind, fact.balanceAfter.cents])).toEqual([["payment", 400], ["refund", 450]]);
          expect(detail?.settlement).toEqual({ gross: { currency: "USD", cents: 600 }, paid: { currency: "USD", cents: 200 }, refunded: { currency: "USD", cents: 50 }, balance: { currency: "USD", cents: 450 } });
        } else expect(detail?.history).toEqual([]); // No phantom fact for the left-join sentinel.
      }
      const search = await reader.pageFinancialInvoices(org, { search: "Invoice legacy-missing" });
      expect(search.items.map((item) => item.invoiceId)).toEqual(["legacy-missing"]);
      expect(search.items[0]?.persistedInvoiceNumber).toBeNull();
      expect(calls[0]!.sql).toContain("ORDER BY invoice_number ASC");
      const foreign = commercialValues.brandedId<"OrganizationId">("org-c");
      expect(await reader.readFinancialInvoice(foreign, commercialValues.brandedId<"InvoiceId">("original"))).toBeNull();
      expect(await reader.readLegacyFinancialInvoice(foreign, commercialValues.brandedId<"InvoiceId">("legacy-missing"))).toBeNull();
    } finally { await db.close(); }
  });
});
