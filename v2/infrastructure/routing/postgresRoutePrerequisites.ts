import type { PoolClient } from "pg";
import type { RouteStepKind } from "../../src/modules/routing/contracts.js";
import type { RoutePrerequisite } from "../../src/modules/routing/routingLifecycle.js";
import type { OrderLineId, OrganizationId } from "../../src/modules/shared/commercialValues.js";
import { PostgresProductionCompletionProjection } from "../production/postgresProductionCompletionProjection.js";
import { PostgresFulfillmentCompletionProjection } from "../fulfillment/postgresFulfillmentCompletionProjection.js";

/**
 * The same server-owned prerequisite projection is used for the frozen-route
 * transition and its read model.  It deliberately consumes evidence from its
 * owning domains instead of copying any completion rules into Routing UI.
 */
export const readRoutePrerequisite = async (client: PoolClient, organizationId: OrganizationId, orderLineId: OrderLineId, kind: RouteStepKind): Promise<RoutePrerequisite> => {
  if (kind === "proofing") {
    const result = await client.query<{ satisfied: boolean }>(`SELECT EXISTS(
      SELECT 1 FROM v2_proof_works w
      JOIN v2_proof_versions v ON v.organization_id=w.organization_id AND v.proof_work_id=w.id
      JOIN v2_proof_responses r ON r.organization_id=v.organization_id AND r.proof_version_id=v.id
      WHERE w.organization_id=$1 AND w.order_line_id=$2 AND r.outcome='approved'
        AND v.id=(SELECT latest.id FROM v2_proof_versions latest WHERE latest.organization_id=w.organization_id AND latest.proof_work_id=w.id ORDER BY latest.sequence DESC LIMIT 1)
    ) satisfied`, [organizationId, orderLineId]);
    return result.rows[0]?.satisfied ? { satisfied: true } : { satisfied: false, reason: "Routing requires the current Proof Version to be approved." };
  }
  if (kind === "prepress") {
    const result = await client.query<{ satisfied: boolean }>(`SELECT EXISTS(
      SELECT 1 FROM v2_sales_document_lines l
      WHERE l.organization_id=$1 AND l.id=$2 AND l.production_requirement_state='configured'
        AND NOT EXISTS(
          SELECT 1 FROM v2_sales_line_production_requirements req
          WHERE req.organization_id=l.organization_id AND req.order_line_id=l.id
            AND NOT EXISTS(
              SELECT 1 FROM v2_artwork_assignments a
              JOIN v2_prepress_units unit ON unit.organization_id=a.organization_id AND unit.artwork_assignment_id=a.id AND unit.completed_at IS NOT NULL
              WHERE a.organization_id=req.organization_id AND a.order_line_id=req.order_line_id AND a.purpose='production'
                AND a.side IS NOT DISTINCT FROM req.side AND a.source_page_index IS NOT DISTINCT FROM req.source_page_index
                AND a.layer_key IS NOT DISTINCT FROM req.layer_key AND a.layer_order IS NOT DISTINCT FROM req.layer_order
            )
        )
    ) satisfied`, [organizationId, orderLineId]);
    return result.rows[0]?.satisfied ? { satisfied: true } : { satisfied: false, reason: "Routing requires all authoritative Prepress units to be complete." };
  }
  if (kind === "production") {
    const completion = await new PostgresProductionCompletionProjection(client).readCompletion(organizationId, orderLineId);
    return completion.state === "complete" ? { satisfied: true } : { satisfied: false, reason: completion.reason ?? "Production is incomplete." };
  }
  if (kind === "fulfillment") {
    const completion = await new PostgresFulfillmentCompletionProjection(client).readCompletion(organizationId, orderLineId);
    return completion.state === "complete" ? { satisfied: true } : { satisfied: false, reason: completion.reason ?? "Fulfillment is incomplete." };
  }
  return { satisfied: false, reason: "Routing has an unknown current step." };
};
