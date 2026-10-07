import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { DetailUtilitySection } from "./DetailSurface";
import { OrderFulfillmentPanel } from "./OrderFulfillmentPanel";

describe("shared detail supporting panel", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  test("keeps the Quote action portal mounted while the panel is collapsed", () => {
    act(() => root.render(<DetailUtilitySection title="Secondary Actions" forceMount><div data-testid="action-target" /></DetailUtilitySection>));
    expect(host.querySelector('[data-testid="action-target"]')).not.toBeNull();
    expect(host.querySelector("button")?.textContent).toContain("Secondary Actions");
  });

  test("Quote fulfillment uses the Order detail disclosure without duplicating internal notes", () => {
    act(() => root.render(<OrderFulfillmentPanel presentation="order-detail" mode="quote" parentType="quote" fulfillmentMethod="pickup" shippingInstructions="Dock B" />));
    expect(host.textContent).toContain("Fulfillment");
    expect(host.textContent).toContain("Details");
    expect(host.textContent).not.toContain("Pickup notes");
    act(() => (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Details") as HTMLButtonElement).click());
    expect(host.textContent).toContain("Pickup by customer");
    expect(host.textContent).not.toContain("Pickup notes");
    expect(host.querySelector("textarea")).toBeNull();
  });
});
