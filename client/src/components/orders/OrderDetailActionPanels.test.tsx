import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { TextDecoder, TextEncoder } from "util";
import { OrderStatusPillSelector } from "@/components/OrderStatusPillSelector";
import {
  OrderDetailPrimaryActions,
  OrderDetailSecondaryActions,
} from "@/components/orders/OrderDetailActionPanels";

(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;

const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");

jest.mock("@/hooks/useOrderStatusPills", () => ({
  useOrderStatusPills: () => ({ data: [], isLoading: false }),
  useAssignOrderStatusPill: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock("@/components/StateTransitionButtons", () => ({
  CompleteProductionButton: () => <span>Complete Production</span>,
  CompleteOrderButton: () => <span>Complete Order</span>,
}));

const noop = () => undefined;

describe("Order detail action layout", () => {
  it("keeps live-edit order detail primary actions free of edit, cancel, and proof-bypass controls", () => {
    const html = renderToStaticMarkup(
      <OrderDetailPrimaryActions
        canEditOrder
        canMarkCompleted={false}
        canCompleteProduction={false}
        canCompleteOrder={false}
        orderId="order-1"
        isDirty
        isSavingOrder={false}
        isUpdatingOrder={false}
        isTransitioningStatus={false}
        hasDirtyLineItem={false}
        onSaveOrder={noop}
        onSaveAndRoute={noop}
        onDiscardChanges={noop}
        onMarkCompleted={noop}
      />,
    );

    expect(html).toContain("Save Order");
    expect(html).toContain("Save &amp; Route Eligible");
    expect(html).not.toContain("Edit Order");
    expect(html).not.toContain("Cancel Order");
    expect(html).not.toContain("Bypass Proof");
  });

  it("keeps cancel order and proof bypass available in the secondary action area", () => {
    const html = renderToStaticMarkup(
      <OrderDetailSecondaryActions
        canCancelOrder
        canManageProofPolicy
        proofBypassed={false}
        proofBypassReason=""
        isCancelingOrder={false}
        isUpdatingProofPolicy={false}
        onCancelOrder={noop}
        onProofBypassReasonChange={noop}
        onBypassProof={noop}
        onRequireProofDefaults={noop}
      />,
    );

    expect(html).toContain("Cancel Order");
    expect(html).toContain("Bypass Proof");
  });

  it("uses Complete Order rather than Complete Production for billing-only orders", () => {
    const html = renderToStaticMarkup(
      <OrderDetailPrimaryActions
        canEditOrder={false}
        canMarkCompleted={false}
        canCompleteProduction={false}
        canCompleteOrder
        orderId="order-1"
        isDirty={false}
        isSavingOrder={false}
        isUpdatingOrder={false}
        isTransitioningStatus={false}
        hasDirtyLineItem={false}
        onSaveOrder={noop}
        onSaveAndRoute={noop}
        onDiscardChanges={noop}
        onMarkCompleted={noop}
      />,
    );

    expect(html).toContain("Complete Order");
    expect(html).not.toContain("Complete Production");
  });

  it("does not show the status-pill empty fallback text in normal UI", () => {
    const html = renderToStaticMarkup(
      <OrderStatusPillSelector
        orderId="order-1"
        currentState="open"
        currentPillValue={null}
      />,
    );

    expect(html).not.toContain("No status pills configured for this state");
  });
});
