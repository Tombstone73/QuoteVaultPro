/** Shared identifiers and display labels for existing staff payment flows.
 * Provider readiness remains an organization-scoped server concern. */
export const manualPaymentMethodDefinitions = [
  { id: "cash", label: "Cash", singleInvoice: true },
  { id: "check", label: "Check", singleInvoice: true },
  { id: "wire", label: "Wire", singleInvoice: false },
  { id: "bank_transfer", label: "ACH / Bank Transfer", singleInvoice: true },
  { id: "ach", label: "ACH", singleInvoice: false },
  { id: "other", label: "Other", singleInvoice: true },
] as const;

export type CanonicalManualPaymentMethod = typeof manualPaymentMethodDefinitions[number]["id"];
export const canonicalManualPaymentMethodValues: readonly CanonicalManualPaymentMethod[] =
  manualPaymentMethodDefinitions.map((method) => method.id);

export const staffPaymentMethodDefinitions = [
  { id: "credit_card", label: "Credit Card", kind: "processor", singleInvoice: true },
  ...manualPaymentMethodDefinitions.map((method) => ({ ...method, kind: "manual" as const })),
] as const;
export type StaffPaymentMethod = typeof staffPaymentMethodDefinitions[number]["id"];

export const paymentMethodFilterDefinitions = [
  { id: 'all', label: 'All Methods' }, { id: 'cash', label: 'Cash' },
  { id: 'check', label: 'Check' }, { id: 'credit_card', label: 'Credit Card' },
  { id: 'ach', label: 'ACH' }, { id: 'other', label: 'Other' }, { id: 'unknown', label: 'Unknown' },
] as const;
export type PaymentMethodFilter = typeof paymentMethodFilterDefinitions[number]['id'];

export function paymentMethodFilterKey(method: StaffPaymentMethod): Exclude<PaymentMethodFilter, 'all' | 'unknown'> {
  if (method === 'bank_transfer' || method === 'ach') return 'ach';
  if (method === 'wire' || method === 'other') return 'other';
  return method;
}

/** Display only the recorded method. Never derive a method from its provider. */
export function formatRecordedPaymentMethod(value: string | null | undefined): string {
  const recorded = value?.trim();
  if (!recorded) return 'Unknown';
  const key = recorded.toLowerCase().replace(/[ -]+/g, '_');
  return staffPaymentMethodDefinitions.find(method => method.id === key)?.label
    ?? recorded.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}
