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