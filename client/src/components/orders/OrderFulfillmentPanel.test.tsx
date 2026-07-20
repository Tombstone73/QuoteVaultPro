import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
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
