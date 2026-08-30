import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve("server/db/migrations_v2/0247_v2_job_derived_invoice_numbering.sql"), "utf8");
const transaction = readFileSync(resolve("v2/infrastructure/billing/postgresBillingInvoiceTransaction.ts"), "utf8");
const application = readFileSync(resolve("v2/src/modules/billing/billingApplication.ts"), "utf8");
const reader = readFileSync(resolve("v2/infrastructure/billing/postgresBillingDraftInvoiceTransaction.ts"), "utf8");
const document = readFileSync(resolve("v2/infrastructure/billing/postgresInvoiceDocuments.ts"), "utf8");

assert.match(migration, /ADD COLUMN invoice_display_number/);
assert.match(migration, /ADD COLUMN invoice_sequence/);
assert.match(migration, /v2_billing_invoices_org_display_number_uidx/);
assert.match(migration, /invoice_state = 'draft' AND invoice_display_number IS NULL/);
assert.match(migration, /\) NOT VALID/);
assert.match(transaction, /FOR UPDATE OF d,o/);
assert.match(transaction, /invoice_state IN \('issued','void'\)/);
assert.match(transaction, /sequence===1\?base:`\$\{base\}-\$\{sequence\}`/);
assert.match(transaction, /FROM invoices WHERE organization_id=\$1 AND \(display_number=\$2 OR qb_doc_number=\$2 OR invoice_number::text=\$2\)/);
assert.match(transaction, /invoice_display_number=\$3,invoice_sequence=\$4/);
assert.match(application, /request\.kind==="replay"/);
assert.match(reader, /i\.invoice_display_number/);
assert.match(document, /invoice\.invoiceNumber \?\? invoice\.sourceOrderNumber/);

console.log("invoice Job-derived numbering contracts passed");
