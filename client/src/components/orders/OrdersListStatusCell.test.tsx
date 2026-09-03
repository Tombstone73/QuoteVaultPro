import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockMutate = jest.fn();
const mockUseOrderStatusPills = jest.fn();
const mockUseAssignOrderStatusPill = jest.fn();

jest.mock("@/hooks/useOrderStatusPills", () => ({
  useOrderStatusPills: (...args: unknown[]) => mockUseOrderStatusPills(...args),
  useAssignOrderStatusPill: (...args: unknown[]) => mockUseAssignOrderStatusPill(...args),
}));

jest.mock("@/components/ui/select", () => {
  const React = require("react") as typeof import("react");
  return {
    Select: ({ value, onValueChange, children }: any) => (
      <div data-testid="status-select" data-selected-value={value}>
        {children}
        <button type="button" data-testid="choose-picked-up" onClick={() => onValueChange("pill-picked-up")}>Choose Picked Up</button>
      </div>
    ),
    SelectTrigger: ({ children }: any) => <div>{children}</div>,
    SelectValue: ({ children }: any) => <div data-testid="status-value">{children}</div>,
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ children, value }: any) => <div data-pill-id={value}>{children}</div>,
  };
});

import { OrdersListStatusCell } from "./OrdersListStatusCell";

const pills = [
  {
    id: "pill-new",
    organizationId: "org-1",
    stateScope: "open",
    key: "new",
    name: "New",
    color: "#2563eb",
    customerVisible: false,
    notificationTriggerEligible: true,
    isDefault: true,
    isActive: true,
    sortOrder: 0,
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
  },
  {
    id: "pill-design-needed",
    organizationId: "org-1",
    stateScope: "open",
    key: "design_needed",
    name: "Design Needed",
    color: "#b45309",
    customerVisible: false,
    notificationTriggerEligible: true,
    isDefault: false,
    isActive: true,
    sortOrder: 1,
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
  },
  {
    id: "pill-picked-up",
    organizationId: "org-1",
    stateScope: "production_complete",
    key: "picked_up",
    name: "Picked Up",
    color: "#0369a1",
    customerVisible: false,
    notificationTriggerEligible: true,
    isDefault: false,
    isActive: true,
    sortOrder: 2,
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
  },
];

const row = {
  id: "order-20000",
  state: "open",
  statusPillId: "pill-design-needed",
  statusPillValue: "Design Needed",
};

async function renderCell(currentRow = row) {
  const { act } = require("react") as typeof import("react");
  const { createRoot } = require("react-dom/client") as typeof import("react-dom/client");
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<OrdersListStatusCell row={currentRow} />));
  return { act, container, root };
}

describe("Orders list status cell", () => {
  beforeEach(() => {
    mockMutate.mockReset();
    mockUseOrderStatusPills.mockReturnValue({ data: pills, isLoading: false });
    mockUseAssignOrderStatusPill.mockReturnValue({ mutate: mockMutate, isPending: false });
  });

  test("renders a persisted canonical New assignment in the Orders list", async () => {
    const { act, container, root } = await renderCell({
      id: "order-new",
      state: "open",
      statusPillId: "pill-new",
      statusPillValue: "New",
    });

    expect(container.querySelector('[data-testid="status-select"]')?.getAttribute("data-selected-value")).toBe("pill-new");
    expect(container.querySelector('[data-testid="status-value"]')?.textContent).toBe("New");
    await act(async () => root.unmount());
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });

  test("shows Picked Up immediately after successful assignment without remounting the row", async () => {
    mockMutate.mockImplementation((_value, options: any) => options.onSuccess({
      data: { id: row.id, statusPillId: "pill-picked-up", statusPillValue: "Picked Up" },
      statusPill: { id: "pill-picked-up", key: "picked_up", name: "Picked Up", color: "#0369a1" },
    }));
    const { act, container, root } = await renderCell();

    expect(container.querySelector('[data-testid="status-value"]')?.textContent).toContain("Design Needed");
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="choose-picked-up"]')?.click());

    expect(container.querySelector('[data-testid="status-select"]')?.getAttribute("data-selected-value")).toBe("pill-picked-up");
    expect(container.querySelector('[data-testid="status-value"]')?.textContent).toBe("Picked Up");
    expect(container.querySelector('[data-testid="status-value"] [style]')?.getAttribute("style")).toContain("rgb(3, 105, 161)");

    await act(async () => root.unmount());
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });

  test("rolls the visible row back to Design Needed when assignment fails", async () => {
    mockMutate.mockImplementation((_value, options: any) => options.onError(new Error("Rejected")));
    const { act, container, root } = await renderCell();

    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="choose-picked-up"]')?.click());

    expect(container.querySelector('[data-testid="status-select"]')?.getAttribute("data-selected-value")).toBe("pill-design-needed");
    expect(container.querySelector('[data-testid="status-value"]')?.textContent).toBe("Design Needed");

    await act(async () => root.unmount());
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });
});
