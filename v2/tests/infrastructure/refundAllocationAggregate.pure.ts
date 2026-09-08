import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(path, "utf8");
const migration = source("server/db/migrations_v2/0271_v2_refund_allocation_aggregate.sql");
const application = source("v2/src/modules/billing/paymentApplication.ts");
const persistence = source("v2/infrastructure/billing/postgresBillingPaymentsTransaction.ts");
const routes = source("v2/src/interfaces/http/financeRoutes.ts");
const quickBooks = source("v2/infrastructure/accounting/quickBooksBillingQueue.ts");

assert.match(migration, /v2_billing_refund_allocation_evidence/);
assert.match(migration, /DROP CONSTRAINT IF EXISTS v2_billing_refund_allocations_refund_uidx/);
assert.match(migration, /Refund allocation evidence backfill found an ambiguous historic Refund/);
assert.match(migration, /immutable_trigger/);
assert.match(application, /recordRefundAllocations/);
assert.match(application, /remainingRefundableCents/);
assert.match(application, /All Refund allocations must belong to one Customer account/);
assert.match(persistence, /lockRefundAllocations/);
assert.match(persistence, /v2_billing_refund_allocation_evidence/);
assert.match(persistence, /refund exceeds the original payment allocation/i);
for (const sourcePath of [
  "v2/infrastructure/sales/postgresSalesWorkspaceReads.ts",
  "v2/infrastructure/sales/postgresOrderAutomaticLifecycle.ts",
  "v2/infrastructure/billing/postgresInvoiceDocuments.ts",
  "v2/infrastructure/communications/invoiceEmailSender.ts",
]) {
  const sourceText = source(sourcePath);
  assert.match(sourceText, /v2_billing_refund_allocation_evidence/);
  assert.doesNotMatch(sourceText, /v2_billing_refund_allocations\s+\w+\s+WHERE\s+\w+\.organization_id=[^\n]+\w+\.invoice_id/is);
}
assert.match(routes, /router\.post\("\/refunds"/);
assert.match(routes, /paymentAllocationId/);
assert.match(quickBooks, /QUICKBOOKS_REFUND_ALLOCATION_EXPORT_UNSUPPORTED/);

console.log("[m7.5l] allocation-aware Refund aggregate contracts passed.");
