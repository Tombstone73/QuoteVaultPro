import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, expect, jest, test } from "@jest/globals";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { PortalSessionDto } from "@/hooks/usePortal";
import { workspaceStorageKey } from "@/features/workspaces/workspacePersistence";

type Session = Pick<PortalSessionDto, "userId" | "customerId" | "customerName" | "staffPreview" | "developerImpersonation">;
const customerSession: Session = {
  userId: "portal-user",
  customerId: "customer-one",
  customerName: "Customer One",
  staffPreview: null,
  developerImpersonation: null,
};
let session: Session | undefined;

jest.unstable_mockModule("@/hooks/usePortal", () => ({ usePortalSession: () => ({ data: session }) }));
jest.unstable_mockModule("@/hooks/useTheme", () => ({ applyThemeClass: jest.fn(), useTheme: () => ({ theme: "light" }) }));
jest.unstable_mockModule("@/components/layout/NotificationArea", () => ({ NotificationArea: () => null }));
jest.unstable_mockModule("@/lib/apiConfig", () => ({ getApiUrl: (path: string) => path }));
jest.unstable_mockModule("@/lib/queryClient", () => ({ apiFetch: jest.fn(), apiRequest: jest.fn() }));
let PortalLayout: typeof import("./PortalLayout").PortalLayout;
beforeAll(async () => { ({ PortalLayout } = await import("./PortalLayout")); });

function PortalPage() {
  const { pathname, search } = useLocation();
  return <>
    <output>{pathname}{search}</output>
    <Link to="/portal/orders/order-one">Open first order</Link>
    <Link to="/portal/orders/order-two">Open second order</Link>
  </>;
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let queryClient: QueryClient;

function renderPortal(pathname: string) {
  act(() => root.render(<QueryClientProvider client={queryClient}>
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route path="/portal" element={<PortalLayout />}>
          <Route index element={<PortalPage />} />
          <Route path="orders/:id" element={<PortalPage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>));
}

function selectedTab() {
  const tab = host.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
  expect(tab).not.toBeNull();
  return tab!;
}

function selectedPage() {
  const panelId = selectedTab().getAttribute("aria-controls");
  const panel = host.querySelector<HTMLElement>(`[role="tabpanel"][id="${panelId}"]`);
  expect(panel?.hidden).toBe(false);
  return panel!;
}

function clickLink(label: string) {
  const link = Array.from(selectedPage().querySelectorAll("a")).find(candidate => candidate.textContent === label);
  expect(link).toBeDefined();
  act(() => link!.click());
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Element.prototype.scrollIntoView = jest.fn();
  window.scrollTo = jest.fn();
  let sequence = 0;
  Object.defineProperty(crypto, "randomUUID", {
    configurable: true,
    value: () => `00000000-0000-0000-0000-${String(++sequence).padStart(12, "0")}`,
  });
  session = customerSession;
  queryClient = new QueryClient();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  localStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  queryClient.clear();
  jest.restoreAllMocks();
});

test("a direct customer portal link has a visible, selected workspace without staff editor actions", () => {
  renderPortal("/portal/orders/order-one?view=tracking");
  expect(selectedPage().querySelector("output")?.textContent).toBe("/portal/orders/order-one?view=tracking");
  expect(host.querySelector('[aria-label="New Order"]')).toBeNull();
  expect(host.querySelector('[aria-label="New Quote"]')).toBeNull();
  const key = workspaceStorageKey({ kind: "portal", userId: customerSession.userId, customerId: customerSession.customerId });
  expect(localStorage.getItem(key)).toContain("/portal/orders/order-one");
  expect(localStorage.getItem(key)).not.toContain("view=tracking");
});

test("portal records get independent reusable tabs, and the final close opens the portal dashboard", () => {
  renderPortal("/portal/orders/order-one");
  const firstTabId = selectedTab().id;
  clickLink("Open second order");
  const secondTabId = selectedTab().id;
  expect(secondTabId).not.toBe(firstTabId);
  expect(selectedPage().querySelector("output")?.textContent).toBe("/portal/orders/order-two");
  clickLink("Open first order");
  expect(selectedTab().id).toBe(firstTabId);
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2);
  act(() => host.querySelector<HTMLButtonElement>(`[id="${secondTabId}"]`)!.click());
  expect(selectedPage().querySelector("output")?.textContent).toBe("/portal/orders/order-two");
  const closeActive = () => act(() => selectedTab().parentElement!.querySelector<HTMLButtonElement>('button[aria-label^="Close "]')!.click());
  closeActive();
  expect(selectedTab().id).toBe(firstTabId);
  closeActive();
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1);
  expect(selectedPage().querySelector("output")?.textContent).toBe("/portal");
});

test("customer changes reset the workspace and staff preview sessions do not persist portal tabs", () => {
  renderPortal("/portal/orders/order-one");
  clickLink("Open second order");
  const originalTabId = selectedTab().id;
  session = { ...customerSession, customerId: "customer-two" };
  renderPortal("/portal/orders/order-one");
  expect(selectedTab().id).not.toBe(originalTabId);
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1);

  session = {
    ...customerSession,
    customerId: "preview-customer",
    staffPreview: { active: true, actorUserId: "staff", canExecutePayments: false, startedAt: "2030-03-01", expiresAt: "2030-03-02", returnTo: "/customers" },
  };
  renderPortal("/portal/orders/order-one");
  expect(selectedPage().querySelector("output")?.textContent).toBe("/portal/orders/order-two");
  expect(localStorage.getItem(workspaceStorageKey({ kind: "portal", userId: session.userId, customerId: session.customerId }))).toBeNull();
});
