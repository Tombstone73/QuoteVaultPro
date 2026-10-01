import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/queryClient";
import { ShippingDocumentPrintDialog } from "./ShippingDocumentPrintDialog";
import { readShippingPrinterPreference, saveShippingPrinterPreference, shippingPrinterPreferenceKey } from "@/lib/shippingPrinterPreferences";

const user = { id: "staff", lastActiveOrgId: "org" };
jest.mock("@tanstack/react-query", () => ({ useQuery: jest.fn() }));
jest.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user }) }));
jest.mock("@/lib/queryClient", () => ({ apiFetch: jest.fn() }));
jest.mock("@/components/ui/dialog", () => ({ Dialog: ({ open, children }: any) => open ? <>{children}</> : null, DialogContent: ({ children }: any) => <div>{children}</div>, DialogDescription: ({ children }: any) => <p>{children}</p>, DialogFooter: ({ children }: any) => <footer>{children}</footer>, DialogHeader: ({ children }: any) => <header>{children}</header>, DialogTitle: ({ children }: any) => <h2>{children}</h2> }));
jest.mock("@/components/ui/button", () => ({ Button: ({ children, asChild, variant, size, ...props }: any) => asChild ? children : <button {...props}>{children}</button> }));
jest.mock("@/components/ui/input", () => ({ Input: (props: any) => <input {...props} /> }));
jest.mock("@/components/ui/label", () => ({ Label: (props: any) => <label {...props} /> }));
const destinations = [{ id: "printer", displayName: "Office", location: "Shop", defaultCopies: 2, isDefault: true, available: true, agentVersion: "1.0.25", unavailableReason: null }];
let root: Root, container: HTMLDivElement;
let key = 0;
const queryMock = jest.mocked(useQuery);
const fetchMock = jest.mocked(apiFetch);
const button = (label: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent === label)!;
async function click(label: string) { await act(async () => { button(label).click(); await Promise.resolve(); }); }
async function open(packageId?: string) { await act(async () => { root.render(<ShippingDocumentPrintDialog shipmentId="shipment" documentType="package_ticket" packageId={packageId} />); }); await click("Print Package Tickets"); }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  queryMock.mockReturnValue({ data: destinations, isLoading: false, error: null, refetch: jest.fn() } as any);
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { id: "job", status: "queued" } }) } as any);
  key = 0; Object.defineProperty(globalThis, "crypto", { configurable: true, value: { randomUUID: () => `key-${++key}` } }); localStorage.clear();
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.clearAllMocks(); });
test("full package ticket set uses one request/default copies and explicit preview fallback, no automatic browser printing", async () => {
  await open(); expect((container.querySelector("#shipping-print-copies") as HTMLInputElement).value).toBe("2");
  expect(container.querySelector("a")?.getAttribute("href")).toBe("/fulfillment/shipments/shipment/manifest?documentType=package_ticket");
  expect(fetchMock).not.toHaveBeenCalled(); await click("Queue Print");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith("/api/fulfillment/shipments/shipment/direct-print", expect.objectContaining({ headers: expect.objectContaining({ "Idempotency-Key": "key-1" }), body: JSON.stringify({ documentType: "package_ticket", printerProfileId: "printer", copies: 2, requestKey: "key-1" }) }));
  expect(container.querySelector('[role="status"]')?.textContent).toContain("does not confirm physical printing"); expect(button("Queue Print").disabled).toBe(true);
});
test("failure keeps stable key and payload for Retry Print; edits intentionally get a new key", async () => {
  fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "Connection failed" }) } as any);
  await open("package-a"); await click("Queue Print"); await click("Retry Print");
  const requests = fetchMock.mock.calls.map((call) => JSON.parse(call[1]!.body as string));
  expect(requests[0]).toEqual(requests[1]); expect(requests[0]).toMatchObject({ requestKey: "key-1", packageId: "package-a" });
  act(() => Simulate.change(container.querySelector("#shipping-print-copies")!, { target: { value: "3" } } as any));
  await click("Queue Print"); expect(JSON.parse(fetchMock.mock.calls[2][1]!.body as string)).toMatchObject({ requestKey: "key-2", copies: 3 });
});
test("submitted is distinguished from physically printed and no automatic duplicate request is made", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { status: "submitted" } }) } as any);
  await open(); await click("Queue Print"); expect(container.querySelector('[role="status"]')?.textContent).toBe("Submitted to Windows. Physical printing is not confirmed."); expect(fetchMock).toHaveBeenCalledTimes(1);
});
test("unsupported/outdated destinations disable submission but retain browser fallback", async () => {
  queryMock.mockReturnValue({ data: [{ ...destinations[0], available: false, unavailableReason: "PRINT_AGENT_UPDATE_REQUIRED" }], isLoading: false, error: null, refetch: jest.fn() } as any);
  await open(); expect(button("Queue Print").disabled).toBe(true); expect(container.textContent).toContain("1.0.25 or newer"); expect(container.querySelector("a")).toBeTruthy(); expect(fetchMock).not.toHaveBeenCalled();
});
test("destination loading failure supports retry without queue submission", async () => {
  const refetch = jest.fn(); queryMock.mockReturnValue({ data: undefined, isLoading: false, error: new Error("offline"), refetch } as any);
  await open(); await click("Retry destinations"); expect(refetch).toHaveBeenCalledTimes(1); expect(fetchMock).not.toHaveBeenCalled();
});
test("preferences are user/org/document scoped and do not overwrite existing Traveler or Quick Note keys", () => {
  localStorage.setItem("titanos:traveler:printer-preferences:v1:org_org:user_staff", "traveler-sentinel");
  localStorage.setItem("titanos:quick-note:printer-preferences:v1:org_org:user_staff", "quick-note-sentinel");
  saveShippingPrinterPreference("staff", "org", "packing_slip", "printer");
  expect(readShippingPrinterPreference("staff", "org", "packing_slip").defaultDestinationId).toBe("printer");
  expect(readShippingPrinterPreference("other", "org", "packing_slip").defaultDestinationId).toBeNull();
  expect(readShippingPrinterPreference("staff", "foreign", "packing_slip").defaultDestinationId).toBeNull();
  expect(readShippingPrinterPreference("staff", "org", "shipment_manifest").defaultDestinationId).toBeNull();
  expect(localStorage.getItem("titanos:traveler:printer-preferences:v1:org_org:user_staff")).toBe("traveler-sentinel");
  expect(localStorage.getItem("titanos:quick-note:printer-preferences:v1:org_org:user_staff")).toBe("quick-note-sentinel");
  localStorage.setItem(shippingPrinterPreferenceKey("staff", "org", "packing_slip"), "broken JSON"); expect(readShippingPrinterPreference("staff", "org", "packing_slip").defaultDestinationId).toBeNull();
});
