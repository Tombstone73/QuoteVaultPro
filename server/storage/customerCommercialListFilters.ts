import { and, eq, gt, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { customers } from "@shared/schema";
import type { CustomerCreditLimitFilter, CustomerTermsFilter } from "@shared/customerListCommercialFilters";

const creditTerms = ["net_15", "net_30", "net_45", "custom"];

export function buildCustomerCommercialListConditions(filters: {
  terms?: CustomerTermsFilter;
  creditLimit?: CustomerCreditLimitFilter;
}) {
  const conditions = [];
  switch (filters.terms) {
    case "any_credit_terms":
      conditions.push(inArray(customers.paymentTerms, creditTerms));
      break;
    case "no_credit_terms":
      conditions.push(or(isNull(customers.paymentTerms), eq(customers.paymentTerms, "due_on_receipt"))!);
      break;
    case "not_set":
      conditions.push(isNull(customers.paymentTerms));
      break;
    case "due_on_receipt": case "net_15": case "net_30": case "net_45": case "custom":
      conditions.push(eq(customers.paymentTerms, filters.terms));
      break;
  }
  switch (filters.creditLimit) {
    case "not_set":
      conditions.push(isNull(customers.creditLimitConfiguredAt));
      break;
    case "zero":
      conditions.push(and(isNotNull(customers.creditLimitConfiguredAt), eq(customers.creditLimit, "0"))!);
      break;
    case "not_set_or_zero":
      conditions.push(or(
        isNull(customers.creditLimitConfiguredAt),
        and(isNotNull(customers.creditLimitConfiguredAt), eq(customers.creditLimit, "0")),
      )!);
      break;
    case "greater_than_zero":
      conditions.push(and(isNotNull(customers.creditLimitConfiguredAt), gt(customers.creditLimit, "0"))!);
      break;
  }
  return conditions;
}
