import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let quoteQuery: any;
const quote = { id: "quote-20900", quoteNumber: 20900, customerName: "Office Hub", label: "24×36 Foam",
  status: "draft", workflowState: "draft", createdAt: "2026-01-01T12:00:00Z", totalPrice: "100.00", lineItems: [], lineItemsCount: 0 };
const response = { items: [quote], page: 1, pageSize: 25, totalCount: 51, totalPages: 3, hasNext: true, hasPrev: false };
jest.mock("@tanstack/react-query", () => ({
  useQuery: (options: any) => {
    if (options.queryKey[0] === "/api/quotes") {
      quoteQuery = options;
      return { data: { ...response, page: options.queryKey[1].page }, isLoading: false, isFetching: false };
    }
    return { data: options.queryKey[0] === "/api/products" ? [] : { id: "org-test" } };
  },
  useMutation: () => ({ mutate: jest.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock("react-router-dom", () => ({ useNavigate: () => jest.fn(), Link: ({ children, to }: any) => <a href={to}>{children}</a> }));
jest.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "staff", role: "owner" } }) }));
jest.mock("@/hooks/useOrgPreferences", () => ({ useOrgPreferences: () => ({ preferences: {}, isLoading: false }) }));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("@/hooks/useOrders", () => ({ useConvertQuoteToOrder: () => ({ mutateAsync: jest.fn() }) }));
jest.mock("@/hooks/useSmartBack", () => ({ useSmartBack: () => ({ onSmartBack: jest.fn() }) }));
jest.mock("@/lib/getThumbSrc", () => ({ objectsUrlFromKey: () => null }));
jest.mock("@/lib/queryClient", () => ({ apiFetch: jest.fn() }));
jest.mock("@/components/AttachmentViewerDialog", () => ({ AttachmentViewerDialog: () => null }));
jest.mock("@/components/ViewAllAttachmentsDialog", () => ({ ViewAllAttachmentsDialog: () => null }));
jest.mock("@/components/convert-quote-to-order-dialog", () => ({ ConvertQuoteToOrderDialog: () => null }));
jest.mock("@/components/quote-list-note", () => ({ QuoteListNote: () => null }));
jest.mock("@/components/titan", () => ({
  Page: ({ children }: any) => <main>{children}</main>,
  PageHeader: ({ children }: any) => <header>{children}</header>,
  ContentLayout: ({ children }: any) => <section>{children}</section>,
  DataCard: ({ children }: any) => <section>{children}</section>,
  ColumnConfig: () => null,
  useColumnSettings: () => [{}, jest.fn()],
  isColumnVisible: () => true,
  getColumnOrder: (columns: any) => columns,
  getColumnDisplayName: (column: any) => column.label,
}));

import InternalQuotes from "./internal-quotes";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(async () => {
  localStorage.clear();
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => response })) as any;
  jest.spyOn(console, "log").mockImplementation(() => {});
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root.render(<InternalQuotes />); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); jest.restoreAllMocks(); });
const searchInput = () => host.querySelector<HTMLInputElement>('input[aria-label="Search quotes, customers, jobs, or PO numbers"]')!;
async function changeSearch(value: string) {
  await act(async () => { Simulate.change(searchInput(), { target: { value } } as any); });
  await quoteQuery.queryFn();
  return new URL((fetch as jest.Mock).mock.calls.at(-1)![0], "https://example.invalid");
}

test.each(["20900", "QT-20900", "Office Hub", "24×36 Foam", "PO-777", "Foam"])("sends %s to server search with existing filters", async term => {
  expect(searchInput().placeholder).toBe("Search quotes, customers, jobs, or PO numbers...");
  const url = await changeSearch(term);
  expect(url.pathname).toBe("/api/quotes");
  expect(url.searchParams.get("search")).toBe(term);
  expect(url.searchParams.has("searchCustomer")).toBe(false);
  expect(url.searchParams.get("source")).toBe("internal");
  expect(url.searchParams.get("sortBy")).toBe("date");
  expect(url.searchParams.get("sortDir")).toBe("desc");
  expect(url.searchParams.get("pageSize")).toBe("25");
});
test("search changes reset a later page and clearing search restores the unfiltered request", async () => {
  const next = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Next")!;
  await act(async () => { next.click(); });
  expect(quoteQuery.queryKey[1].page).toBe(2);
  const url = await changeSearch("20900");
  expect(url.searchParams.get("page")).toBe("1");
  expect(quoteQuery.queryKey[1]).toMatchObject({ page: 1, search: "20900" });
  expect((await changeSearch("")).searchParams.has("search")).toBe(false);
});
