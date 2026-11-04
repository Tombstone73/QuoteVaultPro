import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ResultCards } from "@/features/assistant/AssistantWorkspace";
import { AssistantPlanCard } from "@/features/assistant/AssistantPlanCard";
import { buildSafeAssistantContext } from "@/features/assistant/assistantWorkspaceCore";
import "@/index.css";

const context = buildSafeAssistantContext("/orders", "Orders");
const optionCard = { kind: "order_option_selection", title: "Order options needed", summary: "Choose the finish for line 2.", sourceLinks: [], details: { orderOptionSelection: {
  orderIntakeSessionId: "fixture-session", expectedIntakeVersion: "a".repeat(64), lineIndex: 1, productId: "fixture-product", productName: "Synthetic Yard Signs", pbv2TreeVersionId: "fixture-tree", quantity: 28,
  dimensions: { widthIn: 24, heightIn: 18, unit: "in" }, helperText: "The same proposal will continue; no Order is created by this selection.", groups: [{ nodeId: "sides", label: "Print Sides", question: "Single-sided or double-sided?", choices: [{ valueId: "single", label: "Single-Sided" }, { valueId: "double", label: "Double-Sided" }] }],
} } };
const preview = { kind: "action_plan", title: "Create Order for Synthetic Buyer", plan: { id: "fixture-plan", action: "orders.create", status: "awaiting_confirmation", planVersion: 2, riskLevel: "high", confirmationAvailable: true, confirmationToken: "fixture-only-token", expiresAt: "2030-01-01T00:00:00Z", missingInformation: [], cancellationAvailable: true, contextBinding: { route: "/orders", entityType: null, entityId: null }, steps: [], preview: {
  summary: "Review the complete Order before GO. Canonical creation includes a linked draft Invoice; production remains deferred.",
  affectedEntities: [], sideEffects: ["Job Label: Synthetic conversational job", "Requested deadline: November 10 EOD; not an accepted production commitment", "Fulfillment: Customer pickup", "Artwork: arriving later; production remains gated", "Customer PO total $718.25: reference only"],
  orderCreate: { customer: { id: "fixture-customer", name: "Synthetic Buyer", contactName: "QA Contact" }, orderStatus: "new", productionDeferred: true, totalCents: 16500, warnings: [], lines: [{ productId: "fixture-product", productName: "Synthetic Yard Signs", quantity: 28, measurementMode: "quantity_only", dimensions: { widthIn: 24, heightIn: 18, unit: "in" }, pbv2TreeVersionId: "fixture-tree", selections: [{ groupId: "sides", groupLabel: "Print Sides", valueId: "double", valueLabel: "Double-Sided", source: "explicit" }], unitPriceCents: 589, totalCents: 16500, minimumChargeApplied: false, warnings: ["Authorized exact line total $165.00; unit price is rounded for display only."] }] },
} } };
function Fixture() {
  const [review, setReview] = useState(false), [confirmed, setConfirmed] = useState(false);
  return <main className="min-h-screen bg-background p-6 text-foreground"><div className="mx-auto max-w-3xl space-y-3">
    <h1 className="text-xl font-semibold">Conversational Order preparation fixture</h1>
    <p>Browser API responses are mocked. No real customer data or Orders.</p>
    <button className="rounded border p-2" onClick={() => document.documentElement.classList.toggle("dark")}>Toggle theme</button>
    <button className="ml-2 rounded border p-2" onClick={() => setReview(true)}>Show reviewed proposal</button>
    {review ? <AssistantPlanCard card={preview} context={context} allowGenericConfirmation genericActionLabel="Create Order" onConfirm={() => { setConfirmed(true); }} /> : <ResultCards cards={[optionCard] as never} context={context} conversationId="fixture-conversation" executionPlans={{}} onCancelPlan={() => Promise.resolve()} onConfirmPlan={() => Promise.resolve()} onCreatePlan={() => Promise.resolve()} />}
    {confirmed ? <p role="status">Fixture confirmation received for exact version 2. No actual Order created.</p> : null}
  </div></main>;
}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><Fixture /></QueryClientProvider>);
