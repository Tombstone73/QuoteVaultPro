export const CUSTOMER_TERMS_FILTERS = [
  "all", "any_credit_terms", "no_credit_terms", "not_set",
  "due_on_receipt", "net_15", "net_30", "net_45", "custom",
] as const;

export const CUSTOMER_CREDIT_LIMIT_FILTERS = [
  "all", "not_set", "zero", "not_set_or_zero", "greater_than_zero",
] as const;

export type CustomerTermsFilter = typeof CUSTOMER_TERMS_FILTERS[number];
export type CustomerCreditLimitFilter = typeof CUSTOMER_CREDIT_LIMIT_FILTERS[number];

export const CUSTOMER_TERMS_FILTER_OPTIONS: ReadonlyArray<{ value: CustomerTermsFilter; label: string }> = [
  { value: "all", label: "All Terms" },
  { value: "any_credit_terms", label: "Any Credit Terms" },
  { value: "no_credit_terms", label: "No Credit Terms" },
  { value: "not_set", label: "Not Set" },
  { value: "due_on_receipt", label: "Due on Receipt" },
  { value: "net_15", label: "Net 15" },
  { value: "net_30", label: "Net 30" },
  { value: "net_45", label: "Net 45" },
  { value: "custom", label: "Custom" },
];

export const CUSTOMER_CREDIT_LIMIT_FILTER_OPTIONS: ReadonlyArray<{ value: CustomerCreditLimitFilter; label: string }> = [
  { value: "all", label: "All Credit Limits" },
  { value: "not_set", label: "Not Set" },
  { value: "zero", label: "$0" },
  { value: "not_set_or_zero", label: "Not Set or $0" },
  { value: "greater_than_zero", label: "Greater than $0" },
];
