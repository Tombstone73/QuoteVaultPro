import { expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = readFileSync(
  path.join(process.cwd(), "client/src/features/customers/EnhancedCustomerView.tsx"),
  "utf8",
);
const ordersStart = source.indexOf("function OrdersTable(");
const ordersTable = source.slice(ordersStart, source.indexOf("function QuotesTable(", ordersStart));

test("Customer Orders Production Complete is a canonical state filter, not a legacy status filter", () => {
  expect(source).toContain('const CUSTOMER_ORDER_PRODUCTION_COMPLETE_FILTER = "state:production_complete";');
  expect(source).toContain(">Production Complete</SelectItem>");
  expect(ordersTable).toContain('order.state === "production_complete"');
  expect(ordersTable).toContain('statusFilter === CUSTOMER_ORDER_PRODUCTION_COMPLETE_FILTER');

  const matches = (order: { state: string; status: string }, filter: string) =>
    filter === "all" || (filter === "state:production_complete"
      ? order.state === "production_complete"
      : order.status === filter);

  expect(matches({ state: "production_complete", status: "in_production" }, "state:production_complete")).toBe(true);
  expect(matches({ state: "open", status: "production_complete" }, "state:production_complete")).toBe(false);
  expect(matches({ state: "closed", status: "completed" }, "state:production_complete")).toBe(false);
  expect(matches({ state: "closed", status: "completed" }, "completed")).toBe(true);
});

test("Customer Order navigation sends the canonical global state filter and restores its Customer return filter", () => {
  expect(ordersTable).toContain('params.set("state", "production_complete")');
  expect(ordersTable).toContain('orderReturnParams.set("status", statusFilter)');
  expect(source).toContain('setStatusFilter(params.get("status") || "all")');
});
