import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import PlatformOrgCreatePage from "./PlatformOrgCreatePage";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

let mockUser: any = { role: "admin", isPlatformAdmin: true, isPlatformDeveloper: false };
let mockIsLoading = false;

const mockListPlatformSeedOrganizations = jest.fn(async () => ({
  httpStatus: 200,
  body: {
    success: true,
    data: [
      { id: "org-source", name: "Source Org", slug: "source-org", deleteState: "active", status: "active" },
    ],
  },
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, isLoading: mockIsLoading }),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("@/pages/not-found", () => ({
  __esModule: true,
  default: () => <div>Not Found</div>,
}));

jest.mock("@/lib/api/platform", () => ({
  platformReauth: jest.fn(),
  createPlatformOrg: jest.fn(),
  listPlatformSeedOrganizations: () => mockListPlatformSeedOrganizations(),
  previewConfigurationCopy: jest.fn(),
}));

function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(<PlatformOrgCreatePage />);
  });
  return { container, root: root! };
}

afterEach(() => {
  document.body.innerHTML = "";
  mockUser = { role: "admin", isPlatformAdmin: true, isPlatformDeveloper: false };
  mockIsLoading = false;
  mockListPlatformSeedOrganizations.mockClear();
});

describe("PlatformOrgCreatePage configuration seed controls", () => {
  test("platform admin sees optional seed configuration controls and safe copy notice", () => {
    const { container, root } = renderPage();

    expect(container.textContent).toContain("Create Organization");
    expect(container.textContent).toContain("Seed configuration from an existing organization");
    expect(container.textContent).toContain("Customers, orders, invoices, emails, users, credentials, and production");

    act(() => root.unmount());
  });

  test("non-platform admin cannot access organization creator", () => {
    mockUser = { role: "admin", isPlatformAdmin: false, isPlatformDeveloper: false };
    const { container, root } = renderPage();

    expect(container.textContent).toContain("Not Found");
    expect(container.textContent).not.toContain("Seed configuration from an existing organization");

    act(() => root.unmount());
  });
});
