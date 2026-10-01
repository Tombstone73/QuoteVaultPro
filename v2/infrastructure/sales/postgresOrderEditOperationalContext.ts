import type { PoolClient } from "pg";
import { V2ApplicationError } from "../../src/errors/applicationError.js";

/** Read-only evidence for the new Sales edit boundary. Material and frozen-route
 * validation still belongs to the existing canonical Order operation. */
export async function readOrderEditBlockedLines(client: PoolClient, organizationId: string, orderId: string, lineIds: readonly string[]): Promise<readonly string[]> {
  if (!lineIds.length) return [];
  const unique = [...new Set(lineIds)];
  if (unique.length !== lineIds.length || unique.length > 500) throw new V2ApplicationError("VALIDATION_ERROR", "Invalid Order edit line scope.");
  const result = await client.query<{ id: string; progressed: boolean }>(`SELECT l.id, (
    EXISTS(SELECT 1 FROM v2_production_works w WHERE w.organization_id=l.organization_id AND w.order_document_id=l.document_id AND w.order_line_id=l.id)
    OR EXISTS(SELECT 1 FROM v2_prepress_units p WHERE p.organization_id=l.organization_id AND p.order_document_id=l.document_id AND p.order_line_id=l.id)
    OR EXISTS(SELECT 1 FROM v2_proof_works p WHERE p.organization_id=l.organization_id AND p.order_document_id=l.document_id AND p.order_line_id=l.id)
    OR EXISTS(SELECT 1 FROM v2_fulfillment_handoff_lines h WHERE h.organization_id=l.organization_id AND h.order_document_id=l.document_id AND h.order_line_id=l.id)
    OR EXISTS(SELECT 1 FROM v2_order_replacement_obligations r WHERE r.organization_id=l.organization_id AND r.order_document_id=l.document_id AND r.order_line_id=l.id)
  ) AS progressed FROM v2_sales_document_lines l
  WHERE l.organization_id=$1 AND l.document_id=$2 AND l.id=ANY($3::text[]) ORDER BY l.id`, [organizationId, orderId, unique]);
  if (result.rows.length !== unique.length) throw new V2ApplicationError("NOT_FOUND", "Order edit line was not found.");
  return result.rows.filter(row => row.progressed).map(row => row.id);
}
