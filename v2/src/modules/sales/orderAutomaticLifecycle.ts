import type { InvoiceId, OrderId, OrganizationId } from "../shared/commercialValues.js";
import type { OrderCompletionEligibility } from "./orderLifecycle.js";

/** Sales is the sole owner of the derived open/closed operational state. */
export interface OrderAutomaticLifecycle {
  reconcileOrder(organizationId: OrganizationId, orderId: OrderId): Promise<void>;
  reconcileInvoice(organizationId: OrganizationId, invoiceId: InvoiceId): Promise<void>;
}

export type AutomaticOrderState = "open" | "completed" | "cancelled";

/** One policy decision shared by every trigger. Financial terms, providers, and
 * external accounting are deliberately absent: only canonical settlement and
 * current operational obligations control the derived closed state. */
export const reconciledOrderState = (
  current: AutomaticOrderState,
  operational: OrderCompletionEligibility,
  invoiceSettled: boolean,
): AutomaticOrderState => {
  if (current === "cancelled") return "cancelled";
  return operational.eligible && invoiceSettled ? "completed" : "open";
};
