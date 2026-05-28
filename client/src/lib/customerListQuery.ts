export type CustomerListViewMode = "split" | "enhanced";
export type CustomerListSortBy =
  | "name"
  | "primaryContact"
  | "email"
  | "phone"
  | "status"
  | "customerType"
  | "createdAt"
  | "updatedAt";
export type CustomerListSortDir = "asc" | "desc";

export type CustomerListQueryState = {
  viewMode: CustomerListViewMode;
  search: string;
  status: string;
  customerType: string;
  sortBy: CustomerListSortBy;
  sortDir: CustomerListSortDir;
  page: number;
  pageSize: number;
};

export type CustomerListPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type CustomerListApiEnvelope<TCustomer> = {
  success: true;
  data: {
    customers: TCustomer[];
    pagination: CustomerListPagination;
  };
};

export type LegacyCustomerListApiEnvelope<TCustomer> = {
  items: TCustomer[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
};

export type CustomerListResult<TCustomer> = {
  customers: TCustomer[];
  pagination: CustomerListPagination & {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
};

export function buildCustomerListQueryKey(state: CustomerListQueryState) {
  return [
    "/api/customers",
    {
      viewMode: state.viewMode,
      page: state.page,
      pageSize: state.pageSize,
      search: state.search,
      status: state.status === "all" ? undefined : state.status,
      customerType: state.customerType === "all" ? undefined : state.customerType,
      sortBy: state.sortBy,
      sortDir: state.sortDir,
    },
  ] as const;
}

export function buildCustomerListSearchParams(state: CustomerListQueryState): URLSearchParams {
  const params = new URLSearchParams();
  const trimmedSearch = state.search.trim();

  if (trimmedSearch) params.set("search", trimmedSearch);
  if (state.status !== "all") params.set("status", state.status);
  if (state.customerType !== "all") params.set("customerType", state.customerType);
  params.set("sortBy", state.sortBy);
  params.set("sortDir", state.sortDir);
  params.set("page", String(state.page));
  params.set("pageSize", String(state.pageSize));

  return params;
}

export function normalizeCustomerListResponse<TCustomer>(
  payload: CustomerListApiEnvelope<TCustomer> | LegacyCustomerListApiEnvelope<TCustomer>,
): CustomerListResult<TCustomer> {
  if ("success" in payload && payload.success && payload.data) {
    const pagination = payload.data.pagination;
    return {
      customers: payload.data.customers,
      pagination: {
        ...pagination,
        hasNextPage: pagination.page < pagination.totalPages,
        hasPreviousPage: pagination.page > 1,
      },
    };
  }

  if ("items" in payload) {
    return {
      customers: payload.items,
      pagination: {
        page: payload.page,
        pageSize: payload.pageSize,
        total: payload.total,
        totalPages: payload.totalPages,
        hasNextPage: payload.hasNextPage ?? payload.page < payload.totalPages,
        hasPreviousPage: payload.hasPreviousPage ?? payload.page > 1,
      },
    };
  }

  return {
    customers: [],
    pagination: {
      page: 1,
      pageSize: 50,
      total: 0,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  };
}

export function shouldResetCustomerListPage(
  previous: Pick<CustomerListQueryState, "search" | "status" | "customerType" | "sortBy" | "sortDir">,
  next: Pick<CustomerListQueryState, "search" | "status" | "customerType" | "sortBy" | "sortDir">,
): boolean {
  return (
    previous.search !== next.search ||
    previous.status !== next.status ||
    previous.customerType !== next.customerType ||
    previous.sortBy !== next.sortBy ||
    previous.sortDir !== next.sortDir
  );
}
