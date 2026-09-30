import {
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  buildCustomerListQueryKey,
  buildCustomerListSearchParams,
  normalizeCustomerListResponse,
  shouldResetCustomerListPage,
  type CustomerListQueryState,
} from "./customerListQuery";

const baseState: CustomerListQueryState = {
  viewMode: "enhanced",
  search: "acme",
  status: "active",
  customerType: "business",
  terms: "all",
  creditLimit: "all",
  sortBy: "name",
  sortDir: "asc",
  page: 3,
  pageSize: 50,
};

describe("customerListQuery helpers", () => {
  test("query key includes view mode, pagination, search, filters, and sort", () => {
    const key = buildCustomerListQueryKey(baseState);

    expect(key).toEqual([
      "/api/customers",
      {
        viewMode: "enhanced",
        page: 3,
        pageSize: 50,
        search: "acme",
        status: "active",
        customerType: "business",
        terms: undefined,
        creditLimit: undefined,
        sortBy: "name",
        sortDir: "asc",
      },
    ]);
  });

  test("enhanced column sort changes backend query params", () => {
    const params = buildCustomerListSearchParams({
      ...baseState,
      sortBy: "email",
      sortDir: "desc",
    });

    expect(params.get("sortBy")).toBe("email");
    expect(params.get("sortDir")).toBe("desc");
    expect(params.get("page")).toBe("3");
  });

  test("split view can request additional pages", () => {
    const params = buildCustomerListSearchParams({
      ...baseState,
      viewMode: "split",
      page: 2,
      sortBy: "updatedAt",
      sortDir: "desc",
    });

    expect(params.get("page")).toBe("2");
    expect(params.get("pageSize")).toBe("50");
    expect(params.get("sortBy")).toBe("updatedAt");
    expect(params.get("sortDir")).toBe("desc");
  });

  test("search, filter, and sort changes require resetting page to 1", () => {
    expect(shouldResetCustomerListPage(baseState, { ...baseState, search: "beta" })).toBe(true);
    expect(shouldResetCustomerListPage(baseState, { ...baseState, status: "inactive" })).toBe(true);
    expect(shouldResetCustomerListPage(baseState, { ...baseState, customerType: "individual" })).toBe(true);
    expect(shouldResetCustomerListPage(baseState, { ...baseState, terms: "any_credit_terms" })).toBe(true);
    expect(shouldResetCustomerListPage(baseState, { ...baseState, creditLimit: "not_set_or_zero" })).toBe(true);
    expect(shouldResetCustomerListPage(baseState, { ...baseState, sortBy: "createdAt" })).toBe(true);
    expect(shouldResetCustomerListPage(baseState, baseState)).toBe(false);
  });

  test("commercial filters enter the cache key and API query only when active", () => {
    const active = { ...baseState, terms: "any_credit_terms" as const, creditLimit: "not_set_or_zero" as const };
    expect(buildCustomerListQueryKey(active)[1]).toMatchObject({ terms: "any_credit_terms", creditLimit: "not_set_or_zero" });
    expect(buildCustomerListSearchParams(active).get("terms")).toBe("any_credit_terms");
    expect(buildCustomerListSearchParams(active).get("creditLimit")).toBe("not_set_or_zero");
    expect(buildCustomerListSearchParams(baseState).has("terms")).toBe(false);
    expect(buildCustomerListSearchParams(baseState).has("creditLimit")).toBe(false);
  });

  test("empty customer list envelope normalizes without crashing", () => {
    const normalized = normalizeCustomerListResponse({
      success: true,
      data: {
        customers: [],
        pagination: {
          page: 1,
          pageSize: 50,
          total: 0,
          totalPages: 1,
        },
      },
    });

    expect(normalized.customers).toEqual([]);
    expect(normalized.pagination.hasNextPage).toBe(false);
    expect(normalized.pagination.hasPreviousPage).toBe(false);
  });
});
