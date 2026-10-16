import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, jest, test, expect } from "@jest/globals";

type QuoteLineFixture = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  linePrice: string;
  width: string;
  height: string;
  status: "active";
  description: string | null;
};
type QuoteFixture = {
  id: string;
  revision: number;
  customerId: string;
  shippingInstructions?: string | null;
  shippingMethod?: string | null;
  shippingCents?: number | null;
  lineItems: QuoteLineFixture[];
};
type QuoteApiResponse = { ok: boolean; json: () => Promise<unknown> };
type UseQuoteEditorState = typeof import("./useQuoteEditorState").useQuoteEditorState;

let mockQuote: QuoteFixture;
const mockClient = { invalidateQueries: jest.fn(), setQueryData: jest.fn() };
const mockNavigate = jest.fn<(destination: string) => void>();
const mockLocation = { pathname: "/quotes/q/edit", search: "", state: null };
const mockProducts: never[] = [];
const mockApiRequest = jest.fn<(method: string, url: string, data?: Record<string, unknown>) => Promise<QuoteApiResponse>>();

jest.unstable_mockModule("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => ({ data: queryKey[0] === "/api/quotes" ? mockQuote : queryKey[0] === "/api/products" ? mockProducts : undefined }),
  useQueryClient: () => mockClient,
  useMutation: <Variables, Result>({ mutationFn }: { mutationFn: (variables: Variables) => Promise<Result> }) => ({ mutateAsync: mutationFn, isPending: false }),
}));
jest.unstable_mockModule("react-router-dom", () => ({ useParams: () => ({ id: "q" }), useLocation: () => mockLocation, useNavigate: () => mockNavigate }));
jest.unstable_mockModule("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.unstable_mockModule("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "staff", role: "employee" } }) }));
jest.unstable_mockModule("@/hooks/useOrgPreferences", () => ({ useOrgPreferences: () => ({ preferences: undefined }) }));
jest.unstable_mockModule("@/hooks/useOrders", () => ({ useConvertQuoteToOrder: () => ({ mutateAsync: jest.fn() }) }));
jest.unstable_mockModule("@/lib/queryClient", () => ({ apiRequest: mockApiRequest, queryClient: { invalidateQueries: jest.fn() } }));

let useQuoteEditorState: UseQuoteEditorState;

beforeAll(async () => {
  ({ useQuoteEditorState } = await import("./useQuoteEditorState"));
});

function renderHook(hook: UseQuoteEditorState) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  let current: ReturnType<UseQuoteEditorState> | undefined;
  const result = {
    get current(): ReturnType<UseQuoteEditorState> {
      if (!current) throw new Error("Hook has not rendered");
      return current;
    },
  };
  function Harness() { current = hook(); return null; }
  const rerender = () => act(() => root.render(<Harness />));
  rerender();
  return { result, rerender, unmount: () => act(() => root.unmount()) };
}

test("saved job notes hydrate, edit/save, survive refetch and reopen from the canonical field", async () => {
  const log = jest.spyOn(console, "log").mockImplementation(() => {});
  mockQuote = { id: "q", revision: 1, customerId: "customer", shippingInstructions: "Original job notes", shippingMethod: "deliver", shippingCents: 2500,
    lineItems: [{ id: "line", productId: "product", productName: "Banner", quantity: 2, linePrice: "100", width: "24", height: "36", status: "active", description: null }] };
  mockApiRequest.mockImplementation(async (method, url, data) => {
    if (method === "PATCH" && url === "/api/quotes/q/editor-save" && data) {
      mockQuote = { ...mockQuote, ...(data.header as Partial<QuoteFixture>), revision: mockQuote.revision + 1 };
      return { ok: true, json: async () => ({ quote: mockQuote, created: [], changed: true }) };
    }
    return { ok: true, json: async () => mockQuote };
  });
  const first = renderHook(() => useQuoteEditorState());
  expect(first.result.current.quoteNotes).toBe("Original job notes");
  expect(first.result.current.deliveryMethod).toBe("deliver");
  act(() => first.result.current.handlers.setQuoteNotes("Edited job notes"));
  mockQuote = { ...mockQuote };
  first.rerender();
  expect(first.result.current.quoteNotes).toBe("Edited job notes");
  await act(async () => { await first.result.current.handlers.saveQuote(); });
  expect(mockApiRequest).toHaveBeenCalledWith("PATCH", "/api/quotes/q/editor-save", expect.objectContaining({ header: expect.objectContaining({ shippingInstructions: "Edited job notes" }), lines: { create: [], update: [], delete: [] } }));
  first.unmount();
  const reopened = renderHook(() => useQuoteEditorState());
  expect(reopened.result.current.quoteNotes).toBe("Edited job notes");
  act(() => reopened.result.current.handlers.setQuoteNotes(""));
  await act(async () => { await reopened.result.current.handlers.saveQuote(); });
  expect(mockQuote.shippingInstructions).toBeNull();
  reopened.unmount();
  log.mockRestore();
});

test("customer-facing line description survives Quote save and reload", async () => {
  const log = jest.spyOn(console, "log").mockImplementation(() => {});
  mockQuote = { id: "q", revision: 1, customerId: "customer", lineItems: [{ id: "line", productId: "product", productName: "Coroplast", quantity: 2, linePrice: "100", width: "48", height: "96", status: "active", description: null }] };
  mockApiRequest.mockImplementation(async (method, url, data) => {
    if (method === "PATCH" && url === "/api/quotes/q/editor-save") {
      const [lineItem, ...remainingLineItems] = mockQuote.lineItems;
      if (lineItem) {
        const submitted = (data?.lines as { update?: Array<{ data: { description?: string | null } }> })?.update?.[0]?.data;
        mockQuote = {
          ...mockQuote,
          revision: mockQuote.revision + 1,
          lineItems: [{ ...lineItem, description: submitted?.description ?? null }, ...remainingLineItems],
        };
      }
      return { ok: true, json: async () => ({ quote: mockQuote, created: [], changed: true }) };
    }
    return { ok: true, json: async () => mockQuote };
  });
  const editor = renderHook(() => useQuoteEditorState());
  act(() => editor.result.current.handlers.updateLineItemLocal("line", { description: "48 x 96 fluted white sheets" }));
  await act(async () => { await editor.result.current.handlers.saveQuote(); });
  expect(mockApiRequest).toHaveBeenCalledWith("PATCH", "/api/quotes/q/editor-save", expect.objectContaining({ lines: expect.objectContaining({ update: [expect.objectContaining({ id: "line", data: expect.objectContaining({ description: "48 x 96 fluted white sheets" }) })] }) }));
  editor.unmount();
  const reopened = renderHook(() => useQuoteEditorState());
  expect(reopened.result.current.lineItems[0].description).toBe("48 x 96 fluted white sheets");
  reopened.unmount();
  log.mockRestore();
});

test("a failed transactional save keeps local line edits and the reviewed revision", async () => {
  const log = jest.spyOn(console, "log").mockImplementation(() => {});
  const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
  mockQuote = { id: "q", revision: 1, customerId: "customer", lineItems: [{ id: "line", productId: "product", productName: "Banner", quantity: 1, linePrice: "10", width: "24", height: "36", status: "active", description: null }] };
  mockApiRequest.mockImplementation(async (method, url) => {
    if (method === "PATCH" && url === "/api/quotes/q/editor-save") throw new Error("409: Quote changed; reload before saving.");
    return { ok: true, json: async () => mockQuote };
  });
  const editor = renderHook(() => useQuoteEditorState());
  act(() => editor.result.current.handlers.updateLineItemLocal("line", { description: "Keep this edit" }));
  await expect(act(async () => { await editor.result.current.handlers.saveQuote(); })).rejects.toThrow("Quote changed");
  expect(editor.result.current.lineItems[0].description).toBe("Keep this edit");
  expect(mockQuote.revision).toBe(1);
  editor.unmount();
  errorLog.mockRestore();
  log.mockRestore();
});

test("an edit made during a pending save stays local and dirty after authoritative success", async () => {
  const log = jest.spyOn(console, "log").mockImplementation(() => {});
  mockQuote = { id: "q", revision: 1, customerId: "customer", shippingInstructions: "Original", lineItems: [{ id: "line", productId: "product", productName: "Banner", quantity: 1, linePrice: "10", width: "24", height: "36", status: "active", description: null }] };
  let resolveSave: ((response: QuoteApiResponse) => void) | undefined;
  mockApiRequest.mockImplementation(async (method, url) => {
    if (method === "PATCH" && url === "/api/quotes/q/editor-save") return await new Promise<QuoteApiResponse>((resolve) => { resolveSave = resolve; });
    return { ok: true, json: async () => mockQuote };
  });
  const editor = renderHook(() => useQuoteEditorState());
  act(() => editor.result.current.handlers.setQuoteNotes("Submitted note"));
  let pendingSave: ReturnType<typeof editor.result.current.handlers.saveQuote>;
  act(() => { pendingSave = editor.result.current.handlers.saveQuote(); });
  await expect(editor.result.current.handlers.saveQuote()).rejects.toThrow("already in progress");
  act(() => editor.result.current.handlers.setQuoteNotes("Later edit"));
  await act(async () => {
    resolveSave?.({ ok: true, json: async () => ({ quote: { ...mockQuote, revision: 2, shippingInstructions: "Submitted note" }, created: [], changed: true }) });
    await pendingSave;
  });
  expect(editor.result.current.quoteNotes).toBe("Later edit");
  expect(editor.result.current.hasUnsavedChanges).toBe(true);
  editor.unmount();
  log.mockRestore();
});
