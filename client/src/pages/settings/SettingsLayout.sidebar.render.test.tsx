import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { SettingsLayout } from "./SettingsLayout";

let mockLocationPath = "/settings/company";

jest.mock("react-router-dom", () => ({
  Link: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a>,
  NavLink: ({ to, children, ...props }: any) => <a href={to} {...props} onClick={(event) => { event.preventDefault(); mockLocationPath = to; }}>{children}</a>,
  Outlet: () => <div>{
    mockLocationPath === "/settings/customer-portal" ? "Customer Portal route content"
      : mockLocationPath === "/settings/users" ? "Users route content"
        : mockLocationPath === "/settings/integrations" ? "Accounting route content"
          : mockLocationPath === "/settings/integrations/quickbooks-sync-queue" ? "QuickBooks Sync Console route content"
            : "Company route content"
  }</div>,
  useLocation: () => ({ pathname: mockLocationPath, hash: "" }),
  useNavigate: () => (destination: string) => { mockLocationPath = destination; },
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "owner-1" }, isLoading: false }),
}));

jest.mock("@/lib/api/me", () => ({ fetchMyOrgs: jest.fn() }));
jest.mock("@/lib/apiConfig", () => ({ getApiUrl: (path: string) => path }));

jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  useQuery: () => ({
    data: { data: { orgs: [{ id: "org-1", role: "owner" }], lastActiveOrgId: "org-1" } },
    isLoading: false,
  }),
}));

jest.mock("@/components/titan", () => ({
  TitanCard: ({ children, className, ...props }: any) => <section className={className} {...props}>{children}</section>,
  PageHeader: ({ title, subtitle }: any) => <header><h1>{title}</h1><p>{subtitle}</p></header>,
}));

jest.mock("@/features/materials/MaterialsSettingsPanel", () => ({ MaterialsSettingsPanel: () => null }));
jest.mock("@/components/production/StationStepEditor", () => ({ StationStepEditor: () => null }));
jest.mock("@/components/job-status-settings", () => ({ JobStatusSettings: () => null }));
jest.mock("@/components/admin-settings", () => ({ InvoiceRemindersTab: () => null }));
jest.mock("@/components/settings/CompanyInfoInvoiceBrandingCard", () => ({ CompanyInfoInvoiceBrandingCard: () => null }));
jest.mock("@/components/settings/OrderWorkflowStatusSettings", () => ({
  OrderStatusPillSettings: () => null,
  WorkflowStatusAutomationSettings: () => null,
}));

let container: HTMLDivElement;
let root: Root;

function renderSettings(initialEntry = "/settings/company") {
  mockLocationPath = initialEntry;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<SettingsLayout />);
  });
}

function clickByLabel(label: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(button).toBeTruthy();
  act(() => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function navigateByLabel(label: string, expectedContent: string) {
  const link = Array.from(container.querySelectorAll("a")).find((candidate) => candidate.textContent === label);
  expect(link).toBeTruthy();
  act(() => link?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  act(() => root.render(<SettingsLayout />));
  expect(container.textContent).toContain(expectedContent);
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
});

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  document.body.innerHTML = "";
  jest.clearAllMocks();
});

test("Settings navigation starts expanded, collapses at desktop width, and preserves the preference across navigation and remount", () => {
  renderSettings();

  expect(container.querySelector('[data-testid="settings-content-grid"]')?.className).toContain("lg:grid-cols-[260px_minmax(0,1fr)]");
  expect(container.textContent).toContain("Company");
  clickByLabel("Collapse settings navigation");

  expect(window.localStorage.getItem("printershero:v1:settings-sidebar-collapsed")).toBe("true");
  expect(container.querySelector('[data-testid="settings-content-grid"]')?.className).toContain("lg:grid-cols-[52px_minmax(0,1fr)]");
  expect(container.querySelector('[data-testid="settings-secondary-nav"]')?.className).toContain("lg:p-2");
  expect(container.querySelector('button[aria-label="Expand settings navigation"]')).toBeTruthy();

  navigateByLabel("Customer Portal", "Customer Portal route content");
  expect(container.querySelector('[data-testid="settings-content-grid"]')?.className).toContain("lg:grid-cols-[52px_minmax(0,1fr)]");
  navigateByLabel("Users & Roles", "Users route content");
  navigateByLabel("Accounting & Integrations", "Accounting route content");
  expect(container.querySelector('[data-testid="settings-content-grid"]')?.className).toContain("lg:grid-cols-[52px_minmax(0,1fr)]");

  act(() => root.unmount());
  container.remove();
  renderSettings("/settings/integrations/quickbooks-sync-queue");
  expect(container.textContent).toContain("QuickBooks Sync Console route content");
  expect(container.querySelector('[data-testid="settings-content-grid"]')?.className).toContain("lg:grid-cols-[52px_minmax(0,1fr)]");

  clickByLabel("Expand settings navigation");
  expect(window.localStorage.getItem("printershero:v1:settings-sidebar-collapsed")).toBe("false");
  expect(container.querySelector('[data-testid="settings-content-grid"]')?.className).toContain("lg:grid-cols-[260px_minmax(0,1fr)]");
});

test("the desktop collapse control leaves the normal secondary navigation available at narrow widths", () => {
  renderSettings();
  clickByLabel("Collapse settings navigation");

  expect(container.querySelector('[data-testid="settings-secondary-nav"] input[aria-label="Search settings"]')).toBeTruthy();
  expect(container.querySelector('[data-testid="settings-secondary-nav"]')?.className).toContain("lg:p-2");
  expect(container.querySelector('[data-testid="settings-content-grid"]')?.className).toContain("grid-cols-1");
});
