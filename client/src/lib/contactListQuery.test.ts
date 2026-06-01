import { describe, expect, test } from "@jest/globals";
import {
  buildContactListQueryKey,
  buildContactListSearchParams,
  normalizeContactListResponse,
  type ContactListQueryState,
} from "./contactListQuery";

const baseState: ContactListQueryState = {
  search: "ada",
  page: 2,
  pageSize: 50,
  sortBy: "lastName",
  sortDir: "asc",
};

describe("contactListQuery helpers", () => {
  test("query key includes pagination, search, and backend sort", () => {
    expect(buildContactListQueryKey(baseState)).toEqual([
      "contacts",
      {
        search: "ada",
        page: 2,
        pageSize: 50,
        sortBy: "lastName",
        sortDir: "asc",
      },
    ]);
  });

  test("search params send backend sort before pagination", () => {
    const params = buildContactListSearchParams({
      ...baseState,
      sortBy: "company",
      sortDir: "desc",
    });

    expect(params.get("sortBy")).toBe("company");
    expect(params.get("sortDir")).toBe("desc");
    expect(params.get("page")).toBe("2");
    expect(params.get("pageSize")).toBe("50");
  });

  test("search params support explicit first-name and last-name sorts", () => {
    const firstNameParams = buildContactListSearchParams({
      ...baseState,
      sortBy: "firstName",
    });
    const lastNameParams = buildContactListSearchParams({
      ...baseState,
      sortBy: "lastName",
    });

    expect(firstNameParams.get("sortBy")).toBe("firstName");
    expect(lastNameParams.get("sortBy")).toBe("lastName");
  });

  test("normalizes missing or malformed contact payloads without crashing", () => {
    const normalized = normalizeContactListResponse(null);

    expect(normalized.contacts).toEqual([]);
    expect(normalized.page).toBe(1);
    expect(normalized.pageSize).toBe(20);
    expect(normalized.hasNextPage).toBe(false);
  });
});
