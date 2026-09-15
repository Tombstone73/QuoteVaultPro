/** @jest-environment jsdom */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { TextDecoder, TextEncoder } from "util";

Object.assign(globalThis, { TextEncoder, TextDecoder });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apiRequest = jest.fn();
const apiFetchBlob = jest.fn();
jest.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
  apiFetchBlob: (...args: unknown[]) => apiFetchBlob(...args),
}));

const { MemoryRouter } = require("react-router-dom");
const DailyProductionListPage = require("./daily-production-list").default;

const report = {
  organizationName: "Titan Graphics", asOf: "2026-09-14", timezone: "America/Indiana/Indianapolis",
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
    apiFetchBlob.mockResolvedValue(new Blob(["%PDF-fixture"], { type: "application/pdf" }));
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: jest.fn(() => "blob:daily-production") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: jest.fn() });
    window.open = jest.fn(() => ({ location: { replace: jest.fn() }, close: jest.fn() })) as any;
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); jest.clearAllMocks(); });

  test("renders the operational report, urgency, and generated-PDF action", async () => {
    await act(async () => { root.render(<MemoryRouter><DailyProductionListPage /></MemoryRouter>); });
    expect(container.textContent).toContain("OPEN PRODUCTION REPORT");
    expect(container.textContent).toContain("DUE TODAY");
    expect(container.textContent).toContain("Unclassified");
    const printButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Print"));
    await act(async () => { printButton?.click(); });
    expect(apiFetchBlob).toHaveBeenCalledWith("/api/reports/daily-production/pdf", { method: "GET" });
    expect(window.open).toHaveBeenCalledWith("", "_blank");
    expect(container.textContent).not.toContain("Browser Print");
  });

  test("uses the requested Overview and breakdown columns", async () => {
    await act(async () => { root.render(<MemoryRouter><DailyProductionListPage /></MemoryRouter>); });
    expect(container.querySelector("thead")?.textContent).toContain("Roll / Flatbed");
    const breakdown = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Production Breakdown");
    await act(async () => { breakdown?.click(); });
    const sections = Array.from(container.querySelectorAll("section.daily-production-section"));
    expect(sections).toHaveLength(2);
    for (const section of sections) {
      expect(section.textContent).not.toContain("Roll / Flatbed");
      expect(section.textContent).not.toContain("Production");
      expect(section.textContent).toContain("Fulfillment");
    }
  });
});
