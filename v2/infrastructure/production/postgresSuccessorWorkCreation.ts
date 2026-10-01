import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { brandedId, type ProductionWorkId } from "../../src/modules/shared/commercialValues.js";
import type { CompletedPrepressWorkCreationInput, PrepressReworkWorkCreationInput, ProductionWorkCreation, ReplacementWorkCreationInput } from "../../src/modules/production/successorWorkCreation.js";

/** Production owns creation; the caller retains its existing transaction, authority and workflow sequencing. */
export class PostgresSuccessorWorkCreation implements ProductionWorkCreation {
  constructor(private readonly client: PoolClient) {}

  async createOrReadCompletedPrepressWork(input: CompletedPrepressWorkCreationInput) {
    for (const assignmentId of input.artworkAssignmentIds) {
      await this.client.query(`INSERT INTO v2_production_works(id,organization_id,order_document_id,order_line_id,requirement_key,artwork_assignment_id,artwork_file_id,prepress_unit_id,side,source_page_index,layer_key,layer_order,ordered_quantity,created_principal_kind,created_principal_subject,created_staff_actor_user_id)
        SELECT gen_random_uuid()::text,a.organization_id,a.order_document_id,a.order_line_id,req.requirement_key,a.id,a.artwork_file_id,completed.id,a.side,a.source_page_index,a.layer_key,a.layer_order,l.quantity,$3,$4,$5
        FROM v2_current_artwork_assignments a JOIN v2_sales_line_production_requirements req ON req.organization_id=a.organization_id AND req.order_line_id=a.order_line_id AND a.side IS NOT DISTINCT FROM req.side AND a.source_page_index IS NOT DISTINCT FROM req.source_page_index AND a.layer_key IS NOT DISTINCT FROM req.layer_key AND a.layer_order IS NOT DISTINCT FROM req.layer_order JOIN v2_sales_document_lines l ON l.organization_id=a.organization_id AND l.id=a.order_line_id JOIN v2_prepress_units completed ON completed.organization_id=a.organization_id AND completed.artwork_assignment_id=a.id AND completed.completed_at IS NOT NULL
        WHERE a.organization_id=$1 AND a.id=$2 AND a.purpose='production' ON CONFLICT(organization_id,artwork_assignment_id) WHERE rework_cycle_id IS NULL AND replacement_obligation_id IS NULL DO NOTHING`, [input.organizationId, assignmentId, input.principalKind, input.principalSubject, input.staffActorUserId ?? null]);
    }
    const works = await this.client.query<{ id: string }>("SELECT id FROM v2_production_works WHERE organization_id=$1 AND order_line_id=$2 AND artwork_assignment_id=ANY($3::text[]) AND rework_cycle_id IS NULL AND replacement_obligation_id IS NULL ORDER BY id FOR SHARE", [input.organizationId, input.orderLineId, input.artworkAssignmentIds]);
    if (works.rows.length !== input.artworkAssignmentIds.length) throw new Error("Production work could not be created for every completed Prepress assignment.");
    return works.rows.map(row => brandedId<"ProductionWorkId">(row.id));
  }

  async createPrepressReworkWork(input: PrepressReworkWorkCreationInput) {
    const cycle = await this.client.query<{ id: string; predecessor_production_work_id: string; remaining_required_quantity: number; destination_station_key: "flatbed" | "roll" | null; state: "prepress_pending" | "production_created" }>("SELECT id,predecessor_production_work_id,remaining_required_quantity,destination_station_key,state FROM v2_production_rework_cycles WHERE organization_id=$1 AND id=$2 FOR UPDATE", [input.organizationId, input.reworkCycleId]);
    const current = cycle.rows[0];
    if (!current || current.state !== "prepress_pending") throw new Error("The rework successor cycle is no longer available for Production handoff.");
    if (!current.destination_station_key) throw new Error("The rework successor cycle has no frozen Production destination.");
    const artwork = await this.client.query<{ current: boolean }>("SELECT NOT EXISTS(SELECT 1 FROM v2_artwork_assignments successor WHERE successor.organization_id=a.organization_id AND successor.supersedes_artwork_assignment_id=a.id) current FROM v2_current_artwork_assignments a WHERE a.organization_id=$1 AND a.id=$2", [input.organizationId, input.artworkAssignmentId]);
    if (!artwork.rows[0]?.current) throw new Error("Rework Production Artwork changed; open the current Artwork as the successor Prepress unit before handoff.");
    const inserted = await this.client.query<{ id: string }>(`INSERT INTO v2_production_works(id,organization_id,order_document_id,order_line_id,requirement_key,artwork_assignment_id,artwork_file_id,prepress_unit_id,side,source_page_index,layer_key,layer_order,ordered_quantity,rework_cycle_id,predecessor_production_work_id,created_principal_kind,created_principal_subject,created_staff_actor_user_id)
      SELECT gen_random_uuid()::text,$1,predecessor.order_document_id,predecessor.order_line_id,predecessor.requirement_key,$2,a.artwork_file_id,$3,a.side,a.source_page_index,a.layer_key,a.layer_order,$4,$5,predecessor.id,$6,$7,$8
      FROM v2_production_works predecessor JOIN v2_artwork_assignments a ON a.organization_id=predecessor.organization_id AND a.id=$2
      WHERE predecessor.organization_id=$1 AND predecessor.id=$9 RETURNING id`, [input.organizationId, input.artworkAssignmentId, input.prepressUnitId, current.remaining_required_quantity, input.reworkCycleId, input.principalKind, input.principalSubject, input.staffActorUserId ?? null, current.predecessor_production_work_id]);
    if (!inserted.rows[0]) throw new Error("Successor Production work could not be created.");
    await this.client.query("UPDATE v2_production_rework_cycles SET successor_production_work_id=$3,state='production_created' WHERE organization_id=$1 AND id=$2", [input.organizationId, input.reworkCycleId, inserted.rows[0].id]);
    return { productionWorkId: brandedId<"ProductionWorkId">(inserted.rows[0].id), destination: current.destination_station_key };
  }

  async createReplacementWork(input: ReplacementWorkCreationInput) {
    if (input.sources.some(source => source.order_document_id !== input.orderId || source.order_line_id !== input.orderLineId)) throw new Error("Replacement Production sources do not match the scoped Order line.");
    const workIds: ProductionWorkId[] = [];
    for (const source of input.sources) {
      const workId = brandedId<"ProductionWorkId">(randomUUID());
      await this.client.query(`INSERT INTO v2_production_works(id,organization_id,order_document_id,order_line_id,requirement_key,artwork_assignment_id,artwork_file_id,prepress_unit_id,side,source_page_index,layer_key,layer_order,ordered_quantity,replacement_obligation_id,replacement_origin_production_work_id,created_principal_kind,created_principal_subject,created_staff_actor_user_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`, [workId, input.organizationId, source.order_document_id, source.order_line_id, source.requirement_key, source.artwork_assignment_id, source.artwork_file_id, source.prepress_unit_id, source.side, source.source_page_index, source.layer_key, source.layer_order, input.replacementQuantity, input.replacementObligationId, source.id, input.principalKind, input.principalSubject, input.staffActorUserId ?? null]);
      workIds.push(workId);
    }
    return workIds;
  }
}
