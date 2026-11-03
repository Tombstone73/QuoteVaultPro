import React, { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPath, resolvePath, useLocation, useNavigate, type Location, type NavigateOptions, type To } from "react-router-dom";
import { Plus, X, FileText, ShoppingCart, Building2 } from "lucide-react";
import { WorkspaceBoundary, type WorkspaceRoute } from "@/contexts/WorkspaceContext";
import { NavigationGuardContext } from "@/contexts/navigationGuardRegistration";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WorkspaceTitleContext } from "./WorkspaceTitle";
import { matchWorkspaceRoute, type WorkspaceMatch } from "./workspaceRoutes";

const HISTORY_KEY = "titanWorkspaceId";
type Entry = { id: string; match: WorkspaceMatch; route: WorkspaceRoute; title: string };
type TabsContextValue = {
  entries: Entry[]; activeId: string | null;
  activate: (entry: Entry) => void; close: (entry: Entry) => void;
  openNew: (family: "order" | "quote") => void;
  navigateOwner: (id: string, to: To | number, options?: NavigateOptions) => void;
};
const TabsContext = createContext<TabsContextValue | null>(null);
const historyState = (state: unknown, id: string) => ({ ...(state && typeof state === "object" ? state : {}), [HISTORY_KEY]: id });
const historyId = (location: Location): string | undefined => location.state?.[HISTORY_KEY];
const pathOf = (location: Location) => createPath(location);
const noSubscription = () => () => {};
const recordTitle = (match: WorkspaceMatch) => `${match.family === "customer" ? "Customer" : match.family === "order" ? "Order" : "Quote"} ${match.params.id?.slice(0, 8)}`;

/** Memory-only registry of mounted editors and route metadata, never editor data. */
export function WorkspaceTabsProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation(), navigate = useNavigate();
  const guards = useContext(NavigationGuardContext);
  const [entries, setEntries] = useState<Entry[]>([]);
  const entriesRef = useRef(entries); entriesRef.current = entries;
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeRef = useRef(activeId); activeRef.current = activeId;
  const sequence = useRef({ order: 0, quote: 0 });
  const historyOwners = useRef(new Map<string, string>());
  const write = useCallback((update: (previous: Entry[]) => Entry[]) => {
    const next = update(entriesRef.current);
    entriesRef.current = next;
    setEntries(next);
  }, []);

  useLayoutEffect(() => {
    const match = matchWorkspaceRoute(location.pathname);
    if (!match) { setActiveId(null); return; }
    const requested = historyId(location);
    const ownerId = requested ?? historyOwners.current.get(location.key);
    const existing = entriesRef.current.find(entry => match.recordKey ? entry.match.recordKey === match.recordKey : entry.id === ownerId && entry.match.isNew && entry.match.family === match.family);
    const id = existing?.id ?? crypto.randomUUID();
    historyOwners.current.set(location.key, id);
    const route = { location, params: match.params };
    write(previous => {
      if (existing) return previous.map(entry => entry.id === id ? { ...entry, match, route } : entry);
      const title = match.isNew ? `New ${match.family === "order" ? "Order" : "Quote"} ${++sequence.current[match.family as "order" | "quote"]}`
        : recordTitle(match);
      return [...previous, { id, match, route, title }];
    });
    setActiveId(id);
    // Only an opaque identity goes into browser history. Refresh never restores business edits.
    if (requested !== id) navigate(pathOf(location), { replace: true, state: historyState(location.state, id), preventScrollReset: true });
  }, [location, navigate, write]);

  const activate = useCallback((entry: Entry) => {
    navigate(pathOf(entry.route.location), { state: historyState(entry.route.location.state, entry.id), preventScrollReset: true });
  }, [navigate]);
  const close = useCallback((entry: Entry) => {
    if (guards?.isGuardActive(entry.id) && !window.confirm(`Close ${entry.title}? Unsaved changes will be lost. Save first to keep your work.`)) return;
    const before = entriesRef.current, index = before.findIndex(candidate => candidate.id === entry.id);
    const remaining = before.filter(candidate => candidate.id !== entry.id);
    write(() => remaining);
    if (activeRef.current === entry.id) {
      const next = remaining[Math.min(index, remaining.length - 1)];
      if (next) activate(next);
      else navigate(entry.match.family === "customer" ? "/customers" : entry.match.family === "order" ? "/orders" : "/quotes", { replace: true });
    }
  }, [guards?.isGuardActive, activate, navigate, write]);
  const openNew = useCallback((family: "order" | "quote") => {
    navigate(`/${family === "order" ? "orders" : "quotes"}/new`, { state: historyState(null, crypto.randomUUID()) });
  }, [navigate]);
  const navigateOwner = useCallback((id: string, to: To | number, options?: NavigateOptions) => {
    const owner = entriesRef.current.find(entry => entry.id === id);
    if (!owner) return; // A late completion from an intentionally closed tab cannot resurrect it.
    if (typeof to === "number") { if (activeRef.current === id) navigate(to); return; }
    const path = resolvePath(to, owner.route.location.pathname);
    const match = matchWorkspaceRoute(path.pathname);
    if (match && match.family === owner.match.family && (match.recordKey === owner.match.recordKey || (owner.match.isNew && options?.state?.titanWorkspaceSaved === true))) {
      const nextLocation = { ...path, state: historyState(options?.state, id), key: owner.route.location.key };
      write(previous => previous.map(entry => entry.id === id ? { ...entry, match, route: { location: nextLocation, params: match.params }, title: owner.match.isNew && !match.isNew ? recordTitle(match) : entry.title } : entry));
      // Saving an inactive editor updates its own route, never the currently active tab.
      if (activeRef.current === id) navigate(createPath(path), { ...options, state: nextLocation.state });
    } else if (activeRef.current === id) {
      navigate(createPath(path), options);
    }
  }, [navigate, write]);
  const updateTitle = useCallback((id: string, title: string) => {
    if (entriesRef.current.some(entry => entry.id === id && entry.title !== title)) write(previous => previous.map(entry => entry.id === id ? { ...entry, title } : entry));
  }, [write]);
  return <TabsContext.Provider value={{ entries, activeId, activate, close, openNew, navigateOwner }}>
    <WorkspaceTitleContext.Provider value={updateTitle}>{children}</WorkspaceTitleContext.Provider>
  </TabsContext.Provider>;
}

function WorkspaceTab({ entry, active, activate, close }: { entry: Entry; active: boolean; activate: () => void; close: () => void }) {
  const guards = useContext(NavigationGuardContext);
  const dirty = useSyncExternalStore(guards?.subscribeGuards ?? noSubscription, () => guards?.isGuardActive(entry.id) ?? false);
  const Icon = entry.match.family === "order" ? ShoppingCart : entry.match.family === "quote" ? FileText : Building2;
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
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1 px-2 text-xs" aria-label="New workspace"><Plus className="h-3.5 w-3.5"/>New</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => tabs.openNew("order")}>New Order</DropdownMenuItem><DropdownMenuItem onSelect={() => tabs.openNew("quote")}>New Quote</DropdownMenuItem></DropdownMenuContent>
    </DropdownMenu>
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
      {renderEditor()}
    </WorkspaceBoundary>)}
    {/* Never mount the router's editor outlet before the host's layout effect
        adopts its route. That would briefly create a second unscoped editor. */}
    {!matchWorkspaceRoute(location.pathname) && children}
  </>;
}
