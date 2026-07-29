import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { jest } from "@jest/globals";
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

const quoteNotePlanCard = {
  kind: "action_plan",
  title: "Add an internal note to quote Q-1042",
  plan: {
    id: "plan-quote-note-1",
    action: "quotes.add_internal_note",
    status: "awaiting_confirmation",
    planVersion: 3,
    riskLevel: "low",
    confirmationAvailable: true,
    confirmationToken: "server-issued-plan-bound-token",
    preview: {
      summary: "One internal staff note will be added.",
      quoteId: "quote-1042",
      quoteNumber: "Q-1042",
      customerName: "Acme Print",
      noteText: "Customer is supplying <script>alert('x')</script> final artwork tomorrow.",
      quotePath: "/quotes/quote-1042",
      unchangedItems: ["Pricing", "Quote status", "Customer-facing notes", "Order state", "Production", "Invoice", "Payment"],
      affectedEntities: [{ entityId: "quote-1042", entityType: "quote", label: "Q-1042", sourceLink: { href: "/quotes/quote-1042" } }],
      sideEffects: [{ label: "Internal note", description: "One internal staff note will be appended." }],
      undo: { available: false, label: null, expiresAt: null },
    },
    expiresAt: "2030-01-01T00:10:00.000Z",
    contextBinding: { route: "/quotes/quote-1042", entityType: "quote", entityId: "quote-1042" },
    cancellationAvailable: true,
    steps: [],
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

  it("renders the registered quote-note preview as internal-only text and confirms only through the dedicated control", () => {
    const confirmed = jest.fn();
    const onConfirm: NonNullable<React.ComponentProps<typeof AssistantPlanCard>["onConfirm"]> = (input) => { confirmed(input); };
    act(() => root.render(<AssistantPlanCard card={quoteNotePlanCard} context={buildSafeAssistantContext("/quotes/quote-1042", "Quote")} onConfirm={onConfirm} />));
    expect(container.textContent).toContain("Internal staff only. It will not be shown to the customer.");
    expect(container.textContent).toContain("Q-1042");
    expect(container.textContent).toContain("Acme Print");
    expect(container.textContent).toContain("Customer is supplying <script>alert('x')</script> final artwork tomorrow.");
    expect(container.innerHTML).not.toContain("<script>alert");
    expect(container.textContent).toContain("Pricing");
    expect(container.textContent).toContain("Payment");
    expect(container.textContent).not.toContain("quotes.add_internal_note");
    const goButton = container.querySelector<HTMLButtonElement>("button[aria-label='GO: add internal quote note']");
    expect(goButton).not.toBeNull();
    act(() => goButton?.click());
    expect(confirmed).toHaveBeenCalledWith({
      planId: "plan-quote-note-1",
      expectedPlanVersion: 3,
      confirmationToken: "server-issued-plan-bound-token",
      context: expect.objectContaining({ route: "/quotes/quote-1042", entityId: "quote-1042" }),
    });
  });

  it("does not render GO for another action, and renders stale, permission, and completed quote-note states", () => {
    const generic = { ...quoteNotePlanCard, plan: { ...quoteNotePlanCard.plan, action: "orders.add_internal_note" } };
    act(() => root.render(<AssistantPlanCard card={generic} context={buildSafeAssistantContext("/quotes/quote-1042", "Quote")} onConfirm={() => undefined} />));
    expect(container.querySelector("button[aria-label='GO: add internal quote note']")).toBeNull();

    const permissionChanged = { ...quoteNotePlanCard, plan: { ...quoteNotePlanCard.plan, status: "invalidated", staleReason: "Permissions changed before this plan could run.", failureSummary: "No note was added." } };
    act(() => root.render(<AssistantPlanCard card={permissionChanged} context={buildSafeAssistantContext("/orders/order-1", "Order")} onConfirm={() => undefined} />));
    expect(container.textContent).toContain("Permissions changed before this plan could run.");
    expect(container.textContent).toContain("Execution issue: No note was added.");
    expect(container.querySelector("button[aria-label='GO: add internal quote note']")).toBeNull();

    const completed = { ...quoteNotePlanCard, plan: { ...quoteNotePlanCard.plan, status: "succeeded", confirmationAvailable: false } };
    act(() => root.render(<AssistantPlanCard card={completed} context={buildSafeAssistantContext("/quotes/quote-1042", "Quote")} onConfirm={() => undefined} />));
    expect(container.textContent).toContain("Internal note added to Quote Q-1042.");
    expect(Array.from(container.querySelectorAll<HTMLAnchorElement>("a[href='/quotes/quote-1042']")).some((link) => link.textContent === "Quote Q-1042")).toBe(true);
  });

  it("allows a dedicated confirmation only for a server-ready inactive product-draft plan", () => {
    const productPlan = {
      kind: "action_plan",
      title: "Create Banner draft",
      plan: {
        id: "plan-product-1", action: "products.create_inactive_draft", status: "awaiting_confirmation", planVersion: 1,
        riskLevel: "high", confirmationAvailable: true, confirmationToken: "server-token", expiresAt: "2030-01-01T00:10:00.000Z",
        preview: { summary: "One inactive Banner draft will be created.", productInactiveDraft: {
          productName: "13 oz Banner", warnings: ["Review material association before activation."], proposedFields: {
            category: "Banners", measurementMode: "custom_dimensions", requiresDimensions: true, fixedDimensions: null,
            pricingModel: "square_foot", perSqftCents: 450, perPieceCents: null, minimumChargeCents: 2500,
            material: "13 oz Banner", productionRoute: "Roll printer", sheetOrRollConstraints: "54in roll", allowRotation: true,
            quantityBehavior: "per_piece", taxable: true, commonOptions: ["Lamination", "Grommets"], status: "inactive_draft",
          },
        } }, missingInformation: [], cancellationAvailable: true, steps: [],
      },
    };
    const confirmed = jest.fn();
    const onConfirm: NonNullable<React.ComponentProps<typeof AssistantPlanCard>["onConfirm"]> = (input) => { confirmed(input); };
    act(() => root.render(<AssistantPlanCard card={productPlan} context={buildSafeAssistantContext("/products", "Products")} onConfirm={onConfirm} />));
    expect(container.textContent).toContain("cannot activate, publish, or modify an active product");
    expect(container.textContent).toContain("13 oz Banner");
    expect(container.textContent).toContain("$4.50");
    expect(container.textContent).toContain("$25.00");
    expect(container.textContent).toContain("Allowed");
    expect(container.textContent).toContain("Inactive draft");
    expect(container.textContent).not.toMatch(/Activate|Publish/);
    const go = container.querySelector<HTMLButtonElement>("button[aria-label='GO: create inactive product draft']");
    expect(go).not.toBeNull();
    act(() => go?.click());
    expect(confirmed).toHaveBeenCalledWith(expect.objectContaining({ planId: "plan-product-1", expectedPlanVersion: 1, confirmationToken: "server-token" }));
  });

  it("renders an exact inactive-draft update preview and blocks GO for server validation errors", () => {
    const updatePlan = {
      kind: "action_plan",
      title: "Update Banner draft",
      plan: {
        id: "plan-product-update-1", action: "products.update_inactive_draft", status: "awaiting_confirmation", planVersion: 2,
        riskLevel: "high", confirmationAvailable: true, confirmationToken: "server-token", expiresAt: "2030-01-01T00:10:00.000Z",
        preview: { summary: "One inactive Banner draft will be updated.", productInactiveDraftUpdate: {
          productName: "Banner", draftStatus: "Inactive PBV2 DRAFT", editorPath: "/admin/products/banner-draft",
          changes: [{ field: "Minimum charge", before: 2500, after: 3000 }, { field: "Base rate per square foot", before: 450, after: 475 }],
          warnings: ["Existing square-foot pricing remains in use."], unchangedAreas: ["Activation", "Inventory", "Production jobs"],
        } }, missingInformation: [], cancellationAvailable: true, steps: [],
      },
    };
    const confirmed = jest.fn();
    act(() => root.render(<AssistantPlanCard card={updatePlan} context={buildSafeAssistantContext("/products/banner-draft", "Product")} onConfirm={(input) => { void confirmed(input); }} />));
    expect(container.textContent).toContain("Minimum charge");
    expect(container.textContent).toContain("$25.00");
    expect(container.textContent).toContain("$30.00");
    expect(container.textContent).toContain("$4.50 per square foot");
    expect(container.textContent).toContain("$4.75 per square foot");
    expect(container.textContent).toContain("Inactive PBV2 DRAFT");
    expect(container.textContent).not.toContain("2500");
    expect(container.textContent).toContain("Existing square-foot pricing remains in use.");
    expect(container.textContent).toContain("Explicitly unchanged");
    const go = container.querySelector<HTMLButtonElement>("button[aria-label='GO: update inactive product draft']");
    expect(go).not.toBeNull();
    act(() => go?.click());
    expect(confirmed).toHaveBeenCalledWith(expect.objectContaining({ planId: "plan-product-update-1", expectedPlanVersion: 2 }));

    const invalid = { ...updatePlan, plan: { ...updatePlan.plan, preview: { ...updatePlan.plan.preview, productInactiveDraftUpdate: { ...updatePlan.plan.preview.productInactiveDraftUpdate, validationErrors: ["Default choice must reference an existing option."] } } } };
    act(() => root.render(<AssistantPlanCard card={invalid} context={buildSafeAssistantContext("/products/banner-draft", "Product")} onConfirm={(input) => { void confirmed(input); }} />));
    expect(container.textContent).toContain("Default choice must reference an existing option.");
    expect(container.textContent).toContain("Resolve validation errors before this draft update can be confirmed.");
    expect(container.querySelector("button[aria-label='GO: update inactive product draft']")).toBeNull();
  });

  it("renders only the dedicated configurable-product GO control for a complete typed preview", () => {
    const configurablePlan = {
      kind: "action_plan", title: "Create PVC configurable draft",
      plan: {
        id: "plan-configurable-1", action: "products.create_configurable_draft", status: "awaiting_confirmation", planVersion: 4,
        riskLevel: "high", confirmationAvailable: true, confirmationToken: "configurable-token", expiresAt: "2030-01-01T00:10:00.000Z",
        preview: { summary: "Create one inactive configurable draft.", configurableProduct: {
          kind: "configurable_product_confirmation", version: "v1", proposalId: "11111111-1111-4111-8111-111111111111", fingerprint: "a".repeat(64),
          product: { name: "PVC Panel", category: "Rigid Signs", inactive: true, pbv2Status: "DRAFT", unpublished: true, nonLiveQuotable: true, sheetWidthIn: 48, sheetHeightIn: 96, allowRotation: true, route: "Flatbed", minimumChargeCents: 2500 },
          optionGroups: [{ key: "thickness", name: "Thickness", required: true, selectionMode: "single", values: [{ value: "3mm", label: "3mm" }, { value: "6mm", label: "6mm" }] }, { key: "sides", name: "Sides", required: true, selectionMode: "single", values: [{ value: "single", label: "Single" }, { value: "double", label: "Double" }] }],
          matrix: { rowValues: ["3mm", "6mm"], columnValues: ["single", "double"], cells: { "3mm:single": 450, "3mm:double": 550, "6mm:single": 650, "6mm:double": 750 } },
          warnings: [], blockers: [], readiness: { ready: true }, goEligible: true,
        } }, missingInformation: [], cancellationAvailable: true, steps: [],
      },
    };
    const confirmed = jest.fn();
    const onConfirm: NonNullable<React.ComponentProps<typeof AssistantPlanCard>["onConfirm"]> = (input) => { confirmed(input); };
    act(() => root.render(<AssistantPlanCard card={configurablePlan} context={buildSafeAssistantContext("/products", "Products")} onConfirm={onConfirm} />));
    expect(container.textContent).toContain("PVC Panel");
    expect(container.textContent).toContain("Per-square-foot pricing matrix");
    const go = container.querySelector<HTMLButtonElement>("button[aria-label='GO: create configurable inactive product draft']");
    expect(go).not.toBeNull();
    act(() => go?.click());
    expect(confirmed).toHaveBeenCalledWith(expect.objectContaining({ planId: "plan-configurable-1", expectedPlanVersion: 4, confirmationToken: "configurable-token" }));
  });
});
