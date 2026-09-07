/**
 * Provider-free shipment facts.  Manual fulfillment remains fully usable when
 * no carrier connector is configured; a future connector can attach its own
 * provider reference and label document without becoming the source of truth
 * for the customer handoff allocation.
 */
export type CarrierShipmentStatus = "prepared" | "shipped";

export type ManualCarrierShipment = Readonly<{
  status: CarrierShipmentStatus;
  carrierName?: string;
  carrierService?: string;
  trackingNumber?: string;
  shippedAt?: string;
  notes?: string;
  packageCount?: number;
}>;

export type CarrierPackageDraft = Readonly<{
  reference?: string;
  weight?: Readonly<{ value: number; unit: "lb" | "oz" | "kg" | "g" }>;
  dimensions?: Readonly<{ length: number; width: number; height: number; unit: "in" | "cm" }>;
}>;

/** Capability boundary for a future FedEx/UPS/USPS adapter. No implementation is supplied in launch scope. */
export interface CarrierProviderPort {
  quote?(request: Readonly<{ destination: unknown; packages: readonly CarrierPackageDraft[] }>): Promise<readonly Readonly<{ serviceCode: string; serviceName: string; amountCents?: number; currency?: string }>[]>;
  createLabel?(request: Readonly<{ shipmentId: string; destination: unknown; packages: readonly CarrierPackageDraft[]; serviceCode?: string }>): Promise<Readonly<{ providerShipmentId: string; trackingNumber?: string; labelDocumentRef?: string }>>;
  track?(providerShipmentId: string): Promise<Readonly<{ state: string; observedAt?: string }>>;
  voidLabel?(providerShipmentId: string): Promise<void>;
}

const clean = (value: string | undefined, field: string, max: number) => {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > max) throw new Error(`${field} is too long.`);
  return normalized;
};

/** Rejects malformed operator input before it can enter an immutable shipment snapshot. */
export const manualCarrierShipment = (input: ManualCarrierShipment): ManualCarrierShipment => {
  const carrierName = clean(input.carrierName, "Carrier name", 120);
  const carrierService = clean(input.carrierService, "Carrier service", 120);
  const trackingNumber = clean(input.trackingNumber, "Tracking number", 180);
  const notes = clean(input.notes, "Shipment notes", 2_000);
  if (!Number.isInteger(input.packageCount) && input.packageCount !== undefined) throw new Error("Package count must be a whole number.");
  if (input.packageCount !== undefined && input.packageCount < 1) throw new Error("Package count must be at least one.");
  if (input.status === "shipped" && !input.shippedAt) throw new Error("A shipped shipment requires its shipped timestamp.");
  return {
    status: input.status,
    ...(carrierName ? { carrierName } : {}),
    ...(carrierService ? { carrierService } : {}),
    ...(trackingNumber ? { trackingNumber } : {}),
    ...(input.shippedAt ? { shippedAt: input.shippedAt } : {}),
    ...(notes ? { notes } : {}),
    ...(input.packageCount !== undefined ? { packageCount: input.packageCount } : {}),
  };
};
