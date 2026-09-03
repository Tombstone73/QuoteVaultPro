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
    Select: ({ value, onValueChange, children, disabled }: any) => (
      <div data-testid="status-select" data-selected-value={value} data-disabled={disabled ? "true" : "false"}>
        {children}
        <button type="button" data-testid="choose-approved" onClick={() => onValueChange("pill-approved")}>Choose Approved</button>
      </div>
    ),
    SelectTrigger: ({ children, className }: any) => <div className={className}>{children}</div>,
    SelectValue: ({ children }: any) => <div data-testid="status-value">{children}</div>,
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ children, value, disabled }: any) => (
      <div data-pill-id={value} data-disabled={disabled ? "true" : "false"}>{children}</div>
    ),
  };
});

import { OrderStatusPillSelector } from "./OrderStatusPillSelector";

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
    id: "pill-waiting",
    organizationId: "org-1",
    stateScope: "open",
    key: "waiting_on_approval",
    name: "Waiting on Approval",
    color: "#a16207",
    customerVisible: false,
    notificationTriggerEligible: true,
    isDefault: false,
    isActive: true,
    sortOrder: 1,
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
  },
  {
    id: "pill-approved",
    organizationId: "org-1",
    stateScope: "open",
    key: "approved",
    name: "Approved",
    color: "#047857",
    customerVisible: false,
    notificationTriggerEligible: true,
    isDefault: false,
    isActive: true,
    sortOrder: 2,
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
  },
];

function props(overrides: Partial<React.ComponentProps<typeof OrderStatusPillSelector>> = {}) {
  return {
    orderId: "order-1",
    currentState: "open" as const,
    currentPillId: "pill-waiting",
    currentPillValue: "Waiting on Approval",
    ...overrides,
  };
}

describe("OrderStatusPillSelector controlled display", () => {
  beforeEach(() => {
    mockMutate.mockReset();
    mockUseOrderStatusPills.mockReset();
    mockUseAssignOrderStatusPill.mockReset();
    mockUseOrderStatusPills.mockReturnValue({ data: pills, isLoading: false });
    mockUseAssignOrderStatusPill.mockReturnValue({ mutate: mockMutate, isPending: false });
  });

  test("renders a persisted canonical New assignment on Order detail", async () => {
    const { act } = require("react") as typeof import("react");
    const { createRoot } = require("react-dom/client") as typeof import("react-dom/client");
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => root.render(
      <OrderStatusPillSelector {...props({ currentPillId: "pill-new", currentPillValue: "New" })} />,
    ));

    expect(container.querySelector('[data-testid="status-select"]')?.getAttribute("data-selected-value")).toBe("pill-new");
    expect(container.querySelector('[data-testid="status-value"]')?.textContent).toBe("New");
    await act(async () => root.unmount());
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });

  test("shows a successful selection immediately without waiting for a parent remount", async () => {
    const { act } = require("react") as typeof import("react");
    const { createRoot } = require("react-dom/client") as typeof import("react-dom/client");
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => root.render(<OrderStatusPillSelector {...props()} />));
    expect(container.querySelector('[data-testid="status-value"]')?.textContent).toContain("Waiting on Approval");

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="choose-approved"]')?.click();
    });

    expect(mockMutate).toHaveBeenCalledWith("pill-approved", expect.objectContaining({ onError: expect.any(Function) }));
    expect(container.querySelector('[data-testid="status-select"]')?.getAttribute("data-selected-value")).toBe("pill-approved");
    expect(container.querySelector('[data-testid="status-value"]')?.textContent).toBe("Approved");
    expect(container.querySelector('[data-testid="status-value"] [style]')?.getAttribute("style")).toContain("rgb(4, 120, 87)");

    await act(async () => root.unmount());
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });

  test("synchronizes to a changed controlled prop value", async () => {
    const { act } = require("react") as typeof import("react");
    const { createRoot } = require("react-dom/client") as typeof import("react-dom/client");
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => root.render(<OrderStatusPillSelector {...props()} />));
    await act(async () => root.render(<OrderStatusPillSelector {...props({ currentPillId: "pill-approved", currentPillValue: "Approved" })} />));

    expect(container.querySelector('[data-testid="status-select"]')?.getAttribute("data-selected-value")).toBe("pill-approved");
    expect(container.querySelector('[data-testid="status-value"]')?.textContent).toBe("Approved");

    await act(async () => root.unmount());
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });

  test("restores the controlled value when assignment fails", async () => {
    mockMutate.mockImplementation((_value, options: any) => options.onError(new Error("Rejected")));
    const { act } = require("react") as typeof import("react");
    const { createRoot } = require("react-dom/client") as typeof import("react-dom/client");
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => root.render(<OrderStatusPillSelector {...props()} />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="choose-approved"]')?.click();
    });

    expect(container.querySelector('[data-testid="status-value"]')?.textContent).toBe("Waiting on Approval");
    await act(async () => root.unmount());
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });

  test("keeps an assigned inactive pill visible and disabled", async () => {
    const { act } = require("react") as typeof import("react");
    const { createRoot } = require("react-dom/client") as typeof import("react-dom/client");
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => root.render(
      <OrderStatusPillSelector {...props({ currentPillId: "pill-retired", currentPillValue: "Retired Custom" })} />,
    ));

    expect(container.querySelector('[data-testid="status-value"]')?.textContent).toBe("Retired Custom");
    expect(container.querySelector('[data-pill-id="pill-retired"]')?.getAttribute("data-disabled")).toBe("true");
    await act(async () => root.unmount());
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });
});
