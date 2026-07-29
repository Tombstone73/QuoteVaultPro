import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { jest } from "@jest/globals";

jest.mock("@/lib/apiConfig", () => ({ apiUrl: (path: string) => path }));
jest.mock("./AssistantWorkspaceProvider", () => ({ useAssistantWorkspace: () => ({}) }));

import { ResultCards, responsePresentationForCards } from "./AssistantWorkspace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const context = {
  contextVersion: "v1", route: "/orders/order_1", pageTitle: "Order Details", entityType: "order", entityId: "order_1",
  selectedRecordIds: [], activeFilters: [], capturedAt: "2026-07-21T12:00:00.000Z", unsavedChanges: false,
} as const;

function render(cards: any[], options: { diagnosticsEnabled?: boolean; correlationId?: string; dispatchDiagnostic?: any; presentation?: any; responseState?: any; onRetry?: () => void; onSubmitSuggestion?: (prompt: string) => void } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<ResultCards cards={cards as any} context={context as any} onCancelPlan={() => Promise.resolve()} onConfirmPlan={() => Promise.resolve()} onCreatePlan={() => Promise.resolve()} executionPlans={{}} {...options} />));
  return { container, root };
}

describe("Assistant workspace presentation", () => {
  afterEach(() => document.body.innerHTML = "");

  test("keeps current-record answers conversational and hides the tool name", () => {
    const { container, root } = render([
      { kind: "current_context", title: "navigation.get_current_context", summary: "You're viewing Order ORD-20003 for T3 Signs.", sourceLinks: [{ label: "View order", href: "/orders/order_1" }] },
    ], { presentation: "conversational" });
    expect(container.textContent).toContain("View order");
    expect(container.textContent).not.toContain("navigation.get_current_context");
    expect(container.textContent).not.toContain("Response presentation");
    act(() => root.unmount());
  });

  test("renders search results as compact rows while retaining server presentation metadata", () => {
    const cards = [
      { kind: "search_results", title: "search.global", summary: "I found one matching record.", sourceLinks: [], details: { matches: [{ label: "Order ORD-20003", status: "In Production", sourceLink: { label: "Order ORD-20003", href: "/orders/order_1" } }] } },
    ];
    const { container, root } = render(cards, { presentation: "collection" });
    expect(responsePresentationForCards("collection")).toBe("collection");
    expect(container.textContent).toContain("Order ORD-20003");
    expect(container.textContent).not.toContain("search.global");
    act(() => root.unmount());
  });

  test("keeps diagnostic tool names and correlation IDs behind authorized disclosure", () => {
    const cards = [
      { kind: "provider_unavailable", title: "navigation.get_current_context", summary: "I couldn't safely interpret that request.", sourceLinks: [], toolStatus: "failed" },
    ];
    const normal = render(cards, { presentation: "diagnostic", responseState: { kind: "retryable_failure", retryable: true, diagnosticsAvailable: true } });
    expect(normal.container.textContent).not.toContain("navigation.get_current_context");
    expect(normal.container.textContent).not.toContain("corr_123");
    act(() => normal.root.unmount());

    const authorized = render(cards, { diagnosticsEnabled: true, correlationId: "corr_123", dispatchDiagnostic: { routeEntered: true, assistantServiceEntered: true, dispatcherEntered: true, productManagementInvoked: true, productManagementHandled: false, finalSkill: "planner", finalTool: "production.get_queue_summary" }, presentation: "diagnostic", responseState: { kind: "retryable_failure", retryable: true, diagnosticsAvailable: true } });
    expect(authorized.container.textContent).toContain("Show diagnostics");
    const button = authorized.container.querySelector("button") as HTMLButtonElement;
    act(() => button.click());
    expect(authorized.container.textContent).toContain("navigation.get_current_context");
    expect(authorized.container.textContent).toContain("corr_123");
    expect(authorized.container.textContent).toContain("final=planner/production.get_queue_summary");
    act(() => authorized.root.unmount());
  });

  test("does not offer retry or diagnostics for a successful capability answer", () => {
    const { container, root } = render([
      { kind: "notice", title: "Assistant capabilities", body: "I can help with lookups.", tone: "info" },
    ], {
      diagnosticsEnabled: true,
      presentation: "conversational",
      responseState: { kind: "success", retryable: false, diagnosticsAvailable: false },
      onRetry: () => undefined,
    });
    expect(container.textContent).not.toContain("Try again");
    expect(container.textContent).not.toContain("Show diagnostics");
    act(() => root.unmount());
  });

  test("offers retry only for a retryable failed response", () => {
    const { container, root } = render([
      { kind: "provider_unavailable", title: "Planner unavailable", summary: "Please retry.", sourceLinks: [], toolStatus: "failed" },
    ], {
      presentation: "diagnostic",
      responseState: { kind: "retryable_failure", retryable: true, diagnosticsAvailable: true },
      onRetry: () => undefined,
    });
    expect(container.textContent).toContain("Try again");
    act(() => root.unmount());
  });

  test("groups production rows by order while preserving line identity and honest progress", () => {
    const rows = [
      { productionJobId: "job-1", orderId: "order-1", orderNumber: "ORD-20002", customerName: "T3 Signs", orderLineItemId: "line-1", lineItemSequence: 1, lineItemLabel: "ACM sign", orderedQuantity: 1, completedQuantity: 0, remainingQuantity: 1, quantityUnit: "prints", stationLabel: "Flatbed", productionStatus: "Queued", dueState: "overdue", orderSourceLink: { label: "View order", href: "/orders/order-1" }, productionJobSourceLink: { label: "View job", href: "/production/jobs/job-1" } },
      { productionJobId: "job-2", orderId: "order-1", orderNumber: "ORD-20002", customerName: "T3 Signs", orderLineItemId: "line-2", lineItemSequence: 2, lineItemLabel: "ACM sign", orderedQuantity: 2, completedQuantity: 1, remainingQuantity: 1, quantityUnit: "prints", stationLabel: "Flatbed", productionStatus: "Queued", dueState: "overdue", orderSourceLink: { label: "View order", href: "/orders/order-1" }, productionJobSourceLink: { label: "View job", href: "/production/jobs/job-2" } },
      { productionJobId: "job-3", orderId: "order-1", orderNumber: "ORD-20002", orderLineItemId: "line-3", lineItemSequence: 3, lineItemLabel: "Packaging", stationLabel: "Fulfillment", productionStatus: "Pending", progressAvailable: false, progressWarning: "No canonical completed-print source", orderSourceLink: { label: "View order", href: "/orders/order-1" }, productionJobSourceLink: { label: "View job", href: "/production/jobs/job-3" } },
      { productionJobId: "job-4", orderId: "order-1", orderNumber: "ORD-20002", orderLineItemId: "line-4", lineItemSequence: 4, lineItemLabel: "Banner", orderedQuantity: 4, completedQuantity: 4, remainingQuantity: 0, quantityUnit: "prints", stationLabel: "Flatbed", productionStatus: "Done", orderSourceLink: { label: "View order", href: "/orders/order-1" }, productionJobSourceLink: { label: "View job", href: "/production/jobs/job-4" } },
      { productionJobId: "job-5", orderId: "order-1", orderNumber: "ORD-20002", orderLineItemId: "line-5", lineItemSequence: 5, lineItemLabel: "Yard sign", orderedQuantity: 3, completedQuantity: 1, remainingQuantity: 2, quantityUnit: "prints", stationLabel: "Flatbed", productionStatus: "In production", orderSourceLink: { label: "View order", href: "/orders/order-1" }, productionJobSourceLink: { label: "View job", href: "/production/jobs/job-5" } },
    ];
    const { container, root } = render([
      { kind: "attention_summary", title: "Production attention", summary: "", sourceLinks: [{ label: "View order", href: "/orders/order-1" }], details: { attentionItems: rows } },
    ], { presentation: "analytical" });

    expect(container.textContent).toContain("Order ORD-20002 · T3 Signs");
    expect(container.textContent).toContain("Line 1 · ACM sign");
    expect(container.textContent).toContain("Line 2 · ACM sign");
    expect(container.textContent).toContain("Ordered: 2 prints · Completed: 1 prints · Remaining: 1 prints");
    expect(container.textContent).toContain("Print progress unavailable · No canonical completed-print source");
    expect(container.querySelectorAll('a[href="/orders/order-1"]')).toHaveLength(1);
    expect(container.querySelectorAll('a[href^="/production/jobs/"]')).toHaveLength(5);
    act(() => root.unmount());
  });

  test("renders a useful operational order card and submits suggested prompts as normal messages", () => {
    const onSubmitSuggestion = jest.fn();
    const { container, root } = render([
      {
        kind: "order_summary", title: "Order summary", summary: "Order 20002 is in production.", sourceLinks: [{ label: "Order 20002", href: "/orders/order-1" }],
        details: {
          operational: {
            priority: "rush", fulfillmentStatus: "pending", billingStatus: "not_ready", orderTotal: 1240,
            lineItems: [{ sequence: 1, label: "ACM panel", productName: "ACM", materialName: "Aluminum composite", orderedPieces: 3, dimensions: { widthInches: 24, heightInches: 48 }, finishedSquareFeet: 24, sidedness: "double_sided", status: "in_production", workflowState: "production", stations: ["Flatbed"] }],
            production: { totalJobs: 1, queuedJobs: 0, inProductionJobs: 1, completedJobs: 0, stations: [{ stationLabel: "Flatbed", jobCount: 1 }], printProgressAvailable: false, printProgressWarning: "Authoritative print completion is unavailable." },
          },
          suggestedPrompts: [{ id: "show_line_item_details", label: "Show line-item details", prompt: "Show line-item details for Order 20002.", intent: "lookup", presentationPriority: 1 }],
        },
      },
    ], { presentation: "record_summary", onSubmitSuggestion });
    expect(container.textContent).toContain("24 finished sq ft");
    const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === "Show line-item details") as HTMLButtonElement;
    act(() => button.click());
    expect(onSubmitSuggestion).toHaveBeenCalledWith("Show line-item details for Order 20002.");
    expect(container.textContent).toContain("Authoritative print completion is unavailable.");
    act(() => root.unmount());
  });

  test("submits server-provided due-summary suggestions as normal messages", () => {
    const onSubmitSuggestion = jest.fn();
    const { container, root } = render([
      {
        kind: "order_due_summary", title: "Order due summary", summary: "2 orders are overdue.", sourceLinks: [{ label: "Order ORD-20002", href: "/orders/order-1" }],
        details: { suggestedPrompts: [{ id: "show-incomplete-lines", label: "Show incomplete line items", prompt: "Show incomplete line items for overdue orders.", intent: "production_reporting", presentationPriority: 1 }] },
      },
    ], { presentation: "analytical", onSubmitSuggestion });
    const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === "Show incomplete line items") as HTMLButtonElement;
    act(() => button.click());
    expect(onSubmitSuggestion).toHaveBeenCalledWith("Show incomplete line items for overdue orders.");
    act(() => root.unmount());
  });
});
