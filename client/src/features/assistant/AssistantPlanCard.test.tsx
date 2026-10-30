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

const orderCreatePlanCard = {
  kind: "action_plan",
  title: "Create order for Cool Cars",
  plan: {
    id: "plan-order-1", action: "orders.create", status: "awaiting_confirmation", planVersion: 1, riskLevel: "high", confirmationAvailable: true, confirmationToken: "server-issued-plan-bound-token",
    preview: {
      summary: "Create one order for Cool Cars.",
      affectedEntities: [{ entityId: "customer-1", entityType: "customer", label: "Customer: Cool Cars" }, { entityId: "new:plan-order-1", entityType: "order", label: "One new order will be created" }, { entityId: "product-1", entityType: "product", label: "Product: ACM Tester" }],
      orderCreate: { customer: { id: "customer-1", name: "Cool Cars", contactName: null }, orderStatus: "new", productionDeferred: true, totalCents: 1500, warnings: [], lines: [{ productId: "product-1", productName: "ACM Tester", quantity: 1, measurementMode: "area", dimensions: { widthIn: 12, heightIn: 12, unit: "in" }, pbv2TreeVersionId: "tree-1", selections: [{ groupId: "sides", groupLabel: "Sides", valueId: "single", valueLabel: "Single Sided", source: "explicit" }, { groupId: "thickness", groupLabel: "Thickness", valueId: "3mm", valueLabel: "3mm", source: "explicit" }, { groupId: "contour", groupLabel: "Contour Cutting", valueId: "no", valueLabel: "No", source: "default_accepted" }], unitPriceCents: 1500, totalCents: 1500, minimumChargeApplied: true, warnings: [] }, { productId: "product-2", productName: "Setup", quantity: 1, measurementMode: "quantity_only", dimensions: null, pbv2TreeVersionId: "tree-2", selections: [], unitPriceCents: 0, totalCents: 0, minimumChargeApplied: false, warnings: [] }] },
      sideEffects: [], undo: { available: false, label: null, expiresAt: null },
    },
    missingInformation: [], expiresAt: "2030-01-01T00:10:00.000Z", contextBinding: { route: "/orders", entityType: null, entityId: null }, cancellationAvailable: true, steps: [],
  },
};

const cloneConfirmationCard = {
  kind: "action_plan", title: "Clone inactive Product",
  plan: {
    id: "clone-confirmation-1", action: "products.clone_to_inactive_draft", status: "awaiting_confirmation", planVersion: 2,
    confirmationAvailable: true, confirmationToken: "server-issued-clone-token", expiresAt: "2030-01-01T00:10:00.000Z", missingInformation: [],
    preview: { summary: "Review the Product clone.", cloneInactiveDraft: { preview: {
      source: { product: { name: "Translucent", configuration: {} } }, result: { product: { name: "Transparent PET Film" } },
    } } },
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

  it("renders authoritative configured-order details without exposing the intake session", () => {
    const confirmed = jest.fn();
    const onConfirm: NonNullable<React.ComponentProps<typeof AssistantPlanCard>["onConfirm"]> = (input) => { confirmed(input); };
    act(() => root.render(<AssistantPlanCard card={orderCreatePlanCard} context={buildSafeAssistantContext("/orders", "Order")} onConfirm={onConfirm} allowGenericConfirmation genericActionLabel="Orders Create" />));
    expect(container.textContent).toContain("Cool Cars");
    expect(container.textContent).toContain("ACM Tester");
    expect(container.textContent).toContain("12 × 12 in");
    expect(container.textContent).toContain("Sides: Single Sided");
    expect(container.textContent).toContain("Thickness: 3mm");
    expect(container.textContent).toContain("Contour Cutting: No (default accepted)");
    expect(container.textContent).toContain("Unit price: $15.00");
    expect(container.textContent).toContain("Minimum charge: Applied");
    expect(container.textContent).not.toContain("assistant_order_intake_session");
    expect(container.textContent).toContain("One new order will be created");
    expect(container.querySelector("button[aria-label='GO: Orders Create']")).not.toBeNull();
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
            quantityBehavior: { behavior: "per_piece", confidence: 100 }, workflowIntent: "standard_production", requiresProductionJob: true, requiresProofApproval: true, taxable: true, commonOptions: ["Lamination", "Grommets"], optionGroups: [{ key: "lamination", label: "Lamination", required: true, selectionMode: "single", choices: ["None", "Gloss", "Matte"], defaultChoice: "None" }], status: "inactive_draft",
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
    expect(container.textContent).toContain("Inactive PBV2 DRAFT");
    expect(container.textContent).toContain("Default: None");
    expect(container.textContent).toContain("Choices: None, Gloss, Matte");
    expect(container.textContent).toContain("Customer proof approval required: Yes");
    expect(container.textContent).toContain("Quantity: Customer enters quantity");
    expect(container.textContent).not.toContain("[object Object]");
    expect(container.textContent).not.toMatch(/Activate|Publish/);
    const go = container.querySelector<HTMLButtonElement>("button[aria-label='GO: create inactive product draft']");
    expect(go).not.toBeNull();
    act(() => go?.click());
    expect(confirmed).toHaveBeenCalledWith(expect.objectContaining({ planId: "plan-product-1", expectedPlanVersion: 1, confirmationToken: "server-token" }));
  });

  it("renders service-fee workflow and non-production quantities in plain language", () => {
    const servicePlan = {
      kind: "action_plan", title: "Create service draft",
      plan: {
        id: "plan-service-1", action: "products.create_inactive_draft", status: "awaiting_confirmation", planVersion: 1, riskLevel: "high", confirmationAvailable: true, confirmationToken: "service-token", expiresAt: "2030-01-01T00:10:00.000Z", missingInformation: [], cancellationAvailable: true, steps: [],
        preview: { summary: "Create one inactive service-fee draft.", productInactiveDraft: { productName: "DEV Test Service 080426", warnings: [], proposedFields: {
          category: "Print Products", measurementMode: "quantity_only", requiresDimensions: false, fixedDimensions: null, pricingModel: "per_piece", perSqftCents: null, perPieceCents: 2000, minimumChargeCents: null, material: null, productionRoute: null, sheetOrRollConstraints: null, allowRotation: null, quantityBehavior: "customer_enters_quantity", workflowIntent: "service_fee", requiresProductionJob: false, requiresProofApproval: false, taxable: true, commonOptions: [], optionGroups: [], status: "inactive_draft",
        } } },
      },
    };
    act(() => root.render(<AssistantPlanCard card={servicePlan} context={buildSafeAssistantContext("/products", "Products")} onConfirm={() => undefined} />));
    expect(container.textContent).toContain("Measurement: Quantity only");
    expect(container.textContent).toContain("Pricing: $20.00 per piece");
    expect(container.textContent).toContain("Workflow: Service fee");
    expect(container.textContent).toContain("Production job required: No");
    expect(container.textContent).toContain("Quantity: Customer enters quantity");
    expect(container.textContent).not.toContain("fixed_quantity");
  });

  it("describes a clone awaiting GO accurately and preserves the authorized confirmation request", () => {
    const confirmed = jest.fn(() => undefined);
    const context = buildSafeAssistantContext("/products", "Products");
    act(() => root.render(<AssistantPlanCard card={cloneConfirmationCard} context={context} onConfirm={confirmed} />));
    expect(container.textContent).toContain("Awaiting GO confirmation.");
    expect(container.textContent).toContain("This action creates one inactive Product with a PBV2 DRAFT configuration after GO confirmation.");
    expect(container.textContent).toContain("The source Product remains unchanged. Activation and publication are separate operations.");
    expect(container.textContent).not.toContain("Preview only. Production business write commands are not enabled");
    expect(container.textContent).not.toContain("does not provide a GO or execute control");
    const go = container.querySelector<HTMLButtonElement>("button[aria-label='GO: clone to inactive product draft']");
    expect(go?.textContent).toBe("GO clone inactive draft");
    expect(go?.disabled).toBe(false);
    act(() => go?.click());
    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(confirmed).toHaveBeenCalledWith({ planId: "clone-confirmation-1", expectedPlanVersion: 2, confirmationToken: "server-issued-clone-token", context });
  });

  it.each([
    ["executing", "Clone execution is in progress."],
    ["confirmed", "GO confirmation received. Waiting for the clone execution result."],
    ["revalidating", "The clone plan is being revalidated before execution."],
    ["succeeded", "Clone completed: one inactive Product with a PBV2 DRAFT configuration was created."],
    ["failed", "Clone execution did not complete successfully."],
    ["expired", "This clone confirmation has expired."],
    ["invalidated", "This clone plan is no longer valid for confirmation."],
  ])("describes a %s clone without offering another GO", (status, message) => {
    // Keep the token and server flag present to verify the existing status gate.
    const card = { ...cloneConfirmationCard, plan: { ...cloneConfirmationCard.plan, status } };
    act(() => root.render(<AssistantPlanCard card={card} context={buildSafeAssistantContext("/products", "Products")} onConfirm={jest.fn(() => undefined)} />));
    expect(container.textContent).toContain(message);
    expect(container.textContent).not.toContain("does not provide a GO or execute control");
    expect(container.textContent).not.toContain("Awaiting GO confirmation.");
    expect(container.querySelector("button[aria-label='GO: clone to inactive product draft']")).toBeNull();
    if (status !== "succeeded") expect(container.textContent).not.toContain("Clone completed:");
  });

  it("preserves permission and stale-preview restrictions for clone cards", () => {
    const context = buildSafeAssistantContext("/products", "Products");
    const permissionDenied = { ...cloneConfirmationCard, plan: { ...cloneConfirmationCard.plan, confirmationAvailable: false } };
    act(() => root.render(<AssistantPlanCard card={permissionDenied} context={context} onConfirm={jest.fn(() => undefined)} />));
    expect(container.querySelector("button[aria-label='GO: clone to inactive product draft']")).toBeNull();
    expect(container.textContent).not.toContain("does not provide a GO or execute control");
    const stale = { ...cloneConfirmationCard, plan: { ...cloneConfirmationCard.plan, staleReason: "Source changed" } };
    act(() => root.render(<AssistantPlanCard card={stale} context={context} onConfirm={jest.fn(() => undefined)} />));
    expect(container.textContent).toContain("This clone preview is stale.");
    expect(container.querySelector("button[aria-label='GO: clone to inactive product draft']")).toBeNull();
  });

  it("keeps the preview-only warning for an unsupported execution entry point", () => {
    act(() => root.render(<AssistantPlanCard card={planCard} context={buildSafeAssistantContext("/customers/customer-1", "Customer")} onConfirm={jest.fn(() => undefined)} />));
    expect(container.textContent).toContain("Preview only. Production business write commands are not enabled");
    expect(container.textContent).toContain("does not provide a GO or execute control");
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders a clone's typed pricing before-and-after table without raw JSON", () => {
    const clonePlan = {
      kind: "action_plan", title: "Clone inactive product draft",
      plan: {
        id: "plan-clone-1", action: "products.clone_to_inactive_draft", status: "awaiting_confirmation", planVersion: 1, riskLevel: "high", confirmationAvailable: true, confirmationToken: "clone-token", expiresAt: "2030-01-01T00:10:00.000Z", missingInformation: [], cancellationAvailable: true, steps: [],
        preview: { summary: "Clone one inactive product draft.", cloneInactiveDraft: { preview: {
          source: { product: { name: "DEV Test Minimum Charge 080426", category: "Print Products", measurementMode: "dimensions_required", configuration: {} }, pbv2Tree: { treeJson: { meta: { optionGroups: [] } } } },
          result: { product: { name: "DEV Test Minimum Charge Clone 080426" } },
          basePricing: { before: { perSqftCents: 200, perPieceCents: null, minimumChargeCents: 2500 }, after: { perSqftCents: 250, perPieceCents: null, minimumChargeCents: 3000 } },
        } } },
      },
    };
    act(() => root.render(<AssistantPlanCard card={clonePlan} context={buildSafeAssistantContext("/products", "Products")} onConfirm={() => undefined} />));
    expect(container.textContent).toContain("Source product: DEV Test Minimum Charge 080426");
    expect(container.textContent).toContain("New product: DEV Test Minimum Charge Clone 080426");
    expect(container.textContent).toContain("Price per square foot");
    expect(container.textContent).toContain("$2.00");
    expect(container.textContent).toContain("$2.50");
    expect(container.textContent).toContain("$25.00");
    expect(container.textContent).toContain("$30.00");
    expect(container.textContent).toContain("Lifecycle: Inactive PBV2 DRAFT");
    expect(container.textContent).not.toContain('"minimumChargeCents"');
  });

  it("renders real PBV2 clone options and explicit metadata changes without claiming they are unchanged", () => {
    const preview = { requestedChanges: { newName: "PET", category: "Film", description: "New description" },
      source: { product: { name: "Translucent", category: "Signs", description: "Original", configuration: { sheetWidth: "54.00", sheetHeight: "120.00", pricingProfileConfig: { allowRotation: true } } }, pbv2Tree: { treeJson: { nodes: { finish: { kind: "question", label: "Finish", status: "ENABLED" }, contour: { kind: "question", label: "Contour", status: "ENABLED" } }, meta: { productIntake: { production: { route: { label: "Roll printing" } } } } } } },
      result: { product: { name: "PET", category: "Film", description: "New description" } }, basePricing: { before: { perSqftCents: null }, after: { perSqftCents: 400 } } };
    const card = { kind: "action_plan", title: "Clone", plan: { id: "clone-plan", action: "products.clone_to_inactive_draft", status: "succeeded", planVersion: 3, preview: { cloneInactiveDraft: { preview } }, executionResult: { details: { cloneInactiveDraft: { editorLink: "/products/clone-id/edit?draftTreeVersionId=draft-id" } } } } };
    const model = toAssistantPlanCardModel(card)!;
    expect(model.cloneInactiveDraft).toMatchObject({ options: "Finish, Contour", productionRoute: "Roll printing", rotation: true, categoryChanged: true, fieldChanges: [{ label: "Category", before: "Signs", after: "Film" }, { label: "Description", before: "Original", after: "New description" }] });
    act(() => root.render(<AssistantPlanCard card={card} context={buildSafeAssistantContext("/products", "Products")} />));
    expect(container.textContent).toContain("Options: Finish, Contour");
    expect(container.textContent).toContain("$4.00");
    expect(container.textContent).toContain("Roll printing");
    expect(container.textContent).not.toContain("Category: Signs");
    expect(container.querySelector<HTMLAnchorElement>('a[href="/products/clone-id/edit?draftTreeVersionId=draft-id"]')).not.toBeNull();
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

  it("opens the exact PBV2 DRAFT after an inactive-draft mutation succeeds", () => {
    const completed = {
      kind: "action_plan", title: "Update Banner draft",
      plan: {
        id: "plan-product-update-result", action: "products.update_inactive_draft", status: "succeeded", planVersion: 2,
        riskLevel: "high", confirmationAvailable: false, missingInformation: [], steps: [],
        executionResult: { details: { productDraft: { id: "banner_1", name: "Banner", sourceLink: "/products/banner_1/edit?draftTreeVersionId=tree_1" } } },
      },
    };
    act(() => root.render(<AssistantPlanCard card={completed} context={buildSafeAssistantContext("/products", "Products")} onConfirm={() => undefined} />));
    expect(container.querySelector('a[href="/products/banner_1/edit?draftTreeVersionId=tree_1"]')?.textContent).toContain("Open Banner");
  });

  it("links to the real Order returned by the confirmed PO command", () => {
    const completed = { kind: "action_plan", title: "Create Order from PO", plan: {
      id: "plan-po-result", action: "orders.create", status: "succeeded", planVersion: 2,
      riskLevel: "high", confirmationAvailable: false, missingInformation: [], steps: [],
      executionResult: { details: { order: { id: "order_42", displayNumber: "O-20042", sourceLink: "/orders/order_42" } } },
    } };
    act(() => root.render(<AssistantPlanCard card={completed} context={buildSafeAssistantContext("/orders", "Orders")} onConfirm={() => undefined} />));
    expect(container.querySelector('a[href="/orders/order_42"]')?.textContent).toContain("Open Order O-20042");
  });

  it("links to the actual new Quote returned by the confirmed create command", () => {
    const completed = { kind: "action_plan", title: "Create Quote from PO", plan: {
      id: "plan-quote-result", action: "quotes.create_draft", status: "succeeded", planVersion: 2,
      riskLevel: "high", confirmationAvailable: false, missingInformation: [], steps: [],
      executionResult: { details: { quote: { id: "quote_42", displayNumber: "20042", totalCents: 12345, sourceLink: "/quotes/quote_42" } } },
    } };
    act(() => root.render(<AssistantPlanCard card={completed} context={buildSafeAssistantContext("/quotes", "Quotes")} onConfirm={() => undefined} />));
    expect(container.querySelector('a[href="/quotes/quote_42"]')?.textContent).toContain("Open Quote 20042");
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
    expect(container.textContent).toContain("Per square foot pricing matrix");
    const go = container.querySelector<HTMLButtonElement>("button[aria-label='GO: create configurable inactive product draft']");
    expect(go).not.toBeNull();
    act(() => go?.click());
    expect(confirmed).toHaveBeenCalledWith(expect.objectContaining({ planId: "plan-configurable-1", expectedPlanVersion: 4, confirmationToken: "configurable-token" }));
  });
});
