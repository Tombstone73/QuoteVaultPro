/**
 * Mock data for Lovable preview. Gated by runtime config.
 * Shapes match audit appendix DTOs exactly. No invented fields.
 */

import type {
  PortalOrderListItem,
  PortalQuoteListItem,
  PortalQuoteDetail,
  PortalInvoiceListItem,
  PortalInvoiceDetail,
  PortalOrderDetail,
  PortalSession,
} from "@/types/portal";

// MOCKS_ENABLED removed — use useRuntimeConfig().isMockMode instead

export const mockSession: PortalSession = {
  id: "usr_mock_001",
  email: "jane@acmecorp.com",
  firstName: "Jane",
  lastName: "Mitchell",
  customerId: "cust_mock_001",
  customerName: "Acme Corporation",
};

export const mockOrders: PortalOrderListItem[] = [
  {
    id: "ord_001",
    orderNumber: "ORD-2024-0142",
    poNumber: "PO-88432",
    state: "open",
    stateLabel: "In Progress",
    priority: "rush",
    dueDate: "2024-12-20T00:00:00Z",
    promisedDate: "2024-12-19T00:00:00Z",
    subtotal: 2450.0,
    tax: 196.0,
    total: 2646.0,
    shippingMethod: "deliver",
    trackingNumber: null,
    shippedAt: null,
    createdAt: "2024-12-01T14:30:00Z",
  },
  {
    id: "ord_002",
    orderNumber: "ORD-2024-0138",
    poNumber: null,
    state: "production_complete",
    stateLabel: "Ready for Pickup",
    priority: "normal",
    dueDate: "2024-12-15T00:00:00Z",
    promisedDate: "2024-12-15T00:00:00Z",
    subtotal: 875.0,
    tax: 70.0,
    total: 945.0,
    shippingMethod: "pickup",
    trackingNumber: null,
    shippedAt: null,
    createdAt: "2024-11-28T09:15:00Z",
  },
  {
    id: "ord_003",
    orderNumber: "ORD-2024-0125",
    poNumber: "PO-87901",
    state: "closed",
    stateLabel: "Completed",
    priority: "normal",
    dueDate: "2024-12-05T00:00:00Z",
    promisedDate: "2024-12-04T00:00:00Z",
    subtotal: 1320.0,
    tax: 105.6,
    total: 1425.6,
    shippingMethod: "ship",
    trackingNumber: "1Z999AA10123456784",
    shippedAt: "2024-12-04T16:00:00Z",
    createdAt: "2024-11-20T11:45:00Z",
  },
  {
    id: "ord_004",
    orderNumber: "ORD-2024-0119",
    poNumber: "PO-87500",
    state: "canceled",
    stateLabel: "Canceled",
    priority: "low",
    dueDate: null,
    promisedDate: null,
    subtotal: 560.0,
    tax: 44.8,
    total: 604.8,
    shippingMethod: "pickup",
    trackingNumber: null,
    shippedAt: null,
    createdAt: "2024-11-15T08:00:00Z",
  },
  {
    id: "ord_005",
    orderNumber: "ORD-2024-0150",
    poNumber: "PO-88700",
    state: "open",
    stateLabel: "In Progress",
    priority: "normal",
    dueDate: "2025-01-10T00:00:00Z",
    promisedDate: "2025-01-09T00:00:00Z",
    subtotal: 3200.0,
    tax: 256.0,
    total: 3456.0,
    shippingMethod: "ship",
    trackingNumber: null,
    shippedAt: null,
    createdAt: "2024-12-10T10:00:00Z",
  },
];

export const mockQuotes: PortalQuoteListItem[] = [
  {
    id: "qt_001",
    quoteNumber: "QT-2024-0089",
    state: "sent",
    stateLabel: "Pending Review",
    subtotal: 4800.0,
    tax: 384.0,
    total: 5184.0,
    expiresAt: "2025-01-15T00:00:00Z",
    createdAt: "2024-12-05T10:00:00Z",
  },
  {
    id: "qt_002",
    quoteNumber: "QT-2024-0085",
    state: "approved",
    stateLabel: "Approved",
    subtotal: 1250.0,
    tax: 100.0,
    total: 1350.0,
    expiresAt: "2024-12-30T00:00:00Z",
    createdAt: "2024-11-20T14:30:00Z",
  },
  {
    id: "qt_003",
    quoteNumber: "QT-2024-0078",
    state: "expired",
    stateLabel: "Expired",
    subtotal: 3600.0,
    tax: 288.0,
    total: 3888.0,
    expiresAt: "2024-11-30T00:00:00Z",
    createdAt: "2024-11-01T09:00:00Z",
  },
  {
    id: "qt_004",
    quoteNumber: "QT-2024-0092",
    state: "sent",
    stateLabel: "Pending Review",
    subtotal: 950.0,
    tax: 76.0,
    total: 1026.0,
    expiresAt: "2025-02-01T00:00:00Z",
    createdAt: "2024-12-12T16:45:00Z",
  },
  {
    id: "qt_005",
    quoteNumber: "QT-2024-0070",
    state: "rejected",
    stateLabel: "Rejected",
    subtotal: 2200.0,
    tax: 176.0,
    total: 2376.0,
    expiresAt: null,
    createdAt: "2024-10-15T11:20:00Z",
  },
];

export const mockQuoteDetail = (id: string): PortalQuoteDetail => {
  const listItem = mockQuotes.find((q) => q.id === id) ?? mockQuotes[0];
  return {
    ...listItem,
    lineItems: [
      { id: "qli_1", description: "500 Business Cards — Full Color, Double-Sided", quantity: 500, unitPrice: 0.35, total: 175.0 },
      { id: "qli_2", description: "1000 Letterheads — 80lb Premium Linen", quantity: 1000, unitPrice: 0.85, total: 850.0 },
      { id: "qli_3", description: "Brochure Design — Tri-Fold, Custom Layout", quantity: 1, unitPrice: 450.0, total: 450.0 },
      { id: "qli_4", description: "Design Setup Fee", quantity: 1, unitPrice: 150.0, total: 150.0 },
    ],
  };
};

export const mockInvoices: PortalInvoiceListItem[] = [
  {
    id: "inv_001",
    invoiceNumber: "INV-2024-0201",
    status: "billed",
    statusLabel: "Unpaid",
    subtotal: 2450.0,
    tax: 196.0,
    total: 2646.0,
    amountDue: 2646.0,
    dueDate: "2025-01-15T00:00:00Z",
    createdAt: "2024-12-15T10:00:00Z",
  },
  {
    id: "inv_002",
    invoiceNumber: "INV-2024-0198",
    status: "paid",
    statusLabel: "Paid",
    subtotal: 875.0,
    tax: 70.0,
    total: 945.0,
    amountDue: 0,
    dueDate: "2024-12-20T00:00:00Z",
    createdAt: "2024-12-01T14:30:00Z",
  },
  {
    id: "inv_003",
    invoiceNumber: "INV-2024-0190",
    status: "billed",
    statusLabel: "Unpaid",
    subtotal: 3200.0,
    tax: 256.0,
    total: 3456.0,
    amountDue: 3456.0,
    dueDate: "2025-02-01T00:00:00Z",
    createdAt: "2024-11-28T09:15:00Z",
  },
  {
    id: "inv_004",
    invoiceNumber: "INV-2024-0185",
    status: "void",
    statusLabel: "Void",
    subtotal: 560.0,
    tax: 44.8,
    total: 604.8,
    amountDue: 0,
    dueDate: null,
    createdAt: "2024-11-15T08:00:00Z",
  },
  {
    id: "inv_005",
    invoiceNumber: "INV-2024-0205",
    status: "draft",
    statusLabel: "Draft",
    subtotal: 1800.0,
    tax: 144.0,
    total: 1944.0,
    amountDue: 1944.0,
    dueDate: null,
    createdAt: "2024-12-18T16:00:00Z",
  },
];

export const mockInvoiceDetail = (id: string): import("@/types/portal").PortalInvoiceDetail => {
  const listItem = mockInvoices.find((i) => i.id === id) ?? mockInvoices[0];
  return {
    ...listItem,
    lineItems: [
      { id: "li_1", description: "500 Business Cards — Full Color", quantity: 500, unitPrice: 0.35, total: 175.0 },
      { id: "li_2", description: "1000 Letterheads — 80lb Premium", quantity: 1000, unitPrice: 0.85, total: 850.0 },
      { id: "li_3", description: "Design Setup Fee", quantity: 1, unitPrice: 150.0, total: 150.0 },
    ],
    payments: listItem.status === "paid"
      ? [{ id: "pay_1", amount: listItem.total, method: "stripe", paidAt: "2024-12-18T10:30:00Z" }]
      : [],
  };
};

export const mockOrderDetail = (id: string): PortalOrderDetail => {
  const listItem = mockOrders.find((o) => o.id === id) ?? mockOrders[0];
  return {
    ...listItem,
    lineItems: [
      {
        id: "oli_1",
        description: "500 Business Cards — Full Color, Double-Sided",
        quantity: 500,
        unitPrice: 0.35,
        total: 175.0,
        workflowState: listItem.state === "closed" ? "ready" : "in_production",
        workflowStateLabel: listItem.state === "closed" ? "Ready" : "In Production",
      },
      {
        id: "oli_2",
        description: "1000 Letterheads — 80lb Premium Linen",
        quantity: 1000,
        unitPrice: 0.85,
        total: 850.0,
        workflowState: listItem.state === "canceled" ? "canceled" : "processing",
        workflowStateLabel: listItem.state === "canceled" ? "Canceled" : "Processing",
      },
      {
        id: "oli_3",
        description: "Design Setup Fee",
        quantity: 1,
        unitPrice: 150.0,
        total: 150.0,
        workflowState: "ready",
        workflowStateLabel: "Ready",
      },
    ],
    files: [
      {
        id: "file_1",
        fileName: "business-card-artwork-final.pdf",
        fileRole: "artwork",
        fileRoleLabel: "Artwork",
        lineItemId: "oli_1",
        downloadUrl: `/orders/${listItem.id}/line-items/oli_1/files/file_1/download`,
      },
      {
        id: "file_2",
        fileName: "PO-88432.pdf",
        fileRole: "customer_po",
        fileRoleLabel: "Customer PO",
        lineItemId: "oli_1",
        downloadUrl: `/orders/${listItem.id}/line-items/oli_1/files/file_2/download`,
      },
    ],
  };
};
