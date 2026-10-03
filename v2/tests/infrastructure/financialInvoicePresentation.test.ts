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
import * as reusableTaxEvidenceExports from "../../infrastructure/billing/postgresReusableInvoiceTaxEvidence.js";
import { PDFDocument } from "pdf-lib";
import * as ownerRenderer from "../../infrastructure/documents/ownerPdfRenderer.js";
import type { PostgresInvoiceDocumentService } from "../../infrastructure/billing/postgresInvoiceDocuments.js";
import type { PostgresInvoiceEmailSender } from "../../infrastructure/communications/invoiceEmailSender.js";
import express from "express";
import request from "supertest";
import { createInvoiceRouter } from "../../src/interfaces/http/invoiceRoutes.js";

const workspaceRoot = path.resolve(process.cwd());
const adapterPath = path.join(workspaceRoot, "v2/infrastructure/billing/postgresFinancialRead.ts");
const draftAdapterPath = path.join(workspaceRoot, "v2/infrastructure/billing/postgresBillingDraftInvoiceTransaction.ts");
const documentsPath = path.join(workspaceRoot, "v2/infrastructure/billing/postgresInvoiceDocuments.ts");
const readRunnerPath = path.join(workspaceRoot, "v2/infrastructure/billing/postgresBillingRead.ts");
const emailSenderPath = path.join(workspaceRoot, "v2/infrastructure/communications/invoiceEmailSender.ts");
const adapterSources = new Set([adapterPath, draftAdapterPath, documentsPath, readRunnerPath, emailSenderPath]);
const messages: string[] = [];
const moduleContext = createContext({ Buffer, Date, process: { env: { GOOGLE_CLIENT_ID: "inert-fixture", GOOGLE_CLIENT_SECRET: "inert-fixture" } } });
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
    ["./postgresReusableInvoiceTaxEvidence.js", reusableTaxEvidenceExports],
  ])],
  [documentsPath, new Map<string, object>([
    ["pdf-lib", { PDFDocument }],
    ["../../src/errors/applicationError.js", applicationError],
    ["../documents/ownerPdfRenderer.js", ownerRenderer],
    ["../documents/postgresTenantBranding.js", { readTenantBranding: () => { throw new Error("Issued PDF cannot read current branding"); } }],
  ])],
  [emailSenderPath, new Map<string, object>([
    ["node:crypto", { randomUUID }],
    ["../../src/errors/applicationError.js", applicationError],
    ["./postgresEmailIntegration.js", { PostgresEmailIntegrationService: class {} }],
    ["googleapis", { google: { auth: { OAuth2: class { setCredentials() {} } }, gmail: () => ({ users: { messages: { send: async ({ requestBody }: { requestBody: { raw: string } }) => { messages.push(requestBody.raw); return { data: { id: "inert-message" } }; } } } }) } }],
  ])],
]);
const modules = new Map<string, Module>();
const linkDependency = async (specifier: string, parent: Module): Promise<Module> => {
  if (!adapterSources.has(parent.identifier)) throw new Error("Unexpected adapter parent.");
  if (parent.identifier === adapterPath && specifier === "./postgresBillingDraftInvoiceTransaction.js") return sourceModule(draftAdapterPath);
  if (parent.identifier === documentsPath && specifier === "./postgresBillingRead.js") return linkedSource(readRunnerPath);
  if (parent.identifier === readRunnerPath && specifier === "./postgresBillingDraftInvoiceTransaction.js") return sourceModule(draftAdapterPath);
  if (parent.identifier === emailSenderPath && specifier === "../billing/postgresInvoiceDocuments.js") return linkedSource(documentsPath);
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
const linkedSource = async (filename: string): Promise<Module> => {
  if (!modules.has(filename)) modules.set(filename, await sourceModule(filename));
  return modules.get(filename)!;
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
    for (const identifier of [adapterPath, draftAdapterPath]) {
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
        ALTER TABLE v2_billing_invoices ADD COLUMN tax_evidence jsonb,ADD COLUMN tax_calculator_version text,ADD COLUMN tax_context_reference text,ADD COLUMN sales_tax_composition jsonb,ADD COLUMN sales_commercial_charge jsonb;
        ALTER TABLE v2_billing_invoice_lines ADD COLUMN currency text DEFAULT 'USD';
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
        expect(calls.length - before).toBe(id.startsWith("legacy") ? 2 : id === "live-draft" ? 5 : 6);
        if (!id.startsWith("legacy")) {
          expect(calls.slice(before).filter(call => call.sql.includes('AS "rawEvidence"'))).toHaveLength(1);
          expect(detail?.invoice.reusableTaxEvidence?.status).toBe("not_reusable");
        }
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

      // BILL-16: real document/reader/renderer and email attachment paths, with
      // settlement/revision fixtures only in memory. No invented issue-time tender.
      const checkpoint = (number: string) => ({ schemaVersion: 1, invoiceNumber: number, occurredAt: "2026-01-01T12:34:56Z", customerPresentation: { customerDisplayName: "Customer at issue", contactDisplayName: "Contact at issue", billingAddress: { lines: ["2 Customer Historic St"], city: "Historic City", region: "CA", postalCode: "90001", countryCode: "US" } }, organizationPresentation: { name: "Brand at issue", address: "1 Historic St", phone: "555-0100", email: "issued@example.test", website: "https://issued.example.test", footerNote: "Footer at issue", paymentInstructions: "Original remittance", checksPayableTo: "Issuer at issue", remittanceAddress: "3 Historic Remittance St" }, commercial: { currency: "USD", purchaseOrderNumber: "PO at issue", subtotal: { currency: "USD", cents: 600 }, taxTotal: { currency: "USD", cents: 0 }, total: { currency: "USD", cents: 600 } }, lines: [{ description: "Items at issue", quantity: 1, unitAmount: { currency: "USD", cents: 600 }, lineAmount: { currency: "USD", cents: 600 } }] });
      await db.query("INSERT INTO v2_billing_invoice_checkpoints VALUES ($1,$2,$3::jsonb),($1,$4,$5::jsonb)", [org,"original",JSON.stringify(checkpoint("ORD-1010")),"replacement",JSON.stringify(checkpoint("ORD-1010-B"))]);
      const frozen = await db.query("SELECT checkpoint_json FROM v2_billing_invoice_checkpoints ORDER BY invoice_id");
      const pool = { connect: async () => ({ query: (sql: string, values: readonly unknown[] = []) => db.query(sql, [...values]), release() {} }), query: (sql: string, values: readonly unknown[] = []) => db.query(sql, [...values]) };
      const docModule = await linkedSource(documentsPath);
      if (docModule.status === "unlinked") await docModule.link(linkDependency);
      await docModule.evaluate();
      const DocumentService = (docModule.namespace as unknown as { PostgresInvoiceDocumentService: typeof PostgresInvoiceDocumentService }).PostgresInvoiceDocumentService;
      const documents = new DocumentService(pool as never);
      const original = commercialValues.brandedId<"InvoiceId">("original"), replacement = commercialValues.brandedId<"InvoiceId">("replacement");
      const baseline = Buffer.from(await documents.pdf(org, original));
      const replacementBaseline = Buffer.from(await documents.pdf(org, replacement));
      const download = express().use("/v2/organizations/:organizationId/invoices",createInvoiceRouter({documents,service:{readInvoice:async()=>({ok:true,value:{}})} as never,principals:{principal:async()=>({kind:"staff",organizationId:org,userId:"fixture",authority:{membershipId:"fixture",capabilities:["invoice.view"]}} as never)}}));
      const initialDownload = await request(download).get("/v2/organizations/org-a/invoices/original/document.pdf");
      expect(initialDownload.status).toBe(200); expect(Buffer.from(initialDownload.body)).toEqual(baseline);
      expect(baseline.subarray(0,5).toString()).toBe("%PDF-");
      const issuedDocument = await documents.document(org, original);
      expect(issuedDocument.number).toBe("ORD-1010");
      expect(issuedDocument.organization.name).toBe("Brand at issue");
      expect(issuedDocument.organization).toEqual(checkpoint("ORD-1010").organizationPresentation);
      expect(issuedDocument.issuedAt).toBe("2026-01-01");
      expect(issuedDocument.sections[0]!.entries).toContainEqual({label:"Customer",value:"Customer at issue"});
      expect(issuedDocument.sections[0]!.entries).toContainEqual({label:"Contact",value:"Contact at issue"});
      expect(issuedDocument.sections[0]!.entries).toContainEqual({label:"Billing address",value:"2 Customer Historic St, Historic City, CA, 90001, US"});
      expect(JSON.stringify(issuedDocument)).not.toMatch(/Paid \(current\)|Refunded \(current\)|Balance due|Credit \/ refund due/);
      await db.exec("INSERT INTO v2_billing_payment_allocations VALUES ('org-a','payment-a','original',600)");
      expect(Buffer.from(await documents.pdf(org, original))).toEqual(baseline);
      await db.exec("INSERT INTO v2_billing_refund_allocation_evidence VALUES ('org-a','refund-allocation','payment-a','original',50)");
      expect(Buffer.from(await documents.pdf(org, original))).toEqual(baseline);
      await db.exec("UPDATE v2_billing_invoices SET total_cents=750,subtotal_cents=750,synchronization_version='2',invoice_display_number='CURRENT-NUMBER',purchase_order_number='CURRENT-PO' WHERE organization_id='org-a' AND id='original'; UPDATE v2_sales_documents SET display_number='CURRENT-ORDER' WHERE organization_id='org-a'; UPDATE customers SET display_name='Current customer' WHERE organization_id='org-a'; UPDATE v2_billing_invoice_lines SET description='Current revised item' WHERE organization_id='org-a' AND invoice_id='original'");
      await db.exec("INSERT INTO v2_billing_invoice_additional_charges VALUES ('org-a','original','shipping',150,0,'Later shipping','2026-01-02','charge-a')");
      expect(Buffer.from(await documents.pdf(org, original))).toEqual(baseline);
      expect((await reader.readFinancialInvoice(org,original))?.settlement).toEqual({gross:commercialValues.money(commercialValues.currencyCode("USD"),750),paid:commercialValues.money(commercialValues.currencyCode("USD"),600),refunded:commercialValues.money(commercialValues.currencyCode("USD"),50),balance:commercialValues.money(commercialValues.currencyCode("USD"),200)});
      await db.exec("UPDATE v2_billing_invoices SET total_cents=400,subtotal_cents=600,sales_adjustment_cents=-200,sales_adjustment_reason='Credit correction',synchronization_version='3' WHERE organization_id='org-a' AND id='original'");
      await new Promise(resolve => setTimeout(resolve,1100)); // Cross a render timestamp boundary.
      expect(Buffer.from(await documents.pdf(org, original))).toEqual(baseline);
      expect((await reader.readFinancialInvoice(org,original))?.settlement.balance.cents).toBe(-150);
      const laterDownload = await request(download).get("/v2/organizations/org-a/invoices/original/document.pdf");
      expect(laterDownload.status).toBe(200); expect(Buffer.from(laterDownload.body)).toEqual(baseline);
      expect(laterDownload.headers["content-disposition"]).toContain("Invoice_ORD-1010.pdf");
      expect(Buffer.from(await documents.pdf(org,replacement))).toEqual(replacementBaseline);
      expect((await db.query("SELECT checkpoint_json FROM v2_billing_invoice_checkpoints ORDER BY invoice_id")).rows).toEqual(frozen.rows);
      expect(await documents.filename(org,original)).toBe("Invoice_ORD-1010.pdf");
      const emailModule = await sourceModule(emailSenderPath);
      await emailModule.link(linkDependency); await emailModule.evaluate();
      const EmailSender = (emailModule.namespace as unknown as { PostgresInvoiceEmailSender: typeof PostgresInvoiceEmailSender }).PostgresInvoiceEmailSender;
      const mailPool = { query: async (sql: string, values: readonly unknown[]) => sql.startsWith("INSERT INTO v2_audit_events") ? {rows:[]} : db.query(sql,[...values]) };
      const sender = new EmailSender(mailPool as never,documents,{requireReady:async()=>({displayName:"Fixture",sendingAddress:"fixture@example.test",refreshToken:"inert"})} as never);
      let attempts=0;
      await sender.send({organizationId:org,recipient:"customer@example.test",invoiceIds:[original],beforeProviderAttempt:async()=>{attempts++;},audit:{operation:"fixture",principalKind:"staff",principalSubject:"fixture"}});
      const mime = Buffer.from(messages.at(-1)!,"base64url").toString();
      const attachment = mime.match(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=]+)\r\n/)!;
      expect(Buffer.from(attachment[1]!,"base64")).toEqual(baseline);
      expect(mime).toContain("Invoice_ORD-1010.pdf");
      expect(mime).toContain("-$1.50"); // Email's separate current settlement, not a PDF balance.
      expect(attempts).toBe(1);
      await db.exec("UPDATE v2_billing_invoices SET invoice_state='void',issued_at='2026-01-01' WHERE organization_id='org-a' AND id='original'");
      expect(Buffer.from(await documents.pdf(org,original))).toEqual(baseline);
      await db.exec("DELETE FROM v2_billing_invoice_checkpoints WHERE organization_id='org-a' AND invoice_id='original'");
      await expect(documents.pdf(org,original)).rejects.toThrow("Issued Invoice checkpoint is unavailable");
      await db.query("INSERT INTO v2_billing_invoice_checkpoints VALUES ($1,$2,$3::jsonb)",[org,original,JSON.stringify({...checkpoint("ORD-1010"),organizationPresentation:undefined})]);
      await expect(documents.pdf(org,original)).rejects.toThrow("Historical Invoice presentation is unavailable");
      for (const missing of [{invoiceNumber:undefined},{customerPresentation:{}},{organizationPresentation:{name:""}},{occurredAt:"not-a-date"}]) {
        await db.query("UPDATE v2_billing_invoice_checkpoints SET checkpoint_json=$3::jsonb WHERE organization_id=$1 AND invoice_id=$2",[org,original,JSON.stringify({...checkpoint("ORD-1010"),...missing})]);
        await expect(documents.pdf(org,original)).rejects.toThrow("Historical Invoice presentation is unavailable");
      }
    } finally { await db.close(); }
  });
});
