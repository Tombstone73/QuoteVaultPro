import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { requireV2M0CloneDatabaseUrl } from "../infrastructure/persistence/cloneSafety.js";
import { PostgresInventoryLedgerTransactionRunner } from "../infrastructure/inventory/postgresInventoryLedgerTransaction.js";
import { PostgresProductionMaterialConsumptionTransactionRunner } from "../infrastructure/production/postgresMaterialConsumptionTransaction.js";
import { InventoryLedgerApplicationService } from "../src/modules/inventory/inventoryLedger.js";
import { ProductionMaterialConsumptionApplicationService } from "../src/modules/production/materialConsumption.js";
import { brandedId } from "../src/modules/shared/commercialValues.js";
import type { OperationContext } from "../src/application/operation.js";

const cloneHost = "ep-soft-frost-aef6c2jb-pooler.c-2.us-east-2.aws.neon.tech";
const request = (label: string) => `p7d-reservation-unit-${label}-${randomUUID()}`;
const context = (organizationId: string, userId: string, id: string): OperationContext => ({ organizationId, operationId: id, businessRequest: { id, payloadFingerprint: id }, principal: { kind: "staff", organizationId, userId, authority: { membershipId: `p7d-${organizationId}`, capabilities: ["production.work"] as any } } });

const main = async () => {
  const url = requireV2M0CloneDatabaseUrl();
  assert.equal(new URL(url).hostname, cloneHost, "P7D inventory-unit rehearsal refuses a non-clone database.");
  const pool = new Pool({ connectionString: url, max: 4, application_name: "p7d-reservation-inventory-unit-rehearsal" });
  const x = randomUUID(), org = `p7d-unit-${x}`, user = `p7d-unit-user-${x}`, customer = `p7d-unit-customer-${x}`, type = `p7d-unit-type-${x}`, product = `p7d-unit-product-${x}`, version = `p7d-unit-version-${x}`, recipe = `p7d-unit-recipe-${x}`, component = `p7d-unit-component-${x}`, material = `p7d-unit-styrene-${x}`, order = `p7d-unit-order-${x}`, line = `p7d-unit-line-${x}`, requirement = `p7d-unit-requirement-${x}`, file = `p7d-unit-file-${x}`, art = `p7d-unit-art-${x}`, work = `p7d-unit-work-${x}`, attempt = `p7d-unit-attempt-${x}`;
  const tree = { schemaVersion: 2, rootNodeIds: ["finish"], nodes: { finish: { id: "finish", kind: "question", label: "Finish", input: { type: "select", valueType: "enum", selectionKey: "finish", defaultValue: "standard" }, choices: [{ value: "standard", label: "Standard" }] } }, meta: { pricingV2: { base: { perPieceCents: 100 } } } };
  try {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("INSERT INTO organizations(id,name,slug) VALUES($1,'P7D inventory unit',$1)", [org]);
      await c.query("INSERT INTO users(id,email,role) VALUES($1,$2,'owner')", [user, `${user}@test`]);
      await c.query("INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'P7D inventory unit','P7D inventory unit',true,'active')", [customer, org]);
      await c.query("INSERT INTO product_types(id,organization_id,name,routing_mode) VALUES($1,$2,'P7D inventory unit','no_route')", [type, org]);
      await c.query("INSERT INTO products(id,organization_id,name,description,is_active,measurement_mode,product_type_id) VALUES($1,$2,'P7D inventory unit','P7D inventory unit',true,'quantity_only',$3)", [product, org, type]);
      await c.query("INSERT INTO pbv2_tree_versions(id,organization_id,product_id,status,schema_version,tree_json,published_at) VALUES($1,$2,$3,'ACTIVE',2,$4::jsonb,now())", [version, org, product, JSON.stringify(tree)]);
      await c.query("INSERT INTO materials(id,organization_id,name,sku,type,cost_per_unit,stock_quantity,inventory_unit,consumption_unit,is_active) VALUES($1,$2,'P7D sheet stock','P7D-SHEET','substrate',1,2,'sheet','square_foot',true)", [material, org]);
      await c.query("INSERT INTO v2_product_recipes(id,organization_id,product_id,product_version_id,updated_by_user_id) VALUES($1,$2,$3,$4,$5)", [recipe, org, product, version, user]);
      await c.query("INSERT INTO v2_product_recipe_components(id,organization_id,recipe_id,material_id,position,quantity,quantity_unit,quantity_kind,material_name_snapshot,material_sku_snapshot) VALUES($1,$2,$3,$4,0,1,'sheet','fixed','P7D sheet stock','P7D-SHEET')", [component, org, recipe, material]);
      await c.query("INSERT INTO v2_sales_documents(id,organization_id,document_kind,business_number,display_number,customer_id,currency,terms_json) VALUES($1,$2,'order',1,$3,$4,'USD','{}')", [order, org, `P7D-UNIT-${x}`, customer]);
      await c.query("INSERT INTO v2_sales_order_details(document_id,organization_id) VALUES($1,$2)", [order, org]);
      await c.query("INSERT INTO v2_sales_document_lines(id,organization_id,document_id,position,product_id,description,quantity,currency,calculated_unit_cents,calculated_line_cents,selling_unit_cents,selling_line_cents,pricing_result_id,pricing_evidence_fingerprint,resolved_configuration,pricing_result,selling_price_decision,production_requirement_state,production_requirement_fingerprint,production_requirement_count) VALUES($1,$2,$3,0,$4,'P7D inventory unit',1,'USD',1,1,1,1,'p7d','sha256:p7d','{}','{}','{}','configured',$5,1)", [line, org, order, product, `sha256:${"u".repeat(64)}`]);
      await c.query("INSERT INTO v2_order_line_material_requirements(id,organization_id,order_document_id,order_line_id,source_product_version_id,source_recipe_id,source_recipe_component_id,source_configuration_id,material_id,material_name_snapshot,material_sku_snapshot,quantity,quantity_unit,quantity_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$5,$8,'P7D sheet stock','P7D-SHEET',1,'sheet','fixed')", [requirement, org, order, line, version, recipe, component, material]);
      await c.query("INSERT INTO v2_sales_line_production_requirements(organization_id,document_id,order_line_id,requirement_key,side) VALUES($1,$2,$3,'front','front')", [org, order, line]);
      await c.query("INSERT INTO v2_artwork_files(id,organization_id,storage_provider,object_key,original_filename,display_filename,content_type,byte_size,source_kind) VALUES($1,$2,'clone',$3,'p7d.pdf','p7d.pdf','application/pdf',1,'customer_upload')", [file, org, `p7d/${x}`]);
      await c.query("INSERT INTO v2_artwork_assignments(id,organization_id,artwork_file_id,order_document_id,order_line_id,purpose,side,identity_fingerprint) VALUES($1,$2,$3,$4,$5,'production','front',$6)", [art, org, file, order, line, `sha256:${"a".repeat(64)}`]);
      await c.query("INSERT INTO v2_production_works(id,organization_id,order_document_id,order_line_id,requirement_key,artwork_assignment_id,artwork_file_id,side,ordered_quantity,created_principal_kind,created_principal_subject,created_staff_actor_user_id) VALUES($1,$2,$3,$4,'front',$5,$6,'front',1,'staff',$7,$8)", [work, org, order, line, art, file, user, user]);
      await c.query("INSERT INTO v2_production_attempts(id,organization_id,production_work_id,sequence,attempt_kind,station_key,started_principal_kind,started_principal_subject,started_staff_actor_user_id) VALUES($1,$2,$3,1,'initial','flatbed','staff',$4,$5)", [attempt, org, work, user, user]);
      await c.query("COMMIT");

      const inventory = new InventoryLedgerApplicationService(new PostgresInventoryLedgerTransactionRunner(pool));
      const firstId = request("reserve");
      const first = await inventory.reserveForProductionWork(context(org, user, firstId), { businessRequestId: firstId, productionWorkId: brandedId<"ProductionWorkId">(work) });
      assert.ok(first.ok && first.value.length === 1 && first.value[0]?.unit === "sheet", "A frozen sheet requirement must reserve against a sheet inventory basis.");
      const replay = await inventory.reserveForProductionWork(context(org, user, firstId), { businessRequestId: firstId, productionWorkId: brandedId<"ProductionWorkId">(work) });
      assert.deepEqual(replay, first, "Reservation replay must not duplicate the canonical fact.");
      const counts = await c.query<{ reservations: string; movements: string }>("SELECT (SELECT count(*)::text FROM v2_inventory_reservations WHERE organization_id=$1 AND production_work_id=$2) reservations,(SELECT count(*)::text FROM v2_inventory_movements WHERE organization_id=$1 AND production_work_id=$2) movements", [org, work]);
      assert.deepEqual(counts.rows[0], { reservations: "1", movements: "1" }, "Successful reservation must create one canonical reservation and movement.");
      await assert.rejects(c.query("INSERT INTO v2_inventory_reservations(organization_id,order_document_id,order_line_id,production_work_id,material_requirement_id,material_id,material_name_snapshot,material_sku_snapshot,opened_quantity,quantity_unit,operation_request_id) VALUES($1,$2,$3,$4,$5,$6,'P7D sheet stock','P7D-SHEET',1,'square_foot',$7)", [org, order, line, work, requirement, material, request("wrong-unit")]), /frozen requirement|inventory basis/i, "A reservation cannot substitute the consumption unit for the frozen inventory basis.");
      const afterRejected = await c.query<{ reservations: string; movements: string }>("SELECT (SELECT count(*)::text FROM v2_inventory_reservations WHERE organization_id=$1 AND production_work_id=$2) reservations,(SELECT count(*)::text FROM v2_inventory_movements WHERE organization_id=$1 AND production_work_id=$2) movements", [org, work]);
      assert.deepEqual(afterRejected.rows[0], { reservations: "1", movements: "1" }, "Rejected reservation must not create a reservation or movement.");
      const consumption = new ProductionMaterialConsumptionApplicationService(new PostgresProductionMaterialConsumptionTransactionRunner(pool));
      const consumptionId = request("consumption");
      const recorded = await consumption.record(context(org, user, consumptionId), { businessRequestId: consumptionId, productionWorkId: brandedId<"ProductionWorkId">(work), productionAttemptId: brandedId<"ProductionAttemptId">(attempt), materialId: material, requirementId: brandedId<"OrderLineMaterialRequirementId">(requirement), quantity: "1", unit: "square_foot", kind: "consumed" });
      assert.ok(recorded.ok, "Consumption must retain its independently-valid Material consumption unit.");
      console.log(JSON.stringify({ reservation: first.value[0]?.reservationId, reservationUnit: first.value[0]?.unit, consumptionUnit: "square_foot", replay: "single fact", rejectedUnit: "square_foot" }));
      console.log("[p7d] frozen inventory-basis reservation rehearsal passed.");
    } finally { c.release(); }
  } finally { await pool.end(); }
};

void main().catch((cause: unknown) => { console.error(`[p7d] ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}`); process.exitCode = 1; });
