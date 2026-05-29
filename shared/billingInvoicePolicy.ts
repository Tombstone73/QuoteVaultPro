export const BILLING_INVOICE_TRIGGER_POLICIES = [
  "manual_only",
  "order_entry",
  "quote_approval",
  "proof_approval",
  "production_complete",
  "ready_for_pickup_or_ready_to_ship",
  "picked_up_or_shipped",
] as const;

export type BillingInvoiceTriggerPolicy = typeof BILLING_INVOICE_TRIGGER_POLICIES[number];
export type BillingInvoiceMilestone = Exclude<BillingInvoiceTriggerPolicy, "manual_only">;
export type InvoiceCreationSource = "manual" | "automation";

export const DEFAULT_BILLING_INVOICE_TRIGGER_POLICY: BillingInvoiceTriggerPolicy = "manual_only";

const BILLING_INVOICE_TRIGGER_POLICY_SET = new Set<string>(BILLING_INVOICE_TRIGGER_POLICIES);

export function isBillingInvoiceTriggerPolicy(value: unknown): value is BillingInvoiceTriggerPolicy {
  return typeof value === "string" && BILLING_INVOICE_TRIGGER_POLICY_SET.has(value);
}

export function resolveBillingInvoiceTriggerPolicyFromOrgPreferences(preferences: unknown): BillingInvoiceTriggerPolicy {
  const raw = (preferences as any)?.billingInvoiceTriggerPolicy;
  return isBillingInvoiceTriggerPolicy(raw) ? raw : DEFAULT_BILLING_INVOICE_TRIGGER_POLICY;
}

export function doesBillingPolicyMatchTrigger(
  policy: BillingInvoiceTriggerPolicy,
  trigger: BillingInvoiceTriggerPolicy,
): boolean {
  if (policy === "manual_only") return false;
  return policy === trigger;
}
