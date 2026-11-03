import React, { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { TextEncoder, TextDecoder } from "node:util";
Object.assign(globalThis, { TextEncoder, TextDecoder });
const { MemoryRouter, useNavigate, useLocation } = await import("react-router-dom");
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

test("keyboard arrows activate tabs; new menu offers canonical Order and Quote entry", () => {
  click("Another quote");
  act(() => { tabs()[1].focus(); Simulate.keyDown(tabs()[1], { key: "ArrowLeft" }); });
  expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
  const trigger = host.querySelector<HTMLButtonElement>('[aria-label="New workspace"]')!;
  act(() => Simulate.keyDown(trigger, { key: "Enter" }));
  expect(document.body.textContent).toContain("New Order"); expect(document.body.textContent).toContain("New Quote");
});

test("only supported editor routes are captured, not lists, portal routes or traveler", () => {
  for (const pathname of ["/orders", "/quotes", "/portal/orders/123", "/orders/123/traveler", "/customers/portal-access", "/customers/new"]) expect(matchWorkspaceRoute(pathname)).toBeNull();
  expect(matchWorkspaceRoute("/quotes/123/edit")?.recordKey).toBe("quote:123");
  expect(matchWorkspaceRoute("/quotes/123")?.recordKey).toBe("quote:123");
});
