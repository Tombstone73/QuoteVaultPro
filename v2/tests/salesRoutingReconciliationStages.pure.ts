import { strict as assert } from "node:assert";
import { r0265SalesAudit } from "../reconciliation/r0265SalesAudit.js";
import { r0266RoutingBilling } from "../reconciliation/r0266RoutingBilling.js";

const postconditionNames = (stage: { postconditions: readonly { name: string }[] }) => new Set(stage.postconditions.map(({ name }) => name));

assert.deepEqual(r0265SalesAudit.migrationFiles, [
  "0187_v2_sales_commercial_persistence.sql",
  "0188_v2_sales_customer_contact_reference_integrity.sql",
  "0189_v2_sales_document_and_conversion_integrity.sql",
  "0190_v2_sales_terms_single_owner.sql",
  "0191_v2_sales_subtype_and_terms_hardening.sql",
]);
assert(postconditionNames(r0265SalesAudit).has("no-automatic-v1-sales-import"));
assert(r0265SalesAudit.legacyDataPolicy.includes("Do not copy V1 quote/order/audit rows"));

assert.deepEqual(r0266RoutingBilling.migrationFiles, [
  "0193_v2_routing_identity_foundation.sql",
  "0194_v2_route_completed_current_step_repair.sql",
]);
assert(postconditionNames(r0266RoutingBilling).has("no-automatic-v1-routing-billing-import"));
assert(r0266RoutingBilling.legacyDataPolicy.includes("Do not copy V1 routes, invoices, payments, refunds"));

console.log("R0265/R0266 declarative reconciliation stage tests passed");
