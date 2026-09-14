import type { Pool } from "pg";
import type { OrganizationId } from "../../src/modules/shared/commercialValues.js";
import type { StaffShipmentEconomics, ShipmentEconomicsStaffReadPort } from "../../src/modules/fulfillment/shipmentEconomicsRead.js";

type ShipmentRow = { id:string; estimated_carrier_cost_cents:string|null; customer_shipping_price_cents:string|null; customer_shipping_price_frozen_at:Date|null; shipping_pricing_policy_snapshot:unknown; responsibility:"titan"|"customer"|"carrier"|"pending"|null; reason:string|null; note:string|null; actual_cost:string|null };
type AllocationRow = { order_document_id:string; display_number:string; customer_shipping_price_cents:string; allocation_kind:"equal_split"|"manual"; invoiced_invoice_id:string|null };

/** This adapter is intentionally not reused by portal or document projection code. */
export class PostgresShipmentEconomicsStaffRead implements ShipmentEconomicsStaffReadPort {
  constructor(private readonly pool: Pool) {}
  async readStaffEconomics(organizationId: OrganizationId, shipmentId: string): Promise<StaffShipmentEconomics | null> {
    const shipment = await this.pool.query<ShipmentRow>(`SELECT s.id,s.estimated_carrier_cost_cents::text,s.customer_shipping_price_cents::text,s.customer_shipping_price_frozen_at,s.shipping_pricing_policy_snapshot,
      actual.actual_carrier_cost_cents::text actual_cost,actual.responsibility,actual.reason,actual.note
      FROM v2_fulfillment_shipments s
      LEFT JOIN LATERAL (
        SELECT u.actual_carrier_cost_cents,u.responsibility,u.reason,u.note
        FROM v2_fulfillment_shipment_actual_cost_updates u
        WHERE u.organization_id=s.organization_id AND u.shipment_id=s.id
        ORDER BY u.created_at DESC,u.id DESC LIMIT 1
      ) actual ON TRUE
      WHERE s.organization_id=$1 AND s.id=$2`, [organizationId, shipmentId]);
    const row = shipment.rows[0];
    if (!row) return null;
    const allocations = await this.pool.query<AllocationRow>(`SELECT a.order_document_id,d.display_number,a.customer_shipping_price_cents::text,a.allocation_kind,a.invoiced_invoice_id
      FROM v2_fulfillment_shipment_shipping_allocations a JOIN v2_sales_documents d ON d.organization_id=a.organization_id AND d.id=a.order_document_id
      WHERE a.organization_id=$1 AND a.shipment_id=$2 ORDER BY d.display_number,a.order_document_id`, [organizationId, shipmentId]);
    const actual = row.actual_cost === null ? undefined : Number(row.actual_cost), customer = row.customer_shipping_price_cents === null ? undefined : Number(row.customer_shipping_price_cents);
    return { shipmentId: row.id, customerPriceFrozen: row.customer_shipping_price_frozen_at !== null, ...(row.estimated_carrier_cost_cents === null ? {} : { estimatedCarrierCostCents: Number(row.estimated_carrier_cost_cents) }), ...(actual === undefined ? {} : { actualCarrierCostCents: actual }), ...(customer === undefined ? {} : { customerShippingPriceCents: customer }), ...(actual === undefined || customer === undefined ? {} : { absorbedFreightCents: Math.max(0, actual-customer) }), ...(row.shipping_pricing_policy_snapshot ? { pricingPolicySnapshot: row.shipping_pricing_policy_snapshot as StaffShipmentEconomics["pricingPolicySnapshot"] } : {}), ...(row.responsibility ? { responsibility: row.responsibility } : {}), ...(row.reason ? { reason: row.reason } : {}), ...(row.note ? { note: row.note } : {}), allocations: allocations.rows.map(value => ({ orderId:value.order_document_id, orderNumber:value.display_number, customerShippingPriceCents:Number(value.customer_shipping_price_cents), allocationKind:value.allocation_kind, ...(value.invoiced_invoice_id ? { invoicedInvoiceId:value.invoiced_invoice_id } : {}) })) };
  }
}
