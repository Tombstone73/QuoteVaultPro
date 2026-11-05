import React, { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { TextEncoder, TextDecoder } from "node:util";
Object.assign(globalThis, { TextEncoder, TextDecoder });
const { MemoryRouter, Routes, Route, Outlet, Link, useNavigate, useLocation, useSearchParams } = await import("react-router-dom");
const { WorkspaceTabsProvider, WorkspaceTabBar, WorkspacePanels } = await import("./WorkspaceTabs");
const { useWorkspaceTitle } = await import("./WorkspaceTitle");
const { useWorkspaceLocation, useWorkspaceNavigate, useWorkspaceDom } = await import("@/contexts/WorkspaceContext");
const { NavigationGuardProvider, useWorkspaceUnsavedChanges } = await import("@/contexts/NavigationGuardContext");
const { Dialog, DialogContent, DialogTitle, DialogDescription } = await import("@/components/ui/dialog");
const { Input } = await import("@/components/ui/input");
const { matchWorkspaceRoute } = await import("./workspaceRoutes");

let host: HTMLDivElement, root: Root, mounts = 0;
let lateSave: (() => void) | undefined;
function Editor() {
  const location = useWorkspaceLocation(), navigate = useWorkspaceNavigate(), dom = useWorkspaceDom();
  const [value, setValue] = useState(""), [dirty, setDirty] = useState(false), [modal, setModal] = useState(false);
  const match = matchWorkspaceRoute(location.pathname)!;
  useWorkspaceUnsavedChanges(dirty, "fixture");
  useWorkspaceTitle(!match.isNew ? `${match.family} saved ${match.params.id}` : undefined);
  useEffect(() => { mounts++; }, []);
  return <>
    <label htmlFor={dom.fieldId("value")}>Editor values</label><Input id="value" value={value} onChange={event => { setValue(event.target.value); setDirty(true); }}/>
    <output data-testid="route">{location.pathname}</output>
    <button onClick={() => { setDirty(false); navigate("/orders/saved-1", { replace: true, state: { titanWorkspaceSaved: true } }); }}>Save record</button>
    <button onClick={() => { lateSave = () => { setDirty(false); navigate("/orders/late-1", { replace: true, state: { titanWorkspaceSaved: true } }); }; }}>Prepare late save</button>
    <button onClick={() => navigate("/orders/existing-1")}>Open another saved record</button>
    <button onClick={() => setModal(true)}>Open editor dialog</button>
    <Dialog open={modal} onOpenChange={setModal}><DialogContent><DialogTitle>Scoped dialog</DialogTitle><DialogDescription>Retained state</DialogDescription><Input aria-label="Dialog edits" defaultValue=""/></DialogContent></Dialog>
  </>;
}
function Controls() {
  const navigate = useNavigate(), location = useLocation();
  return <>
    <output data-testid="global-route">{location.pathname}</output>
    <button onClick={() => navigate("/orders/new", { state: { titanWorkspaceId: crypto.randomUUID() } })}>Another order</button>
    <button onClick={() => navigate("/orders/new")}>Sidebar New Order</button>
    <button onClick={() => navigate("/quotes/new")}>Another quote</button>
    <button onClick={() => navigate("/orders/existing-1")}>Existing order</button>
    <button onClick={() => navigate("/customers/customer-1")}>Customer</button>
    <button onClick={() => navigate("/orders")}>Order list</button>
    <button onClick={() => navigate(-1)}>Back</button><button onClick={() => navigate(1)}>Forward</button>
  </>;
}
function App() { return <MemoryRouter initialEntries={["/orders/new"]}><NavigationGuardProvider><WorkspaceTabsProvider>
  <Controls/><WorkspaceTabBar/><WorkspacePanels renderEditor={() => <Editor/>}><p>Outside editor</p></WorkspacePanels>
</WorkspaceTabsProvider></NavigationGuardProvider></MemoryRouter>; }
const allPanels = () => Array.from(host.querySelectorAll<HTMLElement>('[role="tabpanel"]'));
const activePanel = () => allPanels().find(panel => !panel.hidden)!;
const tabs = () => Array.from(host.querySelectorAll<HTMLElement>('[role="tab"]'));
const click = (text: string, within: ParentNode = host) => act(() => { Array.from(within.querySelectorAll("button")).find(button => button.textContent === text)!.click(); });
const change = (input: HTMLInputElement, value: string) => act(() => { input.value = value; Simulate.change(input, { target: { value } } as never); });
const close = (index: number) => act(() => { host.querySelectorAll<HTMLButtonElement>('button[aria-label^="Close "]')[index].click(); });
const newAction = (name: string) => act(() => host.querySelector<HTMLButtonElement>(`button[aria-label="New ${name}"]`)!.click());

let inactiveNavigate: (() => void) | undefined;
function NavigationPage() {
  const location = useLocation(), navigate = useNavigate(), [params, setParams] = useSearchParams();
  const [selection, setSelection] = useState(""), [modal, setModal] = useState(false);
  return <>
    <output data-testid="local-route">{location.pathname}{location.search}</output>
    <input aria-label="List selection" value={selection} onChange={event => setSelection(event.target.value)}/>
    <button onClick={() => setParams({ search: "20720" })}>Filter list</button>
    <output data-testid="search">{params.get("search")}</output>
    <button onClick={() => { inactiveNavigate = () => navigate("/invoices"); }}>Prepare inactive navigation</button>
    <Link to="/orders/existing-1">Open saved Order</Link><Link to="/customers/customer-1">Open saved Customer</Link>
    <button onClick={() => setModal(true)}>Open list dialog</button>
    <Dialog open={modal} onOpenChange={setModal}><DialogContent><DialogTitle>List dialog</DialogTitle><DialogDescription>Navigation workspace dialog</DialogDescription><Input aria-label="List dialog edits"/></DialogContent></Dialog>
  </>;
}
function RoutedHost() {
  return <WorkspaceTabsProvider><Controls/><WorkspaceTabBar/><WorkspacePanels renderEditor={() => <Editor/>}><Outlet/></WorkspacePanels></WorkspaceTabsProvider>;
}
function renderNavigationApp() {
  act(() => root.unmount()); root = createRoot(host);
  act(() => root.render(<MemoryRouter initialEntries={["/orders"]}><NavigationGuardProvider><Routes><Route element={<RoutedHost/>}>
    <Route path="/orders" element={<NavigationPage/>}/><Route path="/invoices" element={<NavigationPage/>}/>
    <Route path="/orders/:id" element={<Editor/>}/><Route path="/quotes/:id" element={<Editor/>}/><Route path="/customers/:id" element={<Editor/>}/>
  </Route></Routes></NavigationGuardProvider></MemoryRouter>));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let nextId = 0; Object.defineProperty(crypto, "randomUUID", { configurable: true, value: () => `id-${++nextId}` });
  Element.prototype.scrollIntoView = jest.fn();
  Element.prototype.scrollTo = function(options?: ScrollToOptions | number, y?: number) { this.scrollTop = typeof options === "number" ? y ?? 0 : options?.top ?? 0; };
  window.scrollTo = jest.fn();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); mounts = 0; lateSave = undefined;
  localStorage.clear(); sessionStorage.clear();
  act(() => root.render(<App/>));
});
afterEach(() => { act(() => root.unmount()); host.remove(); jest.restoreAllMocks(); });

test("two new Orders and a Quote retain independent business fields without remounting", () => {
  const a = activePanel(); change(a.querySelector("input")!, "PBV2, quantity 28, size 24x18, $165, artwork A");
  expect(tabs()[0].querySelector('[aria-label="Unsaved changes"]')).not.toBeNull();
  click("Another order"); const b = activePanel(); expect(b).not.toBe(a);
  change(b.querySelector("input")!, "Independent order B"); click("Another quote");
  change(activePanel().querySelector("input")!, "Quote options");
  act(() => tabs()[0].click()); expect(activePanel()).toBe(a);
  expect(a.querySelector("input")!.value).toContain("$165");
  act(() => tabs()[1].click()); expect(b.querySelector("input")!.value).toBe("Independent order B");
  expect(mounts).toBe(3);
});

test("saved record links reuse one workspace while Customer and outside navigation retain it", () => {
  click("Existing order"); const existing = activePanel(); change(existing.querySelector("input")!, "Keep customer and artwork");
  click("Customer"); expect(activePanel()).not.toBe(existing);
  click("Existing order"); expect(activePanel()).toBe(existing); expect(tabs()).toHaveLength(3);
  click("Order list"); expect(allPanels().every(panel => panel.hidden)).toBe(true);
  expect(host.textContent).toContain("Outside editor");
  click("Existing order"); expect(existing.querySelector("input")!.value).toBe("Keep customer and artwork"); expect(mounts).toBe(3);
});

test("dirty close cancellation preserves state; confirmed close affects only its own editor", () => {
  const a = activePanel(); change(a.querySelector("input")!, "Unsaved A"); click("Another order");
  change(activePanel().querySelector("input")!, "Unsaved B");
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
  close(0); expect(confirm).toHaveBeenCalledTimes(1); expect(tabs()).toHaveLength(2);
  expect(a.querySelector("input")!.value).toBe("Unsaved A");
  confirm.mockReturnValue(true); close(0); expect(tabs()).toHaveLength(1);
  expect(activePanel().querySelector("input")!.value).toBe("Unsaved B");
});

test("clean close is immediate and closing the final tab returns to its list", () => {
  const confirm = jest.spyOn(window, "confirm"); close(0);
  expect(confirm).not.toHaveBeenCalled(); expect(tabs()).toHaveLength(0);
  expect(host.querySelector('[data-testid="global-route"]')?.textContent).toBe("/orders");
});

test("saving updates route identity/title and dirty status without remounting an unchanged editor", () => {
  const panel = activePanel(); change(panel.querySelector("input")!, "Save canonical data"); click("Save record", panel);
  expect(activePanel()).toBe(panel); expect(tabs()[0].textContent).toContain("order saved saved-1");
  expect(tabs()[0].querySelector('[aria-label="Unsaved changes"]')).toBeNull(); expect(mounts).toBe(1);
});

test("late save changes its inactive owner without retargeting another tab", () => {
  const a = activePanel(); change(a.querySelector("input")!, "A"); click("Prepare late save", a);
  click("Another order"); const b = activePanel(); change(b.querySelector("input")!, "B");
  act(() => lateSave!()); expect(activePanel()).toBe(b);
  expect(a.querySelector('[data-testid="route"]')?.textContent).toBe("/orders/late-1");
  expect(b.querySelector("input")!.value).toBe("B");
});

test("ordinary record navigation cannot replace an unsaved new editor", () => {
  const a = activePanel(); change(a.querySelector("input")!, "Keep my unsaved draft");
  click("Open another saved record", a);
  expect(allPanels()).toHaveLength(2); expect(activePanel()).not.toBe(a);
  act(() => tabs()[0].click()); expect(a.querySelector("input")!.value).toBe("Keep my unsaved draft");
});

test("multiple new Quotes use separate identities and editor state", () => {
  click("Another quote");const first=activePanel();change(first.querySelector("input")!,"Quote A options");
  click("Another quote");expect(activePanel()).not.toBe(first);change(activePanel().querySelector("input")!,"Quote B prices");
  act(()=>tabs()[1].click());expect(activePanel()).toBe(first);expect(first.querySelector("input")!.value).toBe("Quote A options");
});

test("late completion after a confirmed close cannot resurrect a workspace", () => {
  const a = activePanel(); click("Prepare late save", a); click("Another order"); const b = activePanel();
  close(0); act(() => lateSave!()); expect(tabs()).toHaveLength(1); expect(activePanel()).toBe(b);
});

test("Strict Mode effect replay does not create duplicate unsaved workspaces", () => {
  act(() => root.unmount()); root = createRoot(host);
  act(() => root.render(<React.StrictMode><App/></React.StrictMode>));
  expect(tabs()).toHaveLength(1);
});

test("Back/Forward activates the original unsaved workspace and preserves scroll", () => {
  const a = activePanel(); change(a.querySelector("input")!, "History A");
  a.scrollTop = 420; act(() => a.dispatchEvent(new Event("scroll")));
  click("Another order"); const b = activePanel(); change(b.querySelector("input")!, "History B");
  click("Back"); expect(activePanel()).toBe(a); expect(a.scrollTop).toBe(420);
  click("Forward"); expect(activePanel()).toBe(b); expect(tabs()).toHaveLength(2);
});

test("inactive dialogs are parked and retained, and refresh warning covers dirty inactive tabs", () => {
  click("Open editor dialog", activePanel()); const input = document.querySelector<HTMLInputElement>('[aria-label="Dialog edits"]')!;
  change(input, "Dialog retained"); change(activePanel().querySelector("input")!, "Dirty A");
  // A dialog may be programmatically switched away from (e.g. history navigation).
  click("Another order"); expect(document.querySelector('[aria-label="Dialog edits"]')).toBeNull();
  const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  act(() => tabs()[0].click()); expect(document.querySelector<HTMLInputElement>('[aria-label="Dialog edits"]')!.value).toBe("Dialog retained");
  expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
});

test("keyboard arrows activate tabs; three explicit toolbar actions open independent workspaces", () => {
  click("Another quote");
  act(() => { tabs()[1].focus(); Simulate.keyDown(tabs()[1], { key: "ArrowLeft" }); });
  expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
  const toolbar = host.querySelector('[role="group"][aria-label="New workspaces"]')!;
  const buttons = Array.from(toolbar.querySelectorAll("button"));
  expect(buttons.map(button => button.textContent)).toEqual(["Order", "Quote", "Tab"]);
  act(() => buttons[0].click()); expect(activePanel().textContent).toContain("/orders/new");
  act(() => buttons[1].click()); expect(activePanel().textContent).toContain("/quotes/new");
  act(() => buttons[2].click());
  expect(activePanel().textContent).toContain("Outside editor");
  expect(activePanel().querySelector('input')).toBeNull();
  expect(tabs()).toHaveLength(5);
});

test("only supported editor routes are captured, not lists, portal routes or traveler", () => {
  for (const pathname of ["/orders", "/quotes", "/portal/orders/123", "/orders/123/traveler", "/customers/portal-access", "/customers/new"]) expect(matchWorkspaceRoute(pathname)).toBeNull();
  expect(matchWorkspaceRoute("/quotes/123/edit")?.recordKey).toBe("quote:123");
  expect(matchWorkspaceRoute("/quotes/123")?.recordKey).toBe("quote:123");
});

test("multiple clean general tabs retain independent real outlet routes, selection, query filters and scroll", () => {
  renderNavigationApp(); newAction("navigation tab");
  const first = activePanel(), firstId = first.dataset.workspaceId;
  change(first.querySelector('input')!, "Selected order A"); click("Filter list", first);
  first.scrollTop = 180; act(() => first.dispatchEvent(new Event("scroll")));
  expect(first.textContent).toContain("/orders?search=20720");
  newAction("navigation tab"); const second = activePanel();
  expect(second.dataset.workspaceId).not.toBe(firstId); expect(second.textContent).not.toContain("20720");
  expect(second.querySelector('input')!.value).toBe("");
  click("Customer"); expect(activePanel()).toBe(second);
  expect(second.querySelector('[data-testid="route"]')?.textContent).toBe("/customers/customer-1");
  act(() => tabs()[0].click());
  expect(activePanel()).toBe(first); expect(first.querySelector('input')!.value).toBe("Selected order A");
  expect(first.querySelector('[data-testid="local-route"]')?.textContent).toBe("/orders?search=20720");
  expect(first.scrollTop).toBe(180); expect(tabs()).toHaveLength(2);
  expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
});

test("general tab adopts supported editors without duplicates and reuses records already open elsewhere", () => {
  renderNavigationApp(); newAction("navigation tab"); const general = activePanel();
  act(() => general.querySelector<HTMLAnchorElement>('a[href="/orders/existing-1"]')!.click());
  expect(activePanel()).toBe(general); expect(tabs()).toHaveLength(1);
  newAction("navigation tab"); const other = activePanel(); click("Existing order");
  expect(activePanel()).toBe(general); expect(tabs()).toHaveLength(2);
  act(() => tabs()[1].click()); expect(activePanel()).toBe(other);
  expect(other.querySelector('[data-testid="local-route"]')?.textContent).toBe("/orders");
});

test("ordinary sidebar New Order retains its route and never replaces an already open new editor", () => {
  renderNavigationApp(); newAction("navigation tab"); const general = activePanel();
  click("Sidebar New Order"); expect(activePanel()).toBe(general);
  expect(tabs()[0].textContent).toContain("New Order 1");
  change(general.querySelector('input')!, "Keep sidebar-created Order");
  click("Sidebar New Order"); expect(activePanel()).not.toBe(general);
  expect(general.querySelector('input')!.value).toBe("Keep sidebar-created Order");
  expect(tabs()[1].textContent).toContain("New Order 2");
});

test("dirty editors adopted by general tabs survive sidebar navigation; clean navigation close needs no confirmation", () => {
  renderNavigationApp(); newAction("navigation tab"); click("Existing order"); const editor = activePanel();
  change(editor.querySelector('input')!, "Unsaved artwork and options");
  click("Order list"); expect(activePanel()).not.toBe(editor); expect(editor.hidden).toBe(true);
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
  close(1); expect(confirm).not.toHaveBeenCalled(); expect(activePanel()).toBe(editor);
  expect(editor.querySelector('input')!.value).toBe("Unsaved artwork and options");
  close(0); expect(confirm).toHaveBeenCalledTimes(1); expect(tabs()).toHaveLength(1);
});

test("general navigation Back/Forward keeps identity, inactive routes are pinned and late navigation cannot hijack another tab", () => {
  renderNavigationApp(); newAction("navigation tab"); const first = activePanel();
  click("Prepare inactive navigation", first); click("Filter list", first);
  click("Back"); expect(activePanel()).toBe(first); expect(first.textContent).not.toContain("20720");
  click("Forward"); expect(activePanel()).toBe(first); expect(first.textContent).toContain("20720");
  newAction("navigation tab"); const second = activePanel();
  act(() => inactiveNavigate!()); expect(activePanel()).toBe(second);
  expect(first.querySelector('[data-testid="local-route"]')?.textContent).toBe("/orders?search=20720");
  click("Back"); expect(activePanel()).toBe(first);
  click("Forward"); expect(activePanel()).toBe(second); expect(tabs()).toHaveLength(2);
});

test("general tab dialogs remain parked with retained form state while another workspace is active", () => {
  renderNavigationApp(); newAction("navigation tab"); click("Open list dialog", activePanel());
  change(document.querySelector<HTMLInputElement>('[aria-label="List dialog edits"]')!, "Keep dialog edits");
  newAction("Order"); expect(document.querySelector('[aria-label="List dialog edits"]')).toBeNull();
  act(() => tabs()[0].click());
  expect(document.querySelector<HTMLInputElement>('[aria-label="List dialog edits"]')!.value).toBe("Keep dialog edits");
});
