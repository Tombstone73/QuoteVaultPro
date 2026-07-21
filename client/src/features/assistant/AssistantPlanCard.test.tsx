import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantPlanCard, getPlanExpirationText, isPlanStaleForContext, toAssistantPlanCardModel } from "./AssistantPlanCard";
import { buildSafeAssistantContext } from "./assistantWorkspaceCore";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const planCard = {
  kind: "action_plan",
  title: "Proposed customer update",
  plan: {
    id: "plan-1",
    action: "customers.update",
    status: "awaiting_confirmation",
    planVersion: 1,
    riskLevel: "high",
    preview: {
      summary: "Update the requested customer record.",
      affectedEntities: [
        { entityId: "customer-1", entityType: "customer", label: "Acme", sourceLink: { href: "/customers/customer-1" } },
        { entityId: "unsafe", entityType: "customer", label: "Unsafe link", sourceLink: { href: "javascript:alert(1)" } },
      ],
      sideEffects: [{ label: "Customer record", description: "One record would change." }],
      undo: { available: false, label: null, expiresAt: null },
    },
    missingInformation: [{ field: "reason", label: "Reason", description: "Explain why this action is needed." }],
    expiresAt: "2030-01-01T00:10:00.000Z",
    contextBinding: { route: "/customers/customer-1", entityType: "customer", entityId: "customer-1" },
    cancellationAvailable: true,
    steps: [{ id: "step-1", label: "Validate record", status: "pending" }],
  },
};

describe("AssistantPlanCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("adapts only bounded preview fields and rejects unsafe record links", () => {
    const model = toAssistantPlanCardModel(planCard);
    expect(model).toMatchObject({ id: "plan-1", riskLevel: "high", preview: "Update the requested customer record." });
    expect(model?.affectedEntities).toEqual([
      { id: "customer-1", type: "customer", label: "Acme", href: "/customers/customer-1" },
      { id: "unsafe", type: "customer", label: "Unsafe link", href: null },
    ]);
    expect(model?.sideEffects).toEqual(["One record would change."]);
    expect(model?.missingInformation).toEqual(["Reason: Explain why this action is needed."]);
    expect(toAssistantPlanCardModel({ kind: "action_plan", plan: { action: "no-id" } })).toBeNull();
  });

  it("marks a context-bound plan stale after navigation without changing server state", () => {
    const model = toAssistantPlanCardModel(planCard)!;
    expect(isPlanStaleForContext(model, buildSafeAssistantContext("/customers/customer-1", "Customer"))).toBe(false);
    expect(isPlanStaleForContext(model, buildSafeAssistantContext("/orders/order-1", "Order"))).toBe(true);
  });

  it("renders text-based risk, expiration, progress, and a cancel-only control", () => {
    act(() => root.render(<AssistantPlanCard card={planCard} context={buildSafeAssistantContext("/customers/customer-1", "Customer")} onCancel={() => undefined} />));
    const html = container.innerHTML;
    expect(html).toContain("Risk: high");
    expect(html).toContain("Expires in");
    expect(html).toContain("Execution status");
    expect(html).toContain("Cancel plan");
    expect(html).not.toMatch(/<button[^>]*>[^<]*(GO|Execute|Confirm)/i);
  });

  it("reports expiration accessibly without relying on a color", () => {
    expect(getPlanExpirationText("2030-01-01T00:00:01.000Z", Date.parse("2030-01-01T00:00:00.000Z"))).toBe("Expires in 1 minute");
    expect(getPlanExpirationText("2030-01-01T00:00:00.000Z", Date.parse("2030-01-01T00:00:01.000Z"))).toBe("Expired");
  });
});
