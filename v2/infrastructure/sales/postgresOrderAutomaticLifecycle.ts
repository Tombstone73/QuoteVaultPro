import type { Pool } from "pg";
import { brandedId, type InvoiceId, type OrderId, type OrganizationId } from "../../src/modules/shared/commercialValues.js";
import { reconciledOrderState, type OrderAutomaticLifecycle } from "../../src/modules/sales/orderAutomaticLifecycle.js";
import { orderCompletionEligibility } from "../../src/modules/sales/orderLifecycle.js";

/**
 * One canonical reconciliation point for Order state.  It reads immutable
 * Production/Fulfillment evidence and the current V2 Invoice settlement; no
 * provider, queue, or browser state participates in the decision.
 */
export class PostgresOrderAutomaticLifecycle implements OrderAutomaticLifecycle {
  constructor(private readonly pool: Pool) {}

  async reconcileInvoice(organizationId: OrganizationId, invoiceId: InvoiceId): Promise<void> {
    const found = await this.pool.query<{ order_id: string }>("SELECT sales_order_document_id order_id FROM v2_billing_invoices WHERE organization_id=$1 AND id=$2", [organizationId, invoiceId]);
    if (found.rows[0]) await this.reconcileOrder(organizationId, brandedId<"OrderId">(found.rows[0].order_id));
  }

  async reconcileOrder(organizationId: OrganizationId, orderId: OrderId): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Financial writers lock the Invoice before changing settlements. Keep the
      // same order here so reconciliation cannot observe an interleaved payment.
      await client.query("SELECT id FROM v2_billing_invoices WHERE organization_id=$1 AND sales_order_document_id=$2 FOR UPDATE", [organizationId, orderId]);
      const order = await client.query<{ state: "open" | "completed" | "cancelled" }>("SELECT commercial_state state FROM v2_sales_order_details WHERE organization_id=$1 AND document_id=$2 FOR UPDATE", [organizationId, orderId]);
      const current = order.rows[0];
      if (!current || current.state === "cancelled") { await client.query("COMMIT"); return; }
      const lines = await client.query<{ id:string;description:string;quantity:number;workflow_intent:string|null;requires_production:boolean;production_complete:boolean;fulfilled_quantity:string;route_complete:boolean }>(`SELECT l.id,l.description,l.quantity,
        CASE WHEN COALESCE(l.resolved_configuration#>>'{productFacts,workflowIntent}',v.tree_json#>>'{meta,general,workflowIntent}') IN ('standard_production','fulfillment_only','service_fee') THEN COALESCE(l.resolved_configuration#>>'{productFacts,workflowIntent}',v.tree_json#>>'{meta,general,workflowIntent}') ELSE NULL END workflow_intent,
        COALESCE((l.resolved_configuration#>>'{productFacts,requiresProductionJob}')::boolean,(v.tree_json#>>'{meta,general,requiresProductionJob}')::boolean,false) requires_production,
        CASE WHEN COALESCE((l.resolved_configuration#>>'{productFacts,requiresProductionJob}')::boolean,(v.tree_json#>>'{meta,general,requiresProductionJob}')::boolean,false)=false THEN true ELSE COALESCE((SELECT count(*)>0 AND bool_and(COALESCE((SELECT sum(a.good_quantity) FROM v2_production_works w LEFT JOIN v2_production_attempts a ON a.organization_id=w.organization_id AND a.production_work_id=w.id AND a.completed_at IS NOT NULL WHERE w.organization_id=req.organization_id AND w.order_line_id=req.order_line_id AND w.requirement_key=req.requirement_key),0)>=l.quantity) FROM v2_sales_line_production_requirements req WHERE req.organization_id=l.organization_id AND req.order_line_id=l.id),false) END production_complete,
        COALESCE((SELECT sum(hl.quantity) FROM v2_fulfillment_handoff_lines hl WHERE hl.organization_id=l.organization_id AND hl.order_document_id=l.document_id AND hl.order_line_id=l.id),0)::text fulfilled_quantity,
        CASE WHEN EXISTS(SELECT 1 FROM v2_route_instances ri WHERE ri.organization_id=l.organization_id AND ri.order_line_id=l.id) THEN NOT EXISTS(SELECT 1 FROM v2_route_instances ri WHERE ri.organization_id=l.organization_id AND ri.order_line_id=l.id AND ri.route_state<>'completed') ELSE NOT COALESCE((l.resolved_configuration#>>'{productFacts,requiresProductionJob}')::boolean,(v.tree_json#>>'{meta,general,requiresProductionJob}')::boolean,false) END route_complete
        FROM v2_sales_document_lines l LEFT JOIN pbv2_tree_versions v ON v.organization_id=l.organization_id AND v.product_id=l.product_id AND v.id=l.resolved_configuration->>'pricingConfigurationId' WHERE l.organization_id=$1 AND l.document_id=$2 ORDER BY l.position,l.id`, [organizationId, orderId]);
      const operational = orderCompletionEligibility(lines.rows.map((line) => ({ orderLineId: line.id, description: line.description, workflowIntent: line.workflow_intent === "standard_production" || line.workflow_intent === "fulfillment_only" || line.workflow_intent === "service_fee" ? line.workflow_intent : null, requiresProduction: line.requires_production, orderedQuantity: line.quantity, productionComplete: line.production_complete, fulfilledQuantity: Number(line.fulfilled_quantity), routeComplete: line.route_complete })));
      const financial = await client.query<{ settled: boolean }>(`SELECT EXISTS(SELECT 1 FROM v2_billing_invoices i WHERE i.organization_id=$1 AND i.sales_order_document_id=$2 AND i.invoice_state<>'void' AND i.total_cents-COALESCE((SELECT sum(a.amount_cents) FROM v2_billing_payment_allocations a WHERE a.organization_id=i.organization_id AND a.invoice_id=i.id),0)+COALESCE((SELECT sum(r.amount_cents) FROM v2_billing_refunds r WHERE r.organization_id=i.organization_id AND r.invoice_id=i.id),0) <= 0) settled`, [organizationId, orderId]);
      const desired = reconciledOrderState(current.state, operational, financial.rows[0]?.settled === true);
      if (desired === "completed" && current.state === "open") {
        await client.query("UPDATE v2_sales_order_details SET commercial_state='completed',completed_at=now(),completed_principal_kind='service',completed_principal_subject='order-lifecycle-reconciler',completed_staff_actor_user_id=NULL,updated_at=now() WHERE organization_id=$1 AND document_id=$2 AND commercial_state='open'", [organizationId, orderId]);
        await client.query("INSERT INTO v2_audit_events(organization_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,changes) VALUES($1,'sales.order.lifecycle.reconcile.v1','order_auto_closed','sales_order',$2,'service','order-lifecycle-reconciler',$3::jsonb)", [organizationId, orderId, JSON.stringify([{ kind: "order_auto_closed", summary: "All operational obligations and the canonical Invoice settlement are complete." }])]);
      } else if (desired === "open" && current.state === "completed") {
        await client.query("UPDATE v2_sales_order_details SET commercial_state='open',completed_at=NULL,completed_principal_kind=NULL,completed_principal_subject=NULL,completed_staff_actor_user_id=NULL,archived_at=NULL,archived_principal_kind=NULL,archived_principal_subject=NULL,archived_staff_actor_user_id=NULL,updated_at=now() WHERE organization_id=$1 AND document_id=$2 AND commercial_state='completed'", [organizationId, orderId]);
        await client.query("INSERT INTO v2_audit_events(organization_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,changes) VALUES($1,'sales.order.lifecycle.reconcile.v1','order_auto_reopened','sales_order',$2,'service','order-lifecycle-reconciler',$3::jsonb)", [organizationId, orderId, JSON.stringify([{ kind: "order_auto_reopened", summary: "A current operational or settlement obligation is no longer satisfied." }])]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
}
