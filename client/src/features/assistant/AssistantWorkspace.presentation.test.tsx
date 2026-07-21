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

function render(cards: any[], options: { diagnosticsEnabled?: boolean; correlationId?: string } = {}) {
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
      { kind: "response_presentation", title: "Response presentation", summary: "Server metadata", sourceLinks: [], presentation: "conversational" },
      { kind: "current_context", title: "navigation.get_current_context", summary: "You're viewing Order ORD-20003 for T3 Signs.", sourceLinks: [{ label: "View order", href: "/orders/order_1" }] },
    ]);
    expect(container.textContent).toContain("View order");
    expect(container.textContent).not.toContain("navigation.get_current_context");
    act(() => root.unmount());
  });

  test("renders search results as compact rows while retaining server presentation metadata", () => {
    const cards = [
      { kind: "response_presentation", title: "Response presentation", summary: "Server metadata", sourceLinks: [], presentation: "collection" },
      { kind: "search_results", title: "search.global", summary: "I found one matching record.", sourceLinks: [], details: { matches: [{ label: "Order ORD-20003", status: "In Production", sourceLink: { label: "Order ORD-20003", href: "/orders/order_1" } }] } },
    ];
    const { container, root } = render(cards);
    expect(responsePresentationForCards(cards as any)).toBe("collection");
    expect(container.textContent).toContain("Order ORD-20003");
    expect(container.textContent).not.toContain("search.global");
    act(() => root.unmount());
  });

  test("keeps diagnostic tool names and correlation IDs behind authorized disclosure", () => {
    const cards = [
      { kind: "response_presentation", title: "Response presentation", summary: "Server metadata", sourceLinks: [], presentation: "diagnostic" },
      { kind: "provider_unavailable", title: "navigation.get_current_context", summary: "I couldn't safely interpret that request.", sourceLinks: [], toolStatus: "failed" },
    ];
    const normal = render(cards);
    expect(normal.container.textContent).not.toContain("navigation.get_current_context");
    expect(normal.container.textContent).not.toContain("corr_123");
    act(() => normal.root.unmount());

    const authorized = render(cards, { diagnosticsEnabled: true, correlationId: "corr_123" });
    expect(authorized.container.textContent).toContain("Diagnostics");
    const button = authorized.container.querySelector("button") as HTMLButtonElement;
    act(() => button.click());
    expect(authorized.container.textContent).toContain("navigation.get_current_context");
    expect(authorized.container.textContent).toContain("corr_123");
    act(() => authorized.root.unmount());
  });
});
