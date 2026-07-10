import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import PlatformDeveloperToolsPage from "./PlatformDeveloperToolsPage";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let mockUser: any = { role: "employee", isPlatformDeveloper: true, isPlatformAdmin: false };
let mockIsLoading = false;
const mockListConfigurationCopyJobs = jest.fn(async (_limit?: number) => ({
  httpStatus: 200,
  body: {
    success: true,
    data: [
      {
        id: "job-1",
        sourceOrganizationId: "org-source",
        destinationOrganizationId: "org-destination",
        status: "completed",
        entityCounts: { products: 2, materials: 3 },
        warnings: [],
      },
    ],
  },
}));

jest.mock("react-router-dom", () => ({
  Link: ({ to, children }: any) => <a href={typeof to === "string" ? to : String(to)}>{children}</a>,
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, isLoading: mockIsLoading }),
}));

jest.mock("@/pages/not-found", () => ({
  __esModule: true,
  default: () => <div>Not Found</div>,
}));

jest.mock("@/lib/api/platform", () => ({
  listConfigurationCopyJobs: (limit?: number) => mockListConfigurationCopyJobs(limit),
}));

function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(<PlatformDeveloperToolsPage />);
  });
  return { container, root: root! };
}

afterEach(() => {
  document.body.innerHTML = "";
  mockUser = { role: "employee", isPlatformDeveloper: true, isPlatformAdmin: false };
  mockIsLoading = false;
  mockListConfigurationCopyJobs.mockClear();
});

describe("PlatformDeveloperToolsPage visibility", () => {
  test("platform developer sees developer-only cards", () => {
    const { container, root } = renderPage();

    expect(container.textContent).toContain("Platform Developer Tools");
    expect(container.textContent).toContain("Catalog Migration Lab");
    expect(container.textContent).toContain("QB Invoice Inspector");
    expect(container.textContent).toContain("QB Customer Inspector");

    act(() => root.unmount());
  });

  test("platform tools show read-only configuration copy diagnostics", async () => {
    const { container, root } = renderPage();

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockListConfigurationCopyJobs).toHaveBeenCalledWith(8);
    expect(container.textContent).toContain("Organization Configuration Copy Jobs");
    expect(container.textContent).toContain("job-1");
    expect(container.textContent).toContain("products: 2");

    act(() => root.unmount());
  });

  test("platform admin sees platform tools and organization creator", () => {
    mockUser = { role: "admin", isPlatformDeveloper: false, isPlatformAdmin: true };
    const { container, root } = renderPage();

    expect(container.textContent).toContain("Catalog Migration Lab");
    expect(container.textContent).toContain("New Organization");

    act(() => root.unmount());
  });

  test("tenant admin does not see developer-only cards", () => {
    mockUser = { role: "admin", isPlatformDeveloper: false, isPlatformAdmin: false };
    const { container, root } = renderPage();

    expect(container.textContent).toContain("Not Found");
    expect(container.textContent).not.toContain("Catalog Migration Lab");
    expect(container.textContent).not.toContain("QB Invoice Inspector");
    expect(container.textContent).not.toContain("QB Customer Inspector");

    act(() => root.unmount());
  });
});
