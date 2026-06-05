import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import AdminTools from "./admin-tools";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("react-router-dom", () => ({
  Link: ({ to, children }: any) => <a href={typeof to === "string" ? to : String(to)}>{children}</a>,
}));

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
  useQuery: () => ({
    data: { id: "org_1", slug: "tenant", name: "Tenant Org" },
    isLoading: false,
  }),
  useMutation: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("@/components/DestructiveActionModal", () => ({
  DestructiveActionModal: () => null,
}));

function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(<AdminTools />);
  });
  return { container, root: root! };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AdminTools operator/developer separation", () => {
  test("keeps operator-facing import/export tools and omits developer inspectors", () => {
    const { container, root } = renderPage();

    expect(container.textContent).toContain("Products");
    expect(container.textContent).toContain("Materials");
    expect(container.textContent).toContain("Manage Products Data");
    expect(container.textContent).toContain("Manage Materials Data");
    expect(container.textContent).not.toContain("Product Planning");
    expect(container.textContent).not.toContain("Bug Reports");
    expect(container.textContent).not.toContain("Catalog Migration Lab");
    expect(container.textContent).not.toContain("QB Invoice Inspector");
    expect(container.textContent).not.toContain("QB Customer Inspector");
    expect(container.textContent).not.toContain("Developer Tools");

    act(() => root.unmount());
  });
});
