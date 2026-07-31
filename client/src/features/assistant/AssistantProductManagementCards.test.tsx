import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantProductManagementCardView, toAssistantProductManagementCard } from "./AssistantProductManagementCards";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const previewCard = {
  kind: "product_draft_preview",
  title: "Banner product draft proposal",
  summary: "One inactive product draft is ready for review.",
  details: {
    productName: "13 oz Banner <script>alert('x')</script>",
    category: "Banners",
    sellUnit: "Square foot",
    pricingMethod: "Square-foot draft pricing",
    routing: "Roll production",
    material: "13 oz banner",
    draftStatus: "Inactive draft",
    proposedFields: {
      pricingModel: "square_foot",
      perSqftCents: 450,
      perPieceCents: null,
      minimumChargeCents: 2500,
      productionRoute: "Flatbed",
      sheetOrRollConstraints: "48×96 sheets",
      allowRotation: true,
      status: "inactive_draft",
    },
    assumptions: ["Inherited Roll routing from an existing banner product."],
    items: ["Single-sided and double-sided options", "Grommets and hems"],
    editorPath: "/admin/products/draft-1",
  },
};

describe("AssistantProductManagementCards", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it("renders a server proposal with labelled assumptions and a safe existing-editor link", () => {
    const card = toAssistantProductManagementCard(previewCard)!;
    expect(card).not.toBeNull();
    act(() => root.render(<AssistantProductManagementCardView card={card} />));
    expect(container.textContent).toContain("13 oz Banner <script>alert('x')</script>");
    expect(container.innerHTML).not.toContain("<script>alert");
    expect(container.textContent).toContain("Assumptions and inherited defaults");
    expect(container.textContent).toContain("Single-sided and double-sided options");
    expect(container.textContent).toContain("Square-foot price: $4.50");
    expect(container.textContent).toContain("Pricing model: Per square foot");
    expect(container.textContent).toContain("Minimum charge: $25.00");
    expect(container.textContent).toContain("Route: Flatbed");
    expect(container.textContent).toContain("Sheet / roll constraints: 48×96 sheets");
    expect(container.textContent).toContain("Allow rotation: Allowed");
    expect(container.textContent).toContain("Status to create: Inactive PBV2 DRAFT");
    expect(container.querySelector<HTMLAnchorElement>("a[href='/admin/products/draft-1']")?.textContent).toContain("existing editor");
    expect(container.textContent).not.toMatch(/Activate|Publish|GO/);
  });

  it("shows missing questions and validation errors without introducing a confirmation control", () => {
    const missing = toAssistantProductManagementCard({ kind: "product_missing_information", title: "I need two details", details: { questions: ["Should double-sided printing use a fixed amount or percentage?", "Are grommets optional?"] } })!;
    const errors = toAssistantProductManagementCard({ kind: "product_validation_errors", title: "Validation needs attention", details: { errors: ["A material selection is required."] } })!;
    act(() => root.render(<><AssistantProductManagementCardView card={missing} /><AssistantProductManagementCardView card={errors} /></>));
    expect(container.textContent).toContain("Should double-sided printing use a fixed amount or percentage?");
    expect(container.textContent).toContain("Validation must be resolved before a draft can be confirmed.");
    expect(container.querySelector("button")).toBeNull();
  });

  it("shows every unresolved question as a numbered actionable list", () => {
    const missing = toAssistantProductManagementCard({ kind: "product_missing_information", title: "Information needed", summary: "Two questions remain.", details: { questions: ["Which option should be listed down the left side of the pricing table?", "Should customers enter width and height for this product?"] } })!;
    act(() => root.render(<AssistantProductManagementCardView card={missing} />));
    expect(container.textContent).toContain("Two questions remain.");
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
    expect(container.textContent).not.toContain("confirm-matrix-dimension");
  });

  it("rejects unrelated cards and only uses internal editor paths", () => {
    expect(toAssistantProductManagementCard({ kind: "action_plan" })).toBeNull();
    const unsafe = toAssistantProductManagementCard({ kind: "product_draft_created", title: "Draft created", details: { reviewUrl: "https://outside.example/draft" } })!;
    expect(unsafe.editorPath).toBeNull();
  });

  it("renders active-product and unsupported draft requests as editor-only guidance", () => {
    const active = toAssistantProductManagementCard({ kind: "product_active_product_unsupported", title: "Active product", details: { editorPath: "/admin/products/live-banner" } })!;
    const unsupported = toAssistantProductManagementCard({ kind: "product_draft_update_unsupported", title: "Option update", details: { editorPath: "/admin/products/draft-1", unsupportedReasons: ["Option, material, and routing changes are not available through the assistant."] } })!;
    act(() => root.render(<><AssistantProductManagementCardView card={active} /><AssistantProductManagementCardView card={unsupported} /></>));
    expect(container.textContent).toContain("Conversational editing is available only for inactive drafts");
    expect(container.textContent).toContain("not available through the assistant");
    expect(container.textContent).toContain("Option, material, and routing changes are not available through the assistant.");
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector<HTMLAnchorElement>("a[href='/admin/products/live-banner']")?.textContent).toContain("existing editor");
  });
});
