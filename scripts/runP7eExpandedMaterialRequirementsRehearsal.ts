import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { requireV2M0CloneDatabaseUrl } from "../v2/infrastructure/persistence/cloneSafety.js";
import { PostgresProductRecipeReader } from "../v2/infrastructure/products/postgresProductRecipes.js";
import { PostgresQuoteTransactionRunner } from "../v2/infrastructure/sales/postgresQuoteTransaction.js";
import { PostgresOrderTransactionRunner } from "../v2/infrastructure/sales/postgresOrderTransaction.js";
import { PostgresQuoteConversionTransactionRunner } from "../v2/infrastructure/sales/postgresQuoteConversionTransaction.js";
import { QuoteApplicationService } from "../v2/src/modules/sales/quoteApplication.js";
import { QuoteConversionApplicationService } from "../v2/src/modules/sales/quoteConversionApplication.js";
import { OrderApplicationService } from "../v2/src/modules/sales/orderApplication.js";
import { resolveMaterialRequirements } from "../v2/src/modules/materials/materialRequirementResolver.js";
import { brandedId } from "../v2/src/modules/shared/commercialValues.js";
import type { OperationContext } from "../v2/src/application/operation.js";

const cloneHost = "ep-soft-frost-aef6c2jb-pooler.c-2.us-east-2.aws.neon.tech";
const request = (name: string) => `p7e-${name}-${randomUUID()}`;
const context = (organizationId: string, userId: string, requestId: string): OperationContext => ({
  organizationId,
  operationId: requestId,
  businessRequest: { id: requestId, payloadFingerprint: requestId },
  principal: {
    kind: "staff", organizationId, userId,
    authority: { membershipId: `p7e-${organizationId}`, capabilities: ["quote.create", "quote.edit", "quote.send", "quote.convert", "order.view", "order.edit"] as any },
  },
});
const assertOk = (result: unknown, message: string): asserts result => assert.ok(result, message);

type Candidate = Readonly<{
  organizationId: string;
  productId: string;
  versionId: string;
  customerId: string;
  contactId: string;
  userId: string;
  tree: unknown;
}>;

const selectedLamination = "matte";
const selections = { lamination_finish__import_mpmp06y8_7i6pl0s: selectedLamination };
const dimensions = { width: "24" as const, height: "36" as const, unit: "in" as const };
const sheetSelections = { "opt_opt_c1857862-93e5-48ed-b197-01e3109f7b2b": "choice_1" };
const sheetDimensions = { width: "24" as const, height: "18" as const, unit: "in" as const };

const acceptedQuote = async (quote: QuoteApplicationService, candidate: Candidate, label: string, line = { quantity: 2, dimensions, selections }) => {
  const createId = request(`${label}-create`);
  const created = await quote.create(context(candidate.organizationId, candidate.userId, createId), {
    businessRequestId: createId,
    customerContact: {
      organizationId: brandedId<"OrganizationId">(candidate.organizationId),
      customerId: brandedId<"CustomerId">(candidate.customerId),
      contactId: brandedId<"ContactId">(candidate.contactId),
    },
    purchaseOrderNumber: `P7E-${label}`,
    lines: [{ productId: candidate.productId, ...line }],
  });
  assertOk(created.ok, `P7E Quote creation failed: ${created.ok ? "" : `${created.error.code}: ${created.error.message}`}`);
  const sendId = request(`${label}-send`);
  const sent = await quote.send(context(candidate.organizationId, candidate.userId, sendId), {
    businessRequestId: sendId, quoteId: created.value.quote.quote.quoteId, expectedRevision: created.value.quote.revision,
  });
  assertOk(sent.ok, `P7E Quote send failed: ${sent.ok ? "" : sent.error.publicMessage}`);
  const acceptId = request(`${label}-accept`);
  const accepted = await quote.accept(context(candidate.organizationId, candidate.userId, acceptId), {
    businessRequestId: acceptId, quoteId: created.value.quote.quote.quoteId, expectedRevision: sent.value.quote.revision,
  });
  assertOk(accepted.ok && accepted.value.checkpointId, `P7E Quote acceptance failed: ${accepted.ok ? "missing checkpoint" : accepted.error.publicMessage}`);
  return { quoteId: created.value.quote.quote.quoteId, checkpointId: accepted.value.checkpointId!, revision: accepted.value.quote.revision };
};

const main = async (): Promise<void> => {
  const url = requireV2M0CloneDatabaseUrl();
  const target = new URL(url);
  assert.equal(target.hostname, cloneHost, "P7E rehearsal refuses a database other than the authorized MAIN-derived DEV clone.");
  assert.equal(target.pathname.replace(/^\//u, ""), "neondb", "P7E rehearsal refuses a database other than neondb.");
  const pool = new Pool({ connectionString: url, max: 5, application_name: "p7e-expanded-material-requirements-rehearsal" });
  try {
    const client = await pool.connect();
    try {
      const relation = (await client.query<{ requirements: string | null }>("SELECT to_regclass('public.v2_order_line_material_requirements') AS requirements")).rows[0];
      assertOk(relation?.requirements, "P7E setup is incomplete: frozen requirement relation is missing.");
      const candidate = (await client.query<Candidate>(`
        SELECT p.organization_id AS "organizationId",p.id AS "productId",active.id AS "versionId",active.tree_json AS tree,
          ccl.customer_id AS "customerId",ccl.contact_id AS "contactId",membership.user_id AS "userId"
        FROM products p
        JOIN pbv2_tree_versions active ON active.id=p.pbv2_active_tree_version_id AND active.organization_id=p.organization_id AND active.status='ACTIVE'
        JOIN customer_contact_links ccl ON ccl.organization_id=p.organization_id AND ccl.status='active'
        JOIN customers customer ON customer.id=ccl.customer_id AND customer.organization_id=ccl.organization_id AND customer.is_active=TRUE
        JOIN user_organizations membership ON membership.organization_id=p.organization_id AND membership.is_active=TRUE
        WHERE p.id='4523052a-7990-4d35-93d3-cac66e2bbe77'
        LIMIT 1
      `)).rows[0];
      assertOk(candidate, "P7E real PBV2 laminate representative is unavailable in the authorized clone.");
      const materialBefore = (await client.query<{ id: string; name: string; sku: string | null; stock_quantity: string }>(`
        SELECT id,name,sku,stock_quantity::text FROM materials
        WHERE organization_id=$1 AND id='0db42717-76c8-4721-a75b-64f28697d2b6'`, [candidate.organizationId])).rows[0];
      assertOk(materialBefore, "P7E selected PBV2 material is unavailable in the Product organization.");
      const materials = (await client.query<any>(`
        SELECT id,name,sku,material_form AS "materialForm",inventory_unit AS "inventoryUnit",consumption_unit AS "consumptionUnit",
          width,height,roll_length_ft AS "rollLengthFt",edge_waste_in_per_side AS "edgeWasteInPerSide",lead_waste_ft AS "leadWasteFt",tail_waste_ft AS "tailWasteFt"
        FROM materials WHERE organization_id=$1 AND id=$2 AND is_active=TRUE`, [candidate.organizationId, materialBefore.id])).rows;
      const recipe = await new PostgresProductRecipeReader(client).read(candidate.organizationId, candidate.productId, candidate.versionId);
      const direct = resolveMaterialRequirements(recipe, {
        lineId: "p7e-direct-real-line", productId: candidate.productId, quantity: 2,
        resolvedConfiguration: { pricingConfigurationId: candidate.versionId, productId: candidate.productId, dimensions, selections },
      } as any, { tree: candidate.tree as any, materials });
      const dynamic = direct.find((requirement) => requirement.sourceKind === "pbv2_inventory_consumption");
      assertOk(dynamic, "P7E did not resolve the real selected PBV2 inventory-consumption rule.");
      assert.equal(dynamic.quantity, "12", "P7E did not use the production area calculation for 24x36 x 2 lamination.");
      assert.equal(dynamic.unit, "square_foot", "P7E did not preserve the selected material inventory basis.");

      const quote = new QuoteApplicationService(new PostgresQuoteTransactionRunner(pool));
      const orders = new OrderApplicationService(new PostgresOrderTransactionRunner(pool));
      const conversion = new QuoteConversionApplicationService(new PostgresQuoteConversionTransactionRunner(pool), orders);
      const accepted = await acceptedQuote(quote, candidate, "real-freeze");
      const conversionId = request("real-convert");
      const command = { organizationId: brandedId<"OrganizationId">(candidate.organizationId), quoteId: accepted.quoteId, sourceCheckpointId: accepted.checkpointId, businessRequestId: brandedId<"BusinessRequestId">(conversionId), expectedStateToken: accepted.revision };
      const converted = await conversion.convert(context(candidate.organizationId, candidate.userId, conversionId), command);
      assertOk(converted.ok, `P7E conversion failed: ${converted.ok ? "" : converted.error.publicMessage}`);
      const replay = await conversion.convert(context(candidate.organizationId, candidate.userId, conversionId), command);
      assertOk(replay.ok && replay.value.orderId === converted.value.orderId, "P7E conversion replay did not return the authoritative Order.");
      const frozen = (await client.query<{ quantity: string; quantity_unit: string; source_definition_kind: string; source_definition_id: string; material_name_snapshot: string; material_sku_snapshot: string | null }>(`
        SELECT quantity::text,quantity_unit,source_definition_kind,source_definition_id,material_name_snapshot,material_sku_snapshot
        FROM v2_order_line_material_requirements
        WHERE organization_id=$1 AND order_document_id=$2 AND source_definition_kind='pbv2_inventory_consumption'
        ORDER BY id`, [candidate.organizationId, converted.value.orderId])).rows;
      assert.equal(frozen.length, 1, "P7E Order did not freeze exactly one selected PBV2 material requirement.");
      assert.deepEqual({ ...frozen[0], quantity: String(Number(frozen[0]!.quantity)) }, {
        quantity: dynamic.quantity, quantity_unit: dynamic.unit, source_definition_kind: "pbv2_inventory_consumption",
        source_definition_id: dynamic.sourceDefinitionId, material_name_snapshot: materialBefore.name, material_sku_snapshot: materialBefore.sku,
      }, "P7E frozen requirement diverged from the authoritative real PBV2 resolution.");
      const materialAfter = (await client.query<{ name: string; sku: string | null; stock_quantity: string }>("SELECT name,sku,stock_quantity::text FROM materials WHERE organization_id=$1 AND id=$2", [candidate.organizationId, materialBefore.id])).rows[0];
      assert.deepEqual(materialAfter, { name: materialBefore.name, sku: materialBefore.sku, stock_quantity: materialBefore.stock_quantity }, "P7E freeze mutated real Material metadata or stock.");

      // This real Coroplast choice is physically held as 48x96 sheets but its
      // established PBV2 rule expresses demand in finished square feet.  The
      // canonical normalizer must therefore freeze five sheets, not nine
      // finished square feet, for 24x18 x 50.
      const sheetCandidate = (await client.query<Candidate>(`
        SELECT p.organization_id AS "organizationId",p.id AS "productId",active.id AS "versionId",active.tree_json AS tree,
          ccl.customer_id AS "customerId",ccl.contact_id AS "contactId",membership.user_id AS "userId"
        FROM products p
        JOIN pbv2_tree_versions active ON active.id=p.pbv2_active_tree_version_id AND active.organization_id=p.organization_id AND active.status='ACTIVE'
        JOIN customer_contact_links ccl ON ccl.organization_id=p.organization_id AND ccl.status='active'
        JOIN customers customer ON customer.id=ccl.customer_id AND customer.organization_id=ccl.organization_id AND customer.is_active=TRUE
        JOIN user_organizations membership ON membership.organization_id=p.organization_id AND membership.is_active=TRUE
        WHERE p.id='df00792e-ab23-4516-baa3-9f174f69c495'
        LIMIT 1
      `)).rows[0];
      assertOk(sheetCandidate, "P7E real PBV2 sheet-yield representative is unavailable in the authorized clone.");
      const sheetMaterials = (await client.query<any>(`
        SELECT id,name,sku,material_form AS "materialForm",inventory_unit AS "inventoryUnit",consumption_unit AS "consumptionUnit",
          width,height,roll_length_ft AS "rollLengthFt",edge_waste_in_per_side AS "edgeWasteInPerSide",lead_waste_ft AS "leadWasteFt",tail_waste_ft AS "tailWasteFt"
        FROM materials WHERE organization_id=$1 AND id='6a80c943-9d26-484f-8cb4-cf4efcf1fa32' AND is_active=TRUE`, [sheetCandidate.organizationId])).rows;
      const sheetDirect = resolveMaterialRequirements(null, {
        lineId: "p7e-direct-sheet-line", productId: sheetCandidate.productId, quantity: 50,
        resolvedConfiguration: { pricingConfigurationId: sheetCandidate.versionId, productId: sheetCandidate.productId, dimensions: sheetDimensions, selections: sheetSelections },
      } as any, { tree: sheetCandidate.tree as any, materials: sheetMaterials });
      const sheetRequirement = sheetDirect.find((requirement) => requirement.sourceKind === "pbv2_inventory_consumption");
      assertOk(sheetRequirement, "P7E did not resolve the real selected PBV2 sheet-yield rule.");
      assert.deepEqual({ quantity: sheetRequirement.quantity, unit: sheetRequirement.unit }, { quantity: "5", unit: "sheet" }, "P7E did not normalize the real Coroplast area demand to five physical sheets.");
      const sheetAccepted = await acceptedQuote(quote, sheetCandidate, "real-sheet-freeze", { quantity: 50, dimensions: sheetDimensions, selections: sheetSelections });
      const sheetConversionId = request("real-sheet-convert");
      const sheetConverted = await conversion.convert(context(sheetCandidate.organizationId, sheetCandidate.userId, sheetConversionId), {
        organizationId: brandedId<"OrganizationId">(sheetCandidate.organizationId), quoteId: sheetAccepted.quoteId, sourceCheckpointId: sheetAccepted.checkpointId,
        businessRequestId: brandedId<"BusinessRequestId">(sheetConversionId), expectedStateToken: sheetAccepted.revision,
      });
      assertOk(sheetConverted.ok, `P7E sheet conversion failed: ${sheetConverted.ok ? "" : sheetConverted.error.publicMessage}`);
      const sheetFrozen = (await client.query<{ quantity: string; quantity_unit: string }>(`
        SELECT quantity::text,quantity_unit FROM v2_order_line_material_requirements
        WHERE organization_id=$1 AND order_document_id=$2 AND source_definition_kind='pbv2_inventory_consumption'`, [sheetCandidate.organizationId, sheetConverted.value.orderId])).rows;
      assert.deepEqual(sheetFrozen, [{ quantity: "5.000000", quantity_unit: "sheet" }], "P7E sheet requirement did not freeze its physical inventory unit.");

      const rollbackQuote = await acceptedQuote(quote, candidate, "rollback");
      const rollback = new QuoteConversionApplicationService(new PostgresQuoteConversionTransactionRunner(pool, { order: { afterMaterialRequirements: async () => { throw new Error("P7E injected requirement failure"); } } }), orders);
      const rollbackId = request("rollback");
      const failed = await rollback.convert(context(candidate.organizationId, candidate.userId, rollbackId), { organizationId: brandedId<"OrganizationId">(candidate.organizationId), quoteId: rollbackQuote.quoteId, sourceCheckpointId: rollbackQuote.checkpointId, businessRequestId: brandedId<"BusinessRequestId">(rollbackId), expectedStateToken: rollbackQuote.revision });
      assert.ok(!failed.ok, "P7E injected material failure converted an Order.");
      const residue = (await client.query<{ orders: string; requirements: string }>(`
        SELECT (SELECT count(*)::text FROM v2_sales_quote_conversions WHERE organization_id=$1 AND quote_document_id=$2) AS orders,
          (SELECT count(*)::text FROM v2_order_line_material_requirements r JOIN v2_sales_documents d ON d.id=r.order_document_id AND d.organization_id=r.organization_id WHERE r.organization_id=$1 AND d.purchase_order_number='P7E-rollback') AS requirements`, [candidate.organizationId, rollbackQuote.quoteId])).rows[0];
      assert.deepEqual(residue, { orders: "0", requirements: "0" }, "P7E rollback left an Order conversion or frozen requirement residue.");
      console.log(JSON.stringify({ product: "Reflective Vinyl - Nikkalite", configuration: selections, dimensions, quantity: 2, resolved: { material: dynamic.materialName, quantity: dynamic.quantity, unit: dynamic.unit }, orderId: converted.value.orderId, sheetProduct: "Coroplast", sheetConfiguration: sheetSelections, sheetDimensions, sheetQuantity: 50, sheetResolved: { quantity: sheetRequirement.quantity, unit: sheetRequirement.unit }, sheetOrderId: sheetConverted.value.orderId, replay: "same-order", rollback: "clean" }, null, 2));
      console.log("[p7e] Real PBV2 expanded material-requirement freeze rehearsal passed.");
    } finally { client.release(); }
  } finally { await pool.end(); }
};

void main().catch((error: unknown) => {
  console.error(`[p7e] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
