import { matchWorkspaceRoute, workspacePathname } from './workspaceRoutes';

export type WorkspaceScope =
  | { kind?: "staff"; userId: string; organizationId: string }
  | { kind: "portal"; userId: string; customerId: string };
export type StoredWorkspace = { version: 1; tabs: { id: string; pathname: string; general: boolean }[]; activeId: string | null };
export const workspaceStorageKey = (scope: WorkspaceScope) => scope.kind === "portal"
  ? 'titanos.portal-workspaces.v1:' + encodeURIComponent(scope.userId) + ':' + encodeURIComponent(scope.customerId)
  : 'titanos.workspaces.v1:' + encodeURIComponent(scope.userId) + ':' + encodeURIComponent(scope.organizationId);

export function isWorkspaceShellPath(path: string, kind?: WorkspaceScope["kind"]) {
  if (kind === "portal") return /^\/portal(?:\/|$)/i.test(path) && !/^\/portal\/proof\//i.test(path);
  return !/^\/(?:$|login|logout|portal|api|auth|byos|request-portal-access|forgot-password|reset-password|force-password-change|set-password|select-org|accept-invite|pay|shared|print|print-agent|privacy|terms|support)(?:\/|$)/i.test(path)
    && !/^\/(?:orders\/[^/]+\/traveler|production\/jobs\/[^/]+\/ticket)\/?$/i.test(path);
}

const safePath = (path: unknown, kind: WorkspaceScope["kind"]): path is string => typeof path === 'string' && path.length < 512
  && /^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\/?$/.test(path) && isWorkspaceShellPath(path, kind);

/** Route identities only. Never serialize location.state, query text, titles or editor data. */
export function readWorkspace(storage: Pick<Storage, 'getItem'>, scope: WorkspaceScope): StoredWorkspace | null {
  try {
    const raw = storage.getItem(workspaceStorageKey(scope));
    if (!raw || raw.length > 1_000_000) return null;
    const value = JSON.parse(raw);
    if (value.version !== 1 || !Array.isArray(value.tabs)) return null;
    const ids = new Set<string>(), routes = new Set<string>();
    const tabs: StoredWorkspace['tabs'] = [];
    for (const tab of value.tabs) {
      if (!tab || typeof tab.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(tab.id) || !safePath(tab.pathname, scope.kind) || typeof tab.general !== 'boolean') return null;
      const match = matchWorkspaceRoute(tab.pathname);
      const route = match?.recordKey ?? (!match && !tab.general ? workspacePathname(tab.pathname) : null);
      if (ids.has(tab.id) || route && routes.has(route)) continue;
      ids.add(tab.id);
      if (route) routes.add(route);
      tabs.push({ id: tab.id, pathname: tab.pathname, general: tab.general });
    }
    return { version: 1, tabs, activeId: ids.has(value.activeId) ? value.activeId : tabs[0]?.id ?? null };
  } catch { return null; }
}

export function writeWorkspace(storage: Pick<Storage, 'setItem'>, scope: WorkspaceScope, tabs: StoredWorkspace['tabs'], activeId: string | null) {
  try {
    const routes = tabs.filter(tab => safePath(tab.pathname, scope.kind)).map(({ id, pathname, general }) => ({ id, pathname, general }));
    storage.setItem(workspaceStorageKey(scope), JSON.stringify({ version: 1, tabs: routes, activeId }));
  } catch { /* Storage can be unavailable/full; mounted editors remain usable. */ }
}
