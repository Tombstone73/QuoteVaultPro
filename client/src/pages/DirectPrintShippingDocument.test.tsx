import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/queryClient";
import Page from "./DirectPrintShippingDocument";

let jobId = "job";
jest.mock("react-router-dom", () => ({ useParams: () => ({ jobId }) }));
jest.mock("@tanstack/react-query", () => ({ useQuery: jest.fn() }));
jest.mock("@/lib/queryClient", () => ({ apiFetch: jest.fn() }));
const party = { name: "Approved", company: null, address1: "123 Street", address2: null, city: "City", state: "CA", postalCode: "10000", country: "US", phone: null, email: null };
const source = { version: 1, basis: "draft", capturedAt: "2026-10-01T18:00:00Z", organizationId: "org", shipmentId: "shipment", shipmentReference: "SH-1", shipDate: null, carrier: null, serviceLevel: null, trackingNumber: null, destination: party, sender: party, blindShipping: false, orders: [], lines: [], internalNotes: "PRIVATE_NOTES", packages: [1, 2].map((ordinal) => ({ id: `pkg-${ordinal}`, ordinal, packageReference: `PACKAGE_${ordinal}`, weightLbs: null, dimLengthIn: null, dimWidthIn: null, dimHeightIn: null, internalNotes: null, lines: [] })) };
const data = { jobId: "job", documentType: "package_ticket", packageId: null, copies: 1, source };
let root: Root, container: HTMLDivElement;
const queryMock = jest.mocked(useQuery);
const frames = () => new Promise((resolve) => setTimeout(resolve, 50));
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jobId = "job"; container = document.createElement("div"); root = createRoot(container); queryMock.mockReturnValue({ data, error: null } as any); jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => window.setTimeout(() => callback(0), 0)); });
afterEach(() => { act(() => root.unmount()); container.remove(); jest.restoreAllMocks(); jest.clearAllMocks(); });
async function render() { await act(async () => { root.render(<Page />); }); }
function setDocument(ready: Promise<any>, image?: HTMLImageElement) {
  const frame = container.querySelector("iframe")!;
  const document = window.document.implementation.createHTMLDocument("print");
  document.head.innerHTML = "<style>.ticket{break-after:page}</style>";
  document.body.innerHTML = '<section class="ticket">PACKAGE_1</section><section class="ticket">PACKAGE_2</section>';
  Object.defineProperty(document, "fonts", { value: { ready } }); if (image) document.body.appendChild(image);
  Object.defineProperty(frame, "contentDocument", { value: document, configurable: true }); return frame;
}
test("waits for iframe fonts/images/pages, publishes exact job/type readiness, and prints top-level full page set", async () => {
  await render(); let fontsReady!: () => void; const fonts = new Promise<void>((resolve) => { fontsReady = resolve; });
  const image = document.createElement("img"); Object.defineProperty(image, "complete", { value: false });
  const frame = setDocument(fonts, image); act(() => Simulate.load(frame));
  expect(container.querySelector("main")?.getAttribute("data-print-ready")).toBe("false");
  await act(async () => { fontsReady(); await frames(); }); expect(container.querySelector("main")?.getAttribute("data-print-ready")).toBe("false");
  await act(async () => { image.dispatchEvent(new Event("load")); await frames(); });
  const main = container.querySelector("main")!; expect(main.dataset.printReady).toBe("true"); expect(main.dataset.printJobId).toBe("job"); expect(main.dataset.printDocumentType).toBe("package_ticket");
  expect(container.querySelectorAll("[data-print-pages] .ticket")).toHaveLength(2); expect(container.querySelector("[data-print-pages]")?.textContent).toContain("PACKAGE_2");
});
test("asset failure publishes error, never ready", async () => {
  await render(); const image = document.createElement("img"); Object.defineProperty(image, "complete", { value: false }); const frame = setDocument(Promise.resolve(), image);
  act(() => Simulate.load(frame)); await act(frames); await act(async () => { image.dispatchEvent(new Event("error")); await frames(); });
  expect(container.querySelector("main")?.dataset.printError).toBe("true"); expect(container.querySelector("main")?.dataset.printReady).toBe("false");
});
test("source errors and invalid IDs reveal no document content and never mark ready", async () => {
  queryMock.mockReturnValue({ data: undefined, error: new Error("401") } as any); await render(); expect(container.querySelector("iframe")).toBeNull(); expect(container.querySelector("main")?.dataset.printError).toBe("true");
  jobId = "../not-a-job"; queryMock.mockReturnValue({ data: undefined, error: null } as any); await render(); expect((queryMock.mock.calls.at(-1)![0] as any).enabled).toBe(false); expect(container.querySelector("iframe")).toBeNull();
});
test("query uses only claimed endpoint and rejects foreign job/type/malformed source", async () => {
  await render(); const queryFn = (queryMock.mock.calls[0][0] as any).queryFn;
  jest.mocked(apiFetch).mockResolvedValue({ ok: true, json: async () => ({ data }) } as any);
  await expect(queryFn({ signal: undefined })).resolves.toMatchObject({ jobId: "job" });
  expect(apiFetch).toHaveBeenCalledWith("/api/local-bridge/direct-print/jobs/job/document", { signal: undefined });
  for (const invalid of [{ ...data, jobId: "foreign" }, { ...data, documentType: "traveler" }, { ...data, source: {} }, { ...data, packageId: "foreign" }]) {
    jest.mocked(apiFetch).mockResolvedValue({ ok: true, json: async () => ({ data: invalid }) } as any); await expect(queryFn({ signal: undefined })).rejects.toThrow();
  }
});
test("packing source HTML excludes notes and never performs an operator URL fetch", async () => {
  queryMock.mockReturnValue({ data: { ...data, documentType: "packing_slip" }, error: null } as any); await render(); expect(container.querySelector("iframe")!.srcdoc).not.toContain("PRIVATE_NOTES"); expect(apiFetch).not.toHaveBeenCalled();
});
