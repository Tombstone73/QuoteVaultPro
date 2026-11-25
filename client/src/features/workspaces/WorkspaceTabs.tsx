import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPath, resolvePath, useLocation, useNavigate, useNavigationType, useOutlet, UNSAFE_LocationContext, UNSAFE_NavigationContext, type Location, type NavigateOptions, type To } from "react-router-dom";
import { Plus, X, FileText, ShoppingCart, Building2, ClipboardList, PanelTop } from "lucide-react";
import { WorkspaceBoundary, type WorkspaceRoute } from "@/contexts/WorkspaceContext";
import { NavigationGuardContext } from "@/contexts/navigationGuardRegistration";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WorkspaceTitleContext } from "./WorkspaceTitle";
import { WorkspaceLegacyNavigation } from "./WorkspaceLegacyNavigation";
import { matchWorkspaceRoute, workspacePathname, type WorkspaceMatch } from "./workspaceRoutes";
import { isWorkspaceShellPath, readWorkspace, workspaceStorageKey, writeWorkspace, type WorkspaceScope } from './workspacePersistence';

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
const historyId = (location: Location): string | undefined => {
  const id: unknown = location.state?.[HISTORY_KEY];
  return typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id) ? id : undefined;
};
const pathOf = (location: Location) => createPath(location);
const noSubscription = () => () => {};
const recordTitle = (match: WorkspaceMatch) => match.family === "purchase-order" ? "Purchase Order" :
  `${match.family === "customer" ? "Customer" : match.family === "order" ? "Order" : "Quote"} ${match.params.id?.slice(0, 8)}`;
const draftTitle = (match: WorkspaceMatch, number: () => number) => match.family === "purchase-order" ? "New Purchase Order" :
  `New ${match.family === "order" ? "Order" : "Quote"} ${number()}`;
function navigationTitle(pathname: string) {
  const parts = workspacePathname(pathname).split("/").filter(Boolean);
  if (parts.length === 1 && parts[0] === "portal") return "Portal Home";
  return parts.map(part => /^[a-f0-9]{8}-(?:[a-f0-9]+-)*[a-f0-9]+$/i.test(part)
    ? part.slice(0, 8)
    : part.replace(/(^|-)[a-z]/g, word => word.replace("-", " ").toUpperCase())).join(" · ") || "Workspace";
}
const sameEditor = (before: WorkspaceMatch | null, after: WorkspaceMatch | null) => Boolean(before && after && before.family === after.family && (before.recordKey ? before.recordKey === after.recordKey : after.isNew));

/** Editors remain in memory; only user/tenant-scoped route identities survive refresh. */
export function WorkspaceTabsProvider({ children, scope, landingPath }: {
  children: React.ReactNode;
  scope?: WorkspaceScope;
  landingPath?: string;
}) {
  const location = useLocation(), navigate = useNavigate();
  const navigationType = useNavigationType(), outlet = useOutlet();
  const outletRef = useRef(outlet); outletRef.current = outlet;
  const guards = useContext(NavigationGuardContext);
  const [restored] = useState(() => { try { return scope ? readWorkspace(localStorage, scope) : null; } catch { return null; } });
  const [entries, setEntries] = useState<Entry[]>(() => restored?.tabs.map((tab,index) => {
    const match = matchWorkspaceRoute(tab.pathname);
    return { id: tab.id, match, general: tab.general, route: { location: { pathname: tab.pathname, search: '', hash: '', state: historyState({[GENERAL_KEY]:tab.general},tab.id), key: `restored-${tab.id}` }, params: match?.params }, navigationType: 'POP' as ReturnType<typeof useNavigationType>, title: match?.isNew ? draftTitle(match, () => restored.tabs.slice(0,index+1).filter(item=>matchWorkspaceRoute(item.pathname)?.family === match.family && matchWorkspaceRoute(item.pathname)?.isNew).length) : match ? recordTitle(match) : navigationTitle(tab.pathname), outlet: null };
  }) ?? []);
  const entriesRef = useRef(entries); entriesRef.current = entries;
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeRef = useRef(activeId); activeRef.current = activeId;
  const sequence = useRef({order:restored?.tabs.filter(tab=>matchWorkspaceRoute(tab.pathname)?.family === "order" && matchWorkspaceRoute(tab.pathname)?.isNew).length ?? 0,quote:restored?.tabs.filter(tab=>matchWorkspaceRoute(tab.pathname)?.family === "quote" && matchWorkspaceRoute(tab.pathname)?.isNew).length ?? 0});
  const historyOwners = useRef(new Map<string, string>());
  const initialRoute = useRef(true);
  const replacement = useRef<{ id: string; pathname: string } | null>(null);
  const storageKey = scope ? workspaceStorageKey(scope) : undefined;
  const write = useCallback((update: (previous: Entry[]) => Entry[]) => {
    const next = update(entriesRef.current);
    entriesRef.current = next;
    setEntries(next);
  }, []);

  useLayoutEffect(() => {
    const pathname = workspacePathname(location.pathname);
    const match = matchWorkspaceRoute(pathname);
    const requested = historyId(location);
    const mapped = historyOwners.current.get(location.key);
    const previous = entriesRef.current;
    const owner = previous.find(entry => entry.id === requested) ?? previous.find(entry => entry.id === mapped);
    const activeGeneral = navigationType !== "POP" && !requested && !mapped
      ? previous.find(entry => entry.id === activeRef.current && entry.general) : undefined;
    const replacing = replacement.current?.pathname === pathname
      ? previous.find(entry => entry.id === replacement.current?.id && !guards?.isGuardActive(entry.id)) : undefined;
    replacement.current = null;

    const samePage = (entry: Entry) => match
      ? sameEditor(entry.match, match)
      : !entry.match && workspacePathname(entry.route.location.pathname) === pathname;
    const newWorkspace = navigationType !== "POP" && Boolean(requested && !owner);
    const initialMatch = initialRoute.current
      ? previous.find(entry => entry.id === restored?.activeId && samePage(entry)) : undefined;
    const restoredDraft = initialRoute.current && match?.isNew ? previous.find(samePage) : undefined;
    initialRoute.current = false;
    const generalOwner = owner?.general ? owner : activeGeneral;
    const reuseGeneral = !newWorkspace && match?.family !== "purchase-order" && generalOwner &&
      !guards?.isGuardActive(generalOwner.id) && !(match?.isNew && generalOwner.match?.isNew);
    // Record and route identity take precedence over history from a different page.
    const existing = (owner && samePage(owner) ? owner : undefined)
      ?? (match?.recordKey ? previous.find(samePage) : undefined)
      ?? initialMatch
      ?? (!match && !newWorkspace ? previous.find(entry => !entry.general && samePage(entry)) ?? previous.find(samePage) : undefined)
      ?? restoredDraft
      ?? replacing
      ?? (reuseGeneral ? generalOwner : undefined);
    const general = existing?.general ?? (match?.family !== "purchase-order" && location.state?.[GENERAL_KEY] === true);
    const id = existing?.id ?? (newWorkspace && (match?.isNew || general) ? requested : undefined) ?? crypto.randomUUID();
    historyOwners.current.set(location.key, id);
    const route = { location, params: match?.params };
    const title = existing && samePage(existing) ? existing.title
      : match?.isNew ? draftTitle(match, () => ++sequence.current[match.family as "order" | "quote"])
      : match ? recordTitle(match) : navigationTitle(pathname);
    const next = { id, match, general, route, navigationType, outlet: match ? null : outletRef.current, title };
    write(entries => {
      const retained = replacing && replacing.id !== id ? entries.filter(entry => entry.id !== replacing.id) : entries;
      return existing ? retained.map(entry => entry.id === id ? next : entry) : [...retained, next];
    });
    setActiveId(id);
  }, [location, navigationType, write, guards?.isGuardActive, restored?.activeId]);

  useEffect(() => {
    // Drafts can share a pathname. Stamp the committed history entry after the
    // router is listening, so a reload followed by Back restores the right tab.
    const owner = entriesRef.current.find(entry =>
      entry.id === activeId && entry.route.location.key === location.key && entry.match?.isNew);
    if (owner && historyId(location) !== owner.id) {
      navigate(pathOf(location), { replace: true, state: historyState(location.state, owner.id), preventScrollReset: true });
    }
  }, [activeId, location, navigate]);

  useLayoutEffect(() => {
    try { if (scope) writeWorkspace(localStorage, scope, entries.map(entry => ({id:entry.id,pathname:entry.route.location.pathname,general:entry.general})), activeId); } catch { /* Browser storage may be disabled. */ }
  }, [entries, activeId, storageKey]);

  const activate = useCallback((entry: Entry) => {
    if (activeRef.current === entry.id) return;
    navigate(pathOf(entry.route.location), { state: historyState(entry.route.location.state, entry.id), preventScrollReset: true });
  }, [navigate]);
  const close = useCallback((entry: Entry) => {
    const proceed = () => {
      const before = entriesRef.current, index = before.findIndex(candidate => candidate.id === entry.id);
      if (index < 0) return;
      const remaining = before.filter(candidate => candidate.id !== entry.id);
      write(() => remaining);
      if (activeRef.current === entry.id) {
        const next = remaining[Math.min(index, remaining.length - 1)];
        if (next) activate(next);
        else navigate(landingPath ?? (entry.match?.family === "customer" ? "/customers" : entry.match?.family === "quote" ? "/quotes" :
          entry.match?.family === "purchase-order" ? "/purchase-orders" : "/orders"), { replace: true });
      }
    };
    const allowed = guards?.requestExit?.(entry.id) ?? (!guards?.isGuardActive(entry.id) || window.confirm(`Close ${entry.title}? Unsaved changes will be lost. Save first to keep your work.`));
    if (typeof allowed === "boolean") { if (allowed) proceed(); } else void allowed.then(ok=>{if(ok) proceed();});
  }, [guards, activate, landingPath, navigate, write]);
  const openNew = useCallback((family: "order" | "quote" | "navigation") => {
    navigate(family === "navigation" ? landingPath ?? "/orders" : `/${family === "order" ? "orders" : "quotes"}/new`, { state: historyState({ [GENERAL_KEY]: family === "navigation" }, crypto.randomUUID()) });
  }, [landingPath, navigate]);
  const navigateOwner = useCallback((id: string, to: To | number, options?: NavigateOptions) => {
    const owner = entriesRef.current.find(entry => entry.id === id);
    if (!owner) return; // A late completion from an intentionally closed tab cannot resurrect it.
    if (typeof to === "number") { if (activeRef.current === id) navigate(to); return; }
    const path = resolvePath(to, owner.route.location.pathname);
    const match = matchWorkspaceRoute(path.pathname);
    if (match && owner.match && match.family === owner.match.family && (match.recordKey === owner.match.recordKey || (owner.match.isNew && options?.state?.titanWorkspaceSaved === true))) {
      const { titanWorkspaceTitle, ...state } = options?.state ?? {};
      const nextLocation = { ...path, state: historyState(state, id), key: owner.route.location.key };
      const saved = owner.match.isNew && !match.isNew;
      const title = saved && typeof titanWorkspaceTitle === "string" ? titanWorkspaceTitle : saved ? recordTitle(match) : owner.title;
      write(previous => previous.map(entry => entry.id === id ? { ...entry, match, route: { location: nextLocation, params: match.params }, title } : entry));
      // Saving an inactive editor updates its own route, never the currently active tab.
      if (activeRef.current === id) navigate(createPath(path), { ...options, state: nextLocation.state });
    } else if (activeRef.current === id) {
      const destination = workspacePathname(path.pathname);
      const current = workspacePathname(owner.route.location.pathname);
      if (options?.replace && !owner.match && current !== destination && !guards?.isGuardActive(id)) {
        replacement.current = { id, pathname: destination };
      }
      const state = owner.general || current === destination ? historyState(options?.state, id) : options?.state;
      navigate(createPath(path), { ...options, state });
    } else if (!owner.match && options?.replace && options.state?.titanWorkspaceSaved === true &&
      !guards?.isGuardActive(id)) {
      // A finished ordinary editor closes its old route without moving a
      // different tab selected while the save was running.
      write(previous => previous.filter(entry => entry.id !== id));
    }
  }, [guards?.isGuardActive, navigate, write]);
  const updateTitle = useCallback((id: string, title: string) => {
    if (entriesRef.current.some(entry => entry.id === id && entry.title !== title)) write(previous => previous.map(entry => entry.id === id ? { ...entry, title } : entry));
  }, [write]);
  // Sidebar navigation and record links retain mounted tabs. They are not discard
  // operations, even when the caller sits outside a workspace boundary.
  const retainedNavigation = useMemo(() => guards ? { ...guards, guardedNavigate: (to: string | number, options?: NavigateOptions, workspaceId?: string, navigation?: import('@/contexts/WorkspaceContext').WorkspaceNavigation) => {
    if ((workspaceId || activeRef.current) && (typeof to === 'number' ||
      (!/^[a-z]+:|^\/\//i.test(to) && isWorkspaceShellPath(resolvePath(to, location.pathname).pathname, scope?.kind)))) {
      if (navigation) { void navigation(to,options); return; }
      if (typeof to === 'number') navigate(to); else navigate(to,options); return;
    }
    guards.guardedNavigate(to,options,workspaceId,navigation);
  }} : null, [guards, location.pathname, navigate, scope?.kind]);
  return <TabsContext.Provider value={{ entries, activeId, activate, close, openNew, navigateOwner }}>
    <NavigationGuardContext.Provider value={retainedNavigation}><WorkspaceTitleContext.Provider value={updateTitle}>{children}</WorkspaceTitleContext.Provider></NavigationGuardContext.Provider>
  </TabsContext.Provider>;
}

function WorkspaceTab({ entry, active, activate, close }: { entry: Entry; active: boolean; activate: () => void; close: () => void }) {
  const guards = useContext(NavigationGuardContext);
  const dirty = useSyncExternalStore(guards?.subscribeGuards ?? noSubscription, () => guards?.isGuardActive(entry.id) ?? false);
  const Icon = entry.match?.family === "order" ? ShoppingCart : entry.match?.family === "quote" ? FileText :
    entry.match?.family === "customer" ? Building2 : entry.match?.family === "purchase-order" ? ClipboardList : PanelTop;
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (active) button.current?.parentElement?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, entry.title]);
  return <div className={cn("flex h-9 shrink-0 items-center border-r border-border", active ? "border-b-2 border-b-primary bg-background text-foreground" : "bg-muted/40 text-muted-foreground")}>
    <button ref={button} type="button" role="tab" id={`tab-${entry.id}`} aria-selected={active} aria-controls={`panel-${entry.id}`}
      onClick={activate} title={`${entry.title}${dirty ? " — unsaved changes" : ""}`}
      className={cn("flex h-full max-w-60 items-center gap-1.5 px-3 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring", active && "font-semibold")}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true"/><span className="truncate">{entry.title}</span>
      {dirty && <span aria-label="Unsaved changes" className="shrink-0">●</span>}
    </button>
    <button type="button" aria-label={`Close ${entry.title}`} onClick={close} className="mr-1 rounded p-1 hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><X className="h-3.5 w-3.5" aria-hidden="true"/></button>
  </div>;
}

export function WorkspaceTabBar({ navigationOnly = false }: { navigationOnly?: boolean }) {
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
    {!navigationOnly && <div role="group" aria-label="New workspaces" className="flex shrink-0 items-center gap-1 px-1">
      {([ ["order", "Order"], ["quote", "Quote"], ["navigation", "Tab"] ] as const).map(([family, label]) =>
        <Button key={family} type="button" size="sm" className="h-8 gap-1 px-2 text-xs" aria-label={`New ${label === "Tab" ? "navigation tab" : label}`} onClick={() => tabs.openNew(family)}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true"/>{label}
        </Button>)}
    </div>}
  </div>;
}

export function WorkspacePanels({ renderEditor, wrapOutlet, scrollMode = "contained", children }: {
  renderEditor?: () => React.ReactNode;
  wrapOutlet?: (outlet: React.ReactNode, pathname: string) => React.ReactNode;
  scrollMode?: "document" | "contained";
  children?: React.ReactNode;
}) {
  const tabs = useContext(TabsContext);
  if (!tabs) return null;
  return <>
    {tabs.entries.map(entry => {
      const active = tabs.activeId === entry.id;
      const outlet = entry.outlet ?? (active ? children : null);
      return <WorkspaceBoundary key={entry.id} workspaceId={entry.id} active={active}
        id={"panel-" + entry.id} role="tabpanel" aria-labelledby={"tab-" + entry.id} tabIndex={0}
        route={entry.route} onNavigate={(to, options) => tabs.navigateOwner(entry.id, to, options)} scrollMode={scrollMode}
        className="min-h-0 min-w-0 flex-1 overscroll-contain outline-none">
        <WorkspaceRouteScope entry={entry} navigateOwner={tabs.navigateOwner}>
          {entry.match && renderEditor ? renderEditor() : wrapOutlet && outlet ? wrapOutlet(outlet, workspacePathname(entry.route.location.pathname)) : outlet}
        </WorkspaceRouteScope>
      </WorkspaceBoundary>;
    })}
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
    <UNSAFE_LocationContext.Provider value={{ navigationType: entry.navigationType, location: entry.route.location }}>
      <WorkspaceLegacyNavigation>{children}</WorkspaceLegacyNavigation>
    </UNSAFE_LocationContext.Provider>
  </UNSAFE_NavigationContext.Provider>;
}
