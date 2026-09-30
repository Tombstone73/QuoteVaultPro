import { describe, expect, test } from "@jest/globals";
import { parseCustomerListCommercialFilters } from "../routes/customerListCommercialFilters";

describe("customer list commercial filter route boundary", () => {
  test("owners and admins may request validated filters", () => {
    expect(parseCustomerListCommercialFilters("owner", { terms: "any_credit_terms", creditLimit: "not_set_or_zero" }))
      .toEqual({ ok: true, filters: { terms: "any_credit_terms", creditLimit: "not_set_or_zero" } });
    expect(parseCustomerListCommercialFilters("admin", { terms: "net_30" }).ok).toBe(true);
  });

  test("ordinary unfiltered list requests retain legacy access", () => {
    expect(parseCustomerListCommercialFilters("staff", {})).toEqual({ ok: true, filters: {} });
  });

  test("other roles cannot use commercial filters to infer customer configuration", () => {
    for (const role of ["staff", "manager", "customer", undefined]) {
      expect(parseCustomerListCommercialFilters(role, { creditLimit: "not_set_or_zero" })).toMatchObject({ ok: false, status: 403 });
      expect(parseCustomerListCommercialFilters(role, { terms: "all" })).toMatchObject({ ok: false, status: 403 });
    }
  });

  test("malformed and unknown values are rejected", () => {
    expect(parseCustomerListCommercialFilters("owner", { terms: "net_60" })).toMatchObject({ ok: false, status: 400 });
    expect(parseCustomerListCommercialFilters("admin", { creditLimit: ["zero", "not_set"] })).toMatchObject({ ok: false, status: 400 });
  });
});
