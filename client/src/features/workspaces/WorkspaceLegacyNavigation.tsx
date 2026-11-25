import type { ReactNode } from "react";
import { createPath } from "react-router-dom";
import { Router } from "wouter";
import type { BrowserLocationHook } from "wouter/use-browser-location";
import { useWorkspaceLocation, useWorkspaceNavigate } from "@/contexts/WorkspaceContext";

const useLegacyLocation: BrowserLocationHook = () => {
  const location = useWorkspaceLocation();
  const navigate = useWorkspaceNavigate();
  return [location.pathname, (to, { replace, state } = {}) => {
    const origin = window.location.origin;
    const target = new URL(to, new URL(createPath(location), origin));
    if (target.origin === origin) void navigate(createPath(target), { replace, state });
  }];
};

function useLegacySearch() {
  return useWorkspaceLocation().search;
}

/** Older Wouter consumers share the owning workspace route and navigation. */
export function WorkspaceLegacyNavigation({ children }: { children: ReactNode }) {
  return <Router hook={useLegacyLocation} searchHook={useLegacySearch}>{children}</Router>;
}
