import React, { act } from "react";
import { createRoot } from "react-dom/client";
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
      optionGroups: [{ id: "group_size", label: "Size & Quantity", optionCount: 2, options: ["Size", "Quantity"] }],
      draftQuality: { label: "Good", score: 86, warnings: ["Pricing setup required."] },
      intakeSummary: null,
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
    expect(container.textContent).toContain("Validation / Publish Readiness");
    expect(container.textContent).toContain("Next Actions");
    expect(container.textContent).toContain("Product inactive");
    expect(container.textContent).toContain("PBV2 DRAFT");
    expect(container.textContent).toContain("Publish the PBV2 draft before activating this product.");
    expect(container.innerHTML).toContain("/products/prod_1/edit");
    expect(container.innerHTML).toContain("/products/prod_1/builder-v2");

    const activate = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Activate Product"));
    expect(activate?.hasAttribute("disabled")).toBe(true);

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
