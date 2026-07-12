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
const mockListPlatformSeedOrganizations = jest.fn(async () => ({
  httpStatus: 200,
  body: {
    success: true,
    data: [
      {
        id: "org-1",
        name: "Titan Graphics",
        slug: "titan-graphics",
        status: "active",
        deleteState: "active",
        isArchived: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  },
}));
const mockUpdatePlatformOrganization = jest.fn(async (_organizationId?: string, _payload?: any) => ({
  httpStatus: 200,
  body: {
    success: true,
    data: {
      id: "org-1",
      name: "Titan Graphics Archive",
      slug: "titan-graphics-archive",
      status: "active",
      deleteState: "active",
      isArchived: true,
    },
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
  listPlatformSeedOrganizations: () => mockListPlatformSeedOrganizations(),
  updatePlatformOrganization: (organizationId: string, payload: any) => mockUpdatePlatformOrganization(organizationId, payload),
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
  mockListPlatformSeedOrganizations.mockClear();
  mockUpdatePlatformOrganization.mockClear();
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

  test("platform tools show organizations list and edit action", async () => {
    const { container, root } = renderPage();

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockListPlatformSeedOrganizations).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Organizations");
    expect(container.textContent).toContain("Titan Graphics");
    expect(container.textContent).toContain("titan-graphics");

    const editButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Edit");
    expect(editButton).toBeTruthy();

    act(() => {
      editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Edit organization");
    expect((container.querySelector("input[value='Titan Graphics']") as HTMLInputElement | null)?.value).toBe("Titan Graphics");

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
