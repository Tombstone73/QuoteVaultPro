import React, { act, useEffect, useState, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import type { WorkspaceScope } from "./workspacePersistence";
import { ROUTES } from "@/config/routes";
import { MemoryRouter, Routes, Route, Outlet, Link, Navigate, useNavigate, useLocation, useParams, useSearchParams, type Location } from "react-router-dom";
import { WorkspaceTabsProvider, WorkspaceTabBar, WorkspacePanels } from "./WorkspaceTabs";
import { useWorkspaceTitle } from "./WorkspaceTitle";
import { useWorkspaceLocation, useWorkspaceNavigate, useWorkspaceDom, WorkspaceLabel } from "@/contexts/WorkspaceContext";
import { NavigationGuardProvider, useWorkspaceUnsavedChanges, useNavigationGuard } from "@/contexts/NavigationGuardContext";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { matchWorkspaceRoute } from "./workspaceRoutes";

type InitialLocation = string | Partial<Location>;
const scope = { userId: "staff-a", organizationId: "tenant-a" };
const reviewPath = ROUTES.admin.productIntakeReview;
let host: HTMLDivElement, root: Root, mounts = 0, currentLocation: Location;
let lateSave: (() => void) | undefined;
let saveOperation: ((value:string)=>Promise<void>) | undefined;
function Editor() {
  const location = useWorkspaceLocation(), navigate = useWorkspaceNavigate(), dom = useWorkspaceDom();
  const [value, setValue] = useState(""), [dirty, setDirty] = useState(false), [modal, setModal] = useState(false);
  const match = matchWorkspaceRoute(location.pathname)!;
  const valueRef=useRef(value);valueRef.current=value;
  useWorkspaceUnsavedChanges(dirty, "fixture",saveOperation?async()=>{await saveOperation!(value);if(valueRef.current===value)setDirty(false);}:undefined);
  useWorkspaceTitle(!match.isNew ? match.family === "purchase-order" ? "PO-" + match.params.id : `${match.family} saved ${match.params.id}` : undefined);
  useEffect(() => { mounts++; }, []);
  return <>
    <label htmlFor={dom.fieldId("value")}>Editor values</label><Input id="value" value={value} onChange={event => { setValue(event.target.value); setDirty(true); }}/>
    <output data-testid="route">{location.pathname}</output>
    <button onClick={() => { setDirty(false); navigate("/orders/saved-1", { replace: true, state: { titanWorkspaceSaved: true } }); }}>Save record</button>
    <button onClick={() => { lateSave = () => { setDirty(false); navigate("/orders/late-1", { replace: true, state: { titanWorkspaceSaved: true } }); }; }}>Prepare late save</button>
    <button onClick={() => navigate("/orders/existing-1")}>Open another saved record</button>
    {match.family === "purchase-order" && <button onClick={() => {
      setDirty(false);
      navigate("/purchase-orders/1000", { replace: true, state: { titanWorkspaceSaved: true, titanWorkspaceTitle: "PO-1000" } });
    }}>Save purchase order</button>}
    <button onClick={() => setModal(true)}>Open editor dialog</button>
    <Dialog open={modal} onOpenChange={setModal}><DialogContent><DialogTitle>Scoped dialog</DialogTitle><DialogDescription>Retained state</DialogDescription><Input aria-label="Dialog edits" defaultValue=""/></DialogContent></Dialog>
  </>;
}
function Controls() {
  const navigate = useNavigate(), location = useLocation();
  const guard=useNavigationGuard();
  currentLocation = location;
  return <>
    <button onClick={()=>guard.guardedNavigate("/quotes/new")}>Guarded sidebar Quote</button>
    <output data-testid="global-route">{location.pathname}</output>
    <button onClick={() => navigate("/orders/new", { state: { titanWorkspaceId: crypto.randomUUID() } })}>Another order</button>
    <button onClick={() => navigate("/orders/new")}>Sidebar New Order</button>
    <button onClick={() => navigate("/quotes/new")}>Another quote</button>
    <button onClick={() => navigate("/orders/existing-1")}>Existing order</button>
    <button onClick={() => navigate("/customers/customer-1")}>Customer</button>
    <button onClick={() => navigate("/orders")}>Order list</button>
    <button onClick={() => navigate(ROUTES.admin.catalogMigrationLab)}>Product Intake sessions</button>
    <button onClick={() => navigate("/admin/users")}>Settings redirect</button>
    <button onClick={() => navigate("/orders/1000")}>Similar order</button>
    <button onClick={() => navigate("/purchase-orders/new")}>New PO fixture</button>
    <button onClick={() => navigate("/purchase-orders/1000")}>PO 1000 fixture</button>
    <button onClick={() => navigate("/purchase-orders/1001")}>PO 1001 fixture</button>
    <button onClick={() => navigate(-1)}>Back</button><button onClick={() => navigate(1)}>Forward</button>
  </>;
}
function App({ scope, initial = "/orders/new", history }: { scope?: WorkspaceScope; initial?: InitialLocation; history?: InitialLocation[] } = {}) {
  return <MemoryRouter initialEntries={history ?? [initial]}><NavigationGuardProvider><WorkspaceTabsProvider scope={scope}>
  <Controls/><WorkspaceTabBar/><WorkspacePanels renderEditor={() => <Editor/>}><p>Outside editor</p></WorkspacePanels>
</WorkspaceTabsProvider></NavigationGuardProvider></MemoryRouter>; }
const allPanels = () => Array.from(host.querySelectorAll<HTMLElement>('[role="tabpanel"]'));
const activePanel = () => allPanels().find(panel => !panel.hidden)!;
const tabs = () => Array.from(host.querySelectorAll<HTMLElement>('[role="tab"]'));
const selectedTabs = () => tabs().filter(tab => tab.getAttribute("aria-selected") === "true");
function expectRouteInActiveTab(pathname: string) {
  const panel = activePanel();
  expect(selectedTabs()).toHaveLength(1);
  expect(selectedTabs()[0].getAttribute("aria-controls")).toBe(panel.id);
  expect(panel.getAttribute("aria-labelledby")).toBe(selectedTabs()[0].id);
  expect(allPanels().filter(entry => !entry.hidden)).toEqual([panel]);
  expect(currentLocation.pathname).toBe(pathname);
  return panel;
}
const click = (text: string, within: ParentNode = host) => act(() => { Array.from(within.querySelectorAll("button")).find(button => button.textContent === text)!.click(); });
const change = (input: HTMLInputElement, value: string) => act(() => { input.value = value; Simulate.change(input, { target: { value } } as never); });
const close = (index: number) => act(() => { host.querySelectorAll<HTMLButtonElement>('button[aria-label^="Close "]')[index].click(); });
const newAction = (name: string) => act(() => host.querySelector<HTMLButtonElement>(`button[aria-label="New ${name}"]`)!.click());

let inactiveNavigate: (() => void) | undefined;
function NavigationPage() {
  const location = useLocation(), navigate = useNavigate(), [params, setParams] = useSearchParams();
  const { guardedNavigate } = useNavigationGuard();
  const [selection, setSelection] = useState(""), [modal, setModal] = useState(false);
  return <>
    <output data-testid="local-route">{location.pathname}{location.search}</output>
    <WorkspaceLabel htmlFor="list-selection">List selection</WorkspaceLabel>
    <Input id="list-selection" value={selection} onChange={event => setSelection(event.target.value)}/>
    <button onClick={() => setParams({ search: "20720" })}>Filter list</button>
    <output data-testid="search">{params.get("search")}</output>
    <button onClick={() => { inactiveNavigate = () => navigate("/invoices"); }}>Prepare inactive navigation</button>
    <button onClick={() => {
      inactiveNavigate = () => guardedNavigate("/orders", { replace: true, state: { titanWorkspaceSaved: true } });
    }}>Prepare background completion</button>
    <Link to="/orders/existing-1">Open saved Order</Link><Link to="/customers/customer-1">Open saved Customer</Link>
    <button onClick={() => setModal(true)}>Open list dialog</button>
    <Dialog open={modal} onOpenChange={setModal}><DialogContent><DialogTitle>List dialog</DialogTitle><DialogDescription>Navigation workspace dialog</DialogDescription><Input aria-label="List dialog edits"/></DialogContent></Dialog>
  </>;
}
function IntakeSessions() {
  return <>
    <p data-testid="intake-sessions">Intake sessions</p>
    <Link to={reviewPath("session-a")}>Review session A</Link>
    <Link to={reviewPath("session-b")}>Review session B</Link>
  </>;
}
function IntakeReview() {
  const { sessionId } = useParams();
  const location = useLocation();
  const [notes, setNotes] = useState("");
  useWorkspaceTitle(`Product Intake · ${sessionId}`);
  useWorkspaceUnsavedChanges(Boolean(notes), "product intake fixture");
  return <>
    <output data-testid="intake-review">{sessionId}</output>
    <output data-testid="review-location">{location.pathname}{location.search}{location.hash}</output>
    <output data-testid="review-origin">{location.state?.origin}</output>
    <input aria-label="Review notes" value={notes} onChange={event => setNotes(event.target.value)} />
  </>;
}
function RoutedHost({ scope }: { scope?: WorkspaceScope }) {
  return <WorkspaceTabsProvider scope={scope}><Controls/><WorkspaceTabBar/><WorkspacePanels renderEditor={() => <Editor/>}><Outlet/></WorkspacePanels></WorkspaceTabsProvider>;
}
function renderNavigationApp(initial: InitialLocation = "/orders", storageScope?: WorkspaceScope) {
  act(() => root.unmount()); root = createRoot(host);
  act(() => root.render(<MemoryRouter initialEntries={[initial]}><NavigationGuardProvider><Routes><Route element={<RoutedHost scope={storageScope}/>}>
    <Route path="/orders" element={<NavigationPage/>}/><Route path="/invoices" element={<NavigationPage/>}/>
    <Route path="/admin/users" element={<Navigate to="/invoices" replace/>}/>
    <Route path="/orders/:id" element={<Editor/>}/><Route path="/quotes/:id" element={<Editor/>}/><Route path="/customers/:id" element={<Editor/>}/>
    <Route path={ROUTES.admin.catalogMigrationLab} element={<IntakeSessions/>}/>
    <Route path={reviewPath(":sessionId")} element={<IntakeReview/>}/>
  </Route></Routes></NavigationGuardProvider></MemoryRouter>));
}
function startIndependentNavigationTab() {
  renderNavigationApp();
  const automatic = activePanel();
  newAction("navigation tab");
  expect(activePanel()).not.toBe(automatic);
  close(0);
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let nextId = 0; Object.defineProperty(crypto, "randomUUID", { configurable: true, value: () => `id-${++nextId}` });
  Element.prototype.scrollIntoView = jest.fn();
  Element.prototype.scrollTo = function(options?: ScrollToOptions | number, y?: number) { this.scrollTop = typeof options === "number" ? y ?? 0 : options?.top ?? 0; };
  window.scrollTo = jest.fn();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); mounts = 0; lateSave = undefined; saveOperation=undefined;
  localStorage.clear(); sessionStorage.clear();
  act(() => root.render(<App/>));
});
afterEach(() => { act(() => root.unmount()); host.remove(); jest.restoreAllMocks(); });

test("PO save promotes its existing tab and retained POs and Orders have separate identities", () => {
  click("Similar order");
  const order = activePanel();
  change(order.querySelector("input")!, "Independent Order");
  click("New PO fixture");
  const draft = activePanel();
  const draftTab = tabs().find(tab => tab.getAttribute("aria-selected") === "true")!;
  expect(draftTab.textContent).toBe("New Purchase Order");
  change(draft.querySelector("input")!, "Real estate frames");
  expect(draftTab.getAttribute("title")).toContain("unsaved changes");
  click("Save purchase order", draft);
  expect(activePanel()).toBe(draft);
  expect(draftTab.textContent).toBe("PO-1000");
  expect(draftTab.getAttribute("title")).toBe("PO-1000");
  click("PO 1001 fixture");
  const second = activePanel();
  change(second.querySelector("input")!, "Delivery");
  click("PO 1000 fixture");
  expect(activePanel()).toBe(draft);
  expect(draft.querySelector("input")!.value).toBe("Real estate frames");
  const selected = tabs().filter(tab => tab.getAttribute("aria-selected") === "true");
  expect(selected).toEqual([draftTab]);
  expect(new Set(tabs().map(tab => tab.id)).size).toBe(4);
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Close PO-1000"]')!.click());
  expect(tabs().some(tab => tab.getAttribute("title")?.startsWith("order saved 1000"))).toBe(true);
  expect(order.querySelector("input")!.value).toBe("Independent Order");
  expect(second.querySelector("input")!.value).toBe("Delivery");
});

test("saved PO tab titles and independent identities restore from persisted routes", () => {
  const scope = { userId: "po-user", organizationId: "po-org" };
  act(() => root.unmount()); root = createRoot(host);
  act(() => root.render(<App scope={scope} initial="/purchase-orders/1000" />));
  click("PO 1001 fixture"); click("Similar order");
  const identities = tabs().map(tab => tab.id);
  act(() => root.unmount()); root = createRoot(host);
  act(() => root.render(<App scope={scope} initial="/orders/1000" />));
  expect(tabs().map(tab => tab.textContent)).toEqual(["PO-1000", "PO-1001", "order saved 1000"]);
  expect(tabs().map(tab => tab.id)).toEqual(identities);
  expect(tabs()[2].getAttribute("aria-selected")).toBe("true");
});

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
  click("Order list");
  const orders = expectRouteInActiveTab("/orders");
  expect(orders.textContent).toContain("Outside editor");
  expect(existing.hidden).toBe(true);
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

test("clean close is immediate and closing the final tab opens a real landing tab", () => {
  const confirm = jest.spyOn(window, "confirm");
  close(0);
  expect(confirm).not.toHaveBeenCalled();
  expect(expectRouteInActiveTab("/orders").textContent).toBe("Outside editor");
  expect(tabs()).toHaveLength(1);
  close(0);
  expect(expectRouteInActiveTab("/orders").textContent).toBe("Outside editor");
  expect(tabs()).toHaveLength(1);
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

test("Back/Forward after refresh restores earlier identical new Order URLs to their own tabs", () => {
  remountScoped(scope, "/orders/new");
  const firstId = activePanel().dataset.workspaceId;
  const firstLocation = currentLocation;
  click("Sidebar New Order");
  const secondId = activePanel().dataset.workspaceId;
  const secondLocation = currentLocation;
  newAction("Order");
  const thirdId = activePanel().dataset.workspaceId;
  const thirdLocation = currentLocation;
  expect(new Set([firstId, secondId, thirdId]).size).toBe(3);

  act(() => root.unmount()); root = createRoot(host);
  act(() => root.render(<App scope={scope} history={[firstLocation, secondLocation, thirdLocation]}/>));
  expect(expectRouteInActiveTab("/orders/new").dataset.workspaceId).toBe(thirdId);
  click("Back");
  expect(expectRouteInActiveTab("/orders/new").dataset.workspaceId).toBe(secondId);
  click("Back");
  expect(expectRouteInActiveTab("/orders/new").dataset.workspaceId).toBe(firstId);
  click("Forward");
  expect(expectRouteInActiveTab("/orders/new").dataset.workspaceId).toBe(secondId);
  expect(tabs()).toHaveLength(3);
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

test("only retained editor routes use specialized record matching", () => {
  for (const pathname of ["/orders", "/quotes", "/portal/orders/123", "/orders/123/traveler", "/customers/portal-access", "/Customers/Portal-Access/", "/customers/new"]) expect(matchWorkspaceRoute(pathname)).toBeNull();
  expect(matchWorkspaceRoute("/quotes/123/edit")?.recordKey).toBe("quote:123");
  expect(matchWorkspaceRoute("/quotes/123")?.recordKey).toBe("quote:123");
});

test("Product Intake reviews open real, distinct tabs and reopening a review retains its edits", () => {
  renderNavigationApp(ROUTES.admin.catalogMigrationLab);
  const sessions = expectRouteInActiveTab(ROUTES.admin.catalogMigrationLab);
  expect(sessions.querySelector('[data-testid="intake-sessions"]')).not.toBeNull();
  const sessionsTab = selectedTabs()[0];

  const firstPath = reviewPath("session-a");
  act(() => sessions.querySelector<HTMLAnchorElement>('a')!.click());
  const first = expectRouteInActiveTab(firstPath);
  expect(first.querySelector('[data-testid="intake-review"]')?.textContent).toBe("session-a");
  const firstTab = selectedTabs()[0];
  expect(firstTab.textContent).toContain("Product Intake · session-a");
  change(first.querySelector("input")!, "Keep the first review notes");
  expect(firstTab.querySelector('[aria-label="Unsaved changes"]')).not.toBeNull();

  act(() => sessionsTab.click());
  const secondPath = reviewPath("session-b");
  act(() => sessions.querySelectorAll<HTMLAnchorElement>('a')[1].click());
  const second = expectRouteInActiveTab(secondPath);
  expect(second.querySelector('[data-testid="intake-review"]')?.textContent).toBe("session-b");
  expect(second.querySelector("input")?.value).toBe("");
  expect(second).not.toBe(first);

  act(() => sessionsTab.click());
  act(() => sessions.querySelector<HTMLAnchorElement>('a')!.click());
  expect(expectRouteInActiveTab(firstPath)).toBe(first);
  expect(selectedTabs()).toEqual([firstTab]);
  expect(firstTab.textContent).toContain("Product Intake · session-a");
  expect(first.querySelector("input")?.value).toBe("Keep the first review notes");
  expect(tabs()).toHaveLength(3);
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
  act(() => first.querySelector("input")!.focus());
  close(tabs().indexOf(firstTab));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(expectRouteInActiveTab(firstPath)).toBe(first);
});

test("refresh and browser Back/Forward preserve a directly opened ordinary workspace URL", () => {
  const pathname = reviewPath("session-a");
  const directUrl = { pathname, search: "?view=errors", hash: "#unmapped", state: { origin: "intake-bookmark" } };
  renderNavigationApp(directUrl, scope);
  const first = expectRouteInActiveTab(pathname);
  const firstId = first.dataset.workspaceId;
  const expectReviewLocation = (panel: HTMLElement) => {
    expect(panel.querySelector('[data-testid="review-location"]')?.textContent).toBe(pathname + directUrl.search + directUrl.hash);
    expect(panel.querySelector('[data-testid="review-origin"]')?.textContent).toBe("intake-bookmark");
  };
  expectReviewLocation(first);
  click("Order list");
  const orders = expectRouteInActiveTab("/orders");
  expect(orders.querySelector('[data-testid="local-route"]')?.textContent).toBe("/orders");
  click("Back");
  expectReviewLocation(expectRouteInActiveTab(pathname));
  click("Forward");
  expect(expectRouteInActiveTab("/orders")).toBe(orders);
  click("Back");
  const beforeRefresh = currentLocation;
  renderNavigationApp(beforeRefresh, scope);
  const restored = expectRouteInActiveTab(pathname);
  expect(restored.dataset.workspaceId).toBe(firstId);
  expectReviewLocation(restored);
  expect(tabs()).toHaveLength(2);
  expect(localStorage.getItem("titanos.workspaces.v1:staff-a:tenant-a")).not.toMatch(/intake-bookmark|view=errors|unmapped/);
});

test("a fresh direct landing URL wins over an unrelated active persisted tab", () => {
  renderNavigationApp(reviewPath("session-a"), scope);
  expectRouteInActiveTab(reviewPath("session-a"));
  renderNavigationApp("/orders?search=1234", scope);
  const orders = expectRouteInActiveTab("/orders");
  expect(orders.querySelector('[data-testid="local-route"]')?.textContent).toBe("/orders?search=1234");
  click("Filter list", orders);
  expect(expectRouteInActiveTab("/orders")).toBe(orders);
  expect(orders.querySelector('[data-testid="local-route"]')?.textContent).toBe("/orders?search=20720");
  expect(tabs()).toHaveLength(2);
});

test("redirects resolve to the existing destination tab without leaving an empty alias tab", () => {
  renderNavigationApp("/admin/users");
  const invoices = expectRouteInActiveTab("/invoices");
  expect(invoices.querySelector('[data-testid="local-route"]')?.textContent).toBe("/invoices");
  expect(tabs()).toHaveLength(1);
  click("Order list");
  expectRouteInActiveTab("/orders");
  click("Settings redirect");
  expect(expectRouteInActiveTab("/invoices")).toBe(invoices);
  expect(tabs()).toHaveLength(2);
});

test("multiple clean general tabs retain independent real outlet routes, selection, query filters and scroll", () => {
  startIndependentNavigationTab();
  const first = activePanel(), firstId = first.dataset.workspaceId;
  change(first.querySelector('input')!, "Selected order A"); click("Filter list", first);
  first.scrollTop = 180; act(() => first.dispatchEvent(new Event("scroll")));
  expect(first.textContent).toContain("/orders?search=20720");
  newAction("navigation tab"); const second = activePanel();
  expect(second.dataset.workspaceId).not.toBe(firstId); expect(second.textContent).not.toContain("20720");
  expect(second.querySelector('input')!.value).toBe("");
  expect(first.querySelector("label")?.control).toBe(first.querySelector("input"));
  expect(second.querySelector("label")?.control).toBe(second.querySelector("input"));
  expect(first.querySelector("input")?.id).not.toBe(second.querySelector("input")?.id);
  click("Customer"); expect(activePanel()).toBe(second);
  expect(second.querySelector('[data-testid="route"]')?.textContent).toBe("/customers/customer-1");
  act(() => tabs()[0].click());
  expect(activePanel()).toBe(first); expect(first.querySelector('input')!.value).toBe("Selected order A");
  expect(first.querySelector('[data-testid="local-route"]')?.textContent).toBe("/orders?search=20720");
  expect(first.scrollTop).toBe(180); expect(tabs()).toHaveLength(2);
  expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
});

test("general tab adopts supported editors without duplicates and reuses records already open elsewhere", () => {
  startIndependentNavigationTab(); const general = activePanel();
  act(() => general.querySelector<HTMLAnchorElement>('a[href="/orders/existing-1"]')!.click());
  expect(activePanel()).toBe(general); expect(tabs()).toHaveLength(1);
  newAction("navigation tab"); const other = activePanel(); click("Existing order");
  expect(activePanel()).toBe(general); expect(tabs()).toHaveLength(2);
  act(() => tabs()[1].click()); expect(activePanel()).toBe(other);
  expect(other.querySelector('[data-testid="local-route"]')?.textContent).toBe("/orders");
});

test("ordinary sidebar New Order retains its route and never replaces an already open new editor", () => {
  startIndependentNavigationTab(); const general = activePanel();
  click("Sidebar New Order"); expect(activePanel()).toBe(general);
  expect(tabs()[0].textContent).toContain("New Order 1");
  change(general.querySelector('input')!, "Keep sidebar-created Order");
  click("Sidebar New Order"); expect(activePanel()).not.toBe(general);
  expect(general.querySelector('input')!.value).toBe("Keep sidebar-created Order");
  expect(tabs()[1].textContent).toContain("New Order 2");
});

test("dirty editors adopted by general tabs survive sidebar navigation; clean navigation close needs no confirmation", () => {
  startIndependentNavigationTab(); click("Existing order"); const editor = activePanel();
  change(editor.querySelector('input')!, "Unsaved artwork and options");
  click("Order list"); expect(activePanel()).not.toBe(editor); expect(editor.hidden).toBe(true);
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
  close(1); expect(confirm).not.toHaveBeenCalled(); expect(activePanel()).toBe(editor);
  expect(editor.querySelector('input')!.value).toBe("Unsaved artwork and options");
  close(0); expect(confirm).toHaveBeenCalledTimes(1); expect(tabs()).toHaveLength(1);
});

test("general navigation Back/Forward keeps identity, inactive routes are pinned and late navigation cannot hijack another tab", () => {
  startIndependentNavigationTab(); const first = activePanel();
  click("Prepare inactive navigation", first); click("Filter list", first);
  click("Back"); expect(activePanel()).toBe(first); expect(first.textContent).not.toContain("20720");
  click("Forward"); expect(activePanel()).toBe(first); expect(first.textContent).toContain("20720");
  newAction("navigation tab"); const second = activePanel();
  act(() => inactiveNavigate!()); expect(activePanel()).toBe(second);
  expect(first.querySelector('[data-testid="local-route"]')?.textContent).toBe("/orders?search=20720");
  click("Back"); expect(activePanel()).toBe(first);
  click("Forward"); expect(activePanel()).toBe(second); expect(tabs()).toHaveLength(2);
});

test("late ordinary save completion retires its owner without changing the active workspace", () => {
  renderNavigationApp("/invoices");
  const completed = expectRouteInActiveTab("/invoices");
  click("Prepare background completion", completed);
  newAction("Order");
  const current = expectRouteInActiveTab("/orders/new");
  change(current.querySelector("input")!, "Keep the active Order draft");
  act(() => inactiveNavigate!());
  expect(expectRouteInActiveTab("/orders/new")).toBe(current);
  expect(current.querySelector("input")?.value).toBe("Keep the active Order draft");
  expect(completed.isConnected).toBe(false);
  expect(tabs()).toHaveLength(1);
});

test("general tab dialogs remain parked with retained form state while another workspace is active", () => {
  startIndependentNavigationTab(); click("Open list dialog", activePanel());
  change(document.querySelector<HTMLInputElement>('[aria-label="List dialog edits"]')!, "Keep dialog edits");
  newAction("Order"); expect(document.querySelector('[aria-label="List dialog edits"]')).toBeNull();
  act(() => tabs()[0].click());
  expect(document.querySelector<HTMLInputElement>('[aria-label="List dialog edits"]')!.value).toBe("Keep dialog edits");
});

function remountScoped(next = scope, initial: InitialLocation = "/orders") {
  act(() => root.unmount()); root = createRoot(host);
  act(() => root.render(<App scope={next} initial={initial}/>));
}

test("refresh restores route identity, ordering and active tab but never unsaved business values", () => {
  remountScoped();
  newAction("Order");
  change(activePanel().querySelector("input")!, "Never persist this Order");
  const orderId = activePanel().dataset.workspaceId;
  newAction("Quote");
  change(activePanel().querySelector("input")!, "Never persist this Quote");
  const quoteId = activePanel().dataset.workspaceId;
  const ids = allPanels().map(panel => panel.dataset.workspaceId);
  expect(localStorage.getItem("titanos.workspaces.v1:staff-a:tenant-a")).not.toMatch(/Never persist/);
  remountScoped(scope, currentLocation);
  expect(allPanels().map(panel => panel.dataset.workspaceId)).toEqual(ids);
  expect(expectRouteInActiveTab("/quotes/new").dataset.workspaceId).toBe(quoteId);
  expect(activePanel().querySelector("input")!.value).toBe("");
  expect(tabs().some(tab => tab.querySelector('[aria-label="Unsaved changes"]'))).toBe(false);
  remountScoped(scope, "/quotes/new?source=restart");
  expect(expectRouteInActiveTab("/quotes/new").dataset.workspaceId).toBe(quoteId);
  expect(currentLocation.search).toBe("?source=restart");
  expect(tabs()).toHaveLength(ids.length);
  act(() => tabs().find(tab => tab.id === `tab-${orderId}`)!.click());
  expect(activePanel().dataset.workspaceId).toBe(orderId);
  expect(activePanel().querySelector("input")!.value).toBe("");
});

test("intentional close persists and user and organization scopes never restore each other", () => {
  remountScoped();
  newAction("Order");
  const orderId = activePanel().dataset.workspaceId;
  newAction("Quote");
  const quoteLocation = currentLocation;
  close(1);
  expect(tabs()).toHaveLength(2);
  remountScoped(scope, quoteLocation);
  expect(tabs()).toHaveLength(2);
  expect(allPanels().map(panel => panel.dataset.workspaceId)).not.toContain(orderId);
  remountScoped({ ...scope, userId: "staff-b" });
  expect(tabs()).toHaveLength(1);
  expectRouteInActiveTab("/orders");
  remountScoped({ ...scope, organizationId: "tenant-b" });
  expect(tabs()).toHaveLength(1);
  expectRouteInActiveTab("/orders");
  remountScoped(scope, quoteLocation);
  expect(tabs()).toHaveLength(2);
  expectRouteInActiveTab("/quotes/new");
});

test("corrupt or old workspace storage falls back to a real tab without a hydration loop", () => {
  localStorage.setItem("titanos.workspaces.v1:staff-a:tenant-a", '{"version":0,"tabs":"bad"}');
  remountScoped();
  expect(tabs()).toHaveLength(1);
  const landingId = expectRouteInActiveTab("/orders").dataset.workspaceId;
  remountScoped(scope, currentLocation);
  expect(tabs()).toHaveLength(1);
  expect(expectRouteInActiveTab("/orders").dataset.workspaceId).toBe(landingId);
});
test('guarded sidebar navigation retains a dirty editor without asking to discard it',()=>{
  const confirm=jest.spyOn(window,'confirm').mockReturnValue(false);const original=activePanel();change(original.querySelector('input')!,'Keep unsaved work');
  click('Guarded sidebar Quote');expect(confirm).not.toHaveBeenCalled();expect(tabs()).toHaveLength(2);
  act(()=>tabs()[0].click());expect(activePanel()).toBe(original);expect(original.querySelector('input')!.value).toBe('Keep unsaved work');
  close(0);expect(confirm).toHaveBeenCalledTimes(1);expect(tabs()).toHaveLength(2);
});

test('Save and Continue waits for success, retains failed saves, and protects edits made while saving',async()=>{
  let finish:((value?:void)=>void)|undefined,reject:((error:Error)=>void)|undefined;
  saveOperation=()=>new Promise<void>((resolve,fail)=>{finish=resolve;reject=fail;});act(()=>root.render(<App/>));
  const editor=activePanel();change(editor.querySelector('input')!,'First edit');close(0);
  expect(document.body.textContent).toContain('Save and Continue');
  const action=()=>Array.from(document.body.querySelectorAll('button')).find(button=>button.textContent==='Save and Continue')!;
  await act(async()=>{action().click();});expect(tabs()).toHaveLength(1);
  await act(async()=>{reject!(new Error('Save rejected; edits retained'));});expect(document.body.textContent).toContain('Save rejected');expect(editor.querySelector('input')!.value).toBe('First edit');
  await act(async()=>{action().click();});change(editor.querySelector('input')!,'Newer edit');
  await act(async()=>{finish!();});expect(document.body.textContent).toContain('Newer unsaved edits remain');expect(tabs()).toHaveLength(1);
  await act(async()=>{action().click();});await act(async()=>{finish!();});
  expect(tabs()).toHaveLength(1);
  expect(expectRouteInActiveTab("/orders").textContent).toBe("Outside editor");
});
