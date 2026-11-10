import type { Request } from "express";
import { requirePortalAction, PortalPermissionError } from "./portalAuthorization";
import { resolveStripeRuntimeConfig } from "./stripeRuntimeConfig.service";

export const CUSTOMER_PAYMENT_UNAVAILABLE = "Online payment is temporarily unavailable. Please contact the shop for another payment option.";

/** Preview scopes a company, not a customer login or that login's payment role. */
export async function assertCustomerCheckoutAccess(req: Request): Promise<void> {
  if (req.staffPortalPreview) throw new PortalPermissionError();
  await requirePortalAction(req, "payment");
}

/** Read-only authority shared by the invoice list/detail and their guest projection.
 * Invoice release and balance eligibility are evaluated before this context. */
export async function getPortalPaymentAvailability(req: Request, organizationId: string) {
  if (req.staffPortalPreview) return {
    payable: false,
    blockedReason: "Customer payment access cannot be verified in staff preview. The customer must sign in with an account permitted to pay invoices.",
    reasonCode: "CUSTOMER_ACCESS_UNVERIFIED",
  };
  try {
    await assertCustomerCheckoutAccess(req);
  } catch (error) {
    if (!(error instanceof PortalPermissionError)) throw error;
    return { payable: false, blockedReason: "Your account does not have permission to pay invoices. Please contact your company administrator or the shop.", reasonCode: "CUSTOMER_ACCESS_DENIED" };
  }
  try {
    const runtime = await resolveStripeRuntimeConfig(organizationId);
    if (runtime.ok) return { payable: true, blockedReason: null, reasonCode: null };
    console.warn("[PORTAL_PAYMENT_AVAILABILITY]", { organizationId, code: runtime.code });
  } catch {
    console.warn("[PORTAL_PAYMENT_AVAILABILITY]", { organizationId, code: "PROVIDER_READINESS_FAILED" });
  }
  return { payable: false, blockedReason: CUSTOMER_PAYMENT_UNAVAILABLE, reasonCode: "PROVIDER_UNAVAILABLE" };
}
