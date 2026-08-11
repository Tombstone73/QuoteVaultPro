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
  it("renders save, workflow routing, discard, and available cancellation as recognizable controls", () => {
    const html = renderToStaticMarkup(
      <OrderDetailPrimaryActions
        canEditOrder
        canShowCancelOrder
        canCancelOrder
        canMarkCompleted={false}
        canCompleteProduction={false}
        canCompleteOrder={false}
        orderId="order-1"
        isDirty
        isSavingOrder={false}
        isUpdatingOrder={false}
        isTransitioningStatus={false}
        isCancelingOrder={false}
        hasDirtyLineItem={false}
        cancelOrderUnavailableReason={null}
        onSaveOrder={noop}
        onSaveAndRoute={noop}
        onDiscardChanges={noop}
        onCancelOrder={noop}
        onMarkCompleted={noop}
      />,
    );

    expect(html).toContain("Save Order");
    expect(html).toContain("Save &amp; Route Jobs");
    expect(html).toContain("moves eligible line items to Design, Proofing, or Prepress");
    expect(html).toContain("Discard changes");
    expect(html).toContain("Cancel Order");
    expect(html).toContain("border-destructive");
    expect(html).not.toContain("Edit Order");
    expect(html).not.toContain("Bypass Proof");
  });

  it("keeps fulfillment pending orders from hiding cancellation before backend eligibility blocks it", () => {
    const html = renderToStaticMarkup(
      <OrderDetailPrimaryActions
        canEditOrder={false}
        canShowCancelOrder
        canCancelOrder
        canMarkCompleted={false}
        canCompleteProduction={false}
        canCompleteOrder={false}
        orderId="order-fulfillment-pending"
        isDirty={false}
        isSavingOrder={false}
        isUpdatingOrder={false}
        isTransitioningStatus={false}
        isCancelingOrder={false}
        hasDirtyLineItem={false}
        cancelOrderUnavailableReason={null}
        onSaveOrder={noop}
        onSaveAndRoute={noop}
        onDiscardChanges={noop}
        onCancelOrder={noop}
        onMarkCompleted={noop}
      />,
    );

    expect(html).toContain("Cancel Order");
    expect(html).not.toContain("disabled=\"\"");
  });

  it("shows blocked cancellation with the policy reason instead of silently hiding it", () => {
    const html = renderToStaticMarkup(
      <OrderDetailPrimaryActions
        canEditOrder={false}
        canShowCancelOrder
        canCancelOrder={false}
        canMarkCompleted={false}
        canCompleteProduction={false}
        canCompleteOrder={false}
        orderId="order-paid"
        isDirty={false}
        isSavingOrder={false}
        isUpdatingOrder={false}
        isTransitioningStatus={false}
        isCancelingOrder={false}
        hasDirtyLineItem={false}
        cancelOrderUnavailableReason="Cannot cancel because a payment has been recorded. Use the refund workflow."
        onSaveOrder={noop}
        onSaveAndRoute={noop}
        onDiscardChanges={noop}
        onCancelOrder={noop}
        onMarkCompleted={noop}
      />,
    );

    expect(html).toContain("Cancel Order");
    expect(html).toContain("disabled");
    expect(html).toContain("Cannot cancel because a payment has been recorded");
  });

  it("does not offer another cancellation action for an already cancelled order", () => {
    const html = renderToStaticMarkup(
      <OrderDetailPrimaryActions
        canEditOrder={false}
        canShowCancelOrder={false}
        canCancelOrder={false}
        canMarkCompleted={false}
        canCompleteProduction={false}
        canCompleteOrder={false}
        orderId="order-cancelled"
        isDirty={false}
        isSavingOrder={false}
        isUpdatingOrder={false}
        isTransitioningStatus={false}
        isCancelingOrder={false}
        hasDirtyLineItem={false}
        cancelOrderUnavailableReason={null}
        onSaveOrder={noop}
        onSaveAndRoute={noop}
        onDiscardChanges={noop}
        onCancelOrder={noop}
        onMarkCompleted={noop}
      />,
    );

    expect(html).not.toContain("Cancel Order");
  });

  it("keeps proof bypass available in the secondary action area", () => {
    const html = renderToStaticMarkup(
      <OrderDetailSecondaryActions
        canManageProofPolicy
        proofBypassed={false}
        proofBypassReason=""
        isUpdatingProofPolicy={false}
        onProofBypassReasonChange={noop}
        onBypassProof={noop}
        onRequireProofDefaults={noop}
      />,
    );

    expect(html).toContain("Bypass Proof");
  });

  it("uses Complete Order rather than Complete Production for billing-only orders", () => {
    const html = renderToStaticMarkup(
      <OrderDetailPrimaryActions
        canEditOrder={false}
        canShowCancelOrder={false}
        canCancelOrder={false}
        canMarkCompleted={false}
        canCompleteProduction={false}
        canCompleteOrder
        orderId="order-1"
        isDirty={false}
        isSavingOrder={false}
        isUpdatingOrder={false}
        isTransitioningStatus={false}
        isCancelingOrder={false}
        hasDirtyLineItem={false}
        cancelOrderUnavailableReason={null}
        onSaveOrder={noop}
        onSaveAndRoute={noop}
        onDiscardChanges={noop}
        onCancelOrder={noop}
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
