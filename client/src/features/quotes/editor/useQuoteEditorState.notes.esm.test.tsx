import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { jest, test, expect } from "@jest/globals";


let mockQuote: any;
const mockClient = { invalidateQueries: jest.fn(), setQueryData: jest.fn() };
const mockNavigate = jest.fn();
const mockLocation = { pathname: "/quotes/q/edit", search: "", state: null };
const mockProducts: any[] = [];
jest.unstable_mockModule("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: any) => ({ data: queryKey[0] === "/api/quotes" ? mockQuote : queryKey[0] === "/api/products" ? mockProducts : undefined }),
  useQueryClient: () => mockClient,
  useMutation: ({ mutationFn }: any) => ({ mutateAsync: mutationFn, isPending: false }),
}));
jest.unstable_mockModule("react-router-dom", () => ({ useParams: () => ({ id: "q" }), useLocation: () => mockLocation, useNavigate: () => mockNavigate }));
jest.unstable_mockModule("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.unstable_mockModule("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "staff", role: "employee" } }) }));
jest.unstable_mockModule("@/hooks/useOrgPreferences", () => ({ useOrgPreferences: () => ({ preferences: undefined }) }));
jest.unstable_mockModule("@/hooks/useOrders", () => ({ useConvertQuoteToOrder: () => ({ mutateAsync: jest.fn() }) }));
jest.unstable_mockModule("@/lib/queryClient", () => ({ apiRequest: jest.fn(), queryClient: { invalidateQueries: jest.fn() } }));

const { useQuoteEditorState } = await import("./useQuoteEditorState");
const { apiRequest } = await import("@/lib/queryClient");

function renderHook(hook: typeof useQuoteEditorState) {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const root = createRoot(host);
  const result = { current: undefined as unknown as ReturnType<typeof useQuoteEditorState> };
  function Harness() { result.current = hook(); return null; }
  const rerender = () => act(() => root.render(<Harness />));
  rerender();
  return { result, rerender, unmount: () => act(() => root.unmount()) };
}

test("saved job notes hydrate, edit/save, survive refetch and reopen from the canonical field", async () => {
  const log = jest.spyOn(console, "log").mockImplementation(() => {});
  mockQuote = { id: "q", customerId: "customer", shippingInstructions: "Original job notes", shippingMethod: "deliver", shippingCents: 2500,
    lineItems: [{ id: "line", productId: "product", productName: "Banner", quantity: 2, linePrice: "100", width: "24", height: "36", status: "active" }] };
  jest.mocked(apiRequest).mockImplementation(async (method, url, data: any) => {
    if (method === "PATCH" && url === "/api/quotes/q") mockQuote = { ...mockQuote, ...data };
    return { ok: true, json: async () => mockQuote } as Response;
  });
  const first = renderHook(() => useQuoteEditorState());
  expect(first.result.current.quoteNotes).toBe("Original job notes");
  expect(first.result.current.deliveryMethod).toBe("deliver");
  act(() => first.result.current.handlers.setQuoteNotes("Edited job notes"));
  mockQuote = { ...mockQuote };
  first.rerender();
  expect(first.result.current.quoteNotes).toBe("Edited job notes");
  await act(async () => { await first.result.current.handlers.saveQuote(); });
  expect(apiRequest).toHaveBeenCalledWith("PATCH", "/api/quotes/q", expect.objectContaining({ shippingInstructions: "Edited job notes", shippingMethod: "deliver", shippingCents: 2500 }));
  first.unmount();
  const reopened = renderHook(() => useQuoteEditorState());
  expect(reopened.result.current.quoteNotes).toBe("Edited job notes");
  act(() => reopened.result.current.handlers.setQuoteNotes(""));
  await act(async () => { await reopened.result.current.handlers.saveQuote(); });
  expect(mockQuote.shippingInstructions).toBeNull();
  reopened.unmount();
  log.mockRestore();
});
