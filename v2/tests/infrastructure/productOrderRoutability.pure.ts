import assert from "node:assert/strict";
import { PostgresProductsCompatibilityReader } from "../../infrastructure/compatibility/postgresProductsRead.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

type Product = Readonly<{
  name: string;
  productTypeId: string | null;
  workflowIntent: "standard_production" | "fulfillment_only" | "service_fee";
  requiresProductionJob: boolean;
}>;

const readerFor = (product: Product, routing: "route_required" | "no_route") => new PostgresProductsCompatibilityReader({
  query: async <T>(sql: string) => {
    if (sql.includes("SELECT name,product_type_id,workflow_intent,requires_production_job FROM products"))
      return { rows: [{ name: product.name, product_type_id: product.productTypeId, workflow_intent: product.workflowIntent, requires_production_job: product.requiresProductionJob }] as T[] };
    if (sql.includes("FROM v2_product_version_routing_specs"))
      return { rows: [routing === "route_required"
        ? { routing_mode: "route_required", route_template_id: "template-1", source_template_revision: "1", source_template_fingerprint: "sha256:route", steps_json: [{ position: 0, kind: "production" }] }
        : { routing_mode: "no_route", route_template_id: null, source_template_revision: null, source_template_fingerprint: null, steps_json: null }] as T[] };
    if (sql.includes("SELECT name FROM v2_route_templates")) return { rows: [{ name: "Standard Production" }] as T[] };
    throw new Error(`Unexpected routability query: ${sql}`);
  },
} as never);

const org = brandedId<"OrganizationId">("tenant-a");
const productId = brandedId<"ProductId">("product-a");

const compatibilityRoute = await readerFor({ name: "Established Banner", productTypeId: null, workflowIntent: "standard_production", requiresProductionJob: true }, "route_required")
  .resolveOrderRoutability(org, productId, "version-a");
assert.equal(compatibilityRoute.kind, "routable", "a compatibility Product may convert only with its exact version-owned route");
if (compatibilityRoute.kind === "routable") {
  assert.equal(compatibilityRoute.productTypeId, undefined, "the resolver must not invent a Product Type");
  assert.equal(compatibilityRoute.routing.kind, "route_required");
}

const missingRoute = await readerFor({ name: "Unconfigured Banner", productTypeId: null, workflowIntent: "standard_production", requiresProductionJob: true }, "no_route")
  .resolveOrderRoutability(org, productId, "version-a");
assert.deepEqual(missingRoute, { kind: "unroutable", productName: "Unconfigured Banner" });

const fulfillmentOnly = await readerFor({ name: "Pickup handling", productTypeId: null, workflowIntent: "fulfillment_only", requiresProductionJob: false }, "no_route")
  .resolveOrderRoutability(org, productId, "version-a");
assert.equal(fulfillmentOnly.kind, "routable", "fulfillment-only Products do not require a production route");

console.log("Product Order routability compatibility tests passed.");
