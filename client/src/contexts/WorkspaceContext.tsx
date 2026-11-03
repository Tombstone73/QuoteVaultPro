import React, { createContext, useCallback, useContext, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams, createSearchParams, resolvePath, type LinkProps, type Location, type NavigateFunction, type NavigateOptions, type To, type URLSearchParamsInit } from "react-router-dom";

export type WorkspaceRoute = { location: Location; params: Readonly<Record<string, string | undefined>> };
/** Controlled navigation updates this workspace only, including late save completions; it must not activate another workspace. */
export type WorkspaceNavigation = (to: To | number, options?: NavigateOptions) => void | Promise<void>;
type WorkspaceContextValue = {
  id: string; active: boolean; isActive: () => boolean;
  root: React.RefObject<HTMLDivElement>; portalContainer: HTMLDivElement | null;
  route?: WorkspaceRoute; onNavigate?: WorkspaceNavigation;
  fieldId: (id: string) => string;
  getElementById: (id: string) => HTMLElement | null;
  querySelector: (selector: string) => HTMLElement | null;
  getScrollY: () => number; scrollTo: (y: number) => void;
};
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
export const useWorkspace = () => useContext(WorkspaceContext);

/** Identity is lifetime-stable. Changing records is routing, not replacing the editor's state buffer. */
export function WorkspaceBoundary({ workspaceId, active = true, scopeFieldIds = true, scrollMode = "document", route, onNavigate, children, style, ...props }: React.HTMLAttributes<HTMLDivElement> & {
  workspaceId?: string; active?: boolean; scopeFieldIds?: boolean; scrollMode?: "document" | "contained";
  route?: WorkspaceRoute; onNavigate?: WorkspaceNavigation;
}) {
  const generatedId = useId();
  const [id] = useState(() => workspaceId || `editor-${generatedId}`);
  if (workspaceId && workspaceId !== id) throw new Error("Workspace identity cannot change on a mounted editor. Use a different React key.");
  const parent = useWorkspace();
  const enabled = active && (parent?.active ?? true);
  const activeRef = useRef(enabled); activeRef.current = enabled;
  const root = useRef<HTMLDivElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const lastScroll = useRef(0), wasInactive = useRef(false);
  const prefix = `ws-${encodeURIComponent(id)}--`;
  const fieldId = useCallback((value: string) => !scopeFieldIds || value.startsWith(prefix) || value.startsWith(":") || value.startsWith("radix-") ? value : `${prefix}${value}`, [prefix, scopeFieldIds]);
  const getScrollY = useCallback(() => scrollMode === "contained" ? root.current?.scrollTop ?? 0 : window.scrollY, [scrollMode]);
  const scrollTo = useCallback((y: number) => {
    if (!activeRef.current) return;
    if (scrollMode === "contained") root.current?.scrollTo(0, y); else window.scrollTo(0, y);
  }, [scrollMode]);
  useLayoutEffect(() => {
    if (root.current) root.current.inert = !enabled;
    if (!enabled) { wasInactive.current = true; return; }
    if (wasInactive.current) { scrollTo(lastScroll.current); wasInactive.current = false; }
    const remember = () => { if (activeRef.current) lastScroll.current = getScrollY(); };
    const target = scrollMode === "contained" ? root.current : window;
    target?.addEventListener("scroll", remember);
    return () => target?.removeEventListener("scroll", remember);
  }, [enabled, getScrollY, scrollMode, scrollTo]);
  const value = useMemo<WorkspaceContextValue>(() => ({
    id, active: enabled, isActive: () => activeRef.current, root, portalContainer, route, onNavigate, fieldId, getScrollY, scrollTo,
    getElementById: name => activeRef.current ? Array.from(root.current?.querySelectorAll<HTMLElement>("[id]") ?? []).find(node => node.id === fieldId(name)) ?? null : null,
    querySelector: selector => activeRef.current ? root.current?.querySelector<HTMLElement>(selector) ?? null : null,
  }), [id, enabled, portalContainer, route, onNavigate, fieldId, getScrollY, scrollTo]);
  return <WorkspaceContext.Provider value={value}>
    <div {...props} ref={root} data-workspace-id={id} data-workspace-active={enabled} hidden={!enabled}
      style={{ ...style, display: enabled ? scrollMode === "contained" ? style?.display : "contents" : "none", ...(scrollMode === "contained" ? { overflow: "auto" } : {}) }}>
      {children}<div ref={setPortalContainer} data-workspace-portals={id} style={{ display: "contents" }} />
    </div>
  </WorkspaceContext.Provider>;
}

const identityFieldId = (id: string) => id;
export function useWorkspaceFieldId() { return useWorkspace()?.fieldId ?? identityFieldId; }

/** Normal routes keep their existing DOM contract; a future host can supply isolated boundaries. */
export function SingleEditorWorkspace({ children }: { children: React.ReactNode }) {
  const workspace = useWorkspace();
  return workspace ? <>{children}</> : <WorkspaceBoundary workspaceId="primary" scopeFieldIds={false}>{children}</WorkspaceBoundary>;
}
/** Keep generated Radix/React IDs intact; namespace caller-owned HTML IDs and their references. */
export function useWorkspaceFieldProps<T extends object>(props: T): T {
  const fieldId = useWorkspaceFieldId();
  const result = { ...props } as Record<string, unknown>;
  for (const key of ["id", "htmlFor", "aria-describedby", "aria-labelledby", "aria-controls"]) {
    if (typeof result[key] === "string") result[key] = (result[key] as string).split(/\s+/).map(fieldId).join(" ");
  }
  return result as T;
}
export function WorkspaceLabel(props: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...useWorkspaceFieldProps(props)} />;
}

const defaultWorkspaceDom = {
    id: undefined, active: true, isActive: () => true, fieldId: (id: string) => id,
    getElementById: (id: string) => document.getElementById(id),
    querySelector: (selector: string) => document.querySelector<HTMLElement>(selector),
    getScrollY: () => window.scrollY, scrollTo: (y: number) => window.scrollTo(0, y),
};
export function useWorkspaceDom() { return useWorkspace() ?? defaultWorkspaceDom; }
export function useWorkspaceLocation(): Location { const location = useLocation(); return useWorkspace()?.route?.location ?? location; }
export function useWorkspaceParams<T extends string | Record<string, string | undefined> = string>() {
  const params = useParams<T>(); return (useWorkspace()?.route?.params ?? params) as typeof params;
}
export function useWorkspaceNavigate(): NavigateFunction {
  const navigate = useNavigate(), workspace = useWorkspace();
  const current = useRef(workspace); current.current = workspace;
  return useCallback(((to: To | number, options?: NavigateOptions) => {
    const owner = current.current;
    if (owner?.onNavigate) return owner.onNavigate(to, options);
    if (owner && !owner.isActive()) return;
    if (owner?.route) throw new Error("A controlled workspace requires its own navigation callback.");
    return typeof to === "number" ? navigate(to) : navigate(to, options);
  }) as NavigateFunction, [navigate]);
}
export function useWorkspaceSearchParams(defaultInit?: URLSearchParamsInit) {
  const fallback = useSearchParams(defaultInit), workspace = useWorkspace(), location = useWorkspaceLocation(), navigate = useWorkspaceNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const setParams = useCallback((next: URLSearchParamsInit | ((previous: URLSearchParams) => URLSearchParamsInit), options?: NavigateOptions) => {
    const value = createSearchParams(typeof next === "function" ? next(new URLSearchParams(params)) : next);
    navigate({ pathname: location.pathname, search: value.toString() ? `?${value}` : "", hash: location.hash }, options);
  }, [location.pathname, location.hash, navigate, params]);
  return workspace?.route ? [params, setParams] as const : fallback;
}
export const WorkspaceLink = React.forwardRef<HTMLAnchorElement, LinkProps>(({ onClick, to, target, ...props }, ref) => {
  const workspace = useWorkspace(), navigate = useWorkspaceNavigate();
  const external = typeof to === "string" && /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(to);
  const destination = workspace?.route && !external ? resolvePath(to, workspace.route.location.pathname) : to;
  return <Link {...props} ref={ref} to={destination} target={target} onClick={event => {
    onClick?.(event);
    if (workspace?.route && !external && !event.defaultPrevented && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && (!target || target === "_self")) {
      event.preventDefault(); navigate(destination, { replace: props.replace, state: props.state });
    }
  }} />;
});
WorkspaceLink.displayName = "WorkspaceLink";
