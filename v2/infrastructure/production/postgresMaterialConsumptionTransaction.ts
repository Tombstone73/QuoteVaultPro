import type { Pool, PoolClient } from "pg";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";
import { compareMaterialUsage, type ProductionMaterialConsumption, type ProductionMaterialConsumptionProjection, type ProductionMaterialConsumptionTransaction, type ProductionMaterialConsumptionTransactionRunner } from "../../src/modules/production/materialConsumption.js";
import { brandedId, type OrderId, type OrderLineId, type OrderLineMaterialRequirementId, type OrganizationId, type ProductionAttemptId, type ProductionMaterialConsumptionId, type ProductionWorkId } from "../../src/modules/shared/commercialValues.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";

type FactRow = Readonly<{ id: string; organization_id: string; order_document_id: string; order_line_id: string; production_work_id: string; production_attempt_id: string; material_requirement_id: string | null; material_id: string; material_name_snapshot: string; material_sku_snapshot: string | null; quantity: string; quantity_unit: ProductionMaterialConsumption["unit"]; consumption_kind: ProductionMaterialConsumption["kind"]; corrects_consumption_id: string | null; created_at: Date; created_principal_kind: ProductionMaterialConsumption["createdPrincipalKind"]; created_principal_subject: string; created_staff_actor_user_id: string | null }>;
type RequirementRow = Readonly<{ id: string; material_id: string; material_name_snapshot: string; material_sku_snapshot: string | null; quantity: string; quantity_unit: ProductionMaterialConsumption["unit"] }>;
type WorkRow = Readonly<{ id: string; order_document_id: string; order_line_id: string }>;
const fact = (row: FactRow): ProductionMaterialConsumption => Object.freeze({
  consumptionId: brandedId<"ProductionMaterialConsumptionId">(row.id), organizationId: brandedId<"OrganizationId">(row.organization_id),
  orderId: brandedId<"OrderId">(row.order_document_id), orderLineId: brandedId<"OrderLineId">(row.order_line_id),
  productionWorkId: brandedId<"ProductionWorkId">(row.production_work_id), productionAttemptId: brandedId<"ProductionAttemptId">(row.production_attempt_id),
  materialId: row.material_id, materialName: row.material_name_snapshot, materialSku: row.material_sku_snapshot,
  ...(row.material_requirement_id ? { requirementId: brandedId<"OrderLineMaterialRequirementId">(row.material_requirement_id) } : {}),
  quantity: row.quantity, unit: row.quantity_unit, kind: row.consumption_kind,
  ...(row.corrects_consumption_id ? { correctsConsumptionId: brandedId<"ProductionMaterialConsumptionId">(row.corrects_consumption_id) } : {}),
  createdAt: row.created_at.toISOString(), createdPrincipalKind: row.created_principal_kind, createdPrincipalSubject: row.created_principal_subject,
  ...(row.created_staff_actor_user_id ? { createdStaffActorUserId: row.created_staff_actor_user_id } : {}),
});

export type ProductionMaterialConsumptionTestHooks = Readonly<{ afterConsumption?: () => Promise<void>; afterAudit?: () => Promise<void> }>;

export class PostgresProductionMaterialConsumptionTransaction implements ProductionMaterialConsumptionTransaction {
  private readonly requests = new PostgresOperationRequestRepository();
  constructor(private readonly client: PoolClient, private readonly hooks?: ProductionMaterialConsumptionTestHooks) {}
  async reserve(input: Parameters<ProductionMaterialConsumptionTransaction["reserve"]>[0]) { const result = await this.requests.reserve(this.client, input); return { kind: result.kind, request: { id: result.request.id, resultJson: result.request.resultJson } }; }
  async succeed(organizationId: string, requestId: string, result: ProductionMaterialConsumption) { await this.requests.succeed(this.client, organizationId, requestId, { resourceType: "production_material_consumption", resourceId: result.consumptionId, resultJson: result }); }
  async attribute(input: Parameters<ProductionMaterialConsumptionTransaction["attribute"]>[0]) { await this.requests.recordAttribution(this.client, { organizationId: input.organizationId, operationRequestId: input.requestId, operation: input.operation, resourceType: "production_material_consumption", resourceId: input.resourceId, principalKind: input.principalKind, principalSubject: input.principalSubject, staffActorUserId: input.staffActorUserId }); }
  async audit(input: Parameters<ProductionMaterialConsumptionTransaction["audit"]>[0]) {
    await this.client.query("INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,'production_material_consumption_recorded','production_material_consumption',$4,$5,$6,$7,$8::jsonb)", [input.organizationId, input.requestId, input.operation, input.resourceId, input.principalKind, input.principalSubject, input.staffActorUserId ?? null, JSON.stringify([{ kind: "material_consumption", summary: input.summary }])]);
    await this.hooks?.afterAudit?.();
  }
  async record(input: Parameters<ProductionMaterialConsumptionTransaction["record"]>[0]): Promise<ProductionMaterialConsumption> {
    const row = (await this.client.query<FactRow>(`INSERT INTO v2_production_material_consumptions(
      id,organization_id,order_document_id,order_line_id,production_work_id,production_attempt_id,material_requirement_id,material_id,
      material_name_snapshot,material_sku_snapshot,quantity,quantity_unit,consumption_kind,corrects_consumption_id,operation_request_id,
      created_principal_kind,created_principal_subject,created_staff_actor_user_id
    ) SELECT $1::varchar,$2::varchar,w.order_document_id,w.order_line_id,$3::varchar,$4::varchar,$5::varchar,$6::varchar,
      COALESCE(r.material_name_snapshot,m.name),COALESCE(r.material_sku_snapshot,m.sku),$7::numeric,$8::varchar,$9::varchar,$10::varchar,$11::varchar,$12::varchar,$13::varchar,$14::varchar
      FROM v2_production_works w JOIN materials m ON m.id=$6::varchar AND m.organization_id=$2::varchar
      LEFT JOIN v2_order_line_material_requirements r ON r.id=$5::varchar AND r.organization_id=$2::varchar
      WHERE w.id=$3::varchar AND w.organization_id=$2::varchar
        -- A frozen requirement may be in the Material's configured inventory
        -- unit (for example sheets resolved from PBV2 area demand).  It is an
        -- explicit historical basis, not an arbitrary unit conversion.
        AND (m.consumption_unit IS NULL OR m.consumption_unit=$8::varchar
          OR (r.id IS NOT NULL AND m.inventory_unit=$8::varchar))
      RETURNING *`, [input.id, input.organizationId, input.productionWorkId, input.productionAttemptId, input.requirementId ?? null, input.materialId, input.quantity, input.unit, input.kind, input.correctsConsumptionId ?? null, input.operationRequestId, input.principalKind, input.principalSubject, input.staffActorUserId ?? null])).rows[0];
    if (!row) throw new V2ApplicationError("NOT_FOUND", "Production work or Material was not found in this organization.");
    await this.hooks?.afterConsumption?.();
    return fact(row);
  }
  async readProjection(organizationId: OrganizationId, productionWorkId: ProductionWorkId): Promise<ProductionMaterialConsumptionProjection | null> {
    const work = (await this.client.query<WorkRow>("SELECT id,order_document_id,order_line_id FROM v2_production_works WHERE organization_id=$1 AND id=$2", [organizationId, productionWorkId])).rows[0];
    if (!work) return null;
    const [requirements, facts] = await Promise.all([
      this.client.query<RequirementRow>("SELECT id,material_id,material_name_snapshot,material_sku_snapshot,quantity::text,quantity_unit FROM v2_order_line_material_requirements WHERE organization_id=$1 AND order_document_id=$2 AND order_line_id=$3 ORDER BY id", [organizationId, work.order_document_id, work.order_line_id]),
      this.client.query<FactRow>("SELECT * FROM v2_production_material_consumptions WHERE organization_id=$1 AND production_work_id=$2 ORDER BY created_at,id", [organizationId, productionWorkId]),
    ]);
    const records = facts.rows.map(fact);
    return Object.freeze({ productionWorkId, orderId: brandedId<"OrderId">(work.order_document_id), orderLineId: brandedId<"OrderLineId">(work.order_line_id), facts: records, comparison: compareMaterialUsage(requirements.rows.map((row) => ({ requirementId: brandedId<"OrderLineMaterialRequirementId">(row.id), materialId: row.material_id, materialName: row.material_name_snapshot, materialSku: row.material_sku_snapshot, quantity: row.quantity, unit: row.quantity_unit })), records) });
  }
}
export class PostgresProductionMaterialConsumptionTransactionRunner implements ProductionMaterialConsumptionTransactionRunner {
  constructor(private readonly pool: Pool, private readonly hooks?: ProductionMaterialConsumptionTestHooks) {}
  async transaction<T>(action: (tx: ProductionMaterialConsumptionTransaction) => Promise<T>): Promise<T> { const client = await this.pool.connect(); try { await client.query("BEGIN"); const value = await action(new PostgresProductionMaterialConsumptionTransaction(client, this.hooks)); await client.query("COMMIT"); return value; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
}
