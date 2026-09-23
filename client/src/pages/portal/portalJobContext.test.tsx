import React from "react";
import { TextDecoder, TextEncoder } from "node:util";

import type { PortalOrderListDto, PortalQuoteListDto } from "@/hooks/usePortal";

jest.mock("@/hooks/usePortalDownload", () => ({ usePortalDownload: jest.fn() }));

Object.assign(globalThis, { TextDecoder, TextEncoder });
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
const { MemoryRouter } = require("react-router-dom") as typeof import("react-router-dom");
const { OrderRow } = require("./my-orders") as typeof import("./my-orders");
const { QuoteRow } = require("./my-quotes") as typeof import("./my-quotes");
const { OrderItem } = require("./dashboard") as typeof import("./dashboard");

const quote = (overrides: Partial<PortalQuoteListDto> = {}): PortalQuoteListDto => ({
  id: "quote-1",
  quoteNumber: 201,
  displayNumber: "Q-201",
  numberCore: 201,
  jobLabel: "Campus wayfinding refresh",
  customerPoNumber: "PO-9842",
  createdAt: "2026-09-20T12:00:00.000Z",
  validUntil: "2026-10-20T12:00:00.000Z",
  displayStatus: "Sent",
  total: 426.58,
  itemCount: 3,
  customerVisibleActions: { canView: true, canApprove: true, canDecline: true, canRequestRevision: true, disabledReason: null },
  ...overrides,
});

const order = (overrides: Partial<PortalOrderListDto> = {}): PortalOrderListDto => ({
  id: "order-1",
  orderNumber: "20068",
  displayNumber: "ORD-20068",
  numberCore: 20068,
  jobLabel: "Campus wayfinding refresh",
  customerPoNumber: "PO-9842",
  createdAt: "2026-09-20T12:00:00.000Z",
  updatedAt: "2026-09-21T12:00:00.000Z",
  displayStatus: "In Production",
  rawStatus: null,
  total: 426.58,
  itemCount: 3,
  proofStatusSummary: { proofRequired: false, statusLabel: "No proof required", actionRequired: false, latestVersionNumber: null, proofLinkAvailable: false, requiredCount: 0, approvedCount: 0, pendingCount: 0, revisionRequestedCount: 0 },
  fulfillmentSummary: { methodLabel: "Shipping", statusLabel: "Not shipped", trackingNumber: null, trackingUrl: null, shippedAt: null, pickupReadyAt: null },
  ...overrides,
});

function render(element: React.ReactElement) {
  document.body.innerHTML = renderToStaticMarkup(<MemoryRouter>{element}</MemoryRouter>);
}

describe("portal quote and order job context", () => {
  test("shows canonical Job and converted-order PO on quote rows", () => {
    render(<QuoteRow quote={quote()} />);
    expect(document.body.textContent).toContain("Job: Campus wayfinding refresh");
    expect(document.body.textContent).toContain("PO: PO-9842");
  });

  test("shows canonical Job and PO on order rows", () => {
    render(<OrderRow order={order()} />);
    expect(document.body.textContent).toContain("Job: Campus wayfinding refresh");
    expect(document.body.textContent).toContain("PO: PO-9842");
  });

  test("uses deliberate fallbacks and never exposes nullish text", () => {
    render(<><QuoteRow quote={quote({ jobLabel: null, customerPoNumber: null })} /><OrderRow order={order({ jobLabel: null, customerPoNumber: null })} /></>);
    expect(document.body.textContent?.match(/Job: —/g)).toHaveLength(2);
    expect(document.body.textContent?.match(/PO: —/g)).toHaveLength(2);
    expect(document.body.textContent).not.toContain("null");
    expect(document.body.textContent).not.toContain("undefined");
  });

  test("bounds long Job labels on mobile and truncates them on desktop", () => {
    render(<QuoteRow quote={quote({ jobLabel: "A very long canonical customer-facing job description for the entire regional rollout" })} />);
    const job = document.querySelector('p[title^="A very long"]');
    expect(job?.className).toContain("line-clamp-2");
    expect(job?.className).toContain("md:truncate");
  });

  test("dashboard Active Order shows canonical Job and PO with existing status and readiness", () => {
    render(<OrderItem order={order({ displayNumber: "ORD-20507", jobLabel: "G$C 4×4 Signs", customerPoNumber: "PO-20507", itemCount: 1, displayStatus: "Received", fulfillmentSummary: { ...order().fulfillmentSummary, statusLabel: "Not ready" } })} />);
    expect(document.body.textContent).toContain("Order ORD-20507");
    expect(document.body.textContent).toContain("Received");
    expect(document.body.textContent).toContain("Job: G$C 4×4 Signs");
    expect(document.body.textContent).toContain("PO # PO-20507");
    expect(document.body.textContent).toContain("1 item / Not ready");
    expect(document.body.textContent).toContain("View order");
  });

  test("dashboard Active Order shows invoice-style PO fallback when Job exists without PO", () => {
    render(<OrderItem order={order({ jobLabel: "Campus wayfinding refresh", customerPoNumber: null })} />);
    expect(document.body.textContent).toContain("Job: Campus wayfinding refresh");
    expect(document.body.textContent).toContain("PO # —");
    expect(document.body.textContent).not.toContain("null");
  });

  test("dashboard Active Order handles absent optional Job while retaining PO", () => {
    render(<OrderItem order={order({ jobLabel: null, customerPoNumber: "PO-9842" })} />);
    expect(document.body.textContent).toContain("Job: —");
    expect(document.body.textContent).toContain("PO # PO-9842");
    expect(document.body.textContent).not.toContain("undefined");
  });
});
