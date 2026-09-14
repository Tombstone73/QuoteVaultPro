import type { OrganizationId } from "../shared/commercialValues.js";
import type { ShippingPricingPolicy, ShippingResponsibility } from "./replacementShippingEconomics.js";

/** Deliberately staff-only. Do not add this shape to portal or packing-slip DTOs. */
export type StaffShipmentEconomics = Readonly<{
  shipmentId: string;
  estimatedCarrierCostCents?: number;
  actualCarrierCostCents?: number;
  customerShippingPriceCents?: number;
  customerPriceFrozen: boolean;
  absorbedFreightCents?: number;
  pricingPolicySnapshot?: ShippingPricingPolicy | Readonly<{ policy: ShippingPricingPolicy; source: "organization_default" | "customer_override"; establishedAt: string }>;
  responsibility?: ShippingResponsibility;
  reason?: string;
  note?: string;
  allocations: readonly Readonly<{ orderId: string; orderNumber: string; customerShippingPriceCents: number; allocationKind: "equal_split" | "manual"; invoicedInvoiceId?: string }> [];
}>;

export interface ShipmentEconomicsStaffReadPort {
  readStaffEconomics(organizationId: OrganizationId, shipmentId: string): Promise<StaffShipmentEconomics | null>;
}
