import assert from "node:assert/strict";
import { productionOperatorContext, productionOperatorContextSql } from "../../infrastructure/production/postgresProductionTransaction.js";

const complete = productionOperatorContext({
  order_number: "ORD-2042",
  product_id: "product-frozen",
  product_display_name: "Frozen order-line product",
  customer_id: "customer-a",
  customer_display_name: "Customer A",
});
assert.deepEqual(complete, {
  orderNumber: "ORD-2042",
  product: { productId: "product-frozen", displayName: "Frozen order-line product" },
  customer: { customerId: "customer-a", displayName: "Customer A" },
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

console.log("[m2.3] Production operator-context projection tests passed.");
