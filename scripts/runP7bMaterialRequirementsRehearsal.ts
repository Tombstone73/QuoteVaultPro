import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { requireV2M0CloneDatabaseUrl } from "../v2/infrastructure/persistence/cloneSafety.js";
import { PostgresProductRecipeReader } from "../v2/infrastructure/products/postgresProductRecipes.js";
import { PostgresProductRecipeTransactionRunner } from "../v2/infrastructure/products/postgresProductRecipes.js";
import { PostgresProductVersionTransactionRunner } from "../v2/infrastructure/products/postgresProductVersionLifecycle.js";
import { PostgresQuoteTransactionRunner } from "../v2/infrastructure/sales/postgresQuoteTransaction.js";
import { PostgresOrderTransactionRunner } from "../v2/infrastructure/sales/postgresOrderTransaction.js";
import { PostgresQuoteConversionTransactionRunner } from "../v2/infrastructure/sales/postgresQuoteConversionTransaction.js";
import { QuoteApplicationService } from "../v2/src/modules/sales/quoteApplication.js";
import { QuoteConversionApplicationService } from "../v2/src/modules/sales/quoteConversionApplication.js";
import { OrderApplicationService } from "../v2/src/modules/sales/orderApplication.js";
import { brandedId } from "../v2/src/modules/shared/commercialValues.js";
import { resolveMaterialRequirements } from "../v2/src/modules/materials/materialRequirementResolver.js";
import { ProductRecipeApplicationService } from "../v2/src/modules/products/productRecipes.js";
import { ProductVersionLifecycleApplicationService } from "../v2/src/modules/products/productVersionLifecycle.js";
import type { OperationContext } from "../v2/src/application/operation.js";

const cloneHost = "ep-soft-frost-aef6c2jb-pooler.c-2.us-east-2.aws.neon.tech";
const assertOk = (value: unknown, message: string): asserts value => assert.ok(value, message);
const request = (label: string) => `p7b-${label}-${randomUUID()}`;

const context = (organizationId: string, userId: string, requestId: string): OperationContext => ({
  organizationId,
  operationId: requestId,
  businessRequest: { id: requestId, payloadFingerprint: requestId },
  principal: {
    kind: "staff", organizationId, userId,
    authority: { membershipId: `p7b-${organizationId}`, capabilities: ["product.edit", "quote.create", "quote.edit", "quote.send", "quote.convert", "order.view", "order.edit"] as any },
  },
});

type Fixture = Readonly<{ organizationId: string; userId: string; customerId: string; contactId: string; productId: string; versionId: string; recipeId: string; primaryMaterialId: string; primaryName: string }>;

const fixture = async (client: PoolClient): Promise<Fixture> => {
  const suffix = randomUUID();
  const organizationId = `p7b-org-${suffix}`, userId = `p7b-user-${suffix}`;
  const customerId = `p7b-customer-${suffix}`, contactId = `p7b-contact-${suffix}`;
  const productTypeId = `p7b-type-${suffix}`, productId = `p7b-product-${suffix}`, versionId = `p7b-version-${suffix}`;
  const recipeId = `p7b-recipe-${suffix}`, primaryMaterialId = `p7b-material-stock-${suffix}`, secondaryMaterialId = `p7b-material-grommets-${suffix}`;
  const primaryName = "P7B stock";
  const tree = {
    schemaVersion: 2,
    rootNodeIds: ["finish"],
    nodes: {
      finish: {
        id: "finish", kind: "question", label: "Finish",
        input: { type: "select", selectionKey: "finish", defaultValue: "standard" },
        choices: [{ value: "standard", label: "Standard" }],
      },
    },
    meta: { pricingV2: { base: { perPieceCents: 1000 } } },
  };
  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO organizations(id,name,slug) VALUES($1,$2,$3)", [organizationId, "P7B rehearsal", `p7b-${suffix}`]);
    await client.query("INSERT INTO users(id,email,role) VALUES($1,$2,'owner')", [userId, `${userId}@example.test`]);
    await client.query("INSERT INTO user_organizations(user_id,organization_id,role,is_active) VALUES($1,$2,'owner',true)", [userId, organizationId]);
    await client.query("INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'P7B Customer','P7B Customer',true,'active')", [customerId, organizationId]);
    await client.query("INSERT INTO customer_contacts(id,organization_id,first_name,last_name,status) VALUES($1,$2,'P7B','Contact','active')", [contactId, organizationId]);
    await client.query("INSERT INTO customer_contact_links(organization_id,customer_id,contact_id,status) VALUES($1,$2,$3,'active')", [organizationId, customerId, contactId]);
    await client.query("INSERT INTO product_types(id,organization_id,name,routing_mode) VALUES($1,$2,'P7B Service','no_route')", [productTypeId, organizationId]);
    await client.query("INSERT INTO products(id,organization_id,name,description,is_active,measurement_mode,product_type_id) VALUES($1,$2,'P7B Product','P7B Product',true,'quantity_only',$3)", [productId, organizationId, productTypeId]);
    await client.query("INSERT INTO pbv2_tree_versions(id,organization_id,product_id,status,schema_version,tree_json,published_at) VALUES($1,$2,$3,'ACTIVE',2,$4::jsonb,now())", [versionId, organizationId, productId, JSON.stringify(tree)]);
    await client.query("UPDATE products SET pbv2_active_tree_version_id=$1 WHERE organization_id=$2 AND id=$3", [versionId, organizationId, productId]);
    await client.query("INSERT INTO materials(id,organization_id,name,sku,type,cost_per_unit,is_active) VALUES($1,$2,$3,'P7B-STOCK','sheet',1,true),($4,$2,'P7B grommet','P7B-GROMMET','consumable',1,true)", [primaryMaterialId, organizationId, primaryName, secondaryMaterialId]);
    await client.query("INSERT INTO v2_product_recipes(id,organization_id,product_id,product_version_id,updated_by_user_id) VALUES($1,$2,$3,$4,$5)", [recipeId, organizationId, productId, versionId, userId]);
    await client.query("INSERT INTO v2_product_recipe_components(id,organization_id,recipe_id,material_id,position,quantity,quantity_unit,quantity_kind,material_name_snapshot,material_sku_snapshot) VALUES($1,$2,$3,$4,0,1,'sheet','per_line',$5,'P7B-STOCK'),($6,$2,$3,$7,1,2,'each','per_piece','P7B grommet','P7B-GROMMET')", [
      `p7b-component-stock-${suffix}`, organizationId, recipeId, primaryMaterialId, primaryName,
      `p7b-component-grommet-${suffix}`, secondaryMaterialId,
    ]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  return { organizationId, userId, customerId, contactId, productId, versionId, recipeId, primaryMaterialId, primaryName };
};

const acceptedQuote = async (quote: QuoteApplicationService, f: Fixture, label: string) => {
  const createId = request(`${label}-create`);
  const customerContact = { organizationId: brandedId<"OrganizationId">(f.organizationId), customerId: brandedId<"CustomerId">(f.customerId), contactId: brandedId<"ContactId">(f.contactId) };
  const created = await quote.create(context(f.organizationId, f.userId, createId), { businessRequestId: createId, customerContact, purchaseOrderNumber: `P7B-${label}`, lines: [{ productId: f.productId, quantity: 100 }] });
  assertOk(created.ok, `P7B Quote creation failed: ${created.ok ? "" : created.error.publicMessage}`);
  const sendId = request(`${label}-send`);
  const sent = await quote.send(context(f.organizationId, f.userId, sendId), { businessRequestId: sendId, quoteId: created.value.quote.quote.quoteId, expectedRevision: created.value.quote.revision });
  assertOk(sent.ok, `P7B Quote send failed: ${sent.ok ? "" : sent.error.publicMessage}`);
  const acceptId = request(`${label}-accept`);
  const accepted = await quote.accept(context(f.organizationId, f.userId, acceptId), { businessRequestId: acceptId, quoteId: created.value.quote.quote.quoteId, expectedRevision: sent.value.quote.revision });
  assertOk(accepted.ok && accepted.value.checkpointId, `P7B Quote acceptance failed: ${accepted.ok ? "missing checkpoint" : accepted.error.publicMessage}`);
  return { quoteId: created.value.quote.quote.quoteId, checkpointId: accepted.value.checkpointId!, revision: accepted.value.quote.revision };
};

const main = async (): Promise<void> => {
  const url = requireV2M0CloneDatabaseUrl();
  const target = new URL(url);
  assert.equal(target.hostname, cloneHost, "P7B rehearsal refuses a database other than the authorized MAIN-derived DEV clone.");
  assert.equal(target.pathname.replace(/^\//u, ""), "neondb", "P7B rehearsal refuses a database other than neondb.");
  const pool = new Pool({ connectionString: url, max: 4, application_name: "p7b-material-requirements-rehearsal" });
  try {
    const client = await pool.connect();
    try {
      const relations = (await client.query<{ recipes: string | null; components: string | null; requirements: string | null }>("SELECT to_regclass('public.v2_product_recipes') recipes,to_regclass('public.v2_product_recipe_components') components,to_regclass('public.v2_order_line_material_requirements') requirements")).rows[0]!;
      assertOk(relations.recipes && relations.components && relations.requirements, "P7B setup is incomplete: required recipe or requirement relations are missing.");

      // The real MAIN-derived catalog is read first.  This confirms P7B does
      // not require a special synthetic PBV2 shape to resolve an existing
      // version-bound recipe.  The isolated fixture below exercises the full
      // commercial transaction without writing into production-derived rows.
      const real = (await client.query<{ organization_id: string; product_id: string; product_version_id: string }>(
        "SELECT organization_id,product_id,product_version_id FROM v2_product_recipes ORDER BY created_at LIMIT 1",
      )).rows[0];
      assertOk(real, "The authorized clone has no version-bound P7A recipe to resolve.");
      const realRecipe = await new PostgresProductRecipeReader(client).read(real.organization_id, real.product_id, real.product_version_id);
      assertOk(realRecipe, "A real clone recipe could not be read.");
      const realRequirements = resolveMaterialRequirements(realRecipe, { productId: real.product_id, lineId: "p7b-real-line", quantity: 2, resolvedConfiguration: { pricingConfigurationId: real.product_version_id } } as any);
      assert.equal(realRequirements.length, realRecipe.components.length, "Real recipe resolution did not preserve all components.");

      const f = await fixture(client);
      const stockBefore = (await client.query<{ id: string; stock_quantity: string }>("SELECT id,stock_quantity::text FROM materials WHERE organization_id=$1 ORDER BY id", [f.organizationId])).rows;
      const quote = new QuoteApplicationService(new PostgresQuoteTransactionRunner(pool));
      const orders = new OrderApplicationService(new PostgresOrderTransactionRunner(pool));
      const conversion = new QuoteConversionApplicationService(new PostgresQuoteConversionTransactionRunner(pool), orders);
      const first = await acceptedQuote(quote, f, "freeze");
      const conversionId = request("convert");
      const command = { organizationId: brandedId<"OrganizationId">(f.organizationId), quoteId: first.quoteId, sourceCheckpointId: first.checkpointId, businessRequestId: brandedId<"BusinessRequestId">(conversionId), expectedStateToken: first.revision };
      const converted = await conversion.convert(context(f.organizationId, f.userId, conversionId), command);
      assertOk(converted.ok, `P7B conversion failed: ${converted.ok ? "" : converted.error.publicMessage}`);
      const replay = await conversion.convert(context(f.organizationId, f.userId, conversionId), command);
      assertOk(replay.ok && replay.value.orderId === converted.value.orderId, "P7B conversion replay created a different Order.");
      const requirements = (await client.query<{ quantity: string; quantity_mode: string; material_name_snapshot: string; source_recipe_id: string; source_product_version_id: string }>(
        "SELECT quantity::text,quantity_mode,material_name_snapshot,source_recipe_id,source_product_version_id FROM v2_order_line_material_requirements WHERE organization_id=$1 AND order_document_id=$2 ORDER BY quantity_mode",
        [f.organizationId, converted.value.orderId],
      )).rows;
      assert.deepEqual(requirements.map((row) => ({ quantity: row.quantity, quantityMode: row.quantity_mode })), [{ quantity: "1.000000", quantityMode: "per_line" }, { quantity: "200.000000", quantityMode: "per_piece" }], "P7B did not freeze the exact fixed/per-piece quantities.");
      assertOk(requirements.every((row) => row.source_recipe_id === f.recipeId && row.source_product_version_id === f.versionId), "P7B requirements lost recipe/version lineage.");
      assert.equal(requirements[0]?.material_name_snapshot, f.primaryName, "P7B did not persist the recipe Material snapshot.");

      await client.query("UPDATE materials SET name='P7B stock renamed' WHERE organization_id=$1 AND id=$2", [f.organizationId, f.primaryMaterialId]);
      const frozenName = (await client.query<{ material_name_snapshot: string }>("SELECT material_name_snapshot FROM v2_order_line_material_requirements WHERE organization_id=$1 AND order_document_id=$2 AND material_id=$3", [f.organizationId, converted.value.orderId, f.primaryMaterialId])).rows[0]?.material_name_snapshot;
      assert.equal(frozenName, f.primaryName, "Mutable Material metadata changed frozen Order requirements.");

      const active = (await client.query<{ updated_at: Date }>("SELECT updated_at FROM pbv2_tree_versions WHERE organization_id=$1 AND id=$2 AND status='ACTIVE'", [f.organizationId, f.versionId])).rows[0]!;
      const lifecycle = new ProductVersionLifecycleApplicationService(new PostgresProductVersionTransactionRunner(pool));
      const draftRequest = request("product-draft");
      const draftCreated = await lifecycle.createDraft(context(f.organizationId, f.userId, draftRequest), { productId: f.productId, businessRequestId: draftRequest, expectedActiveVersionUpdatedAt: active.updated_at.toISOString() });
      assertOk(draftCreated.ok, "P7B could not prepare a later Product Draft.");
      const draft = (await client.query<{ id: string; updated_at: Date }>("SELECT id,updated_at FROM pbv2_tree_versions WHERE organization_id=$1 AND product_id=$2 AND status='DRAFT' ORDER BY updated_at DESC,id DESC LIMIT 1", [f.organizationId, f.productId])).rows[0]!;
      const draftRecipeRequest = request("draft-recipe");
      const draftRecipe = await new ProductRecipeApplicationService(new PostgresProductRecipeTransactionRunner(pool)).updateDraftRecipe(context(f.organizationId, f.userId, draftRecipeRequest), {
        productId: f.productId, draftVersionId: draft.id, expectedDraftUpdatedAt: draft.updated_at.toISOString(), businessRequestId: draftRecipeRequest,
        components: [{ materialId: f.primaryMaterialId, quantity: "99", unit: "sheet", quantityKind: "per_line" }],
      });
      assertOk(draftRecipe.ok, "P7B could not change the later Draft recipe.");
      const frozenAfterDraft = (await client.query<{ quantity: string; quantity_mode: string; material_name_snapshot: string }>("SELECT quantity::text,quantity_mode,material_name_snapshot FROM v2_order_line_material_requirements WHERE organization_id=$1 AND order_document_id=$2 ORDER BY quantity_mode", [f.organizationId, converted.value.orderId])).rows;
      assert.deepEqual(frozenAfterDraft, requirements.map(({ quantity, quantity_mode, material_name_snapshot }) => ({ quantity, quantity_mode, material_name_snapshot })), "A later Product Draft changed frozen Order requirements.");

      const failedQuote = await acceptedQuote(quote, f, "rollback");
      const rollbackConversion = new QuoteConversionApplicationService(new PostgresQuoteConversionTransactionRunner(pool, { order: { afterMaterialRequirements: async () => { throw new Error("P7B injected requirement failure"); } } }), orders);
      const failureId = request("rollback-convert");
      const failed = await rollbackConversion.convert(context(f.organizationId, f.userId, failureId), { organizationId: brandedId<"OrganizationId">(f.organizationId), quoteId: failedQuote.quoteId, sourceCheckpointId: failedQuote.checkpointId, businessRequestId: brandedId<"BusinessRequestId">(failureId), expectedStateToken: failedQuote.revision });
      assert.ok(!failed.ok, "Injected P7B requirement failure converted an Order.");
      const rollbackCounts = (await client.query<{ orders: string; requirements: string }>(`SELECT
        (SELECT count(*)::text FROM v2_sales_quote_conversions WHERE organization_id=$1 AND quote_document_id=$2) orders,
        (SELECT count(*)::text FROM v2_order_line_material_requirements r JOIN v2_sales_documents d ON d.id=r.order_document_id AND d.organization_id=r.organization_id WHERE r.organization_id=$1 AND d.purchase_order_number='P7B-rollback') requirements`, [f.organizationId, failedQuote.quoteId])).rows[0]!;
      assert.deepEqual(rollbackCounts, { orders: "0", requirements: "0" }, "P7B requirement failure left a partial conversion or orphan requirement rows.");
      const foreign = (await client.query<{ id: string }>("SELECT id FROM organizations WHERE id<>$1 ORDER BY id LIMIT 1", [f.organizationId])).rows[0]?.id;
      assertOk(foreign, "P7B rehearsal needs a second organization.");
      const hidden = await client.query("SELECT id FROM v2_order_line_material_requirements WHERE organization_id=$1 AND order_document_id=$2", [foreign, converted.value.orderId]);
      assert.equal(hidden.rowCount, 0, "P7B requirement reads crossed the organization boundary.");
      const stockAfter = (await client.query<{ id: string; stock_quantity: string }>("SELECT id,stock_quantity::text FROM materials WHERE organization_id=$1 ORDER BY id", [f.organizationId])).rows;
      assert.deepEqual(stockAfter, stockBefore, "P7B requirement resolution mutated Material inventory.");
      console.log(JSON.stringify({ realRecipeComponents: realRecipe.components.length, frozenRequirements: requirements.length, orderId: converted.value.orderId, replay: "same-order", rollback: "clean" }, null, 2));
      console.log("[p7b] Material requirement resolver and Quote-to-Order freeze rehearsal passed.");
    } finally { client.release(); }
  } finally { await pool.end(); }
};

void main().catch((error: unknown) => {
  console.error(`[p7b] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
