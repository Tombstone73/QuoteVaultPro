import assert from "node:assert/strict";
import { productionOperatorContext, productionOperatorContextSql } from "../../infrastructure/production/postgresProductionTransaction.js";

const complete = productionOperatorContext({
  order_number: "ORD-2042",
  product_id: "product-frozen",
  product_display_name: "Frozen order-line product",
  customer_id: "customer-a",
  customer_display_name: "Customer A",
  requested_due_date: "2026-10-20",
  line_dimensions: { width: "24.5", height: "36", unit: "in" },
});
assert.deepEqual(complete, {
  orderNumber: "ORD-2042",
  product: { productId: "product-frozen", displayName: "Frozen order-line product" },
  customer: { customerId: "customer-a", displayName: "Customer A" },
  requestedDueDate: "2026-10-20",
  dimensions: { width: "24.5", height: "36", unit: "in" },
});

const legacyCustomer = productionOperatorContext({
  order_number: "ORD-2043",
  product_id: "product-historical",
  product_display_name: "Historical line description",
  customer_id: "customer-missing",
  customer_display_name: null,
});
assert.deepEqual(legacyCustomer, {
  orderNumber: "ORD-2043",
  product: { productId: "product-historical", displayName: "Historical line description" },
  customer: { customerId: "customer-missing", displayName: "Customer unavailable" },
});

assert.equal(
  productionOperatorContext({
    order_number: null,
    product_id: null,
    product_display_name: null,
    customer_id: null,
    customer_display_name: null,
  }),
  undefined,
  "a missing legacy presentation relation must not remove the Production work",
);

assert.match(productionOperatorContextSql, /WHERE w\.organization_id=\$1 AND w\.id=\$2/);
assert.match(productionOperatorContextSql, /l\.organization_id=w\.organization_id/);
assert.match(productionOperatorContextSql, /d\.organization_id=w\.organization_id/);
assert.match(productionOperatorContextSql, /c\.organization_id=d\.organization_id/);
assert.match(productionOperatorContextSql, /d\.requested_due_date::text requested_due_date/);
assert.match(productionOperatorContextSql, /l\.resolved_configuration->'dimensions' line_dimensions/);
assert.doesNotMatch(productionOperatorContextSql, /pricing_result|tree_json|SELECT \*|\b(?:INSERT|UPDATE|DELETE)\b/i);

const absent = { order_number: null, product_id: null, product_display_name: null, customer_id: null, customer_display_name: null };
for (const unit of ["in", "ft", "mm"] as const) {
  assert.deepEqual(productionOperatorContext({ ...absent, line_dimensions: { width: "2.25", height: "3", unit } }), { dimensions: { width: "2.25", height: "3", unit } });
}
for (const dimensions of [null, [], "24 x 36", { width: "24", unit: "in" }, { width: 24, height: 36, unit: "in" }, { width: "0", height: "36", unit: "in" }, { width: "-24", height: "36", unit: "in" }, { width: "NaN", height: "36", unit: "in" }, { width: "24", height: "36", unit: "cm" }, { presentation: { dimensions: "24 x 36 in" } }]) {
  assert.equal(productionOperatorContext({ ...absent, requested_due_date: null, line_dimensions: dimensions }), undefined, "missing or malformed dimensions must not be invented");
}
assert.deepEqual(productionOperatorContext({ ...absent, requested_due_date: "2026-10-20", line_dimensions: null }), { requestedDueDate: "2026-10-20" });

console.log("[m2.3] Production operator-context projection tests passed.");
