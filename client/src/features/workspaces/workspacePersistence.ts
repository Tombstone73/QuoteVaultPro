import { matchWorkspaceRoute } from './workspaceRoutes';

export type WorkspaceScope = { userId: string; organizationId: string };
export type StoredWorkspace = { version: 1; tabs: { id: string; pathname: string; general: boolean }[]; activeId: string | null };
export const workspaceStorageKey = ({ userId, organizationId }: WorkspaceScope) => `titanos.workspaces.v1:${encodeURIComponent(userId)}:${encodeURIComponent(organizationId)}`;
const safePath = (path: unknown): path is string => typeof path === 'string' && path.length < 512
  && /^\/[a-zA-Z0-9/_-]*$/.test(path) && !/^\/(?:login|logout|portal|api|auth)(?:\/|$)/.test(path);

/** Route identities only. Never serialize location.state, query text, titles or editor data. */
export function readWorkspace(storage: Pick<Storage, 'getItem'>, scope: WorkspaceScope): StoredWorkspace | null {
  try {
    const raw = storage.getItem(workspaceStorageKey(scope));
    if (!raw || raw.length > 1_000_000) return null;
    const value = JSON.parse(raw);
    if (value.version !== 1 || !Array.isArray(value.tabs)) return null;
    const ids = new Set<string>(), records = new Set<string>();
    const tabs: StoredWorkspace['tabs'] = [];
    for (const tab of value.tabs) {
      if (!tab || typeof tab.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(tab.id) || !safePath(tab.pathname) || typeof tab.general !== 'boolean') return null;
      const match = matchWorkspaceRoute(tab.pathname);
      if (!match && !tab.general) return null;
      if (ids.has(tab.id) || match?.recordKey && records.has(match.recordKey)) continue;
      ids.add(tab.id); if (match?.recordKey) records.add(match.recordKey);
      tabs.push({ id: tab.id, pathname: tab.pathname, general: tab.general });
    }
    return { version: 1, tabs, activeId: ids.has(value.activeId) ? value.activeId : tabs[0]?.id ?? null };
  } catch { return null; }
}

export function writeWorkspace(storage: Pick<Storage, 'setItem'>, scope: WorkspaceScope, tabs: StoredWorkspace['tabs'], activeId: string | null) {
  try {
    storage.setItem(workspaceStorageKey(scope), JSON.stringify({ version: 1, tabs: tabs.map(({ id, pathname, general }) => ({ id, pathname, general })), activeId }));
  } catch { /* Storage can be unavailable/full; mounted editors remain usable. */ }
}
