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

const { MemoryRouter, Route, Routes, parsePath } = require("react-router-dom") as typeof import("react-router-dom");
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
const mockSaveOwner = jest.fn<any>();
const mockBusinessMutation = jest.fn(async () => ({}));
const mockGuardedNavigate = jest.fn();
const mockRegisterGuard = jest.fn((_guard: (path: string) => string | boolean, _shouldBlock: () => boolean, _label: string) => jest.fn());
let mockExecutePickerRequests = false;
const actualQuery = jest.requireActual("@tanstack/react-query") as typeof import("@tanstack/react-query");
const { QueryClient, QueryClientProvider } = actualQuery;
const mockRequestUrls: string[] = [];
const originalFetch = globalThis.fetch;
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
    mutate: mockBusinessMutation,
    mutateAsync: mockBusinessMutation,
    isPending: false,
  }),
  useQuery: (options: any) => {
    if (mockExecutePickerRequests && options?.queryKey?.[0] === "/api/contacts") {
      if (options.queryKey[1] === "picker") mockPickerQueries.push(options);
      return (jest.requireActual("@tanstack/react-query") as any).useQuery(options);
    }
    return ({
    data: options?.queryKey?.[1] === "picker"
      ? (mockPickerQueries.push(options), mockPickerContacts)
      : String(options?.queryKey?.[0] ?? "").includes("/api/me/orgs") ? mockOrgMemberships
      : options?.queryKey?.[0] === "/api/customers" ? [{ id: "customer-2", companyName: "Customer B" }] : [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: jest.fn(async () => ({ data: [] })),
  }); },
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
  useUpdateOrder: () => ({ mutate: mockUpdateOwner, mutateAsync: mockSaveOwner, isPending: false }),
  useUpdateOrderTaxTreatment: () => ({ mutateAsync: jest.fn(async () => ({})), isPending: false }),
  useBulkUpdateOrderLineItemStatus: () => ({ mutateAsync: mockBusinessMutation, isPending: false }),
  useTransitionOrderStatus: () => ({ mutateAsync: mockBusinessMutation, isPending: false }),
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
  useDeleteShipment: () => ({ mutateAsync: mockBusinessMutation, isPending: false }),
  useUpdateShipment: () => ({ mutateAsync: mockBusinessMutation, isPending: false }),
  useGeneratePackingSlip: () => ({ mutateAsync: mockBusinessMutation, isPending: false }),
  useSendShipmentEmail: () => ({ mutate: mockBusinessMutation, isPending: false }),
  useUpdateFulfillmentStatus: () => ({ mutateAsync: mockBusinessMutation, isPending: false }),
}));

jest.mock("@/hooks/useOrderState", () => ({
  isTerminalState: (state: string) => state === "closed" || state === "canceled",
  useCloseOrder: () => ({ mutateAsync: mockBusinessMutation, isPending: false }),
  useCompleteOrder: () => ({ mutateAsync: mockBusinessMutation, isPending: false }),
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
    registerGuard: mockRegisterGuard,
    guardedNavigate: mockGuardedNavigate,
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
  ShipmentForm: ({ open }: any) => open ? <div role="dialog" aria-label="Legacy shipment form" /> : null,
}));

jest.mock("@/components/PackingSlipModal", () => ({
  PackingSlipModal: () => null,
}));

jest.mock("@/components/production/TravelerPrintDialog", () => ({
  TravelerPrintDialog: ({ orderId, open, onOpenChange }: any) => open ? (
    <div role="dialog" aria-label="Traveler print" data-order-id={orderId}>
      <button type="button" onClick={() => onOpenChange(false)}>Close Traveler</button>
    </div>
  ) : null,
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

function renderOrderDetail(path = "/orders/order-1/edit", state: unknown = null) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <MemoryRouter initialEntries={[{ ...parsePath(path), state }]}>
        <Routes>
          <Route path="/orders/:id/edit" element={<OrderDetail />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
        </Routes>
      </MemoryRouter></QueryClientProvider>,
    );
  });
  return { container, root: root! };
}

describe("Order fulfillment and Traveler header actions", () => {
  test.each(["pickup", "ship", "deliver"])("opens the Order-scoped workspace for %s without business mutations", (shippingMethod) => {
    mockUser = { role: "employee", isAdmin: false };
    mockOrgMemberships.data.orgs[0].role = "member";
    mockOrder = baseOrder({ shippingMethod, status: "completed", productionReportedQuantity: 0 });
    globalThis.fetch = jest.fn<any>();
    const returnState = { referrer: { pathname: "/orders", search: "?status=open" }, listContextId: "order-list" };
    const { container, root } = renderOrderDetail("/orders/order-1?returnTo=%2Forders%3Fstatus%3Dopen#details", returnState);
    const button = Array.from(container.querySelectorAll("button")).find(node => node.textContent?.trim() === "Fulfillment")!;
    expect(button).toBeTruthy();
    expect(button.disabled).toBe(false);
    expect(container.textContent).not.toContain("Save & Route Jobs");

    act(() => button.click());

    expect(mockGuardedNavigate).toHaveBeenCalledTimes(1);
    expect(mockGuardedNavigate).toHaveBeenCalledWith("/fulfillment/orders/order-1", {
      state: {
        referrer: { pathname: "/orders/order-1", search: "?returnTo=%2Forders%3Fstatus%3Dopen", hash: "#details" },
        orderReturnState: returnState,
      },
    });
    expect(mockBusinessMutation).not.toHaveBeenCalled();
    expect(mockSaveOwner).not.toHaveBeenCalled();
    expect(mockUpdateOwner).not.toHaveBeenCalled();
    expect(mockCancelOrder).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(require("@/lib/queryClient").apiFetch).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    act(() => root.unmount());
  });

  test("uses the existing dirty guard without saving or clearing unsaved line-item changes", () => {
    mockOrder = baseOrder({ shippingMethod: "pickup" });
    const { container, root } = renderOrderDetail();
    const [guard, shouldBlock] = mockRegisterGuard.mock.calls[0];
    expect(shouldBlock()).toBe(false);
    act(() => latestLineItemsProps.onDirtyStateChange(true));
    const button = Array.from(container.querySelectorAll("button")).find(node => node.textContent?.trim() === "Fulfillment")!;

    act(() => button.click());

    expect(mockGuardedNavigate).toHaveBeenCalledWith("/fulfillment/orders/order-1", expect.any(Object));
    expect(shouldBlock()).toBe(true);
    expect(guard("/fulfillment/orders/order-1")).toBe("You have unsaved changes. Leave without saving?");
    expect(mockSaveOwner).not.toHaveBeenCalled();
    expect(mockBusinessMutation).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  test.each(["pickup", "ship", "deliver"])("offers one existing Traveler dialog for non-canceled %s orders", (shippingMethod) => {
    mockUser = { role: "employee", isAdmin: false };
    mockOrgMemberships.data.orgs[0].role = "member";
    mockOrder = baseOrder({ shippingMethod, status: "completed" });
    const { container, root } = renderOrderDetail("/orders/order-1");
    const buttons = Array.from(container.querySelectorAll("button")).filter(node => node.textContent?.trim() === "Print Traveler");
    expect(buttons).toHaveLength(1);

    act(() => buttons[0].click());

    expect(container.querySelector('[role="dialog"][aria-label="Traveler print"]')?.getAttribute("data-order-id")).toBe("order-1");
    expect(mockBusinessMutation).not.toHaveBeenCalled();
    expect(mockSaveOwner).not.toHaveBeenCalled();
    expect(mockGuardedNavigate).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  test.each(["pickup", "ship", "deliver"])("suppresses Traveler but keeps Fulfillment history navigation for canceled %s orders", (shippingMethod) => {
    mockOrder = baseOrder({ shippingMethod, state: "canceled", status: "canceled" });
    const { container, root } = renderOrderDetail("/orders/order-1");
    expect(container.textContent).not.toContain("Print Traveler");
    expect(container.querySelector('[aria-label="Traveler print"]')).toBeNull();
    const button = Array.from(container.querySelectorAll("button")).find(node => node.textContent?.trim() === "Fulfillment")!;

    act(() => button.click());

    expect(mockGuardedNavigate).toHaveBeenCalledWith("/fulfillment/orders/order-1", expect.any(Object));
    expect(mockBusinessMutation).not.toHaveBeenCalled();
    expect(mockSaveOwner).not.toHaveBeenCalled();
    expect(mockCancelOrder).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});

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

async function settlePicker() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 260)); });
}
function saveButton(container: HTMLElement) {
  return Array.from(container.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Save Order')!;
}

function openCustomerEditor(container: HTMLElement) {
  act(() => (container.querySelector('[aria-label="Change customer"]') as HTMLButtonElement).click());
}
function removeCustomerFromEditor(container: HTMLElement) {
  openCustomerEditor(container);
  const remove = container.querySelector('[aria-label="Remove customer"]') as HTMLButtonElement;
  expect(remove).toBeTruthy();
  act(() => remove.click());
}
function openMoreOrderActions(container: HTMLElement) {
  const trigger = container.querySelector('[aria-label="More order actions"]') as HTMLButtonElement;
  expect(trigger).toBeTruthy();
  act(() => {
    Simulate.pointerDown(trigger, { button: 0, ctrlKey: false } as any);
  });
}
function cancelOrderMenuItem() {
  return Array.from(document.body.querySelectorAll('[role="menuitem"]')).find((node) => node.textContent?.includes("Cancel Order")) as HTMLElement | undefined;
}
function useRealPickerRequests() {
  mockExecutePickerRequests = true;
  globalThis.fetch = jest.fn<any>(async (input: string) => {
    mockRequestUrls.push(input);
    const url = new URL(input, 'http://localhost');
    const customerId = url.searchParams.get('customerId');
    const search = url.searchParams.get('search')?.toLowerCase() ?? '';
    const contacts = mockPickerContacts.filter(c => (!customerId || c.customerId === customerId)
      && (c.firstName + ' ' + c.lastName).toLowerCase().includes(search));
    return { ok: true, json: async () => url.pathname === '/api/contacts'
      ? { contacts } : { contact: mockPickerContacts.find(c => url.pathname.endsWith(c.id)) } };
  });
  mockSaveOwner.mockImplementation(async (changes: any) => {
    mockOrder = { ...mockOrder, ...changes,
      customer: changes.customerId === null ? null : mockOrder.customer,
      contact: mockPickerContacts.find(c => c.id === changes.contactId) ?? mockOrder.contact };
    return mockOrder;
  });
}

describe("Order ownership controls", () => {
  test("renders Customer and Contact facts from their own records", () => {
    mockOrder = baseOrder({
      customer: { id: "customer-1", companyName: "Acme Signs", email: "billing@acme.test", phone: "555-0100" },
      contactId: "contact-a",
      contact: { id: "contact-a", firstName: "Alex", lastName: "Able", email: "alex@acme.test", phone: "555-0200" },
    });
    const { container, root } = renderOrderDetail();
    const text = container.textContent ?? "";

    expect(text).toContain("Acme Signs");
    expect(text).toContain("billing@acme.test");
    expect(text).toContain("Alex Able");
    expect(text).toContain("alex@acme.test");
    expect(text.split("billing@acme.test")).toHaveLength(2);
    expect(text.split("alex@acme.test")).toHaveLength(2);
    act(() => root.unmount());
  });

  test("does not render a contact-only Order's Contact as Customer data", () => {
    mockOrder = baseOrder({
      customerId: null,
      customer: null,
      contactId: "contact-standalone",
      contact: { id: "contact-standalone", firstName: "Sam", lastName: "Solo", email: "sam@solo.test", phone: "555-0300" },
    });
    const { container, root } = renderOrderDetail();
    const text = container.textContent ?? "";

    expect(text).toContain("No customer selected");
    expect(text.split("Sam Solo")).toHaveLength(2);
    expect(text.split("sam@solo.test")).toHaveLength(2);
    act(() => root.unmount());
  });

  test('removing a Customer preserves the unsaved contact-only edit path', async () => {
    useRealPickerRequests();
    mockOrder = baseOrder({ contactId: null });
    const { container, root } = renderOrderDetail();
    openCustomerEditor(container);
    await settlePicker();
    expect(mockRequestUrls.some(url => new URL(url, 'http://localhost').searchParams.get('customerId') === 'customer-1')).toBe(true);
    expect(container.querySelector('[aria-label="Clear customer"]')).toBeNull();
    const remove = container.querySelector('[aria-label="Remove customer"]') as HTMLButtonElement;
    act(() => remove.click());
    expect(mockUpdateOwner).not.toHaveBeenCalled();
    expect(mockSaveOwner).not.toHaveBeenCalled();
    expect(mockOrder.customerId).toBe('customer-1'); // persistence has not changed
    // The contact picker is intentionally unmounted outside explicit edit mode.
    openCustomerEditor(container);
    await settlePicker();
    expect(mockPickerQueries.at(-1)?.queryKey[2].customerId).toBeNull();
    expect(Array.from(container.querySelectorAll('[role="combobox"]')).some(node => node.textContent?.includes('Search contacts'))).toBe(true);
    act(() => root.unmount());
  });

  test('Customer change stages explicit owner IDs, clears the former Contact, and saves', async () => {
    mockOrder = baseOrder({ contactId: 'contact-a', contact: mockPickerContacts[0] });
    mockSaveOwner.mockResolvedValue({});
    const { container, root } = renderOrderDetail();
    openCustomerEditor(container);
    expect(container.querySelector('[aria-label="Remove customer"]')).toBeTruthy();
    expect(mockSaveOwner).not.toHaveBeenCalled();
    const customer = Array.from(document.querySelectorAll('[cmdk-item]')).find(node => node.textContent?.includes('Customer B')) as HTMLElement;
    act(() => customer.click());
    expect(mockSaveOwner).not.toHaveBeenCalled();
    expect(mockPickerQueries.at(-1)?.queryKey[2].customerId).toBe('customer-2');
    expect(container.textContent).not.toContain('Alex Able');
    await act(async () => saveButton(container).click());
    expect(mockSaveOwner).toHaveBeenCalledWith({ customerId: 'customer-2', contactId: null });
    act(() => root.unmount());
  });

  test('Discard restores the persisted Customer and Contact scope', async () => {
    mockOrder = baseOrder({ contactId: 'contact-a', contact: mockPickerContacts[0] });
    const { container, root } = renderOrderDetail();
    removeCustomerFromEditor(container);
    openCustomerEditor(container);
    expect(mockPickerQueries.at(-1)?.queryKey[2].customerId).toBeNull();
    const discard = Array.from(container.querySelectorAll('button')).find(node => node.textContent?.trim() === 'Discard')!;
    await act(async () => discard.click());
    openCustomerEditor(container);
    expect(mockPickerQueries.at(-1)?.queryKey[2].customerId).toBe('customer-1');
    expect(mockSaveOwner).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  test('QB block offers a deliberate reason-required override and submits only billing identity', async () => {
    mockOrder = baseOrder({ contactId: 'contact-a', contact: mockPickerContacts[0] });
    const context = { invoiceId: 'invoice', invoiceVersion: 3, orderUpdatedAt: '2026-09-28T17:00:00.000Z' };
    mockSaveOwner.mockRejectedValue(Object.assign(new Error('This Invoice was synchronized to QuickBooks.'), { details: { billingOwnershipOverride: context } }));
    const { container, root } = renderOrderDetail();
    removeCustomerFromEditor(container);
    expect(container.textContent).not.toContain('Override Billing Ownership');
    await act(async () => saveButton(container).click());
    const override = Array.from(container.querySelectorAll('button')).find(node => node.textContent === 'Override Billing Ownership')!;
    expect(override).toBeTruthy();
    act(() => override.click());
    expect(document.body.textContent).toContain('QuickBooks will NOT be updated');
    const confirm = Array.from(document.querySelectorAll('button')).find(node => node.textContent === 'Confirm local ownership override')!;
    expect(confirm.disabled).toBe(true);
    const reason = document.getElementById('ownership-override-reason') as HTMLTextAreaElement;
    act(() => Simulate.change(reason, { target: { value: 'Accounting will correct QuickBooks manually.' } } as any));
    expect(confirm.disabled).toBe(false);
    await act(async () => confirm.click());
    const { apiFetch } = require('@/lib/queryClient');
    expect(apiFetch).toHaveBeenCalledWith('/api/orders/order-1/billing-ownership-override', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ ...context, customerId: null, contactId: 'contact-a', reason: 'Accounting will correct QuickBooks manually.', confirmed: true }),
    }));
    expect(mockOwnerToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Billing ownership overridden' }));
    act(() => root.unmount());
  });

  test('payment blocker does not offer an override', async () => {
    mockOrder = baseOrder({ contactId: 'contact-a', contact: mockPickerContacts[0] });
    mockSaveOwner.mockRejectedValue(new Error('A payment has been applied.'));
    const { container, root } = renderOrderDetail();
    removeCustomerFromEditor(container);
    await act(async () => saveButton(container).click());
    expect(container.textContent).not.toContain('Override Billing Ownership');
    act(() => root.unmount());
  });

  test('Remove customer retains the selected Contact in the draft without submitting', () => {
    mockOrder = baseOrder({ contactId: 'contact-a', contact: mockPickerContacts[0] });
    const { container, root } = renderOrderDetail();
    removeCustomerFromEditor(container);
    expect(mockUpdateOwner).not.toHaveBeenCalled();
    expect(mockSaveOwner).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Alex Able');
    expect(container.querySelector('[aria-label="Remove customer"]')).toBeNull();
    act(() => root.unmount());
  });

  test('missing owner is validated at Save, not when removing Customer', async () => {
    mockOrder = baseOrder({ contactId: null });
    const { container, root } = renderOrderDetail();
    removeCustomerFromEditor(container);
    expect(mockOwnerToast).not.toHaveBeenCalled();
    await act(async () => saveButton(container).click());
    expect(mockSaveOwner).not.toHaveBeenCalled();
    expect(mockOwnerToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Select a customer or contact for this order.' }));
    act(() => root.unmount());
  });

  test('rejected ownership save preserves tenant-wide draft and returns the precise blocker', async () => {
    mockOrder = baseOrder({ contactId: 'contact-a', contact: mockPickerContacts[0] });
    mockSaveOwner.mockRejectedValue(new Error('Billing owner cannot be changed because this Invoice was synchronized to QuickBooks.'));
    const { container, root } = renderOrderDetail();
    removeCustomerFromEditor(container);
    await act(async () => saveButton(container).click());
    expect(mockOrder.customerId).toBe('customer-1');
    expect(container.textContent).toContain('Alex Able');
    expect(mockOwnerToast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('synchronized to QuickBooks') }));
    act(() => root.unmount());
  });
});

afterEach(() => {
  document.body.innerHTML = "";
  jest.clearAllMocks();
  mockSaveOwner.mockReset();
  mockExecutePickerRequests = false;
  mockRequestUrls.length = 0;
  globalThis.fetch = originalFetch;
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
    const editTaxButton = container.querySelector('button[aria-label="Edit tax settings"]');
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
    expect(container.querySelector('[aria-label="More order actions"]')).toBeTruthy();

    act(() => root.unmount());
  });

  test("renders Cancel Order for Admin and Owner users", () => {
    mockOrder = baseOrder();
    mockUser = { role: "admin", isAdmin: true };
    let rendered = renderOrderDetail();
    expect(rendered.container.querySelector('[aria-label="More order actions"]')).toBeTruthy();
    act(() => rendered.root.unmount());

    document.body.innerHTML = "";
    mockUser = { role: "owner", isAdmin: true };
    rendered = renderOrderDetail();
    expect(rendered.container.querySelector('[aria-label="More order actions"]')).toBeTruthy();
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
    openMoreOrderActions(container);
    const button = cancelOrderMenuItem();
    expect(button).toBeTruthy();
    expect(button?.getAttribute("data-disabled")).not.toBeNull();
    expect(document.body.textContent).toContain("Cannot cancel because payment has been recorded.");

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
    openMoreOrderActions(container);
    const button = cancelOrderMenuItem();
    expect(button).toBeTruthy();
    act(() => button?.click());

    expect(document.body.textContent).toContain("Cancellation is permanent for normal operations.");
    expect(document.body.textContent).toContain("Keep Order Active");

    act(() => root.unmount());
  });

  test("successful cancellation submits through the existing mutation and invalidation path", async () => {
    mockOrder = baseOrder();

    const { container, root } = renderOrderDetail();
    openMoreOrderActions(container);
    const button = cancelOrderMenuItem();
    act(() => button?.click());
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
