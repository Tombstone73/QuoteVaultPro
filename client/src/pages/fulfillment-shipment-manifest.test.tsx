import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let search = new URLSearchParams();
const apiFetch = jest.fn<Promise<any>, [string, any?]>();
jest.mock("react-router-dom", () => ({ useParams: () => ({ shipmentId: "shipment-1" }), useSearchParams: () => [search] }));
jest.mock("@/lib/queryClient", () => ({ apiFetch: (...args: [string, any?]) => apiFetch(...args) }));
jest.mock("@/components/ui/button", () => ({ Button: (props: any) => <button {...props} /> }));
const Page = require("./fulfillment-shipment-manifest").default;
const party = { name: null, company: "Approved company", address1: "123 Street", address2: null, city: "City", state: null, postalCode: "10000", country: null, phone: null, email: null };
const source = { version: 1, basis: "shipped", capturedAt: "2026-10-01T18:00:00Z", organizationId: "org", shipmentId: "shipment-1", shipmentReference: "SH-1", shipDate: "2026-10-01", carrier: null, serviceLevel: null, trackingNumber: null,
  destination: party, sender: party, blindShipping: false, orders: [{ id: "order", orderNumber: "20538", customerId: "customer", customerName: "PRIVATE_CUSTOMER", poNumber: null }], lines: [], packages: [], internalNotes: "PRIVATE_NOTES" };
const waitForQuery = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => { apiFetch.mockReset(); search = new URLSearchParams(); });

test("default manifest route fetches canonical source and Browser Print explicitly prints isolated iframe only", async () => {
  apiFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: source }) });
  const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><Page /></QueryClientProvider>); await waitForQuery(); });
    await act(waitForQuery);
    expect(apiFetch).toHaveBeenCalledWith("/api/fulfillment/shipments/shipment-1/documents/shipment_manifest", expect.objectContaining({ signal: expect.anything() }));
    const frame = container.querySelector("iframe")!;
    expect(frame).toBeTruthy(); expect(frame.getAttribute("sandbox")).toBe("allow-same-origin allow-modals");
    expect(frame.srcdoc).toContain("Shipment Manifest");
    const print = jest.fn(); const focus = jest.fn();
    Object.defineProperty(frame, "contentWindow", { value: { print, focus } });
    const button = container.querySelector("button")!;
    expect(print).not.toHaveBeenCalled();
    act(() => Simulate.load(frame));
    expect(button.disabled).toBe(false);
    act(() => Simulate.click(button));
    expect(print).toHaveBeenCalledTimes(1); expect(focus).toHaveBeenCalledTimes(1);
  } finally { act(() => root.unmount()); client.clear(); container.remove(); }
});

test("packing slip preview selects distinct endpoint and excludes internal customer/notes", async () => {
  search = new URLSearchParams("documentType=packing_slip");
  apiFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: source }) });
  const container = document.createElement("div"); const root = createRoot(container); const client = new QueryClient();
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><Page /></QueryClientProvider>); await waitForQuery(); });
    await act(waitForQuery);
    expect(apiFetch.mock.calls[0][0].endsWith("/documents/packing_slip")).toBe(true);
    const html = container.querySelector("iframe")!.srcdoc;
    expect(html).toContain("Packing Slip"); expect(html).not.toContain("PRIVATE_CUSTOMER"); expect(html).not.toContain("PRIVATE_NOTES");
  } finally { act(() => root.unmount()); client.clear(); }
});

test("historical unavailable error is preserved and printing remains disabled", async () => {
  apiFetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ success: false, code: "HISTORICAL_SNAPSHOT_UNAVAILABLE", message: "Historical shipping document snapshot unavailable." }) });
  const container = document.createElement("div"); const root = createRoot(container); const client = new QueryClient();
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><Page /></QueryClientProvider>); await waitForQuery(); });
    await act(waitForQuery);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Historical shipping document snapshot unavailable.");
    expect(container.querySelector("iframe")).toBeNull(); expect(container.querySelector("button")!.disabled).toBe(true);
  } finally { act(() => root.unmount()); client.clear(); }
});

test("package selection fetches scoped source and renders only the selected ticket", async () => {
  search = new URLSearchParams("documentType=package_ticket&packageId=package-2");
  const pkg = { ordinal: 1, weightLbs: null, dimLengthIn: null, dimWidthIn: null, dimHeightIn: null, internalNotes: null, lines: [] };
  apiFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { ...source, packages: [{ ...pkg, id: "package-1", packageReference: "NOT_SELECTED" }, { ...pkg, ordinal: 2, id: "package-2", packageReference: "SELECTED_PACKAGE" }] } }) });
  const container = document.createElement("div"); const root = createRoot(container); const client = new QueryClient();
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><Page /></QueryClientProvider>); await waitForQuery(); });
    await act(waitForQuery);
    expect(apiFetch.mock.calls[0][0]).toBe("/api/fulfillment/shipments/shipment-1/documents/package_ticket?packageId=package-2");
    const html = container.querySelector("iframe")!.srcdoc;
    expect(html).toContain("SELECTED_PACKAGE"); expect(html).not.toContain("NOT_SELECTED");
  } finally { act(() => root.unmount()); client.clear(); }
});

test("unsupported document types are explicit errors with no source request", async () => {
  search = new URLSearchParams("documentType=invoice");
  const container = document.createElement("div"); const root = createRoot(container); const client = new QueryClient();
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><Page /></QueryClientProvider>); });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Unsupported shipping document type.");
    expect(container.querySelector("button")!.disabled).toBe(true); expect(apiFetch).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); client.clear(); }
});
