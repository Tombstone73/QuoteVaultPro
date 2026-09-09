/**
 * A suppressed delivery is durable evidence that an intentionally isolated
 * QA path withheld an external side effect. It is never provider success.
 */
export const SUPPRESSED_DELIVERY_STATE = "suppressed" as const;
export type SuppressedDeliveryState = typeof SUPPRESSED_DELIVERY_STATE;

export type PortalInvitationDeliveryState = "pending" | "succeeded" | "uncertain" | SuppressedDeliveryState;
