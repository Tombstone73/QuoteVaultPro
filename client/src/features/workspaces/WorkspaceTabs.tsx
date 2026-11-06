import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPath, resolvePath, useLocation, useNavigate, useNavigationType, useOutlet, UNSAFE_LocationContext, UNSAFE_NavigationContext, type Location, type NavigateOptions, type To } from "react-router-dom";
import { Plus, X, FileText, ShoppingCart, Building2, PanelTop } from "lucide-react";
import { WorkspaceBoundary, type WorkspaceRoute } from "@/contexts/WorkspaceContext";
import { NavigationGuardContext } from "@/contexts/navigationGuardRegistration";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WorkspaceTitleContext } from "./WorkspaceTitle";
import { matchWorkspaceRoute, type WorkspaceMatch } from "./workspaceRoutes";
import { readWorkspace, writeWorkspace, type WorkspaceScope } from './workspacePersistence';

const HISTORY_KEY = "titanWorkspaceId";
const GENERAL_KEY = "titanWorkspaceGeneral";
type Entry = { id: string; match: WorkspaceMatch | null; general: boolean; route: WorkspaceRoute; navigationType: ReturnType<typeof useNavigationType>; title: string; outlet: React.ReactNode };
type TabsContextValue = {
  entries: Entry[]; activeId: string | null;
  activate: (entry: Entry) => void; close: (entry: Entry) => void;
  openNew: (family: "order" | "quote" | "navigation") => void;
  navigateOwner: (id: string, to: To | number, options?: NavigateOptions) => void;
};
const TabsContext = createContext<TabsContextValue | null>(null);
const historyState = (state: unknown, id: string) => ({ ...(state && typeof state === "object" ? state : {}), [HISTORY_KEY]: id });
const historyId = (location: Location): string | undefined => location.state?.[HISTORY_KEY];
const pathOf = (location: Location) => createPath(location);
const noSubscription = () => () => {};
const recordTitle = (match: WorkspaceMatch) => `${match.family === "customer" ? "Customer" : match.family === "order" ? "Order" : "Quote"} ${match.params.id?.slice(0, 8)}`;
const navigationTitle = (pathname: string) => pathname.split("/").filter(Boolean).map(part => part.replace(/-/g, " ").replace(/^./, letter => letter.toUpperCase())).join(" · ") || "Workspace";
const sameEditor = (before: WorkspaceMatch | null, after: WorkspaceMatch | null) => Boolean(before && after && before.family === after.family && (before.recordKey ? before.recordKey === after.recordKey : after.isNew));

/** Editors remain in memory; only user/tenant-scoped route identities survive refresh. */
export function WorkspaceTabsProvider({ children, scope }: { children: React.ReactNode; scope?: WorkspaceScope }) {
  const location = useLocation(), navigate = useNavigate();
  const navigationType = useNavigationType(), outlet = useOutlet();
  const outletRef = useRef(outlet); outletRef.current = outlet;
  const guards = useContext(NavigationGuardContext);
  const [restored] = useState(() => { try { return scope ? readWorkspace(localStorage, scope) : null; } catch { return null; } });
  const [entries, setEntries] = useState<Entry[]>(() => restored?.tabs.map((tab,index) => {
    const match = matchWorkspaceRoute(tab.pathname);
    return { id: tab.id, match, general: tab.general, route: { location: { pathname: tab.pathname, search: '', hash: '', state: historyState({[GENERAL_KEY]:tab.general},tab.id), key: `restored-${tab.id}` }, params: match?.params ?? {} }, navigationType: 'POP' as ReturnType<typeof useNavigationType>, title: match?.isNew ? `New ${match.family === 'order' ? 'Order' : 'Quote'} ${restored.tabs.slice(0,index+1).filter(item=>matchWorkspaceRoute(item.pathname)?.family === match.family && matchWorkspaceRoute(item.pathname)?.isNew).length}` : match ? recordTitle(match) : navigationTitle(tab.pathname), outlet: null };
  }) ?? []);
  const entriesRef = useRef(entries); entriesRef.current = entries;
  const [activeId, setActiveId] = useState<string | null>(restored?.activeId ?? null);
  const activeRef = useRef(activeId); activeRef.current = activeId;
  const sequence = useRef({order:restored?.tabs.filter(tab=>matchWorkspaceRoute(tab.pathname)?.family === "order" && matchWorkspaceRoute(tab.pathname)?.isNew).length ?? 0,quote:restored?.tabs.filter(tab=>matchWorkspaceRoute(tab.pathname)?.family === "quote" && matchWorkspaceRoute(tab.pathname)?.isNew).length ?? 0});
  const historyOwners = useRef(new Map<string, string>());
  const initialRoute = useRef(true);
  const write = useCallback((update: (previous: Entry[]) => Entry[]) => {
    const next = update(entriesRef.current);
    entriesRef.current = next;
    setEntries(next);
  }, []);

  useLayoutEffect(() => {
    if (initialRoute.current) {
      initialRoute.current = false;
      const saved = entriesRef.current.find(entry => entry.id === historyId(location) && entry.route.location.pathname === location.pathname)
        ?? entriesRef.current.find(entry => matchWorkspaceRoute(location.pathname)?.recordKey && entry.match?.recordKey === matchWorkspaceRoute(location.pathname)?.recordKey)
        ?? ((entriesRef.current.find(entry=>entry.id === restored?.activeId)?.route.location.pathname === location.pathname || ['/', '/dashboard', '/orders'].includes(location.pathname)) ? entriesRef.current.find(entry => entry.id === restored?.activeId) : undefined);
      if (saved) {
        navigate(pathOf(saved.route.location), { replace: true, state: saved.route.location.state });
        return;
      }
    }
    const match = matchWorkspaceRoute(location.pathname);
    const requested = historyId(location);
    const activeGeneral = entriesRef.current.find(entry => entry.id === activeRef.current && entry.general);
    const ownerId = requested ?? historyOwners.current.get(location.key) ?? (navigationType !== "POP" ? activeGeneral?.id : null);
    const owner = entriesRef.current.find(entry => entry.id === ownerId);
    const general = location.state?.[GENERAL_KEY] === true || Boolean(owner?.general);
    const freshEditor = Boolean(match?.isNew && owner?.match?.isNew && !requested && !historyOwners.current.has(location.key));
    // A record already open elsewhere always wins. Dirty editors are retained
    // rather than replaced when navigation leaves their current record.
    const existing = entriesRef.current.find(entry => match?.recordKey && entry.match?.recordKey === match.recordKey)
      ?? (!freshEditor && owner?.general && (!guards?.isGuardActive(owner.id) || sameEditor(owner.match, match) || (!owner.match && !match && owner.route.location.pathname === location.pathname)) ? owner : undefined)
      ?? (!freshEditor && match?.isNew && owner?.match?.isNew && owner.match.family === match.family ? owner : undefined);
    if (!match && !existing && !general) { setActiveId(null); return; }
    const id = existing?.id ?? crypto.randomUUID();
    historyOwners.current.set(location.key, id);
    const route = { location, params: match?.params ?? {} };
    const title = existing && sameEditor(existing.match, match) ? existing.title
      : match?.isNew ? `New ${match.family === "order" ? "Order" : "Quote"} ${++sequence.current[match.family as "order" | "quote"]}`
      : match ? recordTitle(match) : navigationTitle(location.pathname);
    write(previous => {
      if (existing) return previous.map(entry => entry.id === id ? { ...entry, match, route, navigationType, outlet: match ? null : outletRef.current, title } : entry);
      return [...previous, { id, match, general, route, navigationType, title, outlet: match ? null : outletRef.current }];
    });
    setActiveId(id);
    // Only an opaque identity goes into browser history. Refresh never restores business edits.
    if (requested !== id) navigate(pathOf(location), { replace: true, state: historyState({ ...location.state, [GENERAL_KEY]: existing?.general ?? general }, id), preventScrollReset: true });
  }, [location, navigationType, navigate, write, guards?.isGuardActive]);

  useLayoutEffect(() => {
    try { if (scope) writeWorkspace(localStorage, scope, entries.map(entry => ({id:entry.id,pathname:entry.route.location.pathname,general:entry.general})), activeId); } catch { /* Browser storage may be disabled. */ }
  }, [entries, activeId, scope?.userId, scope?.organizationId]);

  const activate = useCallback((entry: Entry) => {
    navigate(pathOf(entry.route.location), { state: historyState(entry.route.location.state, entry.id), preventScrollReset: true });
  }, [navigate]);
  const close = useCallback((entry: Entry) => {
    const proceed = () => {
    const before = entriesRef.current, index = before.findIndex(candidate => candidate.id === entry.id);
    const remaining = before.filter(candidate => candidate.id !== entry.id);
    write(() => remaining);
    if (activeRef.current === entry.id) {
      const next = remaining[Math.min(index, remaining.length - 1)];
      if (next) activate(next);
      else navigate(entry.match?.family === "customer" ? "/customers" : entry.match?.family === "quote" ? "/quotes" : "/orders", { replace: true });
    }
    };
    const allowed = guards?.requestExit?.(entry.id) ?? (!guards?.isGuardActive(entry.id) || window.confirm(`Close ${entry.title}? Unsaved changes will be lost. Save first to keep your work.`));
    if (typeof allowed === "boolean") { if (allowed) proceed(); } else void allowed.then(ok=>{if(ok) proceed();});
  }, [guards, activate, navigate, write]);
  const openNew = useCallback((family: "order" | "quote" | "navigation") => {
    navigate(family === "navigation" ? "/orders" : `/${family === "order" ? "orders" : "quotes"}/new`, { state: historyState({ [GENERAL_KEY]: family === "navigation" }, crypto.randomUUID()) });
  }, [navigate]);
  const navigateOwner = useCallback((id: string, to: To | number, options?: NavigateOptions) => {
    const owner = entriesRef.current.find(entry => entry.id === id);
    if (!owner) return; // A late completion from an intentionally closed tab cannot resurrect it.
    if (typeof to === "number") { if (activeRef.current === id) navigate(to); return; }
    const path = resolvePath(to, owner.route.location.pathname);
    const match = matchWorkspaceRoute(path.pathname);
    if (match && owner.match && match.family === owner.match.family && (match.recordKey === owner.match.recordKey || (owner.match.isNew && options?.state?.titanWorkspaceSaved === true))) {
      const nextLocation = { ...path, state: historyState(options?.state, id), key: owner.route.location.key };
      write(previous => previous.map(entry => entry.id === id ? { ...entry, match, route: { location: nextLocation, params: match.params }, title: owner.match?.isNew && !match.isNew ? recordTitle(match) : entry.title } : entry));
      // Saving an inactive editor updates its own route, never the currently active tab.
      if (activeRef.current === id) navigate(createPath(path), { ...options, state: nextLocation.state });
    } else if (activeRef.current === id) {
      navigate(createPath(path), owner.general ? { ...options, state: historyState({ ...options?.state, [GENERAL_KEY]: true }, id) } : options);
    }
  }, [navigate, write]);
  const updateTitle = useCallback((id: string, title: string) => {
    if (entriesRef.current.some(entry => entry.id === id && entry.title !== title)) write(previous => previous.map(entry => entry.id === id ? { ...entry, title } : entry));
  }, [write]);
  // Sidebar navigation and record links retain mounted tabs. They are not discard
  // operations, even when the caller sits outside a workspace boundary.
  const retainedNavigation = useMemo(() => guards ? { ...guards, guardedNavigate: (to: string | number, options?: NavigateOptions, workspaceId?: string, navigation?: import('@/contexts/WorkspaceContext').WorkspaceNavigation) => {
    if ((workspaceId || activeRef.current) && (typeof to === 'number' || !/^[a-z]+:|^\/\//i.test(to))) {
      if (navigation) { void navigation(to,options); return; }
      if (typeof to === 'number') navigate(to); else navigate(to,options); return;
    }
    guards.guardedNavigate(to,options,workspaceId,navigation);
  }} : null, [guards,navigate]);
  return <TabsContext.Provider value={{ entries, activeId, activate, close, openNew, navigateOwner }}>
    <NavigationGuardContext.Provider value={retainedNavigation}><WorkspaceTitleContext.Provider value={updateTitle}>{children}</WorkspaceTitleContext.Provider></NavigationGuardContext.Provider>
  </TabsContext.Provider>;
}

function WorkspaceTab({ entry, active, activate, close }: { entry: Entry; active: boolean; activate: () => void; close: () => void }) {
  const guards = useContext(NavigationGuardContext);
  const dirty = useSyncExternalStore(guards?.subscribeGuards ?? noSubscription, () => guards?.isGuardActive(entry.id) ?? false);
  const Icon = entry.match?.family === "order" ? ShoppingCart : entry.match?.family === "quote" ? FileText : entry.match?.family === "customer" ? Building2 : PanelTop;
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { if (active) button.current?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [active]);
  return <div className={cn("flex h-9 shrink-0 items-center border-r border-border", active ? "border-b-2 border-b-primary bg-background text-foreground" : "bg-muted/40 text-muted-foreground")}>
    <button ref={button} type="button" role="tab" id={`tab-${entry.id}`} aria-selected={active} aria-controls={`panel-${entry.id}`}
      onClick={activate} title={`${entry.title}${dirty ? " — unsaved changes" : ""}`}
      className="flex h-full max-w-60 items-center gap-1.5 px-3 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true"/><span className="truncate">{entry.title}</span>
      {dirty && <span aria-label="Unsaved changes" className="shrink-0">●</span>}
    </button>
    <button type="button" aria-label={`Close ${entry.title}`} onClick={close} className="mr-1 rounded p-1 hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><X className="h-3.5 w-3.5" aria-hidden="true"/></button>
  </div>;
}

export function WorkspaceTabBar() {
  const tabs = useContext(TabsContext);
  if (!tabs) return null;
  return <div className="flex h-9 min-h-9 min-w-0 items-center border-b border-border bg-muted/30" data-testid="workspace-tab-bar">
    <div role="tablist" aria-label="Open workspaces" className="flex min-w-0 flex-1 flex-nowrap overflow-x-auto overscroll-x-contain"
      onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        if (!(event.target instanceof HTMLElement) || event.target.getAttribute("role") !== "tab") return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        const index = buttons.indexOf(event.target as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
        event.preventDefault(); buttons[next]?.focus(); buttons[next]?.click();
      }}>
      {tabs.entries.map(entry => <WorkspaceTab key={entry.id} entry={entry} active={tabs.activeId === entry.id} activate={() => tabs.activate(entry)} close={() => tabs.close(entry)}/>)}
    </div>
    <div role="group" aria-label="New workspaces" className="flex shrink-0 items-center gap-1 px-1">
      {([ ["order", "Order"], ["quote", "Quote"], ["navigation", "Tab"] ] as const).map(([family, label]) =>
        <Button key={family} type="button" size="sm" className="h-8 gap-1 px-2 text-xs" aria-label={`New ${label === "Tab" ? "navigation tab" : label}`} onClick={() => tabs.openNew(family)}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true"/>{label}
        </Button>)}
    </div>
  </div>;
}

export function WorkspacePanels({ renderEditor, children }: { renderEditor: () => React.ReactNode; children: React.ReactNode }) {
  const tabs = useContext(TabsContext);
  const location = useLocation();
  if (!tabs) return <>{children}</>;
  return <>
    {tabs.entries.map(entry => <WorkspaceBoundary key={entry.id} workspaceId={entry.id} active={tabs.activeId === entry.id}
      id={`panel-${entry.id}`} role="tabpanel" aria-labelledby={`tab-${entry.id}`} tabIndex={0}
      route={entry.route} onNavigate={(to, options) => tabs.navigateOwner(entry.id, to, options)} scrollMode="contained" className="min-h-0 min-w-0 flex-1 overscroll-contain outline-none">
      <WorkspaceRouteScope entry={entry} navigateOwner={tabs.navigateOwner}>{entry.match ? renderEditor() : entry.outlet ?? (tabs.activeId === entry.id ? children : null)}</WorkspaceRouteScope>
    </WorkspaceBoundary>)}
    {/* Never mount the router's editor outlet before the host's layout effect
        adopts its route. That would briefly create a second unscoped editor. */}
    {!matchWorkspaceRoute(location.pathname) && !tabs.activeId && !location.state?.[GENERAL_KEY] && children}
  </>;
}

/** Reuse the application's matched outlet, with its own location and navigator.
 * No second route table/router, and inactive pages cannot navigate another tab. */
function WorkspaceRouteScope({ entry, navigateOwner, children }: { entry: Entry; navigateOwner: TabsContextValue["navigateOwner"]; children: React.ReactNode }) {
  const navigation = useContext(UNSAFE_NavigationContext);
  const navigator = useMemo(() => ({ ...navigation.navigator,
    push: (to: To, state?: unknown, options?: NavigateOptions) => navigateOwner(entry.id, to, { ...options, state }),
    replace: (to: To, state?: unknown, options?: NavigateOptions) => navigateOwner(entry.id, to, { ...options, state, replace: true }),
    go: (delta: number) => navigateOwner(entry.id, delta),
  }), [navigation.navigator, navigateOwner, entry.id]);
  return <UNSAFE_NavigationContext.Provider value={{ ...navigation, navigator }}>
    <UNSAFE_LocationContext.Provider value={{ navigationType: entry.navigationType, location: entry.route.location }}>{children}</UNSAFE_LocationContext.Provider>
  </UNSAFE_NavigationContext.Provider>;
}
