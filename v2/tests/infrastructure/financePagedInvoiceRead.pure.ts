import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PoolClient } from "pg";
import { PostgresFinancialRead } from "../../infrastructure/billing/postgresFinancialRead.js";

const invoiceRow = {
  source: "v2" as const, record_id: "invoice-75", invoice_id: "invoice-75", source_order_id: "order-75", source_order_number: "ORD-1075", invoice_number: "ORD-1075", customer_id: "customer-75", customer_name: "Scale Customer", lifecycle: "issued" as const, settlement: "partially_paid" as const, currency: "USD", gross_cents: "10000", paid_cents: "2500", refunded_cents: "0", balance_cents: "7500", issued_at: new Date("2026-01-01T00:00:00.000Z"), updated_at: new Date("2026-01-02T00:00:00.000Z"),
};
const aggregates = [{ currency: "USD", invoice_count: "76", unpaid_count: "40", unpaid_cents: "400000", partially_paid_count: "10", partially_paid_cents: "75000", paid_count: "20", credit_due_count: "6", credit_due_cents: "12000" }];
const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
const client = {
  query: async (sql: string, values: readonly unknown[]) => {
    calls.push({ sql, values });
    return { rows: sql.includes("FROM filtered ORDER BY balance_cents") ? [invoiceRow] : aggregates };
  },
} as unknown as PoolClient;

const page = await new PostgresFinancialRead(client).pageFinancialInvoices("tenant-a" as never, {
  page: 3, pageSize: 25, search: "ORD_100%", lifecycle: "issued", settlement: "partially_paid", sort: "balance", direction: "asc",
});
assert.equal(page.page, 3);
assert.equal(page.pageSize, 25);
assert.equal(page.totalMatching, 76);
assert.equal(page.hasNextPage, true);
assert.equal(page.items[0]?.invoiceId, "invoice-75");
assert.equal(page.items[0]?.balance.cents, 7500);
assert.deepEqual(page.summary.outstanding, [{ currency: "USD", cents: 475000 }]);
assert.equal(page.summary.openInvoiceCount, 50);
assert.equal(page.summary.creditDue.balance[0]?.cents, 12000);
assert.equal(calls.length, 2);
assert.match(calls[0]!.sql, /ORDER BY balance_cents ASC NULLS LAST, source ASC, record_id ASC LIMIT \$5 OFFSET \$6/u);
assert.match(calls[0]!.sql, /NOT EXISTS \(SELECT 1 FROM v2_billing_invoices v WHERE v\.organization_id=i\.organization_id AND v\.id=i\.id\)/u);
assert.deepEqual(calls[0]!.values, ["tenant-a", "ORD\\_100\\%", "issued", "partially_paid", 25, 50]);
assert.match(calls[1]!.sql, /FROM filtered GROUP BY currency/u);

const ledgerCalls: Array<{ sql: string; values: readonly unknown[] }> = [];
const ledgerClient = {
  query: async (sql: string, values: readonly unknown[]) => {
    ledgerCalls.push({ sql, values });
    return { rows: sql.includes("SELECT count(*)::text total_matching FROM combined") ? [{ total_matching: "76" }] : [{ record_source: "v2", kind: "payment", id: "payment-75", payment_id: "payment-75", invoice_id: "invoice-75", amount_cents: "2500", currency: "USD", method: "check", source: "manual", occurred_at: new Date("2026-01-02T00:00:00.000Z"), recorded_at: new Date("2026-01-02T00:00:00.000Z"), source_order_id: "order-75", source_order_number: "ORD-1075", customer_id: "customer-75", customer_name: "Scale Customer", balance_after_cents: "7500" }] };
  },
} as unknown as PoolClient;
const ledger = await new PostgresFinancialRead(ledgerClient).pageFinancialLedger("tenant-a" as never, { page: 3, pageSize: 25 });
assert.equal(ledger.totalMatching, 76);
assert.equal(ledger.hasNextPage, true);
assert.equal(ledger.items[0]?.balanceAfter.cents, 7500);
assert.match(ledgerCalls[0]!.sql, /sum\(signed_cents\) OVER \(PARTITION BY invoice_id/u);
assert.match(ledgerCalls[0]!.sql, /LIMIT \$2 OFFSET \$3/u);
assert.deepEqual(ledgerCalls[0]!.values, ["tenant-a", 25, 50]);
assert.match(ledgerCalls[1]!.sql, /SELECT count\(\*\)::text total_matching FROM combined/u);

const financeUi = readFileSync("v2/ui/src/FinanceWorkspace.tsx", "utf8");
const commandCenter = readFileSync("v2/ui/src/CommandCenter.tsx", "utf8");
const invoiceUi = readFileSync("v2/ui/src/InvoiceWorkspace.tsx", "utf8");
assert.match(financeUi, /const invoiceQuery: FinancialInvoiceQuery = \{ page, pageSize, \.\.\.\(search \? \{ q: search \}/u);
assert.match(financeUi, /"finance", "overview", invoiceQuery/u);
assert.match(financeUi, /Select visible invoices/u);
assert.match(financeUi, /Selection cleared because the invoice search or filters changed/u);
assert.match(financeUi, /serverSorting=/u);
assert.match(financeUi, /"finance", "ledger", ledgerPage, ledgerPageSize/u);
assert.match(commandCenter, /financeApi\.summary\(organizationId\)/u);
assert.doesNotMatch(commandCenter, /invoices\.reduce\(/u);
assert.match(invoiceUi, /financeApi\.overview\(organizationId/u);
assert.match(invoiceUi, /hasNextPage/u);

console.log("V2 paged Finance projection contract tests passed.");
