import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { OrderFulfillmentPanel } from "./OrderFulfillmentPanel";

describe("OrderFulfillmentPanel customer address copy", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.restoreAllMocks();
  });

  function customerAddressButton(): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Use customer address"),
    );
    if (!button) throw new Error("Use customer address button was not rendered");
    return button;
  }

  it.each([
    { method: "pickup" as const, label: "Pickup notes" },
    { method: "ship" as const, label: "Shipping instructions" },
    { method: "deliver" as const, label: "Delivery instructions" },
  ])("Order Entry shows only the relevant $method controls and saves instructions", ({ method, label }) => {
    const onShippingInstructionsChange = jest.fn();
    act(() => root.render(
      <OrderFulfillmentPanel
        presentation="order-entry" mode="quote" parentType="quote"
        fulfillmentMethod={method} canEditOrder isEditingFulfillment
        shippingInstructions="Existing instructions"
        onShippingInstructionsChange={onShippingInstructionsChange}
      />,
    ));
    const instructions = container.querySelector("textarea")!;
    expect(instructions.value).toBe("Existing instructions");
    expect(container.textContent).toContain(label);
    expect(container.textContent?.includes("Ship To")).toBe(method === "ship");
    expect(container.textContent?.includes("Deliver to")).toBe(method === "deliver");
    expect(container.textContent?.includes("Shipping Price")).toBe(method === "ship");
    expect(container.textContent?.includes("Delivery Fee")).toBe(method === "deliver");
    expect(container.textContent).not.toContain("Packing Slip");
    expect(container.textContent).not.toContain("Shipments");
    act(() => { instructions.value = " Updated instructions "; Simulate.blur(instructions); });
    expect(onShippingInstructionsChange).toHaveBeenCalledWith("Updated instructions");
  });

  it("keeps default Quote fulfillment presentation unchanged", () => {
    act(() => root.render(<OrderFulfillmentPanel mode="quote" parentType="quote" fulfillmentMethod="ship" canEditOrder isEditingFulfillment />));
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).toContain("Ship To");
  });

  it("copies the customer shipping address into Ship To", () => {
    const onShipToChange = jest.fn();
    act(() => root.render(
      <OrderFulfillmentPanel
        mode="quote"
        parentType="quote"
        fulfillmentMethod="ship"
        canEditOrder
        isEditingFulfillment
        shipToData={{}}
        onShipToChange={onShipToChange}
        defaultCustomer={{
          companyName: "Acme",
          shippingStreet1: "10 Ship St",
          shippingCity: "Tampa",
          shippingState: "FL",
          shippingPostalCode: "33602",
        }}
      />,
    ));

    act(() => customerAddressButton().click());
    expect(onShipToChange).toHaveBeenCalledWith(expect.objectContaining({
      company: "Acme",
      address1: "10 Ship St",
      city: "Tampa",
      state: "FL",
      postalCode: "33602",
    }));
  });

  it("does not overwrite a manually entered blind-ship address without confirmation", () => {
    const onShipToChange = jest.fn();
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
    act(() => root.render(
      <OrderFulfillmentPanel
        mode="quote"
        parentType="quote"
        fulfillmentMethod="ship"
        canEditOrder
        isEditingFulfillment
        shipToData={{ address1: "Blind Ship Destination" }}
        onShipToChange={onShipToChange}
        defaultCustomer={{ shippingStreet1: "10 Ship St", shippingCity: "Tampa" }}
      />,
    ));

    act(() => customerAddressButton().click());
    expect(confirm).toHaveBeenCalled();
    expect(onShipToChange).not.toHaveBeenCalled();
  });
});
