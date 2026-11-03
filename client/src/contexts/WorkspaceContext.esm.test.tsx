import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { TextEncoder, TextDecoder } from "node:util";
Object.assign(globalThis, { TextEncoder, TextDecoder });
const { MemoryRouter, useLocation, useNavigate } = await import("react-router-dom");
import type { WorkspaceNavigation, WorkspaceRoute } from "./WorkspaceContext";
const { WorkspaceBoundary, SingleEditorWorkspace, useWorkspaceDom, useWorkspaceLocation, useWorkspaceNavigate, useWorkspaceParams, useWorkspaceSearchParams, WorkspaceLink } = await import("./WorkspaceContext");
const { NavigationGuardProvider, useNavigationGuard, useWorkspaceUnsavedChanges } = await import("./NavigationGuardContext");
const { Input } = await import("@/components/ui/input");
const { Label } = await import("@/components/ui/label");
const { Dialog, DialogContent, DialogTitle, DialogDescription } = await import("@/components/ui/dialog");
const { Popover, PopoverContent } = await import("@/components/ui/popover");
const { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } = await import("@/components/ui/select");
jest.unstable_mockModule("@/lib/queryClient", () => ({ apiFetch: jest.fn() }));
const { OrderPoField, OrderPriorityField } = await import("@/features/quotes/editor/components/OrderDetailsFields");
import { clearPendingScrollPosition, getPendingScrollPosition, setPendingScrollPosition } from "@/lib/ui/persistScrollPosition";
import { clearPendingExpandedLineItemId, getPendingExpandedLineItemId, setPendingExpandedLineItemId } from "@/lib/ui/persistExpandedLineItem";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  window.scrollTo = jest.fn();
  Element.prototype.scrollIntoView = jest.fn();
  Element.prototype.scrollTo = function(options?: ScrollToOptions | number, y?: number) { this.scrollTop = typeof options === "number" ? y ?? 0 : options?.top ?? 0; };
  sessionStorage.clear(); localStorage.clear();
});
afterEach(() => { act(() => root.unmount()); host.remove(); jest.restoreAllMocks(); });
const route = (id: string): WorkspaceRoute => ({ location: { pathname: `/orders/${id}`, search: `?line=${id}`, hash: "", state: null, key: id }, params: { id } });
function ModalForm() { const [value, setValue] = useState(""); return <Input aria-label="Modal note" value={value} onChange={e => setValue(e.target.value)} />; }
function Editor({ modal = false, popover = false, select = false }: { modal?: boolean; popover?: boolean; select?: boolean }) {
  const [po, setPo] = useState(""), [priority, setPriority] = useState("normal");
  const dom = useWorkspaceDom(), location = useWorkspaceLocation(), params = useWorkspaceParams(), navigate = useWorkspaceNavigate();
  const [search, setSearch] = useWorkspaceSearchParams();
  useWorkspaceUnsavedChanges(!!po, "test editor");
  const guard = useNavigationGuard();
  return <>
    <OrderPoField id="po" value={po} onChange={setPo}/>
    <OrderPriorityField id="priority" value={priority} onChange={setPriority}/>
    <Label htmlFor="note">Note</Label><Input id="note" defaultValue=""/>
    <output>{`${location.pathname}|${params.id}|${search.get("line")}`}</output>
    <button onClick={() => dom.getElementById("po")?.focus()}>Focus PO</button>
    <button onClick={() => navigate("/quotes/new")}>Navigate</button>
    <button onClick={() => setSearch({ line: ["new", "second"] })}>Search</button>
    <button onClick={() => guard.guardedNavigate("/orders")}>Guarded</button>
    <WorkspaceLink to="../next">Relative</WorkspaceLink>
    <Dialog open={modal}><DialogContent><DialogTitle>Editor dialog</DialogTitle><DialogDescription>Workspace form</DialogDescription><ModalForm/></DialogContent></Dialog>
    <Popover open={popover}><PopoverContent><Input aria-label="Popover note" defaultValue=""/></PopoverContent></Popover>
    <Select open={select}><SelectTrigger aria-label="Choose"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="one">One</SelectItem></SelectContent></Select>
  </>;
}
function pair(activeA = true, options: { modal?: boolean; popover?: boolean; select?: boolean } = {}, navigateA: WorkspaceNavigation = jest.fn<WorkspaceNavigation>(), navigateB: WorkspaceNavigation = jest.fn<WorkspaceNavigation>()) {
  return <MemoryRouter><NavigationGuardProvider>
    <WorkspaceBoundary workspaceId="a" active={activeA} route={route("a")} onNavigate={navigateA}><Editor {...options}/></WorkspaceBoundary>
    <WorkspaceBoundary workspaceId="b" active={!activeA} route={route("b")} onNavigate={navigateB}><Editor/></WorkspaceBoundary>
  </NavigationGuardProvider></MemoryRouter>;
}
function scope(id: string) { return host.querySelector<HTMLDivElement>(`[data-workspace-id="${id}"]`)!; }
function change(input: HTMLInputElement, value: string) { act(() => { input.value = value; Simulate.change(input, { target: { value } } as never); }); }
function click(parent: Element, text: string) { act(() => { Array.from(parent.querySelectorAll("button")).find(node => node.textContent === text)!.click(); }); }

test("two editors retain independent values, IDs, label targets, and scoped focus", () => {
  act(() => root.render(pair()));
  const a = scope("a"), b = scope("b");
  expect(a.querySelector("label")?.htmlFor).toBe("ws-a--po");
  expect(b.querySelector("label")?.htmlFor).toBe("ws-b--po");
  expect(a.querySelector('select')?.id).toBe("ws-a--priority");
  change(a.querySelector("input")!, "A edits"); click(a, "Focus PO");
  expect(document.activeElement).toBe(a.querySelector("input"));
  act(() => root.render(pair(false)));
  change(b.querySelector("input")!, "B edits"); click(b, "Focus PO"); click(a, "Focus PO");
  expect(document.activeElement).toBe(b.querySelector("input"));
  expect(a.querySelector("input")!.value).toBe("A edits");
  expect(b.querySelector("input")!.value).toBe("B edits");
  expect(a.hidden).toBe(true); expect(a.inert).toBe(true);
  act(() => root.render(pair()));
  expect(a.querySelector("input")!.value).toBe("A edits");
  expect(localStorage.length).toBe(0);
});

test("local routing, params, search, and links use their owning route instead of the browser route", () => {
  const aNav = jest.fn<WorkspaceNavigation>(), bNav = jest.fn<WorkspaceNavigation>();
  act(() => root.render(pair(true, {}, aNav, bNav)));
  expect(scope("a").querySelector("output")?.textContent).toBe("/orders/a|a|a");
  expect(scope("b").querySelector("output")?.textContent).toBe("/orders/b|b|b");
  click(scope("a"), "Navigate"); click(scope("b"), "Navigate");
  expect(aNav).toHaveBeenCalledWith("/quotes/new", undefined); expect(bNav).toHaveBeenCalledWith("/quotes/new", undefined); // Late callbacks remain local even while inactive.
  click(scope("a"), "Search"); expect(aNav).toHaveBeenLastCalledWith({ pathname: "/orders/a", search: "?line=new&line=second", hash: "" }, undefined);
  expect(scope("a").querySelector("a")?.getAttribute("href")).toBe("/orders/next");
});

test("dirty guards isolate navigation and retain refresh protection for inactive unsaved editors", () => {
  const aNav = jest.fn<WorkspaceNavigation>(), bNav = jest.fn<WorkspaceNavigation>(), confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
  act(() => root.render(pair(true, {}, aNav, bNav))); change(scope("a").querySelector("input")!, "unsaved");
  click(scope("a"), "Guarded"); expect(confirm).toHaveBeenCalledTimes(1); expect(aNav).not.toHaveBeenCalled();
  act(() => root.render(pair(false, {}, aNav, bNav))); click(scope("b"), "Guarded");
  expect(bNav).toHaveBeenCalledWith("/orders", undefined); expect(confirm).toHaveBeenCalledTimes(1);
  const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
});

test("inactive dialogs detach interaction, release body locks, and retain mounted form state", async () => {
  await act(async () => root.render(pair(true, { modal: true })));
  const input = document.querySelector<HTMLInputElement>('[aria-label="Modal note"]')!;
  change(input, "retain this dialog edit"); expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => root.render(pair(false, { modal: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(input.isConnected).toBe(false);
  expect(document.body.style.pointerEvents).not.toBe("none");
  click(scope("b"), "Focus PO"); expect(document.activeElement).toBe(scope("b").querySelector("input"));
  await act(async () => root.render(pair(true, { modal: true })));
  expect(document.querySelector<HTMLInputElement>('[aria-label="Modal note"]')?.value).toBe("retain this dialog edit");
  expect(document.querySelector('[role="dialog"]')?.closest('[data-workspace-id]')?.getAttribute("data-workspace-id")).toBe("a");
});

test("inactive popovers and select menus cannot remain interactive", async () => {
  await act(async () => root.render(pair(true, { popover: true })));
  const note = document.querySelector<HTMLInputElement>('[aria-label="Popover note"]')!; change(note, "kept popover");
  await act(async () => root.render(pair(false, { popover: true })));
  expect(note.isConnected).toBe(false);
  await act(async () => root.render(pair(true, { popover: true })));
  expect(document.querySelector<HTMLInputElement>('[aria-label="Popover note"]')?.value).toBe("kept popover");
  await act(async () => root.render(pair(true, { select: true })));
  expect(document.querySelector('[role="listbox"]')).not.toBeNull();
  await act(async () => root.render(pair(false, { select: true })));
  expect(document.querySelector('[role="listbox"]')).toBeNull(); expect(document.body.style.pointerEvents).not.toBe("none");
});

test("scroll and pending expansion state are workspace-specific and do not contain draft data", () => {
  function Scrollers({ active }: { active: boolean }) { return <><WorkspaceBoundary workspaceId="a" active={active} scrollMode="contained" style={{ height: 100 }}><div style={{height:1000}}>A</div></WorkspaceBoundary><WorkspaceBoundary workspaceId="b" active={!active} scrollMode="contained" style={{height:100}}><div style={{height:1000}}>B</div></WorkspaceBoundary></>; }
  act(() => root.render(<Scrollers active/>)); const a=scope("a"), b=scope("b");
  a.scrollTop=234; a.dispatchEvent(new Event("scroll"));
  act(() => root.render(<Scrollers active={false}/>)); b.scrollTop=456; b.dispatchEvent(new Event("scroll"));
  act(() => root.render(<Scrollers active/>)); expect(a.scrollTop).toBe(234);
  setPendingScrollPosition(123,"a"); setPendingScrollPosition(789,"b"); clearPendingScrollPosition("a");
  expect(getPendingScrollPosition("a")).toBeNull(); expect(getPendingScrollPosition("b")).toBe(789);
  setPendingExpandedLineItemId("line-a",0,"a"); setPendingExpandedLineItemId("line-b",2,"b"); clearPendingExpandedLineItemId("a");
  expect(getPendingExpandedLineItemId("a")).toEqual({key:null,index:null}); expect(getPendingExpandedLineItemId("b")).toEqual({key:"line-b",index:2});
});

test("normal routes retain unprefixed fields and browser Back/Forward semantics", () => {
  function Normal() { const location=useLocation(), navigate=useNavigate(); return <><output>{location.pathname}</output><button onClick={()=>navigate('/orders/new')}>Browser forward</button><button onClick={()=>navigate(-1)}>Browser back</button><SingleEditorWorkspace><OrderPoField id="legacy-po" value="existing" onChange={()=>{}}/></SingleEditorWorkspace></>; }
  act(() => root.render(<MemoryRouter initialEntries={['/quotes/new']}><Normal/></MemoryRouter>));
  expect(host.querySelector('input')?.id).toBe('legacy-po'); click(host,'Browser forward'); expect(host.querySelector('output')?.textContent).toBe('/orders/new');
  click(host,'Browser back'); expect(host.querySelector('output')?.textContent).toBe('/quotes/new');
});
