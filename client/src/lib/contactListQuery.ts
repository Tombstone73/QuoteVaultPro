export type ContactListSortBy =
  | "name"
  | "lastName"
  | "firstName"
  | "email"
  | "phone"
  | "company"
  | "createdAt"
  | "updatedAt"
  | "orders"
  | "quotes"
  | "lastActivity";

export type ContactListSortDir = "asc" | "desc";

export type ContactListQueryState = {
  search: string;
  filter?: string;
  page: number;
  pageSize: number;
  sortBy: ContactListSortBy;
  sortDir: ContactListSortDir;
};

export type ContactListPagination = {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

export type ContactListResponse<TContact> = ContactListPagination & {
  contacts: TContact[];
};

export function buildContactListQueryKey(state: ContactListQueryState) {
  return [
    "contacts",
    {
      search: state.search,
      filter: state.filter ?? "",
      page: state.page,
      pageSize: state.pageSize,
      sortBy: state.sortBy,
      sortDir: state.sortDir,
    },
  ] as const;
}

export function buildContactListSearchParams(state: ContactListQueryState): URLSearchParams {
  const params = new URLSearchParams();
  const trimmedSearch = state.search.trim();

  if (trimmedSearch) params.set("search", trimmedSearch);
  if (state.filter) params.set("filter", state.filter);
  params.set("page", String(state.page));
  params.set("pageSize", String(state.pageSize));
  params.set("sortBy", state.sortBy);
  params.set("sortDir", state.sortDir);

  return params;
}

export function normalizeContactListResponse<TContact>(payload: any): ContactListResponse<TContact> {
  return {
    contacts: Array.isArray(payload?.contacts) ? payload.contacts : [],
    total: Number(payload?.total ?? 0),
    page: Number(payload?.page ?? 1),
    pageSize: Number(payload?.pageSize ?? 20),
    totalPages: Number(payload?.totalPages ?? 1),
    hasNextPage: Boolean(payload?.hasNextPage),
    hasPreviousPage: Boolean(payload?.hasPreviousPage),
  };
}
