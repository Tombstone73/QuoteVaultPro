export const BILLING_OWNERSHIP_REVIEW_MESSAGE = "Billing ownership changed after QuickBooks sync. Update the customer in QuickBooks before syncing again.";
export type BillingOwnershipReview = { id: string; invoiceId: string; reason: string; createdAt: string };
export type BillingOwnershipOverrideContext = { invoiceId: string; invoiceVersion: number; orderUpdatedAt: string };
