import type { PoolClient } from "pg";
import type { FulfillmentCompletion } from "../../src/modules/fulfillment/fulfillmentCompletion.js";
import type { ReplacementObligationStatus } from "../../src/modules/fulfillment/replacementObligations.js";
import { brandedId, type OrganizationId } from "../../src/modules/shared/commercialValues.js";
import { PostgresFulfillmentCompletionProjection } from "./postgresFulfillmentCompletionProjection.js";

export type ProductionReportFulfillmentScope = Readonly<{ orderId: string; orderLineId: string }>;
export type ProductionReportReplacementScope = Readonly<ProductionReportFulfillmentScope & { replacementObligationId: string }>;
export type ProductionReportReplacementState = Readonly<
  | { state: "fulfilled" | "cancelled" | "unresolved"; canonicalStatus: ReplacementObligationStatus }
  | { state: "blocked"; reason: string }
>;

/** Named Fulfillment-owned read facade. Uses only the caller's snapshot/client.
 * Integration prerequisite: the delegated original completion projection must
 * contain the reviewed P0 original-only predicate. This facade does not repair it.
 */
export class PostgresProductionReportFulfillmentRead {
  constructor(private readonly client: Pick<PoolClient, "query">) {}

  async readOriginalCompletion(organizationId: OrganizationId, scope: ProductionReportFulfillmentScope): Promise<FulfillmentCompletion> {
    const identity = await this.client.query<{ id: string }>(`
      SELECT l.id FROM v2_sales_document_lines l
      JOIN v2_sales_documents d ON d.organization_id=l.organization_id AND d.id=l.document_id AND d.document_kind='order'
      WHERE l.organization_id=$1 AND l.document_id=$2 AND l.id=$3`, [organizationId, scope.orderId, scope.orderLineId]);
    if (identity.rows.length !== 1) return { state: "blocked", orderedQuantity: 0, completedQuantity: 0, reason: "Fulfillment cannot establish the exact organization/Order/line identity." };
    return new PostgresFulfillmentCompletionProjection(this.client).readCompletion(organizationId, brandedId<"OrderLineId">(scope.orderLineId));
  }

  async readReplacementState(organizationId: OrganizationId, scope: ProductionReportReplacementScope): Promise<ProductionReportReplacementState> {
    const result = await this.client.query<{ status: string }>(`
      SELECT obligation.status FROM v2_order_replacement_obligations obligation
      JOIN v2_sales_document_lines l ON l.organization_id=obligation.organization_id AND l.document_id=obligation.order_document_id AND l.id=obligation.order_line_id
      JOIN v2_sales_documents d ON d.organization_id=l.organization_id AND d.id=l.document_id AND d.document_kind='order'
      WHERE obligation.organization_id=$1 AND obligation.order_document_id=$2 AND obligation.order_line_id=$3 AND obligation.id=$4`, [organizationId, scope.orderId, scope.orderLineId, scope.replacementObligationId]);
    if (result.rows.length !== 1) return { state: "blocked", reason: "Fulfillment replacement evidence is unavailable for the exact organization/Order/line/obligation identity." };
    const status = result.rows[0]!.status;
    // Status is DB-trigger-owned. No refresh, quantity aggregation, or writes.
    if (status === "fulfilled" || status === "cancelled") return { state: status, canonicalStatus: status };
    if (status === "open" || status === "production_complete") return { state: "unresolved", canonicalStatus: status };
    return { state: "blocked", reason: "Fulfillment replacement status is not a recognized canonical fact." };
  }
}
