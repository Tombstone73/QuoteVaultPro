import type { PoolClient } from "pg";
import type { CreateReworkPreparationRequest, ReworkPreparation } from "../../src/modules/prepress/reworkPreparation.js";

export class PostgresReworkPreparation implements ReworkPreparation {
  constructor(private readonly client: PoolClient) {}

  async createReworkPreparation(request: CreateReworkPreparationRequest) {
    // Rework uses the frozen predecessor, not a newly inferred current Artwork assignment.
    const result = await this.client.query<{ id: string }>(`INSERT INTO v2_prepress_units(id,organization_id,order_document_id,order_line_id,artwork_assignment_id,artwork_file_id,side,source_page_index,layer_key,layer_order,rework_cycle_id,created_principal_kind,created_principal_subject,created_staff_actor_user_id)
      SELECT gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
      FROM v2_production_rework_cycles cycle JOIN v2_production_works predecessor ON predecessor.organization_id=cycle.organization_id AND predecessor.id=cycle.predecessor_production_work_id
      WHERE cycle.organization_id=$1 AND cycle.id=$10 AND cycle.predecessor_production_work_id=$14
        AND cycle.order_document_id=$2 AND cycle.order_line_id=$3 AND cycle.state='prepress_pending' AND cycle.successor_prepress_unit_id IS NULL
        AND predecessor.order_document_id=$2 AND predecessor.order_line_id=$3 AND predecessor.artwork_assignment_id=$4 AND predecessor.artwork_file_id=$5
        AND predecessor.side IS NOT DISTINCT FROM $6 AND predecessor.source_page_index IS NOT DISTINCT FROM $7
        AND predecessor.layer_key IS NOT DISTINCT FROM $8 AND predecessor.layer_order IS NOT DISTINCT FROM $9
      RETURNING id`, [request.organizationId, request.orderId, request.orderLineId, request.artworkAssignmentId, request.artworkFileId, request.side ?? null, request.sourcePageIndex ?? null, request.layerKey ?? null, request.layerOrder ?? null, request.reworkCycleId, request.principalKind, request.principalSubject, request.staffActorUserId ?? null, request.predecessorProductionWorkId]);
    if (!result.rows[0]) throw new Error("Prepress rework preparation does not match the frozen Production successor cycle.");
    return { prepressUnitId: result.rows[0].id };
  }
}
