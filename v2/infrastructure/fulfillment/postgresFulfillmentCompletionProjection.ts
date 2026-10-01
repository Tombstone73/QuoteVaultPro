import type { PoolClient } from "pg";
import { fulfillmentCompletion, type FulfillmentCompletionReadPort } from "../../src/modules/fulfillment/fulfillmentCompletion.js";
import type { OrderLineId, OrganizationId } from "../../src/modules/shared/commercialValues.js";

/** Fulfillment's immutable pickup/shipment allocations remain the only completion facts. */
export class PostgresFulfillmentCompletionProjection implements FulfillmentCompletionReadPort {
  constructor(private readonly client: Pick<PoolClient, "query">) {}
  async readCompletion(organizationId: OrganizationId, orderLineId: OrderLineId) {
    const result=await this.client.query<{ordered_quantity:number;completed_quantity:string}>(`
      SELECT l.quantity ordered_quantity,COALESCE(SUM(fhl.quantity) FILTER (WHERE handoff.id IS NOT NULL),0)::text completed_quantity
      FROM v2_sales_document_lines l
      JOIN v2_sales_documents d ON d.organization_id=l.organization_id AND d.id=l.document_id AND d.document_kind='order'
      JOIN v2_sales_order_details o ON o.organization_id=d.organization_id AND o.document_id=d.id AND o.commercial_state='open'
      LEFT JOIN v2_fulfillment_handoff_lines fhl ON fhl.organization_id=l.organization_id AND fhl.order_line_id=l.id AND fhl.order_document_id=l.document_id
      LEFT JOIN v2_fulfillment_handoffs handoff ON handoff.organization_id=fhl.organization_id AND handoff.id=fhl.handoff_id AND handoff.order_document_id=l.document_id AND handoff.replacement_obligation_id IS NULL
      WHERE l.organization_id=$1 AND l.id=$2 GROUP BY l.quantity`,[organizationId,orderLineId]);
    const row=result.rows[0];
    return row?fulfillmentCompletion({orderedQuantity:row.ordered_quantity,completedQuantity:Number(row.completed_quantity)}):{state:"blocked" as const,orderedQuantity:0,completedQuantity:0,reason:"Fulfillment OrderLine was not found."};
  }
}
