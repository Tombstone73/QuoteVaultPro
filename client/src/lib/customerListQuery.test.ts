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
    expect(shouldResetCustomerListPage(baseState, { ...baseState, sortBy: "createdAt" })).toBe(true);
    expect(shouldResetCustomerListPage(baseState, baseState)).toBe(false);
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
