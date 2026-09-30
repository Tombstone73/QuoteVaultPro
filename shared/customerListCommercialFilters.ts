export const CUSTOMER_TERMS_FILTERS = [
  "all", "any_credit_terms", "no_credit_terms", "not_set",
  "due_on_receipt", "net_15", "net_30", "net_45", "custom",
] as const;

export const CUSTOMER_CREDIT_LIMIT_FILTERS = [
  "all", "not_set", "zero", "not_set_or_zero", "greater_than_zero",
] as const;

export type CustomerTermsFilter = typeof CUSTOMER_TERMS_FILTERS[number];
export type CustomerCreditLimitFilter = typeof CUSTOMER_CREDIT_LIMIT_FILTERS[number];
