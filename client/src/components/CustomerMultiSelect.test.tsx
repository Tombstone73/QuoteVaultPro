import { readFileSync } from "node:fs";

const multiSelectSource = readFileSync("client/src/components/CustomerMultiSelect.tsx", "utf8");
const customerSelectSource = readFileSync("client/src/components/CustomerSelect.tsx", "utf8");
const searchHookSource = readFileSync("client/src/hooks/useCustomerSearch.ts", "utf8");

describe("Customer selectors", () => {
  it("shares the server-paginated customer search transport", () => {
    expect(multiSelectSource).toContain("useCustomerSearchPage");
    expect(customerSelectSource).toContain("useCustomerSearchPage");
    expect(searchHookSource).toContain('pageSize = 25');
    expect(searchHookSource).toContain('params.set("search", normalizedSearch)');
    expect(searchHookSource).toContain('["customers", "search", normalizedSearch, page, pageSize]');
  });

  it("keeps selections independent from the currently loaded page and resolves saved labels by ID", () => {
    expect(multiSelectSource).toContain("useQueries");
    expect(multiSelectSource).toContain('`/api/customers/${id}`');
    expect(multiSelectSource).toContain("mergeCustomerSearchRows");
    expect(multiSelectSource).toContain("Load more customers");
    expect(multiSelectSource).toContain("[...value, id].sort()");
  });

  it("debounces server searches and resets pagination when the term changes", () => {
    expect(multiSelectSource).toContain("useDebouncedValue(search, 250)");
    expect(multiSelectSource).toContain("setPage(1)");
    expect(customerSelectSource).toContain("useDebouncedValue(searchQuery, 250)");
  });
});
