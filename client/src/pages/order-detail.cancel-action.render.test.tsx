import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { TextDecoder, TextEncoder } from "util";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;

const { MemoryRouter, Route, Routes } = require("react-router-dom") as typeof import("react-router-dom");
const OrderDetail = require("./order-detail").default as typeof import("./order-detail").default;

let mockUser: any = { role: "admin", isAdmin: true };
let mockOrder: any;
let mockOrgMemberships: any = {
  success: true,
  data: {
    orgs: [{ id: "org-1", name: "Acme", slug: "acme", role: "admin" }],
    lastActiveOrgId: "org-1",
  },
};
let latestLineItemsProps: any = null;
let mockEligibility: any = { canCancel: true, code: null, message: null, details: null };
const mockCancelOrder = jest.fn(async () => ({ success: true }));
const mockInvalidateQueries = jest.fn();
const mockRefetchQueries = jest.fn();

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
    refetchQueries: mockRefetchQueries,
    setQueryData: jest.fn(),
  }),
  useMutation: () => ({
    mutate: jest.fn(),
    mutateAsync: jest.fn(async () => ({})),
    isPending: false,
  }),
  useQuery: (options: any) => ({
    data: String(options?.queryKey?.[0] ?? "").includes("/api/me/orgs") ? mockOrgMemberships : [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: jest.fn(async () => ({ data: [] })),
  }),
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, isAuthenticated: true, isLoading: false }),
}));

jest.mock("@/lib/apiConfig", () => ({
  getApiUrl: (path: string) => path,
}));

jest.mock("@/lib/api/me", () => ({
  fetchMyOrgs: jest.fn(),
}));

jest.mock("@/hooks/useOrgPreferences", () => ({
  useOrgPreferences: () => ({ preferences: { inventory: { reservations: { mode: "off" } }, orders: {} } }),
}));

jest.mock("@/hooks/useOrders", () => ({
  useOrder: () => ({ data: mockOrder, isLoading: false }),
  useCancelOrder: () => ({ mutateAsync: mockCancelOrder, isPending: false }),
  useDeleteOrder: () => ({ mutateAsync: jest.fn(async () => ({})), isPending: false }),
  useUpdateOrder: () => ({ mutateAsync: jest.fn(async () => ({})), isPending: false }),
  useBulkUpdateOrderLineItemStatus: () => ({ mutateAsync: jest.fn(async () => ({})), isPending: false }),
  useTransitionOrderStatus: () => ({ mutateAsync: jest.fn(async () => ({})), isPending: false }),
  useOrderWorkflow: () => ({ data: { statuses: [], transitions: [] }, isLoading: false }),
  useOrderCancellationEligibility: () => ({
    data: mockEligibility,
    isLoading: false,
    isError: false,
  }),
  getAllowedNextStatuses: (status: string) => (status === "completed" || status === "canceled" ? [] : ["completed", "canceled"]),
  isOrderEditable: (status: string) => status !== "completed" && status !== "canceled",
}));

jest.mock("@/hooks/useInvoices", () => ({
  useInvoices: () => ({ data: [], isLoading: false }),
  useCreateOrderInvoice: () => ({ mutateAsync: jest.fn(async () => ({ data: { id: "invoice-1" } })), isPending: false }),
  useBillInvoice: () => ({ mutateAsync: jest.fn(async () => ({})), isPending: false }),
}));

jest.mock("@/hooks/useShipments", () => ({
  useShipments: () => ({ data: [], isLoading: false }),
  useDeleteShipment: () => ({ mutateAsync: jest.fn(async () => ({})), isPending: false }),
  useUpdateShipment: () => ({ mutateAsync: jest.fn(async () => ({})), isPending: false }),
  useGeneratePackingSlip: () => ({ mutateAsync: jest.fn(async () => ({})), isPending: false }),
  useSendShipmentEmail: () => ({ mutate: jest.fn(), isPending: false }),
  useUpdateFulfillmentStatus: () => ({ mutateAsync: jest.fn(async () => ({})), isPending: false }),
}));

jest.mock("@/hooks/useOrderState", () => ({
  isTerminalState: (state: string) => state === "closed" || state === "canceled",
  useCloseOrder: () => ({ mutateAsync: jest.fn(async () => ({})), isPending: false }),
  useCompleteOrder: () => ({ mutateAsync: jest.fn(async () => ({})), isPending: false }),
}));

jest.mock("@/hooks/usePaymentOrchestrator", () => ({
  useOrderPaymentResolution: () => ({
    data: { resolutionStatus: "NO_INVOICE", invoiceCandidates: [], selectedInvoice: null, blockedReason: null },
    isLoading: false,
    refetch: jest.fn(async () => ({ data: { resolutionStatus: "NO_INVOICE", invoiceCandidates: [] } })),
  }),
}));

jest.mock("@/lib/paymentResolutionUi", () => ({
  getOrderBillingActionState: () => ({
    canCreateInvoice: false,
    canTakePayment: false,
    takePaymentLabel: "Take Payment",
    takePaymentHelp: null,
  }),
}));

jest.mock("@/contexts/NavigationGuardContext", () => ({
  useNavigationGuard: () => ({
    registerGuard: jest.fn(() => jest.fn()),
    guardedNavigate: jest.fn(),
    getGuardDiagnostics: jest.fn(() => ({ registeredGuardCount: 0, guards: [], activeGuardLabels: [] })),
  }),
}));

jest.mock("@/hooks/useSmartBack", () => ({
  useSmartBack: () => ({ onSmartBack: jest.fn() }),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("@/lib/nav/browserRouterSync", () => ({
  notifyBrowserRouterOfCurrentUrlSoon: jest.fn(),
  recoverBrowserRouterMismatchSoon: jest.fn(),
}));

jest.mock("@/components/OrderStatusPillSelector", () => ({
  OrderStatusPillSelector: () => <div data-testid="status-pill">Status</div>,
}));

jest.mock("@/components/StateTransitionButtons", () => ({
  CloseOrderButton: () => <span>Close Order</span>,
  ReopenOrderButton: () => <span>Reopen Order</span>,
  CompleteProductionButton: () => <span>Complete Production</span>,
  CompleteOrderButton: () => <span>Complete Order</span>,
}));

jest.mock("@/components/orders/OrderLineItemsSection", () => ({
  OrderLineItemsSection: React.forwardRef((_props: any, ref: any) => {
    latestLineItemsProps = _props;
    React.useImperativeHandle(ref, () => ({
      saveExpandedLineItemIfDirty: jest.fn(async () => ({ saved: false })),
      getDirtyDiagnostics: jest.fn(() => ({})),
    }));
    return <div data-testid="line-items">Line items</div>;
  }),
}));

jest.mock("@/components/BackNavControls", () => ({
  __esModule: true,
  default: () => <button type="button">Back</button>,
}));

jest.mock("@/components/OrderAttachmentsPanel", () => ({
  OrderAttachmentsPanel: () => <div>Attachments</div>,
}));

jest.mock("@/components/TimelinePanel", () => ({
  TimelinePanel: () => <div>Timeline</div>,
}));

jest.mock("@/components/orders/ManualReservationsCard", () => ({
  ManualReservationsCard: () => <div>Manual reservations</div>,
}));

jest.mock("@/components/CustomerSelect", () => ({
  CustomerSelect: () => <div>Customer select</div>,
}));

jest.mock("@/components/order-status-badge", () => ({
  OrderStatusBadge: ({ status }: any) => <span>{status}</span>,
  OrderPriorityBadge: ({ priority }: any) => <span>{priority}</span>,
  LineItemStatusBadge: ({ status }: any) => <span>{status}</span>,
}));

jest.mock("@/components/FulfillmentStatusBadge", () => ({
  FulfillmentStatusBadge: ({ status }: any) => <span>{status}</span>,
}));

jest.mock("@/components/ShipmentForm", () => ({
  ShipmentForm: () => null,
}));

jest.mock("@/components/PackingSlipModal", () => ({
  PackingSlipModal: () => null,
}));

jest.mock("@/components/production/PrintTicketButton", () => ({
  PrintTicketButton: () => null,
}));

jest.mock("@/features/orders/components/OrderRecipientFallbackDialog", () => ({
  OrderRecipientFallbackDialog: () => null,
}));

jest.mock("@/lib/authenticatedPdfPreview", () => ({
  downloadAuthenticatedPdf: jest.fn(),
  openAuthenticatedPdfForPrint: jest.fn(),
  openAuthenticatedPdfPreview: jest.fn(),
}));

jest.mock("@/lib/queryClient", () => ({
  apiFetch: jest.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })),
}));

function baseOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    orderNumber: "PH-1001",
    displayNumber: "PH-1001",
    state: "open",
    status: "new",
    statusPillId: null,
    statusPillValue: null,
    workflowStatusId: null,
    priority: "normal",
    customerId: "customer-1",
    customer: { id: "customer-1", name: "Acme Co", email: "ops@example.com", phone: "555-1000" },
    contact: null,
    lineItems: [],
    subtotal: "0.00",
    discount: "0.00",
    tax: "0.00",
    total: "0.00",
    shippingCents: 0,
    fulfillmentStatus: "pending",
    routingTarget: null,
    billingStatus: "not_ready",
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
    canceledAt: null,
    cancellationReason: null,
    cancellationNotes: null,
    ...overrides,
  };
}

function renderOrderDetail(path = "/orders/order-1/edit") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/orders/:id/edit" element={<OrderDetail />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return { container, root: root! };
}

afterEach(() => {
  document.body.innerHTML = "";
  jest.clearAllMocks();
  mockUser = { role: "admin", isAdmin: true };
  mockOrgMemberships = {
    success: true,
    data: {
      orgs: [{ id: "org-1", name: "Acme", slug: "acme", role: "admin" }],
      lastActiveOrgId: "org-1",
    },
  };
  latestLineItemsProps = null;
  mockEligibility = { canCancel: true, code: null, message: null, details: null };
});

describe("OrderDetail cancellation action rendering", () => {
  test("uses the active organization Admin role for saved-line editing", () => {
    mockOrder = baseOrder();
    mockUser = { role: "employee", isAdmin: false };
    mockOrgMemberships = {
      success: true,
      data: {
        orgs: [{ id: "org-1", name: "Acme", slug: "acme", role: "admin" }],
        lastActiveOrgId: "org-1",
      },
    };

    const { root } = renderOrderDetail();

    expect(latestLineItemsProps?.readOnly).toBe(false);
    act(() => root.unmount());
  });

  test("uses the active organization Owner role for saved-line editing", () => {
    mockOrder = baseOrder();
    mockUser = { role: "employee", isAdmin: false };
    mockOrgMemberships = {
      success: true,
      data: {
        orgs: [{ id: "org-1", name: "Acme", slug: "acme", role: "owner" }],
        lastActiveOrgId: "org-1",
      },
    };

    const { root } = renderOrderDetail();

    expect(latestLineItemsProps?.readOnly).toBe(false);
    act(() => root.unmount());
  });

  test("does not treat a member as an Order pricing Admin from a global user role", () => {
    mockOrder = baseOrder();
    mockUser = { role: "admin", isAdmin: true };
    mockOrgMemberships = {
      success: true,
      data: {
        orgs: [{ id: "org-1", name: "Acme", slug: "acme", role: "member" }],
        lastActiveOrgId: "org-1",
      },
    };

    const { root } = renderOrderDetail();

    expect(latestLineItemsProps?.readOnly).toBe(true);
    act(() => root.unmount());
  });

  test("renders Cancel Order for a cancellable saved order on the actual detail page", () => {
    mockOrder = baseOrder();

    const { container, root } = renderOrderDetail();

    expect(container.textContent).toContain("Save Order");
    expect(container.textContent).toContain("Save & Route Jobs");
    expect(container.textContent).toContain("Cancel Order");

    act(() => root.unmount());
  });

  test("renders Cancel Order for Admin and Owner users", () => {
    mockOrder = baseOrder();
    mockUser = { role: "admin", isAdmin: true };
    let rendered = renderOrderDetail();
    expect(rendered.container.textContent).toContain("Cancel Order");
    act(() => rendered.root.unmount());

    document.body.innerHTML = "";
    mockUser = { role: "owner", isAdmin: true };
    rendered = renderOrderDetail();
    expect(rendered.container.textContent).toContain("Cancel Order");
    act(() => rendered.root.unmount());
  });

  test("renders blocked non-canceled cancellation with the backend reason", () => {
    mockOrder = baseOrder();
    mockEligibility = {
      canCancel: false,
      code: "PARTIALLY_PAID_INVOICE",
      message: "Cannot cancel because payment has been recorded.",
      details: null,
    };

    const { container, root } = renderOrderDetail();
    const button = Array.from(container.querySelectorAll("button")).find((node) => node.textContent?.includes("Cancel Order"));

    expect(button).toBeTruthy();
    expect(button).toHaveProperty("disabled", true);
    expect(container.textContent).toContain("Cannot cancel because payment has been recorded.");

    act(() => root.unmount());
  });

  test("does not offer a second active cancellation for an already canceled order", () => {
    mockOrder = baseOrder({
      state: "canceled",
      status: "canceled",
      canceledAt: "2026-08-02T12:00:00.000Z",
      cancellationReason: "customer_requested",
      cancellationNotes: "Customer requested cancellation.",
    });

    const { container, root } = renderOrderDetail("/orders/order-1");

    expect(container.textContent).toContain("Cancelled order");
    expect(Array.from(container.querySelectorAll("button")).some((node) => node.textContent?.includes("Cancel Order"))).toBe(false);

    act(() => root.unmount());
  });

  test("clicking enabled Cancel Order opens the cancellation dialog", () => {
    mockOrder = baseOrder();

    const { container, root } = renderOrderDetail();
    const button = Array.from(container.querySelectorAll("button")).find((node) => node.textContent?.includes("Cancel Order"));
    expect(button).toBeTruthy();

    act(() => {
      (button as HTMLButtonElement | undefined)?.click();
    });

    expect(document.body.textContent).toContain("Cancellation is permanent for normal operations.");
    expect(document.body.textContent).toContain("Keep Order Active");

    act(() => root.unmount());
  });

  test("successful cancellation submits through the existing mutation and invalidation path", async () => {
    mockOrder = baseOrder();

    const { container, root } = renderOrderDetail();
    const button = Array.from(container.querySelectorAll("button")).find((node) => node.textContent?.includes("Cancel Order"));
    act(() => {
      (button as HTMLButtonElement | undefined)?.click();
    });
    const dialogButton = Array.from(document.body.querySelectorAll("button")).filter((node) => node.textContent?.includes("Cancel Order")).at(-1);

    await act(async () => {
      (dialogButton as HTMLButtonElement | undefined)?.click();
    });

    expect(mockCancelOrder).toHaveBeenCalledWith({ reason: "customer_requested", internalNote: undefined });

    act(() => root.unmount());
  });
});
