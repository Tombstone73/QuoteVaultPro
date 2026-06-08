import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { describe, expect, jest, test, beforeEach } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TextDecoder, TextEncoder } from "util";
import type { ProductIntakeDraftReview } from "@shared/productIntakeWizardSchemas";

(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { MemoryRouter, Route, Routes } = require("react-router-dom") as typeof import("react-router-dom");
const ProductIntakeDraftReviewPage = (require("./ProductIntakeDraftReviewPage") as typeof import("./ProductIntakeDraftReviewPage")).default;

jest.mock("@/lib/queryClient", () => ({
  apiRequest: jest.fn(),
  queryClient: { invalidateQueries: jest.fn() },
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

const queryClientMock = jest.requireMock("@/lib/queryClient") as {
  apiRequest: jest.Mock;
  queryClient: { invalidateQueries: jest.Mock };
};

function jsonResponse(body: unknown) {
  return {
    json: async () => body,
  };
}

function reviewFixture(overrides: Partial<ProductIntakeDraftReview> = {}): ProductIntakeDraftReview {
  return {
    intake: {
      sessionId: "sess_1",
      status: "draft_created",
      sourceType: "text_description",
      sourceText: "13oz banner with grommets",
      sourceJson: null,
      sourceFingerprint: "fp_1",
      briefSource: "live_ai",
      confidence: 92,
      productName: "13oz Banner",
      materialMatch: "13oz Scrim Banner",
      warnings: ["Pricing setup required."],
      unansweredDecisions: ["Confirm finishing defaults."],
    },
    product: {
      id: "prod_1",
      name: "13oz Banner",
      category: "banner",
      description: "Inactive intake draft.",
      isActive: false,
      productTypeId: "pt_roll",
      productTypeName: "Roll",
      primaryMaterialId: "mat_1",
      pbv2ActiveTreeVersionId: null,
    },
    pbv2Tree: {
      id: "tree_1",
      status: "DRAFT",
      schemaVersion: 2,
      publishedAt: null,
      updatedAt: "2026-06-08T00:00:00.000Z",
      groupCount: 1,
      optionCount: 2,
      optionGroups: [{ id: "group_size", label: "Size & Quantity", optionCount: 1, options: ["Size"] }],
      draftQuality: { label: "Good", score: 61, warnings: ["Matrix pricing is likely required and must be configured in PBV2 Pricing Matrix before publish."], reasons: ["Matrix pricing guidance was preserved without generating matrix rows."] },
      intakeSummary: {
        pricingReadiness: {
          likelyMatrixPricing: true,
          candidateDimensions: ["size", "quantity"],
        },
      },
      matrixReadiness: {
        required: true,
        matrixType: "SIZE_QUANTITY",
        matrixDimensions: ["size", "quantity"],
        matrixConfidence: 88,
        reasoning: ["Multiple fixed sizes with quantity-tier pricing were detected."],
        recommendedSetup: "Create a PBV2 pricing matrix with Size as the selectable dimension and line item quantity tiers or row-level quantity tiers before publish.",
        detectedSizes: ["12x18", "18x24", "24x36"],
        detectedQuantityBreaks: [1, 5, 10, 25],
        detectedMaterials: ["4mm Coroplast"],
        detectedPricingSignals: ["Quantity tier pricing present."],
        noMatrixRowsGenerated: true,
      },
      matrixPreview: null,
      basePricing: { perSqftCents: null, perPieceCents: null, minimumChargeCents: null },
    },
    publishReadiness: {
      productInactive: true,
      pbv2TreeDraft: true,
      pbv2TreePublished: false,
      activeTreeAssigned: false,
      requiredOptionsPresent: true,
      noDuplicateSizeControls: true,
      pricingConfigured: false,
      materialLinked: true,
      validationStatus: "warnings",
      findings: [{ code: "PBV2_W_PRICE_REVIEW", severity: "WARNING", message: "Review pricing.", path: "meta.pricingV2" }],
    },
    ...overrides,
  };
}

async function renderPage(review: ProductIntakeDraftReview) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } } });
  queryClientMock.apiRequest.mockImplementation(async (...args: unknown[]) => {
    const [method, url] = args as [string, string];
    if (method === "GET" && url === "/api/admin/product-intake-wizard/sessions/sess_1/draft-review") {
      return jsonResponse({ success: true, data: review });
    }
    if (method === "POST" && url === "/api/pbv2/tree-versions/tree_1/publish") {
      return jsonResponse({
        success: true,
        requiresWarningsConfirm: true,
        findings: [{ code: "PBV2_W_PRICE_REVIEW", severity: "WARNING", message: "Review pricing.", path: "meta.pricingV2" }],
      });
    }
    if (method === "POST" && url === "/api/pbv2/tree-versions/tree_1/publish?confirmWarnings=true") {
      return jsonResponse({ success: true, data: { id: "tree_1", status: "ACTIVE" }, productId: "prod_1", pbv2ActiveTreeVersionId: "tree_1" });
    }
    if (method === "POST" && url === "/api/admin/product-intake-wizard/sessions/sess_1/activate-product") {
      return jsonResponse({ success: true, data: { productId: "prod_1", isActive: true } });
    }
    if (method === "PATCH" && url === "/api/admin/product-intake-wizard/sessions/sess_1/draft-pricing") {
      return jsonResponse({
        success: true,
        data: reviewFixture({
          pbv2Tree: {
            ...review.pbv2Tree,
            basePricing: { perSqftCents: 500, perPieceCents: null, minimumChargeCents: 2500 },
          },
          publishReadiness: { ...review.publishReadiness, pricingConfigured: true },
        }),
      });
    }
    throw new Error(`Unexpected request ${method} ${url}`);
  });

  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/admin/product-intake/sessions/sess_1/review"]}>
          <Routes>
            <Route path="/admin/product-intake/sessions/:sessionId/review" element={<ProductIntakeDraftReviewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  for (let index = 0; index < 5 && !container.textContent?.includes("Intake Summary"); index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
  return { container, root };
}

beforeEach(() => {
  queryClientMock.apiRequest.mockReset();
  queryClientMock.queryClient.invalidateQueries.mockReset();
  document.body.innerHTML = "";
});

describe("ProductIntakeDraftReviewPage", () => {
  test("renders intake, product, PBV2, validation, and next action states", async () => {
    const { container, root } = await renderPage(reviewFixture());

    expect(container.textContent).toContain("Intake Summary");
    expect(container.textContent).toContain("Product Draft");
    expect(container.textContent).toContain("PBV2 Draft Tree");
    expect(container.textContent).toContain("Matrix Readiness");
    expect(container.textContent).toContain("Size Quantity");
    expect(container.textContent).toContain("size");
    expect(container.textContent).toContain("quantity");
    expect(container.textContent).toContain("12x18, 18x24, 24x36");
    expect(container.textContent).toContain("Create a PBV2 pricing matrix");
    expect(container.textContent).toContain("Validation / Publish Readiness");
    expect(container.textContent).toContain("Base Pricing");
    expect(container.textContent).toContain("Save Draft Pricing");
    expect(container.textContent).toContain("Next Actions");
    expect(container.textContent).toContain("Product inactive");
    expect(container.textContent).toContain("PBV2 DRAFT");
    expect(container.textContent).toContain("Publish the PBV2 draft before activating this product.");
    expect(container.innerHTML).toContain("/products/prod_1/edit?draftTreeVersionId=tree_1");
    expect(container.innerHTML).toContain("/products/prod_1/builder-v2?draftTreeVersionId=tree_1");

    const activate = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Activate Product"));
    expect(activate?.hasAttribute("disabled")).toBe(true);

    act(() => root.unmount());
  });

  test("renders generated matrix preview rows and values", async () => {
    const { container, root } = await renderPage(reviewFixture({
      pbv2Tree: {
        ...reviewFixture().pbv2Tree,
        matrixReadiness: {
          ...reviewFixture().pbv2Tree.matrixReadiness!,
          matrixDimensions: ["printed_sides", "quantity"],
          noMatrixRowsGenerated: false,
          matrixConfidence: 95,
          recommendedSetup: "AI generated a PBV2 pricing matrix draft from explicit source tiers and prices. Review all rows in the PBV2 builder before publish.",
        },
        matrixPreview: {
          generatedByAI: true,
          reviewRequired: true,
          matrixConfidence: 95,
          generationReasoning: ["Every generated row included every detected quantity tier price."],
          sourceSignals: ["Printed Sides rows matched explicit price values for 3 quantity tiers."],
          dimensions: ["printed_sides"],
          tiers: [
            { id: "qty_1_100", label: "1-100", minQty: 1, maxQty: 100 },
            { id: "qty_101_500", label: "101-500", minQty: 101, maxQty: 500 },
            { id: "qty_501", label: "501+", minQty: 501, maxQty: null },
          ],
          rows: [
            {
              id: "preview_single_sided",
              label: "Single Sided",
              when: { printed_sides: "single_sided" },
              prices: [
                { tierId: "qty_1_100", label: "1-100", minQty: 1, perPieceCents: 440 },
                { tierId: "qty_101_500", label: "101-500", minQty: 101, perPieceCents: 330 },
                { tierId: "qty_501", label: "501+", minQty: 501, perPieceCents: 300 },
              ],
            },
            {
              id: "preview_double_sided",
              label: "Double Sided",
              when: { printed_sides: "double_sided" },
              prices: [
                { tierId: "qty_1_100", label: "1-100", minQty: 1, perPieceCents: 550 },
                { tierId: "qty_101_500", label: "101-500", minQty: 101, perPieceCents: 440 },
                { tierId: "qty_501", label: "501+", minQty: 501, perPieceCents: 400 },
              ],
            },
          ],
          warnings: ["AI generated this pricing matrix as an inactive draft artifact only."],
        },
      },
    }));

    expect(container.textContent).toContain("Matrix Preview");
    expect(container.textContent).toContain("AI Generated");
    expect(container.textContent).toContain("Review Required");
    expect(container.textContent).toContain("Single Sided");
    expect(container.textContent).toContain("Double Sided");
    expect(container.textContent).toContain("$4.40/ea");
    expect(container.textContent).toContain("$5.50/ea");
    expect(container.textContent).toContain("Matrix draft generated");

    act(() => root.unmount());
  });

  test("saves draft base pricing without publishing or activating", async () => {
    const { container, root } = await renderPage(reviewFixture());
    const inputs = Array.from(container.querySelectorAll("input"));
    expect(inputs).toHaveLength(3);

    await act(async () => {
      Simulate.change(inputs[0], { target: { value: "5.00" } } as any);
      Simulate.change(inputs[2], { target: { value: "25" } } as any);
    });

    const savePricing = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Save Draft Pricing"));
    await act(async () => {
      savePricing?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(queryClientMock.apiRequest).toHaveBeenCalledWith("PATCH", "/api/admin/product-intake-wizard/sessions/sess_1/draft-pricing", {
      base: { perSqftCents: 500, perPieceCents: null, minimumChargeCents: 2500 },
    });
    expect(queryClientMock.apiRequest).not.toHaveBeenCalledWith("POST", "/api/pbv2/tree-versions/tree_1/publish");
    expect(queryClientMock.apiRequest).not.toHaveBeenCalledWith("POST", "/api/admin/product-intake-wizard/sessions/sess_1/activate-product");

    act(() => root.unmount());
  });

  test("renders warning confirmation after PBV2 publish warning response", async () => {
    const { container, root } = await renderPage(reviewFixture());
    const publish = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Publish PBV2 Draft"));
    expect(publish).toBeTruthy();

    await act(async () => {
      publish?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(container.textContent).toContain("PBV2 publish has warnings");
    expect(container.textContent).toContain("Confirm Warnings and Publish");
    expect(queryClientMock.apiRequest).toHaveBeenCalledWith("POST", "/api/pbv2/tree-versions/tree_1/publish");

    act(() => root.unmount());
  });
});
