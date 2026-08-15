import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { requireV2M0CloneDatabaseUrl } from "../infrastructure/persistence/cloneSafety.js";
import { PostgresCustomersCompatibilityReader } from "../infrastructure/compatibility/postgresCustomersRead.js";
import { PostgresProductsCompatibilityReader } from "../infrastructure/compatibility/postgresProductsRead.js";
import { V2PricingParityAdapter } from "../src/modules/pricing/v2PricingAdapter.js";
import { brandedId } from "../src/modules/shared/commercialValues.js";

/**
 * Guarded disposable-clone rehearsal. Production readers remain SELECT-only;
 * fixture rows exist only inside this transaction and are always rolled back.
 */
async function main(): Promise<void> {
  const url = requireV2M0CloneDatabaseUrl();
  const pool = new Pool({ connectionString: url, max: 1 });
  const run = randomUUID();
  const client = await pool.connect();
  try {
    const organizations = await client.query<{ id: string }>("SELECT id FROM organizations ORDER BY id LIMIT 2");
    if (organizations.rows.length < 2) throw new Error("Approved clone needs two organizations for M1.3 tenant-isolation rehearsal.");
    const [a, b] = organizations.rows;
    const orgA = a!.id;
    const orgB = b!.id;
    const ids = {
      customer: `m13-customer-${run}`, otherCustomer: `m13-other-customer-${run}`, contact: `m13-contact-${run}`, otherContact: `m13-other-contact-${run}`, foreignContact: `m13-foreign-contact-${run}`,
      product: `m13-product-${run}`, otherProduct: `m13-other-product-${run}`, inactiveProduct: `m13-inactive-product-${run}`, tree: `m13-tree-${run}`, inactiveTree: `m13-inactive-tree-${run}`, foreignTree: `m13-foreign-tree-${run}`,
      productType: `m13-type-${run}`, formula: `m13-formula-${run}`, foreignFormula: `m13-foreign-formula-${run}`, blankFormula: `m13-blank-formula-${run}`,
    };
    await client.query("BEGIN");
    await client.query("INSERT INTO customers (id, organization_id, company_name, display_name, is_active, status) VALUES ($1, $2, 'M1.3 Fixture', 'M1.3 Fixture', true, 'active')", [ids.customer, orgA]);
    await client.query("INSERT INTO customers (id, organization_id, company_name, display_name, is_active, status) VALUES ($1, $2, 'M1.3 Other Customer', 'M1.3 Other Customer', true, 'active')", [ids.otherCustomer, orgA]);
    await client.query("INSERT INTO customer_contacts (id, organization_id, first_name, last_name, email, status) VALUES ($1, $2, 'M1', 'Contact', 'm13@example.test', 'active')", [ids.contact, orgA]);
    await client.query("INSERT INTO customer_contacts (id, organization_id, first_name, last_name, email, status) VALUES ($1, $2, 'M1', 'Other Contact', 'm13-other@example.test', 'active')", [ids.otherContact, orgA]);
    await client.query("INSERT INTO customer_contacts (id, organization_id, first_name, last_name, email, status) VALUES ($1, $2, 'M1', 'Foreign Contact', 'm13-foreign@example.test', 'active')", [ids.foreignContact, orgB]);
    await client.query("INSERT INTO customer_contact_links (organization_id, customer_id, contact_id, status) VALUES ($1, $2, $3, 'active')", [orgA, ids.customer, ids.contact]);
    await client.query("INSERT INTO customer_contact_links (organization_id, customer_id, contact_id, status) VALUES ($1, $2, $3, 'active')", [orgA, ids.otherCustomer, ids.otherContact]);
    const tree = { schemaVersion: 2, rootNodeIds: [], nodes: {}, meta: { fixedDimensions: { widthIn: 24, heightIn: 18, unit: "in" }, pricingV2: { base: { perSqftCents: 100 } } } };
    await client.query("INSERT INTO product_types (id, organization_id, name) VALUES ($1, $2, 'M1.3 Type')", [ids.productType, orgA]);
    await client.query("INSERT INTO products (id, organization_id, name, description, is_active, measurement_mode) VALUES ($1, $2, 'M1.3 Coroplast', 'Rehearsal only', true, 'dimensions_required')", [ids.product, orgA]);
    await client.query("INSERT INTO products (id, organization_id, name, description, is_active, measurement_mode) VALUES ($1, $2, 'M1.3 Other Product', 'Rehearsal only', true, 'dimensions_required')", [ids.otherProduct, orgA]);
    await client.query("INSERT INTO products (id, organization_id, name, description, is_active, measurement_mode) VALUES ($1, $2, 'M1.3 Inactive Product', 'Rehearsal only', false, 'dimensions_required')", [ids.inactiveProduct, orgA]);
    await client.query("INSERT INTO pbv2_tree_versions (id, organization_id, product_id, status, schema_version, tree_json, published_at) VALUES ($1, $2, $3, 'ACTIVE', 2, $4::jsonb, now())", [ids.tree, orgA, ids.product, JSON.stringify(tree)]);
    await client.query("INSERT INTO pbv2_tree_versions (id, organization_id, product_id, status, schema_version, tree_json, published_at) VALUES ($1, $2, $3, 'DRAFT', 2, $4::jsonb, now())", [ids.inactiveTree, orgA, ids.inactiveProduct, JSON.stringify(tree)]);
    await client.query("INSERT INTO pbv2_tree_versions (id, organization_id, product_id, status, schema_version, tree_json, published_at) VALUES ($1, $2, $3, 'ACTIVE', 2, $4::jsonb, now())", [ids.foreignTree, orgA, ids.otherProduct, JSON.stringify(tree)]);
    await client.query("UPDATE products SET pbv2_active_tree_version_id = $1 WHERE organization_id = $2 AND id = $3", [ids.tree, orgA, ids.product]);
    await client.query("UPDATE products SET pbv2_active_tree_version_id = $1 WHERE organization_id = $2 AND id = $3", [ids.inactiveTree, orgA, ids.inactiveProduct]);

    const customers = new PostgresCustomersCompatibilityReader(client);
    const products = new PostgresProductsCompatibilityReader(client);
    if (!await customers.validateContactReference({ organizationId: brandedId<"OrganizationId">(orgA), customerId: brandedId<"CustomerId">(ids.customer), contactId: brandedId<"ContactId">(ids.contact) })) throw new Error("Scoped CRM read failed.");
    if (await customers.getCustomer(brandedId<"OrganizationId">(orgB), brandedId<"CustomerId">(ids.customer))) throw new Error("Foreign customer read leaked.");
    if (await customers.getContact(brandedId<"OrganizationId">(orgA), brandedId<"ContactId">(ids.foreignContact))) throw new Error("Foreign contact read leaked.");
    if (await customers.validateContactReference({ organizationId: brandedId<"OrganizationId">(orgA), customerId: brandedId<"CustomerId">(ids.otherCustomer), contactId: brandedId<"ContactId">(ids.contact) })) throw new Error("Cross-customer contact substitution leaked.");
    await client.query("UPDATE customers SET status = 'archived' WHERE organization_id = $1 AND id = $2", [orgA, ids.otherCustomer]);
    if (await customers.getCustomer(brandedId<"OrganizationId">(orgA), brandedId<"CustomerId">(ids.otherCustomer))) throw new Error("Inactive customer read leaked.");
    await client.query("UPDATE customer_contacts SET status = 'archived' WHERE organization_id = $1 AND id = $2", [orgA, ids.contact]);
    if (await customers.validateContactReference({ organizationId: brandedId<"OrganizationId">(orgA), customerId: brandedId<"CustomerId">(ids.customer), contactId: brandedId<"ContactId">(ids.contact) })) throw new Error("Inactive contact relationship leaked.");
    await client.query("UPDATE customer_contacts SET status = 'active' WHERE organization_id = $1 AND id = $2", [orgA, ids.contact]);
    const input = await products.resolveActivePricingInput({ organizationId: brandedId<"OrganizationId">(orgA), productId: brandedId<"ProductId">(ids.product), quantity: 1 });
    if (!input.ok) throw input.error;
    if ((await products.resolveActivePricingInput({ organizationId: brandedId<"OrganizationId">(orgB), productId: brandedId<"ProductId">(ids.product), quantity: 1 })).ok) throw new Error("Foreign product/configuration read leaked.");
    if ((await products.resolveActivePricingInput({ organizationId: brandedId<"OrganizationId">(orgA), productId: brandedId<"ProductId">(ids.inactiveProduct), quantity: 1 })).ok) throw new Error("Inactive Product/tree read leaked.");
    await client.query("UPDATE products SET pbv2_active_tree_version_id = $1 WHERE organization_id = $2 AND id = $3", [ids.foreignTree, orgA, ids.product]);
    if ((await products.resolveActivePricingInput({ organizationId: brandedId<"OrganizationId">(orgA), productId: brandedId<"ProductId">(ids.product), quantity: 1 })).ok) throw new Error("Same-org wrong-Product active tree leaked.");
    await client.query("UPDATE products SET pbv2_active_tree_version_id = $1 WHERE organization_id = $2 AND id = $3", [ids.tree, orgA, ids.product]);
    if (!await products.resolveProductType(brandedId<"OrganizationId">(orgA), brandedId<"ProductTypeId">(ids.productType))) throw new Error("Scoped Product Type read failed.");
    if (await products.resolveProductType(brandedId<"OrganizationId">(orgB), brandedId<"ProductTypeId">(ids.productType))) throw new Error("Foreign Product Type read leaked.");
    await client.query("INSERT INTO pricing_formulas (id, organization_id, name, pricing_profile_key, expression, is_active) VALUES ($1, $2, 'M1.3 Formula', 'default', 'ceil(sqft) * base_price', true)", [ids.formula, orgA]);
    await client.query("INSERT INTO pricing_formulas (id, organization_id, name, pricing_profile_key, expression, is_active) VALUES ($1, $2, 'M1.3 Foreign Formula', 'default', 'ceil(sqft) * base_price', true)", [ids.foreignFormula, orgB]);
    await client.query("INSERT INTO pricing_formulas (id, organization_id, name, pricing_profile_key, expression, is_active) VALUES ($1, $2, 'M1.3 Blank Formula', 'default', ' ', true)", [ids.blankFormula, orgA]);
    await client.query("UPDATE products SET pricing_formula_id = $1 WHERE organization_id = $2 AND id = $3", [ids.foreignFormula, orgA, ids.product]);
    if ((await products.resolveActivePricingInput({ organizationId: brandedId<"OrganizationId">(orgA), productId: brandedId<"ProductId">(ids.product), quantity: 1 })).ok) throw new Error("Foreign Formula association leaked.");
    await client.query("UPDATE products SET pricing_formula_id = $1 WHERE organization_id = $2 AND id = $3", [ids.blankFormula, orgA, ids.product]);
    if ((await products.resolveActivePricingInput({ organizationId: brandedId<"OrganizationId">(orgA), productId: brandedId<"ProductId">(ids.product), quantity: 1 })).ok) throw new Error("Blank Formula expression did not fail closed.");
    await client.query("UPDATE pricing_formulas SET is_active = false WHERE organization_id = $1 AND id = $2", [orgA, ids.formula]);
    await client.query("UPDATE products SET pricing_formula_id = $1 WHERE organization_id = $2 AND id = $3", [ids.formula, orgA, ids.product]);
    if ((await products.resolveActivePricingInput({ organizationId: brandedId<"OrganizationId">(orgA), productId: brandedId<"ProductId">(ids.product), quantity: 1 })).ok) throw new Error("Inactive Formula association leaked.");
    await client.query("UPDATE products SET pricing_formula_id = NULL WHERE organization_id = $1 AND id = $2", [orgA, ids.product]);
    const price = await new V2PricingParityAdapter().calculate({ organizationId: brandedId<"OrganizationId">(orgA), sellableProduct: input.value.sellableProduct, resolvedConfiguration: input.value.resolvedConfiguration, rules: input.value.rules, pricingContext: { channel: "staff", effectiveAt: "2026-08-15T00:00:00.000Z" } });
    if (price.calculatedLineAmount.cents !== 300) throw new Error("Read-to-Pricing Coroplast rehearsal drifted.");
    console.log("[m1.3-postgres] scoped CRM/Product/PBV2 read rehearsal passed.");
  } finally {
    try { await client.query("ROLLBACK"); } catch { /* transaction may not have begun */ }
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`[m1.3-postgres] rehearsal failed: ${error instanceof Error ? error.message : "unknown failure"}`);
  process.exitCode = 1;
});
