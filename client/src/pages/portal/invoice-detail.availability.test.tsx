import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import PortalInvoiceDetailPage from "./invoice-detail";

let mockCanPay = true;
let mockEligibility = { payable: true, blockedReason: null as string | null };
let mockPreview = false;
let mockCheckout: any;
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock("@/hooks/usePortal", () => ({
  portalInvoiceKeys: { all: [] }, portalInvoicePdfUrl: jest.fn(),
  usePortalInvoice: () => ({ data: { id: "synthetic-20972", invoiceNumber: 20972, status: "billed", paymentStatusLabel: "Unpaid", amountDue: 125.70, amountPaid: 0, total: 125.70, subtotal: 125.70, tax: 0, currency: "USD", issueDate: null, dueDate: null, paymentEligibility: mockEligibility } }),
  usePortalInvoicePayments: () => ({ data: [] }), usePortalInvoiceFiles: () => ({ data: [] }),
  usePortalSession: () => ({ data: { permissions: { canPayInvoices: mockCanPay }, staffPreview: { active: mockPreview, canExecutePayments: mockPreview } } }),
}));
jest.mock("@/hooks/usePortalDownload", () => ({ usePortalDownload: () => ({ download: jest.fn() }) }));
jest.mock("@/components/portal/PortalFilesCard", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/payments/StripePayDialog", () => ({ __esModule: true, default: (props: any) => { mockCheckout = props; return null; } }));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mockCanPay = true; mockPreview = false; mockEligibility = { payable: true, blockedReason: null };
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = () => act(() => root.render(<MemoryRouter><PortalInvoiceDetailPage /></MemoryRouter>));
const payButton = () => Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Pay $125.70");

test("authorized synthetic invoice opens the canonical portal checkout with its identity", () => {
  render(); expect(payButton()).toBeDefined();
  act(() => payButton()!.click());
  expect(mockCheckout).toMatchObject({ open: true, invoiceId: "synthetic-20972", apiBasePath: "/api/portal/invoices" });
});
test("missing customer permission has an actionable message even if old financial eligibility is true", () => {
  mockCanPay = false; render();
  expect(payButton()).toBeUndefined(); expect(host.textContent).toContain("company administrator or the shop");
});
test.each(["Online payment is temporarily unavailable. Please contact the shop.", "Customer payment access cannot be verified in staff preview.", "Invoice has no amount due."])("server unavailable state hides Pay: %s", (message) => {
  mockPreview = true; mockEligibility = { payable: false, blockedReason: message }; render();
  expect(payButton()).toBeUndefined(); expect(host.textContent).toContain(message);
});
