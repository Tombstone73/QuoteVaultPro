import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { TextDecoder, TextEncoder } from "util";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;
Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  value: { randomUUID: () => "pickup-request-1" },
});

let detail: any;
const recordHandoff = jest.fn(async (payload: any) => {
  const quantity = Number(payload.items?.[0]?.quantity || 0);
  expect(payload).toMatchObject({ ticketId: "ticket-1", items: [{ orderLineItemId: "stakes", quantity }] });
  const priorPickedUp = Number(detail.lineItems.find((item: any) => item.id === "stakes")?.production.pickedUpQuantity || 0);
  const pickedUp = priorPickedUp + quantity;
  const available = 1000 - pickedUp;
  detail = {
    ...detail,
    fulfilledQuantity: pickedUp,
    eligibleQuantity: available,
    remainingQuantity: 1000 + available,
    lineItems: detail.lineItems.map((item: any) => item.id === "stakes" ? {
      ...item,
      production: { ...item.production, pickedUpQuantity: pickedUp, fulfilledQuantity: pickedUp, eligibleQuantity: available, remainingQuantity: available, blockedQuantity: 0 },
    } : item),
    pickupHandoffs: [...detail.pickupHandoffs, {
      id: `handoff-${detail.pickupHandoffs.length + 1}`,
      handedOffAt: "2026-08-13T23:14:00.000Z",
      handedOffByUserId: "user-1",
      handedOffByName: "Dale",
      notes: null,
      items: [{ orderLineItemId: "stakes", quantity, productName: "Economy Yard Sign Stakes", description: null }],
    }],
  };
  return { terminal: false };
});

jest.mock("@/hooks/useFulfillment", () => ({
  toFulfillmentError: (error: any) => ({ message: error?.message || "Unexpected error" }),
  useFulfillmentOrderDetailQuery: () => ({ data: detail, isLoading: false, isError: false, error: null, refetch: jest.fn(async () => ({ data: detail })) }),
  useCreateShipmentMutation: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useCreatePickupTicketMutation: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useMarkPickupReadyMutation: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useRecordPickupHandoffMutation: () => ({ mutateAsync: recordHandoff, isPending: false }),
}));

jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("@/lib/artworkAccess", () => ({ openArtworkPreview: jest.fn() }));
jest.mock("@/components/artwork/AuthenticatedArtworkThumbnail", () => ({ AuthenticatedArtworkThumbnail: () => <span>Artwork</span> }));
jest.mock("@/pages/fulfillment-shipment-detail", () => ({ FulfillmentShipmentEditor: () => <div>Shipment editor</div> }));

const { MemoryRouter, Route, Routes } = require("react-router-dom") as typeof import("react-router-dom");
const FulfillmentWorkspacePage = require("./fulfillment-workspace").default as typeof import("./fulfillment-workspace").default;

function pickupLine(id: string, name: string, produced: number, available: number, blocked: number) {
  return {
    id,
    productName: name,
    description: null,
    productType: null,
    quantity: 1000,
    size: null,
    materialName: null,
    optionSummary: [],
    finishing: { requirements: [], lamination: null },
    production: {
      jobId: null, stationKey: null, stationLabel: null, status: available ? "ready" : "waiting_on_production",
      completedAt: null, eligible: available > 0, label: available ? "Ready" : "Production in progress", productionRequired: true,
      orderedQuantity: 1000, productionCompleteQuantity: produced, fulfilledQuantity: 0, eligibleQuantity: available,
      blockedQuantity: blocked, shippedQuantity: 0, pickedUpQuantity: 0, remainingQuantity: 1000,
    },
    artwork: [], checklist: { id: "", checked: false, fulfilledQuantity: 0, checkedByUserId: null, checkedAt: null, notes: null },
  };
}

function makeDetail() {
  return {
    orderId: "order-1", orderNumber: "20045", customerName: "Graphic Solutions", fulfillmentType: "PICKUP", status: "PARTIALLY_READY",
    itemsRemaining: "2000 item(s)", physicalLineCount: 2, orderedQuantity: 2000, productionCompleteQuantity: 1000, fulfilledQuantity: 0,
    eligibleQuantity: 1000, blockedQuantity: 1000, shippedQuantity: 0, pickedUpQuantity: 0, remainingQuantity: 2000,
    readySince: null, shipTo: "In-Store", overdue: false, isArchived: false, productionJobs: [],
    customer: { name: "Graphic Solutions", email: null, phone: null },
    lineItems: [pickupLine("coroplast", "Coroplast", 0, 0, 1000), pickupLine("stakes", "Economy Yard Sign Stakes", 1000, 1000, 0)],
    checklistComplete: false, checklistSummary: { total: 0, checked: 0, unchecked: 0 }, productionSummary: [],
    pickupTicket: { id: "ticket-1", status: "READY_FOR_PICKUP", readyAt: null, pickedUpAt: null, stagingLocation: null, pickupNotes: null, contactName: null, contactEmail: null, contactPhone: null },
    pickupHandoffs: [], shipments: [], events: [],
  };
}

function renderWorkspace() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = () => root.render(<MemoryRouter initialEntries={["/fulfillment/orders/order-1"]}><Routes><Route path="/fulfillment/orders/:orderId" element={<FulfillmentWorkspacePage />} /></Routes></MemoryRouter>);
  act(render);
  return { container, root, render };
}

afterEach(() => {
  document.body.innerHTML = "";
  jest.clearAllMocks();
});

describe("FulfillmentWorkspacePage pickup workflow", () => {
  test("renders the active route with quantity-aware partial pickup and immutable history", async () => {
    detail = makeDetail();
    const { container, root, render } = renderWorkspace();

    expect(container.textContent).toContain("Product");
    expect(container.textContent).toContain("Ordered");
    expect(container.textContent).toContain("Produced / Eligible");
    expect(container.textContent).toContain("Picked Up");
    expect(container.textContent).toContain("Available");
    expect(container.textContent).toContain("Pickup Now");
    expect(container.textContent).toContain("All Available");
    expect(container.textContent).toContain("Complete Pickup");
    expect(container.textContent).not.toContain("Ready / physically present");
    expect(container.textContent).not.toContain("Present");
    expect(container.textContent).not.toContain("physically present");
    expect(container.textContent).not.toContain("Mark Ready for Pickup");
    expect(container.textContent).not.toContain("Ordered 1000 · Produced 0");

    const coroplastRow = container.querySelector('[data-testid="pickup-line-coroplast"]') as HTMLTableRowElement;
    const stakesRow = container.querySelector('[data-testid="pickup-line-stakes"]') as HTMLTableRowElement;
    expect(coroplastRow).not.toBeNull();
    expect(stakesRow).not.toBeNull();
    expect(coroplastRow.textContent).toContain("Coroplast");
    expect(coroplastRow.textContent).toContain("Production in progress");
    expect(coroplastRow.textContent).toContain("1000");
    expect(coroplastRow.textContent).toContain("0");
    expect(coroplastRow.querySelector('input[aria-label="Pickup quantity: Coroplast"]')).toBeNull();
    expect(stakesRow.textContent).toContain("Economy Yard Sign Stakes");
    expect(stakesRow.querySelector('[data-testid="pickup-ordered-stakes"]')?.textContent).toBe("1000");
    expect(stakesRow.querySelector('[data-testid="pickup-produced-stakes"]')?.textContent).toBe("1000");
    expect(stakesRow.querySelector('[data-testid="pickup-picked-up-stakes"]')?.textContent).toBe("0");
    expect(stakesRow.querySelector('[data-testid="pickup-available-stakes"]')?.textContent).toBe("1000");

    const stakeInput = container.querySelector('input[aria-label="Pickup quantity: Economy Yard Sign Stakes"]') as HTMLInputElement;
    expect(stakeInput).not.toBeNull();
    expect(stakeInput.min).toBe("0");
    expect(stakeInput.max).toBe("1000");
    await act(async () => { Simulate.click(Array.from(stakesRow.querySelectorAll("button")).find((button) => button.textContent === "All Available")!); });
    expect(stakeInput.value).toBe("1000");
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(stakeInput, "600");
      Simulate.change(stakeInput, { target: { value: "600" } });
    });
    const completeButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Complete Pickup");
    expect(completeButton).toBeDefined();
    await act(async () => { Simulate.click(completeButton!); });
    act(render);

    expect(recordHandoff).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="pickup-picked-up-stakes"]')?.textContent).toBe("600");
    expect(container.querySelector('[data-testid="pickup-available-stakes"]')?.textContent).toBe("400");
    expect(container.textContent).toContain("Pickup History");
    expect(container.textContent).toContain("600 Economy Yard Sign Stakes");
    expect(container.textContent).toContain("Dale");

    const remainingStakeInput = container.querySelector('input[aria-label="Pickup quantity: Economy Yard Sign Stakes"]') as HTMLInputElement;
    expect(remainingStakeInput.value).toBe("");
    expect(remainingStakeInput.max).toBe("400");
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(remainingStakeInput, "400");
      Simulate.change(remainingStakeInput, { target: { value: "400" } });
    });
    await act(async () => { Simulate.click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Complete Pickup")!); });
    act(render);

    expect(recordHandoff).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="pickup-picked-up-stakes"]')?.textContent).toBe("1000");
    expect(container.querySelector('[data-testid="pickup-available-stakes"]')?.textContent).toBe("0");
    expect(container.textContent).toContain("400 Economy Yard Sign Stakes");
    expect(container.querySelectorAll('[data-testid^="pickup-line-"]')).toHaveLength(2);

    act(() => root.unmount());
  });
});
