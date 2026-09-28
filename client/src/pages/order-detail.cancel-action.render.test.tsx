import React, { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { TextDecoder, TextEncoder } from "util";
import { deriveOrderPaymentSummary } from "@shared/orderPaymentSummary";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;
(globalThis as any).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView = jest.fn();

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
const mockUpdateOwner = jest.fn();
const mockOwnerToast = jest.fn();
const mockPickerQueries: any[] = [];
const mockPickerContacts = [
  { id: "contact-a", customerId: "customer-1", firstName: "Alex", lastName: "Able", linkedCustomers: [{ id: "customer-1", status: "active" }] },
  { id: "contact-janet", customerId: "customer-2", firstName: "Janet", lastName: "Smith", linkedCustomers: [{ id: "customer-2", status: "active" }] },
  { id: "contact-standalone", customerId: null, firstName: "Sam", lastName: "Solo", linkedCustomers: [] },
];

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
    data: options?.queryKey?.[1] === "picker"
      ? (mockPickerQueries.push(options), mockPickerContacts)
      : String(options?.queryKey?.[0] ?? "").includes("/api/me/orgs") ? mockOrgMemberships : [],
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
  useUpdateOrder: () => ({ mutate: mockUpdateOwner, mutateAsync: jest.fn(async () => ({})), isPending: false }),
  useUpdateOrderTaxTreatment: () => ({ mutateAsync: jest.fn(async () => ({})), isPending: false }),
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
  useToast: () => ({ toast: mockOwnerToast }),
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
  OrderStatusBadge: (jest.requireActual("@/components/order-status-badge") as any).OrderStatusBadge,
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

describe("Order canonical payment display", () => {
  const paidInvoice = (totalCents: number, paidCents: number) => ({
    totalCents, status: 'billed', payments: [{ id: 'payment', status: 'succeeded', amountCents: paidCents }],
  });
  test.each([
    ['Unpaid', [paidInvoice(13000, 0)]],
    ['Partially Paid', [paidInvoice(13000, 5000)]],
    ['Paid', [paidInvoice(13000, 13000)]],
    ['Partially Paid', [paidInvoice(50000, 50000), paidInvoice(10000, 0)]],
    ['Not invoiced', []],
  ])('renders %s from canonical Invoice evidence despite legacy Unpaid', (label, invoices) => {
    mockOrder = baseOrder({ state: 'closed', paymentStatus: 'unpaid', paymentSummary: deriveOrderPaymentSummary(invoices as any) });
    const { container, root } = renderOrderDetail();
    const paymentLabel = Array.from(container.querySelectorAll('label')).find((node) => node.textContent === 'Payment');
    expect(paymentLabel?.parentElement?.textContent).toContain(label);
    if (label !== 'Unpaid') expect(paymentLabel?.parentElement?.textContent).not.toContain('Unpaid');
    act(() => root.unmount());
  });
});

describe("Order ownership controls", () => {
  test("existing Order clears Customer scope, searches Janet, and saves Contact-only across reload", async () => {
    mockOrder = baseOrder({
      contactId: "contact-a",
      contact: { id: "contact-a", firstName: "Alex", lastName: "Able" },
    });
    mockUpdateOwner.mockImplementation((changes: any, callbacks: any) => {
      mockOrder = {
        ...mockOrder,
        ...changes,
        customer: changes.customerId === null ? null : mockOrder.customer,
        contact: changes.contactId === "contact-janet"
          ? { id: "contact-janet", firstName: "Janet", lastName: "Smith" }
          : mockOrder.contact,
      };
      callbacks?.onSuccess?.();
    });
    const { container, root } = renderOrderDetail();
    expect(mockPickerQueries.at(-1)?.queryKey[2].customerId).toBe("customer-1");

    act(() => (container.querySelector('[aria-label="Clear customer"]') as HTMLButtonElement).click());
    expect(mockUpdateOwner).toHaveBeenCalledWith({ customerId: null }, expect.any(Object));
    expect(mockPickerQueries.at(-1)?.queryKey[2].customerId).toBeNull();
    expect(container.querySelector('[aria-label="Clear customer"]')).toBeNull();

    act(() => root.render(
      <MemoryRouter initialEntries={["/orders/order-1/edit"]}>
        <Routes><Route path="/orders/:id/edit" element={<OrderDetail />} /></Routes>
      </MemoryRouter>,
    ));
    expect(mockPickerQueries.at(-1)?.queryKey[2].customerId).toBeNull();
    const contactPicker = Array.from(container.querySelectorAll('[role="combobox"]'))
      .find((node) => node.textContent?.includes("Alex Able")) as HTMLButtonElement;
    expect(contactPicker).toBeTruthy();
    act(() => contactPicker.click());
    const search = document.querySelector('input[placeholder="Search by name, email, phone, or customer..."]') as HTMLInputElement;
    expect(search).toBeTruthy();
    act(() => Simulate.change(search, { target: { value: "janet" } } as any));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
    expect(mockPickerQueries.at(-1)?.queryKey[2]).toEqual({ search: "janet", customerId: null });
    const janet = Array.from(document.querySelectorAll('[cmdk-item]'))
      .find((node) => node.textContent?.includes("Janet Smith")) as HTMLElement;
    expect(janet).toBeTruthy();
    act(() => janet.click());
    expect(mockUpdateOwner).toHaveBeenLastCalledWith({ customerId: null, contactId: "contact-janet" }, expect.any(Object));
    expect(mockOrder).toMatchObject({ customerId: null, contactId: "contact-janet" });
    act(() => root.unmount());
    const reloaded = renderOrderDetail();
    expect(reloaded.container.textContent).toContain("Janet Smith");
    expect(reloaded.container.querySelector('[aria-label="Clear customer"]')).toBeNull();
    expect(mockPickerQueries.at(-1)?.queryKey[2].customerId).toBeNull();
    act(() => reloaded.root.unmount());
  });

  test("visible Clear customer submits explicit null without clearing the selected Contact", () => {
    mockOrder = baseOrder({ contactId: "contact-1", contact: { id: "contact-1", firstName: "Logan", lastName: "Payne" } });
    const { container, root } = renderOrderDetail();
    const clear = container.querySelector('[aria-label="Clear customer"]') as HTMLButtonElement;
    expect(clear).not.toBeNull();
    expect(container.textContent).toContain("Logan Payne");
    act(() => clear.click());
    expect(mockUpdateOwner).toHaveBeenCalledWith({ customerId: null }, expect.any(Object));
    expect(mockOrder.contactId).toBe("contact-1");
    act(() => root.unmount());
  });

  test("Customer-only clear explains the missing owner and sends no invalid mutation", () => {
    mockOrder = baseOrder({ contactId: null });
    const { container, root } = renderOrderDetail();
    act(() => (container.querySelector('[aria-label="Clear customer"]') as HTMLButtonElement).click());
    expect(mockUpdateOwner).not.toHaveBeenCalled();
    expect(mockOwnerToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Select a customer or contact for this order." }));
    act(() => root.unmount());
  });
});

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
  mockPickerQueries.length = 0;
  mockEligibility = { canCancel: true, code: null, message: null, details: null };
});

describe("OrderDetail cancellation action rendering", () => {
  test.each([
    ["auto", "Auto 2.800%", {}],
    ["exempt", "Order exempt", { taxOverrideMode: "exempt" }],
    ["rate", "Override 7.000%", { taxOverrideMode: "rate", taxRateOverride: "0.07" }],
  ])("renders tax controls without a TDZ for %s treatment", (_mode, taxLabel, taxOverrides) => {
    mockOrder = baseOrder({ taxRate: "0.028", taxableSubtotal: "100.00", ...taxOverrides });

    const { container, root } = renderOrderDetail();

    expect(container.textContent).toContain(taxLabel);
    const editTaxButton = Array.from(container.querySelectorAll("button")).find((node) => node.textContent?.trim() === "Edit");
    expect(editTaxButton).toBeTruthy();

    act(() => {
      (editTaxButton as HTMLButtonElement).click();
    });

    expect(document.body.textContent).toContain("Tax Settings");
    act(() => root.unmount());
  });

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

test('closed Detail agrees with lifecycle despite stale Invoiced and preserves Reopen', () => {
  mockOrder = baseOrder({ state: 'closed', status: 'invoiced', statusPillValue: 'Invoiced', fulfillmentStatus: 'delivered' });
  const { container, root } = renderOrderDetail('/orders/order-1');
  expect(container.textContent).toContain('Closed');
  expect(container.querySelector('[data-testid="status-pill"]')).toBeNull();
  expect(container.textContent).not.toContain('require production');
  act(() => root.unmount());
});
