import assert from "node:assert/strict";
import type { Pool } from "pg";
import { PostgresCustomerWorkspaceReader } from "../../infrastructure/compatibility/postgresCustomerWorkspaceRead";
import { PostgresSalesWorkspaceReads } from "../../infrastructure/sales/postgresSalesWorkspaceReads";

type SalesSource = "v2" | "legacy";
type SalesFixture = Readonly<Record<string, unknown> & { source: SalesSource; id: string; cursor_updated_at: string; updated_at: Date }>;
const salesFixtures = (source: SalesSource): SalesFixture[] => Array.from({ length: 7 }, (_, index) => {
  const sequence = source === "v2" ? index * 2 + 1 : index * 2 + 2;
  const cursorTime = `2026-01-${String(20 - sequence).padStart(2, "0")}T12:00:00.000000Z`;
  return {
    source,
    id: `${source}-${String(sequence).padStart(2, "0")}`,
    number: `${source === "v2" ? "V" : "L"}-${sequence}`,
    customer_display_name: sequence === 12 ? "Deep Search Customer" : `Customer ${sequence}`,
    lifecycle: sequence % 2 ? "open" : "closed",
    selling_total_cents: "1000",
    currency: "USD",
    requested_due_date: "2026-02-01",
    updated_at: new Date(cursorTime),
    cursor_updated_at: cursorTime,
    order_id: null,
    order_number: null,
    purchase_order_number: sequence === 12 ? "PO-DEEP" : null,
    line_count: "1",
    invoice_id: null,
    invoice_total_cents: null,
    route_count: "0",
    status: "new",
    state: "open",
    canonical_state: "open",
    fulfillment_status: "pending",
    payment_status: "unpaid",
    production_open: "0",
    balance_due_cents: "1000",
    po_number: sequence === 12 ? "PO-DEEP" : null,
  };
});
const nativeSales = salesFixtures("v2");
const legacySales = salesFixtures("legacy");
const tuple = (row: SalesFixture) => [row.cursor_updated_at, row.source, row.id] as const;
const tupleCompare = (left: readonly string[], right: readonly string[]) => {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const comparison = left[index]!.localeCompare(right[index]!);
    if (comparison) return comparison;
  }
  return left.length - right.length;
};
const salesSql: string[] = [];
const salesPool = {
  connect: async () => ({
    query: async (text: string, values: readonly unknown[] = []) => {
      if (text.startsWith("BEGIN") || text === "COMMIT" || text === "ROLLBACK") return { rows: [] };
      salesSql.push(text);
      const isNative = text.includes("FROM v2_sales_documents");
      const isOrderQuery = text.includes("v2_sales_order_details") || text.includes("FROM orders o");
      const sourceRows = isNative ? nativeSales : legacySales;
      if (!text.includes("cursor_updated_at")) return { rows: [{ item_count: String(sourceRows.length), selling_total_cents: String(sourceRows.length * 1000), currency_count: "1", currency: "USD" }] };
      const ascending = /ORDER BY [^\n]+ ASC/u.test(text);
      const cursorIndex = isOrderQuery ? 6 : 5;
      const limitIndex = isOrderQuery ? 9 : 8;
      const cursor = values[cursorIndex] ? [String(values[cursorIndex]), String(values[cursorIndex + 1]), String(values[cursorIndex + 2])] : undefined;
      const search = values[1] ? String(values[1]).toLocaleLowerCase() : "";
      const lifecycle = values[2] ? String(values[2]) : "";
      const limit = Number(values[limitIndex]);
      const rows = sourceRows
        .filter((row) => !search || String(row.number).toLocaleLowerCase().includes(search) || String(row.customer_display_name).toLocaleLowerCase().includes(search) || String(row.purchase_order_number ?? row.po_number ?? "").toLocaleLowerCase().includes(search))
        .filter((row) => !lifecycle || row.lifecycle === lifecycle)
        .filter((row) => !cursor || (ascending ? tupleCompare(tuple(row), cursor) > 0 : tupleCompare(tuple(row), cursor) < 0))
        .sort((a, b) => ascending ? tupleCompare(tuple(a), tuple(b)) : tupleCompare(tuple(b), tuple(a)))
        .slice(0, limit);
      return { rows };
    },
    release: () => undefined,
  }),
} as unknown as Pool;

const sales = new PostgresSalesWorkspaceReads(salesPool);
const exhaust = async (kind: "quotes" | "orders", sort: "updated_desc" | "updated_asc") => {
  const ids: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const request = { limit: 3, sort, ...(cursor ? { cursor } : {}) } as const;
    const page = kind === "quotes" ? await sales.listQuotes("org-a", request) : await sales.listOrdersForWorkspace("org-a", request);
    assert.equal(page.totalMatching, 14);
    ids.push(...page.items.map((item) => item.recordId));
    cursor = page.nextCursor;
    pages += 1;
  } while (cursor);
  assert.ok(pages >= 5, `${kind} should traverse at least five bounded pages`);
  assert.equal(ids.length, 14);
  assert.equal(new Set(ids).size, 14, `${kind} rows must be reachable exactly once`);
};
await exhaust("orders", "updated_desc");
await exhaust("orders", "updated_asc");
await exhaust("quotes", "updated_desc");
await exhaust("quotes", "updated_asc");
const deepOrder = await sales.listOrdersForWorkspace("org-a", { search: "deep", limit: 3 });
assert.deepEqual(deepOrder.items.map((row) => row.recordId), ["legacy-12"]);
assert.ok(salesSql.some((sql) => sql.includes("$6::timestamptz") && sql.includes("LIMIT $9")), "Sales cursors must be applied by each bounded SQL source query");
assert.ok(salesSql.some((sql) => sql.includes("$6::text='archived'") && sql.includes("$7::timestamptz") && sql.includes("LIMIT $10")), "Order archive scope must remain server-backed before bounded pagination");
assert.ok(salesSql.every((sql) => !sql.includes("COALESCE(q.created_at,now())") && !sql.includes("COALESCE(o.updated_at,o.created_at,now())")), "resumable sort keys must not use now()");

type CustomerRow = Readonly<Record<string, unknown> & { customer_id: string; sort_name: string; company_name: string }>;
const customerRows: CustomerRow[] = Array.from({ length: 125 }, (_, index) => ({
  customer_id: `customer-${String(index + 1).padStart(3, "0")}`,
  sort_name: `customer ${String(index + 1).padStart(3, "0")}`,
  display_name: `Customer ${String(index + 1).padStart(3, "0")}`,
  company_name: `Customer ${String(index + 1).padStart(3, "0")}`,
  email: null,
  phone: null,
  contact_id: null,
  contact_first_name: null,
  contact_last_name: null,
  contact_email: null,
  contact_phone: null,
  contact_is_primary: null,
}));
const customerSql: string[] = [];
const customerPool = {
  query: async (text: string, values: readonly unknown[] = []) => {
    customerSql.push(text);
    const query = values[1] ? String(values[1]).replaceAll("%", "").toLocaleLowerCase() : "";
    const matching = customerRows.filter((row) => !query || row.company_name.toLocaleLowerCase().includes(query));
    if (text.includes("count(*)::text AS total_matching")) return { rows: [{ total_matching: String(matching.length) }] };
    const cursor = values[2] ? [String(values[2]), String(values[3])] : undefined;
    const limit = Number(values[4]);
    return { rows: matching.filter((row) => !cursor || tupleCompare([row.sort_name, row.customer_id], cursor) > 0).slice(0, limit) };
  },
} as unknown as Pool;
const customers = new PostgresCustomerWorkspaceReader(customerPool);
const reached: string[] = [];
let customerCursor: string | undefined;
do {
  const page = await customers.list("org-a", { limit: 25, ...(customerCursor ? { cursor: customerCursor } : {}) });
  assert.equal(page.totalMatching, 125);
  reached.push(...page.items.map((item) => item.customerId));
  customerCursor = page.nextCursor;
} while (customerCursor);
assert.equal(reached.length, 125);
assert.equal(new Set(reached).size, 125);
assert.ok(reached.includes("customer-125"), "Customers beyond the former first 100 must be reachable");
const searched = await customers.list("org-a", { query: "Customer 125", limit: 25 });
assert.deepEqual(searched.items.map((item) => item.customerId), ["customer-125"]);
assert.ok(customerSql.some((sql) => sql.includes("WITH candidates AS") && sql.includes("LIMIT $5")));

console.log("Sales and Customer keyset pagination tests passed.");
