import React from "react";

/** Shared presentation; each operational workspace owns its query and page state. */
export const OperationalQueuePager = ({ page, pageSize, total, totalPages, onPage, onPageSize }: Readonly<{
  page: number;
  pageSize: 25 | 50 | 100;
  total: number;
  totalPages: number;
  onPage: (page: number) => void;
  onPageSize: (pageSize: 25 | 50 | 100) => void;
}>) => <div className="v2-queue-pager">
  <small>{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}` : "0 work items"}</small>
  <label>Rows <select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value) as 25 | 50 | 100)}>
    <option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
  </select></label>
  <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
  <small>Page {page} of {Math.max(totalPages, 1)}</small>
  <button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</button>
</div>;
