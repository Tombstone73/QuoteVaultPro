import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { useQuery } from "@tanstack/react-query";

let mockSearchParams = new URLSearchParams();
const mockUseStationPrinter = jest.fn();
const mockApiFetch = jest.fn();

jest.mock("react-router-dom", () => ({
  useParams: () => ({ orderId: "order-xyz" }),
  useSearchParams: () => [mockSearchParams],
}));

jest.mock("@tanstack/react-query", () => ({ useQuery: jest.fn() }));
jest.mock("qrcode", () => ({ __esModule: true, default: { toDataURL: jest.fn(async () => "data:image/png;base64,qr") } }));
jest.mock("@/hooks/useStationPrinter", () => ({ useStationPrinter: mockUseStationPrinter }));
jest.mock("@/hooks/usePrinterProfiles", () => ({ markPrinterProfileUsed: jest.fn() }));
jest.mock("@/hooks/useProduction", () => ({ logTravelerPrint: jest.fn() }));
jest.mock("@/components/production/PrinterPicker", () => ({ PrinterPicker: () => null }));
jest.mock("@/lib/queryClient", () => ({ apiFetch: mockApiFetch }));

import OrderTravelerPage from "./order-traveler";
import { travelerBrowserPrintUrl } from "@/components/production/TravelerPrintDialog";

const useQueryMock = jest.mocked(useQuery);
const travelerSource = {
  orderId: "order-xyz",
  orderNumber: "SO-1042",
  poNumber: "PO-7788",
  jobLabel: "Front Lobby Signs",
  customerName: "Acme Signs Inc.",
  contactName: "Jane Doe",
  dueDate: "2026-05-22T00:00:00.000Z",
  priority: "normal",
  internalNotes: "Pickup, not shipping",
  lineItems: [{ description: "Yard sign", quantity: 25, size: "24 × 18", material: "Coroplast", productionNotes: "Grommets" }],
};

let container: HTMLDivElement;
let root: Root;

async function renderTraveler(params = new URLSearchParams()) {
  mockSearchParams = params;
  useQueryMock.mockReturnValue({ data: travelerSource, isLoading: false, error: null } as any);
  await act(async () => {
    root.render(<OrderTravelerPage />);
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  useQueryMock.mockReset();
  mockUseStationPrinter.mockReturnValue({ profiles: [], selectedProfile: null });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.clearAllMocks();
});

describe("OrderTravelerPage print-only notes", () => {
  test("omits the Print Note section when no note is supplied", async () => {
    await renderTraveler();
    expect(container.querySelector('[data-testid="traveler-print-note"]')).toBeNull();
    expect(container.querySelector('[data-traveler-ready="true"]')).toBeTruthy();
  });

  test("renders the exact browser-print note after line items and before the QR footer", async () => {
    const note = "This is a note for the traveler ticket handwritten notes section";
    const browserUrl = new URL(travelerBrowserPrintUrl("order-xyz", note), "https://printershero.test");
    expect(browserUrl.searchParams.get("printNote")).toBe(note);

    await renderTraveler(browserUrl.searchParams);

    const printArea = container.querySelector('[data-traveler-ready="true"]');
    expect(printArea?.textContent).toContain(note);
    expect(container.querySelector('[data-testid="traveler-print-note"]')?.textContent).toContain(note);
    const content = printArea?.textContent || "";
    expect(content.indexOf("Line Items")).toBeLessThan(content.indexOf(note));
    expect(content.indexOf(note)).toBeLessThan(content.indexOf("Scan to open order in Printers Hero"));
  });

  test("renders the same multi-line punctuation note for a claimed-agent Traveler URL", async () => {
    const note = "Check trim & color\nCall O'Brien before pickup.";
    await renderTraveler(new URLSearchParams({ directPrintJobId: "claimed-job", printNote: note }));

    const noteElement = container.querySelector('[data-testid="traveler-print-note"]');
    expect(noteElement?.textContent).toContain(note);
    expect(Array.from(noteElement?.querySelectorAll("div") ?? []).some((element) => (element as HTMLElement).style.whiteSpace === "pre-wrap")).toBe(true);
    expect(container.querySelector('[data-traveler-ready="true"]')).toBeTruthy();
    expect(container.textContent).toContain("Scan to open order in Printers Hero");
    expect(container.textContent).not.toContain("Print Traveler");
    expect(mockUseStationPrinter).not.toHaveBeenCalled();
  });

  test("uses only the claimed-job source for direct print and does not mark ready before data renders", async () => {
    const params = new URLSearchParams({ directPrintJobId: "job-1" });
    await renderTraveler(params);

    const queryOptions = useQueryMock.mock.calls[0][0] as any;
    mockApiFetch.mockResolvedValue({ ok: true, json: async () => ({ data: travelerSource }) });
    await expect(queryOptions.queryFn()).resolves.toEqual(travelerSource);
    expect(mockApiFetch).toHaveBeenCalledWith("/api/local-bridge/direct-print/jobs/job-1/traveler");
    expect(queryOptions.queryKey).toEqual(["/api/orders", "order-xyz", "traveler", "job-1"]);
    expect(mockUseStationPrinter).not.toHaveBeenCalled();

    useQueryMock.mockReturnValue({ data: undefined, isLoading: true, error: null } as any);
    await act(async () => root.render(<OrderTravelerPage />));
    expect(container.querySelector('[data-traveler-ready="true"]')).toBeNull();
  });

  test("adds the job snapshot feed to the standard spacer only for direct printing", async () => {
    await renderTraveler(new URLSearchParams({ directPrintJobId: "job-feed", feedMm: "12.7" }));
    const directArea = container.querySelector('[data-traveler-ready="true"]') as HTMLElement;
    expect(directArea.style.getPropertyValue("--thermal-feed-spacer")).toBe("50.8mm");

    await renderTraveler();
    const browserArea = container.querySelector('[data-traveler-ready="true"]') as HTMLElement;
    expect(browserArea.style.getPropertyValue("--thermal-feed-spacer")).toBe("1.5in");
  });
});
