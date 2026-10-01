/** Authoritative Shipping facts accepted by Billing inside the coordinator's transaction.
 * No invoice totals, tax policy, or financial evidence may be supplied by Shipping. */
export type ApplyShippingChargeRequest = Readonly<{
  organizationId: string;
  invoiceId: string;
  orderId: string;
  shipmentId: string;
  shipmentAllocationId: string;
  customerChargeCents: number;
  orderNumbers: readonly string[];
  actor: Readonly<{
    principalKind: string;
    principalSubject: string;
    staffActorUserId?: string;
  }>;
}>;
