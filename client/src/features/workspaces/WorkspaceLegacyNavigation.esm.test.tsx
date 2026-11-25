import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, jest, test } from "@jest/globals";
import { Link as LegacyLink, useLocation, useRoute, useSearch } from "wouter";
import { MemoryRouter, useLocation as useRouterLocation } from "react-router-dom";
import { WorkspaceBoundary, type WorkspaceNavigation } from "@/contexts/WorkspaceContext";
import { WorkspaceLegacyNavigation } from "./WorkspaceLegacyNavigation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function VendorWorkspace() {
  const [location, navigate] = useLocation();
  const [, params] = useRoute("/vendors/:id");
  const search = useSearch();
  const current = useRouterLocation();
  return <>
    <output>{location}:{params?.id}:{search}</output>
    <output>{current.pathname}</output>
    <LegacyLink href="another?from=legacy">Open another vendor</LegacyLink>
    <button onClick={() => navigate(`${window.location.origin}/purchase-orders/new?vendorId=${params?.id}#details`, {
      replace: true,
      state: { source: "vendor" },
    })}>Open purchase order</button>
  </>;
}

test("legacy record matching and navigation use the retained workspace route instead of the global URL", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const navigateOwner = jest.fn<WorkspaceNavigation>();
  try {
    act(() => root.render(<MemoryRouter initialEntries={["/settings/integrations?outside=yes"]}>
      <WorkspaceBoundary workspaceId="vendor" route={{
        location: { pathname: "/vendors/paper-vendor", search: "?tab=orders", hash: "", state: null, key: "vendor" },
        params: { id: "paper-vendor" },
      }} onNavigate={navigateOwner}>
        <WorkspaceLegacyNavigation><VendorWorkspace /></WorkspaceLegacyNavigation>
      </WorkspaceBoundary>
    </MemoryRouter>));
    expect(host.querySelector("output")?.textContent).toBe("/vendors/paper-vendor:paper-vendor:tab=orders");
    const outside = host.querySelectorAll("output")[1];
    expect(outside.textContent).toBe("/settings/integrations");
    act(() => host.querySelector("a")!.click());
    expect(navigateOwner).toHaveBeenLastCalledWith("/vendors/another?from=legacy", { replace: undefined, state: undefined });
    act(() => host.querySelector("button")!.click());
    expect(navigateOwner).toHaveBeenLastCalledWith("/purchase-orders/new?vendorId=paper-vendor#details", {
      replace: true,
      state: { source: "vendor" },
    });
    expect(outside.textContent).toBe("/settings/integrations");
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
