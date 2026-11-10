import { TextEncoder, TextDecoder } from "node:util";
import { randomUUID } from "node:crypto";
Object.assign(globalThis, { TextEncoder, TextDecoder });
Object.assign(globalThis.crypto, { randomUUID });
// jsdom omits Node's Fetch Response; only JSON decoding is needed by this hook.
Object.assign(globalThis, { Response: class { constructor(private body: string) {} async json() { return JSON.parse(this.body); } } });
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
  listLabel?: string | null;
  shipToAddress1?: string | null;
  shipToCity?: string | null;
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
const mockProducts: import("@shared/schema").Product[] = [];
const mockApiRequest = jest.fn<(method: string, url: string, data?: Record<string, unknown>) => Promise<QuoteApiResponse>>();

jest.unstable_mockModule("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => ({ data: queryKey[0] === "/api/quotes" ? mockQuote : queryKey[0] === "/api/products" ? mockProducts : undefined }),
  useQueryClient: () => mockClient,
  useMutation: <Variables, Result>({ mutationFn }: { mutationFn: (variables: Variables) => Promise<Result> }) => ({ mutateAsync: mutationFn, isPending: false }),
}));
jest.unstable_mockModule("react-router-dom", () => ({ ...jest.requireActual<typeof import("react-router-dom")>("react-router-dom"), useParams: () => ({ id: "q" }), useLocation: () => mockLocation, useNavigate: () => mockNavigate }));
jest.unstable_mockModule("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.unstable_mockModule("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "staff", role: "employee" } }) }));
jest.unstable_mockModule("@/hooks/useOrgPreferences", () => ({ useOrgPreferences: () => ({ preferences: undefined }) }));
jest.unstable_mockModule("@/hooks/useOrders", () => ({ useConvertQuoteToOrder: () => ({ mutateAsync: jest.fn() }) }));
jest.unstable_mockModule("@/lib/queryClient", () => ({ apiRequest: mockApiRequest, queryClient: { invalidateQueries: jest.fn() } }));

let useQuoteEditorState: UseQuoteEditorState;

test("saved Quote Add Product stages a stable local draft before required options can be configured", async () => {
  mockQuote = { id: "q", revision: 1, customerId: "customer", lineItems: [] };
  mockProducts.push({ id: "required-product", name: "Required finish", optionsJson: [] } as unknown as import("@shared/schema").Product);
  mockApiRequest.mockClear();
  mockApiRequest.mockImplementation(async (method) => {
    if (method === "POST") throw new Error("Select required options before pricing: Finish.");
    return { ok: true, json: async () => mockQuote };
  });
  const editor = renderHook(() => useQuoteEditorState());
  try {
    await act(async () => { await Promise.all([editor.result.current.handlers.createDraftLineItem("required-product"), editor.result.current.handlers.createDraftLineItem("required-product")]); });
    expect(editor.result.current.lineItems).toHaveLength(1);
    const draft = editor.result.current.lineItems[0];
    expect(draft.id).toBeUndefined();
    expect(draft.tempId).toBeTruthy();
    expect(mockApiRequest.mock.calls.some(([method]) => method === "POST")).toBe(false);
    act(() => editor.result.current.handlers.updateLineItemLocal(draft.tempId!, { quantity: 3, optionSelectionsJson: { schemaVersion: 2, selected: { finish: { value: "gloss" } } } }));
    expect(editor.result.current.lineItems[0].tempId).toBe(draft.tempId);
    expect(editor.result.current.hasUnsavedChanges).toBe(true);
  } finally { editor.unmount(); mockProducts.length = 0; }
});

test("multiple configured additions reconcile canonical prices and identities on save and reopen", async () => {
  mockQuote = { id: "q", revision: 1, customerId: "customer", lineItems: [{ id: "existing", productId: "product", productName: "Vinyl", quantity: 1, width: "1", height: "1", linePrice: "10", status: "active", description: null }] };
  mockProducts.push({ id: "product", name: "Vinyl", optionsJson: [] } as unknown as import("@shared/schema").Product);
  mockApiRequest.mockImplementation(async (method, url, data) => {
    if (method === "PATCH" && url.endsWith("editor-save")) {
      const creates = (data!.lines as { create: Array<{ clientKey: string; data: object }> }).create;
      mockQuote = { ...mockQuote, revision: 2, lineItems: [...mockQuote.lineItems, ...creates.map((line, index) => ({ ...line.data, id: `created-${index}`, linePrice: "37.50", status: "active" } as QuoteLineFixture))] };
      return { ok: true, json: async () => ({ quote: mockQuote, created: creates.map((line, index) => ({ clientKey: line.clientKey, id: `created-${index}` })), changed: true }) };
    }
    return { ok: true, json: async () => mockQuote };
  });
  const editor = renderHook(() => useQuoteEditorState());
  try {
    for (let index = 0; index < 2; index++) await act(async () => { await editor.result.current.handlers.createDraftLineItem("product"); });
    const keys = editor.result.current.lineItems.slice(1).map(line => line.tempId!);
    expect(new Set(keys).size).toBe(2);
    act(() => keys.forEach(key => editor.result.current.handlers.updateLineItemLocal(key, { quantity: 3, linePrice: 30, optionSelectionsJson: { schemaVersion: 2, selected: { finish: { value: "gloss" } } } })));
    await act(async () => { await editor.result.current.handlers.saveQuote(); });
    expect(editor.result.current.lineItems.slice(1).map(line => line.linePrice)).toEqual([37.5, 37.5]);
    expect(editor.result.current.lineItems.slice(1).map(line => line.tempId)).toEqual(keys);
    expect(editor.result.current.hasUnsavedChanges).toBe(false);
  } finally { editor.unmount(); mockProducts.length = 0; }
  const reopened = renderHook(() => useQuoteEditorState());
  expect(reopened.result.current.lineItems).toHaveLength(3);
  expect(reopened.result.current.lineItems[1].quantity).toBe(3);
  expect(reopened.result.current.lineItems[1].optionSelectionsJson).toEqual({ schemaVersion: 2, selected: { finish: { value: "gloss" } } });
  reopened.unmount();
});

test("a new Quote stages multiple lines locally and adopts their saved identities without duplication", async () => {
  mockLocation.pathname = "/quotes/new";
  mockProducts.push({ id: "product", name: "Vinyl", optionsJson: [] } as unknown as import("@shared/schema").Product);
  let savedLines: QuoteLineFixture[] = [];
  mockApiRequest.mockClear();
  mockApiRequest.mockImplementation(async (method, _url, data) => {
    if (method === "POST") {
      savedLines = (data!.lineItems as object[]).map((line, index) => ({ ...line, id: `new-${index}`, linePrice: "10", status: "active" } as QuoteLineFixture));
      return { ok: true, json: async () => ({ id: "new-quote" }) };
    }
    return { ok: true, json: async () => ({ id: "new-quote", revision: 1, customerId: "customer", lineItems: savedLines }) };
  });
  const editor = renderHook(() => useQuoteEditorState());
  try {
    act(() => editor.result.current.handlers.setCustomer("customer"));
    for (let index = 0; index < 2; index++) await act(async () => { await editor.result.current.handlers.createDraftLineItem("product"); });
    expect(editor.result.current.lineItems).toHaveLength(2);
    expect(mockApiRequest).not.toHaveBeenCalled();
    await act(async () => { await editor.result.current.handlers.saveQuote(); });
    expect(editor.result.current.lineItems.map(line => line.id)).toEqual(["new-0", "new-1"]);
    expect(mockApiRequest.mock.calls.filter(([method]) => method === "POST")).toHaveLength(1);
  } finally { editor.unmount(); mockProducts.length = 0; mockLocation.pathname = "/quotes/q/edit"; }
});

test("a failed or unconfirmed create retains the configured draft without reporting success", async () => {
  mockQuote = { id: "q", revision: 1, customerId: "customer", lineItems: [] };
  mockProducts.push({ id: "product", name: "Vinyl", optionsJson: [] } as unknown as import("@shared/schema").Product);
  let failure: "reject" | "missing" = "reject";
  mockApiRequest.mockImplementation(async (method) => {
    if (method === "PATCH") {
      if (failure === "reject") throw new Error("400: Finish is required");
      return { ok: true, json: async () => ({ quote: { ...mockQuote, revision: 2 }, created: [], changed: true }) };
    }
    if (method === "POST") return { ok: true, json: async () => ({ data: {} }) };
    return { ok: true, json: async () => mockQuote };
  });
  const editor = renderHook(() => useQuoteEditorState());
  try {
    await act(async () => { await editor.result.current.handlers.createDraftLineItem("product"); });
    const key = editor.result.current.lineItems[0].tempId!;
    act(() => editor.result.current.handlers.updateLineItemLocal(key, { description: "Retain my work", quantity: 5 }));
    await act(async () => { await expect(editor.result.current.handlers.saveQuote()).rejects.toThrow("Finish is required"); });
    failure = "missing";
    await act(async () => { await expect(editor.result.current.handlers.saveQuote()).rejects.toThrow("did not confirm every added line"); });
    let saved: boolean | undefined;
    await act(async () => { saved = await editor.result.current.handlers.saveLineItem(key); });
    expect(saved).toBe(false);
    expect(editor.result.current.lineItems[0]).toMatchObject({ tempId: key, description: "Retain my work", quantity: 5 });
    expect(editor.result.current.lineItems[0].id).toBeUndefined();
    expect(editor.result.current.hasUnsavedChanges).toBe(true);
  } finally { editor.unmount(); mockProducts.length = 0; }
});

test.each(["stale", "locked"])("%s saved Quotes reject Add Product without a mutation", async (reason) => {
  mockQuote = { id: "q", revision: 1, customerId: "customer", lineItems: [] };
  mockProducts.push({ id: "product", name: "Vinyl", optionsJson: [] } as unknown as import("@shared/schema").Product);
  mockApiRequest.mockClear();
  mockApiRequest.mockImplementation(async () => ({ ok: true, json: async () => ({ ...mockQuote, revision: reason === "stale" ? 2 : 1, status: reason === "locked" ? "active" : "draft" }) }));
  const editor = renderHook(() => useQuoteEditorState());
  try {
    await act(async () => { await editor.result.current.handlers.createDraftLineItem("product"); });
    expect(editor.result.current.lineItems).toHaveLength(0);
    expect(mockApiRequest.mock.calls.every(([method]) => method === "GET")).toBe(true);
  } finally { editor.unmount(); mockProducts.length = 0; }
});

test("artwork persistence uses the configured payload and advances the revision before Quote save", async () => {
  mockQuote = { id: "q", revision: 1, customerId: "customer", lineItems: [{ id: "existing", productId: "product", productName: "Vinyl", quantity: 1, width: "1", height: "1", linePrice: "10", status: "active", description: null }] };
  mockProducts.push({ id: "product", name: "Vinyl", optionsJson: [] } as unknown as import("@shared/schema").Product);
  mockApiRequest.mockClear();
  mockApiRequest.mockImplementation(async (method, url, data) => {
    if (method === "POST") {
      mockQuote = { ...mockQuote, revision: 2, lineItems: [...mockQuote.lineItems, { ...data, id: "artwork-line", status: "active" } as QuoteLineFixture] };
      return { ok: true, json: async () => ({ data: mockQuote.lineItems[1] }) };
    }
    if (method === "PATCH") {
      const deleted = (data!.lines as { delete: string[] }).delete;
      mockQuote = { ...mockQuote, revision: 3, lineItems: mockQuote.lineItems.filter(line => !deleted.includes(line.id)) };
      return { ok: true, json: async () => ({ quote: mockQuote, created: [], changed: true }) };
    }
    return { ok: true, json: async () => mockQuote };
  });
  const editor = renderHook(() => useQuoteEditorState());
  try {
    await act(async () => { await editor.result.current.handlers.createDraftLineItem("product"); });
    const key = editor.result.current.lineItems[1].tempId!;
    act(() => editor.result.current.handlers.updateLineItemLocal(key, { priceOverride: { mode: "override_total_after_margin", valueCents: 4000 } } as Partial<import("./types").QuoteLineItemDraft>));
    await act(async () => { expect(await editor.result.current.handlers.ensureLineItemId(key)).toEqual({ quoteId: "q", lineItemId: "artwork-line" }); });
    expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/quotes/q/line-items", expect.objectContaining({ priceOverride: { mode: "override_total_after_margin", valueCents: 4000 } }), expect.anything());
    // Remove the newly persisted artwork line before the first full Quote save.
    act(() => editor.result.current.handlers.removeLineItem(key));
    expect(editor.result.current.hasUnsavedChanges).toBe(true);
    await act(async () => { await editor.result.current.handlers.saveQuote(); });
    expect(mockApiRequest).toHaveBeenCalledWith("PATCH", "/api/quotes/q/editor-save", expect.objectContaining({ expectedRevision: 2, lines: expect.objectContaining({ delete: ["artwork-line"] }) }));
    expect(mockQuote.lineItems.map(line => line.id)).toEqual(["existing"]);
    await act(async () => { await editor.result.current.handlers.saveQuote(); });
    expect(mockApiRequest).toHaveBeenLastCalledWith("PATCH", "/api/quotes/q/editor-save", expect.objectContaining({ lines: expect.objectContaining({ delete: [] }) }));
  } finally { editor.unmount(); mockProducts.length = 0; }
});

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

test("new editor instances register real unsaved changes before a first save without sharing their baseline", () => {
  mockLocation.pathname = "/quotes/new";
  let first: ReturnType<typeof renderHook> | undefined, second: ReturnType<typeof renderHook> | undefined;
  try {
    first = renderHook(() => useQuoteEditorState()); second = renderHook(() => useQuoteEditorState());
    expect(first.result.current.hasUnsavedChanges).toBe(false);
    expect(second.result.current.hasUnsavedChanges).toBe(false);
    act(() => first!.result.current.handlers.setOrderPoNumber("FIRST"));
    expect(first.result.current.hasUnsavedChanges).toBe(true);
    expect(second.result.current.hasUnsavedChanges).toBe(false);
    act(() => second!.result.current.handlers.setJobLabel("SECOND"));
    expect(second.result.current.hasUnsavedChanges).toBe(true);
    act(() => first!.result.current.handlers.setOrderPoNumber(""));
    expect(first.result.current.hasUnsavedChanges).toBe(false);
    expect(second.result.current.jobLabel).toBe("SECOND");
  } finally { first?.unmount(); second?.unmount(); mockLocation.pathname = "/quotes/q/edit"; }
});

test('saved tags and shipping hydrate cleanly and a background refetch does not overwrite staff edits',()=>{
  mockQuote={id:'q',revision:1,customerId:'customer',listLabel:'Urgent, Vinyl',shipToAddress1:'10 Test Road',shipToCity:'Synthetic',lineItems:[]};
  const editor=renderHook(()=>useQuoteEditorState());
  expect(editor.result.current.tags).toEqual(['Urgent','Vinyl']);expect(editor.result.current.shippingAddress.street1).toBe('10 Test Road');
  expect(editor.result.current.hasUnsavedChanges).toBe(false);
  act(()=>editor.result.current.handlers.setJobLabel('Staff work'));expect(editor.result.current.hasUnsavedChanges).toBe(true);
  mockQuote={...mockQuote,listLabel:'Unrelated server refresh'};editor.rerender();expect(editor.result.current.jobLabel).toBe('Staff work');
  act(()=>editor.result.current.handlers.setJobLabel(''));expect(editor.result.current.hasUnsavedChanges).toBe(false);editor.unmount();
});

test('confirmed save clears the baseline without waiting for a query refetch',async()=>{
  mockQuote={id:'q',revision:1,customerId:'customer',lineItems:[{id:'line',productId:'product',productName:'Vinyl',quantity:1,linePrice:'10',width:'24',height:'18',status:'active',description:null}]};
  mockApiRequest.mockImplementation(async(method,url,data)=>({ok:true,json:async()=>method==='PATCH'?{quote:{...mockQuote,...data?.header as object,revision:2},created:[],changed:true}:mockQuote}));
  const editor=renderHook(()=>useQuoteEditorState());act(()=>editor.result.current.handlers.setJobLabel('Confirmed'));
  await act(async()=>{await editor.result.current.handlers.saveQuote();});expect(editor.result.current.hasUnsavedChanges).toBe(false);editor.unmount();
});

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

test('first explicit Quote save reads canonical state without overwriting edits made while creation is pending',async()=>{
  mockLocation.pathname='/quotes/new';mockProducts.push({id:'product',name:'Vinyl',measurementMode:'dimensions',optionsJson:[]} as unknown as import('@shared/schema').Product);
  let release:((response:QuoteApiResponse)=>void)|undefined;
  mockApiRequest.mockImplementation(async(method,url)=>{
    if(method==='POST' && url==='/api/quotes')return await new Promise<QuoteApiResponse>(resolve=>{release=resolve;});
    return {ok:true,json:async()=>({id:'new-quote',revision:1,customerId:'customer',label:'Submitted label',lineItems:[{id:'saved-line',productId:'product',productName:'Vinyl',quantity:3,linePrice:'10',width:'24',height:'18',status:'active',description:null}]})};
  });
  const editor=renderHook(()=>useQuoteEditorState());
  try{
    act(()=>editor.result.current.handlers.setCustomer('customer'));
    await act(async()=>{await editor.result.current.handlers.createDraftLineItem('product');});
    const line=editor.result.current.lineItems[0];act(()=>{editor.result.current.handlers.updateLineItemLocal(line.tempId!,{quantity:3,width:24,height:18,linePrice:10,status:'active'});editor.result.current.handlers.setJobLabel('Submitted label');});
    let pending:ReturnType<typeof editor.result.current.handlers.saveQuote>;act(()=>{pending=editor.result.current.handlers.saveQuote();});
    act(()=>editor.result.current.handlers.setJobLabel('Newer unsaved label'));
    await act(async()=>{release!({ok:true,json:async()=>({id:'new-quote',quoteNumber:123})});await pending!;});
    expect(editor.result.current.jobLabel).toBe('Newer unsaved label');expect(editor.result.current.hasUnsavedChanges).toBe(true);
    expect(editor.result.current.lineItems[0].id).toBe('saved-line');expect(mockApiRequest).toHaveBeenCalledWith('GET','/api/quotes/new-quote');
  }finally{editor.unmount();mockProducts.length=0;mockLocation.pathname='/quotes/q/edit';}
});
