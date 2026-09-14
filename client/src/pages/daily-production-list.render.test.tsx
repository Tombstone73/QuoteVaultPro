/** @jest-environment jsdom */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { TextEncoder, TextDecoder } from "util";

Object.assign(globalThis, { TextEncoder, TextDecoder });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apiRequest = jest.fn();
jest.mock("@/lib/queryClient", () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));

const { MemoryRouter } = require("react-router-dom");
const DailyProductionListPage = require("./daily-production-list").default;

const report = {
  organizationName: "Titan Graphics",
  asOf: "2026-09-14",
  timezone: "America/Indiana/Indianapolis",
  summary: { open: 2, dueToday: 1, dueTomorrow: 0, overdue: 1, noDueDate: 0 },
  diagnostics: { unclassifiedProductionLines: 1, mixedOrders: 0, nonstandardFulfillmentOrders: 0, activeOrdersOutsideReportStatus: 0 },
  overview: [{ orderId: "1", orderNumber: "1001", customerName: "Acme", jobLabel: "Lobby", poNumber: "PO-1", dueDate: "2026-09-14", dueState: "today", quantity: 2, destination: "roll", fulfillment: "Ship" }],
  roll: [{ orderId: "1", orderNumber: "1001", customerName: "Acme", jobLabel: "Lobby", poNumber: "PO-1", dueDate: "2026-09-14", dueState: "today", quantity: 2, destination: "roll", fulfillment: "Ship" }],
  flatbed: [],
};

describe("Daily Production List renderer", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    apiRequest.mockResolvedValue({ json: async () => ({ success: true, data: report }) });
    (window as any).print = jest.fn();
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); jest.clearAllMocks(); });

  test("renders the operational report, print control, urgency, and print CSS", async () => {
    await act(async () => { root.render(<MemoryRouter><DailyProductionListPage /></MemoryRouter>); });
    expect(container.textContent).toContain("OPEN PRODUCTION REPORT");
    expect(container.textContent).toContain("DUE TODAY");
    expect(container.textContent).toContain("Unclassified");
    expect(container.querySelector("a")?.textContent).toContain("Reports");
    expect(container.querySelector("style")?.textContent).toContain("@page { size: letter portrait");
    const printButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Print"));
    act(() => printButton?.click());
    expect(window.print).toHaveBeenCalledTimes(1);
  });
});
