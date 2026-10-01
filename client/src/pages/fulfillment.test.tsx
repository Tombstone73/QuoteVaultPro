import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { TextEncoder, TextDecoder } from "util";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;
let queryFilters: any;
const navigate = jest.fn();
jest.mock("react-router-dom", () => ({ useNavigate: () => navigate, useLocation: () => ({ pathname: "/fulfillment", search: "" }) }));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("@/hooks/useShipments", () => ({}));
jest.mock("@/lib/getThumbSrc", () => ({}));
jest.mock("@/lib/fulfillmentArtwork", () => ({}));
jest.mock("@/components/PackingSlipModal", () => ({}));
jest.mock("@/components/production/PrintTicketButton", () => ({}));
jest.mock("@/components/fulfillment/FulfillmentDebugPanel", () => ({ FulfillmentDebugPanel: () => null }));
jest.mock("@/hooks/useFulfillment", () => ({
  useCreateShipmentMutation: () => ({ isPending: false }),
  useCreatePickupTicketMutation: () => ({ isPending: false }),
  useFulfillmentQueueQuery: (filters: any) => {
    queryFilters = filters;
    return { isLoading: false, data: { total: filters.showArchived ? 1 : 0, rows: filters.showArchived ? [{ orderId: "order-20306", orderNumber: "20306", customerName: "DG Graphics", fulfillmentType: "SHIP", status: "DELIVERED", remainingQuantity: 0, shippedQuantity: 10, pickedUpQuantity: 0, readySince: null, shipTo: "Indianapolis", isHistorical: true, isArchived: true }] : [] } };
  },
}));
const Page = require("./fulfillment").default;

test("historical search enables discoverable correction navigation without active actions or dead More Filters", () => {
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<Page />));
  expect(container.textContent).not.toContain("More Filters");
  expect(container.textContent).toContain("No active fulfillment work");
  const historyToggle = Array.from(container.querySelectorAll("label")).find(label => label.textContent?.includes("Show Archived"))!.querySelector("input")!;
  act(() => Simulate.change(historyToggle, { target: { checked: true } } as any));
  const search = container.querySelector('input[type="text"]')!;
  act(() => Simulate.change(search, { target: { value: "20306" } } as any));
  expect(queryFilters).toMatchObject({ showArchived: true, search: "20306", type: "all", status: "all" });
  expect(container.textContent).toContain("Delivered");
  expect(container.textContent).toContain("Historical");
  expect((container.querySelector('tbody input[type="checkbox"]') as HTMLInputElement).disabled).toBe(true);
  const action = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "View history / corrections")!;
  act(() => Simulate.click(action));
  expect(navigate).toHaveBeenCalledWith("/fulfillment/orders/order-20306", expect.anything());
  act(() => root.unmount()); container.remove();
});
