/**
 * Shared transport contract for bounded active-work queues.  The domains keep
 * their own ownership and query implementations; only the operator-facing
 * paging semantics are common.
 */
export type OperationalQueuePageRequest = Readonly<{
  page?: number;
  pageSize?: number;
  search?: string;
}>;

export type OperationalQueuePage<T> = Readonly<{
  items: readonly T[];
  pagination: Readonly<{
    page: number;
    pageSize: 25 | 50 | 100;
    totalCount: number;
    totalPages: number;
  }>;
}>;

export const normalizeOperationalQueuePage = (
  request: OperationalQueuePageRequest = {},
): Readonly<{ page: number; pageSize: 25 | 50 | 100; search: string }> => {
  const page = Number.isInteger(request.page) && (request.page ?? 0) > 0 ? request.page! : 1;
  const pageSize = request.pageSize === 50 || request.pageSize === 100 ? request.pageSize : 25;
  return { page, pageSize, search: request.search?.trim().slice(0, 200) ?? "" };
};
