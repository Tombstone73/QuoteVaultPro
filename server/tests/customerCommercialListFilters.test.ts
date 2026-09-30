import { describe, expect, test } from "@jest/globals";
import { and, eq } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { customers } from "@shared/schema";
import type { CustomerCreditLimitFilter, CustomerTermsFilter } from "@shared/customerListCommercialFilters";
import { buildCustomerCommercialListConditions } from "../storage/customerCommercialListFilters";

const dialect = new PgDialect();
const query = (filters: Parameters<typeof buildCustomerCommercialListConditions>[0]) =>
  dialect.sqlToQuery(and(eq(customers.organizationId, "tenant-a"), ...buildCustomerCommercialListConditions(filters))!);

describe("customer commercial list SQL predicates", () => {
  test.each<[CustomerTermsFilter, string[], boolean]>([
    ["any_credit_terms", ["net_15", "net_30", "net_45", "custom"], false],
    ["no_credit_terms", ["due_on_receipt"], true],
    ["not_set", [], true],
    ["due_on_receipt", ["due_on_receipt"], false],
    ["net_15", ["net_15"], false],
    ["net_30", ["net_30"], false],
    ["net_45", ["net_45"], false],
    ["custom", ["custom"], false],
  ])("terms %s uses stored values", (terms, values, includesNull) => {
    const result = query({ terms });
    for (const value of values) expect(result.params).toContain(value);
    expect(result.sql.includes('"payment_terms" is null')).toBe(includesNull);
    if (terms === "any_credit_terms") expect(result.params).not.toContain("due_on_receipt");
    if (terms === "not_set") expect(result.params).not.toContain("due_on_receipt");
  });

  test.each<[CustomerCreditLimitFilter, boolean, boolean, boolean]>([
    ["not_set", true, false, false],
    ["zero", false, true, true],
    ["not_set_or_zero", true, true, true],
    ["greater_than_zero", false, true, false],
  ])("credit limit %s respects the configuration marker", (creditLimit, nullMarker, notNullMarker, zero) => {
    const result = query({ creditLimit });
    expect(result.sql.includes('"credit_limit_configured_at" is null')).toBe(nullMarker);
    expect(result.sql.includes('"credit_limit_configured_at" is not null')).toBe(notNullMarker);
    expect(result.sql.includes('"credit_limit" =')).toBe(zero);
    if (creditLimit === "greater_than_zero") expect(result.sql).toContain('"credit_limit" >');
  });

  test("terms, credit, status, and tenant conditions combine with AND", () => {
    const result = dialect.sqlToQuery(and(
      eq(customers.organizationId, "tenant-a"),
      eq(customers.status, "active"),
      ...buildCustomerCommercialListConditions({ terms: "any_credit_terms", creditLimit: "not_set_or_zero" }),
    )!);
    expect(result.sql).toContain(" and ");
    expect(result.sql).toContain('"payment_terms" in');
    expect(result.sql).toContain('"credit_limit_configured_at" is null');
    expect(result.params).toContain("tenant-a");
    expect(result.params).toContain("active");
  });

  test("no commercial filter leaves legacy queries unchanged", () => {
    expect(buildCustomerCommercialListConditions({})).toEqual([]);
  });
});
